// Charts 1 and 2 of the Data Report (spec §8.5): one series in the workbook's own blue, the
// categories in the sheet's order and the total bar last, set off by a gap and a hairline. No value
// axis — the Excel deleted it — so every bar carries its number, `0` included.
//
// Plain SVG and Tailwind, no chart library (the CustodyDashboardCharts precedent): it themes with
// `dark:` and the node specs can render it. The drawing is `dir="ltr"` inside the Arabic page so the
// first category stands at the LEFT, as in the sheet (DEC-19); each label keeps `dir="auto"` so its
// Arabic still shapes. The `<svg>` is one image with a one-line summary for a screen reader; the
// table under it is the accessible view.
//
// The frame, the tooltip and the category labels are shared with chart 3 (`GroupedBarChart`).
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import {
  barPath,
  labelColumns,
  labelTracks,
  reportCount,
  singleChartLayout,
  type ChartLayout,
  type ReportSingleSection,
} from '../../lib/register-report-view';

/** Value labels wear text tokens, never the series colour (the size is each chart's own). */
export const VALUE_TEXT = 'fill-slate-700 tabular-nums dark:fill-slate-200';
export const BASELINE = 'stroke-slate-300 dark:stroke-slate-600';
/** The hover/focus column behind a bar. */
const HIT_IDLE = 'fill-transparent';
const HIT_ACTIVE = 'fill-slate-100 dark:fill-slate-800/70';
export const hitClass = (active: boolean): string => (active ? HIT_ACTIVE : HIT_IDLE);

/** What the tooltip says about one bar — "<category> · <series>: n" — and where it stands. */
export interface ChartTip {
  cx: number;
  y: number;
  category: string;
  series: string;
  value: number;
}

/**
 * Hover and keyboard focus over a chart's bars. The chart is ONE stop on the Tab path; the arrow
 * keys walk its bars left to right (the drawing is always left-to-right), Home/End jump.
 */
export const useActiveBar = (
  count: number,
): {
  active: number | null;
  setActive: (index: number | null) => void;
  frame: {
    tabIndex: number;
    onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
    onFocus: () => void;
    onBlur: () => void;
    onMouseLeave: () => void;
  };
} => {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (count === 0) return;
    const from = active ?? 0;
    const to =
      e.key === 'ArrowRight'
        ? Math.min(count - 1, from + 1)
        : e.key === 'ArrowLeft'
          ? Math.max(0, from - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? count - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    setActive(to);
  };
  return {
    active,
    setActive,
    frame: {
      tabIndex: 0,
      onKeyDown,
      onFocus: () => setActive((current) => current ?? (count > 0 ? 0 : null)),
      onBlur: () => setActive(null),
      onMouseLeave: () => setActive(null),
    },
  };
};

/**
 * The frame every Data Report chart shares, all `dir="ltr"`: the legend across the card's width,
 * then a scroller (a chart wider than its card scrolls sideways rather than squeezing its labels)
 * holding the focusable plot with its tooltip and the category labels under the slots.
 */
