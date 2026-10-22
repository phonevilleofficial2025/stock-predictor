export default function MappingForm({ preview, mapping, setMapping }) {
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
