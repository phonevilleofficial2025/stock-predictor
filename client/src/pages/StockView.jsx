import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SecondaryButton from '../components/SecondaryButton.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import TableToolbar from '../components/TableToolbar.jsx';
import Pagination from '../components/Pagination.jsx';
import TableFrame, { ZoomArea } from '../components/TableFrame.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { useFilteredTable } from '../hooks/useFilteredTable.js';
import { downloadCsv } from '../utils/csv.js';

const ALL_STORES = 'ALL';

// Device models in this catalog are "BRAND LINE MODEL [NETWORK] RAM+STORAGE [COLOR /
// EDITION QUALIFIER]" with no fixed word count per field (e.g. "A5 PRO 4G 256GB Brown"
// vs "Galaxy A07 LTE (4+128GB) LIGHT" vs "Xiaomi Redmi Note 14 5G 12GB 512GB Midnight
// Black") — so neither a fixed character count nor a fixed word count can draw the
// line between "same model and spec, different color/edition" and "different model
// that happens to share a brand/line name" (Redmi Note 12s vs 14, or a phone vs an
// unrelated Xiaomi drill). Instead: scan each model's words left to right for the
// first one that looks like a RAM/storage spec (256GB, 4+128GB, (4+128GB), a typo
// like "64BB") — everything up to AND INCLUDING that token must match exactly (so
// "Note 12s" never merges with "Note 14", and a 128GB config never merges with a 64GB
// one), while anything AFTER it (color, "LIGHT", "- HOLIDAY PACKAGE", …) is free to
// vary and gets folded into the same alias. If no spec token exists at all, fall back
// to trimming a trailing run of known color words, so plain "... Black"/"... Blue"
// models can still merge without a GB token. A model with neither (e.g. an accessory
// with no spec/color at all) keeps its full name as its own one-item group.
// "BB" is included alongside GB/MB/TB specifically for the observed typo "64BB" (for
// "64GB") — a bare "2+ digits then any 2 letters" pattern was tried first, but that
// also matched legitimate non-storage specs like a 40mm watch case ("40MM"), eating
// real words. Only known near-misses of "GB" belong here, not an open-ended pattern.
const GB_SUFFIX_RE = /^\(?\d+(\.\d+)?(GB|MB|TB|BB)\)?$/i;
// RAM+storage combo — the GB/MB/TB suffix can appear on the second number only
// ("4+128GB"), on both ("12GB+256GB"), or on neither ("6+128"), and the whole thing
// may be wrapped in parens ("(4+128GB)", "(12GB+256GB)").
const RAM_STORAGE_COMBO_RE = /^\(?\d+(GB|MB|TB|BB)?\+\d+(GB|MB|TB|BB)?\)?$/i;
function isSpecToken(tok) {
  return GB_SUFFIX_RE.test(tok) || RAM_STORAGE_COMBO_RE.test(tok);
}
const COLOR_WORDS = new Set([
  'BLACK', 'WHITE', 'BLUE', 'GREEN', 'GRAY', 'GREY', 'PURPLE', 'PINK', 'RED', 'GOLD', 'SILVER', 'ORANGE', 'YELLOW', 'BROWN',
  'TITANIUM', 'VIOLET', 'BRONZE', 'BEIGE', 'TEAL', 'NAVY', 'MAROON', 'LAVENDER', 'MINT', 'ROSE', 'GRAPHITE', 'MIDNIGHT',
  'SUNSET', 'OCEAN', 'FOREST', 'SKY', 'CORAL', 'PEARL', 'ONYX', 'ICE', 'IONIC', 'CERAMIC', 'IVORY', 'CHARCOAL', 'PLATINUM',
  'CHAMPAGNE', 'SAND', 'SANDY', 'CLOUD', 'CRYSTAL', 'GLACIER', 'STAR', 'STARRY', 'DREAMY', 'MIST', 'MISTY', 'CLOVER', 'PALM',
  'LIME', 'AURORA', 'OPAL', 'DEEP', 'ATLANTIC', 'JADE', 'RUBY', 'SAPPHIRE', 'EMERALD', 'AMBER', 'COBALT', 'SLATE', 'STEEL', 'CHROME',
  'LIGHT',
]);

