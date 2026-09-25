const VARIANTS = {
  flagship: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  rsi: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export default function Badge({ variant = 'gray', className = '', children }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 ms-2 rounded-full text-xs font-semibold ${VARIANTS[variant] || VARIANTS.gray} ${className}`}
    >
      {children}
    </span>
  );
}
