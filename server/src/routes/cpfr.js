import { Router } from 'express';
import { db } from '../db.js';
import { getDeviceMetrics } from '../lib/deviceMetrics.js';
import { computeSuggestion } from '../lib/predictions.js';
import { getItemDescMaps } from '../lib/itemDesc.js';

const router = Router();

// Week used for CPFR planning defaults to the latest week with sales data, but can
// be overridden (e.g. planning ahead for a week that has no sales yet).
router.get('/cpfr', (req, res) => {
  const { latestWeek, devices } = getDeviceMetrics();
  const week = req.query.week ? Number(req.query.week) : latestWeek;
  if (week === null || week === undefined) return res.json({ week: null, rows: [] });
  const { toItemDesc } = getItemDescMaps();

  const rows = Array.from(devices.values()).map((d) => {
    const existing = db.prepare('SELECT weekly_cpfr AS weeklyCpfr, actual_do AS actualDo FROM cpfr WHERE device_model = ? AND week_number = ?')
      .get(d.deviceModel, week);
    const weeklyCpfr = existing?.weeklyCpfr ?? 0;
    const actualDo = existing?.actualDo ?? 0;
    const totalCpfr = weeklyCpfr - actualDo;
    const suggestion = computeSuggestion({ onHand: d.onHand, avg2wk: d.avg2wk, existingCpfr: 0, isFlagship: d.isFlagship });

    return {
      itemDesc: toItemDesc.get(d.deviceModel) || d.deviceModel,
      isFlagship: d.isFlagship,
      category: d.category,
      onHand: d.onHand,
      avg2wk: d.avg2wk,
      weeklyCpfr,
      suggestion,
      actualDo,
      totalCpfr,
    };
  }).sort((a, b) => a.itemDesc.localeCompare(b.itemDesc));

  res.json({ week, rows });
});

router.put('/cpfr', (req, res) => {
  const { itemDesc, week, weeklyCpfr, actualDo } = req.body;
  if (!itemDesc || week === undefined || week === null) {
    return res.status(400).json({ error: 'itemDesc and week are required' });
  }
  const { toDeviceModel } = getItemDescMaps();
  const deviceModel = toDeviceModel.get(itemDesc) || itemDesc;

  const existing = db.prepare('SELECT weekly_cpfr AS weeklyCpfr, actual_do AS actualDo FROM cpfr WHERE device_model = ? AND week_number = ?')
    .get(deviceModel, week);
  const nextWeeklyCpfr = weeklyCpfr !== undefined ? Number(weeklyCpfr) : (existing?.weeklyCpfr ?? 0);
  const nextActualDo = actualDo !== undefined ? Number(actualDo) : (existing?.actualDo ?? 0);

  db.prepare(`
    INSERT INTO cpfr (device_model, week_number, weekly_cpfr, actual_do)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(device_model, week_number) DO UPDATE SET weekly_cpfr = excluded.weekly_cpfr, actual_do = excluded.actual_do
  `).run(deviceModel, week, nextWeeklyCpfr, nextActualDo);

  res.json({ ok: true, itemDesc, week, weeklyCpfr: nextWeeklyCpfr, actualDo: nextActualDo, totalCpfr: nextWeeklyCpfr - nextActualDo });
});

export default router;
