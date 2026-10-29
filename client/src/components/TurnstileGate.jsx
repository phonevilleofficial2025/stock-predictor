import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

// Loaded at most once per page load, however many times this component mounts.
let scriptPromise = null;
function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load the verification widget — check your connection and try again.'));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

// Full-page gate shown before anything else in the app (even the login screen) —
// the server enforces this independently (lib/turnstile.js's requireTurnstile
// middleware sits ahead of every route including /api/auth), this is just the UI
// for it. A no-op if the server reports the gate isn't configured (local dev
// without TURNSTILE_SECRET_KEY set).
export default function TurnstileGate({ onVerified }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function handleToken(token) {
      setBusy(true);
      setError(null);
      try {
        await api.verifyTurnstile(token);
        onVerified();
      } catch (err) {
        setError(err.message);
        if (window.turnstile && widgetIdRef.current != null) window.turnstile.reset(widgetIdRef.current);
      } finally {
        setBusy(false);
      }
    }

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: handleToken,
          'error-callback': () => setError('Verification widget failed to load — please refresh the page.'),
        });
      })
      .catch((e) => setError(e.message));

    return () => {
      cancelled = true;
      if (widgetIdRef.current != null && window.turnstile) window.turnstile.remove(widgetIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Verify you're human</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Please complete the check below to continue to Stock Predictor.</p>
        <div ref={containerRef} className="flex justify-center" />
        {busy && <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">Verifying…</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400 mt-4">{error}</p>}
      </div>
    </div>
  );
}
