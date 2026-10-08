import { useMemo, useState } from 'react';

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 20;
const ALL_CATEGORIES = 'ALL';
const ALL_BRANDS = 'ALL';

export function useFilteredTable(rows, { getSearchText, getIsFlagship, getOnHand, getCategory, getBrand, defaultPageSize = DEFAULT_PAGE_SIZE } = {}) {
  const [search, setSearchState] = useState('');
  const [flagshipOnly, setFlagshipOnlyState] = useState(false);
  const [minQty, setMinQtyState] = useState('');
  const [maxQty, setMaxQtyState] = useState('');
  const [categoryFilter, setCategoryFilterState] = useState(ALL_CATEGORIES);
  const [brandFilter, setBrandFilterState] = useState(ALL_BRANDS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);

  const categoryOptions = useMemo(() => {
    if (!getCategory) return [];
    return Array.from(new Set(rows.map((r) => getCategory(r)).filter(Boolean))).sort();
  }, [rows, getCategory]);

  const brandOptions = useMemo(() => {
    if (!getBrand) return [];
    return Array.from(new Set(rows.map((r) => getBrand(r)).filter(Boolean))).sort();
  }, [rows, getBrand]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = minQty !== '' ? Number(minQty) : null;
    const max = maxQty !== '' ? Number(maxQty) : null;

    return rows.filter((row) => {
      if (q && getSearchText && !getSearchText(row).toLowerCase().includes(q)) return false;
      if (flagshipOnly && getIsFlagship && !getIsFlagship(row)) return false;
      if (getCategory && categoryFilter !== ALL_CATEGORIES && getCategory(row) !== categoryFilter) return false;
      if (getBrand && brandFilter !== ALL_BRANDS && getBrand(row) !== brandFilter) return false;
      if (getOnHand && (min !== null || max !== null)) {
        const qty = getOnHand(row);
        if (min !== null && qty < min) return false;
        if (max !== null && qty > max) return false;
      }
      return true;
    });
  }, [rows, search, flagshipOnly, minQty, maxQty, categoryFilter, brandFilter, getSearchText, getIsFlagship, getOnHand, getCategory, getBrand]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  function setSearch(value) {
    setSearchState(value);
    setPage(1);
  }
  function setFlagshipOnly(value) {
    setFlagshipOnlyState(value);
    setPage(1);
  }
  function setMinQty(value) {
    setMinQtyState(value);
    setPage(1);
  }
  function setMaxQty(value) {
    setMaxQtyState(value);
    setPage(1);
  }
  function setCategoryFilter(value) {
    setCategoryFilterState(value);
    setPage(1);
  }
  function setBrandFilter(value) {
    setBrandFilterState(value);
    setPage(1);
  }
  function setPageSize(value) {
    setPageSizeState(value);
    setPage(1);
  }

  return {
    search, setSearch,
    flagshipOnly, setFlagshipOnly,
    minQty, setMinQty,
    maxQty, setMaxQty,
    categoryFilter, setCategoryFilter, categoryOptions,
    brandFilter, setBrandFilter, brandOptions,
    page: currentPage, setPage,
    pageSize, setPageSize,
    pageRows, filteredRows: filtered, total, pageCount, start,
  };
}
