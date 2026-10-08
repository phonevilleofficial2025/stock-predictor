import { db } from '../db.js';
import { computeUnservedSeries } from './balance.js';
import { getAliasMetrics } from './aliasMetrics.js';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Every month of the current year, Jan through Dec, as a fixed scaffold — like the
// CPFR sheet's full-year week columns, Balance/PO no longer needs a manual "Add
// Month" step; every month is just there from the start. Any month explicitly
// recorded in the `months` table (a different year, or a custom label) is merged in
// too, so nothing from before this change is lost.
function fullYearMonths(year) {
  return MONTH_LABELS.map((label, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, label }));
}

function allMonths() {
  const year = new Date().getFullYear();
  const map = new Map(fullYearMonths(year).map((m) => [m.month, m]));
  for (const m of db.prepare('SELECT * FROM months ORDER BY month').all()) map.set(m.month, { month: m.month, label: m.label });
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

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

// Balance (and, via po.js, Product Order) plan by alias — every color of a given
// spec combined — the same unit the CPFR sheet itself plans in, not per individual
// color/SKU.
export function computeBalanceTable() {
  const months = allMonths();
  const weekMap = weeksByMonth();
  const { aliases } = getAliasMetrics();

  const cpfrForWeeks = (alias, weekNumbers) => {
    if (!weekNumbers?.length) return 0;
    const placeholders = weekNumbers.map(() => '?').join(',');
    const row = db.prepare(`
      SELECT COALESCE(SUM(weekly_cpfr - actual_do), 0) AS total
      FROM cpfr WHERE alias = ? AND week_number IN (${placeholders})
    `).get(alias, ...weekNumbers);
    return row.total;
  };

  const table = Array.from(aliases.values())
    .map(({ alias, onHand, isFlagship, category }) => {
      const monthRows = months.map((m) => {
        const totalCpfr = cpfrForWeeks(alias, weekMap.get(m.month) || []);
        const existing = db.prepare('SELECT month_balance AS monthBalance FROM balance WHERE alias = ? AND month = ?').get(alias, m.month);
        return { month: m.month, label: m.label, totalCpfr, monthBalance: existing?.monthBalance ?? 0 };
      });
      return { alias, onHand, isFlagship, category, months: computeUnservedSeries(monthRows) };
    })
    .sort((a, b) => a.alias.localeCompare(b.alias));

  return { months, table };
}
