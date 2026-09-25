import { db } from '../db.js';
import { computeUnservedSeries } from './balance.js';
import { getItemDescMaps } from './itemDesc.js';
import { getDeviceMetrics } from './deviceMetrics.js';

function weeksByMonth() {
  const rows = db.prepare('SELECT DISTINCT week_number AS weekNumber, week_start AS weekStart FROM sales_weekly').all();
  const map = new Map();
  for (const { weekNumber, weekStart } of rows) {
    if (!weekStart) continue;
    const d = new Date(weekStart);
    if (Number.isNaN(d.getTime())) continue;
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(month)) map.set(month, []);
    map.get(month).push(weekNumber);
  }
  return map;
}

export function computeBalanceTable() {
  const months = db.prepare('SELECT * FROM months ORDER BY month').all();
  const weekMap = weeksByMonth();
  const { toItemDesc } = getItemDescMaps();
  const { devices } = getDeviceMetrics();

  const cpfrForWeeks = (deviceModel, weekNumbers) => {
    if (!weekNumbers?.length) return 0;
    const placeholders = weekNumbers.map(() => '?').join(',');
    const row = db.prepare(`
      SELECT COALESCE(SUM(weekly_cpfr - actual_do), 0) AS total
      FROM cpfr WHERE device_model = ? AND week_number IN (${placeholders})
    `).get(deviceModel, ...weekNumbers);
    return row.total;
  };

  const table = Array.from(devices.values())
    .map(({ deviceModel, onHand, isFlagship, category }) => {
      const itemDesc = toItemDesc.get(deviceModel) || deviceModel;
      const monthRows = months.map((m) => {
        const totalCpfr = cpfrForWeeks(deviceModel, weekMap.get(m.month) || []);
        const existing = db.prepare('SELECT month_balance AS monthBalance FROM balance WHERE device_model = ? AND month = ?').get(deviceModel, m.month);
        return { month: m.month, label: m.label, totalCpfr, monthBalance: existing?.monthBalance ?? 0 };
      });
      return { itemDesc, deviceModel, onHand, isFlagship, category, months: computeUnservedSeries(monthRows) };
    })
    .sort((a, b) => a.itemDesc.localeCompare(b.itemDesc));

  return { months, table };
}
