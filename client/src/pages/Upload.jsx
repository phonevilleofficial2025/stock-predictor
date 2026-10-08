import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';
import SecondaryButton from '../components/SecondaryButton.jsx';
import TableFrame, { ZoomArea } from '../components/TableFrame.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { formatWeekNumber } from '../utils/week.js';

function sundayOnOrBefore(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

// Retail week-of-year (Sunday-Saturday, Week 1 starts on the Sunday on/before Jan 1st)
// — mirrors the server's calculation so the mapped Sale Date column can be previewed
// client-side before committing; the server recomputes it authoritatively over the
// full file.
function retailWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  let year = d.getUTCFullYear();
  let week1Start = sundayOnOrBefore(new Date(Date.UTC(year, 0, 1)));

  if (d < week1Start) {
    year -= 1;
    week1Start = sundayOnOrBefore(new Date(Date.UTC(year, 0, 1)));
  } else {
    const nextWeek1Start = sundayOnOrBefore(new Date(Date.UTC(year + 1, 0, 1)));
    if (d >= nextWeek1Start) {
      year += 1;
      week1Start = nextWeek1Start;
    }
  }

  const retailWeek = Math.floor((d - week1Start) / (7 * 24 * 3600 * 1000)) + 1;
  return { retailYear: year, retailWeek };
}

function MappingForm({ preview, mapping, setMapping }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 my-4">
      {preview.fields.map((f) => (
        <div key={f.key}>
          <label className="block font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">
            {f.label}{f.required ? ' *' : ''}
          </label>
          <select
            value={mapping[f.key] || ''}
            onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))}
            className="w-full border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 text-sm"
          >
            <option value="">— not mapped —</option>
            {preview.headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function PreviewTable({ preview }) {
  const [search, setSearch] = useState('');

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return preview.previewRows;
    return preview.previewRows.filter((row) => row.some((cell) => String(cell ?? '').toLowerCase().includes(q)));
  }, [preview.previewRows, search]);

  return (
    <TableFrame>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search preview…"
        className="w-full sm:w-64 mb-2 border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 text-sm"
      />
      <ZoomArea>
        <div className="overflow-auto max-h-96 border border-gray-200 dark:border-gray-700 rounded-md">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="sticky top-0 bg-white dark:bg-gray-800">
              <tr className="text-left text-gray-500 dark:text-gray-400">
                {preview.headers.map((h) => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filteredRows.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j} className="px-3 py-2 whitespace-nowrap">{cell}</td>)}</tr>
              ))}
              {filteredRows.length === 0 && (
                <tr><td colSpan={preview.headers.length} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No rows match your search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </ZoomArea>
    </TableFrame>
  );
}

