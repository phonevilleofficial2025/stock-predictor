export default function Card({ className = '', children }) {
  return (
    <div className={`bg-white dark:bg-gray-800 shadow-sm sm:rounded-lg p-6 ${className}`}>
      {children}
    </div>
  );
}
