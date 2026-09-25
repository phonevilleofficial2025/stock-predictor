import { Router } from 'express';
import { db } from '../db.js';
import { getDeviceMetrics } from '../lib/deviceMetrics.js';
import { computeScore, classifyStatus } from '../lib/predictions.js';

const router = Router();

// Same Healthy/Moderate/Critical classification used by Predictions/Dashboard/RSI
// warnings (score without CPFR applied), keyed by device_model so it can be joined
// onto per-SKU stock rows below.
function statusByDeviceModel() {
  const { devices } = getDeviceMetrics();
  const map = new Map();
  for (const d of devices.values()) {
    const { score } = computeScore({ onHand: d.onHand, avg2wk: d.avg2wk, totalCpfr: 0 });
    map.set(d.deviceModel, score === null ? null : classifyStatus(score, d.isFlagship));
  }
  return map;
}

router.get('/stores', (req, res) => {
  res.json(db.prepare('SELECT * FROM stores ORDER BY name').all());
});

// Aggregate on-hand across every store, per product — powers the "All Stores"
// summary view (as opposed to /stock, which is scoped to one storeId).
router.get('/stock/summary', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id AS productId, p.sku, p.device_model AS deviceModel, p.variant_name AS variantName,
           p.is_flagship AS isFlagship, p.category AS category, p.brand AS brand, COALESCE(SUM(s.quantity), 0) AS quantity,
           COUNT(DISTINCT CASE WHEN s.quantity > 0 THEN s.store_id END) AS storeCount,
           MAX(s.updated_at) AS updatedAt
    FROM products p
    LEFT JOIN store_stock s ON s.product_id = p.id
    GROUP BY p.id
    ORDER BY p.device_model, p.variant_name
  `).all();

  const statusMap = statusByDeviceModel();
  res.json(rows.map((r) => ({ ...r, status: statusMap.get(r.deviceModel) ?? null })));
});

router.get('/stock', (req, res) => {
  const { storeId } = req.query;
  if (!storeId) return res.status(400).json({ error: 'storeId is required' });

  const rows = db.prepare(`
    SELECT p.id AS productId, p.sku, p.device_model AS deviceModel, p.variant_name AS variantName,
           p.is_flagship AS isFlagship, p.category AS category, p.brand AS brand, s.quantity, s.updated_at AS updatedAt
    FROM store_stock s
    JOIN products p ON p.id = s.product_id
    WHERE s.store_id = ?
    ORDER BY p.device_model, p.variant_name
  `).all(Number(storeId));

  const statusMap = statusByDeviceModel();
  res.json(rows.map((r) => ({ ...r, status: statusMap.get(r.deviceModel) ?? null })));
});

router.put('/products/:productId/flagship', (req, res) => {
  const { productId } = req.params;
  const { isFlagship } = req.body;
  const result = db.prepare('UPDATE products SET is_flagship = ? WHERE id = ?').run(isFlagship ? 1 : 0, Number(productId));
  if (result.changes === 0) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true, productId: Number(productId), isFlagship: Boolean(isFlagship) });
});

router.get('/devices', (req, res) => {
  const rows = db.prepare(`
    SELECT device_model AS deviceModel, MAX(is_flagship) AS isFlagship, COUNT(*) AS variantCount
    FROM products
    GROUP BY device_model
    ORDER BY device_model
  `).all();
  res.json(rows);
});

export default router;
