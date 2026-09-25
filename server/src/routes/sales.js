import { Router } from 'express';
import { db } from '../db.js';
import { getDeviceMetrics } from '../lib/deviceMetrics.js';

const router = Router();

// Pivot: rows = device model, columns = week number, cell = summed sell-out qty
// across all stores/variants for that device (per spec: sales tab is store-agnostic).
router.get('/sales', (req, res) => {
  const weeks = db.prepare('SELECT DISTINCT week_number AS weekNumber FROM sales_weekly ORDER BY week_number').all()
    .map((r) => r.weekNumber);

  const totals = db.prepare(`
    SELECT p.device_model AS deviceModel, sw.week_number AS weekNumber, SUM(sw.total_qty) AS qty
    FROM sales_weekly sw
    JOIN products p ON p.id = sw.product_id
    GROUP BY p.device_model, sw.week_number
  `).all();

  const byDevice = new Map();
  for (const row of totals) {
    if (!byDevice.has(row.deviceModel)) byDevice.set(row.deviceModel, {});
    byDevice.get(row.deviceModel)[row.weekNumber] = row.qty;
  }

  const { devices } = getDeviceMetrics();

  const table = Array.from(byDevice.entries()).map(([deviceModel, weekTotals]) => ({
    deviceModel,
    onHand: devices.get(deviceModel)?.onHand ?? 0,
    isFlagship: devices.get(deviceModel)?.isFlagship ?? false,
    category: devices.get(deviceModel)?.category ?? null,
    brand: devices.get(deviceModel)?.brand ?? null,
    weeks: weekTotals,
  }));

  res.json({ weeks, table });
});

export default router;
