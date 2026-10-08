import { CL } from '../components/excel/engine.js';
import { formatWeekNumber } from './week.js';

// Builds the single-sheet workbook the CPFR page feeds into the spreadsheet engine
// (components/excel/engine.js) — a full replica of every column/section in the
// source CPFR simulation workbook export, laid out left-to-right in the same order,
// generalized to work for any number of aliases/weeks/months instead of one fixed
// June-2026 snapshot. Each `rows` entry is one alias (every color/SKU sharing a
// Device Model prefix, combined — see server/src/lib/alias.js), not one individual
// product — CPFR plans one number per family, same as the source workbook:
//   - Columns backed by real data (On Hand, weekly sell-out, CPFR, Balance, Product
//     Order) are live formulas, same as before.
//   - Columns the template computed from a second data source we don't have (P4 = a
//     4-week rolling average, parallel to the existing 2-week "P2" average) are real
//     formulas too — they only needed more weekly history, which we already track.
//   - Columns with no data source at all in this app (pricing, cost, promo copy, a
//     sell-through target, the on-hand "system vs. unserved" split, a cumulative
//     Actual DO, two placeholder SA scores the source workbook itself left blank)
//     are plain editable cells backed by the new `device_master` table — exactly
//     the "manual entry, no automation behind it" columns from the template.
//   - The template's one-off literal overrides (e.g. a single row's "=1809-655") and
//     its decorative summary/ratio rows (Active vs. Inactive model counts, the title
//     rows) aren't reproduced — they were snapshot artifacts for that one export, not
//     formulas that generalize to a live, growing sheet.
//
// Style indices (shared `STYLES` array below):
const HEADER = 0;
const TEXT_STICKY = 1;
const NUM_STICKY = 2;
const NUM_PLAIN = 3;
const NUM_EDITABLE = 4;
const NUM_SCORE = 5;
const NUM_SUGGESTION = 6;
const STATUS_HEALTHY = 7;
const STATUS_MODERATE = 8;
const STATUS_CRITICAL = 9;
const STATUS_NEUTRAL = 10;
const TOTAL_ROW_NUM = 11;
const TOTAL_ROW_LABEL = 12;
const TEXT_EDITABLE = 13;

const STYLES = [
  { css: 'background:#002060;color:#fff;font-weight:700;text-align:center;white-space:pre-line;vertical-align:middle', nf: 'General' }, // HEADER
  { css: 'text-align:left;font-weight:500;padding-left:6px', nf: 'General' }, // TEXT_STICKY
  { css: 'text-align:right;font-weight:600', nf: '#,##0' }, // NUM_STICKY
  { css: 'text-align:right', nf: '#,##0' }, // NUM_PLAIN
  { css: 'background:#fef3c7;color:#78350f;text-align:right;font-weight:600', darkCss: 'background:#78350f;color:#fef3c7', nf: '#,##0' }, // NUM_EDITABLE
  { css: 'text-align:right', nf: '#,##0.00' }, // NUM_SCORE
  { css: 'text-align:right;font-style:italic;opacity:.65', nf: '#,##0' }, // NUM_SUGGESTION
  { css: 'background:#dcfce7;color:#166534;font-weight:700;text-align:center', darkCss: 'background:#14532d;color:#bbf7d0', nf: 'General' }, // STATUS_HEALTHY
  { css: 'background:#fef9c3;color:#854d0e;font-weight:700;text-align:center', darkCss: 'background:#713f12;color:#fef08a', nf: 'General' }, // STATUS_MODERATE
  { css: 'background:#fee2e2;color:#991b1b;font-weight:700;text-align:center', darkCss: 'background:#7f1d1d;color:#fecaca', nf: 'General' }, // STATUS_CRITICAL
  { css: 'text-align:center;opacity:.5', nf: 'General' }, // STATUS_NEUTRAL
  { css: 'font-weight:700;text-align:right;border-top:2px solid #002060;background:rgba(99,102,241,.08)', darkCss: 'background:rgba(99,102,241,.18)', nf: '#,##0' }, // TOTAL_ROW_NUM
  { css: 'font-weight:700;border-top:2px solid #002060;background:rgba(99,102,241,.08)', darkCss: 'background:rgba(99,102,241,.18)', nf: 'General' }, // TOTAL_ROW_LABEL
  { css: 'background:#fef3c7;color:#78350f;text-align:left;padding-left:4px', darkCss: 'background:#78350f;color:#fef3c7', nf: 'General' }, // TEXT_EDITABLE
];

