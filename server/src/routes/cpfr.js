import { Router } from 'express';
import { db } from '../db.js';
import { getAliasMetrics } from '../lib/aliasMetrics.js';
import { computeSuggestion } from '../lib/predictions.js';
import { fullYearWeeks } from '../lib/csv.js';

const router = Router();

// The CPFR sheet plans by alias (e.g. "Galaxy A07 LTE (4+128GB)" — every color of
// that spec combined), not per individual color/SKU, and shows every week at once
// (no "planning week" selector), spanning the current year's week 1 through its last
// week as a fixed scaffold — not just weeks that happen to have sell-out data or an
// existing CPFR entry — so the whole year's columns are there to plan against from
// day one. Any out-of-range week that does have data (sell-out or CPFR) is still
// included via the union.
router.get('/cpfr', (req, res) => {
  const { aliases } = getAliasMetrics();

  const salesWeeks = db.prepare('SELECT DISTINCT week_number AS w FROM sales_weekly').all().map((r) => r.w);
  const cpfrWeeksData = db.prepare('SELECT DISTINCT week_number AS w FROM cpfr').all().map((r) => r.w);

  const weekSet = new Set(fullYearWeeks(new Date().getFullYear()));
  for (const w of salesWeeks) weekSet.add(w);
  for (const w of cpfrWeeksData) weekSet.add(w);
  const weeks = Array.from(weekSet).sort((a, b) => a - b);

  // The most recent week with real data (a sales upload or a CPFR entry) — the sheet
  // opens scrolled to this by default instead of week 1, so you land on your last
  // upload instead of a year of empty placeholder columns.
  const latestDataWeek = [...salesWeeks, ...cpfrWeeksData].reduce((max, w) => (w > max ? w : max), null) ?? null;

  const cpfrByAlias = new Map();
  for (const r of db.prepare('SELECT alias, week_number AS week, weekly_cpfr AS weeklyCpfr, actual_do AS actualDo FROM cpfr').all()) {
    if (!cpfrByAlias.has(r.alias)) cpfrByAlias.set(r.alias, {});
    cpfrByAlias.get(r.alias)[r.week] = { weeklyCpfr: r.weeklyCpfr, actualDo: r.actualDo };
  }

  const rows = Array.from(aliases.values()).map((a) => {
    const byWeek = cpfrByAlias.get(a.alias) || {};
    const cpfrByWeek = {};
    for (const w of weeks) {
      const e = byWeek[w] || { weeklyCpfr: 0, actualDo: 0 };
      cpfrByWeek[w] = { weeklyCpfr: e.weeklyCpfr, actualDo: e.actualDo, totalCpfr: e.weeklyCpfr - e.actualDo };
    }
    const suggestion = computeSuggestion({ onHand: a.onHand, avg2wk: a.avg2wk, existingCpfr: 0, isFlagship: a.isFlagship });

    return {
      alias: a.alias,
      variantCount: a.memberDeviceModels.length,
      isFlagship: a.isFlagship,
      category: a.category,
      onHand: a.onHand,
      avg2wk: a.avg2wk,
      suggestion,
      cpfrByWeek,
    };
  }).sort((a, b) => a.alias.localeCompare(b.alias));

  res.json({ weeks, rows, latestDataWeek });
});

router.put('/cpfr', (req, res) => {
  const { alias, week, weeklyCpfr, actualDo } = req.body;
  if (!alias || week === undefined || week === null) {
    return res.status(400).json({ error: 'alias and week are required' });
  }

  const existing = db.prepare('SELECT weekly_cpfr AS weeklyCpfr, actual_do AS actualDo FROM cpfr WHERE alias = ? AND week_number = ?')
    .get(alias, week);
  const nextWeeklyCpfr = weeklyCpfr !== undefined ? Number(weeklyCpfr) : (existing?.weeklyCpfr ?? 0);
  const nextActualDo = actualDo !== undefined ? Number(actualDo) : (existing?.actualDo ?? 0);

  db.prepare(`
    INSERT INTO cpfr (alias, week_number, weekly_cpfr, actual_do)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(alias, week_number) DO UPDATE SET weekly_cpfr = excluded.weekly_cpfr, actual_do = excluded.actual_do
  `).run(alias, week, nextWeeklyCpfr, nextActualDo);

  res.json({ ok: true, alias, week, weeklyCpfr: nextWeeklyCpfr, actualDo: nextActualDo, totalCpfr: nextWeeklyCpfr - nextActualDo });
});

export default router;
