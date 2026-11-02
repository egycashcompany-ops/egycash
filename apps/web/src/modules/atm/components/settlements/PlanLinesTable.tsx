// The plan's lines (§9.4 «Table»): one row per line, in the server's order (serial first, then run,
// time and position). A click selects the line for the side panel; the checkbox picks the issued
// lines «السطور المحددة» prints. A real table (§9.10): the status is written, never colour only.
//
// A ROW OF FILTER LISTS under the head, one multi-pick drop-down per column (2026-11-02, «فلتر لكل
// عمود», «يكون Drop Down بـ Multi select»): the PAGE keeps what they hold and hands this table the
// lines they keep (`filterPlanLines`), so what the table shows is what «السطور المحددة» may print.
// Each list holds the texts its column's cells show.
import { type AtmPlanLineDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import {
  columnFilterChoices,
  filterRowsByColumns,
  type ColumnFilterValues,
} from '../../../../shared/lib/column-filter';
import { formatNumber } from '../../../../shared/lib/format';
import { Badge } from '../../../../shared/ui/Badge';
import { ColumnFilterSelect } from '../../../../shared/ui/ColumnFilterSelect';
import { type ColumnFilters } from '../../../../shared/ui/useColumnFilters';
import { AlertIcon } from '../../../../shared/ui/icons';
import { formatTime12 } from '../../lib/settlement-dates';
import {
  LINE_STATUS_TONE,
  formatEgp,
  lineBags,
  lineCode,
  lineStatusKey,
  runLabel,
} from '../../lib/settlement-view';
import { LineChips, lineChipsText } from './LineChips';
import { RunChip } from './RunChip';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Only an issued or prepared line has a Note to print (§6.7 `notes`). */
export const printable = (line: Pick<AtmPlanLineDto, 'status'>): boolean =>
  line.status === 'issued' || line.status === 'prepared';

/** The table's columns after the print checkbox, in order — the head and the filter row alike. */
export const PLAN_LINE_COLUMNS = [
  { key: 'serial', header: 'atm.settlement.serial' },
  { key: 'code', header: 'atm.settlement.machineCode' },
  { key: 'name', header: 'atm.settlement.machineName' },
  { key: 'run', header: 'atm.settlement.run' },
  { key: 'cassettes', header: 'atm.plan.column.cassettes' },
  { key: 'bags', header: 'atm.plan.column.bags' },
  { key: 'total', header: 'atm.settlement.total', className: 'text-end' },
  { key: 'status', header: 'atm.settlement.status' },
] as const;

/** «طقم سبير S2» for a spare, the machine's name otherwise. */
const lineName = (line: AtmPlanLineDto, t: Translate): string =>
  line.kind === 'spare'
    ? `${t('atm.paper.spareSet')} ${line.typeLabel ?? ''}`.trim()
    : (line.machineName ?? '—');

/** «أخطاء: ١ · تنبيهات: ٠» — the line's issues, counted in the page's digits. */
const issuesText = (line: AtmPlanLineDto, t: Translate, locale: Locale): string => {
  const errors = line.issues.filter((i) => i.severity === 'error').length;
  return t('atm.plan.issuesCount', {
    errors: formatNumber(errors, locale),
    warnings: formatNumber(line.issues.length - errors, locale),
  });
};

/**
 * Pure: what a line's cell in that column shows, as text — the run chip's run and time, the
 * cassette chips, the status with its issues — so a list offers what a reader sees. Null for a
 * column the table does not have.
 */
export const planLineText = (
  line: AtmPlanLineDto,
  key: string,
  t: Translate,
  locale: Locale,
): string | null => {
  switch (key) {
    case 'serial':
      return line.serial === null ? '—' : formatNumber(line.serial, locale);
    case 'code':
      return lineCode(line);
    case 'name':
      return lineName(line, t);
    case 'run':
      return `${runLabel(line.run, t)} ${formatTime12(line.scheduleTime, locale)}`.trim();
    case 'cassettes':
      return lineChipsText(line.slots, locale);
    case 'bags':
      return formatNumber(lineBags(line.slots).length, locale);
    case 'total':
      return formatEgp(line.egpTotalMinor, locale);
    case 'status':
      return line.issues.length === 0
        ? t(lineStatusKey(line.status))
        : `${t(lineStatusKey(line.status))} ${issuesText(line, t, locale)}`;
    default:
      return null;
  }
};

/** Pure: the lines every column filter keeps, in the plan's order. */
export const filterPlanLines = (
  lines: readonly AtmPlanLineDto[],
  values: ColumnFilterValues,
  t: Translate,
  locale: Locale,
): AtmPlanLineDto[] =>
  filterRowsByColumns(lines, values, (line, key) => planLineText(line, key, t, locale));

/**
 * Pure: the ticked lines «السطور المحددة» may print — those the table shows, in its order. A tick
 * on a line a column filter hides is kept, and shows again with the line, but is never printed unseen.
 */
export const shownTicks = (
  shown: readonly Pick<AtmPlanLineDto, 'id'>[],
  checked: ReadonlySet<string>,
): string[] => shown.filter((line) => checked.has(line.id)).map((line) => line.id);

const TH = 'px-3 py-2.5 text-start text-xs font-semibold text-slate-600 dark:text-slate-300';
/** The filter row's cells: the head's side gutter, so each list sits under its own header. */
const FILTER_TH = 'px-3 pb-2 font-normal';
const TD = 'px-3 py-2.5 align-middle text-sm text-slate-700 dark:text-slate-200';

export const PlanLinesTable = ({
  lines,
  locale,
  selectedId,
  checked,
  onSelect,
  onCheck,
  columnFilters,
  allLines,
}: {
  /** The lines the column filters keep (`filterPlanLines`) — the page filters, the table shows. */
  lines: readonly AtmPlanLineDto[];
  /**
   * The plan's lines before the column filters: what each list offers, and the empty row blames
   * the filters only when there are some.
   */
  allLines: readonly AtmPlanLineDto[];
  locale: Locale;
  selectedId: string | null;
  checked: ReadonlySet<string>;
  onSelect: (lineId: string) => void;
  onCheck: (lineId: string, on: boolean) => void;
  columnFilters: ColumnFilters;
}): JSX.Element => {
  const t = useT();
  return (
    // The board frame's scroll box (`shared/ui/board-scroll.ts`): on a computer the page hands it
    // the height left and its rows scroll under a head that stays — opaque, as `DataTable
    // stickyHead` paints it, since rows pass beneath. A phone scrolls sideways only, as before.
    <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white lg:overflow-auto dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full min-w-[56rem] border-collapse" data-plan-lines="true">
        <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
          <tr>
            <th className={cn(TH, 'w-10')}>
              <span className="sr-only">{t('atm.plan.column.select')}</span>
            </th>
            {PLAN_LINE_COLUMNS.map((column) => (
              <th key={column.key} className={cn(TH, 'className' in column && column.className)}>
                {t(column.header)}
              </th>
            ))}
          </tr>
          {/* The filter row sticks with the head: the print checkbox's column takes no list. */}
          <tr key={`filters-${String(columnFilters.generation)}`} data-column-filters="true">
            <th className={FILTER_TH} />
            {PLAN_LINE_COLUMNS.map((column) => (
              <th key={column.key} className={FILTER_TH}>
                <ColumnFilterSelect
                  value={columnFilters.values[column.key] ?? []}
                  choices={() =>
                    columnFilterChoices(allLines, columnFilters.values, column.key, (line, key) =>
                      planLineText(line, key, t, locale),
                    )
                  }
                  onChange={(picked) => columnFilters.set(column.key, picked)}
                  label={t('atm.common.filterColumn', { column: t(column.header) })}
                  columnKey={column.key}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && columnFilters.active && allLines.length > 0 && (
            <tr data-plan-lines-empty="true">
              <td
                colSpan={PLAN_LINE_COLUMNS.length + 1}
                className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
              >
                {t('atm.common.emptyColumnFiltered')}
              </td>
            </tr>
          )}
          {lines.map((line) => {
            const errors = line.issues.filter((i) => i.severity === 'error').length;
            const selected = line.id === selectedId;
            return (
              <tr
                key={line.id}
                data-plan-line={line.id}
                onClick={() => onSelect(line.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(line.id);
                }}
                tabIndex={0}
                aria-selected={selected}
                className={cn(
                  'cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60',
                  selected && 'bg-brand-50/70 dark:bg-brand-950/40',
                  line.status === 'cancelled' && 'text-slate-400',
                )}
              >
                <td className={TD} onClick={(e) => e.stopPropagation()}>
                  {printable(line) && (
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={checked.has(line.id)}
                      onChange={(e) => onCheck(line.id, e.target.checked)}
                      aria-label={`${t('atm.plan.column.select')} — ${lineCode(line)}`}
                    />
                  )}
                </td>
                <td className={cn(TD, 'tabular-nums')} data-plan-serial={line.id}>
                  {planLineText(line, 'serial', t, locale)}
                </td>
                <td className={TD}>
                  <span dir="ltr" className="font-medium">
                    {lineCode(line)}
                  </span>
                </td>
                <td className={TD}>{lineName(line, t)}</td>
                <td className={TD}>
                  <RunChip run={line.run} time={line.scheduleTime} locale={locale} />
                </td>
                <td className={TD}>
                  <LineChips slots={line.slots} locale={locale} />
                </td>
                <td className={cn(TD, 'tabular-nums')}>
                  {formatNumber(lineBags(line.slots).length, locale)}
                </td>
                <td className={cn(TD, 'text-end tabular-nums')}>
                  {formatEgp(line.egpTotalMinor, locale)}
                </td>
                <td className={TD}>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Badge tone={LINE_STATUS_TONE[line.status]} size="sm">
                      {t(lineStatusKey(line.status))}
                    </Badge>
                    {line.issues.length > 0 && (
                      <span
                        data-line-issues={line.id}
                        title={issuesText(line, t, locale)}
                        className={cn(
                          'inline-flex items-center gap-1 text-xs',
                          errors > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400',
                        )}
                      >
                        <AlertIcon className="h-4 w-4" aria-hidden="true" />
                        <span>{issuesText(line, t, locale)}</span>
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
