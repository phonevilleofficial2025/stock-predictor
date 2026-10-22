import { Router } from 'express';
import { pool } from '../db.js';
import { getDeviceMetrics } from '../lib/deviceMetrics.js';
import { computeScore, classifyStatus } from '../lib/predictions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// Same Healthy/Moderate/Critical classification used by Predictions/Dashboard/RSI
// warnings (score without CPFR applied), keyed by device_model so it can be joined
// onto per-SKU stock rows below.
async function statusByDeviceModel() {
  const { devices } = await getDeviceMetrics();
  const map = new Map();
  for (const d of devices.values()) {
    const { score } = computeScore({ onHand: d.onHand, avg2wk: d.avg2wk, totalCpfr: 0 });
    map.set(d.deviceModel, score === null ? null : classifyStatus(score, d.isFlagship));
  }
  return map;
}

router.get('/stores', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM stores ORDER BY name');
  res.json(rows);
}));

// Aggregate on-hand across every store, per product — powers the "All Stores"
// summary view (as opposed to /stock, which is scoped to one storeId).
router.get('/stock/summary', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.id AS "productId", p.sku, p.device_model AS "deviceModel", p.variant_name AS "variantName",
           p.is_flagship AS "isFlagship", p.category AS category, p.brand AS brand, COALESCE(SUM(s.quantity), 0) AS quantity,
           COUNT(DISTINCT CASE WHEN s.quantity > 0 THEN s.store_id END) AS "storeCount",
           MAX(s.updated_at) AS "updatedAt"
    FROM products p
    LEFT JOIN store_stock s ON s.product_id = p.id
    GROUP BY p.id
    ORDER BY p.device_model, p.variant_name
  `);

  const statusMap = await statusByDeviceModel();
  res.json(rows.map((r) => ({
    ...r, quantity: Number(r.quantity), storeCount: Number(r.storeCount), isFlagship: Boolean(r.isFlagship),
    status: statusMap.get(r.deviceModel) ?? null,
  })));
}));

router.get('/stock', asyncHandler(async (req, res) => {
  const { storeId } = req.query;
  if (!storeId) return res.status(400).json({ error: 'storeId is required' });

  const { rows } = await pool.query(`
    SELECT p.id AS "productId", p.sku, p.device_model AS "deviceModel", p.variant_name AS "variantName",
           p.is_flagship AS "isFlagship", p.category AS category, p.brand AS brand, s.quantity, s.updated_at AS "updatedAt"
    FROM store_stock s
    JOIN products p ON p.id = s.product_id
    WHERE s.store_id = $1
    ORDER BY p.device_model, p.variant_name
  `, [Number(storeId)]);

  const statusMap = await statusByDeviceModel();
  res.json(rows.map((r) => ({ ...r, isFlagship: Boolean(r.isFlagship), status: statusMap.get(r.deviceModel) ?? null })));
}));

router.put('/products/:productId/flagship', asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { isFlagship } = req.body;
  const result = await pool.query('UPDATE products SET is_flagship = $1 WHERE id = $2', [isFlagship ? 1 : 0, Number(productId)]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true, productId: Number(productId), isFlagship: Boolean(isFlagship) });
}));

router.get('/devices', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT device_model AS "deviceModel", MAX(is_flagship) AS "isFlagship", COUNT(*) AS "variantCount"
    FROM products
    GROUP BY device_model
    ORDER BY device_model
  `);
  res.json(rows.map((r) => ({ ...r, isFlagship: Boolean(r.isFlagship), variantCount: Number(r.variantCount) })));
}));

export default router;
