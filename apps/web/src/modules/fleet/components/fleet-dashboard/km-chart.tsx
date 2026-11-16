// «الكيلومترات يومًا بيوم» — the day chart of «العدادات والكيلومترات», drawn from
// `lib/fleet-dashboard-km-chart.ts` (R-15, Q-10) as the owner approved it (approved/odo-dark.png and
// odo-branch-dark.png; harness zz-odometer.tsx `?bars=brand`):
//
//   · the solid confirmed part, the OUTLINED span part on its start day (never the confirmed fill),
//     the hatched cap of a day still waiting for readings (today always), the stale marker, the
//     empty slot of a day without any reading (never a zero bar), and the average line over the
//     closed days with its own label at the line's end;
//   · every bar is the site's brand (DECISIONS §5, «الوان البارات مش متنسقة مع الويب»): a confirmed
//     column is the kit's bar shade, the latest confirmed day (the readout's) one shade stronger —
//     lighter on dark — the span the brand's dashed outline, today's cap the brand's hatch (themed
//     with `dark:` classes, never a theme read in script). Status colours stay: the amber marker;
//   · a Friday (the week's rest day, by the calendar alone) is the same column at 55% on a tinted
//     slot, and the axis names each day with its weekday («اليوم» for today);
//   · above 31 days the columns are months (no Friday, no weekday, no per-day average line).
//
// Every column opens the odometer screen over its own day (or month) and the period's filters; the
// readout above the drawing names the column the pointer or the keyboard is on. The foot lines (what
// is confirmed, what is still open, the spans, the stale cars, the old book's km) are `KmChartNotes`,
// drawn in the block's ruled foot. Nothing is counted here: every figure is the server's.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ymdToUtcDate,
  type FleetDashboardPeriodDto,
  type FleetDashboardPeriodKmDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { periodLinks } from '../../lib/fleet-dashboard-links';
import { axisLabel, kmChart, type KmColumn } from '../../lib/fleet-dashboard-km-chart';
import { slashDay } from '../../lib/fleet-dashboard-tabs';
import { custodyCountForm, useSeparator } from '../custody-dashboard-parts';
import { FOCUS, Fig, MUTED, N, NOTE, NUM, STRONG, TONE, cn } from './dash-kit';
import { Sep } from './dash-blocks';
import { Phrase, count, useNoun } from './dash-shell';
import { kmText } from './tab-period';

// ── The brand family (DECISIONS §5) ───────────────────────────────────────────────────────────

/** A confirmed day's column, and its legend swatch: the kit's bar shade. */
const SOLID = TONE.brand.bar;
/** The latest confirmed day (the readout's), or the column under the pointer: one shade stronger. */
const SOLID_ON = 'bg-brand-800 dark:bg-brand-300';
/** The span part: the brand's dashed outline, never the confirmed fill. */
const SPAN =
  'border-2 border-dashed border-brand-700 bg-brand-500/15 dark:border-brand-400 dark:bg-brand-400/15';
const SPAN_SWATCH = 'border border-dashed border-brand-700 bg-brand-500/15 dark:border-brand-400';
/** Today's open cap: the brand's dashed edge and hatch (3 px on 7; the swatch 2 on 4). */
const OPEN = 'border border-dashed border-brand-500 dark:border-brand-400';
const HATCH =
  'bg-[repeating-linear-gradient(135deg,rgb(var(--brand-500)/.45)_0_3px,transparent_3px_7px)] dark:bg-[repeating-linear-gradient(135deg,rgb(var(--brand-400)/.5)_0_3px,transparent_3px_7px)]';
const HATCH_SWATCH =
  'bg-[repeating-linear-gradient(135deg,rgb(var(--brand-500)/.6)_0_2px,transparent_2px_4px)] dark:bg-[repeating-linear-gradient(135deg,rgb(var(--brand-400)/.65)_0_2px,transparent_2px_4px)]';
/** Status, not a bar: the amber «بلا قراءة» marker. */
const STALE = 'bg-amber-500 ring-2 ring-white dark:bg-amber-400 dark:ring-[#0e1422]';
/** A Friday's slot behind its (dimmed) column. */
const FRIDAY_SLOT = 'bg-slate-100/80 dark:bg-white/[0.035]';
const FRIDAY_DIM = 'opacity-55';
const READOUT_DAY =
  'border-brand-300 bg-brand-100 text-brand-800 dark:border-brand-800/50 dark:bg-brand-950/70 dark:text-brand-300';

