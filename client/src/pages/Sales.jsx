import { useEffect, useState } from 'react';
import { api } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Badge from '../components/Badge.jsx';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import TableToolbar from '../components/TableToolbar.jsx';
import Pagination from '../components/Pagination.jsx';
import TableFrame, { ZoomArea } from '../components/TableFrame.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useFilteredTable } from '../hooks/useFilteredTable.js';
import { downloadCsv } from '../utils/csv.js';
import { formatWeekNumber } from '../utils/week.js';

export default function Sales() {
  const confirm = useConfirm();
  const [sales, setSales] = useState({ weeks: [], table: [] });
  const [predictions, setPredictions] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const {
    search, setSearch, flagshipOnly, setFlagshipOnly, minQty, setMinQty, maxQty, setMaxQty,
    categoryFilter, setCategoryFilter, categoryOptions,
    brandFilter, setBrandFilter, brandOptions,
    page, setPage, pageSize, setPageSize, pageRows, filteredRows, total, pageCount, start,
  } = useFilteredTable(sales.table, {
    getSearchText: (r) => `${r.deviceModel} ${r.category || ''} ${r.brand || ''}`,
    getIsFlagship: (r) => r.isFlagship,
    getOnHand: (r) => r.onHand,
    getCategory: (r) => r.category,
    getBrand: (r) => r.brand,
  });

  async function exportCsv() {
    const ok = await confirm({ title: 'Export CSV?', message: `Export ${filteredRows.length} row(s) to a CSV file?`, confirmLabel: 'Export' });
    if (!ok) return;
    const headers = ['Product', 'Category', 'Brand', 'On Hand', ...sales.weeks.map((w) => `Week ${formatWeekNumber(w)}`)];
    const csvRows = filteredRows.map((row) => [row.deviceModel, row.category || '', row.brand || '', row.onHand, ...sales.weeks.map((w) => row.weeks[w] ?? 0)]);
    downloadCsv('sales.csv', headers, csvRows);
  }

  useEffect(() => {
    api.getSales().then(setSales).catch((e) => setError(e.message));
  }, []);

  async function generatePrediction() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.getPredictions();
      setPredictions(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader>Sales</PageHeader>
      <div className="py-8">
        <div className="max-w-7xl mx-auto sm:px-6 lg:px-8 space-y-6">
          <Card>
            <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
              <h3 className="font-medium text-gray-900 dark:text-gray-100">
                Total sell-out per device, by week (summed across all stores and variants)
              </h3>
              <PrimaryButton type="button" onClick={generatePrediction} disabled={busy || sales.table.length === 0}>
                Generate Prediction
              </PrimaryButton>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
                {error}
              </div>
            )}

            {sales.table.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No sales data yet — upload a sales-per-serialno file first.</p>
            ) : (
              <TableFrame>
                <TableToolbar
                  search={search} onSearchChange={setSearch} searchPlaceholder="Search device…"
                  showFlagshipFilter flagshipOnly={flagshipOnly} onFlagshipChange={setFlagshipOnly}
                  showQtyFilter minQty={minQty} onMinQtyChange={setMinQty} maxQty={maxQty} onMaxQtyChange={setMaxQty}
                  showCategoryFilter categoryFilter={categoryFilter} onCategoryChange={setCategoryFilter} categoryOptions={categoryOptions}
                  showBrandFilter brandFilter={brandFilter} onBrandChange={setBrandFilter} brandOptions={brandOptions}
                  pageSize={pageSize} onPageSizeChange={setPageSize}
                  onExport={exportCsv}
                />
                <ZoomArea>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400">
                        <th className="px-3 py-2 sticky left-0 bg-white dark:bg-gray-800">Product</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2">Brand</th>
                        <th className="px-3 py-2 text-right">On Hand</th>
                        {sales.weeks.map((w) => <th key={w} className="px-3 py-2 text-right whitespace-nowrap">Week {formatWeekNumber(w)}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {pageRows.map((row) => (
                        <tr key={row.deviceModel}>
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100 sticky left-0 bg-white dark:bg-gray-800">
                            {row.deviceModel}{row.isFlagship ? <Badge variant="flagship">Flagship</Badge> : null}
                          </td>
                          <td className="px-3 py-2">{row.category || '—'}</td>
                          <td className="px-3 py-2">{row.brand || '—'}</td>
                          <td className="px-3 py-2 text-right">{row.onHand}</td>
                          {sales.weeks.map((w) => <td key={w} className="px-3 py-2 text-right">{row.weeks[w] ?? 0}</td>)}
                        </tr>
                      ))}
                      {pageRows.length === 0 && (
                        <tr><td colSpan={4 + sales.weeks.length} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No rows match your search/filter.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                </ZoomArea>
                <Pagination page={page} pageCount={pageCount} total={total} start={start} count={pageRows.length} setPage={setPage} />
              </TableFrame>
            )}
          </Card>

          {predictions && (
            <Card>
              <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">
                Prediction {predictions.latestWeek ? `(Week ${predictions.priorWeek ? formatWeekNumber(predictions.priorWeek) : '—'} & ${formatWeekNumber(predictions.latestWeek)})` : ''}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                avg2wk = average sell-out of the last 2 weeks &middot; estimated sellout = avg2wk &times; 2 &middot; estimated on-hand = on-hand &minus; estimated sellout &middot; score = estimated on-hand &divide; avg2wk.
                Flagship devices are Healthy at score &ge; 4; other devices need score &gt; 8 to be Healthy.
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400">
                      <th className="px-3 py-2">Device</th>
                      <th className="px-3 py-2">Brand</th>
                      <th className="px-3 py-2 text-right">On Hand</th>
                      <th className="px-3 py-2 text-right">Avg 2-Wk Sellout</th>
                      <th className="px-3 py-2 text-right">Est. Sellout</th>
                      <th className="px-3 py-2 text-right">Est. On Hand</th>
                      <th className="px-3 py-2 text-right">Score</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Total CPFR</th>
                      <th className="px-3 py-2 text-right">Est. On Hand (w/ CPFR)</th>
                      <th className="px-3 py-2 text-right">Score (w/ CPFR)</th>
                      <th className="px-3 py-2">Status (w/ CPFR)</th>
                      <th className="px-3 py-2 text-right">Suggested Order (device)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {predictions.predictions.map((p) => (
                      <tr key={p.deviceModel}>
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                          {p.deviceModel}{p.isFlagship ? <Badge variant="flagship">Flagship</Badge> : null}
                        </td>
                        <td className="px-3 py-2">{p.brand || '—'}</td>
                        <td className="px-3 py-2 text-right">{p.onHand}</td>
                        <td className="px-3 py-2 text-right">{p.avg2wk}</td>
                        <td className="px-3 py-2 text-right">{p.estimatedSellout}</td>
                        <td className="px-3 py-2 text-right">{p.estimatedOnHand}</td>
                        <td className="px-3 py-2 text-right">{p.score !== null ? p.score.toFixed(2) : '—'}</td>
                        <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                        <td className="px-3 py-2 text-right">{p.totalCpfr}</td>
                        <td className="px-3 py-2 text-right">{p.estimatedOnHandWithCpfr}</td>
                        <td className="px-3 py-2 text-right">{p.scoreWithCpfr !== null ? p.scoreWithCpfr.toFixed(2) : '—'}</td>
                        <td className="px-3 py-2"><StatusBadge status={p.statusWithCpfr} /></td>
                        <td className="px-3 py-2 text-right">{p.suggestion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-6 mb-2">Suggested Order Split by Variant</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400">
                      <th className="px-3 py-2">Device</th>
                      <th className="px-3 py-2">Variant SKU</th>
                      <th className="px-3 py-2 text-right">Avg 2-Wk Sellout</th>
                      <th className="px-3 py-2 text-right">Suggested Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {predictions.predictions.flatMap((p) =>
                      p.variantSplit.map((v) => (
                        <tr key={v.sku}>
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{p.deviceModel}</td>
                          <td className="px-3 py-2">{v.sku}{v.variantName ? ` — ${v.variantName}` : ''}</td>
                          <td className="px-3 py-2 text-right">{v.avg2wk}</td>
                          <td className="px-3 py-2 text-right">{v.suggestedQty}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
