// ONE DAY PER LINE ON AN HOUR RULER — shared by the daily board's pop-up and the employee's daily
// record, so both read the same way.
//
// Each day: the date and status, the hours worked; then the arrival time, the bar, the departure
// time. On the bar: the expected shift as a faint outline, the worked span solid green, the late
// part (shift start → arrival) as a soft red stripe, the early-leave part (departure → the hour
// they were due to leave) as an orange stripe leaning the other way, overtime past the shift's end
// in blue, and every repeat press as a thin tick. BOTH ENDS OF A SHORT DAY ARE DRAWN: the day the
// engine calls «تأخير وانصراف مبكر» used to show only the late end. The axis follows the reading direction — in Arabic the day
// starts on the right, beside the arrival time. A day's scans open under it.
import { useState, type CSSProperties } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { useT } from '../../../../platform/localization/useT';
import { EARLY_SOFT, FIG, INK, INK2, INK3, RowMenu, SOFT, StatusIcon, statusTone, type Tone } from './view-parts';
import { clock, hm } from './view-format';
import { useViewLabels } from './view-labels';
import { hourLabel, pct, ticksOf, trackRangeFor, type TrackRange, type TrackScan } from './roster';
import type { EmployeeDay, ScanEntry } from './view-types';

const GLYPH: Record<Tone, string> = {
  ok: 'text-[color:var(--att-ok)]',
  warn: 'text-[color:var(--att-warn)]',
  bad: 'text-[color:var(--att-bad)]',
  info: 'text-[color:var(--att-info)]',
  muted: 'text-[color:var(--att-ink-3)]',
  accent: 'text-[color:var(--att-accent)]',
};
const ROLE_TONE: Record<ScanEntry['role'], Tone> = { arrival: 'ok', departure: 'info', repeat: 'muted' };

const scanMinute = (s: ScanEntry): number => {
  const [h, m] = s.time.split(':').map(Number) as [number, number];
  return s.dayOffset * 1440 + h * 60 + m;
};

/** The key under the list — what each colour on the bars means. */
export const DayLegend = (): JSX.Element => {
  const { t, status } = useViewLabels();
  const tt = useT();
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px]', INK2)}>
      <Key swatch="h-2 w-4 rounded-full bg-[var(--att-ok)]" label={t('worked')} />
      <Key swatch="att-late-stripe h-2 w-4 rounded-full" label={status('late')} />
      <Key swatch="att-early-stripe h-2 w-4 rounded-full" label={t('earlyLeaveCol')} />
      <Key swatch="h-2 w-4 rounded-full bg-[var(--att-info)]" label={t('overtime')} />
      <Key swatch="h-2 w-4 rounded-full border border-[var(--att-line-strong)]" label={t('expected')} />
      <Key swatch="h-3 w-[2px] rounded bg-[var(--att-ink-2)]" label={tt('attendanceView.role.repeat')} />
    </ul>
  );
};
const Key = ({ swatch, label }: { swatch: string; label: string }): JSX.Element => (
  <li className="inline-flex items-center gap-2">
    <span className={swatch} aria-hidden />
    {label}
  </li>
);

