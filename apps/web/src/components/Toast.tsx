import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

const ToastContext = createContext<{ notify: (kind: Toast['kind'], message: string) => void } | null>(null);

/**
 * AGENTS.md §9 — toast feedback for mutations. A five-line context rather than a
 * new dependency; toasts auto-dismiss and are announced to assistive tech.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto rounded-md border px-4 py-2 text-sm shadow-sm ${
              toast.kind === 'success'
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (kind: Toast['kind'], message: string) => void {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context.notify;
}
