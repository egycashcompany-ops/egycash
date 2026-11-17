// «التراخيص المستحقة للتجديد — 12 شهرًا» — the month chart of «التراخيص والتجديدات»
// (approved/lic-dark.png; harness zz-licences-tab.tsx `MonthChart`; DECISIONS §11, critic B7/C1), over
// R1's `licenceVehicles.months` and `licenceDrivers.months`: FLEET_DASHBOARD_LICENCE_MONTHS slots
// from this (Cairo) month, in the server's key order.
//
//   · each slot holds TWO columns, never added together (no month total anywhere): the cars in the
//     kit's brand bar shade, the drivers two steps lighter (dark 500 → 300, light 600 → 400 —
//     DECISIONS §11 rule for §5); each column's value on its top;
//   · «هذا الشهر» is marked by a WORD under its axis label and a faint band behind its slot, never by
//     a shade of its columns (critic B7);
//   · the readout above the drawing names the slot under the pointer or the keyboard (this month by
//     default): the month, «هذا الشهر», the cars and the drivers in counted words;
//   · each column opens its month: the active cars by `licenseMonths` (with `status=active`, critic
//     C1), the drivers by their files' expiry days and the figures' branch;
//   · a series is drawn only with its section; on a phone the drawing scrolls inside the card, from
//     this month.
//
// Nothing is counted: every figure is the server's; the browser scales the columns to a round axis.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  FLEET_DASHBOARD_LICENCE_MONTHS,
  type FleetDashboardLicenceMonthDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { type DashLink, type NowLinks } from '../../lib/fleet-dashboard-links';
import { custodyTicks } from '../custody-dashboard-parts';
import { count } from './dash-shell';
import { BlockFoot, BlockHead, NoteLine, monthName } from './dash-blocks';
import { Card, FOCUS, I, MUTED, N, STRONG, TONE, cn } from './dash-kit';
import { Counted, useLicenceWords } from './tab-licences-words';

// ── The brand family (DECISIONS §5, §11) ──────────────────────────────────────────────────────

/** The cars: the kit's bar shade (the fuel / odometer columns). */
const CAR_COL = TONE.brand.bar;
/** The drivers: two steps lighter (dark 500 → 300, light 600 → 400). */
const DRIVER_COL = 'bg-brand-400 dark:bg-brand-300';
const THIS_SLOT = 'bg-slate-100/80 dark:bg-white/[0.035]';
const READOUT_MONTH =
  'border-brand-300 bg-brand-100 text-brand-800 dark:border-brand-800/50 dark:bg-brand-950/70 dark:text-brand-300';
const PLOT_H = 'h-[260px]';
const TICK = 'block text-[11px] leading-none text-slate-400 dark:text-slate-500';
const GRID_LINE = 'border-slate-100 dark:border-[#1a2538]';
const BASELINE = 'border-slate-300 dark:border-[#2a3953]';

type Series = 'cars' | 'drivers';
const SERIES_COL: Record<Series, string> = { cars: CAR_COL, drivers: DRIVER_COL };

/**
 * The count axis: the kit's round steps (`custodyTicks`), or steps of 1 / 2 / 5 / 10 … when the
 * kit's top would leave more than a fifth of the drawing above the tallest column (21 → 0…25, not
 * 0…30) — whole licences always, never a quarter of one.
 */
export const licenceMonthTicks = (max: number): number[] => {
  if (!(max > 0)) return [0, 1];
  const kit = custodyTicks(max);
  const step = kit[1] ?? 1;
  const top = kit[kit.length - 1] ?? max;
  if (Number.isInteger(step) && top <= max * 1.25) return kit;
  const whole = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1_000].find(
    (x) => Math.ceil(max / x) <= 6,
  );
  const by = whole ?? Math.ceil(max / 6);
  return Array.from({ length: Math.ceil(max / by) + 1 }, (_, i) => i * by);
};

const Swatch = ({ series, label }: { series: Series; label: ReactNode }): JSX.Element => (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
    <span data-lic-swatch={series} className={cn('h-2.5 w-2.5 rounded-sm', SERIES_COL[series])} />
    <span>{label}</span>
  </span>
);

