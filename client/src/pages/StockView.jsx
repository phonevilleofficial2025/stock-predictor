import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import TableToolbar from '../components/TableToolbar.jsx';
import Pagination from '../components/Pagination.jsx';
import TableFrame, { ZoomArea } from '../components/TableFrame.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useFilteredTable } from '../hooks/useFilteredTable.js';
import { downloadCsv } from '../utils/csv.js';

const ALL_STORES = 'ALL';

export default function StockView() {
  const confirm = useConfirm();
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState('');
  const [stock, setStock] = useState([]);
  const [error, setError] = useState(null);

  const isSummary = storeId === ALL_STORES;

  const {
    search, setSearch, flagshipOnly, setFlagshipOnly, minQty, setMinQty, maxQty, setMaxQty,
    categoryFilter, setCategoryFilter, categoryOptions,
    brandFilter, setBrandFilter, brandOptions,
    page, setPage, pageSize, setPageSize, pageRows, filteredRows, total, pageCount, start,
  } = useFilteredTable(stock, {
    getSearchText: (r) => `${r.deviceModel} ${r.variantName || ''} ${r.sku} ${r.category || ''} ${r.brand || ''}`,
    getIsFlagship: (r) => r.isFlagship,
    getOnHand: (r) => r.quantity,
    getCategory: (r) => r.category,
    getBrand: (r) => r.brand,
  });

  useEffect(() => {
    api.getStores().then((s) => {
      setStores(s);
      if (s.length) setStoreId(String(s[0].id));
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!storeId) return;
    const request = isSummary ? api.getStockSummary() : api.getStock(storeId);
    request.then(setStock).catch((e) => setError(e.message));
  }, [storeId]);

  const totalOnHand = stock.reduce((sum, r) => sum + r.quantity, 0);

  async function handleFlagshipChange(e, row) {
    const nextValue = e.target.checked;
    const ok = await confirm({
      title: nextValue ? 'Mark as Flagship?' : 'Remove Flagship status?',
      message: `${nextValue ? 'Mark' : 'Remove Flagship from'} "${row.deviceModel}${row.variantName ? ` — ${row.variantName}` : ''}"?`,
      confirmLabel: nextValue ? 'Mark Flagship' : 'Remove',
    });
    if (!ok) {
      e.target.checked = row.isFlagship;
      return;
    }
    setStock((s) => s.map((r) => (r.productId === row.productId ? { ...r, isFlagship: nextValue } : r)));
    try {
      await api.setFlagship(row.productId, nextValue);
    } catch (err) {
      setError(err.message);
      setStock((s) => s.map((r) => (r.productId === row.productId ? { ...r, isFlagship: !nextValue } : r)));
    }
  }

  async function exportCsv() {
    const ok = await confirm({
      title: 'Export CSV?',
      message: `Export ${filteredRows.length} row(s) to a CSV file?`,
      confirmLabel: 'Export',
    });
    if (!ok) return;

    const headers = isSummary
      ? ['Device Model', 'Variant', 'SKU', 'Category', 'Brand', 'Total On Hand', 'Stores Carrying', 'Flagship', 'Status', 'Last Updated']
      : ['Device Model', 'Variant', 'SKU', 'Category', 'Brand', 'On Hand', 'Flagship', 'Status', 'Last Updated'];
    const csvRows = filteredRows.map((r) => {
      const base = [r.deviceModel, r.variantName || '', r.sku, r.category || '', r.brand || '', r.quantity];
      if (isSummary) base.push(r.storeCount);
      base.push(r.isFlagship ? 'Yes' : 'No');
      base.push(r.status || '');
      base.push(r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '');
      return base;
    });
    const storeName = isSummary ? 'all-stores' : (stores.find((s) => String(s.id) === storeId)?.name || 'store');
    downloadCsv(`stock-${storeName}.csv`, headers, csvRows);
  }

  return (
    <>
      <PageHeader>Stock View</PageHeader>
      <div className="py-8">
        <div className="max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
          <Card>
            {error && (
              <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
                {error}
              </div>
            )}
            {stores.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No stores yet — upload an inventory file first.</p>
            ) : (
              <TableFrame>
                <select
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 w-64"
                >
                  <option value={ALL_STORES}>— All Stores (Summary) —</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>

                {isSummary && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Stores</div>
                      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{stores.length}</div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">SKUs Tracked</div>
                      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{stock.length}</div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total On Hand</div>
                      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{totalOnHand}</div>
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  <TableToolbar
                    search={search} onSearchChange={setSearch} searchPlaceholder="Search device, variant, or SKU…"
                    showFlagshipFilter flagshipOnly={flagshipOnly} onFlagshipChange={setFlagshipOnly}
                    showQtyFilter minQty={minQty} onMinQtyChange={setMinQty} maxQty={maxQty} onMaxQtyChange={setMaxQty}
                    showCategoryFilter categoryFilter={categoryFilter} onCategoryChange={setCategoryFilter} categoryOptions={categoryOptions}
                    showBrandFilter brandFilter={brandFilter} onBrandChange={setBrandFilter} brandOptions={brandOptions}
                    pageSize={pageSize} onPageSizeChange={setPageSize}
                    onExport={exportCsv}
                  />
                </div>

                <ZoomArea>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400">
                        <th className="px-3 py-2">Device Model</th>
                        <th className="px-3 py-2">Variant</th>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2">Brand</th>
                        <th className="px-3 py-2 text-right">{isSummary ? 'Total On Hand' : 'On Hand'}</th>
                        {isSummary && <th className="px-3 py-2 text-right">Stores Carrying</th>}
                        <th className="px-3 py-2">Flagship</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Last Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {pageRows.map((row) => (
                        <tr key={row.productId}>
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{row.deviceModel}</td>
                          <td className="px-3 py-2">{row.variantName || '—'}</td>
                          <td className="px-3 py-2">{row.sku}</td>
                          <td className="px-3 py-2">{row.category || '—'}</td>
                          <td className="px-3 py-2">{row.brand || '—'}</td>
                          <td className="px-3 py-2 text-right">{row.quantity}</td>
                          {isSummary && <td className="px-3 py-2 text-right">{row.storeCount}</td>}
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={row.isFlagship}
                              onChange={(e) => handleFlagshipChange(e, row)}
                              className="rounded border-gray-300 dark:border-gray-700 text-indigo-600 shadow-sm focus:ring-indigo-500 dark:focus:ring-indigo-600 dark:bg-gray-900"
                            />
                          </td>
                          <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                      {stock.length === 0 && (
                        <tr><td colSpan={isSummary ? 10 : 9} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">
                          {isSummary ? 'No stock recorded yet.' : 'No stock recorded for this store yet.'}
                        </td></tr>
                      )}
                      {stock.length > 0 && pageRows.length === 0 && (
                        <tr><td colSpan={isSummary ? 10 : 9} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No rows match your search/filter.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                </ZoomArea>
                <Pagination page={page} pageCount={pageCount} total={total} start={start} count={pageRows.length} setPage={setPage} />
              </TableFrame>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
