// A panel that slides in from one EDGE of the screen and leaves the page behind it visible.
//
// The same machinery as `Dialog` — portal, overlay, Escape, click-outside, locked body scroll —
// with one difference that is the whole point: it is anchored to a side and full height instead of
// centred and boxed. That matters for a list you work THROUGH rather than answer: a centred modal
// covers the board you were reading, so a clerk correcting the third of nine fines loses sight of
// the totals those fines add up to. Against an edge, the board stays on screen beside it.
//
// `side` is the SCREEN edge, not the reading edge: 'start'/'end' would flip with the locale, and a
// caller that wants "the layer on the left" means the left, in an app that is always RTL here.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../platform/localization/useT';
import { useOnClickOutside } from '../lib/useOnClickOutside';
import { cn } from '../lib/cn';
import { CloseIcon } from './icons';

export const SideLayer = ({
  open,
  onClose,
  title,
  description,
  side = 'left',
  width = 'md',
  modal = true,
  dismissOnOutsideClick = true,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Which screen edge it hugs. Fixed, not locale-derived — see the note above. */
  side?: 'left' | 'right';
  /**
   * `half` is the width of the OTHER half of a two-panel screen — the violations board is two
   * ledgers side by side, and a layer opened from one of them is meant to sit over the other, not
   * to be a narrow strip laid across both.
   */
  width?: 'md' | 'lg' | 'half';
  /**
   * Whether the page behind is BLOCKED while this is open.
   *
   * True — the default — is a dialog: a scrim over everything, body scroll locked, nothing behind
   * reachable. Right for a layer that IS the task.
   *
   * False makes it a side panel. The page behind stays live and scrollable, and this is not a
   * nicety: the drivers' entry layer opens the moment the first counter is typed into, and while
   * it was modal it covered the very counters a reader needs to add «five عكس AND two حزام» — the
   * bar's whole point. Non-modal, the counters stay where they are and keep taking numbers while
   * the cards for the ones already counted fill in beside them.
   */
  modal?: boolean;
  /**
   * Whether clicking the page behind closes this.
   *
   * True for a layer that only SHOWS things — clicking away is the fastest way out of a list you
   * were only reading. False for one holding work that is not saved yet: a stray click anywhere
   * on the screen threw away every card a reader had just filled in, with no warning and no undo.
   */
  dismissOnOutsideClick?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}): JSX.Element | null => {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(panelRef, onClose, open && dismissOnOutsideClick);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Only a MODAL layer freezes the page. A side panel that locked the scroll would leave the
    // board behind it visible, clickable and impossible to scroll — the worst of both.
    const previous = document.body.style.overflow;
    if (modal) document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      if (modal) document.body.style.overflow = previous;
    };
  }, [open, onClose, modal]);

  if (!open) return null;

  return createPortal(
    <div
      className={cn('fixed inset-0 z-50 flex', !modal && 'pointer-events-none')}
      role="presentation"
    >
      {/* Lighter than a modal's scrim on purpose: the board behind this is meant to stay readable,
          which is the reason to use a layer rather than a dialog at all. A NON-modal layer draws
          no scrim at all — a scrim that does not catch clicks only dims a board the reader is
          being invited to keep using. */}
      {modal && <div className="absolute inset-0 bg-slate-900/30" aria-hidden />}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={modal}
        aria-label={title}
        data-side-layer={side}
        className={cn(
          'relative flex h-full flex-col bg-white shadow-2xl dark:bg-slate-900',
          // The panel itself is always live, even when its container is not.
          !modal && 'pointer-events-auto',
          width === 'half'
            ? // Half the VIEWPORT from the breakpoint the board itself splits at (`2xl`), so the
              // layer covers the sibling panel rather than lying across both. Below that the two
              // ledgers are stacked full-width and there is no «other half» to match.
              'w-full max-w-xl 2xl:w-1/2 2xl:max-w-none'
            : width === 'lg'
              ? 'w-full max-w-2xl'
              : 'w-full max-w-lg',
          // PHYSICAL, not logical. `me-auto`/`ms-auto` are margin-inline, which flip with the
          // writing direction — in this RTL app they put `side="left"` on the RIGHT and vice
          // versa, which is exactly what shipped. `side` names a screen edge, so it has to be
          // said in screen terms: margin-right auto pushes the panel left.
          side === 'left' ? 'mr-auto' : 'ml-auto',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-white">
              {title}
            </h2>
            {description !== undefined && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
            className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        {/* The BODY scrolls, not the layer: the header and the footer are the two things a reader
            needs kept still while working down a long list. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer !== undefined && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
