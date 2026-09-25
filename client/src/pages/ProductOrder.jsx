import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Badge from '../components/Badge.jsx';
import TableToolbar from '../components/TableToolbar.jsx';
import Pagination from '../components/Pagination.jsx';
import TableFrame, { ZoomArea } from '../components/TableFrame.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useFilteredTable } from '../hooks/useFilteredTable.js';
import { downloadCsv } from '../utils/csv.js';

const inputCls = 'w-24 text-right border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600';

export default function ProductOrder() {
  const confirm = useConfirm();
  const [month, setMonth] = useState('');
  const [availableMonths, setAvailableMonths] = useState([]);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
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

  async function load(m) {
    setError(null);
    try {
      const data = await api.getPo(m || undefined);
      setMonth(data.month || '');
      setAvailableMonths(data.availableMonths || []);
      setRows(data.rows);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  function updateLocal(itemDesc, field, value) {
    setRows((rs) => rs.map((r) => (r.itemDesc === itemDesc ? { ...r, [field]: value } : r)));
  }

  async function save(row) {
    try {
      await api.putPo({ itemDesc: row.itemDesc, month, hold: Number(row.hold) || 0, replaceQty: Number(row.replaceQty) || 0 });
      load(month);
    } catch (e) {
      setError(e.message);
    }
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

  const totalForPoSum = filteredRows.reduce((sum, r) => sum + r.totalForPo, 0);

  async function exportCsv() {
    const ok = await confirm({ title: 'Export CSV?', message: `Export ${filteredRows.length} row(s) to a CSV file?`, confirmLabel: 'Export' });
    if (!ok) return;
    const headers = ['Item Desc', 'Category', 'On Hand', 'Unserved', 'Hold', 'Replace', 'Total for PO'];
    const csvRows = filteredRows.map((r) => [r.itemDesc, r.category || '', r.onHand, r.unserved, r.hold, r.replaceQty, r.totalForPo]);
    downloadCsv(`product-order-${month || 'all'}.csv`, headers, csvRows);
  }

  return (
    <>
      <PageHeader>Product Order</PageHeader>
      <div className="py-8">
        <div className="max-w-7xl mx-auto sm:px-6 lg:px-8 space-y-6">
          <Card>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Unserved is fetched from the Balance page for the selected month. Hold and Replace are editable.
              Total for PO = Unserved + Hold + Replace.
            </p>

            <div className="mb-6">
              <select
                value={month}
                onChange={(e) => load(e.target.value)}
                className="border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600"
              >
                {availableMonths.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
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
                    <th className="px-3 py-2">Item Desc</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">On Hand</th>
                    <th className="px-3 py-2 text-right">Unserved</th>
                    <th className="px-3 py-2 text-right">Hold</th>
                    <th className="px-3 py-2 text-right">Replace</th>
                    <th className="px-3 py-2 text-right">Total for PO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pageRows.map((r) => (
                    <tr key={r.itemDesc}>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                        {r.itemDesc}{r.isFlagship ? <Badge variant="flagship">Flagship</Badge> : null}
                      </td>
                      <td className="px-3 py-2">{r.category || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{r.onHand}</td>
                      <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{r.unserved}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number" className={inputCls} value={r.hold}
                          onFocus={(e) => handleFocus(r.itemDesc, 'hold', e.target.value)}
                          onChange={(e) => updateLocal(r.itemDesc, 'hold', e.target.value)}
                          onBlur={() => handleBlur(r, 'hold', 'Hold')}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number" className={inputCls} value={r.replaceQty}
                          onFocus={(e) => handleFocus(r.itemDesc, 'replaceQty', e.target.value)}
                          onChange={(e) => updateLocal(r.itemDesc, 'replaceQty', e.target.value)}
                          onBlur={() => handleBlur(r, 'replaceQty', 'Replace')}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">{r.totalForPo}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No devices yet — add a month with balance data first.</td></tr>
                  )}
                  {rows.length > 0 && pageRows.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No rows match your search/filter.</td></tr>
                  )}
                </tbody>
                {pageRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-200 dark:border-gray-700">
                      <td colSpan={6} className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">Total (filtered)</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-gray-100">{totalForPoSum}</td>
                    </tr>
                  </tfoot>
                )}
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
