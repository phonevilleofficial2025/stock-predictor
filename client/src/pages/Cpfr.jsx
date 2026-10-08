import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import TableToolbar from '../components/TableToolbar.jsx';
import Pagination from '../components/Pagination.jsx';
import { useFilteredTable } from '../hooks/useFilteredTable.js';
import { downloadCsv } from '../utils/csv.js';
import { formatWeekNumber } from '../utils/week.js';
import { computeScore, classifyStatus, computeUnservedSeries } from '../utils/formulas.js';
import { buildCpfrWorkbook } from '../utils/cpfrWorkbook.js';
import ExcelSheet from '../components/excel/ExcelSheet.jsx';

const EMPTY_DEVICE_MASTER = {
  regularSrp: 0, promoSrp: 0, cost: 0, promoText: '', sw: 0,
  saScoreSes: 0, saScoreMb: 0, stocksSnapshot: 0, systemQty: 0, unservedQty: 0, actualDoCumulative: 0,
};

// Combines what used to be four separate pages (Sales, CPFR, Balance, Product Order)
// into one alias-keyed spreadsheet — a full replica of the CPFR simulation workbook,
// not just a table styled to look like one. Plans by alias (every color/SKU sharing a
// Device Model prefix — e.g. every color of "Galaxy A07 LTE (4+128GB)" — combined
// into one row), the same unit the source CPFR workbook itself plans in, not per
// individual color. Every week sits side by side in the same sheet — there's no week
// selector to switch between; weekly sell-out and weekly CPFR each grow by one column
// the moment a new week shows up (a sales upload, or a CPFR entry for a week that
// hasn't been uploaded yet).
function mergeRows({ cpfrRows, salesTable, balanceTable, poRows, masterRows }) {
  const byAlias = new Map();

  for (const c of cpfrRows) {
    byAlias.set(c.alias, {
      alias: c.alias,
      variantCount: c.variantCount,
      category: c.category,
      isFlagship: c.isFlagship,
      onHand: c.onHand,
      avg2wk: c.avg2wk,
      suggestion: c.suggestion,
      cpfrByWeek: c.cpfrByWeek,
      weeks: {},
      months: [],
      poByMonth: {},
      deviceMaster: EMPTY_DEVICE_MASTER,
    });
  }

  for (const s of salesTable) {
    const row = byAlias.get(s.alias);
    if (row) row.weeks = s.weeks;
  }

  for (const b of balanceTable) {
    const row = byAlias.get(b.alias);
    if (row) row.months = b.months;
  }

  for (const p of poRows) {
    const row = byAlias.get(p.alias);
    if (row) row.poByMonth = Object.fromEntries(p.months.map((m) => [m.month, m]));
  }

  for (const m of masterRows) {
    const row = byAlias.get(m.alias);
    if (row) row.deviceMaster = m;
  }

  return Array.from(byAlias.values())
    .map((r) => {
      const base = computeScore({ onHand: r.onHand, avg2wk: r.avg2wk, totalCpfr: 0 });
      return {
        ...r,
        estimatedSellout: base.estimatedSellout,
        estimatedOnHand: base.estimatedOnHand,
        score: base.score,
        status: classifyStatus(base.score, r.isFlagship),
      };
    })
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

export default function Cpfr() {
  const [cpfrWeeks, setCpfrWeeks] = useState([]);
  const [salesWeeks, setSalesWeeks] = useState([]);
  const [latestDataWeek, setLatestDataWeek] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const sheetRef = useRef(null);

  const {
    search, setSearch, flagshipOnly, setFlagshipOnly, minQty, setMinQty, maxQty, setMaxQty,
    categoryFilter, setCategoryFilter, categoryOptions,
    page, setPage, pageSize, setPageSize, pageRows, filteredRows, total, pageCount, start,
  } = useFilteredTable(rows, {
    getSearchText: (r) => `${r.alias} ${r.category || ''}`,
    getIsFlagship: (r) => r.isFlagship,
    getOnHand: (r) => r.onHand,
    getCategory: (r) => r.category,
    defaultPageSize: 10,
  });

  async function loadCore() {
    setError(null);
    try {
      const [cpfrData, salesData, balanceData, masterData, poAllData] = await Promise.all([
        api.getCpfr(),
        api.getSales(),
        api.getBalance(),
        api.getDeviceMaster(),
        api.getPoAll(),
      ]);
      setCpfrWeeks(cpfrData.weeks || []);
      setSalesWeeks(salesData.weeks || []);
      setLatestDataWeek(cpfrData.latestDataWeek ?? null);

      const merged = mergeRows({
        cpfrRows: cpfrData.rows, salesTable: salesData.table, balanceTable: balanceData.table,
        poRows: poAllData.rows, masterRows: masterData.rows,
      });
      setRows(merged);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCore(); }, []);

  // Fired when the formula bar commits an edit to one of the sheet's editable
  // (amber) cells. The engine has already updated itself locally and recalculated —
  // this persists the value server-side and keeps React state in sync so a later
  // filter/month change (or the next upload) rebuilds the sheet from the correct data.
  async function handleCommit(sheetName, r, c, value, field) {
    if (!field) return;
    // Switching Balance/PO's month dropdown is a view change, not a data edit —
    // nothing to save, so skip the saving-dot/error machinery entirely.
    if (field.kind === 'selectMonth') {
      setSelectedMonth(value);
      return;
    }
    sheetRef.current?.setCellStatus(sheetName, r, c, 'saving');
    try {
      if (field.kind === 'cpfr') {
        const res = await api.putCpfr({ alias: field.alias, week: field.week, [field.field]: value });
        setRows((prev) => prev.map((x) => (x.alias === field.alias
          ? { ...x, cpfrByWeek: { ...x.cpfrByWeek, [field.week]: { weeklyCpfr: res.weeklyCpfr, actualDo: res.actualDo, totalCpfr: res.totalCpfr } } }
          : x)));
        const balanceData = await api.getBalance();
        const updatedBalance = balanceData.table.find((b) => b.alias === field.alias);
        if (updatedBalance) setRows((prev) => prev.map((x) => (x.alias === field.alias ? { ...x, months: updatedBalance.months } : x)));
      } else if (field.kind === 'balance') {
        await api.putBalance({ alias: field.alias, month: field.month, monthBalance: value });
        setRows((prev) => prev.map((x) => {
          if (x.alias !== field.alias) return x;
          const months = computeUnservedSeries(x.months.map((m) => (m.month === field.month ? { ...m, monthBalance: value } : m)));
          return { ...x, months };
        }));
      } else if (field.kind === 'po') {
        const res = await api.putPo({ alias: field.alias, month: field.month, [field.field]: value });
        setRows((prev) => prev.map((x) => (x.alias === field.alias
          ? { ...x, poByMonth: { ...x.poByMonth, [field.month]: { ...x.poByMonth[field.month], hold: res.hold, replaceQty: res.replaceQty, replace2Qty: res.replace2Qty, replace4Qty: res.replace4Qty } } }
          : x)));
      } else if (field.kind === 'deviceMaster') {
        const res = await api.putDeviceMaster({ alias: field.alias, field: field.field, value });
        setRows((prev) => prev.map((x) => (x.alias === field.alias
          ? { ...x, deviceMaster: { ...x.deviceMaster, [field.field]: res.value } }
          : x)));
      }
      sheetRef.current?.setCellStatus(sheetName, r, c, undefined);
    } catch (e) {
      sheetRef.current?.setCellStatus(sheetName, r, c, 'error');
      setError(e.message);
    }
  }

  const weeks = useMemo(() => [...salesWeeks].sort((a, b) => a - b), [salesWeeks]);

  const months = useMemo(() => rows[0]?.months.map((m) => ({ month: m.month, label: m.label })) || [], [rows]);

  const { workbook } = useMemo(
    () => buildCpfrWorkbook({ rows: pageRows, weeks, cpfrWeeks, months, latestDataWeek, selectedMonth }),
    [pageRows, weeks, cpfrWeeks, months, latestDataWeek, selectedMonth],
  );

  function exportCsv() {
    const headers = [
      'Alias', 'Variants Merged', 'Category', 'On Hand', 'Regular SRP', 'Promo SRP',
      ...weeks.map((w) => `Week ${formatWeekNumber(w)}`),
      'Avg 2-Wk', 'Est. Sellout', 'Est. On Hand', 'Score', 'Status', 'Suggestion', 'Actual DO (cumulative)',
      ...cpfrWeeks.map((w) => `${formatWeekNumber(w)} CPFR`),
      'Total CPFR',
      ...months.flatMap((m) => [
        `${m.label} Total CPFR`, `${m.label} Balance`, `${m.label} Unserved`,
        `${m.label} PO Hold`, `${m.label} PO Replace`, `${m.label} PO Replace 2`, `${m.label} PO Replace 4`, `${m.label} Total for PO`,
      ]),
      'Stocks',
      'Cost', 'SW', 'Min SW', 'SA Score SES', 'SA Score MB', 'Promos', 'System Qty', 'Unserved Qty',
    ];
    const csvRows = filteredRows.map((r) => {
      const dm = r.deviceMaster || EMPTY_DEVICE_MASTER;
      const totalCpfr = cpfrWeeks.reduce((sum, w) => sum + (r.cpfrByWeek[w]?.weeklyCpfr || 0), 0) - (dm.actualDoCumulative || 0);
      return [
        r.alias, r.variantCount, r.category || '', r.onHand, dm.regularSrp, dm.promoSrp,
        ...weeks.map((w) => r.weeks[w] ?? 0),
        r.avg2wk, r.estimatedSellout, r.estimatedOnHand, r.score ?? '', r.status || '', r.suggestion, dm.actualDoCumulative,
        ...cpfrWeeks.map((w) => r.cpfrByWeek[w]?.weeklyCpfr || 0),
        totalCpfr,
        ...r.months.flatMap((m) => {
          const po = r.poByMonth[m.month] || { hold: 0, replaceQty: 0, replace2Qty: 0, replace4Qty: 0 };
          const totalForPo = m.unserved + (Number(po.hold) || 0) + (Number(po.replaceQty) || 0) + (Number(po.replace2Qty) || 0) + (Number(po.replace4Qty) || 0);
          return [m.totalCpfr, m.monthBalance, m.unserved, po.hold, po.replaceQty, po.replace2Qty, po.replace4Qty, totalForPo];
        }),
        dm.stocksSnapshot,
        dm.cost, dm.sw, dm.sw * 140, dm.saScoreSes, dm.saScoreMb, dm.promoText, dm.systemQty, dm.unservedQty,
      ];
    });
    downloadCsv('cpfr.csv', headers, csvRows);
  }

  return (
    <>
      <PageHeader>CPFR</PageHeader>
      <div className="py-6">
        <div className="max-w-[1700px] mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
          <div className="bg-white dark:bg-gray-800 shadow-sm sm:rounded-lg p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              A real spreadsheet — every column from the CPFR simulation workbook, with no manual setup. Plans by alias:
              every color/SKU sharing a Device Model prefix (e.g. every color of "Galaxy A07 LTE (4+128GB)") is combined
              into one row, with On Hand and sell-out summed across them — the same unit the source workbook itself plans
              in. Weekly Sell-Out and CPFR span week 1 through the current year's last week automatically (scroll right
              for later weeks); Balance and Product Order show one month at a time — use the dropdown in its header to
              switch months. Click a cell to select it; the formula bar above shows its value or formula. Shaded (amber) cells
              are editable — type a new value in the formula bar and press Enter to save; everything else is either
              uploaded history or a computed formula cell (green corner). Pricing, cost, promo copy and the other
              columns with no upload source are plain editable fields you fill in directly on the sheet.
            </p>

            {error && (
              <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
                {error}
              </div>
            )}

            {!loading && rows.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No devices yet — upload inventory and sales files first.</p>
            ) : (
              <>
                <TableToolbar
                  search={search} onSearchChange={setSearch} searchPlaceholder="Search alias…"
                  showFlagshipFilter flagshipOnly={flagshipOnly} onFlagshipChange={setFlagshipOnly}
                  showQtyFilter minQty={minQty} onMinQtyChange={setMinQty} maxQty={maxQty} onMaxQtyChange={setMaxQty}
                  showCategoryFilter categoryFilter={categoryFilter} onCategoryChange={setCategoryFilter} categoryOptions={categoryOptions}
                  pageSize={pageSize} onPageSizeChange={setPageSize} pageSizeOptions={[10, 20, 50, 75, 100]}
                  onExport={exportCsv}
                />
                <ExcelSheet ref={sheetRef} workbook={workbook} onCommit={handleCommit} className="mt-2" />
                <Pagination page={page} pageCount={pageCount} total={total} start={start} count={pageRows.length} setPage={setPage} />
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
