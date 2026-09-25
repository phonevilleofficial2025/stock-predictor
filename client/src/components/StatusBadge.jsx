const CLASSES = {
  Healthy: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  Moderate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  Critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export default function StatusBadge({ status }) {
  if (!status) return <span className="text-gray-400 dark:text-gray-500">—</span>;
  const cls = CLASSES[status] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {status}
    </span>
  );
}
