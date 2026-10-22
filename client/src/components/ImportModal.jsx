import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import PrimaryButton from './PrimaryButton.jsx';
import SecondaryButton from './SecondaryButton.jsx';
import MappingForm from './upload/MappingForm.jsx';
import PreviewTable from './upload/PreviewTable.jsx';
import { useConfirm } from './ConfirmDialog.jsx';
import { retailWeekInfo } from '../utils/retailWeek.js';

const TITLES = { inventory: 'Inventory Upload', sales: 'Sales-per-Serial-No Upload', cpfr: 'CPFR Upload' };
const SHORT_LABELS = { inventory: 'Inventory', sales: 'Sell-Out', cpfr: 'CPFR' };
const DESCRIPTIONS = {
  inventory: "Updates each store's on-hand stock to match the quantities in this file (overwrites, does not add to existing stock). Any product a store carried before that isn't in this file anymore is zeroed out, not left stale.",
  sales: "Summarizes total sell-out per product (across all stores) for one week. The week is detected automatically from the file's dates.",
  cpfr: "Loads a CPFR cycle file into the CPFR sheet. Rows sharing an alias are combined into one quantity, added to that alias's existing Weekly CPFR value. This file has no date column, so you pick the week it applies to at upload time.",
};

function Dropzone({ onFile, busy }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-10 cursor-pointer transition-colors ${
        dragOver ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
      }`}
    >
      <svg className="h-9 w-9 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-1-7.874A5 5 0 0115.9 6.1 4.5 4.5 0 0117.5 15M12 12v9m0-9l-3 3m3-3l3 3" />
      </svg>
      <p className="text-sm text-gray-600 dark:text-gray-300 text-center">
        <span className="font-medium text-indigo-600 dark:text-indigo-400">Click to select</span> or drag and drop a CSV file
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500">Max 20 MB</p>
      {busy && <span className="text-sm text-gray-500 dark:text-gray-400 mt-1">Working…</span>}
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files[0]; if (f) onFile(f); e.target.value = ''; }}
      />
    </div>
  );
}

// Lets the user pick which kind of file they're about to drop, when the caller
// offers more than one (e.g. the CPFR page accepts either a CPFR cycle file or a
// weekly sell-out file through the same button). Only shown before a file is
// picked — once there's a preview, the type is locked in for that pass.
function TypeSwitcher({ options, value, onChange }) {
  return (
    <div className="flex gap-2 mb-4">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
            opt === value
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          {SHORT_LABELS[opt]}
        </button>
      ))}
    </div>
  );
}

// Same preview -> map columns -> confirm flow as the Upload page's cards (see
// pages/Upload.jsx), reused here inside a popup instead of an always-visible page
// section, with drag-and-drop added. Pass a fixed `fileType` for a single-purpose
// entry point (e.g. Stock View's inventory-only Import button), or `fileTypes`
// (an array) to let the user choose at the top of the popup instead (e.g. the CPFR
// page accepting either a CPFR or a sell-out file through one button).
export default function ImportModal({ open, fileType, fileTypes, onClose, onCommitted }) {
  const options = fileTypes || [fileType || 'inventory'];
  const confirm = useConfirm();
  const [type, setType] = useState(options[0]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [cpfrDate, setCpfrDate] = useState('');

  // Start fresh every time the modal is opened, rather than showing whatever was
  // left over from the last time it was closed.
  useEffect(() => {
    if (!open) return;
    setType(options[0]);
    setFile(null);
    setPreview(null);
    setMapping({});
    setBusy(false);
    setError(null);
    setResult(null);
    setCpfrDate('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const detectedWeek = useMemo(() => {
    if (type !== 'sales' || !preview || !mapping.saleDate) return null;
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
  }, [type, preview, mapping.saleDate]);

  const cpfrWeek = useMemo(() => {
    if (type !== 'cpfr' || !cpfrDate) return null;
    const d = new Date(cpfrDate);
    if (Number.isNaN(d.getTime())) return null;
    const { retailYear, retailWeek } = retailWeekInfo(d);
    return `${retailYear}-W${String(retailWeek).padStart(2, '0')}`;
  }, [type, cpfrDate]);

  async function handleFile(f) {
    setFile(f);
    setError(null);
    setResult(null);
    setCpfrDate('');
    setBusy(true);
    try {
      const p = await api.previewUpload(type, f);
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
    if (type === 'cpfr' && !cpfrDate) {
      setError('Pick a date first, so this upload can be assigned to the right week.');
      return;
    }
    const ok = await confirm({
      title: type === 'inventory' ? 'Commit inventory upload?' : type === 'sales' ? 'Commit sales upload?' : 'Commit CPFR upload?',
      message: type === 'inventory'
        ? `This will overwrite on-hand stock for every matched product in "${file?.name}" (${preview.rowCount} row(s)), and zero out any product a store previously carried that isn't in this file anymore. This cannot be undone. Continue?`
        : type === 'sales'
          ? `This will save sell-out totals for week ${detectedWeek || '(unknown)'} from "${file?.name}" (${preview.rowCount} row(s)). This cannot be undone. Continue?`
          : `This will add each alias's summed quantity from "${file?.name}" (${preview.rowCount} row(s)) on top of week ${cpfrWeek}'s existing Weekly CPFR value. This cannot be undone. Continue?`,
      confirmLabel: 'Commit',
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      let res;
      if (type === 'inventory') {
        res = await api.commitInventory({ uploadId: preview.uploadId, mapping });
      } else if (type === 'sales') {
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

  function startOver() {
    setFile(null);
    setPreview(null);
    setMapping({});
    setError(null);
    setResult(null);
    setCpfrDate('');
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-full overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex justify-between items-start mb-1">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{TITLES[type]}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{DESCRIPTIONS[type]}</p>

        {error && (
          <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 px-3 py-2 rounded text-sm mb-3">
            {error}
          </div>
        )}

        {result && (
          <>
            <div className="bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-200 px-4 py-3 rounded mb-4">
              {type === 'inventory'
                ? <>Stock updated for {result.rowsUpdated} row(s){result.rowsZeroed ? <> — {result.rowsZeroed} product(s) no longer in this file were zeroed out</> : null}.</>
                : type === 'sales'
                  ? <>Week {result.weekLabel} sales saved for {result.productsUpdated} product(s).</>
                  : <>Week {result.weekLabel} CPFR updated for {result.aliasesUpdated} alias(es){result.skippedCount ? <> — {result.skippedCount} row(s) had a non-numeric quantity and were skipped</> : null}.</>}
            </div>
            <div className="flex gap-2">
              <SecondaryButton onClick={startOver}>Import Another</SecondaryButton>
              <PrimaryButton type="button" onClick={onClose}>Done</PrimaryButton>
            </div>
          </>
        )}

        {!preview && !result && (
          <>
            {options.length > 1 && <TypeSwitcher options={options} value={type} onChange={setType} />}
            <Dropzone onFile={handleFile} busy={busy} />
          </>
        )}

        {preview && (
          <>
            {preview.autoApplied && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Column mapping auto-applied from a previous upload of this file format.</p>
            )}
            <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-4">Preview ({preview.rowCount} rows)</h4>
            <div className="mt-2">
              <PreviewTable preview={preview} />
            </div>

            <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-4">Map columns</h4>
            <MappingForm preview={preview} mapping={mapping} setMapping={setMapping} />

            {type === 'sales' && (
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

            {type === 'cpfr' && (
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
              <PrimaryButton type="button" onClick={handleCommit} disabled={busy || (type === 'cpfr' && !cpfrDate)}>Confirm &amp; Update</PrimaryButton>
              <SecondaryButton onClick={startOver} disabled={busy}>Cancel</SecondaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
