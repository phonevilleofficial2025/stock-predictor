import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { parseCsvBuffer, rowsToObjects, detectCadence, retailWeekInfo } from '../lib/csv.js';
import { aliasKey } from '../lib/alias.js';

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

// Prepared once and reused across every row of every upload — re-preparing inside a
// per-row loop for large files (tens of thousands of rows) is what was crashing the
// experimental node:sqlite binding.
const stmt = {
  saveTemplate: db.prepare(`
    INSERT INTO import_templates (file_type, column_mapping, headers_signature)
    VALUES (?, ?, ?)
    ON CONFLICT(file_type) DO UPDATE SET column_mapping = excluded.column_mapping, headers_signature = excluded.headers_signature
  `),
  getStoreByName: db.prepare('SELECT id FROM stores WHERE name = ?'),
  insertStore: db.prepare('INSERT INTO stores (name) VALUES (?)'),
  getProductBySku: db.prepare('SELECT id, category, brand FROM products WHERE sku = ?'),
  updateProduct: db.prepare('UPDATE products SET device_model = ?, variant_name = ?, category = ?, brand = ? WHERE id = ?'),
  insertProduct: db.prepare('INSERT INTO products (sku, device_model, variant_name, category, brand) VALUES (?, ?, ?, ?, ?)'),
  upsertStock: db.prepare(`
    INSERT INTO store_stock (store_id, product_id, quantity, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(store_id, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at
  `),
  getStockForStore: db.prepare('SELECT product_id AS productId, quantity FROM store_stock WHERE store_id = ?'),
  zeroStock: db.prepare('UPDATE store_stock SET quantity = 0, updated_at = ? WHERE store_id = ? AND product_id = ?'),
  insertUpload: db.prepare('INSERT INTO uploads (filename, file_type, uploaded_at, row_count, week_number) VALUES (?, ?, ?, ?, ?)'),
  upsertSalesWeekly: db.prepare(`
    INSERT INTO sales_weekly (product_id, week_number, week_start, week_end, total_qty)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(product_id, week_number) DO UPDATE SET total_qty = excluded.total_qty, week_start = excluded.week_start, week_end = excluded.week_end
  `),
  upsertStoreSalesMonthly: db.prepare(`
    INSERT INTO store_sales_monthly (store_id, month, total_qty)
    VALUES (?, ?, ?)
    ON CONFLICT(store_id, month) DO UPDATE SET total_qty = total_qty + excluded.total_qty
  `),
};

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

router.post('/preview', upload.single('file'), (req, res) => {
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
  const saved = db.prepare('SELECT column_mapping FROM import_templates WHERE file_type = ? AND headers_signature = ?').get(fileType, sig);

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
});

function requireMapping(fields, mapping) {
  const missing = fields.filter((f) => f.required && !mapping[f.key]);
  if (missing.length) {
    throw new Error(`Missing required column mapping for: ${missing.map((f) => f.label).join(', ')}`);
  }
}

function saveTemplate(fileType, headers, mapping) {
  const sig = headersSignature(headers);
  stmt.saveTemplate.run(fileType, JSON.stringify(mapping), sig);
}

function getOrCreateStore(name) {
  const existing = stmt.getStoreByName.get(name);
  if (existing) return existing.id;
  const result = stmt.insertStore.run(name);
  return Number(result.lastInsertRowid);
}

// category/brand are optional and, unlike deviceModel/variantName, only ever supplied
// by inventory uploads — passing them as `undefined` (as sales uploads do) preserves
// whatever value a prior inventory upload already set, instead of wiping it out.
function getOrCreateProduct({ sku, deviceModel, variantName, category, brand }) {
  const existing = stmt.getProductBySku.get(sku);
  if (existing) {
    const nextCategory = category !== undefined ? (category || null) : existing.category;
    const nextBrand = brand !== undefined ? (brand || null) : existing.brand;
    stmt.updateProduct.run(deviceModel, variantName || null, nextCategory, nextBrand, existing.id);
    return existing.id;
  }
  const result = stmt.insertProduct.run(sku, deviceModel, variantName || null, category || null, brand || null);
  return Number(result.lastInsertRowid);
}