export const DayTimelineList = ({
  days,
  today,
  locale,
  actionsLabel,
}: {
  days: EmployeeDay[];
  today: string;
  locale: 'ar' | 'en';
  /** When set, a day's `action` («اتخاذ قرار») sits in a «⋯» on its line. */
  actionsLabel?: string;
}): JSX.Element => {
  const { t, status } = useViewLabels();
  const tt = useT();
  const [openDay, setOpenDay] = useState<string | null>(null);
  const withScans = days.map((d) => ({ day: d, marks: (d.scans ?? []).map((s): TrackScan => ({ at: scanMinute(s), role: s.role })) }));
  const range = trackRangeFor(withScans.map(({ day, marks }) => ({ inAt: day.inAt, outAt: day.outAt, expected: day.expected, scans: marks })));
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const rel = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
  const dayTitle = (date: string): { main: string; sub: string | null } => {
    const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    const long = fmt.format(new Date(`${date}T00:00:00Z`));
    if (diff !== 0 && diff !== 1) return { main: long, sub: null };
    const word = rel.format(-diff, 'day');
    return { main: `${word.charAt(0).toUpperCase()}${word.slice(1)}`, sub: long };
  };

  const any = withScans.some(({ day, marks }) => day.inAt !== null || marks.length > 0);
  const GRID = 'grid grid-cols-[4.75rem_minmax(0,1fr)_4.75rem_5.5rem] items-center gap-x-4 max-sm:grid-cols-[4rem_minmax(0,1fr)_4rem]';

  return (
    <div>
      {/* ONE RULER for the whole list — the hours once, and which end is which, once. */}
      {any && (
        <div className={cn(GRID, 'mb-2 px-[17px]')} aria-hidden>
          <span className={cn('text-[11px] font-medium', INK3)}>{t('arrived')}</span>
          <Ruler range={range} />
          <span className={cn('text-end text-[11px] font-medium', INK3)}>{t('left')}</span>
          <span className={cn('text-end text-[11px] font-medium max-sm:hidden', INK3)}>{t('worked')}</span>
        </div>
      )}
      <ol className="space-y-1.5">
        {withScans.map(({ day: d, marks }) => {
          const tone = statusTone(d.status);
          const scans = d.scans ?? [];
          const quiet = d.inAt === null && scans.length === 0;
          const isOpen = openDay === d.date;
          const title = dayTitle(d.date);
          const late = d.lateMinutes !== null && d.lateMinutes > 0 ? d.lateMinutes : null;
          // THE STATUS DECIDES, not the clock. Under the flexible-hours rule a departure before
          // the hour costs nothing once the hours are complete, and the engine has already applied
          // that (and the out-grace) in `earlyLeaveMinutes`. Gating on the status as well is what
          // stops a future reading of the figure from drawing early leave on a day the engine
          // calls «حاضر».
          const early =
            (d.status === 'earlyLeave' || d.status === 'lateAndEarly') &&
            d.earlyLeave !== null &&
            d.earlyLeave > 0
              ? d.earlyLeave
              : null;
          const short = d.shortfall !== null && d.shortfall > 0 && late === null && early === null ? d.shortfall : null;
          const menu = actionsLabel !== undefined && d.action !== undefined ? <RowMenu label={actionsLabel}>{d.action}</RowMenu> : null;
          if (quiet) {
            return (
              <li key={d.date} id={`att-day-${d.date}`} className="flex items-center gap-3 rounded-xl px-4 py-2">
                <span className={cn('text-[13px]', INK3)}>{title.main}</span>
                {title.sub !== null && <span className={cn('text-[12px]', INK3)}>{title.sub}</span>}
                <span className="h-px flex-1 border-t border-dashed border-[var(--att-line)]" aria-hidden />
                <span className={cn('inline-flex items-center gap-1 text-[12px]', INK3)}>
                  <StatusIcon status={d.status} className="h-3 w-3" />
                  {status(d.status)}
                </span>
                {menu}
              </li>
            );
          }
          return (
            <li key={d.date} id={`att-day-${d.date}`} className="rounded-xl border border-[var(--att-line)] bg-[var(--att-sheet)] px-4 py-3 transition-colors hover:border-[var(--att-line-strong)]">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h3 className={cn('text-[14px] font-semibold', INK)}>
                  {title.main}
                  {title.sub !== null && <span className={cn('ms-2 text-[12.5px] font-normal', INK3)}>{title.sub}</span>}
                </h3>
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold', SOFT[tone])}>
                  <StatusIcon status={d.status} className="h-3 w-3" />
                  {status(d.status)}
                </span>
                {late !== null && (
                  <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', SOFT.bad)}>
                    {status('late')} <bdi className={FIG}>{hm(late, locale)}</bdi>
                  </span>
                )}
                {early !== null && (
                  <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', EARLY_SOFT)}>
                    {t('earlyLeaveCol')} <bdi className={FIG}>{hm(early, locale)}</bdi>
                  </span>
                )}
                {short !== null && (
                  <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', SOFT.warn)}>
                    {t('shortfallCol')} <bdi className={FIG}>{hm(short, locale)}</bdi>
                  </span>
                )}
                {d.tags.map((tag) => (
                  <span key={tag} className={cn('text-[12px]', GLYPH.accent)}>
                    {tag}
                  </span>
                ))}
                {menu !== null && <span className="ms-auto">{menu}</span>}
              </div>

              <div className={cn(GRID, 'mt-2.5')}>
                <TimeCell value={d.inAt} />
                <DayBar range={range} day={d} marks={marks} />
                <TimeCell value={d.outAt} end />
                <span className={cn('text-end text-[14px] font-semibold max-sm:hidden', FIG, d.worked === null ? INK3 : INK)}>{hm(d.worked, locale)}</span>
              </div>

              {scans.length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenDay(isOpen ? null : d.date)}
                    className={cn('inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-[11.5px] font-medium transition-colors hover:bg-[var(--att-sheet-2)]', INK3)}
                  >
                    <bdi className={FIG}>{tt('attendanceView.scans', { n: scans.length })}</bdi>
                    {(d.repeats ?? 0) > 0 && <span className={cn('rounded-full px-1.5 text-[10.5px]', SOFT.muted)}>{tt('attendanceView.repeats', { n: d.repeats ?? 0 })}</span>}
                    <svg viewBox="0 0 16 16" className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                  </button>
                  {isOpen && (
                    <ol className="att-open mt-2 flex flex-wrap gap-1.5">
                      {scans.map((sc, i) => (
                        <li
                          key={`${sc.time}-${i}`}
                          title={`${tt('attendanceView.device')}: ${sc.device ?? tt(`attendanceView.source.${sc.source}`)} · ${tt('attendanceView.branch')}: ${sc.branch ?? '—'}`}
                          className={cn('inline-flex items-center gap-2 rounded-lg bg-[var(--att-sheet-2)] px-2.5 py-1.5 text-[12px]', sc.role === 'repeat' && 'opacity-70')}
                        >
                          <span className={cn('font-semibold', FIG, INK)}>
                            {sc.time}
                            {sc.dayOffset > 0 && <sup className={cn('ms-0.5 text-[9.5px]', INK3)}>+{sc.dayOffset}</sup>}
                          </span>
                          <span className={cn('rounded-full px-1.5 text-[10.5px] font-semibold', SOFT[ROLE_TONE[sc.role]])}>{tt(`attendanceView.role.${sc.role}`)}</span>
                          <span className={INK3}>{sc.device ?? tt(`attendanceView.source.${sc.source}`)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

const TimeCell = ({ value, end = false }: { value: number | null; end?: boolean }): JSX.Element => (
  <span className={cn('block whitespace-nowrap text-[14px] font-semibold', end && 'text-end', FIG, value === null ? INK3 : INK)}>{value === null ? '—' : clock(value)}</span>
);

/** The hour labels, once, above the list — aligned with every bar below. */
const Ruler = ({ range }: { range: TrackRange }): JSX.Element => {
  const ticks = ticksOf(range);
  return (
    <div className="relative h-3.5">
      {ticks.map((m, i) => (
        <span
          key={m}
          className={cn('absolute text-[10.5px] leading-none', FIG, INK3, i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full rtl:translate-x-full' : '-translate-x-1/2 rtl:translate-x-1/2')}
          style={{ insetInlineStart: `${pct(m, range)}%` }}
        >
          {hourLabel(m)}:00
        </span>
      ))}
    </div>
  );
};

/** One day's bar. Positions are on the inline axis, so in Arabic the morning is on the right. */
const DayBar = ({ range, day, marks }: { range: TrackRange; day: EmployeeDay; marks: TrackScan[] }): JSX.Element => {
  const { inAt, outAt, expected } = day;
  const lateFrom = expected !== null && inAt !== null && (day.lateMinutes ?? 0) > 0 && inAt > expected.start ? expected.start : null;
  // The other end of a short day: departure → the hour they were due to leave. The same shape as
  // `lateFrom` and the same guards — the engine's status and its figure, then the clock as a
  // sanity check, so a bar is never drawn backwards. `expected.end` is already the real end for a
  // night or 24-hour shift (the span is resolved per date by the server and crosses midnight as
  // minutes past this day's start), so no special case is needed here either.
  const earlyTo =
    expected !== null &&
    outAt !== null &&
    (day.status === 'earlyLeave' || day.status === 'lateAndEarly') &&
    (day.earlyLeave ?? 0) > 0 &&
    outAt < expected.end
      ? expected.end
      : null;
  const workEnd = outAt === null ? null : expected !== null && inAt !== null && outAt > expected.end && inAt < expected.end ? expected.end : outAt;
  const overtimeFrom = outAt !== null && workEnd !== null && workEnd < outAt ? workEnd : null;
  const at = (m: number): CSSProperties => ({ insetInlineStart: `${pct(m, range)}%` });
  const seg = (a: number, b: number): CSSProperties => ({ ...at(a), width: `${Math.max(0.8, pct(b, range) - pct(a, range))}%` });
  const ticks = ticksOf(range);
  return (
    <div aria-hidden>
      <div className="relative h-2.5 rounded-full bg-[var(--att-muted-soft)]">
        {ticks.map((m) => (
          <span key={m} className="absolute -inset-y-1 w-px bg-[var(--att-line)]" style={at(m)} />
        ))}
        {expected !== null && <span className="absolute -inset-y-[3px] rounded-full border border-[var(--att-line-strong)]" style={seg(expected.start, expected.end)} />}
        {lateFrom !== null && inAt !== null && <span className="att-late-stripe absolute inset-y-0 rounded-full" style={seg(lateFrom, inAt)} />}
        {earlyTo !== null && outAt !== null && <span className="att-early-stripe absolute inset-y-0 rounded-full" style={seg(outAt, earlyTo)} />}
        {inAt !== null && workEnd !== null && <span className="absolute inset-y-0 rounded-full bg-[var(--att-ok)]" style={seg(inAt, workEnd)} />}
        {overtimeFrom !== null && outAt !== null && <span className="absolute inset-y-0 rounded-full bg-[var(--att-info)]" style={seg(overtimeFrom, outAt)} />}
        {marks.map((s, i) =>
          s.role === 'repeat' ? <span key={i} className="absolute -inset-y-1.5 w-[2px] rounded bg-[var(--att-ink-2)]" style={{ ...at(s.at), marginInlineStart: '-1px' }} /> : null,
        )}
        {inAt !== null && <Dot style={at(inAt)} />}
        {outAt !== null && <Dot style={at(outAt)} />}
      </div>
    </div>
  );
};

const Dot = ({ style }: { style: CSSProperties }): JSX.Element => (
  <span className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-[3px] border-[var(--att-sheet)] bg-[var(--att-ok)] shadow-[0_0_0_1px_var(--att-ok)]" style={{ ...style, marginInlineStart: '-7px' }} />
);

