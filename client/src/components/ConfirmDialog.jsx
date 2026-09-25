import { createContext, useCallback, useContext, useRef, useState } from 'react';
import PrimaryButton from './PrimaryButton.jsx';
import SecondaryButton from './SecondaryButton.jsx';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback(({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ title, message, confirmLabel, cancelLabel });
    });
  }, []);

  function handle(result) {
    setState(null);
    resolveRef.current?.(result);
    resolveRef.current = null;
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => handle(false)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
          >
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">{state.title}</h3>
            {state.message && <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 whitespace-pre-line">{state.message}</p>}
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => handle(false)}>{state.cancelLabel}</SecondaryButton>
              <PrimaryButton onClick={() => handle(true)}>{state.confirmLabel}</PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
