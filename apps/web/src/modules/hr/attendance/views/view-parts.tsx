// Building blocks of the attendance screens. Visual system in attendance-theme.css: paper canvas,
// white sheets on hairlines, Cairo words, Azeret Mono figures, one indigo accent, status colour only
// where it means something. RTL via logical properties.
import type { ReactNode } from 'react';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/azeret-mono/400.css';
import '@fontsource/azeret-mono/500.css';
import '@fontsource/azeret-mono/600.css';
import { cn } from '../../../../shared/lib/cn';
import { clock, hourTick, initials } from './view-format';
import type { TimeSpan, ViewStatus } from './view-types';
import './attendance-theme.css';

export const INK = 'text-[color:var(--att-ink)]';
export const INK2 = 'text-[color:var(--att-ink-2)]';
export const INK3 = 'text-[color:var(--att-ink-3)]';
export const FIG = 'att-fig';

/** The attendance canvas: the warm paper every attendance page sits on. */
export const AttendanceCanvas = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="att space-y-5 rounded-[20px] bg-[var(--att-canvas)] p-3 sm:space-y-6 sm:p-6">{children}</div>
);

/** A white sheet on a hairline. */
export const Sheet = ({ children, className }: { children: ReactNode; className?: string }): JSX.Element => (
  <section className={cn('att-sheet', className)}>{children}</section>
);

