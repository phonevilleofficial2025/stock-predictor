import { db } from '../db.js';

// Product Order, Balance, and CPFR key their tables by device_model internally (unchanged,
// so Predictions and RSI warnings — which also read cpfr/products by device_model — stay
// correct), but display and accept the human-readable item description (Stock View's
// "Variant") instead of the raw device/model code. These maps translate between the two
// at the route boundary.
export function getItemDescMaps() {
  const rows = db.prepare(`
    SELECT device_model AS deviceModel, COALESCE(NULLIF(variant_name, ''), device_model) AS itemDesc
    FROM products
    GROUP BY device_model
  `).all();

  const toItemDesc = new Map(rows.map((r) => [r.deviceModel, r.itemDesc]));
  const toDeviceModel = new Map();
  for (const r of rows) {
    if (!toDeviceModel.has(r.itemDesc)) toDeviceModel.set(r.itemDesc, r.deviceModel);
  }
  return { toItemDesc, toDeviceModel };
}
