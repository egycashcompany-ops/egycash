// Renders the toast stack (top-center, RTL-safe, screen-reader announced). Mounted once near
// the app root. Reads the framework-free toast store.
import { cn } from '../../lib/cn';
import { dismissToast, useToasts, type ToastVariant } from './toast-store';

const VARIANT: Record<ToastVariant, string> = {
  info: 'border-brand-300 bg-brand-50 text-brand-900 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-100',
  success:
    'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  warning:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
  error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
};

export const Toaster = (): JSX.Element => {
  const toasts = useToasts();
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'pointer-events-auto w-full max-w-sm animate-slide-up rounded-lg border px-4 py-3 shadow-elevated',
            VARIANT[t.variant],
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{t.title}</p>
              {t.description !== undefined && (
                <p className="mt-0.5 text-xs opacity-80">{t.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="-me-1 shrink-0 rounded p-0.5 text-lg leading-none opacity-60 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
              aria-label="dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
