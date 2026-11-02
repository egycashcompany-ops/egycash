// «الكيلومترات يومًا بيوم» — tab 7's chart, drawn from `lib/fleet-dashboard-km-chart.ts` (R-15, Q-10):
// the solid confirmed part, the OUTLINED span part on its start day (never the confirmed colour),
// the hatched cap of a day still waiting for readings (today always), the stale marker, the empty
// slot of a day without any reading (never a zero bar), and the average line over the closed days.
//
// The approved Phase-1 sample (zz-fleetdash-p1.tsx, `DayChart`) in the system palette. Every column
// opens the odometer screen over its own day (or month) and the period's filters; the readout above
// the drawing names the column the pointer or the keyboard is on.
import { Fragment, useState, type ReactNode } from 'react';
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
import { FOCUS, Fig, MUTED, N, NOTE, NUM, STRONG, WELL, cn } from './dash-kit';
import { Phrase, count, useNoun } from './dash-shell';
import { kmText } from './tab-period';

const HATCH = 'repeating-linear-gradient(135deg, rgba(148,163,184,.5) 0 3px, transparent 3px 7px)';
const HATCH_SWATCH =
  'repeating-linear-gradient(135deg, rgba(148,163,184,.6) 0 2px, transparent 2px 4px)';
/** The confirmed colour — the solid part only. */
const SOLID = 'bg-emerald-500/75 dark:bg-emerald-400/55';
const SOLID_ON =
  'bg-emerald-600 ring-2 ring-emerald-300 dark:bg-emerald-300 dark:ring-emerald-500/50';
/** The span part: outlined, dashed, violet — never the confirmed colour. */
const SPAN =
  'border-2 border-dashed border-violet-500 bg-violet-500/10 dark:border-violet-400 dark:bg-violet-400/10';
const OPEN = 'border border-dashed border-slate-400 dark:border-slate-500';
const STALE = 'bg-amber-500 ring-2 ring-white dark:bg-amber-400 dark:ring-[#121a2a]';

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
        <Fragment key={i}>
          {i > 0 && sep}
          {item}
        </Fragment>
      ))}
    </>
  );
};

const Swatch = ({ children, label }: { children: ReactNode; label: ReactNode }): JSX.Element => (
  <span className="flex items-center gap-1.5">
    {children}
    <span>{label}</span>
  </span>
);

