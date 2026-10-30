import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { parseCsvBuffer, rowsToObjects, detectCadence, retailWeekInfo } from '../lib/csv.js';
import { aliasKey } from '../lib/alias.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = Router();

// In-memory cache of previewed-but-not-yet-committed uploads. Local single-user
// tool, so process memory is an acceptable place to stash the pending file.
const pendingUploads = new Map();

const INVENTORY_FIELDS = [
  { key: 'store', label: 'Store', required: true },
  { key: 'sku', label: 'Product / SKU', required: true },
  { key: 'deviceModel', label: 'Device Model', required: true },
  { key: 'variantName', label: 'Variant Name', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'brand', label: 'Brand', required: false },
  { key: 'quantity', label: 'Quantity', required: true },
];

const SALES_FIELDS = [
  { key: 'sku', label: 'Product / SKU', required: true },
  { key: 'deviceModel', label: 'Device Model', required: true },
  { key: 'store', label: 'Store', required: true },
  { key: 'serialNo', label: 'Serial No', required: false },
  { key: 'saleDate', label: 'Sale Date', required: true },
];

// CPFR cycle files (e.g. a monthly "BSD ALIAS (FOR SIMULATION)" export) carry one
// planning quantity per alias and no date/week column at all — the week this applies
// to is picked by hand at commit time instead of detected from the file. The alias
// column is re-normalized through the same `aliasKey()` the rest of the app uses
// (derived from Device Model text), so an alias spelled "Galaxy A07 LTE (4+128GB)"
// in the file lines up with the identical alias computed from real inventory data,
// not a second, differently-cased row that never shows up anywhere.
const CPFR_FIELDS = [
  { key: 'alias', label: 'Alias', required: true },
  { key: 'quantity', label: 'Quantity', required: true },
];

