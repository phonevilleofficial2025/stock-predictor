import { Router } from 'express';
import { pool } from '../db.js';
import { computeBalanceTable } from '../lib/balanceTable.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

router.get('/months', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM months ORDER BY month');
  res.json(rows);
}));

router.post('/months', asyncHandler(async (req, res) => {
  const { month, label } = req.body;
  if (!month) return res.status(400).json({ error: 'month is required (e.g. "2026-09")' });
  await pool.query('INSERT INTO months (month, label) VALUES ($1, $2) ON CONFLICT (month) DO NOTHING', [month, label || month]);
  res.json({ ok: true });
}));

router.get('/balance', asyncHandler(async (req, res) => {
  res.json(await computeBalanceTable());
}));

router.put('/balance', asyncHandler(async (req, res) => {
  const { alias, month, monthBalance } = req.body;
  if (!alias || !month) return res.status(400).json({ error: 'alias and month are required' });

  await pool.query(`
    INSERT INTO balance (alias, month, month_balance)
    VALUES ($1, $2, $3)
    ON CONFLICT(alias, month) DO UPDATE SET month_balance = excluded.month_balance
  `, [alias, month, Number(monthBalance) || 0]);

  res.json({ ok: true });
}));

export default router;