/** One column: empty slot, or solid + outlined span + hatched cap, and the stale marker. */
const Column = ({ column, on }: { column: KmColumn; on: boolean }): JSX.Element => {
  if (column.empty) {
    return (
      <span
        data-km-part="empty"
        className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full border border-slate-400 bg-white dark:border-slate-500 dark:bg-[#121a2a]"
      />
    );
  }
  const capped = column.span === 0 && column.hatch === 0;
  return (
    <>
      {column.solid > 0 && (
        <span
          data-km-part="solid"
          className={cn(
            'absolute inset-x-0 bottom-0',
            capped && 'rounded-t-[3px]',
            on ? SOLID_ON : SOLID,
          )}
          style={{ height: `${column.solid}%` }}
        />
      )}
      {column.span > 0 && (
        <span
          data-km-part="span"
          className={cn(
            'absolute inset-x-0 rounded-t-[3px]',
            column.hatch === 0 ? '' : 'rounded-t-none',
            SPAN,
          )}
          style={{ bottom: `${column.solid}%`, height: `${column.span}%` }}
        />
      )}
      {column.hatch > 0 && (
        <span
          data-km-part="open"
          className={cn('absolute inset-x-0 rounded-t-[3px]', OPEN)}
          style={{
            bottom: `${column.solid + column.span}%`,
            height: `${column.hatch}%`,
            backgroundImage: HATCH,
          }}
        />
      )}
      {column.marker !== null && (
        <span
          data-km-part="stale"
          className={cn('absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full', STALE)}
          style={{ bottom: `max(0px, calc(${column.marker}% - 14px))` }}
        />
      )}
    </>
  );
};

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

  const readout = (column: KmColumn): ReactNode => {
    const b = column.bucket;
    const state = column.empty
      ? t('fleet.dash.km.readout.empty')
      : b.pending > 0 || (daily && column.current)
        ? null
        : b.confirmed
          ? t(daily ? 'fleet.dash.km.readout.confirmedDay' : 'fleet.dash.km.readout.confirmedMonth')
          : t('fleet.dash.km.readout.notConfirmed');
    return (
      <>
        {daily && <span>{weekday.format(ymdToUtcDate(b.key))}</span>}
        {!column.empty && (
          <>
            <span className="text-slate-400">·</span>
            <span>
              <Fig link={linkOf(column)} className={cn('text-sm font-bold', STRONG)}>
                <N>{kmText(b.confirmedKm)}</N>
              </Fig>{' '}
              {t('fleet.dash.km.unit')}
            </span>
          </>
        )}
        <span className="text-slate-400">·</span>
        {state ?? (
          <Phrase
            text={t(
              daily && column.current
                ? 'fleet.dash.km.readout.today'
                : 'fleet.dash.km.readout.open',
            )}
            parts={{ cars: cars(b.pending) }}
          />
        )}
        {b.spanKm > 0 && (
          <span className="basis-full">
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
        )}
        {b.stale > 0 && (
          <span className="basis-full">
            <Phrase
              text={t('fleet.dash.km.readout.stale')}
              parts={{ cars: cars(b.stale), day: <N>{label(b.key)}</N> }}
            />
          </span>
        )}
      </>
    );
  };

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

  return (
    <div data-km-chart={model.granularity}>
      {shown !== undefined && (
        <div
          data-km-readout={shown.bucket.key}
          className="relative mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 shadow-inner dark:border-emerald-500/30 dark:bg-[#0c1322]/90 dark:text-slate-300"
        >
          <span
            dir="ltr"
            className={cn(
              'rounded border border-emerald-300 bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/70 dark:text-emerald-400',
              NUM,
            )}
          >
            {label(shown.bucket.key)}
          </span>
          {readout(shown)}
        </div>
      )}
      <div dir="ltr" className="flex gap-2">
        <div
          className={cn(
            'flex h-[180px] flex-col items-end justify-between text-[10px] text-slate-400 dark:text-slate-500',
            NUM,
          )}
        >
          {model.ticks.map((tick, i) => (
            <span key={i}>{kmText(tick)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="relative h-[180px]">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="absolute inset-x-0 border-t border-slate-100 dark:border-[#1a2538]"
                style={{ top: `${(i / 3) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex gap-[3px]">
              {model.columns.map((column, i) =>
                column.empty ? (
                  <div
                    key={column.bucket.key}
                    data-km-column={column.bucket.key}
                    className="relative h-full flex-1"
                  >
                    <Column column={column} on={false} />
                  </div>
                ) : (
                  <Link
                    key={column.bucket.key}
                    to={linkOf(column).to}
                    data-km-column={column.bucket.key}
                    data-metric={metric}
                    aria-label={label(column.bucket.key)}
                    onMouseEnter={() => setPicked(i)}
                    onFocus={() => setPicked(i)}
                    className={cn('relative block h-full flex-1', FOCUS)}
                  >
                    <Column column={column} on={i === index} />
                  </Link>
                ),
              )}
            </div>
            {model.average !== null && (
              <div
                data-km-average="true"
                className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-sky-500/80"
                style={{ bottom: `${model.average.pct}%` }}
              />
            )}
          </div>
          <div className="relative mt-1.5 h-3">
            {model.labels.map((tick) => (
              <span
                key={tick.index}
                className={cn(
                  'absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-slate-400 dark:text-slate-500',
                  NUM,
                )}
                style={{ left: `${((tick.index + 0.5) / model.columns.length) * 100}%` }}
              >
                {tick.text}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
        <Swatch label={t('fleet.dash.km.legend.confirmed')}>
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/80 dark:bg-emerald-400/60" />
        </Swatch>
        <Swatch label={t('fleet.dash.km.legend.span')}>
          <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-violet-500 bg-violet-500/10 dark:border-violet-400" />
        </Swatch>
        <Swatch label={t('fleet.dash.km.legend.open')}>
          <span
            className={cn('h-2.5 w-2.5 rounded-sm', OPEN)}
            style={{ backgroundImage: HATCH_SWATCH }}
          />
        </Swatch>
        <Swatch label={t('fleet.dash.km.legend.stale')}>
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500 dark:bg-amber-400" />
        </Swatch>
        <Swatch label={t('fleet.dash.km.legend.empty')}>
          <span className="h-2 w-2 rounded-full border border-slate-400 dark:border-slate-500" />
        </Swatch>
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

      <div
        data-km-notes="true"
        className={cn(WELL, 'mt-3 space-y-1 px-3 py-2 text-[11px] leading-5', MUTED)}
      >
        <div>
          <strong className="font-bold text-slate-800 dark:text-slate-100">
            {km.confirmedThrough === null ? (
              t('fleet.dash.km.notes.noneConfirmed')
            ) : (
              <Phrase
                text={t('fleet.dash.km.notes.confirmedThrough')}
                parts={{ day: <N>{slashDay(km.confirmedThrough)}</N> }}
              />
            )}
          </strong>
          {openItems.length > 0 && (
            <>
              {' · '}
              <Phrase
                text={t('fleet.dash.km.notes.open')}
                parts={{ items: <Joined items={openItems} /> }}
              />
            </>
          )}
          {model.empty.length > 0 && (
            <>
              {' · '}
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
        </div>
        {km.spans.count > 0 && (
          <div data-km-spans="true">
            <Phrase
              text={t('fleet.dash.km.notes.spans')}
              parts={{
                km: <N className="font-bold">{kmText(km.spans.km)}</N>,
                count: <N>{count(km.spans.count)}</N>,
                readings: t(`fleet.dash.km.reading.${custodyCountForm(locale, km.spans.count)}`),
              }}
            />
          </div>
        )}
        {model.stale.length > 0 && (
          <div data-km-stale="true">
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
          </div>
        )}
      </div>
    </div>
  );
};