/** One column: the link to its month's list, its bar, its value on top. */
const Column = ({
  series,
  slot,
  value,
  at,
  link,
  label,
  onPick,
}: {
  series: Series;
  slot: string;
  value: number;
  at: (n: number) => number;
  link: DashLink;
  label: string;
  onPick: () => void;
}): JSX.Element => (
  <Link
    to={link.to}
    data-metric={link.metric}
    data-lic-month={slot}
    data-lic-series={series}
    data-lic-n={String(value)}
    aria-label={label}
    onMouseEnter={onPick}
    onFocus={onPick}
    className={cn('relative h-full w-full max-w-[40px] outline-none', FOCUS)}
  >
    <span
      data-lic-bar={series}
      className={cn('absolute inset-x-0 bottom-0 rounded-t-[4px]', SERIES_COL[series])}
      style={{ height: `${at(value)}%` }}
    />
    <span
      data-lic-value={`${series}:${slot}`}
      className={cn(
        'absolute inset-x-0 text-center text-[11px] font-bold leading-none',
        value === 0 ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200',
      )}
      style={{ bottom: `calc(${at(value)}% + 5px)` }}
    >
      <N>{count(value)}</N>
    </span>
  </Link>
);

export const LicenceMonthChart = ({
  today,
  cars,
  drivers,
  links,
}: {
  /** Cairo today, as R1 echoes it: its month is «هذا الشهر». */
  today: string;
  /** `licenceVehicles.months`; `null` when that section is not drawn. */
  cars: readonly FleetDashboardLicenceMonthDto[] | null;
  /** `licenceDrivers.months`; `null` when that section is not drawn. */
  drivers: readonly FleetDashboardLicenceMonthDto[] | null;
  links: NowLinks;
}): JSX.Element => {
  const w = useLicenceWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The server's slots, in its order (both series carry the same keys).
  const keys = (cars ?? drivers ?? []).map((slot) => slot.key);
  const carAt = new Map((cars ?? []).map((slot) => [slot.key, slot.count]));
  const driverAt = new Map((drivers ?? []).map((slot) => [slot.key, slot.count]));
  const series: Series[] = [
    ...(drivers !== null ? (['drivers'] as const) : []),
    ...(cars !== null ? (['cars'] as const) : []),
  ];
  const valueOf = (s: Series, key: string): number =>
    (s === 'cars' ? carAt.get(key) : driverAt.get(key)) ?? 0;
  const ticks = licenceMonthTicks(
    Math.max(0, ...keys.flatMap((key) => series.map((s) => valueOf(s, key)))),
  );
  const top = ticks[ticks.length - 1] ?? 1;
  const at = (n: number): number => (top > 0 ? Math.min(100, (n / top) * 100) : 0);
  const thisMonth = today.slice(0, 7);
  const thisAt = Math.max(0, keys.indexOf(thisMonth));
  const [picked, setPicked] = useState<number | null>(null);
  const shown = keys[picked ?? thisAt] ?? thisMonth;
  const isThis = (key: string): boolean => key === thisMonth;
  const year = (key: string): string => key.slice(0, 4);
  const name = (key: string): string => monthName(`${key}-01`, locale);

  // A phone's drawing scrolls inside its card from this month (the drawing runs left to right);
  // its end fades while months hide there.
  const scroller = useRef<HTMLDivElement>(null);
  const [after, setAfter] = useState(false);
  useEffect(() => {
    const box = scroller.current;
    if (box === null) return undefined;
    const edge = (): void => setAfter(box.scrollWidth - box.clientWidth - box.scrollLeft > 2);
    box.scrollLeft = 0;
    edge();
    box.addEventListener('scroll', edge, { passive: true });
    window.addEventListener('resize', edge);
    return () => {
      box.removeEventListener('scroll', edge);
      window.removeEventListener('resize', edge);
    };
  }, []);

  const linkOf = (s: Series, key: string): DashLink =>
    s === 'cars' ? links.vehicleLicenceMonth(key) : links.driverLicenceMonth(key);

  return (
    <Card data-lic-block="months" className="mt-5">
      <BlockHead
        icon={I.bars}
        tone="brand"
        title={
          <>
            {w('chart.title')}{' '}
            {/* A phone breaks the line before the dash: never «— 12» then «شهرًا» alone. */}
            <span className="whitespace-nowrap">
              {w('chart.span', { count: count(FLEET_DASHBOARD_LICENCE_MONTHS) })}
            </span>
          </>
        }
        note={w('chart.note')}
      />
      <div className="px-5 pb-5">
        <div
          data-lic-readout={shown}
          className="flex min-h-[46px] flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700 shadow-inner dark:border-brand-500/30 dark:bg-[#0c1322]/90 dark:text-slate-300"
        >
          <span className={cn('rounded border px-2 py-0.5 font-bold', READOUT_MONTH)}>
            {name(shown)} <N>{year(shown)}</N>
          </span>
          {isThis(shown) && (
            <span data-lic-readout-this="true" className={cn('font-semibold', TONE.brand.text)}>
              {w('chart.thisMonth')}
            </span>
          )}
          {/* Each «·» goes with the item after it, so a wrap never leaves one at a line's end; a
              phone, where the box wraps, drops them and keeps the gap. */}
          {cars !== null && (
            <span
              data-lic-readout-series="cars"
              className="inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <span className="me-0.5 text-slate-400 max-sm:hidden">·</span>
              <span className={cn('h-2.5 w-2.5 rounded-sm', CAR_COL)} />
              <Counted n={valueOf('cars', shown)} noun="car" />
            </span>
          )}
          {drivers !== null && (
            <span
              data-lic-readout-series="drivers"
              className="inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <span className="me-0.5 text-slate-400 max-sm:hidden">·</span>
              <span className={cn('h-2.5 w-2.5 rounded-sm', DRIVER_COL)} />
              <Counted n={valueOf('drivers', shown)} noun="driver" />
            </span>
          )}
        </div>
        <div
          ref={scroller}
          dir="ltr"
          data-lic-scroller="months"
          className="max-md:overflow-x-auto"
          style={
            after ? { maskImage: 'linear-gradient(to left, transparent 0, #000 48px)' } : undefined
          }
        >
          <div
            data-lic-chart="months"
            role="group"
            aria-label={`${w('chart.title')} ${w('chart.span', { count: count(FLEET_DASHBOARD_LICENCE_MONTHS) })}`}
            className="mt-3 flex gap-3 pt-9 max-md:min-w-[640px]"
          >
            {/* The count axis, round steps, at the drawing's start (the months run left to right). */}
            <div aria-hidden="true" className={cn('relative w-8 shrink-0', PLOT_H)}>
              {ticks.map((tick) => (
                <span
                  key={tick}
                  data-lic-tick={String(tick)}
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
                    className={cn('absolute inset-x-0 border-t', tick === 0 ? BASELINE : GRID_LINE)}
                    style={{ bottom: `${at(tick)}%` }}
                  />
                ))}
                <div role="list" className="absolute inset-0 flex gap-2">
                  {keys.map((key, i) => (
                    <div
                      key={key}
                      role="listitem"
                      data-lic-slot={key}
                      {...(isThis(key) ? { 'data-lic-this-month': 'true' } : {})}
                      onMouseLeave={() => setPicked(null)}
                      className={cn(
                        'relative flex h-full min-w-0 flex-1 items-end justify-center gap-1.5 rounded-t-lg px-1',
                        isThis(key) && THIS_SLOT,
                      )}
                    >
                      {/* The drawing runs left to right; the pair reads as the legend and the
                          readout do (RTL): the cars on the right, the drivers on the left. */}
                      {series.map((s) => (
                        <Column
                          key={s}
                          series={s}
                          slot={key}
                          value={valueOf(s, key)}
                          at={at}
                          link={linkOf(s, key)}
                          label={w('chart.columnLabel', {
                            month: name(key),
                            year: year(key),
                            series: w(s === 'cars' ? 'chart.cars' : 'chart.drivers'),
                            count: count(valueOf(s, key)),
                          })}
                          onPick={() => setPicked(i)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div data-lic-xaxis="months" className="mt-2.5 flex gap-2">
                {keys.map((key) => (
                  <div
                    key={key}
                    data-lic-xlabel={key}
                    className="flex min-w-0 flex-1 flex-col items-center gap-0.5"
                  >
                    <span dir="rtl" className={cn('whitespace-nowrap text-xs font-bold', STRONG)}>
                      {name(key)}
                    </span>
                    {isThis(key) ? (
                      <span
                        dir="rtl"
                        data-lic-this-word="true"
                        className={cn('whitespace-nowrap text-[11px] font-bold', TONE.brand.text)}
                      >
                        {w('chart.thisMonth')}
                      </span>
                    ) : (
                      <N className={cn('text-[11px] font-semibold', MUTED)}>{year(key)}</N>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div
          data-lic-legend="months"
          className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
        >
          {cars !== null && <Swatch series="cars" label={w('chart.cars')} />}
          {drivers !== null && <Swatch series="drivers" label={w('chart.drivers')} />}
        </div>
      </div>
      <BlockFoot>
        <NoteLine>
          <span data-lic-note="months">
            {cars !== null && drivers !== null && <>{w('chart.notSummed')} </>}
            {w('chart.foot')}
          </span>
        </NoteLine>
      </BlockFoot>
    </Card>
  );
};
