import { Router } from 'express';
import { db } from '../db.js';
import { computeBalanceTable } from '../lib/balanceTable.js';

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
  const { alias, month, monthBalance } = req.body;
  if (!alias || !month) return res.status(400).json({ error: 'alias and month are required' });

  db.prepare(`
    INSERT INTO balance (alias, month, month_balance)
    VALUES (?, ?, ?)
    ON CONFLICT(alias, month) DO UPDATE SET month_balance = excluded.month_balance
  `).run(alias, month, Number(monthBalance) || 0);

  res.json({ ok: true });
});

export default router;