export const ChartFrame = ({
  section,
  title,
  summary,
  layout,
  labels,
  tip,
  frame,
  legend,
  children,
}: {
  section: 1 | 2 | 3;
  title: string;
  summary: string;
  layout: ChartLayout;
  /** One label per slot of `layout.slots`, in the same order. */
  labels: { key: string; text: string; strong: boolean }[];
  tip: ChartTip | null;
  frame: ReturnType<typeof useActiveBar>['frame'];
  legend?: ReactNode;
  children: ReactNode;
}): JSX.Element => {
  const columns = labelColumns(layout);
  // The tooltip is a sentence in the reader's language around names in either script: it takes
  // the page's direction, and each name is isolated so a Latin bank name cannot reorder it.
  const dir = useAppSelector((state) => state.locale.dir);
  const scroller = useRef<HTMLDivElement>(null);
  const tipX = tip?.cx ?? null;
  // A bar reached with the keyboard may lie outside the scrolled part of a wide chart: bring it in.
  useEffect(() => {
    const box = scroller.current;
    const sized = box?.firstElementChild;
    if (tipX === null || box === null || !(sized instanceof HTMLElement)) return;
    // Only for the keyboard: scrolling under a hovering pointer would move another bar under it.
    if (!box.contains(document.activeElement)) return;
    const at = sized.offsetLeft + (tipX / layout.width) * sized.clientWidth;
    const margin = 48;
    if (at < box.scrollLeft + margin) box.scrollLeft = Math.max(0, at - margin);
    else if (at > box.scrollLeft + box.clientWidth - margin)
      box.scrollLeft = at - box.clientWidth + margin;
  }, [tipX, layout.width]);
  return (
    <div
      dir="ltr"
      data-report-chart={section}
      // The owner's colours must print as drawn, swatches included.
      className="[-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
    >
      {legend}
      <div ref={scroller} className="relative overflow-x-auto pb-1 print:overflow-visible">
        {/* Drawn at its own size and never stretched (a bar stays ≤ 24 px); printed, a drawing
            wider than the page shrinks to fit it, the labels following as fractions. */}
        <div className="mx-auto print:max-w-full" style={{ width: `${String(layout.width)}px` }}>
          <div
            role="group"
            aria-label={title}
            {...frame}
            className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60"
          >
            <svg
              viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
              width="100%"
              role="img"
              aria-label={summary}
              className="block h-auto w-full"
            >
              {children}
            </svg>
            <div
              aria-live="polite"
              className="pointer-events-none absolute inset-0 print:hidden"
              data-report-tooltip-layer={section}
            >
              {tip !== null && (
                <span
                  data-report-tooltip="true"
                  className="absolute z-10 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-elevated dark:bg-slate-100 dark:text-slate-900"
                  style={tipStyle(tip, layout)}
                >
                  <span dir={dir}>
                    <bdi>{tip.category}</bdi> · <bdi>{tip.series}</bdi>:{' '}
                    <bdi>{reportCount(tip.value)}</bdi>
                  </span>
                </span>
              )}
            </div>
          </div>
          <div className="mt-1 grid" style={{ gridTemplateColumns: labelTracks(layout) }}>
            {labels.map((label, i) => (
              <span
                key={label.key}
                data-report-category={label.key}
                dir="auto"
                className={cn(
                  'block break-words px-1 text-center text-xs leading-snug',
                  label.strong
                    ? 'font-bold text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-300',
                )}
                style={{ gridColumn: String(columns[i] ?? i + 1), gridRow: '1' }}
              >
                {label.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Where the tooltip stands: above its bar's value, unless the bar is so tall the tooltip would leave
 * the scroller's top (then it drops onto the bar); centred on the bar, unless that would cross the
 * drawing's left or right edge (then it hangs inward from the bar).
 */
const tipStyle = (tip: ChartTip, layout: ChartLayout): CSSProperties => {
  const share = tip.cx / layout.width;
  const x = share < 0.2 ? '-12px' : share > 0.8 ? 'calc(-100% + 12px)' : '-50%';
  const y = tip.y < 56 ? '6px' : 'calc(-100% - 18px)';
  return {
    left: `${String(share * 100)}%`,
    top: `${String((tip.y / layout.height) * 100)}%`,
    transform: `translate(${x}, ${y})`,
  };
};

/** Charts 1 and 2. */
export const BarChart = ({ section }: { section: ReportSingleSection }): JSX.Element => {
  const t = useT();
  const layout = singleChartLayout(section.bars);
  const { active, setActive, frame } = useActiveBar(layout.marks.length);
  const labelOf = new Map(section.bars.map((bar) => [bar.key, bar.label]));
  const activeMark = active === null ? undefined : layout.marks[active];
  const tip: ChartTip | null =
    activeMark === undefined
      ? null
      : {
          cx: activeMark.cx,
          y: activeMark.y,
          category: labelOf.get(activeMark.key) ?? '',
          series: section.title,
          value: activeMark.value,
        };

  return (
    <ChartFrame
      section={section.section}
      title={section.title}
      summary={t('atm.registerReport.chartSummary', {
        title: section.title,
        total: reportCount(section.total),
      })}
      layout={layout}
      labels={section.bars.map((bar) => ({ key: bar.key, text: bar.label, strong: bar.isTotal }))}
      tip={tip}
      frame={frame}
    >
      {layout.marks.map((mark, i) => (
        <g
          key={mark.key}
          data-report-bar={mark.key}
          data-report-value={mark.value}
          onMouseEnter={() => setActive(i)}
        >
          <rect
            data-report-hit={mark.key}
            x={mark.slotX}
            y={0}
            width={mark.slotWidth}
            height={layout.baseline}
            className={hitClass(active === i)}
          />
          {mark.height > 0 && <path d={barPath(mark)} fill={section.color} />}
          <text
            x={mark.cx}
            y={mark.y - 7}
            textAnchor="middle"
            className={cn(VALUE_TEXT, 'text-xs', mark.isTotal && 'font-bold')}
          >
            {reportCount(mark.value)}
          </text>
        </g>
      ))}
      {layout.dividerX !== null && (
        <line
          data-report-divider="true"
          x1={layout.dividerX}
          x2={layout.dividerX}
          y1={8}
          y2={layout.baseline}
          strokeWidth={1}
          className="stroke-slate-200 dark:stroke-slate-700"
        />
      )}
      <line
        x1={0}
        x2={layout.width}
        y1={layout.baseline + 0.5}
        y2={layout.baseline + 0.5}
        strokeWidth={1}
        className={BASELINE}
      />
    </ChartFrame>
  );
};