const PLOT_H = 'h-[300px]';
const TICK = 'block text-[11px] leading-none text-slate-400 dark:text-slate-500';
const GRID_LINE = 'border-slate-100 dark:border-[#1a2538]';
const BASELINE = 'border-slate-300 dark:border-[#2a3953]';
/** On a phone a column never gets narrower than its day: the plot scrolls inside the card. */
const PHONE_COLUMN_PX = 48;

/** «يوم مغلق» / «أيام مغلقة» / «يومًا مغلقًا» — the closed-days count's own words. */
const useClosedDays = (): ((n: number) => string) => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (n) => t(`fleet.dash.km.closedDays.${custodyCountForm(locale, n)}`);
};

/** Items one after another with the reading's list separator («، »). */
const Joined = ({ items }: { items: readonly ReactNode[] }): JSX.Element => {
  const sep = useSeparator();
  return (
    <>
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && sep}
          {item}
        </span>
      ))}
    </>
  );
};

const Swatch = ({ children, label }: { children: ReactNode; label: ReactNode }): JSX.Element => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
    {children}
    <span>{label}</span>
  </span>
);

const Dot = (): JSX.Element => <span className="text-slate-400">·</span>;

/** One column's drawing: solid + outlined span + hatched cap (dimmed on a Friday). */
const Parts = ({ column, on }: { column: KmColumn; on: boolean }): JSX.Element => {
  const capped = column.span === 0 && column.hatch === 0;
  return (
    <div className={cn('relative h-full w-full max-w-[76px]', column.friday && FRIDAY_DIM)}>
      {column.solid > 0 && (
        <span
          data-km-part="solid"
          className={cn(
            'absolute inset-x-0 bottom-0',
            capped && 'rounded-t-[4px]',
            on ? SOLID_ON : SOLID,
          )}
          style={{ height: `${column.solid}%` }}
        />
      )}
      {column.span > 0 && (
        <span
          data-km-part="span"
          className={cn('absolute inset-x-0 rounded-t-[4px]', SPAN)}
          style={{ bottom: `${column.solid}%`, height: `${column.span}%` }}
        />
      )}
      {column.hatch > 0 && (
        <span
          data-km-part="open"
          className={cn('absolute inset-x-0 rounded-t-[4px]', OPEN, HATCH)}
          style={{ bottom: `${column.solid + column.span}%`, height: `${column.hatch}%` }}
        />
      )}
    </div>
  );
};

/** The stale marker is information, not part of the column: a dimmed Friday keeps it at full colour. */
const Marker = ({ column }: { column: KmColumn }): JSX.Element | null =>
  column.marker === null ? null : (
    <span
      data-km-part="stale"
      className={cn('absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full', STALE)}
      style={{ bottom: `max(0px, calc(${column.marker}% - 18px))` }}
    />
  );

const SLOT = 'relative flex h-full min-w-0 flex-1 justify-center rounded-t-lg';