const STATUS_STYLE_MAP = { Healthy: STATUS_HEALTHY, Moderate: STATUS_MODERATE, Critical: STATUS_CRITICAL };

const addr = (col, row) => `${CL(col)}${row}`;
const hrange = (col1, col2, row) => `${CL(col1)}${row}:${CL(col2)}${row}`;

function statusFormula(scoreCol, row, isFlagship, fallback = '""') {
  const score = addr(scoreCol, row);
  const branch = isFlagship
    ? `IF(${score}>=4,"Healthy","Critical")`
    : `IF(${score}>8,"Healthy",IF(${score}<=4,"Critical","Moderate"))`;
  return fallback === '""' ? `=IF(${score}="","",${branch})` : `=${branch}`;
}

// `weeks` — the current year's full week range (plus any out-of-range week that has
// actual sell-out data), driving the Weekly Sell-Out columns, the Avg 2-Wk/P2
// average, and the P4 (4-week) rolling average.
// `cpfrWeeks` — same full-year range, unioned with any week that has a CPFR entry.
// `latestDataWeek` — the most recent week with real data (a sales upload or a CPFR
// entry), if any. The Weekly Sell-Out and CPFR windows open scrolled to this by
// default instead of week 1, so opening the sheet lands on your last upload instead
// of a year of empty placeholder weeks.
// `selectedMonth` — which tracked month's Balance & PO columns to show (a "2026-03"
// string). Unlike the weekly sections, Balance & PO doesn't scroll through every
// month side by side — it shows one month's 8 columns with a dropdown in the header
// to switch, defaulting to the most recent month if the given one isn't found.
export function buildCpfrWorkbook({ rows, weeks, cpfrWeeks, months, latestDataWeek, selectedMonth }) {
  // --- 1. assign every column's position, left to right, matching the template ---
  const cols = [];
  let col = 0;
  const addCol = (width) => { col += 1; cols.push(width); return col; };

  const ITEM = addCol(230);
  const ONHAND = addCol(70);
  const REGULAR_SRP = addCol(76);
  const PROMO_SRP = addCol(76);
  const weekCols = weeks.map(() => addCol(58));
  const AVG = addCol(68);
  const EST_SELLOUT = addCol(78);
  const EST_ONHAND = addCol(78);
  const SCORE = addCol(64);
  const STATUS = addCol(92);
  const SUGGESTION = addCol(78);
  const ACTUAL_DO_CUM = addCol(80);
  const cpfrWeekCols = cpfrWeeks.map(() => ({ cpfr: addCol(70) }));
  const TOTAL_CPFR = addCol(92);
  // Balance and Product Order (Hold/Replace/Replace 2/Replace 4/Total for PO) are
  // both month-keyed and share one column group — but unlike the weekly sections,
  // only one month's worth is on the sheet at a time (switched via a dropdown in the
  // header), not every month side by side, since the Balance/PO columns are much
  // wider per-month than a single week column and scrolling 12 of them was worse
  // than just picking one.
  const selectedMonthObj = months.length ? (months.find((m) => m.month === selectedMonth) || months[months.length - 1]) : null;
  const monthCols = selectedMonthObj ? {
    totalCpfr: addCol(86), balance: addCol(86), unserved: addCol(86),
    hold: addCol(76), replace: addCol(76), replace2: addCol(76), replace4: addCol(76), poTotal: addCol(88),
  } : null;
  const STOCKS = addCol(80);
  // WOS based on on-hand stocks (P4 = 4-week avg, P2 = the existing 2-week avg)
  const P4_SELLOUT = addCol(72);
  const P2_SELLOUT = addCol(72);
  const EST_JUNE_SO_P4 = addCol(84);
  const EST_JUNE_SO_P2 = addCol(84);
  const EOH_P4 = addCol(80);
  const EOH_P2 = addCol(80);
  const WOS_P4 = addCol(90);
  const WOS_P2 = addCol(90);
  // "<Month> SIMUL" — same projection, assuming the Product Order's incoming qty arrives
  const ONHAND_PLUS_PO = addCol(86);
  const EST_SO_P4_REF = addCol(84);
  const EST_SO_P2_REF = addCol(84);
  const EOH_SIMUL_P4 = addCol(80);
  const EOH_SIMUL_P2 = addCol(80);
  const WOS_SIMUL_P4 = addCol(90);
  const WOS_SIMUL_P2 = addCol(92);
  // Sell-through target / placeholder scores
  const SW = addCol(60);
  const MIN_SW = addCol(72);
  const SA_SCORE_SES = addCol(84);
  const SA_SCORE_MB = addCol(84);
  const PROMOS = addCol(260);
  // Cost / inventory valuation
  const COST = addCol(80);
  const INVENTORY_IN_SYSTEM = addCol(92);
  const IN_TRANSIT = addCol(92);
  const EST_TOTAL_INVENTORY = addCol(92);
  // "Based on cost" peso valuations of the quantity columns above
  const ACTUAL_DO_PESO = addCol(92);
  const TOTAL_CPFR_PESO = addCol(92);
  const MAY_BALANCE_PESO = addCol(92);
  const TOTAL_UNSERVED_PESO = addCol(92);
  const HOLD_PESO = addCol(88);
  const REPLACEMENT1_PESO = addCol(92);
  const REPLACEMENT2_PESO = addCol(92);
  const REPLACEMENT4_PESO = addCol(92);
  const TOTAL_PO_AMOUNT_PESO = addCol(96);
  const TOTAL_EST_SELLIN_PESO = addCol(100);
  // On Hand snapshot: system vs. unserved split + its peso/SRP valuation
  const SYSTEM_QTY = addCol(80);
  const UNSERVED_QTY = addCol(80);
  const BASED_ON_COST = addCol(96);
  const BASED_ON_SRP = addCol(96);
  const maxc = col;

  const HEADER_ROW = 1;
  const SUBHEADER_ROW = 2;
  const DATA_START = 3;
  const DATA_END = DATA_START + rows.length - 1;
  const TOTAL_ROW = DATA_END + 1;
  const maxr = TOTAL_ROW;

  const cells = [];
  const merges = [];
  const put = (r, c, v, f, st, extra) => cells.push([r, c, v, f || 0, st, extra?.editable, extra?.field, extra?.styleMap, extra?.dropdown]);
  const group = (c1, c2, label) => { merges.push([HEADER_ROW, c1, HEADER_ROW, c2]); put(HEADER_ROW, c1, label, 0, HEADER); };
  // Like `group`, but the header cell is a live <select> instead of static text —
  // e.g. Balance & PO's month picker.
  const groupSelect = (c1, c2, label, dropdown) => { merges.push([HEADER_ROW, c1, HEADER_ROW, c2]); put(HEADER_ROW, c1, label, 0, HEADER, { dropdown }); };
  const span2 = (c, label) => { merges.push([HEADER_ROW, c, SUBHEADER_ROW, c]); put(HEADER_ROW, c, label, 0, HEADER); };
  const sub = (c, label) => put(SUBHEADER_ROW, c, label, 0, HEADER);

  // --- 2. headers ---
  span2(ITEM, 'Alias');
  span2(ONHAND, 'On Hand');
  span2(REGULAR_SRP, 'Regular\nSRP');
  span2(PROMO_SRP, 'Promo\nSRP');

  if (weekCols.length) {
    group(weekCols[0], weekCols[weekCols.length - 1], 'WEEKLY SELL-OUT');
    weeks.forEach((w, i) => sub(weekCols[i], formatWeekNumber(w)));
  }

  span2(AVG, 'Avg 2-Wk');
  group(EST_SELLOUT, STATUS, 'PREDICTION (NO CPFR)');
  sub(EST_SELLOUT, 'Est. Sellout'); sub(EST_ONHAND, 'Est. On Hand'); sub(SCORE, 'Score'); sub(STATUS, 'Status');
  span2(SUGGESTION, 'Suggestion');
  span2(ACTUAL_DO_CUM, 'Actual\nDO');

  if (cpfrWeekCols.length) {
    group(cpfrWeekCols[0].cpfr, cpfrWeekCols[cpfrWeekCols.length - 1].cpfr, 'CPFR');
    cpfrWeeks.forEach((w, i) => sub(cpfrWeekCols[i].cpfr, `${formatWeekNumber(w)}\nCPFR`));
  }
  span2(TOTAL_CPFR, 'TOTAL\nCPFR');

  if (monthCols) {
    groupSelect(monthCols.totalCpfr, monthCols.poTotal, `${selectedMonthObj.label} Balance & PO`, {
      options: months.map((m) => ({ value: m.month, label: m.label })),
      value: selectedMonthObj.month,
      suffix: 'Balance & PO',
      field: { kind: 'selectMonth' },
    });
    sub(monthCols.totalCpfr, 'Total CPFR'); sub(monthCols.balance, 'Balance'); sub(monthCols.unserved, 'Unserved');
    sub(monthCols.hold, 'Hold'); sub(monthCols.replace, 'Replace'); sub(monthCols.replace2, 'Replace 2'); sub(monthCols.replace4, 'Replace 4'); sub(monthCols.poTotal, 'Total for PO');
  }
  span2(STOCKS, 'Stocks');

  group(P4_SELLOUT, WOS_P2, 'WOS BASED ON ON HAND STOCKS');
  sub(P4_SELLOUT, 'P4 Sell Out'); sub(P2_SELLOUT, 'P2 Sell Out');
  sub(EST_JUNE_SO_P4, 'Est. SO P4'); sub(EST_JUNE_SO_P2, 'Est. SO P2');
  sub(EOH_P4, 'EOH P4'); sub(EOH_P2, 'EOH P2'); sub(WOS_P4, 'End WOS P4'); sub(WOS_P2, 'End WOS P2');

  group(ONHAND_PLUS_PO, WOS_SIMUL_P2, 'SIMULATION (AFTER PO)');
  sub(ONHAND_PLUS_PO, 'On Hand\n+ PO'); sub(EST_SO_P4_REF, 'Est S/O\nP4'); sub(EST_SO_P2_REF, 'Est S/O\nP2');
  sub(EOH_SIMUL_P4, 'EOH\nP4'); sub(EOH_SIMUL_P2, 'EOH\nP2'); sub(WOS_SIMUL_P4, 'EOH WOS\nP4'); sub(WOS_SIMUL_P2, 'EOH WOS\nP2');

  span2(SW, 'SW'); span2(MIN_SW, 'Min SW'); span2(SA_SCORE_SES, 'SA Score\nSES'); span2(SA_SCORE_MB, 'SA Score\nMB');
  span2(PROMOS, 'Promos');
  span2(COST, 'Cost');
  group(INVENTORY_IN_SYSTEM, EST_TOTAL_INVENTORY, 'INVENTORY VALUE');
  sub(INVENTORY_IN_SYSTEM, 'Inventory\nin System'); sub(IN_TRANSIT, 'In Transit'); sub(EST_TOTAL_INVENTORY, 'Est. Total\nInventory');

  group(ACTUAL_DO_PESO, TOTAL_EST_SELLIN_PESO, 'BASED ON COST');
  sub(ACTUAL_DO_PESO, 'Actual DO'); sub(TOTAL_CPFR_PESO, 'Total CPFR'); sub(MAY_BALANCE_PESO, 'Balance');
  sub(TOTAL_UNSERVED_PESO, 'Total\nUnserved'); sub(HOLD_PESO, 'Hold');
  sub(REPLACEMENT1_PESO, 'Replacement 1'); sub(REPLACEMENT2_PESO, 'Replacement 2'); sub(REPLACEMENT4_PESO, 'Replacement 4');
  sub(TOTAL_PO_AMOUNT_PESO, 'Total PO\nAmount'); sub(TOTAL_EST_SELLIN_PESO, 'Total Est.\nSell-In');

  group(SYSTEM_QTY, BASED_ON_SRP, 'ON HAND — SYSTEM / UNSERVED');
  sub(SYSTEM_QTY, 'System'); sub(UNSERVED_QTY, 'Unserved'); sub(BASED_ON_COST, 'Based on\nCost'); sub(BASED_ON_SRP, 'Based on\nSRP');

  // --- 3. data rows ---
  rows.forEach((r, i) => {
    const row = DATA_START + i;
    const dm = r.deviceMaster || {};

    put(row, ITEM, r.isFlagship ? `${r.alias} ★` : r.alias, 0, TEXT_STICKY);
    put(row, ONHAND, r.onHand, 0, NUM_STICKY);
    put(row, REGULAR_SRP, dm.regularSrp || 0, 0, NUM_EDITABLE, { editable: true, field: { kind: 'deviceMaster', alias: r.alias, field: 'regularSrp' } });
    put(row, PROMO_SRP, dm.promoSrp || 0, 0, NUM_EDITABLE, { editable: true, field: { kind: 'deviceMaster', alias: r.alias, field: 'promoSrp' } });

    weeks.forEach((w, wi) => put(row, weekCols[wi], r.weeks[w] ?? 0, 0, NUM_PLAIN));

    if (weeks.length >= 2) {
      put(row, AVG, null, `=AVERAGE(${hrange(weekCols[weekCols.length - 2], weekCols[weekCols.length - 1], row)})`, NUM_SCORE);
    } else if (weeks.length === 1) {
      put(row, AVG, null, `=AVERAGE(${addr(weekCols[0], row)})`, NUM_SCORE);
    } else {
      put(row, AVG, 0, 0, NUM_SCORE);
    }
    put(row, EST_SELLOUT, null, `=${addr(AVG, row)}*2`, NUM_PLAIN);
    put(row, EST_ONHAND, null, `=${addr(ONHAND, row)}-${addr(EST_SELLOUT, row)}`, NUM_PLAIN);
    put(row, SCORE, null, `=IFERROR(${addr(EST_ONHAND, row)}/${addr(AVG, row)},"")`, NUM_SCORE);
    put(row, STATUS, null, statusFormula(SCORE, row, r.isFlagship), STATUS_NEUTRAL, { styleMap: STATUS_STYLE_MAP });
    put(row, SUGGESTION, r.suggestion, 0, NUM_SUGGESTION);
    put(row, ACTUAL_DO_CUM, dm.actualDoCumulative || 0, 0, NUM_EDITABLE, { editable: true, field: { kind: 'deviceMaster', alias: r.alias, field: 'actualDoCumulative' } });

    cpfrWeeks.forEach((w, wi) => {
      const wc = cpfrWeekCols[wi];
      const entry = r.cpfrByWeek[w] || { weeklyCpfr: 0 };
      put(row, wc.cpfr, entry.weeklyCpfr, 0, NUM_EDITABLE, { editable: true, field: { kind: 'cpfr', field: 'weeklyCpfr', alias: r.alias, week: w } });
    });
    // Total CPFR = sum of every week's CPFR minus the cumulative Actual DO column
    // (both already summary columns — no need for a per-week DO/Total breakdown).
    const cpfrSum = cpfrWeekCols.length ? `SUM(${cpfrWeekCols.map((wc) => addr(wc.cpfr, row)).join(',')})` : '0';
    put(row, TOTAL_CPFR, null, `=${cpfrSum}-${addr(ACTUAL_DO_CUM, row)}`, NUM_PLAIN);

    if (monthCols) {
      const mRow = r.months.find((mm) => mm.month === selectedMonthObj.month) || { totalCpfr: 0, monthBalance: 0, unserved: 0 };
      put(row, monthCols.totalCpfr, mRow.totalCpfr, 0, NUM_PLAIN);
      put(row, monthCols.balance, mRow.monthBalance, 0, NUM_EDITABLE, { editable: true, field: { kind: 'balance', alias: r.alias, month: selectedMonthObj.month } });
      // Unserved is a running cumulative total across every month up through this
      // one — precomputed server-side (and recomputed locally right after an edit),
      // since with only one month's columns on the sheet there's no earlier month's
      // cell left to chain a live formula off of the way the old all-months-at-once
      // layout could.
      put(row, monthCols.unserved, mRow.unserved, 0, NUM_PLAIN);

      const po = r.poByMonth[selectedMonthObj.month] || { hold: 0, replaceQty: 0, replace2Qty: 0, replace4Qty: 0 };
      put(row, monthCols.hold, po.hold, 0, NUM_EDITABLE, { editable: true, field: { kind: 'po', alias: r.alias, month: selectedMonthObj.month, field: 'hold' } });
      put(row, monthCols.replace, po.replaceQty, 0, NUM_EDITABLE, { editable: true, field: { kind: 'po', alias: r.alias, month: selectedMonthObj.month, field: 'replaceQty' } });
      put(row, monthCols.replace2, po.replace2Qty, 0, NUM_EDITABLE, { editable: true, field: { kind: 'po', alias: r.alias, month: selectedMonthObj.month, field: 'replace2Qty' } });
      put(row, monthCols.replace4, po.replace4Qty, 0, NUM_EDITABLE, { editable: true, field: { kind: 'po', alias: r.alias, month: selectedMonthObj.month, field: 'replace4Qty' } });
      put(row, monthCols.poTotal, null, `=${addr(monthCols.unserved, row)}+${addr(monthCols.hold, row)}+${addr(monthCols.replace, row)}+${addr(monthCols.replace2, row)}+${addr(monthCols.replace4, row)}`, NUM_PLAIN);
    }
    // Columns further right (WOS simulation, peso valuations) key off the selected
    // month's PO figures — same "most forward-looking month" the sheet used back
    // when there was a single Balance/PO month picker.
    const lastHold = monthCols ? addr(monthCols.hold, row) : '0';
    const lastReplace = monthCols ? addr(monthCols.replace, row) : '0';
    const lastReplace2 = monthCols ? addr(monthCols.replace2, row) : '0';
    const lastReplace4 = monthCols ? addr(monthCols.replace4, row) : '0';
    const lastPoTotal = monthCols ? addr(monthCols.poTotal, row) : '0';
    put(row, STOCKS, dm.stocksSnapshot || 0, 0, NUM_EDITABLE, { editable: true, field: { kind: 'deviceMaster', alias: r.alias, field: 'stocksSnapshot' } });

    // WOS based on on-hand stocks
    if (weeks.length >= 4) {
      put(row, P4_SELLOUT, null, `=AVERAGE(${hrange(weekCols[weekCols.length - 4], weekCols[weekCols.length - 1], row)})`, NUM_SCORE);
    } else if (weeks.length) {
      put(row, P4_SELLOUT, null, `=AVERAGE(${hrange(weekCols[0], weekCols[weekCols.length - 1], row)})`, NUM_SCORE);
    } else {
      put(row, P4_SELLOUT, 0, 0, NUM_SCORE);
    }
    put(row, P2_SELLOUT, null, `=${addr(AVG, row)}`, NUM_SCORE);
    put(row, EST_JUNE_SO_P4, null, `=${addr(P4_SELLOUT, row)}*2`, NUM_PLAIN);
    put(row, EST_JUNE_SO_P2, null, `=${addr(P2_SELLOUT, row)}*2`, NUM_PLAIN);
    put(row, EOH_P4, null, `=${addr(ONHAND, row)}-${addr(EST_JUNE_SO_P4, row)}`, NUM_PLAIN);
    put(row, EOH_P2, null, `=${addr(ONHAND, row)}-${addr(EST_JUNE_SO_P2, row)}`, NUM_PLAIN);
    put(row, WOS_P4, null, `=IFERROR(${addr(EOH_P4, row)}/${addr(P4_SELLOUT, row)},0)`, NUM_SCORE);
    put(row, WOS_P2, null, `=IFERROR(${addr(EOH_P2, row)}/${addr(P2_SELLOUT, row)},0)`, NUM_SCORE);

    // Simulation after the incoming PO arrives
    put(row, ONHAND_PLUS_PO, null, `=${addr(ONHAND, row)}+${lastPoTotal}`, NUM_PLAIN);
    put(row, EST_SO_P4_REF, null, `=${addr(EST_JUNE_SO_P4, row)}`, NUM_PLAIN);
    put(row, EST_SO_P2_REF, null, `=${addr(EST_JUNE_SO_P2, row)}`, NUM_PLAIN);
    put(row, EOH_SIMUL_P4, null, `=${addr(ONHAND_PLUS_PO, row)}-${addr(EST_SO_P4_REF, row)}`, NUM_PLAIN);
    put(row, EOH_SIMUL_P2, null, `=${addr(ONHAND_PLUS_PO, row)}-${addr(EST_SO_P2_REF, row)}`, NUM_PLAIN);
    put(row, WOS_SIMUL_P4, null, `=IFERROR(${addr(EOH_SIMUL_P4, row)}/${addr(P4_SELLOUT, row)},0)`, NUM_SCORE);
    put(row, WOS_SIMUL_P2, null, `=IFERROR(${addr(EOH_SIMUL_P2, row)}/${addr(P2_SELLOUT, row)},0)`, NUM_SCORE);

    put(row, SW, dm.sw || 0, 0, NUM_EDITABLE, { editable: true, field: { kind: 'deviceMaster', alias: r.alias, field: 'sw' } });
    put(row, MIN_SW, null, `=${addr(SW, row)}*140`, NUM_PLAIN);
    put(row, SA_SCORE_SES, dm.saScoreSes || 0, 0, NUM_EDITABLE, { editable: true, field: { kind: 'deviceMaster', alias: r.alias, field: 'saScoreSes' } });
    put(row, SA_SCORE_MB, dm.saScoreMb || 0, 0, NUM_EDITABLE, { editable: true, field: { kind: 'deviceMaster', alias: r.alias, field: 'saScoreMb' } });
    put(row, PROMOS, dm.promoText || '', 0, TEXT_EDITABLE, { editable: true, field: { kind: 'deviceMaster', alias: r.alias, field: 'promoText', type: 'text' } });

    put(row, COST, dm.cost || 0, 0, NUM_EDITABLE, { editable: true, field: { kind: 'deviceMaster', alias: r.alias, field: 'cost' } });
    put(row, INVENTORY_IN_SYSTEM, null, `=${addr(COST, row)}*${addr(SYSTEM_QTY, row)}`, NUM_PLAIN);
    put(row, IN_TRANSIT, null, `=${addr(COST, row)}*${addr(UNSERVED_QTY, row)}`, NUM_PLAIN);
    put(row, EST_TOTAL_INVENTORY, null, `=${addr(INVENTORY_IN_SYSTEM, row)}+${addr(IN_TRANSIT, row)}`, NUM_PLAIN);

    put(row, ACTUAL_DO_PESO, null, `=${addr(COST, row)}*${addr(ACTUAL_DO_CUM, row)}`, NUM_PLAIN);
    put(row, TOTAL_CPFR_PESO, null, `=${addr(COST, row)}*${addr(TOTAL_CPFR, row)}`, NUM_PLAIN);
    put(row, MAY_BALANCE_PESO, null, monthCols ? `=${addr(COST, row)}*${addr(monthCols.balance, row)}` : 0, NUM_PLAIN);
    put(row, TOTAL_UNSERVED_PESO, null, monthCols ? `=${addr(COST, row)}*${addr(monthCols.unserved, row)}` : 0, NUM_PLAIN);
    put(row, HOLD_PESO, null, `=${addr(COST, row)}*${lastHold}`, NUM_PLAIN);
    put(row, REPLACEMENT1_PESO, null, `=${addr(COST, row)}*${lastReplace}`, NUM_PLAIN);
    put(row, REPLACEMENT2_PESO, null, `=${addr(COST, row)}*${lastReplace2}`, NUM_PLAIN);
    put(row, REPLACEMENT4_PESO, null, `=${addr(COST, row)}*${lastReplace4}`, NUM_PLAIN);
    put(row, TOTAL_PO_AMOUNT_PESO, null, `=${addr(COST, row)}*${lastPoTotal}`, NUM_PLAIN);
    put(row, TOTAL_EST_SELLIN_PESO, null, `=${addr(TOTAL_PO_AMOUNT_PESO, row)}+${addr(ACTUAL_DO_PESO, row)}`, NUM_PLAIN);

    put(row, SYSTEM_QTY, dm.systemQty || 0, 0, NUM_EDITABLE, { editable: true, field: { kind: 'deviceMaster', alias: r.alias, field: 'systemQty' } });
    put(row, UNSERVED_QTY, dm.unservedQty || 0, 0, NUM_EDITABLE, { editable: true, field: { kind: 'deviceMaster', alias: r.alias, field: 'unservedQty' } });
    put(row, BASED_ON_COST, null, `=(${addr(SYSTEM_QTY, row)}+${addr(UNSERVED_QTY, row)})*${addr(COST, row)}`, NUM_PLAIN);
    put(row, BASED_ON_SRP, null, `=(${addr(SYSTEM_QTY, row)}+${addr(UNSERVED_QTY, row)})*${addr(REGULAR_SRP, row)}`, NUM_PLAIN);
  });

  // --- 4. TOTAL row — summed for quantity/peso columns, left blank for rates/ratios/text ---
  const sum = (c) => `=SUM(${CL(c)}${DATA_START}:${CL(c)}${DATA_END})`;
  put(TOTAL_ROW, ITEM, 'TOTAL', 0, TOTAL_ROW_LABEL);
  if (rows.length) {
    const sumCols = [
      ONHAND, ...weekCols, ACTUAL_DO_CUM,
      ...cpfrWeekCols.map((wc) => wc.cpfr), TOTAL_CPFR,
      ...(monthCols ? [monthCols.totalCpfr, monthCols.balance, monthCols.unserved, monthCols.hold, monthCols.replace, monthCols.replace2, monthCols.replace4, monthCols.poTotal] : []),
      STOCKS,
      P4_SELLOUT, P2_SELLOUT, ONHAND_PLUS_PO,
      INVENTORY_IN_SYSTEM, IN_TRANSIT, EST_TOTAL_INVENTORY,
      ACTUAL_DO_PESO, TOTAL_CPFR_PESO, MAY_BALANCE_PESO, TOTAL_UNSERVED_PESO, HOLD_PESO,
      REPLACEMENT1_PESO, REPLACEMENT2_PESO, REPLACEMENT4_PESO, TOTAL_PO_AMOUNT_PESO, TOTAL_EST_SELLIN_PESO,
      SYSTEM_QTY, UNSERVED_QTY, BASED_ON_COST, BASED_ON_SRP,
    ];
    sumCols.forEach((c) => put(TOTAL_ROW, c, null, sum(c), TOTAL_ROW_NUM));
  }

  // Weekly Sell-Out and CPFR each span the whole year — far too wide to show at once
  // — so each gets its own windowed, scrollable strip inside the sheet: 5 weeks
  // visible at a time. Balance/PO doesn't need one: it only ever shows one month's 8
  // columns (picked via the dropdown in its header), not every month side by side.
  const windows = [];
  if (weekCols.length) {
    const win = { c1: weekCols[0], c2: weekCols[weekCols.length - 1], width: 5 * 58 };
    const idx = latestDataWeek != null ? weeks.indexOf(latestDataWeek) : -1;
    if (idx !== -1) win.scrollToCol = weekCols[idx];
    windows.push(win);
  }
  if (cpfrWeekCols.length) {
    const win = { c1: cpfrWeekCols[0].cpfr, c2: cpfrWeekCols[cpfrWeekCols.length - 1].cpfr, width: 5 * 70 };
    const idx = latestDataWeek != null ? cpfrWeeks.indexOf(latestDataWeek) : -1;
    if (idx !== -1) win.scrollToCol = cpfrWeekCols[idx].cpfr;
    windows.push(win);
  }

  const sheet = {
    name: 'CPFR',
    cols,
    dh: 26,
    rowh: { [HEADER_ROW]: 32, [SUBHEADER_ROW]: 46 },
    hrows: [],
    maxr,
    maxc,
    fr: 2,
    fc: 2,
    merges,
    cells,
    windows,
  };

  return { workbook: { sheets: [sheet], styles: STYLES } };
}
