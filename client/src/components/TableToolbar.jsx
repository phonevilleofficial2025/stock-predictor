import { PAGE_SIZE_OPTIONS } from '../hooks/useFilteredTable.js';
import SecondaryButton from './SecondaryButton.jsx';

const inputCls = 'border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 text-sm';
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

export default function TableToolbar({
  search, onSearchChange, searchPlaceholder = 'Search…',
  showFlagshipFilter = false, flagshipOnly, onFlagshipChange,
  showQtyFilter = false, minQty, onMinQtyChange, maxQty, onMaxQtyChange,
  showCategoryFilter = false, categoryFilter, onCategoryChange, categoryOptions = [],
  showBrandFilter = false, brandFilter, onBrandChange, brandOptions = [],
  pageSize, onPageSizeChange, pageSizeOptions = PAGE_SIZE_OPTIONS,
  onExport,
}) {
  return (
    <div className="flex flex-wrap items-end gap-4 mb-4">
      <div className="flex-1 min-w-[180px]">
        <label className={labelCls}>Search</label>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className={`w-full ${inputCls}`}
        />
      </div>

      {showQtyFilter && (
        <div className="flex items-end gap-2">
          <div>
            <label className={labelCls}>Min On Hand</label>
            <input type="number" value={minQty} onChange={(e) => onMinQtyChange(e.target.value)} className={`w-24 ${inputCls}`} />
          </div>
          <div>
            <label className={labelCls}>Max On Hand</label>
            <input type="number" value={maxQty} onChange={(e) => onMaxQtyChange(e.target.value)} className={`w-24 ${inputCls}`} />
          </div>
        </div>
      )}

      {showCategoryFilter && (
        <div>
          <label className={labelCls}>Category</label>
          <select value={categoryFilter} onChange={(e) => onCategoryChange(e.target.value)} className={`w-40 ${inputCls}`}>
            <option value="ALL">All Categories</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      {showBrandFilter && (
        <div>
          <label className={labelCls}>Brand</label>
          <select value={brandFilter} onChange={(e) => onBrandChange(e.target.value)} className={`w-40 ${inputCls}`}>
            <option value="ALL">All Brands</option>
            {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      )}

      {showFlagshipFilter && (
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-2 whitespace-nowrap">
          <input
            type="checkbox"
            checked={flagshipOnly}
            onChange={(e) => onFlagshipChange(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-700 text-indigo-600 shadow-sm focus:ring-indigo-500 dark:focus:ring-indigo-600 dark:bg-gray-900"
          />
          Flagship only
        </label>
      )}

      {onPageSizeChange && (
        <div>
          <label className={labelCls}>Show</label>
          <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} className={inputCls}>
            {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}

      {onExport && (
        <SecondaryButton onClick={onExport}>Export CSV</SecondaryButton>
      )}
    </div>
  );
}
