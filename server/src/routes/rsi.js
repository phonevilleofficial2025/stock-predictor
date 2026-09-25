import { Router } from 'express';
import { db } from '../db.js';
import { getDeviceMetrics } from '../lib/deviceMetrics.js';
import { computeScore, classifyStatus } from '../lib/predictions.js';

const router = Router();

router.get('/rsi', (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month is required (e.g. "2026-09")' });

  const rows = db.prepare(`
    SELECT s.id AS storeId, s.name AS storeName, COALESCE(m.total_qty, 0) AS totalQty,
           COALESCE(r.is_rsi, 0) AS isRsi
    FROM stores s
    LEFT JOIN store_sales_monthly m ON m.store_id = s.id AND m.month = ?
    LEFT JOIN rsi r ON r.store_id = s.id AND r.month = ?
    ORDER BY totalQty DESC
  `).all(month, month);

  res.json({ month, stores: rows.map((r) => ({ ...r, isRsi: Boolean(r.isRsi) })) });
});

router.put('/rsi', (req, res) => {
  const { storeId, month, isRsi } = req.body;
  if (!storeId || !month) return res.status(400).json({ error: 'storeId and month are required' });

  db.prepare(`
    INSERT INTO rsi (store_id, month, is_rsi)
    VALUES (?, ?, ?)
    ON CONFLICT(store_id, month) DO UPDATE SET is_rsi = excluded.is_rsi
  `).run(Number(storeId), month, isRsi ? 1 : 0);

  res.json({ ok: true });
});

// Devices currently Critical, broken down by which RSI stores stock them —
// used to badge "priority" warnings across the app.
router.get('/rsi/warnings', (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month is required' });

  const rsiStoreIds = db.prepare('SELECT store_id AS storeId FROM rsi WHERE month = ? AND is_rsi = 1').all(month).map((r) => r.storeId);
  if (rsiStoreIds.length === 0) return res.json({ month, warnings: [] });

  const { devices } = getDeviceMetrics();
  const criticalDevices = new Set();
  for (const d of devices.values()) {
    const { score } = computeScore({ onHand: d.onHand, avg2wk: d.avg2wk, totalCpfr: 0 });
    if (score !== null && classifyStatus(score, d.isFlagship) === 'Critical') criticalDevices.add(d.deviceModel);
  }

  if (criticalDevices.size === 0) return res.json({ month, warnings: [] });

  const placeholders = rsiStoreIds.map(() => '?').join(',');
  const stockRows = db.prepare(`
    SELECT st.id AS storeId, st.name AS storeName, p.device_model AS deviceModel, ss.quantity
    FROM store_stock ss
    JOIN stores st ON st.id = ss.store_id
    JOIN products p ON p.id = ss.product_id
    WHERE ss.store_id IN (${placeholders})
  `).all(...rsiStoreIds);

  const warnings = stockRows
    .filter((r) => criticalDevices.has(r.deviceModel))
    .map((r) => ({ storeId: r.storeId, storeName: r.storeName, deviceModel: r.deviceModel, quantity: r.quantity }));

  res.json({ month, warnings });
});

export default router;
