import { useMemo, useState } from 'react';
import TableFrame, { ZoomArea } from '../TableFrame.jsx';

export default function PreviewTable({ preview }) {
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
