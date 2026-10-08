import { Router } from 'express';
import { db } from '../db.js';
import { getAliasMetrics } from '../lib/aliasMetrics.js';

const router = Router();

// Fields the CPFR sheet tracks that no upload feed populates — the "full replica"
// columns from the CPFR simulation workbook export (pricing, cost, promo copy, a
// sell-through target, the on-hand "system vs. unserved" split, a cumulative Actual
// DO, and two placeholder SA score columns the source workbook itself left blank).
// Plans by alias (every color of a given spec combined), the same unit the rest of
// CPFR plans in. Keyed here so the PUT route only ever writes a column this
// allow-list names.
const FIELD_TO_COLUMN = {
  regularSrp: 'regular_srp',
  promoSrp: 'promo_srp',
  cost: 'cost',
  promoText: 'promo_text',
  sw: 'sw',
  saScoreSes: 'sa_score_ses',
  saScoreMb: 'sa_score_mb',
  stocksSnapshot: 'stocks_snapshot',
  systemQty: 'system_qty',
  unservedQty: 'unserved_qty',
  actualDoCumulative: 'actual_do_cumulative',
};
const TEXT_FIELDS = new Set(['promoText']);

router.get('/device-master', (req, res) => {
  const { aliases } = getAliasMetrics();
  const masterByAlias = new Map(
    db.prepare('SELECT * FROM device_master').all().map((r) => [r.alias, r]),
  );

  const rows = Array.from(aliases.keys()).map((alias) => {
    const m = masterByAlias.get(alias);
    return {
      alias,
      regularSrp: m?.regular_srp ?? 0,
      promoSrp: m?.promo_srp ?? 0,
      cost: m?.cost ?? 0,
      promoText: m?.promo_text ?? '',
      sw: m?.sw ?? 0,
      saScoreSes: m?.sa_score_ses ?? 0,
      saScoreMb: m?.sa_score_mb ?? 0,
      stocksSnapshot: m?.stocks_snapshot ?? 0,
      systemQty: m?.system_qty ?? 0,
      unservedQty: m?.unserved_qty ?? 0,
      actualDoCumulative: m?.actual_do_cumulative ?? 0,
    };
  }).sort((a, b) => a.alias.localeCompare(b.alias));

  res.json({ rows });
});

router.put('/device-master', (req, res) => {
  const { alias, field, value } = req.body;
  if (!alias || !field) return res.status(400).json({ error: 'alias and field are required' });
  const column = FIELD_TO_COLUMN[field];
  if (!column) return res.status(400).json({ error: `Unknown field: ${field}` });

  const nextValue = TEXT_FIELDS.has(field) ? String(value ?? '') : Number(value) || 0;

  db.prepare(`
    INSERT INTO device_master (alias, ${column})
    VALUES (?, ?)
    ON CONFLICT(alias) DO UPDATE SET ${column} = excluded.${column}
  `).run(alias, nextValue);

  res.json({ ok: true, alias, field, value: nextValue });
});

export default router;
