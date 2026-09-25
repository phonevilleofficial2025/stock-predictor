import { Fragment, useEffect, useRef, useState } from 'react';
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

const inputCls = 'w-24 text-right border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600';

function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: 'short' });
}

export default function Balance() {
  const confirm = useConfirm();
  const [data, setData] = useState({ months: [], table: [] });
  const [newMonth, setNewMonth] = useState('');
  const [error, setError] = useState(null);
  const originalValuesRef = useRef({});

  const {
    search, setSearch, flagshipOnly, setFlagshipOnly, minQty, setMinQty, maxQty, setMaxQty,
    categoryFilter, setCategoryFilter, categoryOptions,
    page, setPage, pageSize, setPageSize, pageRows, filteredRows, total, pageCount, start,
  } = useFilteredTable(data.table, {
    getSearchText: (r) => `${r.itemDesc} ${r.category || ''}`,
    getIsFlagship: (r) => r.isFlagship,
    getOnHand: (r) => r.onHand,
    getCategory: (r) => r.category,
  });

  async function exportCsv() {
    const ok = await confirm({ title: 'Export CSV?', message: `Export ${filteredRows.length} row(s) to a CSV file?`, confirmLabel: 'Export' });
    if (!ok) return;
    const headers = ['Item Desc', 'Category', 'On Hand', ...data.months.flatMap((m) => [`${m.label} Total CPFR`, `${m.label} Balance`, `${m.label} Unserved`])];
    const csvRows = filteredRows.map((row) => [
      row.itemDesc,
      row.category || '',
      row.onHand,
      ...row.months.flatMap((m) => [m.totalCpfr, m.monthBalance, m.unserved]),
    ]);
    downloadCsv('balance.csv', headers, csvRows);
  }

  async function load() {
    setError(null);
    try {
      setData(await api.getBalance());
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function addMonth() {
    if (!newMonth) return;
    try {
      await api.addMonth({ month: newMonth, label: monthLabel(newMonth) });
      setNewMonth('');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  function updateLocalBalance(itemDesc, month, value) {
    setData((d) => ({
      ...d,
      table: d.table.map((row) => row.itemDesc !== itemDesc ? row : {
        ...row,
        months: row.months.map((m) => m.month !== month ? m : { ...m, monthBalance: value }),
      }),
    }));
  }

  async function saveBalance(itemDesc, month, value) {
    try {
      await api.putBalance({ itemDesc, month, monthBalance: Number(value) || 0 });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  function handleFocus(itemDesc, month, value) {
    originalValuesRef.current[`${itemDesc}:${month}`] = value;
  }

  async function handleBlur(e, itemDesc, month) {
    const key = `${itemDesc}:${month}`;
    const original = originalValuesRef.current[key];
    const current = e.target.value;
    if (original === undefined || String(current) === String(original)) return;
    const ok = await confirm({
      title: 'Save change?',
      message: `Change Balance for "${itemDesc}" (${month}) from ${original || 0} to ${current || 0}?`,
      confirmLabel: 'Save',
    });
    if (!ok) {
      e.target.value = original;
      updateLocalBalance(itemDesc, month, original);
      return;
    }
    await saveBalance(itemDesc, month, current);
  }

  return (
    <>
      <PageHeader>Balance</PageHeader>
      <div className="py-8">
        <div className="max-w-7xl mx-auto sm:px-6 lg:px-8 space-y-6">
          <Card>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Total CPFR is fetched from the CPFR page (summed across the weeks in each month). Enter the remaining balance for the month;
              Unserved carries forward across months = previous Unserved + this month's Total CPFR − this month's Balance.
            </p>

            <div className="flex gap-2 items-end mb-6">
              <input
                type="month"
                value={newMonth}
                onChange={(e) => setNewMonth(e.target.value)}
                className="border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600"
              />
              <SecondaryButton onClick={addMonth}>+ Add Month</SecondaryButton>
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
                    <th rowSpan={2} className="px-3 py-2 sticky left-0 bg-white dark:bg-gray-800 align-bottom">Item Desc</th>
                    <th rowSpan={2} className="px-3 py-2 align-bottom">Category</th>
                    <th rowSpan={2} className="px-3 py-2 text-right align-bottom">On Hand</th>
                    {data.months.map((m) => <th key={m.month} colSpan={3} className="px-3 py-2 text-center border-b border-gray-200 dark:border-gray-700">{m.label}</th>)}
                  </tr>
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    {data.months.map((m) => (
                      <Fragment key={m.month}>
                        <th className="px-3 py-2 text-right whitespace-nowrap">Total CPFR</th>
                        <th className="px-3 py-2 text-right whitespace-nowrap">{m.label}-Balance</th>
                        <th className="px-3 py-2 text-right whitespace-nowrap">Unserved</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pageRows.map((row) => (
                    <tr key={row.itemDesc}>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100 sticky left-0 bg-white dark:bg-gray-800">
                        {row.itemDesc}{row.isFlagship ? <Badge variant="flagship">Flagship</Badge> : null}
                      </td>
                      <td className="px-3 py-2">{row.category || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{row.onHand}</td>
                      {row.months.map((m) => (
                        <Fragment key={m.month}>
                          <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400">{m.totalCpfr}</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              className={inputCls}
                              defaultValue={m.monthBalance}
                              onFocus={(e) => handleFocus(row.itemDesc, m.month, e.target.value)}
                              onChange={(e) => updateLocalBalance(row.itemDesc, m.month, e.target.value)}
                              onBlur={(e) => handleBlur(e, row.itemDesc, m.month)}
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">{m.unserved}</td>
                        </Fragment>
                      ))}
                    </tr>
                  ))}
                  {data.table.length === 0 && (
                    <tr><td colSpan={3 + data.months.length * 3} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No devices yet.</td></tr>
                  )}
                  {data.table.length > 0 && pageRows.length === 0 && (
                    <tr><td colSpan={3 + data.months.length * 3} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No rows match your search/filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </ZoomArea>
            <Pagination page={page} pageCount={pageCount} total={total} start={start} count={pageRows.length} setPage={setPage} />
            </TableFrame>
            {data.months.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">Add a month above to start tracking balance.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