function tokenize(s) {
  return (s || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
}

// Index right AFTER the shared, must-match portion of `tokens` — i.e. through and
// including the first RAM/storage spec token, if any, else through the last
// non-color token (trimming a trailing run of color words).
function variantCutIndex(tokens) {
  for (let i = 0; i < tokens.length; i++) if (isSpecToken(tokens[i])) return i + 1;
  let end = tokens.length;
  while (end > 0 && COLOR_WORDS.has(tokens[end - 1])) end--;
  return end;
}

function aliasKey(deviceModel) {
  const tokens = tokenize(deviceModel);
  let cut = variantCutIndex(tokens);
  if (cut === 0) cut = tokens.length; // the very first token is itself a spec/color — keep the whole name
  return tokens.slice(0, cut).join(' ') || '(blank)';
}

// Groups rows by `aliasKey`, summing On Hand across every variant/SKU merged in. The
// alias's display name is that shared key itself.
function groupByAlias(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = aliasKey(r.deviceModel);
    if (!groups.has(key)) {
      groups.set(key, {
        productId: `alias:${key}`,
        alias: key,
        quantity: 0,
        variantCount: 0,
        flagshipCount: 0,
        storeCount: 0,
        updatedAt: null,
        categories: new Set(),
        brands: new Set(),
      });
    }
    const g = groups.get(key);
    g.quantity += r.quantity;
    g.variantCount += 1;
    if (r.isFlagship) g.flagshipCount += 1;
    if (r.storeCount) g.storeCount += r.storeCount;
    if (r.category) g.categories.add(r.category);
    if (r.brand) g.brands.add(r.brand);
    if (r.updatedAt && (!g.updatedAt || new Date(r.updatedAt) > new Date(g.updatedAt))) g.updatedAt = r.updatedAt;
  }
  return Array.from(groups.values())
    .map((g) => ({
      ...g,
      category: g.categories.size === 1 ? [...g.categories][0] : (g.categories.size > 1 ? 'Mixed' : null),
      brand: g.brands.size === 1 ? [...g.brands][0] : (g.brands.size > 1 ? 'Mixed' : null),
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

export default function StockView() {
  const confirm = useConfirm();
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState('');
  const [stock, setStock] = useState([]);
  const [error, setError] = useState(null);
  const [aliasMode, setAliasMode] = useState(false);

  const isSummary = storeId === ALL_STORES;
  const aliasRows = useMemo(() => groupByAlias(stock), [stock]);
  const baseRows = aliasMode ? aliasRows : stock;

  const {
    search, setSearch, flagshipOnly, setFlagshipOnly, minQty, setMinQty, maxQty, setMaxQty,
    categoryFilter, setCategoryFilter, categoryOptions,
    brandFilter, setBrandFilter, brandOptions,
    page, setPage, pageSize, setPageSize, pageRows, filteredRows, total, pageCount, start,
  } = useFilteredTable(baseRows, {
    getSearchText: (r) => (aliasMode ? r.alias : `${r.deviceModel} ${r.variantName || ''} ${r.sku} ${r.category || ''} ${r.brand || ''}`),
    getIsFlagship: (r) => (aliasMode ? r.flagshipCount > 0 : r.isFlagship),
    getOnHand: (r) => r.quantity,
    getCategory: (r) => r.category,
    getBrand: (r) => r.brand,
  });

  useEffect(() => {
    api.getStores().then((s) => {
      setStores(s);
      if (s.length) setStoreId(String(s[0].id));
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!storeId) return;
    const request = isSummary ? api.getStockSummary() : api.getStock(storeId);
    request.then(setStock).catch((e) => setError(e.message));
  }, [storeId]);

  const totalOnHand = stock.reduce((sum, r) => sum + r.quantity, 0);

  async function handleFlagshipChange(e, row) {
    const nextValue = e.target.checked;
    const ok = await confirm({
      title: nextValue ? 'Mark as Flagship?' : 'Remove Flagship status?',
      message: `${nextValue ? 'Mark' : 'Remove Flagship from'} "${row.deviceModel}${row.variantName ? ` — ${row.variantName}` : ''}"?`,
      confirmLabel: nextValue ? 'Mark Flagship' : 'Remove',
    });
    if (!ok) {
      e.target.checked = row.isFlagship;
      return;
    }
    setStock((s) => s.map((r) => (r.productId === row.productId ? { ...r, isFlagship: nextValue } : r)));
    try {
      await api.setFlagship(row.productId, nextValue);
    } catch (err) {
      setError(err.message);
      setStock((s) => s.map((r) => (r.productId === row.productId ? { ...r, isFlagship: !nextValue } : r)));
    }
  }

  async function exportCsv() {
    const ok = await confirm({
      title: 'Export CSV?',
      message: `Export ${filteredRows.length} row(s) to a CSV file?`,
      confirmLabel: 'Export',
    });
    if (!ok) return;

    const headers = aliasMode
      ? ['Alias', 'Variants Merged', 'Category', 'Brand', 'Total On Hand', 'Flagship Variants', 'Last Updated']
      : isSummary
        ? ['Device Model', 'Variant', 'SKU', 'Category', 'Brand', 'Total On Hand', 'Stores Carrying', 'Flagship', 'Status', 'Last Updated']
        : ['Device Model', 'Variant', 'SKU', 'Category', 'Brand', 'On Hand', 'Flagship', 'Status', 'Last Updated'];
    const csvRows = filteredRows.map((r) => {
      if (aliasMode) {
        return [r.alias, r.variantCount, r.category || '', r.brand || '', r.quantity, r.flagshipCount, r.updatedAt ? new Date(r.updatedAt).toLocaleString() : ''];
      }
      const base = [r.deviceModel, r.variantName || '', r.sku, r.category || '', r.brand || '', r.quantity];
      if (isSummary) base.push(r.storeCount);
      base.push(r.isFlagship ? 'Yes' : 'No');
      base.push(r.status || '');
      base.push(r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '');
      return base;
    });
    const storeName = isSummary ? 'all-stores' : (stores.find((s) => String(s.id) === storeId)?.name || 'store');
    downloadCsv(`stock-${aliasMode ? 'alias-' : ''}${storeName}.csv`, headers, csvRows);
  }

  return (
    <>
      <PageHeader>Stock View</PageHeader>
      <div className="py-8">
        <div className="max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
          <Card>
            {error && (
              <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
                {error}
              </div>
            )}
            {stores.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No stores yet — upload an inventory file first.</p>
            ) : (
              <TableFrame>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value)}
                    className="border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600 w-64"
                  >
                    <option value={ALL_STORES}>— All Stores (Summary) —</option>
                    {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <SecondaryButton
                    onClick={() => setAliasMode((v) => !v)}
                    title="Combine rows whose Device Model shares the first 6 letters (e.g. every A5 PRO color/storage variant) into one summed row"
                    className={aliasMode ? '!bg-indigo-600 dark:!bg-indigo-600 !text-white !border-indigo-600 hover:!bg-indigo-700 dark:hover:!bg-indigo-700' : ''}
                  >
                    {aliasMode ? 'Alias View: On' : 'Alias View'}
                  </SecondaryButton>
                </div>

                {isSummary && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Stores</div>
                      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{stores.length}</div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">SKUs Tracked</div>
                      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{stock.length}</div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total On Hand</div>
                      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{totalOnHand}</div>
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  <TableToolbar
                    search={search} onSearchChange={setSearch} searchPlaceholder={aliasMode ? 'Search alias…' : 'Search device, variant, or SKU…'}
                    showFlagshipFilter flagshipOnly={flagshipOnly} onFlagshipChange={setFlagshipOnly}
                    showQtyFilter minQty={minQty} onMinQtyChange={setMinQty} maxQty={maxQty} onMaxQtyChange={setMaxQty}
                    showCategoryFilter categoryFilter={categoryFilter} onCategoryChange={setCategoryFilter} categoryOptions={categoryOptions}
                    showBrandFilter brandFilter={brandFilter} onBrandChange={setBrandFilter} brandOptions={brandOptions}
                    pageSize={pageSize} onPageSizeChange={setPageSize}
                    onExport={exportCsv}
                  />
                </div>

                <ZoomArea>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400">
                        {aliasMode ? (
                          <>
                            <th className="px-3 py-2">Alias</th>
                            <th className="px-3 py-2 text-right">Variants Merged</th>
                            <th className="px-3 py-2">Category</th>
                            <th className="px-3 py-2">Brand</th>
                            <th className="px-3 py-2 text-right">Total On Hand</th>
                            <th className="px-3 py-2 text-right">Flagship Variants</th>
                            <th className="px-3 py-2">Last Updated</th>
                          </>
                        ) : (
                          <>
                            <th className="px-3 py-2">Device Model</th>
                            <th className="px-3 py-2">Variant</th>
                            <th className="px-3 py-2">SKU</th>
                            <th className="px-3 py-2">Category</th>
                            <th className="px-3 py-2">Brand</th>
                            <th className="px-3 py-2 text-right">{isSummary ? 'Total On Hand' : 'On Hand'}</th>
                            {isSummary && <th className="px-3 py-2 text-right">Stores Carrying</th>}
                            <th className="px-3 py-2">Flagship</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Last Updated</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {pageRows.map((row) => (
                        aliasMode ? (
                          <tr key={row.productId}>
                            <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{row.alias}</td>
                            <td className="px-3 py-2 text-right">{row.variantCount}</td>
                            <td className="px-3 py-2">{row.category || '—'}</td>
                            <td className="px-3 py-2">{row.brand || '—'}</td>
                            <td className="px-3 py-2 text-right">{row.quantity}</td>
                            <td className="px-3 py-2 text-right">{row.flagshipCount}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}</td>
                          </tr>
                        ) : (
                          <tr key={row.productId}>
                            <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{row.deviceModel}</td>
                            <td className="px-3 py-2">{row.variantName || '—'}</td>
                            <td className="px-3 py-2">{row.sku}</td>
                            <td className="px-3 py-2">{row.category || '—'}</td>
                            <td className="px-3 py-2">{row.brand || '—'}</td>
                            <td className="px-3 py-2 text-right">{row.quantity}</td>
                            {isSummary && <td className="px-3 py-2 text-right">{row.storeCount}</td>}
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={row.isFlagship}
                                onChange={(e) => handleFlagshipChange(e, row)}
                                className="rounded border-gray-300 dark:border-gray-700 text-indigo-600 shadow-sm focus:ring-indigo-500 dark:focus:ring-indigo-600 dark:bg-gray-900"
                              />
                            </td>
                            <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}</td>
                          </tr>
                        )
                      ))}
                      {stock.length === 0 && (
                        <tr><td colSpan={aliasMode ? 7 : (isSummary ? 10 : 9)} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">
                          {isSummary ? 'No stock recorded yet.' : 'No stock recorded for this store yet.'}
                        </td></tr>
                      )}
                      {stock.length > 0 && pageRows.length === 0 && (
                        <tr><td colSpan={aliasMode ? 7 : (isSummary ? 10 : 9)} className="px-3 py-6 text-center text-gray-500 dark:text-gray-400">No rows match your search/filter.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                </ZoomArea>
                <Pagination page={page} pageCount={pageCount} total={total} start={start} count={pageRows.length} setPage={setPage} />
              </TableFrame>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