/** Page header: a small line above, the title, quiet meta under it, actions at the end. */
export const PageHeader = ({ eyebrow, title, meta, actions, lead }: { eyebrow?: ReactNode; title: ReactNode; meta?: ReactNode; actions?: ReactNode; lead?: ReactNode }): JSX.Element => (
  <header className="flex flex-wrap items-end justify-between gap-4 px-1">
    <div className="flex min-w-0 items-center gap-4">
      {lead}
      <div className="min-w-0">
        {eyebrow !== undefined && <p className={cn('text-[13px] font-medium', INK3)}>{eyebrow}</p>}
        <h1 className={cn('truncate text-[26px] font-bold leading-[1.25] tracking-[-0.01em] sm:text-[32px]', INK)}>{title}</h1>
        {meta !== undefined && <div className={cn('mt-1 text-sm', INK2)}>{meta}</div>}
      </div>
    </div>
    {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'accent';
export const DOT: Record<Tone, string> = {
  ok: 'bg-[var(--att-ok)]',
  warn: 'bg-[var(--att-warn)]',
  bad: 'bg-[var(--att-bad)]',
  info: 'bg-[var(--att-info)]',
  muted: 'bg-[var(--att-muted)]',
  accent: 'bg-[var(--att-accent)]',
};
export const SOFT: Record<Tone, string> = {
  ok: 'bg-[var(--att-ok-soft)] text-[color:var(--att-ok)]',
  warn: 'bg-[var(--att-warn-soft)] text-[color:var(--att-warn)]',
  bad: 'bg-[var(--att-bad-soft)] text-[color:var(--att-bad)]',
  info: 'bg-[var(--att-info-soft)] text-[color:var(--att-info)]',
  muted: 'bg-[var(--att-muted-soft)] text-[color:var(--att-ink-2)]',
  accent: 'bg-[var(--att-accent-soft)] text-[color:var(--att-accent)]',
};

const STATUS_TONE: Record<ViewStatus, Tone> = {
  present: 'ok',
  late: 'warn',
  earlyLeave: 'warn',
  lateAndEarly: 'warn',
  // «حضر فقط» — an arrival with no departure, on any date. WARN rather than OK, and that is the
  // honest tone: it is not a complete day, nothing about it can be judged, and somebody has to
  // decide what it was before payroll can price it.
  incomplete: 'warn',
  notYetIn: 'muted',
  absent: 'bad',
  onLeave: 'info',
  dayOff: 'muted',
  holiday: 'accent',
  noSchedule: 'muted',
  noRecord: 'muted',
};
export const statusTone = (s: ViewStatus): Tone => STATUS_TONE[s];

/** Status as a dot and a word. */
export const StatusText = ({ status, label }: { status: ViewStatus; label: string }): JSX.Element => (
  <span className={cn('inline-flex items-center gap-2 whitespace-nowrap text-[13px] font-medium', STATUS_TONE[status] === 'muted' ? INK3 : INK)}>
    {/* The live pulse marks a day still being lived — a check-in with no check-out yet. It is
        keyed to the status, not to the date, because that is the only state that can still change
        while somebody is looking at the screen. */}
    <span aria-hidden className={cn('h-2 w-2 rounded-full', DOT[STATUS_TONE[status]], status === 'incomplete' && 'att-live')} />
    {label}
  </span>
);

/** A small soft tag: «بصمة يدوية», «قرار مدير», «+0:42». */
export const Tag = ({ children, tone = 'muted' }: { children: ReactNode; tone?: Tone }): JSX.Element => (
  <span className={cn('inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-px text-[11.5px] font-semibold', SOFT[tone])}>{children}</span>
);

export const PersonAvatar = ({ name, photoUrl, size = 'md' }: { name: string | null | undefined; photoUrl?: string | null | undefined; size?: 'md' | 'lg' }): JSX.Element => (
  <span
    className={cn(
      'grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--att-muted-soft)] font-semibold',
      INK2,
      size === 'lg' ? 'h-16 w-16 text-xl ring-4 ring-[var(--att-sheet)]' : 'h-9 w-9 text-[12px]',
    )}
  >
    {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : initials(name)}
  </span>
);

// One day on a fixed 6:00 → 24:00 track, flowing from the reading start (right in Arabic).
const DAY_START = 6 * 60;
const DAY_END = 24 * 60;
const pct = (m: number): number => ((Math.min(DAY_END, Math.max(DAY_START, m)) - DAY_START) / (DAY_END - DAY_START)) * 100;
const TICKS = [9, 12, 15, 18, 21];

/** A day on one hairline: expected hours shaded, worked span in ink, a dot for in and out. */
export const DayTimeline = ({ inAt, outAt, expected }: { inAt: number | null; outAt: number | null; expected: TimeSpan | null }): JSX.Element => (
  <div className="relative h-5 min-w-[150px]" aria-hidden>
    <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--att-line)]" />
    {TICKS.map((h) => (
      <div key={h} className="absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-[var(--att-line-strong)]" style={{ insetInlineStart: `${pct(h * 60)}%` }} />
    ))}
    {expected !== null && (
      <div
        className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-[var(--att-muted-soft)] ring-1 ring-inset ring-[var(--att-line)]"
        style={{ insetInlineStart: `${pct(expected.start)}%`, width: `${pct(expected.end) - pct(expected.start)}%` }}
      />
    )}
    {inAt !== null && outAt !== null && outAt > inAt && (
      <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--att-ink)]" style={{ insetInlineStart: `${pct(inAt)}%`, width: `${pct(outAt) - pct(inAt)}%` }} />
    )}
    {inAt !== null && <Dot at={inAt} cls="bg-[var(--att-ok)]" />}
    {outAt !== null && <Dot at={outAt} cls="bg-[var(--att-ink)]" />}
  </div>
);

const Dot = ({ at, cls }: { at: number; cls: string }): JSX.Element => (
  <span
    title={clock(at)}
    className={cn('absolute top-1/2 h-[9px] w-[9px] -translate-y-1/2 rounded-full ring-2 ring-[var(--att-sheet)] ltr:-translate-x-1/2 rtl:translate-x-1/2', cls)}
    style={{ insetInlineStart: `${pct(at)}%` }}
  />
);

export const TimelineScale = (): JSX.Element => (
  <div className={cn('relative h-4 min-w-[150px] text-[10.5px] font-normal', FIG, INK3)} aria-hidden>
    {TICKS.map((h) => (
      <span key={h} className="absolute whitespace-nowrap ltr:-translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: `${pct(h * 60)}%` }}>
        {hourTick(h * 60)}
      </span>
    ))}
  </div>
);

