// «تعيين السيارات» on a phone and a tablet — the BOTTOM SHEET every touch layout opens: the driver
// picker, the drivers list, the filters, the mission, the note and the two confirms. The repo has
// no bottom sheet, so this one is built from the side layer's own machinery: a portal, a scrim,
// Escape, the focus moved to the panel, and a pinned header / footer around a scrolling body.
//
// What it adds is the phone's shape: anchored to the bottom edge, rounded top, a grab handle, at
// most 88% of the screen, and the home indicator's safe area under the last row. The handle is
// real: dragging the handle or the header down moves the sheet with the finger, and it closes past
// 80px or on a quick flick (else it springs back). The ✕ and the scrim close it too. From 768px it
// keeps the shape but stops at 42rem wide, centred, as a tablet sheet does.
//
// Nothing is drawn while it is closed — no portal, no `document` — so the screen renders on the
// server (the specs) exactly as in a browser.
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { CloseIcon } from '../../../../shared/ui/icons';

export const BottomSheet = ({
  open,
  onClose,
  title,
  subtitle,
  footer,
  toolbar,
  name,
  tall = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  /** Pinned under the header (search, tabs) — stays while the list scrolls. */
  toolbar?: ReactNode;
  footer?: ReactNode;
  /** `data-sheet` — which sheet this is. */
  name: string;
  /** A list sheet opens at its full height, so the list does not jump as it is searched. */
  tall?: boolean;
  children: ReactNode;
}): JSX.Element | null => {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  // The board hands a fresh `onClose` on every render; the sheet reads the newest one, so typing
  // in its search (which renders the board) never re-runs the opening — nor takes the focus away.
  const close = useRef(onClose);
  close.current = onClose;
  // Mounted a frame before it slides, so the transition has a start.
  const [shown, setShown] = useState(false);
  // The swipe: where the finger went down, and how far down the sheet follows it.
  const drag = useRef<{ id: number; y: number; at: number } | null>(null);
  const [pull, setPull] = useState(0);
  const grab = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>): void => {
      // The ✕ is a button: a tap on it is a tap, not the start of a drag.
      if ((event.target as HTMLElement).closest('button') !== null) return;
      drag.current = { id: event.pointerId, y: event.clientY, at: performance.now() };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>): void => {
      if (drag.current?.id !== event.pointerId) return;
      setPull(Math.max(0, event.clientY - drag.current.y));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>): void => {
      const start = drag.current;
      if (start?.id !== event.pointerId) return;
      drag.current = null;
      const distance = event.clientY - start.y;
      const speed = distance / Math.max(1, performance.now() - start.at);
      setPull(0);
      if (distance > 80 || (distance > 24 && speed > 0.6)) close.current();
    },
    onPointerCancel: (): void => {
      drag.current = null;
      setPull(0);
    },
  };

  useEffect(() => {
    if (!open) {
      setShown(false);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[80]"
      data-sheet={name}
      data-sheet-open={shown ? 'true' : 'false'}
    >
      <div
        aria-hidden="true"
        onClick={() => close.current()}
        className={cn(
          'absolute inset-0 touch-none bg-slate-900/40 transition-opacity duration-200 dark:bg-black/60',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={pull > 0 ? { transform: `translateY(${String(pull)}px)` } : undefined}
        className={cn(
          'absolute inset-x-0 bottom-0 mx-auto flex w-full flex-col rounded-t-2xl bg-white shadow-2xl outline-none ring-1 ring-slate-900/5 ease-out md:max-w-2xl dark:bg-slate-900 dark:ring-white/10',
          pull > 0 ? 'transition-none' : 'transition-transform duration-300',
          tall ? 'h-[88dvh]' : 'max-h-[88dvh]',
          shown ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        {/* The handle and the header: drag them down to close. */}
        <div
          data-sheet-grab="true"
          className="shrink-0 cursor-grab touch-none select-none"
          {...grab}
        >
          <span
            aria-hidden="true"
            className="mx-auto mb-1 mt-2 block h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600"
          />
          <div className="flex items-start gap-3 px-4 pb-3">
            <div className="min-w-0 flex-1 pt-1.5">
              <h2 className="text-[17px] font-bold leading-6 text-slate-900 dark:text-slate-50">
                {title}
              </h2>
              {subtitle !== undefined && (
                <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => close.current()}
              aria-label={t('common.close')}
              className="-me-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
        {toolbar !== undefined && (
          <div className="shrink-0 border-b border-slate-200 px-4 pb-3 dark:border-slate-800">
            {toolbar}
          </div>
        )}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain',
            footer === undefined && 'pb-[env(safe-area-inset-bottom)]',
          )}
        >
          {children}
        </div>
        {footer !== undefined && (
          <div className="shrink-0 border-t border-slate-200 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 dark:border-slate-800 dark:bg-slate-900">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
