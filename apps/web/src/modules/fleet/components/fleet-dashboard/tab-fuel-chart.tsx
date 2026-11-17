// «مصروف التشغيل يومًا بيوم» — the day chart of «الوقود والمصروفات» (approved/fuel-dark.png; harness
// zz-fuel.tsx `DayChart`; critic C12), over R2's `opexSeries`: EVERY slot of the range in order, by
// the receipt's paper day.
//
//   · every column is the site's brand (DECISIONS §5): the kit's bar shade, today's column (the
//     readout's, until the pointer moves) one shade stronger — lighter on dark;
//   · a Friday (the week's rest day, by the calendar alone) is the same column at 55% on a tinted
//     slot, and the axis names each day with its weekday («اليوم» for today);
//   · a day with no receipt is an EMPTY slot (`hasRows: false`), never a zero column;
//   · a long range («هذه السنة», or more than a month) comes as months: «مصروف التشغيل شهرًا بشهر»,
//     no Friday and no weekday (the odometer chart's month variant);
//   · on a phone the drawing scrolls inside its card and opens on the latest slot.
//
// The columns open nothing (the approved chart has no column links): the readout above the drawing
// names the column under the pointer or the keyboard. Nothing is counted: every amount is the
// server's; the browser only scales the columns to a round axis and reads a key's weekday.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ymdToUtcDate, type FleetDashboardOpexBucketDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import {
  LABEL_EVERY_DAY,
  axisLabel,
  axisTicks,
  isFriday,
} from '../../lib/fleet-dashboard-km-chart';
import { slashDay } from '../../lib/fleet-dashboard-tabs';
import { Amount, count } from './dash-shell';
import { BlockFoot, BlockHead, COUNT_CHIP, NoteLine } from './dash-blocks';
import { Card, I, MUTED, N, NUM, TONE, cn } from './dash-kit';
import { EndLine, Money, useFuelWords } from './tab-fuel-words';

// ── The brand family (DECISIONS §5) ───────────────────────────────────────────────────────────

/** A day's column, and its legend swatch: the kit's bar shade. */
const SOLID = TONE.brand.bar;
/** Today's column (the readout's), or the column under the pointer: one shade stronger. */
const SOLID_ON = 'bg-brand-800 dark:bg-brand-300';
/** A Friday's slot behind its (dimmed) column. */
const FRIDAY_SLOT = 'bg-slate-100/80 dark:bg-white/[0.035]';
const FRIDAY_DIM = 'opacity-55';
const READOUT_DAY =
  'border-brand-300 bg-brand-100 text-brand-800 dark:border-brand-800/50 dark:bg-brand-950/70 dark:text-brand-300';
const PLOT_H = 'h-[300px]';
const TICK = 'block text-[11px] leading-none text-slate-400 dark:text-slate-500';
const GRID_LINE = 'border-slate-100 dark:border-[#1a2538]';
const BASELINE = 'border-slate-300 dark:border-[#2a3953]';
/** On a phone a slot never gets narrower than its day: the plot scrolls inside the card. */
const PHONE_COLUMN_PX = 48;
/** The fewest slots between two labels of a long daily axis (the odometer chart's rule). */
const LABEL_GAP = 3;

const Swatch = ({ children, label }: { children: ReactNode; label: ReactNode }): JSX.Element => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
    {children}
    <span>{label}</span>
  </span>
);

const Dot = (): JSX.Element => <span className="text-slate-400">·</span>;

/**
 * The slots a long daily axis names: every one up to LABEL_EVERY_DAY, else the first, the last
 * and every seventh (unless it would sit on the last one's label); a month axis names them all.
 */
const labelled = (keys: readonly string[], daily: boolean): Set<number> => {
  const last = keys.length - 1;
  const every = !daily || keys.length <= LABEL_EVERY_DAY;
  const out = new Set<number>();
  keys.forEach((_, i) => {
    if (every || i === 0 || i === last || (i % 7 === 0 && last - i >= LABEL_GAP)) out.add(i);
  });
  return out;
};

