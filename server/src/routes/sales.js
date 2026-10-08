import { Router } from 'express';
import { db } from '../db.js';
import { getAliasMetrics } from '../lib/aliasMetrics.js';
import { aliasKey } from '../lib/alias.js';
import { fullYearWeeks } from '../lib/csv.js';

const router = Router();

// Only consumed by the CPFR sheet, which plans by alias (every color of a given spec
// combined) rather than per individual color/SKU — so this pivots to alias rows too:
// columns = week number, cell = summed sell-out qty across every store/color/SKU
// sharing that alias.
router.get('/sales', (req, res) => {
  // The CPFR sheet's Weekly Sell-Out columns always span week 1 through the current
  // year's last week, not just weeks that happen to have an upload yet — so the full
  // year's columns are visible (and scrollable) from day one. Any week with actual
  // data outside that range (a prior year's upload, say) is still included.
  const weekSet = new Set(fullYearWeeks(new Date().getFullYear()));
  for (const { weekNumber } of db.prepare('SELECT DISTINCT week_number AS weekNumber FROM sales_weekly').all()) weekSet.add(weekNumber);
  const weeks = Array.from(weekSet).sort((a, b) => a - b);

  const totals = db.prepare(`
    SELECT p.device_model AS deviceModel, sw.week_number AS weekNumber, SUM(sw.total_qty) AS qty
    FROM sales_weekly sw
    JOIN products p ON p.id = sw.product_id
    GROUP BY p.device_model, sw.week_number
  `).all();

  const byAlias = new Map();
  for (const row of totals) {
    const alias = aliasKey(row.deviceModel);
    if (!byAlias.has(alias)) byAlias.set(alias, {});
    const weekTotals = byAlias.get(alias);
    weekTotals[row.weekNumber] = (weekTotals[row.weekNumber] || 0) + row.qty;
  }

  const { aliases } = getAliasMetrics();

  const table = Array.from(byAlias.entries()).map(([alias, weekTotals]) => ({
    alias,
    onHand: aliases.get(alias)?.onHand ?? 0,
    isFlagship: aliases.get(alias)?.isFlagship ?? false,
    category: aliases.get(alias)?.category ?? null,
    weeks: weekTotals,
  }));

  res.json({ weeks, table });
});

export default router;
