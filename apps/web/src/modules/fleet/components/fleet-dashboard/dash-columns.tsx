// «لوحة تحكم الحركة» — the column chart the redesigned tabs draw a list of named figures with
// («الكيلومترات حسب الفرع», «كيلومترات الفرع هذا الشهر حسب النوع»), lifted from the owner-approved
// «توزيع السيارات» harness (zz-distribution.tsx, `ColumnChart`) — the owner: «ويبقى شارتس مش
// بروجريس». Its columns are the brand's (DECISIONS §5: every data bar and column of the dashboard is
// the site's colour; the harness drew them teal).
//
// Drawn as the period tabs' km chart and the custody board draw theirs: Tailwind boxes, no chart
// library, themed with `dark:`. Render-only: every figure, its text and its share arrive as they are
// shown; the chart only scales the columns to its own round axis (custodyTicks).
import { useState, type CSSProperties } from 'react';
import { type DashLink } from '../../lib/fleet-dashboard-links';
import { custodyTicks } from '../custody-dashboard-parts';
import { SHARE, Sep } from './dash-blocks';
import { count } from './dash-shell';
import { Fig, MUTED, N, STRONG, TONE, cn } from './dash-kit';

/** One column: its name on the axis, its figure on its cap, its share under the name. */
export interface ColumnDatum {
  key: string;
  name: string;
  /** The figure as a number, for the column's height. */
  value: number;
  /** The figure as written («94,200»). */
  valueText: string;
  /** Its unit («كم»). */
  unit: string;
  /** Its share of the whole («30.1%»); `null` draws none. */
  share: string | null;
  /** The screen it opens; `null` = a plain figure. */
  link: DashLink | null;
  /** A column set apart from the named ones («بلا فرع», «غير مسجّلة»): slate, and never a link. */
  muted?: boolean;
}

/** The height the columns are measured in; their figures ride above it, in the chart's top room. */
const PLOT = 'h-[240px]';
/**
 * Below `sm` (a phone) a column never gets narrower than its figure («120,500 كم») and a two-word
 * name: the plot and its names scroll sideways inside the card instead, the value axis held still
 * beside them. From `sm` up the columns share the line as before.
 */
const PHONE_COLUMN_PX = 88;
/** The gap between two columns on a phone (`gap-2`), so their figures never touch. */
const PHONE_GAP_PX = 8;
const SCROLLER = 'max-sm:overflow-x-auto max-sm:overscroll-x-contain';
/** The dashboard charts' own axis text and hairlines (km-chart.tsx, CustodyTimeline): muted figures
 *  in the figure face, gridlines one step off the card, the zero line a step stronger. */
const TICK = 'block text-[11px] leading-none text-slate-400 dark:text-slate-500';
const GRID = 'border-slate-100 dark:border-[#1a2538]';
const BASELINE = 'border-slate-300 dark:border-[#2a3953]';
/** The card behind a column's figure, so a gridline under a cap never strikes its figure through. */
const LABEL_BACK = 'bg-white dark:bg-[#0e1422]';
/** The bar of a muted column: a slate a step quieter than the brand's columns. */
const MUTED_BAR = 'bg-slate-300 dark:bg-slate-600';
/** The readout box of the column under the pointer or the focus. It stays inside the plot — never
 *  over the card's head and its total — and leaves the column's cap and figure in sight. */
const TIP =
  'pointer-events-none absolute z-20 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg dark:border-brand-500/30 dark:bg-[#0c1322] dark:text-slate-300';

/** Over the column's middle, or held to the outer edge of the first and the last column. Up to 60%
 *  of the axis top the plot has room above the column's figure and the box sits there; a taller
 *  column carries it on its own body, just under its cap. */
const tipPlace = (
  i: number,
  of: number,
  height: number,
): { className: string; style: CSSProperties } => ({
  className: i === 0 ? 'start-0' : i === of - 1 ? 'end-0' : 'left-1/2 -translate-x-1/2',
  style:
    height <= 60 ? { bottom: `calc(${height}% + 32px)` } : { top: `calc(${100 - height}% + 8px)` },
});

/**
 * A column chart: one column per datum, in the given order from the start of the line, measured on
 * a value axis of round steps with light gridlines. Each column carries its figure on its cap (a
 * link when it has one); under it, on the axis, its name and its share. The column under the
 * pointer or the focus shows a readout: its name, its figure, its share «من …» (`of`). No average
 * line and no target.
 */
