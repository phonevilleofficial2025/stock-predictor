import { getDeviceMetrics } from './deviceMetrics.js';
import { aliasKey } from './alias.js';

// CPFR plans at the alias level (e.g. "Galaxy A07 LTE (4+128GB)"), not per individual
// color/SKU — the whole point of an alias is that you forecast one number for the
// family rather than one per color. This groups the per-device metrics that already
// drive Dashboard/RSI/Stock View by alias: On Hand sums directly, isFlagship is true
// if any member is flagged, and avg2wk sums too — valid because avg2wk is itself
// (week1+week2)/2 for each device, and summing averages over the *same* two weeks
// equals the average of the summed weeks ((Σweek1 + Σweek2)/2), not an approximation.
export function getAliasMetrics() {
  const { latestWeek, priorWeek, devices } = getDeviceMetrics();

  const aliases = new Map(); // alias -> { alias, isFlagship, category, brand, onHand, avg2wk, memberDeviceModels: [] }
  for (const d of devices.values()) {
    const alias = aliasKey(d.deviceModel);
    if (!aliases.has(alias)) {
      aliases.set(alias, {
        alias, isFlagship: false, category: null, brand: null, onHand: 0, avg2wk: 0, memberDeviceModels: [],
      });
    }
    const a = aliases.get(alias);
    a.onHand += d.onHand;
    a.avg2wk += d.avg2wk;
    if (d.isFlagship) a.isFlagship = true;
    if (!a.category && d.category) a.category = d.category;
    if (!a.brand && d.brand) a.brand = d.brand;
    a.memberDeviceModels.push(d.deviceModel);
  }

  return { latestWeek, priorWeek, aliases };
}
