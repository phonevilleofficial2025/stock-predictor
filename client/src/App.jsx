import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { api } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Upload from './pages/Upload.jsx';
import StockView from './pages/StockView.jsx';
import Sales from './pages/Sales.jsx';
import Cpfr from './pages/Cpfr.jsx';
import Balance from './pages/Balance.jsx';
import ProductOrder from './pages/ProductOrder.jsx';
import Rsi from './pages/Rsi.jsx';
import Guide from './pages/Guide.jsx';
import Login from './pages/Login.jsx';
import Settings from './pages/Settings.jsx';
import ProfileMenu from './components/ProfileMenu.jsx';
import { ConfirmProvider } from './components/ConfirmDialog.jsx';

const tabs = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/upload', label: 'Upload' },
  { to: '/stock', label: 'Stock View' },
  { to: '/sales', label: 'Sales' },
  { to: '/cpfr', label: 'CPFR' },
  { to: '/balance', label: 'Balance' },
  { to: '/po', label: 'Product Order' },
  { to: '/rsi', label: 'RSI' },
  { to: '/guide', label: 'Guide' },
];

function navLinkClass({ isActive }) {
  return isActive
    ? 'inline-flex items-center px-1 pt-1 border-b-2 border-indigo-400 dark:border-indigo-600 text-sm font-medium leading-5 text-gray-900 dark:text-gray-100 whitespace-nowrap transition duration-150 ease-in-out'
    : 'inline-flex items-center px-1 pt-1 border-b-2 border-transparent text-sm font-medium leading-5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700 whitespace-nowrap transition duration-150 ease-in-out';
}

function mobileNavLinkClass({ isActive }) {
  return isActive
    ? 'block w-full ps-3 pe-4 py-2 border-l-4 border-indigo-400 dark:border-indigo-600 text-start text-base font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/50 transition duration-150 ease-in-out'
    : 'block w-full ps-3 pe-4 py-2 border-l-4 border-transparent text-start text-base font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-700 transition duration-150 ease-in-out';
}

export default function App() {
  const [open, setOpen] = useState(false);
  const [authState, setAuthState] = useState('checking'); // 'checking' | 'out' | 'in'
  const [username, setUsername] = useState('');

  useEffect(() => {
    api.getMe()
      .then((res) => { setUsername(res.username); setAuthState('in'); })
      .catch(() => setAuthState('out'));
  }, []);

  useEffect(() => {
    function onUnauthorized() {
      setAuthState('out');
      setUsername('');
    }
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, []);

  function handleLoggedIn(name) {
    setUsername(name);
    setAuthState('in');
  }

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      setUsername('');
      setAuthState('out');
    }
  }

  if (authState === 'checking') {
    return <div className="min-h-screen bg-gray-100 dark:bg-gray-900" />;
  }

  if (authState === 'out') {
    return <Login onLoggedIn={handleLoggedIn} />;
  }

  return (
    <ConfirmProvider>
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
        <nav className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex">
                <div className="shrink-0 flex items-center">
                  <NavLink to="/dashboard" className="block bg-gray-900 rounded-md px-3 py-1.5">
                    <span className="text-white font-bold tracking-tight text-sm whitespace-nowrap">
                      Stock<span className="text-indigo-400">Predictor</span>
                    </span>
                  </NavLink>
                </div>

                <div className="hidden space-x-6 sm:-my-px sm:ms-10 sm:flex overflow-x-auto">
                  {tabs.map((t) => (
                    <NavLink key={t.to} to={t.to} className={navLinkClass}>
                      {t.label}
                    </NavLink>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <ProfileMenu username={username} onLogout={handleLogout} />

                <div className="-me-2 flex items-center sm:hidden">
                  <button
                    onClick={() => setOpen((o) => !o)}
                    className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900 focus:outline-none transition duration-150 ease-in-out"
                    aria-label="Toggle navigation"
                  >
                    <svg className="h-6 w-6" stroke="currentColor" fill="none" viewBox="0 0 24 24">
                      {open ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                      )}
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className={`${open ? 'block' : 'hidden'} sm:hidden`}>
            <div className="pt-2 pb-3 space-y-1">
              {tabs.map((t) => (
                <NavLink key={t.to} to={t.to} className={mobileNavLinkClass} onClick={() => setOpen(false)}>
                  {t.label}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>

        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/stock" element={<StockView />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/cpfr" element={<Cpfr />} />
            <Route path="/balance" element={<Balance />} />
            <Route path="/po" element={<ProductOrder />} />
            <Route path="/rsi" element={<Rsi />} />
            <Route path="/guide" element={<Guide />} />
            <Route path="/settings" element={<Settings username={username} onUsernameChanged={setUsername} />} />
          </Routes>
        </main>
      </div>
    </ConfirmProvider>
  );
}
