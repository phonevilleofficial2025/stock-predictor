const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json', ...options.headers },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    const err = new Error(data?.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.needsSetup = data?.needsSetup ?? false;
    throw err;
  }
  return data;
}

export const api = {
  // Auth
  login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getMe: () => request('/auth/me'),
  updateAccount: (payload) => request('/auth/account', { method: 'PUT', body: JSON.stringify(payload) }),

  // Uploads
  getUploadFields: (fileType) => request(`/uploads/fields/${fileType}`),
  previewUpload: (fileType, file) => {
    const form = new FormData();
    form.append('fileType', fileType);
    form.append('file', file);
    return request('/uploads/preview', { method: 'POST', body: form });
  },
  commitInventory: (payload) => request('/uploads/inventory/commit', { method: 'POST', body: JSON.stringify(payload) }),
  commitSales: (payload) => request('/uploads/sales/commit', { method: 'POST', body: JSON.stringify(payload) }),
  uploadHistory: () => request('/uploads/history'),

  // Stock
  getStores: () => request('/stores'),
  getStock: (storeId) => request(`/stock?storeId=${storeId}`),
  getStockSummary: () => request('/stock/summary'),
  getDevices: () => request('/devices'),
  setFlagship: (productId, isFlagship) => request(`/products/${productId}/flagship`, { method: 'PUT', body: JSON.stringify({ isFlagship }) }),

  // Sales & predictions
  getSales: () => request('/sales'),
  getPredictions: () => request('/predictions'),

  // CPFR
  getCpfr: (week) => request(`/cpfr${week ? `?week=${week}` : ''}`),
  putCpfr: (payload) => request('/cpfr', { method: 'PUT', body: JSON.stringify(payload) }),

  // Balance
  getMonths: () => request('/months'),
  addMonth: (payload) => request('/months', { method: 'POST', body: JSON.stringify(payload) }),
  getBalance: () => request('/balance'),
  putBalance: (payload) => request('/balance', { method: 'PUT', body: JSON.stringify(payload) }),

  // Product Order
  getPo: (month) => request(`/po${month ? `?month=${month}` : ''}`),
  putPo: (payload) => request('/po', { method: 'PUT', body: JSON.stringify(payload) }),

  // RSI
  getRsi: (month) => request(`/rsi?month=${month}`),
  putRsi: (payload) => request('/rsi', { method: 'PUT', body: JSON.stringify(payload) }),
  getRsiWarnings: (month) => request(`/rsi/warnings?month=${month}`),
};
