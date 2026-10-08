import { Router } from 'express';
import { db } from '../db.js';
import { getDeviceMetrics } from '../lib/deviceMetrics.js';
import { aliasKey } from '../lib/alias.js';
import { computeScore, classifyStatus, computeSuggestion, splitSuggestionByVariant } from '../lib/predictions.js';

const router = Router();

// CPFR is now planned per alias (every color of a given spec combined), but
// Dashboard predictions are still per individual device — so an alias's total CPFR
// is split back down across its member devices, proportional to each device's share
// of the alias's recent sell-out (falling back to an even split with no history),
// the same way `splitSuggestionByVariant` already divides a suggested order.
function loadCpfrByDevice(week, devices) {
  const map = new Map();
  if (week === null) return map;
  const cpfrByAlias = new Map();
  for (const r of db.prepare('SELECT alias, weekly_cpfr AS weeklyCpfr, actual_do AS actualDo FROM cpfr WHERE week_number = ?').all(week)) {
    cpfrByAlias.set(r.alias, (cpfrByAlias.get(r.alias) || 0) + (r.weeklyCpfr - r.actualDo));
  }
  if (cpfrByAlias.size === 0) return map;

  const devicesByAlias = new Map();
  for (const d of devices.values()) {
    const alias = aliasKey(d.deviceModel);
    if (!devicesByAlias.has(alias)) devicesByAlias.set(alias, []);
    devicesByAlias.get(alias).push(d);
  }
  for (const [alias, totalCpfr] of cpfrByAlias) {
    const members = devicesByAlias.get(alias);
    if (!members?.length || totalCpfr === 0) continue;
    const totalAvg = members.reduce((s, m) => s + (m.avg2wk || 0), 0);
    if (totalAvg <= 0) {
      const even = totalCpfr / members.length;
      for (const m of members) map.set(m.deviceModel, even);
    } else {
      for (const m of members) map.set(m.deviceModel, totalCpfr * ((m.avg2wk || 0) / totalAvg));
    }
  }
  return map;
}

function loadVariantsByDevice() {
  const map = new Map();
  const rows = db.prepare('SELECT id, sku, variant_name AS variantName, device_model AS deviceModel FROM products').all();
  for (const r of rows) {
    if (!map.has(r.deviceModel)) map.set(r.deviceModel, []);
    map.get(r.deviceModel).push({ id: r.id, sku: r.sku, variantName: r.variantName });
  }
  return map;
}

function loadProductWeekQty(weeks) {
  const map = new Map(); // productId -> { [week]: qty }
  if (weeks.length === 0) return map;
  const placeholders = weeks.map(() => '?').join(',');
  const rows = db.prepare(`SELECT product_id AS productId, week_number AS week, total_qty AS qty FROM sales_weekly WHERE week_number IN (${placeholders})`).all(...weeks);
  for (const r of rows) {
    if (!map.has(r.productId)) map.set(r.productId, {});
    map.get(r.productId)[r.week] = r.qty;
  }
  return map;
}

router.get('/predictions', (req, res) => {
  const { latestWeek, priorWeek, devices } = getDeviceMetrics();
  if (devices.size === 0) return res.json({ latestWeek, priorWeek, predictions: [] });

  const cpfrByDevice = loadCpfrByDevice(latestWeek, devices);
  const variantsByDevice = loadVariantsByDevice();
  const weeks = [latestWeek, priorWeek].filter((w) => w !== null);
  const productWeekQty = loadProductWeekQty(weeks);

  function variantSplitFor(deviceModel, suggestion) {
    const variants = variantsByDevice.get(deviceModel) || [];
    const withAvg = variants.map((v) => {
      const q = (week) => (week === null ? 0 : (productWeekQty.get(v.id)?.[week] || 0));
      return { sku: v.sku, variantName: v.variantName, avg2wk: (q(latestWeek) + q(priorWeek)) / 2 };
    });
    return splitSuggestionByVariant(suggestion, withAvg);
  }

  const predictions = Array.from(devices.values()).map((d) => {
    const totalCpfr = cpfrByDevice.get(d.deviceModel) || 0;
    const estimatedSellout = d.avg2wk * 2;

    const base = computeScore({ onHand: d.onHand, avg2wk: d.avg2wk, totalCpfr: 0 });
    const withCpfr = computeScore({ onHand: d.onHand, avg2wk: d.avg2wk, totalCpfr });
    const status = base.score === null ? null : classifyStatus(base.score, d.isFlagship);
    const statusWithCpfr = withCpfr.score === null ? null : classifyStatus(withCpfr.score, d.isFlagship);
    const suggestion = computeSuggestion({ onHand: d.onHand, avg2wk: d.avg2wk, existingCpfr: totalCpfr, isFlagship: d.isFlagship });

    return {
      deviceModel: d.deviceModel,
      isFlagship: d.isFlagship,
      brand: d.brand,
      onHand: d.onHand,
      avg2wk: d.avg2wk,
      totalCpfr,
      estimatedSellout,
      estimatedOnHand: base.estimatedOnHand,
      score: base.score,
      status,
      estimatedOnHandWithCpfr: withCpfr.estimatedOnHand,
      scoreWithCpfr: withCpfr.score,
      statusWithCpfr,
      suggestion,
      variantSplit: variantSplitFor(d.deviceModel, suggestion),
    };
  });

  res.json({ latestWeek, priorWeek, predictions });
});

export default router;
