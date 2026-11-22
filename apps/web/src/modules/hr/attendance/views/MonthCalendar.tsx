// The period as a real calendar — one card per day, grouped by month — replacing the small square
// heatmap. Each day carries its status colour on a side rail, the arrival → departure times, and a
// thin bar of the hours worked against the hours the day required, so a glance answers «was he
// here, when, and did he complete the day» without opening anything.
import { cn } from '../../../../shared/lib/cn';
import { DOT, FIG, INK, INK2, INK3, StatusIcon, statusTone, type Tone } from './view-parts';
import { arrow, clock, shortDuration } from './view-format';
import type { EmployeeDay, ViewStatus } from './view-types';

const QUIET: ReadonlySet<ViewStatus> = new Set(['dayOff', 'noSchedule', 'noRecord', 'holiday']);

/** The day's tint — soft enough that a month of them reads as a pattern, not as noise. */
const TINT: Record<Tone, string> = {
  ok: 'bg-[var(--att-ok-soft)]',
  warn: 'bg-[var(--att-warn-soft)]',
  bad: 'bg-[var(--att-bad-soft)]',
  info: 'bg-[var(--att-info-soft)]',
  muted: 'bg-[var(--att-sheet-2)]',
  accent: 'bg-[var(--att-accent-soft)]',
};
const GLYPH: Record<Tone, string> = {
  ok: 'text-[color:var(--att-ok)]',
  warn: 'text-[color:var(--att-warn)]',
  bad: 'text-[color:var(--att-bad)]',
  info: 'text-[color:var(--att-info)]',
  muted: 'text-[color:var(--att-ink-3)]',
  accent: 'text-[color:var(--att-accent)]',
};

export interface CalendarLegendItem {
  tone: Tone;
  label: string;
  count: number;
}

export const MonthCalendar = ({
  days,
  weekdays,
  statusLabel,
  locale,
  today,
  picked,
  onPick,
  legend,
}: {
  days: EmployeeDay[];
  /** Saturday first — the Egyptian week. */
  weekdays: string[];
  statusLabel: (s: ViewStatus) => string;
  locale: 'ar' | 'en';
  today?: string;
  picked?: string | null;
  onPick?: (date: string) => void;
  legend: CalendarLegendItem[];
}): JSX.Element => {
  if (days.length === 0) return <div />;
  const months = new Map<string, EmployeeDay[]>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    const list = months.get(key);
    if (list === undefined) months.set(key, [d]);
    else list.push(d);
  }
  const monthFmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const longFmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  return (
    <div className="px-4 pb-5 sm:px-6">
      <div className="flex flex-wrap gap-2 pb-4">
        {legend.map((item) => (
          <span
            key={item.label}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border border-[var(--att-line)] px-3 py-1 text-[12.5px] font-medium',
              INK2,
            )}
          >
            <span className={cn('h-2.5 w-2.5 rounded-full', DOT[item.tone])} />
            {item.label}
            <bdi className={cn('font-semibold', FIG, INK)}>{item.count}</bdi>
          </span>
        ))}
      </div>

      <div className="space-y-6">
        {[...months.entries()].map(([month, list]) => {
          const first = new Date(`${list[0]!.date}T00:00:00Z`).getUTCDay();
          const pad = (first + 1) % 7; // weeks start on Saturday
          const cells: (EmployeeDay | null)[] = [...Array.from({ length: pad }, () => null), ...list];
          return (
            <div key={month}>
              {months.size > 1 && (
                <h3 className={cn('mb-2 text-sm font-semibold', INK)}>
                  {monthFmt.format(new Date(`${month}-01T00:00:00Z`))}
                </h3>
              )}
              <div className={cn('grid grid-cols-7 gap-1.5 pb-1.5 text-center text-[11.5px] font-semibold sm:gap-2', INK3)}>
                {weekdays.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {cells.map((d, i) => {
                  if (d === null) return <span key={`p${i}`} aria-hidden />;
                  const tone = statusTone(d.status);
                  const quiet = QUIET.has(d.status) || d.status === 'notYetIn';
                  const required = d.expected === null ? null : d.expected.end - d.expected.start;
                  const fill =
                    d.worked === null || required === null || required <= 0
                      ? null
                      : Math.min(100, Math.round((d.worked / required) * 100));
                  const label = `${longFmt.format(new Date(`${d.date}T00:00:00Z`))} · ${statusLabel(d.status)}${
                    d.inAt !== null ? ` · ${clock(d.inAt)}${d.outAt !== null ? ` ${arrow()} ${clock(d.outAt)}` : ''}` : ''
                  }`;
                  const shell = cn(
                    'group relative flex min-h-[56px] flex-col overflow-hidden rounded-xl p-1.5 text-start transition sm:min-h-[88px] sm:p-2.5',
                    quiet ? cn('border border-dashed border-[var(--att-line)]', INK3) : TINT[tone],
                    d.date === today && 'ring-2 ring-[var(--att-accent)] ring-offset-2 ring-offset-[var(--att-sheet)]',
                    d.date === picked && 'shadow-[0_0_0_2px_var(--att-ink)]',
                  );
                  const face = (
                    <>
                      <span className="flex items-center justify-between gap-1">
                        <span className={cn('text-[13px] font-bold sm:text-[15px]', FIG, quiet ? INK3 : INK)}>
                          {Number(d.date.slice(8))}
                        </span>
                        {!quiet && <StatusIcon status={d.status} className={GLYPH[tone]} />}
                      </span>
                      {d.inAt !== null && (
                        <span className={cn('mt-auto hidden text-[11px] font-medium sm:block', FIG, INK2)}>
                          {clock(d.inAt)}
                          <span className={INK3}> {arrow()} </span>
                          {d.outAt !== null ? clock(d.outAt) : '—'}
                        </span>
                      )}
                      {quiet && d.inAt === null && (
                        <span className="mt-auto hidden truncate text-[10.5px] sm:block">{statusLabel(d.status)}</span>
                      )}
                      {fill !== null && (
                        <span className="mt-1 hidden items-center gap-1.5 sm:flex">
                          <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--att-sheet)]">
                            <span className={cn('block h-full rounded-full', DOT[tone])} style={{ width: `${fill}%` }} />
                          </span>
                          <span className={cn('text-[10px]', FIG, INK3)}>{shortDuration(d.worked ?? 0)}</span>
                        </span>
                      )}
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
                      className={cn(shell, 'cursor-pointer hover:-translate-y-px hover:border-[var(--att-line-strong)] hover:shadow-sm')}
                    >
                      {face}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
