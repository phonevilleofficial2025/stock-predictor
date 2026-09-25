export default function PageHeader({ children, actions }) {
  return (
    <header className="bg-white dark:bg-gray-800 shadow">
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
        <h2 className="font-semibold text-xl text-gray-800 dark:text-gray-200 leading-tight">{children}</h2>
        {actions}
      </div>
    </header>
  );
}