export const OpexDayChart = ({
  buckets,
  granularity,
  today,
  total,
}: {
  buckets: readonly FleetDashboardOpexBucketDto[];
  granularity: 'day' | 'month';
  /** Cairo today, as R2 echoes it. */
  today: string;
  /** `opex.total` for the head's chip; `null` when that section is not drawn. */
  total: number | null;
}): JSX.Element => {
  const w = useFuelWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const daily = granularity === 'day';
  const current = (key: string): boolean => (daily ? key === today : key === today.slice(0, 7));
  const keys = buckets.map((b) => b.key);
  const nowAt = keys.findIndex(current);
  // The readout opens on today (or this month), else on the last slot of the range.
  const focus = nowAt === -1 ? buckets.length - 1 : nowAt;
  const [picked, setPicked] = useState<number | null>(null);
  const shown = buckets[picked ?? focus];
  const ticks = axisTicks(Math.max(0, ...buckets.map((b) => b.amount)));
  const top = ticks[ticks.length - 1] ?? 0;
  const at = (amount: number): number => (top > 0 ? Math.min(100, (amount / top) * 100) : 0);
  const names = labelled(keys, daily);
  const any = buckets.some((b) => b.hasRows);
  const weekday = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  const label = (key: string): string => (daily ? slashDay(key) : axisLabel(key, 'month'));
  // On a phone the plot is wider than its card: it opens on the latest slots — the right end, the
  // drawing being dir=ltr — where today and the readout's slot are.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    if (box !== null) box.scrollLeft = box.scrollWidth;
  }, [buckets.length]);
  const gap = buckets.length <= LABEL_EVERY_DAY ? 'gap-2' : 'gap-1';
  const plotWidth = {
    '--fuel-plot': `${buckets.length * PHONE_COLUMN_PX}px`,
  } as CSSProperties;

  return (
    <Card data-fuel-block="chart" data-fuel-chart={granularity} className="mt-5">
      <BlockHead
        icon={I.bars}
        tone="brand"
        title={w(daily ? 'chart.titleDaily' : 'chart.titleMonthly')}
        note={w(daily ? 'chart.noteDaily' : 'chart.noteMonthly')}
        chips={
          total === null ? undefined : (
            <span data-fuel-chip="chart" className={cn(COUNT_CHIP, TONE.sky.soft)}>
              <Amount value={total} />
            </span>
          )
        }
      />
      {!any || shown === undefined ? (
        <EndLine marker="chart">{w('chart.empty')}</EndLine>
      ) : (
        <div className="px-5 pb-5">
          <div
            data-fuel-readout={shown.key}
            className="flex min-h-[46px] flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700 shadow-inner dark:border-brand-500/30 dark:bg-[#0c1322]/90 dark:text-slate-300"
          >
            <span
              dir="ltr"
              className={cn('rounded border px-2 py-0.5 font-bold', READOUT_DAY, NUM)}
            >
              {label(shown.key)}
            </span>
            {daily && (
              <span className="font-semibold">{weekday.format(ymdToUtcDate(shown.key))}</span>
            )}
            <Dot />
            {shown.hasRows ? (
              <Money value={shown.amount} className="text-sm" />
            ) : (
              <span className={MUTED}>{w('chart.noRows')}</span>
            )}
            {current(shown.key) && (
              <>
                <Dot />
                <span className={TONE.brand.text}>
                  {w(daily ? 'chart.today' : 'chart.thisMonth')}
                </span>
              </>
            )}
          </div>
          <div
            ref={scroller}
            dir="ltr"
            data-fuel-scroller="true"
            className="max-md:overflow-x-auto max-md:overscroll-x-contain"
          >
            <div
              role="group"
              aria-label={w(daily ? 'chart.titleDaily' : 'chart.titleMonthly')}
              className="mt-3 flex gap-3 pt-9 max-md:min-w-[var(--fuel-plot)]"
              style={plotWidth}
            >
              {/* The value axis, round steps in ج.م, at the drawing's start (the days run left to
                  right). */}
              <div aria-hidden="true" className={cn('relative w-14 shrink-0', PLOT_H)}>
                <span
                  dir={locale === 'ar' ? 'rtl' : 'ltr'}
                  data-fuel-axis-unit="true"
                  className="absolute -top-9 right-0 whitespace-nowrap text-[11px] font-semibold text-slate-400 dark:text-slate-500"
                >
                  {w('chart.unit')}
                </span>
                {ticks.map((tick) => (
                  <span
                    key={tick}
                    data-fuel-tick={String(tick)}
                    className="absolute end-0 translate-y-1/2 text-end"
                    style={{ bottom: `${at(tick)}%` }}
                  >
                    <N className={TICK}>{count(tick)}</N>
                  </span>
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <div className={cn('relative', PLOT_H)}>
                  {ticks.map((tick) => (
                    <div
                      key={tick}
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-x-0 border-t',
                        tick === 0 ? BASELINE : GRID_LINE,
                      )}
                      style={{ bottom: `${at(tick)}%` }}
                    />
                  ))}
                  <div role="list" className={cn('absolute inset-0 flex', gap)}>
                    {buckets.map((b, i) => {
                      const friday = daily && isFriday(b.key);
                      const now = current(b.key);
                      return (
                        <div
                          key={b.key}
                          role="listitem"
                          tabIndex={0}
                          data-fuel-day={b.key}
                          {...(friday ? { 'data-fuel-friday': 'true' } : {})}
                          {...(now ? { 'data-fuel-today': 'true' } : {})}
                          {...(b.hasRows ? {} : { 'data-fuel-empty': 'true' })}
                          aria-label={`${label(b.key)}: ${count(b.amount)} ${w('chart.unit')}`}
                          onMouseEnter={() => setPicked(i)}
                          onMouseLeave={() => setPicked(null)}
                          onFocus={() => setPicked(i)}
                          onBlur={() => setPicked(null)}
                          className={cn(
                            'relative flex h-full min-w-0 flex-1 justify-center rounded-t-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                            friday && FRIDAY_SLOT,
                          )}
                        >
                          {b.hasRows ? (
                            <div
                              className={cn(
                                'relative h-full w-full max-w-[76px]',
                                friday && FRIDAY_DIM,
                              )}
                            >
                              <span
                                data-fuel-col={b.key}
                                className={cn(
                                  'absolute inset-x-0 bottom-0 rounded-t-[4px]',
                                  now || picked === i ? SOLID_ON : SOLID,
                                )}
                                style={{ height: `${at(b.amount)}%` }}
                              />
                            </div>
                          ) : (
                            // No receipt that day: an empty slot on the baseline, never a zero
                            // column.
                            <span
                              aria-hidden="true"
                              className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full border border-slate-400 bg-white dark:border-slate-500 dark:bg-[#0e1422]"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className={cn('mt-2.5 flex', gap)}>
                  {buckets.map((b, i) => {
                    const now = current(b.key);
                    return (
                      <div
                        key={b.key}
                        {...(names.has(i) ? { 'data-fuel-label': b.key } : {})}
                        className="flex min-w-0 flex-1 flex-col items-center gap-0.5"
                      >
                        {names.has(i) && (
                          <>
                            <N
                              className={cn(
                                'whitespace-nowrap text-xs font-bold',
                                daily && isFriday(b.key)
                                  ? 'text-slate-400 dark:text-slate-500'
                                  : 'text-slate-700 dark:text-slate-200',
                              )}
                            >
                              {axisLabel(b.key, granularity)}
                            </N>
                            {daily && (
                              <span
                                dir={locale === 'ar' ? 'rtl' : 'ltr'}
                                className={cn(
                                  'whitespace-nowrap text-[11px] font-semibold',
                                  now ? TONE.brand.text : MUTED,
                                )}
                              >
                                {now ? w('chart.axisToday') : weekday.format(ymdToUtcDate(b.key))}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <div
            data-fuel-legend={granularity}
            className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
          >
            <Swatch label={w(daily ? 'chart.legendDay' : 'chart.legendMonth')}>
              <span className={cn('h-2.5 w-2.5 rounded-sm', SOLID)} />
            </Swatch>
            <Swatch label={w(daily ? 'chart.today' : 'chart.thisMonth')}>
              <span className={cn('h-2.5 w-2.5 rounded-sm', SOLID_ON)} />
            </Swatch>
            {daily && (
              <Swatch label={w('chart.legendFriday')}>
                <span
                  className={cn(
                    'relative h-2.5 w-3.5 overflow-hidden rounded-sm border border-slate-200 dark:border-[#26324a]',
                    FRIDAY_SLOT,
                  )}
                >
                  <span
                    className={cn(
                      'absolute inset-x-[3px] bottom-0 top-[2px] rounded-t-[1px]',
                      FRIDAY_DIM,
                      SOLID,
                    )}
                  />
                </span>
              </Swatch>
            )}
          </div>
        </div>
      )}
      <BlockFoot>
        <NoteLine>{w('chart.late')}</NoteLine>
      </BlockFoot>
    </Card>
  );
};