/** A segmented control: «هذا الشهر · الشهر الماضي · 30 يومًا». */
export const Segmented = <T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }): JSX.Element => (
  <div className="inline-flex items-center gap-0.5 rounded-[11px] border border-[var(--att-line)] bg-[var(--att-sheet)] p-[3px]">
    {options.map((o) => {
      const on = o.value === value;
      return (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={on}
          className={cn('min-h-[34px] rounded-[8px] px-3 text-[13px] font-semibold transition-colors', on ? 'bg-[var(--att-ink)] text-[color:var(--att-sheet)]' : cn(INK2, 'hover:bg-[var(--att-sheet-2)]'))}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);

/** «‹ 17/11/2026 ›» — the day stepper. */
export const DayStepper = ({ input, onPrev, onNext, prevLabel, nextLabel }: { input: ReactNode; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string }): JSX.Element => (
  <div className="inline-flex h-10 items-center overflow-hidden rounded-[10px] border border-[var(--att-line)] bg-[var(--att-sheet)]">
    <button type="button" onClick={onPrev} aria-label={prevLabel} className={cn('grid h-full w-10 place-items-center hover:bg-[var(--att-sheet-2)]', INK2)}>
      <Chevron back />
    </button>
    <div className={cn('h-full border-x border-[var(--att-line)] [&_input]:h-full [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-2 [&_input]:text-sm [&_input]:text-[color:var(--att-ink)] [&_input]:outline-none', FIG)}>{input}</div>
    <button type="button" onClick={onNext} aria-label={nextLabel} className={cn('grid h-full w-10 place-items-center hover:bg-[var(--att-sheet-2)]', INK2)}>
      <Chevron />
    </button>
  </div>
);

const Chevron = ({ back = false }: { back?: boolean }): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn('h-4 w-4', back ? 'ltr:rotate-180' : 'rtl:rotate-180')}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

/** A titled block inside a sheet. */
export const SheetHead = ({ title, note, actions }: { title: ReactNode; note?: ReactNode; actions?: ReactNode }): JSX.Element => (
  <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
    <div className="min-w-0">
      <h2 className={cn('text-[15px] font-bold', INK)}>{title}</h2>
      {note !== undefined && <p className={cn('mt-0.5 max-w-2xl text-[13px]', INK3)}>{note}</p>}
    </div>
    {actions}
  </div>
);

/**
 * A COLUMN HEADING YOU CAN ORDER BY.
 *
 * Three things make it usable rather than merely clickable:
 *
 *  · It is a real `<button>`, so it is in the tab order and answers Enter and Space with no
 *    key handling of our own — the owner asked for keyboard-accessible headers.
 *  · The `<th>` carries `aria-sort`, which is what a screen reader announces; the arrow is
 *    `aria-hidden` because it is the same information drawn for the eye.
 *  · THE ARROWS ARE VERTICAL (▲ ▼) and so need no mirroring in Arabic. A horizontal arrow would
 *    have to flip with the writing direction and would then mean the opposite of itself on half
 *    the screens in this company; up and down mean the same thing in both.
 */
export const SortableHead = <Column extends string>({
  column,
  label,
  sort,
  onSort,
  hint,
}: {
  column: Column;
  label: string;
  sort?: { by: Column; dir: 'asc' | 'desc' } | undefined;
  onSort?: ((by: Column, dir: 'asc' | 'desc') => void) | undefined;
  /** «ترتيب تصاعدي» / «ترتيب تنازلي» — what this click will do, for the tooltip. */
  hint: (dir: 'asc' | 'desc') => string;
}): JSX.Element => {
  const active = sort?.by === column;
  // Clicking the active column toggles it; clicking a new one starts ascending, which is the
  // reading order for every column here (earliest arrival, shortest day, smallest delay, A to ي).
  const next: 'asc' | 'desc' = active && sort?.dir === 'asc' ? 'desc' : 'asc';
  if (onSort === undefined) return <span>{label}</span>;
  return (
    <button
      type="button"
      onClick={() => onSort(column, next)}
      title={hint(next)}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1 -mx-1 font-medium transition-colors hover:text-[color:var(--att-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--att-accent)]',
        active && INK,
      )}
    >
      {label}
      <span aria-hidden="true" className={active ? undefined : 'opacity-0 group-hover/head:opacity-40'}>
        {active ? (sort?.dir === 'asc' ? '\u25b2' : '\u25bc') : '\u25b2'}
      </span>
    </button>
  );
};

/** `aria-sort` for a `<th>`: what a screen reader says about this column's order. */
export const ariaSort = <Column extends string>(
  column: Column,
  sort?: { by: Column; dir: 'asc' | 'desc' },
): 'ascending' | 'descending' | 'none' =>
  sort?.by === column ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
