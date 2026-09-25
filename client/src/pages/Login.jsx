import { useState } from 'react';
import { api } from '../api.js';
import Card from '../components/Card.jsx';
import PrimaryButton from '../components/PrimaryButton.jsx';

export default function Login({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(username, password);
      onLoggedIn(res.username);
    } catch (err) {
      setError(err.message);
      setNeedsSetup(Boolean(err.needsSetup));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <span className="bg-gray-900 rounded-md px-3 py-1.5">
            <span className="text-white font-bold tracking-tight text-sm whitespace-nowrap">
              Stock<span className="text-indigo-400">Predictor</span>
            </span>
          </span>
        </div>

        <Card>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Sign in</h1>

          {needsSetup && (
            <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 px-3 py-2 rounded text-sm mb-4">
              No admin account has been set up yet. Set <code>ADMIN_PASSWORD</code> (and optionally <code>ADMIN_USERNAME</code>)
              for the server container and restart it to create one.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">Username</label>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600"
                required
              />
            </div>
            <div>
              <label className="block font-medium text-sm text-gray-700 dark:text-gray-300 mb-1">Password</label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:border-indigo-500 dark:focus:border-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-600"
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-200 px-3 py-2 rounded text-sm">
                {error}
              </div>
            )}

            <PrimaryButton type="submit" disabled={busy} className="w-full justify-center">
              {busy ? 'Signing in…' : 'Sign in'}
            </PrimaryButton>
          </form>
        </Card>
      </div>
    </div>
  );
}