export const KmDayChart = ({
  km,
  data,
}: {
  km: FleetDashboardPeriodKmDto;
  data: FleetDashboardPeriodDto;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const closedDays = useClosedDays();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const model = kmChart(km, data.range, data.today);
  const [picked, setPicked] = useState<number | null>(null);
  const daily = model.granularity === 'day';
  const metric = daily ? 'km.day' : 'km.month';
  const linkOf = (column: KmColumn) =>
    periodLinks({
      range: { from: column.from, to: column.to },
      vehicleScope: data.vehicleScope,
    }).km(metric);
  const label = (key: string): string => (daily ? slashDay(key) : axisLabel(key, 'month'));
  const cars = (n: number): ReactNode => (
    <>
      <N>{count(n)}</N> {noun('car', n)}
    </>
  );

  if (model.columns.length === 0) {
    return <p className={NOTE}>{t('fleet.dash.km.noReadings')}</p>;
  }

  const index = picked ?? model.focus;
  const shown = model.columns[index];
  const weekday = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  const at = (km: number): number => (model.max > 0 ? Math.min(100, (km / model.max) * 100) : 0);
  const labelled = new Set(model.labels.map((tick) => tick.index));
  const gap = model.columns.length <= 16 ? 'gap-2' : 'gap-1';
  const scroller = {
    '--km-plot': `${model.columns.length * PHONE_COLUMN_PX}px`,
  } as CSSProperties;

  const readout = (column: KmColumn): ReactNode => {
    const b = column.bucket;
    const today = daily && column.current;
    const state = column.empty ? (
      t('fleet.dash.km.readout.empty')
    ) : b.pending > 0 || today ? (
      <Phrase
        text={t(today ? 'fleet.dash.km.readout.today' : 'fleet.dash.km.readout.open')}
        parts={{ cars: cars(b.pending) }}
      />
    ) : b.confirmed ? (
      <span data-km-confirmed-word="true" className={TONE.brand.text}>
        {t(daily ? 'fleet.dash.km.readout.confirmedDay' : 'fleet.dash.km.readout.confirmedMonth')}
      </span>
    ) : (
      t('fleet.dash.km.readout.notConfirmed')
    );
    return (
      <>
        <span dir="ltr" className={cn('rounded border px-2 py-0.5 font-bold', READOUT_DAY, NUM)}>
          {label(b.key)}
        </span>
        {daily && <span className="font-semibold">{weekday.format(ymdToUtcDate(b.key))}</span>}
        {!column.empty && !today && (
          <>
            <Dot />
            <span>
              <Fig link={linkOf(column)} className={cn('text-sm font-bold', STRONG)}>
                <N>{kmText(b.confirmedKm)}</N>
              </Fig>{' '}
              {t('fleet.dash.km.unit')}
            </span>
          </>
        )}
        <Dot />
        <span>{state}</span>
        {b.spanKm > 0 && (
          <>
            <Dot />
            <span>
              {b.spanTo === null ? (
                <Phrase
                  text={t('fleet.dash.km.readout.spanOnly')}
                  parts={{ km: <N className="font-bold">{kmText(b.spanKm)}</N> }}
                />
              ) : (
                <Phrase
                  text={t('fleet.dash.km.readout.span')}
                  parts={{
                    km: <N className="font-bold">{kmText(b.spanKm)}</N>,
                    from: <N>{label(b.key)}</N>,
                    to: <N>{slashDay(b.spanTo)}</N>,
                    cars: cars(b.spanVehicles),
                  }}
                />
              )}
            </span>
          </>
        )}
        {b.stale > 0 && (
          <>
            <Dot />
            <span className={TONE.amber.text}>
              <Phrase
                text={t('fleet.dash.km.readout.stale')}
                parts={{ cars: cars(b.stale), day: <N>{label(b.key)}</N> }}
              />
            </span>
          </>
        )}
      </>
    );
  };

  return (
    <div data-km-chart={model.granularity}>
      {shown !== undefined && (
        <div
          data-km-readout={shown.bucket.key}
          className="flex min-h-[46px] flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700 shadow-inner dark:border-brand-500/30 dark:bg-[#0c1322]/90 dark:text-slate-300"
        >
          {readout(shown)}
        </div>
      )}
      <div
        dir="ltr"
        role="group"
        aria-label={t(
          daily ? 'fleet.dash.km.chart.titleDaily' : 'fleet.dash.km.chart.titleMonthly',
        )}
        className="mt-6 flex gap-3"
      >
        {/* The value axis, round steps, at the drawing's start (the days run left to right). */}
        <div aria-hidden="true" className={cn('relative w-14 shrink-0', PLOT_H)}>
          {model.ticks.map((tick) => (
            <span
              key={tick}
              data-km-tick={String(tick)}
              className="absolute end-0 translate-y-1/2 text-end"
              style={{ bottom: `${at(tick)}%` }}
            >
              <N className={TICK}>{count(tick)}</N>
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 max-sm:overflow-x-auto max-sm:overscroll-x-contain">
          <div className="max-sm:min-w-[var(--km-plot)]" style={scroller}>
            <div className={cn('relative', PLOT_H)}>
              {model.ticks.map((tick) => (
                <div
                  key={tick}
                  aria-hidden="true"
                  className={cn('absolute inset-x-0 border-t', tick === 0 ? BASELINE : GRID_LINE)}
                  style={{ bottom: `${at(tick)}%` }}
                />
              ))}
              <div className={cn('absolute inset-0 flex', gap)}>
                {model.columns.map((column, i) =>
                  column.empty ? (
                    <div
                      key={column.bucket.key}
                      data-km-column={column.bucket.key}
                      {...(column.friday ? { 'data-km-friday': 'true' } : {})}
                      className={cn(SLOT, column.friday && FRIDAY_SLOT)}
                    >
                      <span
                        data-km-part="empty"
                        className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full border border-slate-400 bg-white dark:border-slate-500 dark:bg-[#0e1422]"
                      />
                    </div>
                  ) : (
                    <Link
                      key={column.bucket.key}
                      to={linkOf(column).to}
                      data-km-column={column.bucket.key}
                      data-metric={metric}
                      {...(column.friday ? { 'data-km-friday': 'true' } : {})}
                      aria-label={`${label(column.bucket.key)}: ${kmText(column.bucket.confirmedKm + column.bucket.spanKm)} ${t('fleet.dash.km.unit')}`}
                      onMouseEnter={() => setPicked(i)}
                      onMouseLeave={() => setPicked(null)}
                      onFocus={() => setPicked(i)}
                      onBlur={() => setPicked(null)}
                      className={cn(SLOT, column.friday && FRIDAY_SLOT, FOCUS)}
                    >
                      <Parts column={column} on={i === index} />
                      <Marker column={column} />
                    </Link>
                  ),
                )}
              </div>
              {model.average !== null && (
                <div
                  aria-hidden="true"
                  data-km-average="true"
                  className="pointer-events-none absolute inset-x-0 translate-y-1/2 border-t-2 border-dashed border-sky-500/80"
                  style={{ bottom: `${model.average.pct}%` }}
                />
              )}
            </div>
            <div data-km-axis={model.granularity} className={cn('mt-2.5 flex', gap)}>
              {model.columns.map((column, i) => (
                <div
                  key={column.bucket.key}
                  data-km-label={labelled.has(i) ? column.bucket.key : undefined}
                  className="flex min-w-0 flex-1 flex-col items-center gap-0.5"
                >
                  {labelled.has(i) && (
                    <>
                      <N
                        className={cn(
                          'whitespace-nowrap text-xs font-bold',
                          column.friday
                            ? 'text-slate-400 dark:text-slate-500'
                            : 'text-slate-700 dark:text-slate-200',
                        )}
                      >
                        {axisLabel(column.bucket.key, model.granularity)}
                      </N>
                      {daily && (
                        <span
                          dir={locale === 'ar' ? 'rtl' : 'ltr'}
                          className={cn(
                            'whitespace-nowrap text-[11px] font-semibold max-sm:hidden',
                            column.current ? TONE.brand.text : MUTED,
                          )}
                        >
                          {column.current
                            ? t('fleet.dash.km.axis.today')
                            : weekday.format(ymdToUtcDate(column.bucket.key))}
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* The average line's own label, at its height beside the drawing's end. */}
        {model.average !== null && (
          <div
            aria-hidden="true"
            className={cn('relative hidden w-[132px] shrink-0 sm:block', PLOT_H)}
          >
            <span
              data-km-average-label="true"
              dir={locale === 'ar' ? 'rtl' : 'ltr'}
              className="absolute start-0 translate-y-1/2 whitespace-nowrap rounded-md border border-sky-500/40 bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
              style={{ bottom: `${model.average.pct}%` }}
            >
              <Phrase
                text={t('fleet.dash.km.chart.averageLabel')}
                parts={{ km: <N>{kmText(model.average.km)}</N> }}
              />
            </span>
          </div>
        )}
      </div>

      <div
        data-km-legend="true"
        className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
      >
        <Swatch label={t('fleet.dash.km.legend.confirmed')}>
          <span data-km-swatch="confirmed" className={cn('h-2.5 w-2.5 rounded-sm', SOLID)} />
        </Swatch>
        <Swatch label={t('fleet.dash.km.legend.span')}>
          <span data-km-swatch="span" className={cn('h-2.5 w-2.5 rounded-sm', SPAN_SWATCH)} />
        </Swatch>
        <Swatch label={t('fleet.dash.km.legend.open')}>
          <span
            data-km-swatch="open"
            className={cn('h-2.5 w-2.5 rounded-sm', OPEN, HATCH_SWATCH)}
          />
        </Swatch>
        <Swatch label={t('fleet.dash.km.legend.stale')}>
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500 dark:bg-amber-400" />
        </Swatch>
        <Swatch label={t('fleet.dash.km.legend.empty')}>
          <span className="h-2 w-2 rounded-full border border-slate-400 dark:border-slate-500" />
        </Swatch>
        {daily && (
          <Swatch label={t('fleet.dash.km.legend.friday')}>
            <span
              data-km-swatch="friday"
              className={cn(
                'relative h-2.5 w-3.5 overflow-hidden rounded-sm border border-slate-200 dark:border-[#26324a]',
                FRIDAY_SLOT,
              )}
            >
              <span
                className={cn(
                  'absolute inset-x-[3px] bottom-0 top-[2px] rounded-t-[1px]',
                  SOLID,
                  FRIDAY_DIM,
                )}
              />
            </span>
          </Swatch>
        )}
        <Swatch
          label={
            km.average === null ? (
              t('fleet.dash.km.legend.noAverage')
            ) : (
              <Phrase
                text={t(
                  daily ? 'fleet.dash.km.legend.average' : 'fleet.dash.km.legend.averageMonthly',
                )}
                parts={{
                  km: <N className="font-bold">{kmText(km.average)}</N>,
                  count: <N>{count(km.closedDays)}</N>,
                  days: closedDays(km.closedDays),
                }}
              />
            )
          }
        >
          <span
            className={cn(
              'w-4 border-t-2 border-dashed',
              daily ? 'border-sky-500' : 'border-transparent',
            )}
          />
        </Swatch>
      </div>
    </div>
  );
};

/**
 * The chart's foot lines, for the block's ruled foot: confirmed through · still open · days with no
 * reading; the spans (they count in the total and the average); the old book's km, only when there
 * is some (the company view); the stale cars by the day of their last reading.
 */
export const KmChartNotes = ({
  km,
  data,
}: {
  km: FleetDashboardPeriodKmDto;
  data: FleetDashboardPeriodDto;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const model = kmChart(km, data.range, data.today);
  const daily = model.granularity === 'day';
  const label = (key: string): string => (daily ? slashDay(key) : axisLabel(key, 'month'));
  const cars = (n: number): ReactNode => (
    <>
      <N>{count(n)}</N> {noun('car', n)}
    </>
  );
  const openItems: ReactNode[] = model.pending.map((day) => (
    <Phrase
      key={day.key}
      text={t('fleet.dash.km.notes.openDay')}
      parts={{ day: <N>{label(day.key)}</N>, cars: cars(day.cars) }}
    />
  ));
  if (model.today !== null) {
    openItems.push(
      <Phrase
        key="today"
        text={t('fleet.dash.km.notes.openToday')}
        parts={{ day: <N>{slashDay(model.today.key)}</N> }}
      />,
    );
  }
  const unregistered = km.unregistered ?? 0;
  return (
    <div data-km-notes="true" className="flex flex-col gap-y-1">
      <p data-km-note="confirmed" className="font-semibold">
        <span className={cn('font-bold', STRONG)}>
          {km.confirmedThrough === null ? (
            t('fleet.dash.km.notes.noneConfirmed')
          ) : (
            <Phrase
              text={t('fleet.dash.km.notes.confirmedThrough')}
              parts={{ day: <N>{slashDay(km.confirmedThrough)}</N> }}
            />
          )}
        </span>
        {openItems.length > 0 && (
          <>
            <Sep />
            <Phrase
              text={t('fleet.dash.km.notes.open')}
              parts={{ items: <Joined items={openItems} /> }}
            />
          </>
        )}
        {model.empty.length > 0 && (
          <>
            <Sep />
            <Phrase
              text={t('fleet.dash.km.notes.empty')}
              parts={{
                days: (
                  <Joined
                    items={model.empty.map((key) => (
                      <N key={key}>{label(key)}</N>
                    ))}
                  />
                ),
              }}
            />
          </>
        )}
      </p>
      {km.spans.count > 0 && (
        <p data-km-spans="true" className={cn('text-xs font-semibold', MUTED)}>
          <Phrase
            text={t('fleet.dash.km.notes.spans')}
            parts={{
              km: <N className="font-bold">{kmText(km.spans.km)}</N>,
              count: <N>{count(km.spans.count)}</N>,
              readings: t(`fleet.dash.km.reading.${custodyCountForm(locale, km.spans.count)}`),
            }}
          />
        </p>
      )}
      {unregistered > 0 && (
        <p data-km-unregistered="true" className={cn('text-xs font-semibold', MUTED)}>
          <Phrase
            text={t('fleet.dash.km.chart.unregistered')}
            parts={{ km: <N className="font-bold">{kmText(unregistered)}</N> }}
          />
        </p>
      )}
      {model.stale.length > 0 && (
        <p data-km-stale="true" className={cn('text-xs font-semibold', MUTED)}>
          <Phrase
            text={t('fleet.dash.km.notes.stale')}
            parts={{
              items: (
                <Joined
                  items={model.stale.map((day) => (
                    <Phrase
                      key={day.key}
                      text={t('fleet.dash.km.notes.staleDay')}
                      parts={{ cars: cars(day.cars), day: <N>{label(day.key)}</N> }}
                    />
                  ))}
                />
              ),
            }}
          />
        </p>
      )}
    </div>
  );
};