export const ColumnChart = ({
  id,
  columns,
  ariaLabel,
  of,
}: {
  id: string;
  columns: readonly ColumnDatum[];
  /** The chart's name for a screen reader. */
  ariaLabel: string;
  /** What a share is of, in the readout («من الإجمالي», «من كيلومترات الفرع»). */
  of: string;
}): JSX.Element => {
  const [picked, setPicked] = useState<number | null>(null);
  const ticks = custodyTicks(Math.max(0, ...columns.map((column) => column.value)));
  const top = ticks[ticks.length - 1] ?? 0;
  const at = (n: number): number => (top > 0 ? (Math.max(0, n) / top) * 100 : 0);
  return (
    <div data-dash-chart={id} role="group" aria-label={ariaLabel} className="px-5 pb-5">
      <div className="flex gap-3">
        {/* The value axis, at the start of the line, its figures against the plot. The chart's top
            room (for the tallest figure) sits on each side, so the scroller below never clips it. */}
        <div aria-hidden="true" className={cn('relative mt-8 w-14 shrink-0', PLOT)}>
          {ticks.map((tick) => (
            <span
              key={tick}
              data-dash-tick={String(tick)}
              className="absolute end-0 translate-y-1/2"
              style={{ bottom: `${at(tick)}%` }}
            >
              <N className={TICK}>{count(tick)}</N>
            </span>
          ))}
        </div>
        <div data-dash-chart-scroll="true" className={cn('min-w-0 flex-1 pt-8', SCROLLER)}>
          <div
            data-dash-chart-plot="true"
            className="max-sm:min-w-[var(--dash-phone-w)]"
            style={
              {
                '--dash-phone-w': `${String(
                  columns.length * PHONE_COLUMN_PX + Math.max(0, columns.length - 1) * PHONE_GAP_PX,
                )}px`,
              } as CSSProperties
            }
          >
            <div className={cn('relative', PLOT)}>
              {ticks.map((tick) => (
                <div
                  key={tick}
                  aria-hidden="true"
                  className={cn('absolute inset-x-0 border-t', tick === 0 ? BASELINE : GRID)}
                  style={{ bottom: `${at(tick)}%` }}
                />
              ))}
              <div role="list" className="absolute inset-0 flex max-sm:gap-2">
                {columns.map((column, i) => {
                  const height = at(column.value);
                  const on = picked === i;
                  const tip = tipPlace(i, columns.length, height);
                  const muted = column.muted === true;
                  const link = muted ? null : column.link;
                  const bar = muted ? MUTED_BAR : TONE.brand.bar;
                  return (
                    <div
                      key={column.key}
                      role="listitem"
                      data-dash-col={column.key}
                      data-dash-col-n={String(column.value)}
                      {...(muted ? { 'data-dash-col-muted': 'true' } : {})}
                      aria-label={`${column.name}: ${column.valueText} ${column.unit}${
                        column.share === null ? '' : ` · ${column.share} ${of}`
                      }`}
                      onMouseEnter={() => setPicked(i)}
                      onMouseLeave={() => setPicked(null)}
                      onFocus={() => setPicked(i)}
                      onBlur={() => setPicked(null)}
                      className={cn(
                        'relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-lg transition-colors',
                        on && 'bg-slate-100/80 dark:bg-white/[0.035]',
                      )}
                    >
                      <span
                        data-dash-col-value={column.key}
                        className="absolute inset-x-0 whitespace-nowrap text-center text-[13px]"
                        style={{ bottom: `calc(${height}% + 6px)` }}
                      >
                        <span className={cn('rounded px-1 py-0.5', !on && LABEL_BACK)}>
                          <Fig link={link} className={cn('font-bold', muted ? MUTED : STRONG)}>
                            <N>{column.valueText}</N>
                          </Fig>
                          <span className={cn('ms-1 text-xs', MUTED)}>{column.unit}</span>
                        </span>
                      </span>
                      <div
                        data-dash-col-bar={column.key}
                        className={cn(
                          'w-full max-w-[64px] rounded-t-[4px]',
                          bar,
                          on && 'brightness-110',
                        )}
                        style={{ height: `${height}%` }}
                      />
                      {on && (
                        <div
                          role="tooltip"
                          data-dash-col-tip={column.key}
                          className={cn(TIP, tip.className)}
                          style={tip.style}
                        >
                          <div className={cn('flex items-center gap-1.5 font-bold', STRONG)}>
                            <span
                              aria-hidden="true"
                              className={cn('h-2.5 w-2.5 rounded-sm', bar)}
                            />
                            {column.name}
                          </div>
                          <div className="mt-1">
                            <N className={cn('font-bold', STRONG)}>{column.valueText}</N>{' '}
                            {column.unit}
                            {column.share !== null && (
                              <>
                                <Sep />
                                <N className="font-bold">{column.share}</N> {of}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2.5 flex max-sm:gap-2">
              {/* A long name («مرسيدس اسبرانتر 515») wraps under 1024 px, inside its own slot. */}
              {columns.map((column) => (
                <div
                  key={column.key}
                  className="flex min-w-0 flex-1 flex-col items-center gap-1 px-1.5"
                >
                  <span
                    data-dash-col-name={column.key}
                    className={cn(
                      'text-balance text-center text-xs font-semibold leading-snug [overflow-wrap:anywhere] lg:whitespace-nowrap lg:text-[13px] lg:leading-normal',
                      column.muted === true ? MUTED : 'text-slate-700 dark:text-slate-200',
                    )}
                  >
                    {column.name}
                  </span>
                  {column.share !== null && (
                    <span data-dash-col-share={column.key}>
                      <N className={SHARE}>{column.share}</N>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
