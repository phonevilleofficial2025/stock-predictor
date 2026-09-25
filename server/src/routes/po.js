import { Router } from 'express';
import { db } from '../db.js';
import { computeBalanceTable } from '../lib/balanceTable.js';
import { getItemDescMaps } from '../lib/itemDesc.js';

const router = Router();

// PO page keys off a specific month's Unserved figure (the cumulative value up
// through that month), fetched from the Balance table.
router.get('/po', (req, res) => {
  const { month } = req.query;
  const { months, table } = computeBalanceTable();
  const targetMonth = month || months[months.length - 1]?.month;
  if (!targetMonth) return res.json({ month: null, rows: [] });

  const rows = table.map(({ deviceModel, itemDesc, onHand, isFlagship, category, months: monthRows }) => {
    const row = monthRows.find((m) => m.month === targetMonth);
    const unserved = row?.unserved ?? 0;
    const existing = db.prepare('SELECT hold, replace_qty AS replaceQty FROM product_order WHERE device_model = ? AND month = ?').get(deviceModel, targetMonth);
    const hold = existing?.hold ?? 0;
    const replaceQty = existing?.replaceQty ?? 0;
    return { itemDesc, onHand, isFlagship, category, month: targetMonth, unserved, hold, replaceQty, totalForPo: unserved + hold + replaceQty };
  });

  res.json({ month: targetMonth, availableMonths: months.map((m) => m.month), rows });
});

router.put('/po', (req, res) => {
  const { itemDesc, month, hold, replaceQty } = req.body;
  if (!itemDesc || !month) return res.status(400).json({ error: 'itemDesc and month are required' });

  const { toDeviceModel } = getItemDescMaps();
  const deviceModel = toDeviceModel.get(itemDesc) || itemDesc;

  const existing = db.prepare('SELECT hold, replace_qty AS replaceQty FROM product_order WHERE device_model = ? AND month = ?').get(deviceModel, month);
  const nextHold = hold !== undefined ? Number(hold) : (existing?.hold ?? 0);
  const nextReplace = replaceQty !== undefined ? Number(replaceQty) : (existing?.replaceQty ?? 0);

  db.prepare(`
    INSERT INTO product_order (device_model, month, hold, replace_qty)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(device_model, month) DO UPDATE SET hold = excluded.hold, replace_qty = excluded.replace_qty
  `).run(deviceModel, month, nextHold, nextReplace);

  res.json({ ok: true });
});

export default router;
