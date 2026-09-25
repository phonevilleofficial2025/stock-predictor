import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { parseCsvBuffer, rowsToObjects, detectCadence, retailWeekInfo } from '../lib/csv.js';

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

function autoMapping(fields, headers) {
  const mapping = {};
  for (const field of fields) {
    const key = normalize(field.key);
    const label = normalize(field.label.replace(/\(.*\)/, ''));
    const match = headers.find((h) => {
      const n = normalize(h);
      return n === key || n === label || n.includes(key) || key.includes(n) || n.includes(label);
    });
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

router.get('/fields/:fileType', (req, res) => {
  const { fileType } = req.params;
  if (fileType === 'inventory') return res.json({ fields: INVENTORY_FIELDS });
  if (fileType === 'sales') return res.json({ fields: SALES_FIELDS });
  return res.status(400).json({ error: 'Unknown file type' });
});

router.post('/preview', upload.single('file'), (req, res) => {
  const { fileType } = req.body;
  if (!['inventory', 'sales'].includes(fileType)) {
    return res.status(400).json({ error: 'fileType must be "inventory" or "sales"' });
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

  const fields = fileType === 'inventory' ? INVENTORY_FIELDS : SALES_FIELDS;
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
    }

    stmt.insertUpload.run(pending.filename, 'inventory', now, rowCount, null);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }

  if (saveAsTemplate) saveTemplate('inventory', pending.headers, mapping);
  pendingUploads.delete(uploadId);
  res.json({ ok: true, rowsUpdated: rowCount });
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

router.get('/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM uploads ORDER BY id DESC LIMIT 50').all();
  res.json(rows);
});

export default router;
