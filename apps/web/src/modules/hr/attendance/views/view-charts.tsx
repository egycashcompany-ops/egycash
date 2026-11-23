// The attendance charts. Plain divs and percentages (no chart library), so they inherit RTL,
// dark mode and the scoped palette. Each one carries a one-line reading of itself.
import type { ReactNode } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { DOT, FIG, INK, INK2, INK3, SOFT, statusTone, type Tone } from './view-parts';
import { clock, hourTick, timeSpan } from './view-format';
import type { EmployeeDay } from './view-types';

/* ───────────────────────── The day's arrival river (daily sheet) ───────────────────────── */

export interface ArrivalSlot {
  /** Start of a 15-minute slot, minutes after midnight. */
  slot: number;
  count: number;
}

/**
 * Arrivals per quarter hour, on a softly tinted panel. On-time quarters are brand, late ones amber,
 * the busiest quarter is the darkest with its count in a bubble. A dashed line marks the start of
 * the day, an accent line marks now; both carry a small pill label.
 */
export const ArrivalRiver = ({
  slots,
  dayStart,
  grace,
  now,
  labels,
}: {
  slots: ArrivalSlot[];
  /**
   * `null` when nobody on this sheet has a roster. The line is then not drawn at all: a mark at
   * nine o'clock where nobody has been given hours is a claim about lateness that nobody in the
   * company has made, and the quarters beyond it must not be coloured as late either.
   */
  dayStart: number | null;
  grace: number;
  now: number | null;
  labels: { start: string; now: string; people: (n: number) => string; empty: string };
}): JSX.Element => {
  const filled = slots.filter((s) => s.count > 0);
  // The window is spanned by what is actually known: the roster if there is one, the arrivals
  // themselves, and now. With none of the three there is nothing to draw and nothing to imply.
  const anchors = [
    ...(dayStart === null ? [] : [dayStart - 90, dayStart + 120]),
    ...filled.flatMap((s) => [s.slot, s.slot + 15]),
    ...(now === null ? [] : [now]),
  ];
  if (anchors.length === 0) {
    return <p className={cn('px-5 pb-10 pt-4 text-center text-sm sm:px-6', INK3)}>{labels.empty}</p>;
  }
  const lo = Math.floor((Math.min(...anchors) - 15) / 60) * 60;
  const hi = Math.ceil((Math.max(...anchors) + 15) / 60) * 60;
  const quarters = Array.from({ length: (hi - lo) / 15 }, (_, k) => lo + k * 15);
  const bySlot = new Map(slots.map((s) => [s.slot, s.count]));
  const peak = Math.max(1, ...slots.map((s) => s.count));
  const step = peak <= 8 ? 2 : peak <= 20 ? 5 : peak <= 50 ? 10 : 25;
  const top = Math.ceil(peak / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, k) => k * step);
  const busiest = filled.reduce<ArrivalSlot | null>((b, s) => (s.count > (b?.count ?? 0) ? s : b), null);
  const x = (m: number): string => `${((m - lo) / (hi - lo)) * 100}%`;
  const hours = Array.from({ length: (hi - lo) / 60 + 1 }, (_, k) => lo + k * 60);
  // The plot keeps 14% headroom for the bubble and the marker pills.
  const at = (v: number): string => `${(v / top) * 86}%`;

  return (
    <div className="px-5 pb-5 sm:px-6">
      <div className="flex gap-3">
        <div className={cn('relative h-56 w-8 shrink-0 text-[10.5px]', FIG, INK3)}>
          {ticks.map((v) => (
            <span key={v} className="absolute end-0 translate-y-1/2" style={{ bottom: at(v) }}>
              {v}
            </span>
          ))}
        </div>
        <div className="relative h-56 flex-1 rounded-xl border border-[var(--att-line)] bg-gradient-to-b from-[var(--att-brand-tint)] to-[var(--att-sheet)]">
          {ticks.slice(1).map((v) => (
            <div key={v} className="absolute inset-x-0 border-t border-[var(--att-line)]" style={{ bottom: at(v) }} />
          ))}
          <div className="absolute inset-x-2 bottom-0" style={{ height: '86%' }}>
            {quarters.map((q) => {
              const n = bySlot.get(q) ?? 0;
              const late = dayStart !== null && q >= dayStart + grace;
              const isPeak = busiest !== null && q === busiest.slot;
              return (
                <div key={q} className="group/col absolute bottom-0 flex h-full items-end px-[2px]" style={{ insetInlineStart: x(q), width: `${(15 / (hi - lo)) * 100}%` }}>
                  {n > 0 && (
                    <>
                      <div
                        className={cn(
                          'att-rise w-full rounded-t-[4px] transition-colors',
                          isPeak ? 'bg-[var(--att-brand-strong)]' : late ? 'bg-[var(--att-warn)] opacity-80 group-hover/col:opacity-100' : 'bg-[var(--att-brand)] group-hover/col:bg-[var(--att-brand-strong)]',
                        )}
                        style={{ height: `${(n / top) * 100}%` }}
                      />
                      <Bubble top={`${100 - (n / top) * 100}%`} hover={!isPeak}>
                        <span className="font-normal opacity-75">
                          {timeSpan(q, q + 15)} ·{' '}
                        </span>
                        {labels.people(n)}
                      </Bubble>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {dayStart !== null && (
            <Marker at={x(dayStart)} label={`${labels.start} ${clock(dayStart)}`} line="border-dashed border-[color:var(--att-ink-3)]" pill={cn('bg-[var(--att-sheet)] ring-1 ring-[var(--att-line)]', INK2)} />
          )}
          {now !== null && now > lo && now < hi && (
            <Marker at={x(now)} label={`${labels.now} ${clock(now)}`} line="border-[color:var(--att-accent)]" pill="bg-[var(--att-accent)] text-white" low />
          )}
        </div>
      </div>
      <div className={cn('relative ms-11 mt-2 h-4 whitespace-nowrap text-[10.5px]', FIG, INK3)}>
        {hours.map((hr) => (
          <span key={hr} className="absolute ltr:-translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: x(hr) }}>
            {hourTick(hr)}
          </span>
        ))}
      </div>
    </div>
  );
};

const Marker = ({ at, label, line, pill, low = false }: { at: string; label: string; line: string; pill: string; low?: boolean }): JSX.Element => (
  <div className={cn('pointer-events-none absolute bottom-0 top-0 z-10 border-s-[1.5px]', line)} style={{ insetInlineStart: at }}>
    <span className={cn('absolute start-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm', low ? 'top-2' : '-top-7', pill)}>
      <bdi>{label}</bdi>
    </span>
  </div>
);

/* ───────────────────────── Who is in (daily sheet) ───────────────────────── */

export interface PresencePart {
  key: string;
  label: string;
  value: number;
  tone: Tone;
}

/**
 * The day's headline: «105 من 128» with its share, one bar split by status, then one row per
 * status
 * — dot, name, its own small bar, count and share. Each row is also the filter for the list below.
 */
export const PresenceSummary = ({
  inCount,
  total,
  inLabel,
  ofLabel,
  parts,
  selected,
  onSelect,
}: {
  inCount: number;
  total: number;
  inLabel: string;
  ofLabel: string;
  parts: PresencePart[];
  selected: string;
  onSelect: (key: string) => void;
}): JSX.Element => {
  const sum = parts.reduce((s, p) => s + p.value, 0) || 1;
  // `inShare` and `share`, never «rate»: on these screens a rate is a thing payroll multiplies by,
  // and attendance is forbidden from knowing one (§1, D5) — so the word stays out of the file.
  const inShare = total > 0 ? Math.round((inCount / total) * 100) : 0;
  const share = (v: number): number => (total > 0 ? Math.round((v / total) * 100) : 0);
  return (
    <div className="flex h-full flex-col px-5 py-5 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn('text-[13px] font-medium', INK3)}>{inLabel}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={cn('text-[52px] font-semibold leading-none sm:text-[60px]', FIG, INK)}>{inCount}</span>
            <span className={cn('text-base', INK3)}>
              {ofLabel} <bdi className={FIG}>{total}</bdi>
            </span>
          </div>
        </div>
        <span className={cn('mt-1 rounded-full px-2.5 py-1 text-[13px] font-semibold', SOFT.ok)}>
          <bdi className={FIG}>{`${inShare}%`}</bdi>
        </span>
      </div>
      <div className="mt-4 flex h-2.5 gap-[3px] overflow-hidden rounded-full" aria-hidden>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span key={p.key} className={cn('h-full transition-opacity', DOT[p.tone], selected !== 'all' && selected !== p.key && 'opacity-25')} style={{ width: `${(p.value / sum) * 100}%` }} />
          ))}
      </div>
      <ul className="mt-4 flex flex-1 flex-col justify-between gap-0.5">
        {parts.map((p) => {
          const on = selected === p.key;
          return (
            <li key={p.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(on ? 'all' : p.key)}
                className={cn(
                  'grid min-h-[40px] w-full grid-cols-[minmax(0,7.5rem)_1fr_auto_2.75rem] items-center gap-3 rounded-[10px] px-2.5 text-start transition-colors',
                  on ? 'bg-[var(--att-accent-soft)] ring-1 ring-[var(--att-accent)]' : 'hover:bg-[var(--att-sheet-2)]',
                )}
              >
                <span className={cn('flex min-w-0 items-center gap-2 text-[13px] font-medium', INK2)}>
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-[3px]', DOT[p.tone])} />
                  <span className="truncate">{p.label}</span>
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-[var(--att-muted-soft)] dark:bg-[var(--att-line)]">
                  <span className={cn('block h-full rounded-full', DOT[p.tone])} style={{ width: `${share(p.value)}%` }} />
                </span>
                <span className={cn('text-[15px] font-semibold', FIG, INK)}>{p.value}</span>
                <span className={cn('text-end text-[12px]', FIG, INK3)}>{`${share(p.value)}%`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/* ───────────────────────── A month as a calendar of colours (employee) ───────────────────────── */

/** The period as a calendar: one square per day, filled by what the day was; today ringed. */
export const MonthHeatmap = ({
  days,
  weekdays,
  statusLabel,
  locale,
  today,
  picked,
  onPick,
}: {
  days: EmployeeDay[];
  weekdays: string[];
  statusLabel: (s: EmployeeDay['status']) => string;
  locale: 'ar' | 'en';
  today?: string;
  /** The date the reader picked, ringed here and highlighted in the daily record. */
  picked?: string | null;
  /**
   * Picking a date. Given, the cells become buttons — a calendar cell is the natural way to ask
   * about one day, and over a year of them hunting the same date in a list of 366 lines is work
   * the screen should do. Omitted, the cells stay plain text, which is what a print view wants.
   */
  onPick?: (date: string) => void;
}): JSX.Element => {
  if (days.length === 0) return <div />;
  // Weeks start on Saturday (Egypt). Pad the first week.
  const first = new Date(`${days[0]!.date}T00:00:00Z`).getUTCDay();
  const pad = (first + 1) % 7;
  const cells: (EmployeeDay | null)[] = [...Array.from({ length: pad }, () => null), ...days];
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return (
    <div className="px-5 pb-5 sm:px-6">
      <div className={cn('grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium', INK3)}>
        {weekdays.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (d === null) return <span key={`p${i}`} />;
          const tone = statusTone(d.status);
          const quiet = d.status === 'dayOff' || d.status === 'noSchedule';
          const label = `${fmt.format(new Date(`${d.date}T00:00:00Z`))} · ${statusLabel(d.status)}${d.inAt !== null ? ` · ${clock(d.inAt)}` : ''}`;
          const shell = cn(
            'relative flex aspect-square flex-col items-center justify-center rounded-[8px] text-[12px] font-semibold',
            FIG,
            quiet ? cn('bg-transparent ring-1 ring-inset ring-[var(--att-line)]', INK3) : SOFT[tone],
            d.date === today && 'ring-2 ring-[var(--att-accent)]',
            // The picked date wins the ring, so it is findable even when it is also today.
            d.date === picked && 'ring-2 ring-offset-1 ring-[var(--att-ink)]',
          );
          const face = (
            <>
              {Number(d.date.slice(8))}
              {d.inAt !== null && <span className="mt-0.5 hidden text-[9.5px] font-normal opacity-80 sm:block">{clock(d.inAt)}</span>}
            </>
          );
          return onPick === undefined ? (
            <span key={d.date} title={label} className={shell}>
              {face}
            </span>
          ) : (
            <button
              key={d.date}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={d.date === picked}
              onClick={() => onPick(d.date)}
              className={cn(shell, 'cursor-pointer transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--att-accent)]')}
            >
              {face}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ───────────────────────── Arrival trend (employee) ───────────────────────── */

const fmtShort = (locale: 'ar' | 'en'): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Groups the period into weeks of seven days, for the axis under a chart. */
const weekMarks = (count: number): { span: number; n: number }[] =>
  Array.from({ length: Math.ceil(count / 7) }, (_, w) => ({ span: Math.min(7, count - w * 7), n: w + 1 }));

/**
 * Each day's first check-in as one smooth line over a soft area. Later is higher, so a rising line
 * means arriving later; the dashed line is the start of the day plus its grace.
 */
export const ArrivalTrend = ({
  days,
  dayStart,
  grace,
  usual,
  labels,
  locale,
}: {
  days: EmployeeDay[];
  /** `null` when this employee has no shift and no default pattern — then no lateness line. */
  dayStart: number | null;
  grace: number;
  usual: number | null;
  labels: { limit: string; usual: string; week: (n: number) => string; empty: string };
  locale: 'ar' | 'en';
}): JSX.Element => {
  const rtl = locale === 'ar';
  const ins = days.map((d) => d.inAt).filter((m): m is number => m !== null);
  const anchors = [...(dayStart === null ? [] : [dayStart - 30, dayStart + grace + 30]), ...ins];
  if (anchors.length === 0) {
    return <p className={cn('px-5 pb-10 pt-4 text-center text-sm sm:px-6', INK3)}>{labels.empty}</p>;
  }
  const lo = Math.floor((Math.min(...anchors) - 5) / 30) * 30;
  const hi = Math.ceil((Math.max(...anchors) + 5) / 30) * 30;
  const n = Math.max(1, days.length - 1);
  // SVG x runs left → right; in Arabic the first day sits on the right.
  const sx = (i: number): number => (rtl ? 100 - (i / n) * 100 : (i / n) * 100);
  const py = (m: number): number => 100 - ((m - lo) / (hi - lo)) * 100;
  type Pt = { x: number; y: number; i: number; d: EmployeeDay };
  const pts: Pt[] = [];
  // The line is the trend: each point is the average of that day and the two worked days before
  // it, so one odd morning doesn't zig-zag the whole chart. Hovering a day shows its real time.
  const seen: number[] = [];
  days.forEach((d, i) => {
    if (d.inAt === null) return;
    seen.push(d.inAt);
    const win = seen.slice(-3);
    pts.push({ x: sx(i), y: py(win.reduce((a, b) => a + b, 0) / win.length), i, d });
  });
  // A gentle curve through the points (Catmull-Rom as cubic Béziers).
  let path = '';
  pts.forEach((p, k) => {
    if (k === 0) {
      path = `M ${p.x} ${p.y}`;
      return;
    }
    const p0 = pts[k - 2] ?? pts[k - 1]!;
    const p1 = pts[k - 1]!;
    const p3 = pts[k + 1] ?? p;
    path += ` C ${p1.x + (p.x - p0.x) / 6} ${p1.y + (p.y - p0.y) / 6}, ${p.x - (p3.x - p1.x) / 6} ${p.y - (p3.y - p1.y) / 6}, ${p.x} ${p.y}`;
  });
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = first !== undefined && last !== undefined ? `${path} L ${last.x} 100 L ${first.x} 100 Z` : '';
  const all = Array.from({ length: (hi - lo) / 30 + 1 }, (_, k) => lo + k * 30);
  const ticks = all.length <= 6 ? all : all.filter((_, k) => k % 2 === 0);
  const fmt = fmtShort(locale);

  return (
    <div className="px-5 pb-5 sm:px-6">
      <div className="flex gap-3">
        <div className={cn('relative h-64 w-16 shrink-0 whitespace-nowrap text-[10.5px]', FIG, INK3)}>
          {ticks.map((t) => (
            <span key={t} className="absolute end-0 -translate-y-1/2" style={{ top: `${py(t)}%` }}>
              {clock(t)}
            </span>
          ))}
        </div>
        <div className="relative h-64 flex-1">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-[var(--att-line)]" style={{ top: `${py(t)}%` }} />
          ))}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id="att-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--att-brand)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--att-brand)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#att-area)" />
            <path d={path} fill="none" stroke="var(--att-brand)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {dayStart !== null && (
            <div className="absolute inset-x-0 border-t border-dashed border-[color:var(--att-warn)]" style={{ top: `${py(dayStart + grace)}%` }}>
              <span className="absolute -top-[9px] end-0 bg-[var(--att-sheet)] ps-1.5 text-[11px] font-semibold text-[color:var(--att-warn)]">
                {labels.limit} <bdi className={FIG}>{clock(dayStart + grace)}</bdi>
              </span>
            </div>
          )}
          {usual !== null && (
            <span
              className={cn('absolute start-0 z-10 -translate-y-1/2 rounded-md bg-[var(--att-sheet)] px-1.5 py-0.5 text-[11px] font-semibold shadow-sm ring-1 ring-[var(--att-line)]', INK2)}
              style={{ top: `${py(usual)}%` }}
            >
              {labels.usual} <bdi className={FIG}>{clock(usual)}</bdi>
            </span>
          )}
          {last !== undefined && last.d.inAt !== null && (
            <span
              className="absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--att-brand)] ring-[3px] ring-[var(--att-sheet)]"
              style={{ top: `${last.y}%`, left: `${last.x}%` }}
            />
          )}
          {/* Hover targets: one column per day, a dot and a bubble on hover. */}
          <div className="absolute inset-0 flex">
            {days.map((d) => (
              <div key={d.date} className="group/col relative flex-1">
                {d.inAt !== null && (
                  <>
                    <span
                      className={cn(
                        'absolute start-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full opacity-0 ring-2 ring-[var(--att-sheet)] transition-opacity group-hover/col:opacity-100 ltr:-translate-x-1/2 rtl:translate-x-1/2',
                        dayStart !== null && d.inAt > dayStart + grace
                          ? 'bg-[var(--att-warn)]'
                          : 'bg-[var(--att-brand)]',
                      )}
                      style={{ top: `${py(d.inAt)}%` }}
                    />
                    <Bubble top={`${py(d.inAt)}%`} hover>
                      {fmt.format(new Date(`${d.date}T00:00:00Z`))} · <bdi className={FIG}>{clock(d.inAt)}</bdi>
                    </Bubble>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <WeekAxis count={days.length} label={labels.week} inset="ms-[76px]" />
    </div>
  );
};

/** A dark speech bubble with a small tail, centred on its column. */
const Bubble = ({ children, top, hover = false }: { children: ReactNode; top: string; hover?: boolean }): JSX.Element => (
  <span
    className={cn(
      'pointer-events-none absolute start-1/2 z-20 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-lg bg-[var(--att-brand-strong)] px-2.5 py-1 text-[12px] font-semibold text-white shadow-lg ltr:-translate-x-1/2 rtl:translate-x-1/2 dark:text-slate-900',
      "after:absolute after:start-1/2 after:top-full after:border-[5px] after:border-transparent after:border-t-[color:var(--att-brand-strong)] after:content-[''] ltr:after:-translate-x-1/2 rtl:after:translate-x-1/2",
      hover && 'hidden group-hover/col:block',
    )}
    style={{ top }}
  >
    {children}
  </span>
);

const WeekAxis = ({ count, label, inset = 'ms-[52px]' }: { count: number; label: (n: number) => string; inset?: string }): JSX.Element => (
  <div className={cn('mt-2 flex whitespace-nowrap text-[11px] font-medium', inset, INK3)}>
    {weekMarks(count).map((w) => (
      <span key={w.n} className="text-center" style={{ flex: w.span }}>
        {label(w.n)}
      </span>
    ))}
  </div>
);

/* ───────────────────────── Hours per day (employee) ───────────────────────── */

/**
 * Worked hours per day on a softly tinted panel. Days of the earlier month are pale, outlined bars;
 * the current month is solid brand; the latest counted day is the darkest, with its figure in a
 * bubble. The dashed line is the average.
 */
export const HoursBars = ({
  days,
  avg,
  locale,
  format,
  weekLabel,
}: {
  days: EmployeeDay[];
  avg: number | null;
  locale: 'ar' | 'en';
  format: (m: number | null) => string;
  weekLabel: (n: number) => string;
}): JSX.Element => {
  const top = Math.ceil(Math.max(8 * 60, ...days.map((d) => d.worked ?? 0)) / 120) * 120;
  // Gridlines every two hours, so every label is a whole number.
  const steps = Array.from({ length: top / 120 + 1 }, (_, k) => (k * 120) / top);
  const lastMonth = days.length > 0 ? days[days.length - 1]!.date.slice(0, 7) : '';
  const latest = days.reduce((l, d, i) => (d.worked !== null ? i : l), -1);
  const fmt = fmtShort(locale);
  // The plot area keeps 10% headroom for the bubble; the axis labels follow the same scale.
  const at = (f: number): string => `calc(${f * 90}% )`;
  return (
    <div className="px-5 pb-5 sm:px-6">
      <div className="flex gap-3">
        <div className={cn('relative h-56 w-10 shrink-0 text-[10.5px]', FIG, INK3)}>
          {steps.map((f) => (
            <span key={f} className="absolute end-0 translate-y-1/2" style={{ bottom: at(f) }}>
              {`${Math.round((top * f) / 60)}${locale === 'ar' ? 'س' : 'h'}`}
            </span>
          ))}
        </div>
        <div className="relative h-56 flex-1 rounded-xl border border-[var(--att-line)] bg-gradient-to-b from-[var(--att-brand-tint)] to-[var(--att-sheet)]">
          {steps.slice(1).map((f) => (
            <div key={f} className="absolute inset-x-0 border-t border-[var(--att-line)]" style={{ bottom: at(f) }} />
          ))}
          {avg !== null && <div className="absolute inset-x-0 z-10 border-t border-dashed border-[color:var(--att-ink-3)]" style={{ bottom: at(avg / top) }} />}
          <div className="absolute inset-x-2 bottom-0 flex items-end gap-[3px] sm:gap-[6px]" style={{ height: '90%' }}>
            {days.map((d, i) => {
              const old = d.date.slice(0, 7) !== lastMonth;
              const isLatest = i === latest;
              return (
                <div key={d.date} className="group/col relative flex h-full flex-1 items-end">
                  {d.worked !== null && (
                    <>
                      <div
                        className={cn(
                          'att-rise w-full rounded-t-[3px] transition-colors',
                          isLatest
                            ? 'bg-[var(--att-brand-strong)]'
                            : old
                              ? 'border border-b-0 border-[var(--att-brand-edge)] bg-[var(--att-brand-soft)] group-hover/col:bg-[var(--att-brand-edge)]'
                              : 'bg-[var(--att-brand)] group-hover/col:bg-[var(--att-brand-strong)]',
                        )}
                        style={{ height: `${Math.max(2, (d.worked / top) * 100)}%` }}
                      />
                      <Bubble top={`${100 - (d.worked / top) * 100}%`} hover={!isLatest}>
                        {!isLatest && <span className="font-normal opacity-75">{fmt.format(new Date(`${d.date}T00:00:00Z`))} · </span>}
                        <bdi className={FIG}>{format(d.worked)}</bdi>
                      </Bubble>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <WeekAxis count={days.length} label={weekLabel} />
    </div>
  );
};

export { INK };
