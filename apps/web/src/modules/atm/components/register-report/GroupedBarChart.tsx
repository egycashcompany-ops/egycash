// Chart 3 of the Data Report (spec §8.5): the branches in the sheet's order, each a cluster of the
// six banks in the sheet's order, each bank in the owner's colour in both themes (D7). Those
// colours do not pass the palette checks — two neighbours are hard to tell apart for a protan
// reader, and some are faint on one surface or the other — so the relief is mandatory: a legend,
// a value on EVERY bar (a zero included), light value gridlines, and the table under the chart.
// Legend and value text wear text tokens; only the swatch and the bar carry the colour.
//
// Left-to-right like the sheet (`dir="ltr"`, DEC-19); the frame, tooltip and labels are the ones
// charts 1–2 use (`BarChart.tsx`).
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import {
  barPath,
  groupedChartLayout,
  reportCount,
  type ReportGroupedSection,
} from '../../lib/register-report-view';
import {
  BASELINE,
  ChartFrame,
  VALUE_TEXT,
  hitClass,
  useActiveBar,
  type ChartTip,
} from './BarChart';

export const GroupedBarChart = ({ section }: { section: ReportGroupedSection }): JSX.Element => {
  const t = useT();
  const layout = groupedChartLayout(section.groups, section.series.length);
  const { active, setActive, frame } = useActiveBar(layout.marks.length);
  const seriesCount = section.series.length;

  const tipFor = (index: number): ChartTip | null => {
    const mark = layout.marks[index];
    const group = section.groups[Math.floor(index / Math.max(1, seriesCount))];
    const series = section.series[index % Math.max(1, seriesCount)];
    if (mark === undefined || group === undefined || series === undefined) return null;
    return {
      cx: mark.cx,
      y: mark.y,
      category: group.label,
      series: series.label,
      value: mark.value,
    };
  };

  const legend = (
    <ul
      aria-label={t('atm.registerReport.legend')}
      data-report-legend="true"
      className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-4"
    >
      {section.series.map((series) => (
        <li
          key={series.key}
          data-report-legend-item={series.key}
          className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200"
        >
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: series.color }}
          />
          <span dir="auto">{series.label}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <ChartFrame
      section={3}
      title={section.title}
      summary={t('atm.registerReport.chartSummary', {
        title: section.title,
        total: reportCount(section.total),
      })}
      layout={layout}
      labels={section.groups.map((group) => ({ key: group.key, text: group.label, strong: false }))}
      tip={active === null ? null : tipFor(active)}
      frame={frame}
      legend={legend}
    >
      {layout.gridlines.map((line) => (
        <line
          key={line.value}
          data-report-gridline={line.value}
          x1={0}
          x2={layout.width}
          y1={line.y + 0.5}
          y2={line.y + 0.5}
          strokeWidth={1}
          className="stroke-slate-100 dark:stroke-slate-800"
        />
      ))}
      {layout.marks.map((mark, i) => {
        const series = section.series[i % Math.max(1, seriesCount)];
        return (
          <g
            key={mark.key}
            data-report-bar={mark.key}
            data-report-series={series?.key}
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
            {mark.height > 0 && <path d={barPath(mark)} fill={series?.color} />}
            <text
              x={mark.cx}
              y={mark.y - 5}
              textAnchor="middle"
              className={cn(VALUE_TEXT, 'text-[10px]')}
            >
              {reportCount(mark.value)}
            </text>
          </g>
        );
      })}
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
