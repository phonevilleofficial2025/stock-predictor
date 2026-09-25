import { Router } from 'express';
import { db } from '../db.js';
import { computeBalanceTable } from '../lib/balanceTable.js';
import { getItemDescMaps } from '../lib/itemDesc.js';

const router = Router();

router.get('/months', (req, res) => {
  res.json(db.prepare('SELECT * FROM months ORDER BY month').all());
});

router.post('/months', (req, res) => {
  const { month, label } = req.body;
  if (!month) return res.status(400).json({ error: 'month is required (e.g. "2026-09")' });
  db.prepare('INSERT OR IGNORE INTO months (month, label) VALUES (?, ?)').run(month, label || month);
  res.json({ ok: true });
});

router.get('/balance', (req, res) => {
  res.json(computeBalanceTable());
});

router.put('/balance', (req, res) => {
  const { itemDesc, month, monthBalance } = req.body;
  if (!itemDesc || !month) return res.status(400).json({ error: 'itemDesc and month are required' });

  const { toDeviceModel } = getItemDescMaps();
  const deviceModel = toDeviceModel.get(itemDesc) || itemDesc;

  db.prepare(`
    INSERT INTO balance (device_model, month, month_balance)
    VALUES (?, ?, ?)
    ON CONFLICT(device_model, month) DO UPDATE SET month_balance = excluded.month_balance
  `).run(deviceModel, month, Number(monthBalance) || 0);

  res.json({ ok: true });
});

export default router;
