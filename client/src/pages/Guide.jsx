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
          <li>Plan CPFR, then track Balance and Product Order.</li>
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
        <li><b>Show</b> – choose how many rows per page; use the pagination under the table.</li>
        <li><b>Zoom and full screen</b> – the − / + buttons scale only the table; the controls stay fixed. The corner button toggles full screen.</li>
        <li><b>Export CSV</b> – exports the rows currently filtered (not available on RSI).</li>
        <li>Uploads, exports and saved edits always ask for confirmation first.</li>
      </ul>
    ),
  },
  {
    id: 'upload',
    title: 'Upload',
    body: (
      <>
        <p>The Upload tab has two cards: <b>Inventory Upload</b> and <b>Sales-per-Serial-No Upload</b>. Choose a CSV (max 20 MB), review the preview (scroll, search and zoom are available), check the column mapping and import. Mappings are remembered for files with the same headers.</p>
        <ul className="list-disc ms-5 space-y-1">
          <li><b>Inventory</b> – required: Store, Product/SKU, Device Model, Quantity. Optional: Variant Name, Category, Brand. Importing <b>overwrites</b> the on-hand quantity for those store/SKU pairs. New stores and products are created automatically.</li>
          <li><b>Sales</b> – required: Product/SKU, Device Model, Store, Sale Date. Each row is one unit sold. The file must cover a single week; the week is detected automatically from the dates using retail weeks (Sunday to Saturday). Re-uploading the same week replaces it.</li>
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
        <li>Tick the <b>Flagship</b> checkbox for flagship devices. They use the lower Healthy threshold (score of 4 instead of 8).</li>
        <li><b>Status</b> (Healthy / Moderate / Critical) shows once at least one week of sales is uploaded.</li>
        <li>Filter by category and brand.</li>
      </ul>
    ),
  },
  {
    id: 'sales',
    title: 'Sales',
    body: (
      <p>Total sell-out per device per week, across all stores. Press <b>Generate Prediction</b> to see average 2-week sell-out, estimated on-hand, score and status (with and without planned CPFR), the suggested order per device and a suggested split per variant.</p>
    ),
  },
  {
    id: 'cpfr',
    title: 'CPFR',
    body: (
      <p>Choose a week, then enter <b>Weekly CPFR</b> and <b>Actual DO</b> (delivery orders received) per device. <b>Total CPFR = Weekly CPFR − Actual DO.</b> The Suggestion column shows how much is needed to reach Healthy.</p>
    ),
  },
  {
    id: 'balance',
    title: 'Balance',
    body: (
      <p>Add months, then enter each device's Month Balance. Unserved carries forward: <b>Unserved = previous Unserved + Total CPFR − Balance</b>.</p>
    ),
  },
  {
    id: 'po',
    title: 'Product Order',
    body: (
      <p>Choose a month and enter Hold and Replace quantities per device. <b>Total for PO = Unserved + Hold + Replace.</b></p>
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