router.post('/inventory/commit', (req, res) => {
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

  db.exec('BEGIN');
  try {
    for (const obj of objects) {
      const sku = obj[mapping.sku];
      const storeName = obj[mapping.store];
      const quantity = Number(obj[mapping.quantity]);
      if (!sku || !storeName || Number.isNaN(quantity)) continue;

      const deviceModel = obj[mapping.deviceModel] || sku;
      const variantName = mapping.variantName ? obj[mapping.variantName] : null;
      const category = mapping.category ? obj[mapping.category] : undefined;
      const brand = mapping.brand ? obj[mapping.brand] : undefined;

      const storeId = getOrCreateStore(storeName);
      const productId = getOrCreateProduct({ sku, deviceModel, variantName, category, brand });

      stmt.upsertStock.run(storeId, productId, quantity, now);
      rowCount += 1;

      if (!seenByStore.has(storeId)) seenByStore.set(storeId, new Set());
      seenByStore.get(storeId).add(productId);
    }

    // This upload is the authoritative new snapshot for every store it mentions — a
    // product that store carried before but isn't in this file anymore is treated as
    // no longer stocked there (zeroed out), rather than silently keeping its last
    // nonzero on-hand forever. Only touches stores this upload actually covers.
    for (const [storeId, seenProductIds] of seenByStore) {
      for (const row of stmt.getStockForStore.all(storeId)) {
        if (!seenProductIds.has(row.productId) && row.quantity !== 0) {
          stmt.zeroStock.run(now, storeId, row.productId);
          zeroedCount += 1;
        }
      }
    }

    stmt.insertUpload.run(pending.filename, 'inventory', now, rowCount, null);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }

  if (saveAsTemplate) saveTemplate('inventory', pending.headers, mapping);
  pendingUploads.delete(uploadId);
  res.json({ ok: true, rowsUpdated: rowCount, rowsZeroed: zeroedCount });
});

router.post('/sales/commit', (req, res) => {
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

  db.exec('BEGIN');
  try {
    for (const obj of objects) {
      const sku = obj[mapping.sku];
      const storeName = obj[mapping.store];
      if (!sku || !storeName) continue;

      const deviceModel = obj[mapping.deviceModel] || sku;
      const storeId = getOrCreateStore(storeName);
      const productId = getOrCreateProduct({ sku, deviceModel, variantName: null });

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
      stmt.upsertSalesWeekly.run(productId, weekNumber, cadence.min.toISOString(), cadence.max.toISOString(), qty);
    }

    for (const [key, qty] of storeMonthTotals.entries()) {
      const [storeId, month] = key.split('|');
      stmt.upsertStoreSalesMonthly.run(Number(storeId), month, qty);
    }

    stmt.insertUpload.run(pending.filename, 'sales', now, objects.length, weekNumber);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }

  if (saveAsTemplate) saveTemplate('sales', pending.headers, mapping);
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
});

// CPFR cycle files have no date/week column (just one quantity per alias for the
// whole cycle), so the week is picked by hand at commit time — then resolved through
// the same retail-week math the sales upload uses, so "pick a date" and "pick a week"
// land on the identical week_number. Rows sharing an alias (after re-normalizing
// through `aliasKey()`) are summed into one quantity, which is *added* to whatever
// Weekly CPFR that alias/week already had (an earlier upload, or a manual edit) —
// not a blind overwrite, since separate uploads/edits can legitimately stack within
// one planning cycle.
router.post('/cpfr/commit', (req, res) => {
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
  db.exec('BEGIN');
  try {
    for (const [alias, qty] of totalsByAlias) {
      const existing = db.prepare('SELECT weekly_cpfr AS weeklyCpfr FROM cpfr WHERE alias = ? AND week_number = ?').get(alias, weekNumber);
      const nextWeeklyCpfr = (existing?.weeklyCpfr ?? 0) + qty;
      db.prepare(`
        INSERT INTO cpfr (alias, week_number, weekly_cpfr, actual_do)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(alias, week_number) DO UPDATE SET weekly_cpfr = excluded.weekly_cpfr
      `).run(alias, weekNumber, nextWeeklyCpfr);
    }

    stmt.insertUpload.run(pending.filename, 'cpfr', now, totalsByAlias.size, weekNumber);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }

  if (saveAsTemplate) saveTemplate('cpfr', pending.headers, mapping);
  pendingUploads.delete(uploadId);
  res.json({ ok: true, weekNumber, weekLabel, aliasesUpdated: totalsByAlias.size, skippedCount });
});

router.get('/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM uploads ORDER BY id DESC LIMIT 50').all();
  res.json(rows);
});

export default router;
