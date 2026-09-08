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
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Which screen edge it hugs. Fixed, not locale-derived — see the note above. */
  side?: 'left' | 'right';
  width?: 'md' | 'lg';
  footer?: ReactNode;
  children: ReactNode;
}): JSX.Element | null => {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(panelRef, onClose, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
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
    <div className="fixed inset-0 z-50 flex" role="presentation">
      {/* Lighter than a modal's scrim on purpose: the board behind this is meant to stay readable,
          which is the reason to use a layer rather than a dialog at all. */}
      <div className="absolute inset-0 bg-slate-900/30" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-side-layer={side}
        className={cn(
          'relative flex h-full flex-col bg-white shadow-2xl dark:bg-slate-900',
          width === 'lg' ? 'w-full max-w-2xl' : 'w-full max-w-lg',
          side === 'left' ? 'me-auto' : 'ms-auto',
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
