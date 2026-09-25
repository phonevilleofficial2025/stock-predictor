import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SecondaryButton from '../components/SecondaryButton.jsx';
import Badge from '../components/Badge.jsx';
import Pagination from '../components/Pagination.jsx';
import TableFrame, { ZoomArea } from '../components/TableFrame.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { PAGE_SIZE_OPTIONS } from '../hooks/useFilteredTable.js';

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const inputCls = 'border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 text-sm';
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

export default function Rsi() {
  const confirm = useConfirm();
  const [month, setMonth] = useState(currentMonth());
  const [stores, setStores] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [warningStoreFilter, setWarningStoreFilter] = useState('OVERALL');

  const visibleStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stores.filter((s) => {
      if (q && !s.storeName.toLowerCase().includes(q)) return false;
      if (statusFilter === 'checked' && !s.isRsi) return false;
      if (statusFilter === 'unchecked' && s.isRsi) return false;
      return true;
    });
  }, [stores, search, statusFilter]);

  const total = visibleStores.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const pageRows = visibleStores.slice(start, start + pageSize);

  function updateSearch(value) {
    setSearch(value);
    setPage(1);
  }
  function updateStatusFilter(value) {
    setStatusFilter(value);
    setPage(1);
  }
  function updatePageSize(value) {
    setPageSize(value);
    setPage(1);
  }

  const warningStoreNames = useMemo(
    () => Array.from(new Set(warnings.map((w) => w.storeName))).sort(),
    [warnings]
  );
  const visibleWarnings = useMemo(
    () => (warningStoreFilter === 'OVERALL' ? warnings : warnings.filter((w) => w.storeName === warningStoreFilter)),
    [warnings, warningStoreFilter]
  );

  async function load(m) {
    setError(null);
    try {
      const data = await api.getRsi(m);
      setStores(data.stores);
      const w = await api.getRsiWarnings(m);
      setWarnings(w.warnings);
      setWarningStoreFilter('OVERALL');
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(month); }, []);

  async function handleToggle(e, store) {
    const nextValue = e.target.checked;
    const ok = await confirm({
      title: nextValue ? 'Mark as RSI store?' : 'Remove RSI status?',
      message: `${nextValue ? 'Mark' : 'Remove RSI status from'} "${store.storeName}" for ${month}?`,
      confirmLabel: nextValue ? 'Mark RSI' : 'Remove',
    });
    if (!ok) {
      e.target.checked = store.isRsi;
      return;
    }
    try {
      await api.putRsi({ storeId: store.storeId, month, isRsi: nextValue });
      load(month);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <PageHeader>RSI</PageHeader>
      <div className="py-8">
        <div className="max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
          <Card>
            <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">Top Performing Stores</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Select which store(s) are RSI (top performers) for the month. RSI stores stocking a Critical device are flagged below.
            </p>
            <div className="flex gap-2 items-end mb-6">
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600"
              />
              <SecondaryButton onClick={() => load(month)}>Load</SecondaryButton>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
                {error}
              </div>
            )}

            <TableFrame>
            <div className="flex flex-wrap items-end gap-4 mb-4">
              <div className="flex-1 min-w-[180px]">
                <label className={labelCls}>Search</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => updateSearch(e.target.value)}
                  placeholder="Search store…"
                  className={`w-full ${inputCls}`}
                />
              </div>
              <div>
                <label className={labelCls}>RSI Status</label>
                <select value={statusFilter} onChange={(e) => updateStatusFilter(e.target.value)} className={inputCls}>
                  <option value="all">All</option>
                  <option value="checked">Checked</option>
                  <option value="unchecked">Unchecked</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Show</label>
                <select value={pageSize} onChange={(e) => updatePageSize(Number(e.target.value))} className={inputCls}>
                  {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            <ZoomArea>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-2">Store</th>
                    <th className="px-3 py-2 text-right">Total Sell-Out (Month)</th>
                    <th className="px-3 py-2">RSI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pageRows.map((s) => (
                    <tr key={s.storeId}>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{s.storeName}</td>
                      <td className="px-3 py-2 text-right">{s.totalQty}</td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={s.isRsi}
                          onChange={(e) => handleToggle(e, s)}
                          className="rounded border-gray-300 dark:border-gray-700 text-indigo-600 shadow-sm focus:ring-indigo-500 dark:focus:ring-indigo-600 dark:bg-gray-900"
                        />
                      </td>
                    </tr>
                  ))}
                  {stores.length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No stores yet.</td></tr>
                  )}
                  {stores.length > 0 && visibleStores.length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No stores match your search/filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </ZoomArea>
            <Pagination page={currentPage} pageCount={pageCount} total={total} start={start} count={pageRows.length} setPage={setPage} />
            </TableFrame>
          </Card>

          <Card>
            <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-4">Critical-Level Warnings at RSI Stores</h3>
            {warnings.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No RSI store currently stocks a Critical-level device. 🎉</p>
            ) : (
              <TableFrame>
                <div className="mb-4">
                  <label className={labelCls}>Store</label>
                  <select value={warningStoreFilter} onChange={(e) => setWarningStoreFilter(e.target.value)} className={`w-64 ${inputCls}`}>
                    <option value="OVERALL">Overall (all RSI stores)</option>
                    {warningStoreNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <ZoomArea>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400">
                        <th className="px-3 py-2">Store</th>
                        <th className="px-3 py-2">Device</th>
                        <th className="px-3 py-2 text-right">On Hand at Store</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {visibleWarnings.map((w, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{w.storeName}<Badge variant="rsi">RSI</Badge></td>
                          <td className="px-3 py-2">{w.deviceModel}<Badge variant="critical">Critical</Badge></td>
                          <td className="px-3 py-2 text-right">{w.quantity}</td>
                        </tr>
                      ))}
                      {visibleWarnings.length === 0 && (
                        <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No warnings for this store.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                </ZoomArea>
              </TableFrame>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
