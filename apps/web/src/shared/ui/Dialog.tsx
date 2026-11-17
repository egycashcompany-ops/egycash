// Accessible modal dialog rendered in a portal. Closes on Escape and — unless the dialog says
// otherwise — on a click outside the panel. Locks body scroll while open, and is RTL-safe. Focus management is basic (the panel is the labelled
// dialog); a fuller focus-trap can layer on later without changing the API.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../platform/localization/useT';
import { useOnClickOutside } from '../lib/useOnClickOutside';
import { cn } from '../lib/cn';
import { CloseIcon } from './icons';

// `xl` and `full` exist for the data-entry dialogs that are really a screen in a modal — a receipt
// with a line per bar and a live side panel does not fit in `lg`, and squeezing it there would
// mean two nested scrollbars.
type Size = 'sm' | 'md' | 'lg' | 'xl' | 'full';
const SIZE: Record<Size, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-5xl',
  full: 'max-w-[96vw]',
};

export const Dialog = ({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  dismissOnOutsideClick = true,
  tall = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  size?: Size;
  /**
   * A TALLER body — for a form whose drop-down lists open inside it. The body scrolls at 70% of
   * the screen by default, and a list opened near its bottom is cut by that edge; a tall body is
   * never shorter than 65% and grows to whatever the screen leaves after the header and footer.
   */
  tall?: boolean;
  /**
   * Does a click OUTSIDE the panel close this dialog?
   *
   * On by default, which is right for a dialog that only shows something: a stray click costs a
   * glance. It is the wrong default for a dialog you FILL IN — «لو دوست في اى حته الموديل
   * ميتقفلش غير لما ادوس على الاكس» — where the same stray click throws away everything typed,
   * with no warning and nothing to undo it. A form dialog turns this off and keeps the two
   * deliberate ways out: the × and Escape.
   *
   * Off does NOT mean trapped. Escape still closes, because a keyboard user needs a way out that
   * does not depend on finding a button, and pressing it is a decision rather than a slip.
   */
  dismissOnOutsideClick?: boolean;
  children: ReactNode;
}): JSX.Element | null => {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * Only the dialog on TOP answers a click outside it or Escape. Every dialog is portalled to the
   * body on its own, so one opened from inside another (the ID card's «إضافة صورة» opening the photo
   * dialog) is not inside the first one's panel: a click in it read as «outside» the card, closed
   * the card, and took the photo dialog with it before its file picker could answer.
   */
  const onTop = (): boolean => {
    const roots = document.querySelectorAll('[data-dialog-root]');
    return roots.length === 0 || roots[roots.length - 1] === rootRef.current;
  };
  // A menu a field inside the dialog opened, drawn on the page's body so nothing clips it (the
  // photo's «تصوير بالكاميرا / اختيار من الجهاز»), belongs to the dialog: a press in it is not «outside».
  const closeIfOnTop = (event: MouseEvent | TouchEvent): void => {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-floating-layer]') !== null) return;
    if (onTop()) onClose();
  };
  useOnClickOutside(panelRef, closeIfOnTop, open && dismissOnOutsideClick);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !onTop()) return;
      // Marked as handled, so a dialog UNDER this one that is not a `Dialog` — a Fleet
      // `DesignDialog`, listening on the window further along the same event — knows the Escape
      // was this dialog's and stays open. A flag in React state cannot say that: the state flips
      // mid-event and the other listener reads the new value.
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={rootRef}
      data-dialog-root=""
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 animate-fade-in bg-slate-900/50 backdrop-blur-sm"
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative w-full animate-pop-in rounded-xl bg-white shadow-elevated dark:bg-slate-900',
          SIZE[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">
              {title}
            </h2>
            {description !== undefined && (
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="-me-1 shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <CloseIcon />
          </button>
        </div>
        <div
          className={cn(
            'overflow-y-auto px-5 py-4',
            tall ? 'min-h-[65vh] max-h-[calc(100vh-11rem)]' : 'max-h-[70vh]',
          )}
        >
          {children}
        </div>
        {footer !== undefined && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
