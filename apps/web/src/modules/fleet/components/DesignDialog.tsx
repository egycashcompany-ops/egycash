// «حسن الui … بالفورم بتاعت التسجيل والتعديل»: the vehicle form's design — its panel, header,
// sections and footer — as one shell, so every Fleet form that takes it looks the same and none
// copies the portal, the backdrop and the Escape key again.
//
// The look is `LOOK.add` from the fuel-card dialog, the one `VehicleFormDialog` wears. Fields go in
// as `DesignField`s with `boxTone(LOOK.add)` boxes; this file only frames them.
import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { Spinner } from '../../../shared/ui/Spinner';
import { CLOSE_PATH, LOOK, SANS, Stroke } from './FuelCardDialog';

const look = LOOK.add;

/** The panel's width: the vehicle form is `3xl`; a short form reads better narrower. */
const WIDTH = {
  lg: '!max-w-lg',
  xl: '!max-w-xl',
  '2xl': '!max-w-2xl',
  '3xl': '!max-w-3xl',
  // A read-only panel of cards side by side — the shipments board's «عملات أخرى», three across.
  '4xl': '!max-w-4xl',
  // A form laid out in columns so it fits the screen with no scroll — the shipment form.
  '6xl': '!max-w-6xl',
};

export const DesignDialog = ({
  open,
  onClose,
  title,
  subtitle,
  icon,
  width = '2xl',
  footer,
  children,
  panelProps,
  wrapTitle = false,
  dense = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The grey line under the title — what the form is about, the car's code. */
  subtitle?: ReactNode;
  /** The header tile's drawing — a `PATH` entry. */
  icon: readonly string[];
  width?: keyof typeof WIDTH;
  /** The buttons along the bottom — `DesignSave` and `DesignCancel`, usually. */
  footer: ReactNode;
  children: ReactNode;
  /** Hooks on the panel (`data-*`) a screen's tests and harness find it by. */
  panelProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string>;
  /**
   * A title that must be read whole (6d's «تنفيذ تصحيح أرقام الكروت») wraps on a narrow screen
   * instead of ending in «…». Off by default: every other form keeps its one-line title.
   */
  wrapTitle?: boolean;
  /**
   * Tighter spacing between and around the sections — for a wide form laid out in columns to fit
   * the screen with no scroll (the shipment form: «الفورم … كبيرة انها متهكنش فيها اسكرول»).
   */
  dense?: boolean;
}): JSX.Element | null => {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const escape = (e: KeyboardEvent): void => {
      // `defaultPrevented`: something above this form already answered this Escape — an open list
      // closing, or a dialog opened FROM this form (the shipment form's «+ إضافة فرع») closing
      // itself. Closing this form too would throw away everything typed into it.
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Only the dialog on TOP answers. Two of these both listen on the window, in an order React
      // re-registers at will, so "who goes first" decides nothing; the stack of dialog roots on the
      // page does (the shared Dialog reads the same `[data-dialog-root]` stack).
      const roots = document.querySelectorAll('[data-dialog-root]');
      if (roots.length > 0 && roots[roots.length - 1] !== rootRef.current) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      ref={rootRef}
      data-dialog-root=""
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-3 sm:p-4"
    >
      <div
        className="fixed inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-md dark:bg-[#03060c]/80"
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        {...panelProps}
        className={cn(
          SANS,
          // A column the height of the screen at most: the header and the buttons keep their place
          // and only the fields between them scroll, so Save is never below the edge.
          'relative my-auto flex max-h-[calc(100vh-1.5rem)] w-full animate-dialog-in flex-col overflow-hidden rounded-2xl border text-slate-900 antialiased sm:max-h-[calc(100vh-2rem)] dark:text-slate-100',
          look.panel,
          WIDTH[width],
        )}
      >
        <header
          className={cn('flex shrink-0 items-center justify-between border-b px-6', look.header)}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                'flex shrink-0 items-center justify-center rounded-xl border',
                look.icon,
              )}
            >
              <Stroke d={[...icon]} className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2
                className={cn(
                  wrapTitle ? 'break-words' : 'truncate',
                  'text-xl font-bold tracking-wide text-slate-900 dark:text-white',
                )}
              >
                {title}
              </h2>
              {subtitle !== undefined && (
                <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className={cn(
              'flex items-center text-slate-400 transition-all hover:text-slate-900 focus:outline-none dark:hover:text-white',
              look.close,
            )}
          >
            <Stroke d={CLOSE_PATH} className="h-5 w-5" />
          </button>
        </header>
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto',
            dense ? 'space-y-5 p-5 sm:px-6' : cn('space-y-7', look.body),
          )}
        >
          {children}
        </div>
        <div
          className={cn(
            'flex shrink-0 items-center justify-start gap-3 border-t px-6 pb-5 sm:px-7',
            look.footer,
          )}
        >
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
};

/** A section's heading: an indigo drawing, the words, a rule under both. */
export const DesignSection = ({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon: readonly string[];
  children: ReactNode;
  className?: string;
}): JSX.Element => (
  <section className={cn('space-y-4', className)}>
    <h3 className="flex items-center gap-2 border-b border-slate-200 pb-2 text-[15px] font-bold text-slate-900 dark:border-[#2b3b6b]/60 dark:text-white">
      <Stroke d={[...icon]} className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
      {title}
    </h3>
    {children}
  </section>
);

/** The design's Save: the indigo gradient with its glow, a spinner while it is on its way. */
export const DesignSave = ({
  onClick,
  busy = false,
  label,
  disabled = false,
  ...rest
}: {
  onClick: () => void;
  busy?: boolean;
  label?: string;
  disabled?: boolean;
} & Record<`data-${string}`, string>): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      {...rest}
      aria-busy={busy}
      disabled={disabled || busy}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-xl py-2.5 text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60',
        look.save,
      )}
    >
      {busy && <Spinner className="h-4 w-4" />}
      <span>{label ?? t('common.save')}</span>
    </button>
  );
};

/** The design's Cancel. */
export const DesignCancel = ({
  onClick,
  label,
}: {
  onClick: () => void;
  label?: string;
}): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-white py-2.5 text-[15px] font-bold text-slate-900 transition-all hover:bg-slate-100 active:scale-[0.98] dark:bg-[#1a2550] dark:text-slate-100 dark:hover:bg-slate-700/80',
        look.cancel,
      )}
    >
      {label ?? t('common.cancel')}
    </button>
  );
};
