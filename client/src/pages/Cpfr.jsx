import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SecondaryButton from '../components/SecondaryButton.jsx';
import Badge from '../components/Badge.jsx';
import TableToolbar from '../components/TableToolbar.jsx';
import Pagination from '../components/Pagination.jsx';
import TableFrame, { ZoomArea } from '../components/TableFrame.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useFilteredTable } from '../hooks/useFilteredTable.js';
import { downloadCsv } from '../utils/csv.js';
import { formatWeekNumber } from '../utils/week.js';

const inputCls = 'w-24 text-right border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600';

export default function Cpfr() {
  const confirm = useConfirm();
  const [week, setWeek] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);
  const originalValuesRef = useRef({});

  const {
    search, setSearch, flagshipOnly, setFlagshipOnly, minQty, setMinQty, maxQty, setMaxQty,
    categoryFilter, setCategoryFilter, categoryOptions,
    page, setPage, pageSize, setPageSize, pageRows, filteredRows, total, pageCount, start,
  } = useFilteredTable(rows, {
    getSearchText: (r) => `${r.itemDesc} ${r.category || ''}`,
    getIsFlagship: (r) => r.isFlagship,
    getOnHand: (r) => r.onHand,
    getCategory: (r) => r.category,
  });

  async function exportCsv() {
    const ok = await confirm({ title: 'Export CSV?', message: `Export ${filteredRows.length} row(s) to a CSV file?`, confirmLabel: 'Export' });
    if (!ok) return;
    const headers = ['Item Desc', 'Category', 'On Hand', 'Avg 2-Wk Sellout', 'Weekly CPFR', 'Suggestion', 'Actual DO', 'Total CPFR'];
    const csvRows = filteredRows.map((r) => [r.itemDesc, r.category || '', r.onHand, r.avg2wk, r.weeklyCpfr, r.suggestion, r.actualDo, r.totalCpfr]);
    downloadCsv(`cpfr-week-${week || 'latest'}.csv`, headers, csvRows);
  }

  async function load(w) {
    setError(null);
    try {
      const data = await api.getCpfr(w || undefined);
      setWeek(data.week ?? '');
      setRows(data.rows);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  function updateLocal(itemDesc, field, value) {
    setRows((rs) => rs.map((r) => (r.itemDesc === itemDesc ? { ...r, [field]: value } : r)));
  }

  function handleFocus(itemDesc, field, value) {
    originalValuesRef.current[`${itemDesc}:${field}`] = value;
  }

  async function handleBlur(row, field, label) {
    const key = `${row.itemDesc}:${field}`;
    const original = originalValuesRef.current[key];
    const current = row[field];
    if (original === undefined || String(current) === String(original)) return;
    const ok = await confirm({
      title: 'Save change?',
      message: `Change ${label} for "${row.itemDesc}" from ${original || 0} to ${current || 0}?`,
      confirmLabel: 'Save',
    });
    if (!ok) {
      updateLocal(row.itemDesc, field, original);
      return;
    }
    await save(row);
  }

  async function save(row) {
    setSaving(row.itemDesc);
    try {
      const res = await api.putCpfr({
        itemDesc: row.itemDesc,
        week: Number(week),
        weeklyCpfr: Number(row.weeklyCpfr) || 0,
        actualDo: Number(row.actualDo) || 0,
      });
      updateLocal(row.itemDesc, 'totalCpfr', res.totalCpfr);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <PageHeader>CPFR</PageHeader>
      <div className="py-8">
        <div className="max-w-7xl mx-auto sm:px-6 lg:px-8 space-y-6">
          <Card>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Weekly CPFR and Actual DO are editable. Suggestion is the smallest additional stock needed to reach Healthy — you decide whether to plan around it.
              Total CPFR = Weekly CPFR − Actual DO.
            </p>

            <div className="flex gap-2 items-end mb-6">
              <div>
                <label className="block font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">Week</label>
                <input
                  type="number"
                  value={week}
                  onChange={(e) => setWeek(e.target.value)}
                  className="border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 w-24"
                />
              </div>
              <SecondaryButton onClick={() => load(week)}>Load Week</SecondaryButton>
              {week !== '' && <span className="text-sm text-gray-500 dark:text-gray-400 pb-2">({formatWeekNumber(Number(week))})</span>}
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
                {error}
              </div>
            )}

            <TableFrame>
            <TableToolbar
              search={search} onSearchChange={setSearch} searchPlaceholder="Search item desc…"
              showFlagshipFilter flagshipOnly={flagshipOnly} onFlagshipChange={setFlagshipOnly}
              showQtyFilter minQty={minQty} onMinQtyChange={setMinQty} maxQty={maxQty} onMaxQtyChange={setMaxQty}
              showCategoryFilter categoryFilter={categoryFilter} onCategoryChange={setCategoryFilter} categoryOptions={categoryOptions}
              pageSize={pageSize} onPageSizeChange={setPageSize}
              onExport={exportCsv}
            />

            <ZoomArea>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-2 sticky left-0 bg-white dark:bg-gray-800">Item Desc</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">On Hand</th>
                    <th className="px-3 py-2 text-right">Avg 2-Wk Sellout</th>
                    <th className="px-3 py-2 text-right">Weekly CPFR</th>
                    <th className="px-3 py-2 text-right">Suggestion</th>
                    <th className="px-3 py-2 text-right">Actual DO</th>
                    <th className="px-3 py-2 text-right">Total CPFR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pageRows.map((r) => (
                    <tr key={r.itemDesc}>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100 sticky left-0 bg-white dark:bg-gray-800">
                        {r.itemDesc}{r.isFlagship ? <Badge variant="flagship">Flagship</Badge> : null}
                      </td>
                      <td className="px-3 py-2">{r.category || '—'}</td>
                      <td className="px-3 py-2 text-right">{r.onHand}</td>
                      <td className="px-3 py-2 text-right">{r.avg2wk}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number" className={inputCls} value={r.weeklyCpfr}
                          onFocus={(e) => handleFocus(r.itemDesc, 'weeklyCpfr', e.target.value)}
                          onChange={(e) => updateLocal(r.itemDesc, 'weeklyCpfr', e.target.value)}
                          onBlur={() => handleBlur(r, 'weeklyCpfr', 'Weekly CPFR')}
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{r.suggestion}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number" className={inputCls} value={r.actualDo}
                          onFocus={(e) => handleFocus(r.itemDesc, 'actualDo', e.target.value)}
                          onChange={(e) => updateLocal(r.itemDesc, 'actualDo', e.target.value)}
                          onBlur={() => handleBlur(r, 'actualDo', 'Actual DO')}
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{r.totalCpfr}{saving === r.itemDesc ? ' …' : ''}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No devices yet — upload inventory and sales files first.</td></tr>
                  )}
                  {rows.length > 0 && pageRows.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No rows match your search/filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </ZoomArea>
            <Pagination page={page} pageCount={pageCount} total={total} start={start} count={pageRows.length} setPage={setPage} />
            </TableFrame>
          </Card>
        </div>
      </div>
    </>
  );
}
