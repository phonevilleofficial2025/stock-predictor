import { db } from '../db.js';

// Shared helper: for every device, computes on-hand stock and the 2-week average
// sell-out rate using the two most recent weeks present in sales_weekly.
//
// Aggregates in a handful of GROUP BY queries instead of looping per-device —
// with thousands of devices, one query per device per metric turned this into
// tens of thousands of round trips and blocked the server for seconds at a time.
export function getDeviceMetrics() {
  const weekRows = db.prepare('SELECT DISTINCT week_number AS w FROM sales_weekly ORDER BY w DESC LIMIT 2').all();
  const latestWeek = weekRows[0]?.w ?? null;
  const priorWeek = weekRows[1]?.w ?? null;

  const devices = db.prepare(`
    SELECT device_model AS deviceModel, MAX(is_flagship) AS isFlagship, MAX(category) AS category, MAX(brand) AS brand
    FROM products GROUP BY device_model
  `).all();

  const onHandByDevice = new Map(
    db.prepare(`
      SELECT p.device_model AS deviceModel, COALESCE(SUM(s.quantity), 0) AS onHand
      FROM products p LEFT JOIN store_stock s ON s.product_id = p.id
      GROUP BY p.device_model
    `).all().map((r) => [r.deviceModel, r.onHand])
  );

  const weekQtyByDevice = new Map(); // deviceModel -> { [weekNumber]: qty }
  if (latestWeek !== null) {
    const weeks = priorWeek !== null ? [latestWeek, priorWeek] : [latestWeek];
    const placeholders = weeks.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT p.device_model AS deviceModel, sw.week_number AS week, COALESCE(SUM(sw.total_qty), 0) AS qty
      FROM sales_weekly sw JOIN products p ON p.id = sw.product_id
      WHERE sw.week_number IN (${placeholders})
      GROUP BY p.device_model, sw.week_number
    `).all(...weeks);
    for (const r of rows) {
      if (!weekQtyByDevice.has(r.deviceModel)) weekQtyByDevice.set(r.deviceModel, {});
      weekQtyByDevice.get(r.deviceModel)[r.week] = r.qty;
    }
  }

  const result = new Map();
  for (const { deviceModel, isFlagship, category, brand } of devices) {
    const onHand = onHandByDevice.get(deviceModel) || 0;
    const weekTotals = weekQtyByDevice.get(deviceModel) || {};
    const week1Qty = latestWeek !== null ? (weekTotals[latestWeek] || 0) : 0;
    const week2Qty = priorWeek !== null ? (weekTotals[priorWeek] || 0) : 0;
    const avg2wk = (week1Qty + week2Qty) / 2;

    result.set(deviceModel, { deviceModel, isFlagship: Boolean(isFlagship), category: category || null, brand: brand || null, onHand, avg2wk, latestWeek, priorWeek });
  }
  return { latestWeek, priorWeek, devices: result };
}
