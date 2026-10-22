import { Router } from 'express';
import { pool } from '../db.js';
import { getDeviceMetrics } from '../lib/deviceMetrics.js';
import { computeScore, classifyStatus } from '../lib/predictions.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/rsi', asyncHandler(async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month is required (e.g. "2026-09")' });

  const { rows } = await pool.query(`
    SELECT s.id AS "storeId", s.name AS "storeName", COALESCE(m.total_qty, 0) AS "totalQty",
           COALESCE(r.is_rsi, 0) AS "isRsi"
    FROM stores s
    LEFT JOIN store_sales_monthly m ON m.store_id = s.id AND m.month = $1
    LEFT JOIN rsi r ON r.store_id = s.id AND r.month = $1
    ORDER BY "totalQty" DESC
  `, [month]);

  res.json({ month, stores: rows.map((r) => ({ ...r, totalQty: Number(r.totalQty), isRsi: Boolean(r.isRsi) })) });
}));

router.put('/rsi', asyncHandler(async (req, res) => {
  const { storeId, month, isRsi } = req.body;
  if (!storeId || !month) return res.status(400).json({ error: 'storeId and month are required' });

  await pool.query(`
    INSERT INTO rsi (store_id, month, is_rsi)
    VALUES ($1, $2, $3)
    ON CONFLICT(store_id, month) DO UPDATE SET is_rsi = excluded.is_rsi
  `, [Number(storeId), month, isRsi ? 1 : 0]);

  res.json({ ok: true });
}));

// Devices currently Critical, broken down by which RSI stores stock them —
// used to badge "priority" warnings across the app.
router.get('/rsi/warnings', asyncHandler(async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month is required' });

  const { rows: rsiStoreRows } = await pool.query('SELECT store_id AS "storeId" FROM rsi WHERE month = $1 AND is_rsi = 1', [month]);
  const rsiStoreIds = rsiStoreRows.map((r) => r.storeId);
  if (rsiStoreIds.length === 0) return res.json({ month, warnings: [] });

  const { devices } = await getDeviceMetrics();
  const criticalDevices = new Set();
  for (const d of devices.values()) {
    const { score } = computeScore({ onHand: d.onHand, avg2wk: d.avg2wk, totalCpfr: 0 });
    if (score !== null && classifyStatus(score, d.isFlagship) === 'Critical') criticalDevices.add(d.deviceModel);
  }

  if (criticalDevices.size === 0) return res.json({ month, warnings: [] });

  const placeholders = rsiStoreIds.map((_, i) => `$${i + 1}`).join(',');
  const { rows: stockRows } = await pool.query(`
    SELECT st.id AS "storeId", st.name AS "storeName", p.device_model AS "deviceModel", ss.quantity
    FROM store_stock ss
    JOIN stores st ON st.id = ss.store_id
    JOIN products p ON p.id = ss.product_id
    WHERE ss.store_id IN (${placeholders})
  `, rsiStoreIds);

  const warnings = stockRows
    .filter((r) => criticalDevices.has(r.deviceModel))
    .map((r) => ({ storeId: r.storeId, storeName: r.storeName, deviceModel: r.deviceModel, quantity: r.quantity }));

  res.json({ month, warnings });
}));

export default router;
