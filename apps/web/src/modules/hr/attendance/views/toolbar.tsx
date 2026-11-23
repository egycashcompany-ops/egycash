// The board's toolbar: a STATUS SEGMENTED CONTROL (the statuses that have somebody in them, each
// with its count; the empty ones tucked under «More» so the strip never overflows) and one SORT
// dropdown with a direction toggle — rather than a long tab strip and a row of eight pills.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { DOT, FIG, INK, INK2, INK3, type Tone } from './view-parts';

/** A button with a menu under it; closes on an outside press, Escape, or a pick. Menu stays in the DOM. */
const Dropdown = ({
  trigger,
  label,
  active,
  children,
  align = 'end',
}: {
  trigger: ReactNode;
  label?: string;
  active?: boolean;
  children: ReactNode;
  align?: 'start' | 'end';
}): JSX.Element => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors',
          active ? cn('bg-[var(--att-sheet)] shadow-[0_1px_2px_rgba(15,23,42,0.18)]', INK) : cn(INK2, 'hover:text-[color:var(--att-ink)]'),
        )}
      >
        {trigger}
        <svg viewBox="0 0 16 16" className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      <div
        role="menu"
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={cn(
          open ? 'att-open flex' : 'hidden',
          align === 'end' ? 'end-0' : 'start-0',
          'absolute top-11 z-30 min-w-[13rem] flex-col gap-0.5 rounded-xl border border-[var(--att-line)] bg-[var(--att-sheet)] p-1.5 shadow-lg',
        )}
      >
        {children}
      </div>
    </div>
  );
};

export interface StatusSegment<K extends string> {
  key: K;
  label: string;
  value: number;
  tone: Tone;
}

export const StatusSegments = <K extends string>({
  segments,
  active,
  allKey,
  onPick,
  moreLabel,
  ariaLabel,
}: {
  segments: StatusSegment<K>[];
  active: K;
  allKey: K;
  onPick: (k: K) => void;
  moreLabel: string;
  ariaLabel: string;
}): JSX.Element => {
  const shown = segments.filter((s) => s.key === allKey || s.value > 0 || s.key === active);
  const rest = segments.filter((s) => !shown.includes(s));
  const pick = (k: K): void => onPick(active === k && k !== allKey ? allKey : k);
  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl bg-[var(--att-sheet-2)] p-1" role="tablist" aria-label={ariaLabel}>
      {shown.map((s) => {
        const on = active === s.key;
        return (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => pick(s.key)}
            className={cn(
              'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-[background-color,color,box-shadow]',
              on ? cn('bg-[var(--att-sheet)] shadow-[0_1px_2px_rgba(15,23,42,0.18)]', INK) : cn(INK2, 'hover:text-[color:var(--att-ink)]'),
            )}
          >
            {s.key !== allKey && <span className={cn('h-2 w-2 rounded-full', DOT[s.tone])} aria-hidden />}
            {s.label}
            <bdi className={cn('text-[12px] font-semibold', FIG, on ? INK : INK3)}>{s.value}</bdi>
          </button>
        );
      })}
      {rest.length > 0 && (
        <Dropdown trigger={moreLabel} align="end">
          {rest.map((s) => (
            <button
              key={s.key}
              type="button"
              role="menuitem"
              onClick={() => pick(s.key)}
              className={cn('flex items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] transition-colors hover:bg-[var(--att-sheet-2)]', INK2)}
            >
              <span className={cn('h-2 w-2 rounded-full', DOT[s.tone])} aria-hidden />
              <span className="flex-1">{s.label}</span>
              <bdi className={cn('text-[12px] font-semibold', FIG, INK3)}>{s.value}</bdi>
            </button>
          ))}
        </Dropdown>
      )}
    </div>
  );
};

/** «Sort: Arrived ▲» — one dropdown of the orders, and a button that reverses the current one. */
export const SortMenu = <K extends string>({
  options,
  by,
  dir,
  onSort,
  sortByLabel,
  reverseLabel,
  hint,
}: {
  options: { key: K; label: string }[];
  by: K | undefined;
  dir: 'asc' | 'desc' | undefined;
  onSort: (by: K, dir: 'asc' | 'desc') => void;
  sortByLabel: string;
  reverseLabel: string;
  hint: (dir: 'asc' | 'desc') => string;
}): JSX.Element => {
  const current = options.find((o) => o.key === by);
  return (
    <div className="flex items-center gap-1 rounded-xl border border-[var(--att-line)] p-0.5">
      <Dropdown
        label={sortByLabel}
        trigger={
          <>
            <svg viewBox="0 0 16 16" className={cn('h-4 w-4', INK3)} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" />
            </svg>
            <span className={INK3}>{sortByLabel}</span>
            <span className={cn('font-semibold', INK)}>{current?.label ?? '—'}</span>
          </>
        }
      >
        {options.map((o) => {
          const on = o.key === by;
          const next: 'asc' | 'desc' = on && dir === 'asc' ? 'desc' : 'asc';
          return (
            <button
              key={o.key}
              type="button"
              role="menuitemradio"
              aria-checked={on}
              aria-pressed={on}
              title={hint(next)}
              onClick={() => onSort(o.key, on ? next : 'asc')}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] transition-colors hover:bg-[var(--att-sheet-2)]',
                on ? cn('font-semibold', INK) : INK2,
              )}
            >
              <span className={cn('grid h-4 w-4 place-items-center', on ? 'text-[color:var(--att-accent)]' : 'opacity-0')} aria-hidden>
                ✓
              </span>
              <span className="flex-1">{o.label}</span>
              {on && <span className="text-[11px] text-[color:var(--att-accent)]">{dir === 'asc' ? '▲' : '▼'}</span>}
            </button>
          );
        })}
      </Dropdown>
      {current !== undefined && dir !== undefined && (
        <button
          type="button"
          onClick={() => onSort(current.key, dir === 'asc' ? 'desc' : 'asc')}
          title={`${reverseLabel} — ${hint(dir === 'asc' ? 'desc' : 'asc')}`}
          aria-label={reverseLabel}
          className={cn('grid h-9 w-9 place-items-center rounded-lg transition-colors hover:bg-[var(--att-sheet-2)]', INK2)}
        >
          <svg viewBox="0 0 16 16" className={cn('h-4 w-4 transition-transform', dir === 'desc' && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 13V3M4.5 6.5L8 3l3.5 3.5" />
          </svg>
        </button>
      )}
    </div>
  );
};
