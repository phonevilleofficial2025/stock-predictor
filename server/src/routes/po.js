import { Router } from 'express';
import { db } from '../db.js';
import { computeBalanceTable } from '../lib/balanceTable.js';

const router = Router();

// PO page keys off a specific month's Unserved figure (the cumulative value up
// through that month), fetched from the Balance table. Hold/Replace/Replace 2/
// Replace 4 are the four replacement-tier quantities from the CPFR simulation
// workbook's Product Order block. Plans by alias (every color of a given spec
// combined) — the same unit Balance and the CPFR sheet itself plan in.
// Every tracked month's Product Order block at once (Hold/Replace/Replace 2/
// Replace 4/Total for PO per month, side by side) — mirrors how /balance already
// returns every month, since the CPFR sheet no longer has a single-month picker.
router.get('/po/all', (req, res) => {
  const { months, table } = computeBalanceTable();

  const rows = table.map(({ alias, onHand, isFlagship, category, months: monthRows }) => {
    const poMonths = monthRows.map((mr) => {
      const existing = db.prepare('SELECT hold, replace_qty AS replaceQty, replace2_qty AS replace2Qty, replace4_qty AS replace4Qty FROM product_order WHERE alias = ? AND month = ?').get(alias, mr.month);
      const hold = existing?.hold ?? 0;
      const replaceQty = existing?.replaceQty ?? 0;
      const replace2Qty = existing?.replace2Qty ?? 0;
      const replace4Qty = existing?.replace4Qty ?? 0;
      return {
        month: mr.month, label: mr.label, unserved: mr.unserved,
        hold, replaceQty, replace2Qty, replace4Qty,
        totalForPo: mr.unserved + hold + replaceQty + replace2Qty + replace4Qty,
      };
    });
    return { alias, onHand, isFlagship, category, months: poMonths };
  });

  res.json({ months: months.map((m) => m.month), rows });
});

router.get('/po', (req, res) => {
  const { month } = req.query;
  const { months, table } = computeBalanceTable();
  const targetMonth = month || months[months.length - 1]?.month;
  if (!targetMonth) return res.json({ month: null, rows: [] });

  const rows = table.map(({ alias, onHand, isFlagship, category, months: monthRows }) => {
    const row = monthRows.find((m) => m.month === targetMonth);
    const unserved = row?.unserved ?? 0;
    const existing = db.prepare('SELECT hold, replace_qty AS replaceQty, replace2_qty AS replace2Qty, replace4_qty AS replace4Qty FROM product_order WHERE alias = ? AND month = ?').get(alias, targetMonth);
    const hold = existing?.hold ?? 0;
    const replaceQty = existing?.replaceQty ?? 0;
    const replace2Qty = existing?.replace2Qty ?? 0;
    const replace4Qty = existing?.replace4Qty ?? 0;
    return {
      alias, onHand, isFlagship, category, month: targetMonth, unserved,
      hold, replaceQty, replace2Qty, replace4Qty,
      totalForPo: unserved + hold + replaceQty + replace2Qty + replace4Qty,
    };
  });

  res.json({ month: targetMonth, availableMonths: months.map((m) => m.month), rows });
});

router.put('/po', (req, res) => {
  const { alias, month, hold, replaceQty, replace2Qty, replace4Qty } = req.body;
  if (!alias || !month) return res.status(400).json({ error: 'alias and month are required' });

  const existing = db.prepare('SELECT hold, replace_qty AS replaceQty, replace2_qty AS replace2Qty, replace4_qty AS replace4Qty FROM product_order WHERE alias = ? AND month = ?').get(alias, month);
  const nextHold = hold !== undefined ? Number(hold) : (existing?.hold ?? 0);
  const nextReplace = replaceQty !== undefined ? Number(replaceQty) : (existing?.replaceQty ?? 0);
  const nextReplace2 = replace2Qty !== undefined ? Number(replace2Qty) : (existing?.replace2Qty ?? 0);
  const nextReplace4 = replace4Qty !== undefined ? Number(replace4Qty) : (existing?.replace4Qty ?? 0);

  db.prepare(`
    INSERT INTO product_order (alias, month, hold, replace_qty, replace2_qty, replace4_qty)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(alias, month) DO UPDATE SET hold = excluded.hold, replace_qty = excluded.replace_qty,
      replace2_qty = excluded.replace2_qty, replace4_qty = excluded.replace4_qty
  `).run(alias, month, nextHold, nextReplace, nextReplace2, nextReplace4);

  res.json({ ok: true, hold: nextHold, replaceQty: nextReplace, replace2Qty: nextReplace2, replace4Qty: nextReplace4 });
});

export default router;
