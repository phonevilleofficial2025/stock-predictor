import SecondaryButton from './SecondaryButton.jsx';

export default function Pagination({ page, pageCount, total, start, count, setPage }) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mt-4 text-sm text-gray-500 dark:text-gray-400">
      <span>Showing {count === 0 ? 0 : start + 1}–{start + count} of {total}</span>
      <div className="flex items-center gap-3">
        <SecondaryButton onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Prev</SecondaryButton>
        <span>Page {page} of {pageCount}</span>
        <SecondaryButton onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>Next</SecondaryButton>
      </div>
    </div>
  );
}