function UploadCard({ fileType, title, description, onCommitted }) {
  const confirm = useConfirm();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [cpfrDate, setCpfrDate] = useState('');

  const detectedWeek = useMemo(() => {
    if (fileType !== 'sales' || !preview || !mapping.saleDate) return null;
    const colIndex = preview.headers.indexOf(mapping.saleDate);
    if (colIndex === -1) return null;
    const dates = preview.previewRows
      .map((row) => row[colIndex])
      .filter(Boolean)
      .map((v) => new Date(v))
      .filter((d) => !Number.isNaN(d.getTime()));
    if (dates.length === 0) return null;
    const min = new Date(Math.min(...dates));
    const { retailYear, retailWeek } = retailWeekInfo(min);
    return `${retailYear}-W${String(retailWeek).padStart(2, '0')}`;
  }, [fileType, preview, mapping.saleDate]);

  // CPFR cycle files carry no date/week column — the week is picked by hand here
  // instead, then resolved through the same retail-week math the sales upload uses.
  const cpfrWeek = useMemo(() => {
    if (fileType !== 'cpfr' || !cpfrDate) return null;
    const d = new Date(cpfrDate);
    if (Number.isNaN(d.getTime())) return null;
    const { retailYear, retailWeek } = retailWeekInfo(d);
    return `${retailYear}-W${String(retailWeek).padStart(2, '0')}`;
  }, [fileType, cpfrDate]);

  async function handleFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setResult(null);
    setCpfrDate('');
    setBusy(true);
    try {
      const p = await api.previewUpload(fileType, f);
      setPreview(p);
      setMapping(p.suggestedMapping || {});
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (fileType === 'cpfr' && !cpfrDate) {
      setError('Pick a date first, so this upload can be assigned to the right week.');
      return;
    }
    const ok = await confirm({
      title: fileType === 'inventory' ? 'Commit inventory upload?' : fileType === 'sales' ? 'Commit sales upload?' : 'Commit CPFR upload?',
      message: fileType === 'inventory'
        ? `This will overwrite on-hand stock for every matched product in "${file?.name}" (${preview.rowCount} row(s)), and zero out any product a store previously carried that isn't in this file anymore. This cannot be undone. Continue?`
        : fileType === 'sales'
          ? `This will save sell-out totals for week ${detectedWeek || '(unknown)'} from "${file?.name}" (${preview.rowCount} row(s)). This cannot be undone. Continue?`
          : `This will add each alias's summed quantity from "${file?.name}" (${preview.rowCount} row(s)) on top of week ${cpfrWeek}'s existing Weekly CPFR value. This cannot be undone. Continue?`,
      confirmLabel: 'Commit',
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      let res;
      if (fileType === 'inventory') {
        res = await api.commitInventory({ uploadId: preview.uploadId, mapping });
      } else if (fileType === 'sales') {
        res = await api.commitSales({ uploadId: preview.uploadId, mapping });
      } else {
        res = await api.commitCpfr({ uploadId: preview.uploadId, mapping, date: cpfrDate });
      }
      setResult(res);
      setPreview(null);
      setFile(null);
      setCpfrDate('');
      onCommitted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{description}</p>

      <div className="flex items-center gap-3">
        <input
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="block text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-indigo-50 file:text-indigo-700 dark:file:bg-indigo-900 dark:file:text-indigo-200"
        />
        {busy && <span className="text-sm text-gray-500 dark:text-gray-400">Working…</span>}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 px-3 py-2 rounded text-sm mt-3">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-200 px-4 py-3 rounded mt-3">
          {fileType === 'inventory'
            ? <>Stock updated for {result.rowsUpdated} row(s){result.rowsZeroed ? <> — {result.rowsZeroed} product(s) no longer in this file were zeroed out</> : null}.</>
            : fileType === 'sales'
              ? <>Week {result.weekLabel} sales saved for {result.productsUpdated} product(s).</>
              : <>Week {result.weekLabel} CPFR updated for {result.aliasesUpdated} alias(es){result.skippedCount ? <> — {result.skippedCount} row(s) had a non-numeric quantity and were skipped</> : null}.</>}
        </div>
      )}

      {preview && (
        <>
          {preview.autoApplied && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">Column mapping auto-applied from a previous upload of this file format.</p>
          )}
          <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-4">Preview ({preview.rowCount} rows)</h4>
          <div className="mt-2">
            <PreviewTable preview={preview} />
          </div>

          <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-4">Map columns</h4>
          <MappingForm preview={preview} mapping={mapping} setMapping={setMapping} />

          {fileType === 'sales' && (
            <div className="flex flex-wrap gap-4 items-start mb-4">
              <div>
                <label className="block font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">Detected Week</label>
                <div className="border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-md px-3 py-2 text-sm font-medium text-gray-900 dark:text-gray-100 min-w-[9rem]">
                  {detectedWeek || (mapping.saleDate ? '—' : 'Map "Sale Date" below')}
                </div>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
                Calculated automatically from the dates in this file (retail week, Sunday–Saturday) — no need to enter it.
                Only weekly sell-out files are accepted — the date range must span a single 7-day week.
              </p>
            </div>
          )}

          {fileType === 'cpfr' && (
            <div className="flex flex-wrap gap-4 items-start mb-4">
              <div>
                <label className="block font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">Date (picks the week)</label>
                <input
                  type="date"
                  value={cpfrDate}
                  onChange={(e) => setCpfrDate(e.target.value)}
                  className="border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">Week</label>
                <div className="border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-md px-3 py-2 text-sm font-medium text-gray-900 dark:text-gray-100 min-w-[9rem]">
                  {cpfrWeek || '—'}
                </div>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
                This file has no date column, so pick any date that falls in the week you're planning — the retail week
                (Sunday–Saturday) it belongs to is resolved automatically. Rows sharing an alias are summed into one
                quantity, added on top of that week's existing Weekly CPFR value for each alias.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <PrimaryButton type="button" onClick={handleCommit} disabled={busy || (fileType === 'cpfr' && !cpfrDate)}>Confirm &amp; Update</PrimaryButton>
            <SecondaryButton onClick={() => { setPreview(null); setFile(null); setCpfrDate(''); }} disabled={busy}>Cancel</SecondaryButton>
          </div>
        </>
      )}
    </Card>
  );
}

function UploadHistory({ history }) {
  return (
    <Card>
      <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">Upload History</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">This list is saved on the server, so it stays here even after you refresh the page.</p>
      {history.length === 0 ? (
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
              {history.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{u.filename}</td>
                  <td className="px-3 py-2">{u.file_type}</td>
                  <td className="px-3 py-2 text-right">{u.row_count}</td>
                  <td className="px-3 py-2 text-right">{u.week_number != null ? formatWeekNumber(u.week_number) : '—'}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{u.uploaded_at ? new Date(u.uploaded_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function Upload() {
  const [history, setHistory] = useState([]);

  function reloadHistory() {
    api.uploadHistory().then(setHistory).catch(() => {});
  }

  useEffect(() => { reloadHistory(); }, []);

  return (
    <>
      <PageHeader>Upload</PageHeader>
      <div className="py-8">
        <div className="max-w-7xl mx-auto sm:px-6 lg:px-8 space-y-6">
          <UploadCard
            fileType="inventory"
            title="Inventory Upload"
            description="Updates each store's on-hand stock to match the quantities in this file (overwrites, does not add to existing stock). Any product a store carried before that isn't in this file anymore is zeroed out, not left stale."
            onCommitted={reloadHistory}
          />
          <UploadCard
            fileType="sales"
            title="Sales-per-Serial-No Upload"
            description="Summarizes total sell-out per product (across all stores) for one week. The week is detected automatically from the file's dates."
            onCommitted={reloadHistory}
          />
          <UploadCard
            fileType="cpfr"
            title="CPFR Upload"
            description={'Loads a CPFR cycle file (e.g. a "BSD Alias" export) into the CPFR sheet. Rows sharing an alias are combined into one quantity, added to that alias’s existing Weekly CPFR value. This file has no date column, so you pick the week it applies to at upload time.'}
            onCommitted={reloadHistory}
          />
          <UploadHistory history={history} />
        </div>
      </div>
    </>
  );
}
