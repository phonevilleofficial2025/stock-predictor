import { useState } from 'react';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';

const sections = [
  {
    id: 'start',
    title: 'Getting started',
    body: (
      <>
        <p>Sign in with your admin account. Use the profile icon (top right) to switch dark/light mode, open Account Settings (change username or password) or sign out.</p>
        <p className="font-medium">Recommended order</p>
        <ol className="list-decimal ms-5 space-y-1">
          <li>Upload your inventory file.</li>
          <li>Upload your sales file, one week at a time.</li>
          <li>Tick the flagship devices in Stock View.</li>
          <li>Review the Dashboard for devices needing attention.</li>
          <li>On the CPFR sheet, plan CPFR, then track Balance and Product Order in place.</li>
          <li>Mark RSI stores for the month and check the warnings.</li>
        </ol>
      </>
    ),
  },
  {
    id: 'tables',
    title: 'Table tools (all pages)',
    body: (
      <ul className="list-disc ms-5 space-y-1">
        <li><b>Search and filters</b> – search text, min/max on-hand, category, brand and flagship-only where the page supports them.</li>
        <li><b>Show</b> – choose how many rows per page; use the pagination under the table. (The CPFR sheet scrolls instead of paginating, like a real spreadsheet.)</li>
        <li><b>Zoom and full screen</b> – the − / + buttons scale only the table; the controls stay fixed. The corner button toggles full screen.</li>
        <li><b>Export CSV</b> – exports the rows currently filtered.</li>
        <li>Uploads and Stock View/RSI edits ask for confirmation first. On the CPFR sheet, editable (amber) cells save instantly in the background instead — watch for a small dot on the cell while it saves.</li>
      </ul>
    ),
  },
  {
    id: 'upload',
    title: 'Upload',
    body: (
      <>
        <p>The Upload tab has three cards: <b>Inventory Upload</b>, <b>Sales-per-Serial-No Upload</b>, and <b>CPFR Upload</b>. Choose a CSV (max 20 MB), review the preview (scroll, search and zoom are available), check the column mapping and import. Mappings are remembered for files with the same headers.</p>
        <ul className="list-disc ms-5 space-y-1">
          <li><b>Inventory</b> – required: Store, Product/SKU, Device Model, Quantity. Optional: Variant Name, Category, Brand. Importing <b>overwrites</b> the on-hand quantity for those store/SKU pairs, and <b>zeroes out</b> any product a store carried before that isn't in this file anymore — it won't stay stuck at its last nonzero quantity. New stores and products are created automatically.</li>
          <li><b>Sales</b> – required: Product/SKU, Device Model, Store, Sale Date. Each row is one unit sold. The file must cover a single week; the week is detected automatically from the dates using retail weeks (Sunday to Saturday). Re-uploading the same week replaces it.</li>
          <li><b>CPFR</b> – required: Alias, Quantity. For a cycle file keyed by alias (e.g. a "BSD Alias" export) rather than by device model. Rows sharing an alias are summed into one quantity, added to that alias's existing Weekly CPFR value. The file has no date column, so you pick a date at upload time — the retail week it falls in is resolved automatically, the same way the Sales upload detects its week.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'stock',
    title: 'Stock View',
    body: (
      <ul className="list-disc ms-5 space-y-1">
        <li>Pick a store, or choose <b>All Stores</b> for the overall summary.</li>
        <li>Tick the <b>Flagship</b> checkbox for flagship devices. They use the lower Healthy threshold (score of 4 instead of 8) — this feeds the Status columns on the CPFR sheet.</li>
        <li><b>Status</b> (Healthy / Moderate / Critical) shows once at least one week of sales is uploaded.</li>
        <li>Filter by category and brand.</li>
      </ul>
    ),
  },
  {
    id: 'cpfr',
    title: 'CPFR',
    body: (
      <>
        <p>
          A real spreadsheet — not just a table styled to look like one — combining what used to be separate Sales, CPFR, Balance
          and Product Order pages. It plans by <b>alias</b>, not by individual color/SKU: every color and storage-identical
          variant that shares a Device Model prefix (e.g. every color of "Galaxy A07 LTE (4+128GB)") is combined into one row,
          with On Hand and sell-out summed across them — the same unit the source CPFR workbook itself plans in, since you
          forecast one number for the whole family rather than one per color. It has a name box and formula bar like a
          spreadsheet application: click any cell to select it, and the bar shows its value or formula. Weekly Sell-Out and
          CPFR span week 1 through the current year's last week automatically — no week selector, and no manual setup; scroll
          right for later weeks (or zoom out, or use full screen) to see more at once.
        </p>
        <ul className="list-disc ms-5 space-y-1">
          <li>Cells with a green corner are computed formulas (e.g. <code>=AVERAGE(...)</code>) and can't be edited. Shaded (amber) cells are editable: select one, type a new value into the formula bar, and press Enter — it recalculates everything that depends on it immediately and saves in the background (watch for a small dot on the cell).</li>
          <li><b>Alias</b> — the shared name every merged color/variant is planned under. Stock View's own Alias View uses the same matching rule, so the two stay consistent with each other.</li>
          <li><b>Weekly Sell-Out</b> — one column per week of the year, summarized automatically from your sales uploads across every variant sharing the alias (0 until a week's upload arrives). <b>Avg 2-Wk</b> averages the two most recent week columns, feeding Est. Sellout / Est. On Hand / Score / Status (the no-CPFR prediction) and <b>Suggestion</b> (the quantity needed to reach Healthy).</li>
          <li><b>CPFR</b> — one editable column per week of the year. <b>Actual DO</b> and <b>TOTAL CPFR</b> are single cumulative summary columns (TOTAL CPFR = sum of every week's CPFR − Actual DO), not a per-week breakdown.</li>
          <li><b>Balance &amp; PO</b> — every month of the year shows its own column group, side by side, no month picker. Balance is editable; <b>Unserved</b> carries forward (<b>previous Unserved + that month's Total CPFR − Balance</b>), so editing an earlier month's Balance updates every later month's Unserved in place. Hold, Replace, Replace 2 and Replace 4 are editable per month; <b>Total for PO = Unserved + Hold + Replace + Replace 2 + Replace 4</b> for that month.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'rsi',
    title: 'RSI',
    body: (
      <p>Choose a month. Stores are ranked by that month's sales; tick the top-performing stores as RSI. The Critical warnings list shows Critical devices stocked in RSI stores. Filter by store (or Overall), search, and pick how many rows to show.</p>
    ),
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    body: (
      <p>Devices needing attention with search, status, brand and row-count filters, and an <b>Export CSV</b> that includes Score and Suggested Order. RSI warnings appear below with a store filter.</p>
    ),
  },
  {
    id: 'formulas',
    title: 'Formulas',
    body: (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700">
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {[
              ['avg2wk', 'Average sell-out of the last two weeks (all stores and variants)'],
              ['Estimated sell-out', 'avg2wk × 2'],
              ['Estimated on-hand', 'On-hand (+ CPFR) − estimated sell-out'],
              ['Score', 'Estimated on-hand ÷ avg2wk'],
              ['Status (flagship)', 'Healthy at score ≥ 4, otherwise Critical'],
              ['Status (other)', 'Healthy above 8, Critical at 4 or below, Moderate in between'],
              ['PO total', 'Unserved + Hold + Replace'],
            ].map(([k, v]) => (
              <tr key={k}>
                <td className="px-3 py-2 font-medium whitespace-nowrap">{k}</td>
                <td className="px-3 py-2">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: 'help',
    title: 'Troubleshooting',
    body: (
      <ul className="list-disc ms-5 space-y-1">
        <li><b>Request failed 413</b> – the file is over the upload size limit.</li>
        <li><b>Only weekly files are accepted</b> – a sales file must span one 7-day week; check that Sale Date is mapped to the right column.</li>
        <li><b>Session expired</b> – sign in again.</li>
      </ul>
    ),
  },
];

export default function Guide() {
  const [active, setActive] = useState(sections[0].id);
  const current = sections.find((s) => s.id === active) || sections[0];

  return (
    <>
      <PageHeader>User Guide</PageHeader>
      <div className="py-8">
        <div className="max-w-7xl mx-auto sm:px-6 lg:px-8 grid gap-6 md:grid-cols-[14rem_1fr]">
          <nav className="bg-white dark:bg-gray-800 shadow-sm sm:rounded-lg p-2 h-fit">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                className={`block w-full text-left px-3 py-2 rounded-md text-sm ${
                  s.id === active
                    ? 'bg-indigo-50 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-medium'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {s.title}
              </button>
            ))}
          </nav>
          <Card>
            <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100 mb-3">{current.title}</h3>
            <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">{current.body}</div>
          </Card>
        </div>
      </div>
    </>
  );
}
