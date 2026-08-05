// A row's overflow actions, behind one "…" button.
//
// Six buttons side by side in a table cell is a wall: every row shouts equally, the important
// action is no easier to find than the rare one, and the column grows until the table scrolls.
// The rule this component exists to support is "one or two actions stay visible, the rest live
// here" — the caller decides which, because only the caller knows what its users do most.
//
// Closing is handled for the caller: pointer down outside, Escape, and choosing an item all close
// it, because a menu that stays open after a click is the most common way this pattern goes wrong.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../platform/localization/useT';
import { cn } from '../lib/cn';
import { MoreIcon } from './icons';

export interface MenuAction {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Destructive actions are drawn apart from the rest. */
  tone?: 'default' | 'danger';
}

export const ActionMenu = ({
  actions,
  label,
}: {
  actions: MenuAction[];
  /** Accessible name for the trigger — "more actions for Wuzzuf" beats a bare "more". */
  label?: string;
}): JSX.Element | null => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (!(e.target instanceof Node) || host.current?.contains(e.target) === true) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Nothing to offer is not an empty menu — it is no menu.
  if (actions.length === 0) return null;

  return (
    <div ref={host} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ?? t('common.actions')}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <MoreIcon className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          // `end-0` rather than `right-0`: the menu hangs from the reading end of the trigger, so
          // it opens leftwards in Arabic and rightwards in English without a second rule.
          className="absolute end-0 z-30 mt-1 min-w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              disabled={action.disabled ?? false}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
              className={cn(
                'block w-full px-3 py-2 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                action.tone === 'danger'
                  ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
                  : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800',
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
