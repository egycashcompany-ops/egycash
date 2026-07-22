// Accessible modal dialog rendered in a portal. Closes on overlay click and Escape, locks body
// scroll while open, and is RTL-safe. Focus management is basic (the panel is the labelled
// dialog); a fuller focus-trap can layer on later without changing the API.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../platform/localization/useT';
import { useOnClickOutside } from '../lib/useOnClickOutside';
import { cn } from '../lib/cn';
import { CloseIcon } from './icons';

type Size = 'sm' | 'md' | 'lg';
const SIZE: Record<Size, string> = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

export const Dialog = ({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  size?: Size;
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
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('relative w-full rounded-xl bg-white shadow-elevated dark:bg-slate-900', SIZE[size])}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
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
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
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