function headersSignature(headers) {
  return crypto.createHash('sha1').update(headers.join('|')).digest('hex');
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A handful of common header abbreviations that don't substring-match their field's
// own key/label (e.g. a column literally named "Qty" or "AUG CPFR QTY" won't contain
// "quantity"), so auto-mapping would otherwise miss them every time.
const FIELD_SYNONYMS = { quantity: ['qty'] };

function autoMapping(fields, headers) {
  const mapping = {};
  for (const field of fields) {
    const key = normalize(field.key);
    const label = normalize(field.label.replace(/\(.*\)/, ''));
    const synonyms = (FIELD_SYNONYMS[field.key] || []).map(normalize);
    const match = headers.find((h) => {
      const n = normalize(h);
      return n === key || n === label || n.includes(key) || key.includes(n) || n.includes(label) || synonyms.some((s) => n.includes(s));
    });
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

router.get('/fields/:fileType', (req, res) => {
  const { fileType } = req.params;
  if (fileType === 'inventory') return res.json({ fields: INVENTORY_FIELDS });
  if (fileType === 'sales') return res.json({ fields: SALES_FIELDS });
  if (fileType === 'cpfr') return res.json({ fields: CPFR_FIELDS });
  return res.status(400).json({ error: 'Unknown file type' });
});

router.post('/preview', upload.single('file'), asyncHandler(async (req, res) => {
  const { fileType } = req.body;
  if (!['inventory', 'sales', 'cpfr'].includes(fileType)) {
    return res.status(400).json({ error: 'fileType must be "inventory", "sales", or "cpfr"' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let headers, rows;
  try {
    ({ headers, rows } = parseCsvBuffer(req.file.buffer));
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }
  if (headers.length === 0) return res.status(400).json({ error: 'File appears to be empty' });

  const uploadId = crypto.randomUUID();
  pendingUploads.set(uploadId, {
    fileType,
    filename: req.file.originalname,
    headers,
    rows,
    createdAt: Date.now(),
  });

  const fields = fileType === 'inventory' ? INVENTORY_FIELDS : fileType === 'sales' ? SALES_FIELDS : CPFR_FIELDS;
  const sig = headersSignature(headers);
  const { rows: templateRows } = await pool.query(
    'SELECT column_mapping FROM import_templates WHERE file_type = $1 AND headers_signature = $2',
    [fileType, sig]
  );
  const saved = templateRows[0];

  res.json({
    uploadId,
    filename: req.file.originalname,
    headers,
    previewRows: rows,
    rowCount: rows.length,
    fields,
    suggestedMapping: saved ? JSON.parse(saved.column_mapping) : autoMapping(fields, headers),
    autoApplied: Boolean(saved),
  });
}));

function requireMapping(fields, mapping) {
  const missing = fields.filter((f) => f.required && !mapping[f.key]);
  if (missing.length) {
    throw new Error(`Missing required column mapping for: ${missing.map((f) => f.label).join(', ')}`);
  }
}

async function saveTemplate(fileType, headers, mapping) {
  const sig = headersSignature(headers);
  await pool.query(`
    INSERT INTO import_templates (file_type, column_mapping, headers_signature)
    VALUES ($1, $2, $3)
    ON CONFLICT(file_type) DO UPDATE SET column_mapping = excluded.column_mapping, headers_signature = excluded.headers_signature
  `, [fileType, JSON.stringify(mapping), sig]);
}

async function getOrCreateStore(client, name) {
  const { rows } = await client.query('SELECT id FROM stores WHERE name = $1', [name]);
  if (rows[0]) return rows[0].id;
  const { rows: inserted } = await client.query('INSERT INTO stores (name) VALUES ($1) RETURNING id', [name]);
  return inserted[0].id;
}

// category/brand are optional and, unlike deviceModel/variantName, only ever supplied
// by inventory uploads — passing them as `undefined` (as sales uploads do) preserves
// whatever value a prior inventory upload already set, instead of wiping it out.
async function getOrCreateProduct(client, { sku, deviceModel, variantName, category, brand }) {
  const { rows } = await client.query('SELECT id, category, brand FROM products WHERE sku = $1', [sku]);
  const existing = rows[0];
  if (existing) {
    const nextCategory = category !== undefined ? (category || null) : existing.category;
    const nextBrand = brand !== undefined ? (brand || null) : existing.brand;
    await client.query(
      'UPDATE products SET device_model = $1, variant_name = $2, category = $3, brand = $4 WHERE id = $5',
      [deviceModel, variantName || null, nextCategory, nextBrand, existing.id]
    );
    return existing.id;
  }
  const { rows: inserted } = await client.query(
    'INSERT INTO products (sku, device_model, variant_name, category, brand) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [sku, deviceModel, variantName || null, category || null, brand || null]
  );
  return inserted[0].id;
}

router.post('/inventory/commit', asyncHandler(async (req, res) => {
  const { uploadId, mapping, saveAsTemplate = true } = req.body;
  const pending = pendingUploads.get(uploadId);
  if (!pending || pending.fileType !== 'inventory') {
    return res.status(400).json({ error: 'Upload not found or expired. Please re-upload the file.' });
  }

  try {
    requireMapping(INVENTORY_FIELDS, mapping);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const objects = rowsToObjects(pending.headers, pending.rows);
  const now = new Date().toISOString();
  let rowCount = 0;
  let zeroedCount = 0;
  const seenByStore = new Map(); // storeId -> Set<productId> mentioned in this upload

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const obj of objects) {
      const sku = obj[mapping.sku];
      const storeName = obj[mapping.store];
      const quantity = Number(obj[mapping.quantity]);
      if (!sku || !storeName || Number.isNaN(quantity)) continue;

      const deviceModel = obj[mapping.deviceModel] || sku;
      const variantName = mapping.variantName ? obj[mapping.variantName] : null;
      const category = mapping.category ? obj[mapping.category] : undefined;
      const brand = mapping.brand ? obj[mapping.brand] : undefined;

      const storeId = await getOrCreateStore(client, storeName);
      const productId = await getOrCreateProduct(client, { sku, deviceModel, variantName, category, brand });

      await client.query(`
        INSERT INTO store_stock (store_id, product_id, quantity, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (store_id, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at
      `, [storeId, productId, quantity, now]);
      rowCount += 1;

      if (!seenByStore.has(storeId)) seenByStore.set(storeId, new Set());
      seenByStore.get(storeId).add(productId);
    }

    // This upload is the authoritative new snapshot for every store it mentions — a
    // product that store carried before but isn't in this file anymore is treated as
    // no longer stocked there (zeroed out), rather than silently keeping its last
    // nonzero on-hand forever. Only touches stores this upload actually covers.
    for (const [storeId, seenProductIds] of seenByStore) {
      const { rows: stockRows } = await client.query('SELECT product_id AS "productId", quantity FROM store_stock WHERE store_id = $1', [storeId]);
      for (const row of stockRows) {
        if (!seenProductIds.has(row.productId) && row.quantity !== 0) {
          await client.query('UPDATE store_stock SET quantity = 0, updated_at = $1 WHERE store_id = $2 AND product_id = $3', [now, storeId, row.productId]);
          zeroedCount += 1;
        }
      }
    }

    await client.query('INSERT INTO uploads (filename, file_type, uploaded_at, row_count, week_number) VALUES ($1, $2, $3, $4, $5)', [pending.filename, 'inventory', now, rowCount, null]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // asyncHandler forwards to the global error middleware (and Sentry)
  } finally {
    client.release();
  }

  if (saveAsTemplate) await saveTemplate('inventory', pending.headers, mapping);
  pendingUploads.delete(uploadId);
  res.json({ ok: true, rowsUpdated: rowCount, rowsZeroed: zeroedCount });
}));

router.post('/sales/commit', asyncHandler(async (req, res) => {
  const { uploadId, mapping, saveAsTemplate = true } = req.body;
  const pending = pendingUploads.get(uploadId);
  if (!pending || pending.fileType !== 'sales') {
    return res.status(400).json({ error: 'Upload not found or expired. Please re-upload the file.' });
  }

  try {
    requireMapping(SALES_FIELDS, mapping);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const objects = rowsToObjects(pending.headers, pending.rows);
  const dateValues = objects.map((o) => o[mapping.saleDate]).filter(Boolean);
  const cadence = detectCadence(dateValues);

  if (cadence.cadence !== 'weekly') {
    const range = cadence.min && cadence.max
      ? ` Earliest date read: "${cadence.minRaw}" (${cadence.min.toISOString().slice(0, 10)}). Latest date read: "${cadence.maxRaw}" (${cadence.max.toISOString().slice(0, 10)}).`
      : '';
    const skipped = cadence.skippedCount ? ` ${cadence.skippedCount} row(s) had a value in the mapped date column that couldn't be read as a date at all.` : '';
    return res.status(400).json({
      error: `This file looks like ${cadence.cadence} data (date range: ${cadence.rangeDays ?? '?'} day(s)). Only weekly sell-out files are accepted — please upload a file covering a single 7-day week.${range}${skipped} If this doesn't match what you expect, double-check that "Sale Date" is mapped to the correct column.`,
      detectedCadence: cadence.cadence,
      rangeDays: cadence.rangeDays,
      minDate: cadence.min,
      maxDate: cadence.max,
      minRaw: cadence.minRaw,
      maxRaw: cadence.maxRaw,
      skippedCount: cadence.skippedCount,
    });
  }

  // Week number is derived from the file's own dates (retail week: Sunday-Saturday,
  // Week 1 starts on the Sunday on/before Jan 1st) instead of being typed in — encoded
  // as retailYear*100+retailWeek so it never collides with the same week number in a
  // different year.
  const { retailYear, retailWeek } = retailWeekInfo(cadence.min);
  const weekNumber = retailYear * 100 + retailWeek;
  const weekLabel = `${retailYear}-W${String(retailWeek).padStart(2, '0')}`;

  const now = new Date().toISOString();
  const productTotals = new Map(); // productId -> qty
  const storeMonthTotals = new Map(); // "storeId|month" -> qty

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const obj of objects) {
      const sku = obj[mapping.sku];
      const storeName = obj[mapping.store];
      if (!sku || !storeName) continue;

      const deviceModel = obj[mapping.deviceModel] || sku;
      const storeId = await getOrCreateStore(client, storeName);
      const productId = await getOrCreateProduct(client, { sku, deviceModel, variantName: null });

      productTotals.set(productId, (productTotals.get(productId) || 0) + 1);

      const saleDate = new Date(obj[mapping.saleDate]);
      const month = Number.isNaN(saleDate.getTime())
        ? null
        : `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`;
      if (month) {
        const key = `${storeId}|${month}`;
        storeMonthTotals.set(key, (storeMonthTotals.get(key) || 0) + 1);
      }
    }

    for (const [productId, qty] of productTotals.entries()) {
      await client.query(`
        INSERT INTO sales_weekly (product_id, week_number, week_start, week_end, total_qty)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (product_id, week_number) DO UPDATE SET total_qty = excluded.total_qty, week_start = excluded.week_start, week_end = excluded.week_end
      `, [productId, weekNumber, cadence.min.toISOString(), cadence.max.toISOString(), qty]);
    }

    for (const [key, qty] of storeMonthTotals.entries()) {
      const [storeId, month] = key.split('|');
      await client.query(`
        INSERT INTO store_sales_monthly (store_id, month, total_qty)
        VALUES ($1, $2, $3)
        ON CONFLICT (store_id, month) DO UPDATE SET total_qty = store_sales_monthly.total_qty + excluded.total_qty
      `, [Number(storeId), month, qty]);
    }

    await client.query('INSERT INTO uploads (filename, file_type, uploaded_at, row_count, week_number) VALUES ($1, $2, $3, $4, $5)', [pending.filename, 'sales', now, objects.length, weekNumber]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // asyncHandler forwards to the global error middleware (and Sentry)
  } finally {
    client.release();
  }

  if (saveAsTemplate) await saveTemplate('sales', pending.headers, mapping);
  pendingUploads.delete(uploadId);
  res.json({
    ok: true,
    weekNumber,
    weekLabel,
    retailYear,
    retailWeek,
    weekStart: cadence.min.toISOString(),
    weekEnd: cadence.max.toISOString(),
    productsUpdated: productTotals.size,
  });
}));

// CPFR cycle files have no date/week column (just one quantity per alias for the
// whole cycle), so the week is picked by hand at commit time — then resolved through
// the same retail-week math the sales upload uses, so "pick a date" and "pick a week"
// land on the identical week_number. Rows sharing an alias (after re-normalizing
// through `aliasKey()`) are summed into one quantity, which is *added* to whatever
// Weekly CPFR that alias/week already had (an earlier upload, or a manual edit) —
// not a blind overwrite, since separate uploads/edits can legitimately stack within
// one planning cycle.
router.post('/cpfr/commit', asyncHandler(async (req, res) => {
  const { uploadId, mapping, date, saveAsTemplate = true } = req.body;
  const pending = pendingUploads.get(uploadId);
  if (!pending || pending.fileType !== 'cpfr') {
    return res.status(400).json({ error: 'Upload not found or expired. Please re-upload the file.' });
  }

  try {
    requireMapping(CPFR_FIELDS, mapping);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!date) return res.status(400).json({ error: 'A date is required, to identify which week this upload applies to.' });
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return res.status(400).json({ error: 'Invalid date' });

  const { retailYear, retailWeek } = retailWeekInfo(parsedDate);
  const weekNumber = retailYear * 100 + retailWeek;
  const weekLabel = `${retailYear}-W${String(retailWeek).padStart(2, '0')}`;

  const objects = rowsToObjects(pending.headers, pending.rows);
  const totalsByAlias = new Map();
  let skippedCount = 0;
  for (const obj of objects) {
    const rawAlias = obj[mapping.alias];
    if (!rawAlias) continue;
    const qty = Number(obj[mapping.quantity]);
    if (Number.isNaN(qty)) { skippedCount += 1; continue; }
    const alias = aliasKey(rawAlias);
    totalsByAlias.set(alias, (totalsByAlias.get(alias) || 0) + qty);
  }

  const now = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [alias, qty] of totalsByAlias) {
      const { rows } = await client.query('SELECT weekly_cpfr AS "weeklyCpfr" FROM cpfr WHERE alias = $1 AND week_number = $2', [alias, weekNumber]);
      const nextWeeklyCpfr = (rows[0]?.weeklyCpfr ?? 0) + qty;
      await client.query(`
        INSERT INTO cpfr (alias, week_number, weekly_cpfr, actual_do)
        VALUES ($1, $2, $3, 0)
        ON CONFLICT (alias, week_number) DO UPDATE SET weekly_cpfr = excluded.weekly_cpfr
      `, [alias, weekNumber, nextWeeklyCpfr]);
    }

    await client.query('INSERT INTO uploads (filename, file_type, uploaded_at, row_count, week_number) VALUES ($1, $2, $3, $4, $5)', [pending.filename, 'cpfr', now, totalsByAlias.size, weekNumber]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // asyncHandler forwards to the global error middleware (and Sentry)
  } finally {
    client.release();
  }

  if (saveAsTemplate) await saveTemplate('cpfr', pending.headers, mapping);
  pendingUploads.delete(uploadId);
  res.json({ ok: true, weekNumber, weekLabel, aliasesUpdated: totalsByAlias.size, skippedCount });
}));

router.get('/history', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM uploads ORDER BY id DESC LIMIT 50');
  res.json(rows);
}));

export default router;
