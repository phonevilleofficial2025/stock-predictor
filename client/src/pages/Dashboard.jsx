import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Badge from '../components/Badge.jsx';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Pagination from '../components/Pagination.jsx';
import SecondaryButton from '../components/SecondaryButton.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { PAGE_SIZE_OPTIONS } from '../hooks/useFilteredTable.js';
import { formatWeekNumber } from '../utils/week.js';
import { downloadCsv } from '../utils/csv.js';

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const inputCls = 'border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 text-sm';
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

const KPI_VALUE_CLASSES = {
  default: 'text-gray-900 dark:text-gray-100',
  Healthy: 'text-green-600 dark:text-green-400',
  Moderate: 'text-yellow-600 dark:text-yellow-400',
  Critical: 'text-red-600 dark:text-red-400',
};

function KpiCard({ label, value, tone = 'default' }) {
  return (
    <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-4">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${KPI_VALUE_CLASSES[tone]}`}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const confirm = useConfirm();
  const [stores, setStores] = useState([]);
  const [devices, setDevices] = useState([]);
  const [predictions, setPredictions] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState(null);

  const [attnSearch, setAttnSearch] = useState('');
  const [attnStatusFilter, setAttnStatusFilter] = useState('attention');
  const [attnBrandFilter, setAttnBrandFilter] = useState('ALL');
  const [attnPage, setAttnPage] = useState(1);
  const [attnPageSize, setAttnPageSize] = useState(20);

  const [warnSearch, setWarnSearch] = useState('');
  const [warnStoreFilter, setWarnStoreFilter] = useState('OVERALL');
  const [warnPage, setWarnPage] = useState(1);
  const [warnPageSize, setWarnPageSize] = useState(20);

  useEffect(() => {
    const month = currentMonth();
    Promise.all([
      api.getStores(),
      api.getDevices(),
      api.getPredictions(),
      api.uploadHistory(),
      api.getRsiWarnings(month),
    ])
      .then(([s, d, p, u, w]) => {
        setStores(s);
        setDevices(d);
        setPredictions(p);
        setUploads(u.slice(0, 5));
        setWarnings(w.warnings);
      })
      .catch((e) => setError(e.message));
  }, []);

  const preds = predictions?.predictions ?? [];
  const totalOnHand = preds.reduce((sum, p) => sum + p.onHand, 0);
  const counts = preds.reduce(
    (acc, p) => {
      if (p.status) acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    },
    { Healthy: 0, Moderate: 0, Critical: 0 }
  );

  const attnBrandOptions = useMemo(
    () => Array.from(new Set(preds.map((p) => p.brand).filter(Boolean))).sort(),
    [preds]
  );

  const attentionFiltered = useMemo(() => {
    const q = attnSearch.trim().toLowerCase();
    return preds
      .filter((p) => {
        if (attnStatusFilter === 'attention') return p.status === 'Critical' || p.status === 'Moderate';
        if (attnStatusFilter === 'all') return true;
        return p.status === attnStatusFilter;
      })
      .filter((p) => attnBrandFilter === 'ALL' || p.brand === attnBrandFilter)
      .filter((p) => !q || p.deviceModel.toLowerCase().includes(q))
      .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity));
  }, [preds, attnSearch, attnStatusFilter, attnBrandFilter]);

  const attnTotal = attentionFiltered.length;
  const attnPageCount = Math.max(1, Math.ceil(attnTotal / attnPageSize));
  const attnCurrentPage = Math.min(attnPage, attnPageCount);
  const attnStart = (attnCurrentPage - 1) * attnPageSize;
  const attentionPageRows = attentionFiltered.slice(attnStart, attnStart + attnPageSize);

  function updateAttnSearch(value) {
    setAttnSearch(value);
    setAttnPage(1);
  }
  function updateAttnStatusFilter(value) {
    setAttnStatusFilter(value);
    setAttnPage(1);
  }
  function updateAttnBrandFilter(value) {
    setAttnBrandFilter(value);
    setAttnPage(1);
  }
  function updateAttnPageSize(value) {
    setAttnPageSize(value);
    setAttnPage(1);
  }

  async function exportAttentionCsv() {
    const ok = await confirm({ title: 'Export CSV?', message: `Export ${attentionFiltered.length} row(s) to a CSV file?`, confirmLabel: 'Export' });
    if (!ok) return;
    const headers = ['Device', 'Brand', 'On Hand', 'Avg 2-Wk Sellout', 'Score', 'Status', 'Suggested Order'];
    const csvRows = attentionFiltered.map((p) => [
      p.deviceModel, p.brand || '', p.onHand, p.avg2wk, p.score !== null ? p.score.toFixed(2) : '', p.status || '', p.suggestion,
    ]);
    downloadCsv('devices-needing-attention.csv', headers, csvRows);
  }

  const warnStoreNames = useMemo(
    () => Array.from(new Set(warnings.map((w) => w.storeName))).sort(),
    [warnings]
  );
  const warningsFiltered = useMemo(() => {
    const q = warnSearch.trim().toLowerCase();
    return warnings
      .filter((w) => warnStoreFilter === 'OVERALL' || w.storeName === warnStoreFilter)
      .filter((w) => !q || w.storeName.toLowerCase().includes(q) || w.deviceModel.toLowerCase().includes(q));
  }, [warnings, warnSearch, warnStoreFilter]);

  const warnTotal = warningsFiltered.length;
  const warnPageCount = Math.max(1, Math.ceil(warnTotal / warnPageSize));
  const warnCurrentPage = Math.min(warnPage, warnPageCount);
  const warnStart = (warnCurrentPage - 1) * warnPageSize;
  const warningsPageRows = warningsFiltered.slice(warnStart, warnStart + warnPageSize);

  function updateWarnSearch(value) {
    setWarnSearch(value);
    setWarnPage(1);
  }
  function updateWarnStoreFilter(value) {
    setWarnStoreFilter(value);
    setWarnPage(1);
  }
  function updateWarnPageSize(value) {
    setWarnPageSize(value);
    setWarnPage(1);
  }

  return (
    <>
      <PageHeader>Dashboard</PageHeader>

      <div className="py-8">
        <div className="max-w-7xl mx-auto sm:px-6 lg:px-8 space-y-6">
          {error && (
            <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
            <KpiCard label="Stores" value={stores.length} />
            <KpiCard label="Devices Tracked" value={devices.length} />
            <KpiCard label="Total On Hand" value={totalOnHand} />
            <KpiCard label="Latest Week" value={predictions?.latestWeek ? formatWeekNumber(predictions.latestWeek) : '—'} />
            <KpiCard label="Healthy" value={counts.Healthy} tone="Healthy" />
            <KpiCard label="Moderate" value={counts.Moderate} tone="Moderate" />
            <KpiCard label="Critical" value={counts.Critical} tone="Critical" />
          </div>

          <Card>
            <div className="flex justify-between items-baseline mb-4">
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Devices Needing Attention</h3>
              <SecondaryButton onClick={exportAttentionCsv} disabled={preds.length === 0}>Export CSV</SecondaryButton>
            </div>
            {preds.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No prediction data yet — upload inventory and sales files, then visit CPFR to generate a prediction.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-4 mb-4">
                  <div className="flex-1 min-w-[180px]">
                    <label className={labelCls}>Search</label>
                    <input
                      type="text"
                      value={attnSearch}
                      onChange={(e) => updateAttnSearch(e.target.value)}
                      placeholder="Search device…"
                      className={`w-full ${inputCls}`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Status</label>
                    <select value={attnStatusFilter} onChange={(e) => updateAttnStatusFilter(e.target.value)} className={inputCls}>
                      <option value="attention">Needs Attention (Critical + Moderate)</option>
                      <option value="all">All</option>
                      <option value="Critical">Critical</option>
                      <option value="Moderate">Moderate</option>
                      <option value="Healthy">Healthy</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Brand</label>
                    <select value={attnBrandFilter} onChange={(e) => updateAttnBrandFilter(e.target.value)} className={`w-40 ${inputCls}`}>
                      <option value="ALL">All Brands</option>
                      {attnBrandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Show</label>
                    <select value={attnPageSize} onChange={(e) => updateAttnPageSize(Number(e.target.value))} className={inputCls}>
                      {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400">
                        <th className="px-3 py-2">Device</th>
                        <th className="px-3 py-2">Brand</th>
                        <th className="px-3 py-2 text-right">On Hand</th>
                        <th className="px-3 py-2 text-right">Avg 2-Wk Sellout</th>
                        <th className="px-3 py-2 text-right">Score</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Suggested Order</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {attentionPageRows.map((p) => (
                        <tr key={p.deviceModel}>
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                            {p.deviceModel}{p.isFlagship ? <Badge variant="flagship">Flagship</Badge> : null}
                          </td>
                          <td className="px-3 py-2">{p.brand || '—'}</td>
                          <td className="px-3 py-2 text-right">{p.onHand}</td>
                          <td className="px-3 py-2 text-right">{p.avg2wk}</td>
                          <td className="px-3 py-2 text-right">{p.score !== null ? p.score.toFixed(2) : '—'}</td>
                          <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                          <td className="px-3 py-2 text-right">{p.suggestion}</td>
                        </tr>
                      ))}
                      {attentionPageRows.length === 0 && (
                        <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No devices match your search/filter.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination page={attnCurrentPage} pageCount={attnPageCount} total={attnTotal} start={attnStart} count={attentionPageRows.length} setPage={setAttnPage} />
              </>
            )}
          </Card>

          <Card>
            <div className="flex justify-between items-baseline mb-4">
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Critical Devices at RSI Stores</h3>
              <Link to="/rsi" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">Manage RSI &rarr;</Link>
            </div>
            {warnings.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No RSI store currently stocks a Critical-level device (or no RSI stores set for this month).</p>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-4 mb-4">
                  <div className="flex-1 min-w-[180px]">
                    <label className={labelCls}>Search</label>
                    <input
                      type="text"
                      value={warnSearch}
                      onChange={(e) => updateWarnSearch(e.target.value)}
                      placeholder="Search store or device…"
                      className={`w-full ${inputCls}`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Store</label>
                    <select value={warnStoreFilter} onChange={(e) => updateWarnStoreFilter(e.target.value)} className={`w-56 ${inputCls}`}>
                      <option value="OVERALL">Overall (all RSI stores)</option>
                      {warnStoreNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Show</label>
                    <select value={warnPageSize} onChange={(e) => updateWarnPageSize(Number(e.target.value))} className={inputCls}>
                      {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>

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
                      {warningsPageRows.map((w, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{w.storeName}<Badge variant="rsi">RSI</Badge></td>
                          <td className="px-3 py-2">{w.deviceModel}<Badge variant="critical">Critical</Badge></td>
                          <td className="px-3 py-2 text-right">{w.quantity}</td>
                        </tr>
                      ))}
                      {warningsPageRows.length === 0 && (
                        <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No warnings match your search/filter.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pagination page={warnCurrentPage} pageCount={warnPageCount} total={warnTotal} start={warnStart} count={warningsPageRows.length} setPage={setWarnPage} />
              </>
            )}
          </Card>

          <Card>
            <div className="flex justify-between items-baseline mb-4">
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Recent Uploads</h3>
              <Link to="/upload" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">Upload a file &rarr;</Link>
            </div>
            {uploads.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No uploads yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400">
                      <th className="px-3 py-2">File</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2 text-right">Rows</th>
                      <th className="px-3 py-2 text-right">Week</th>
                      <th className="px-3 py-2">Uploaded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {uploads.map((u) => (
                      <tr key={u.id}>
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{u.filename}</td>
                        <td className="px-3 py-2">{u.file_type}</td>
                        <td className="px-3 py-2 text-right">{u.row_count}</td>
                        <td className="px-3 py-2 text-right">{u.week_number ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{u.uploaded_at ? new Date(u.uploaded_at).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
