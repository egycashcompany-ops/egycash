// «البيانات والسيلزات» (S-8 a, §9.7 Tab 1): every issued, prepared and cancelled line of the day, of
// every enabled bank, with its bags' QRs and its cassette seals as Preparation captured them, and
// the crew line it travels on. «النوع» and «المنطقة» are the seals sheet's TYPE and HUB. A
// duplicate shows ⚠ with Preparation's own words (DS-15); expanding a row lists its seals.
//
// A ROW OF FILTER LISTS under the head, one multi-pick drop-down per column (2026-11-02, «فلتر لكل
// عمود», «يكون Drop Down بـ Multi select»): the PAGE keeps what they hold and hands this tab the
// lines they keep (`filterControlLines`). Each list holds the texts its column's cells show — the QR itself, «٢ من ٢» for the seals, the route's name.
import { Fragment, useState } from 'react';
import { type AtmControlDayDto, type Locale } from '@ecms/contracts';
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
import {
  SteadyColGroup,
  useSteadyColumns,
  type SteadyColumns,
} from '../../../../shared/ui/useSteadyColumns';
import { type ColumnFilters } from '../../../../shared/ui/useColumnFilters';
import { ChevronIcon } from '../../../../shared/ui/icons';
import { formatTime12 } from '../../lib/settlement-dates';
import {
  formatEgp,
  lineCode,
  PREPARATION_STATUS_TONE,
  preparationStatusKey,
  runFirst,
  runLabel,
} from '../../lib/settlement-view';
import { type BankLookup } from '../../lib/bank-catalog';
import { DuplicateNote, duplicateTexts } from './DuplicateNote';
import { RunChip } from './RunChip';
import { FRESH_ON_OPEN } from '../../lib/fresh-filters';

type ControlLine = AtmControlDayDto['lines'][number];
type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The table's columns after the seals toggle, in order — the head and the filter row alike. */
export const CONTROL_LINE_COLUMNS = [
  { key: 'serial', header: 'atm.settlement.serial' },
  { key: 'bank', header: 'atm.settlement.bank' },
  { key: 'code', header: 'atm.settlement.machineCode' },
  { key: 'name', header: 'atm.settlement.machineName' },
  { key: 'type', header: 'atm.control.column.type' },
  { key: 'area', header: 'atm.settlement.area' },
  { key: 'run', header: 'atm.settlement.run' },
  { key: 'total', header: 'atm.settlement.total', className: 'text-end' },
  { key: 'qr1', header: 'atm.control.column.qr1' },
  { key: 'qr2', header: 'atm.control.column.qr2' },
  { key: 'seals', header: 'atm.control.column.seals' },
  { key: 'preparation', header: 'atm.control.column.preparation' },
  { key: 'route', header: 'atm.control.column.route' },
] as const;

/** What a line's cells are written with: the reader's words, the bank names, the day's routes. */
export interface ControlTextContext {
  t: Translate;
  locale: Locale;
  banks: BankLookup;
  /** The day's live routes by id — a line on a deleted one reads as unassigned. */
  routeName: ReadonlyMap<string, string>;
}

/** A bag's QR, or «—» when the line has no such bag or it is not captured yet. */
const qrOf = (line: ControlLine, bag: 1 | 2): string =>
  line.bags.find((b) => b.bag === bag)?.qr ?? '—';

/** «٢ من ٢» — the seals captured over the line's cassettes. */
const sealsText = (line: ControlLine, t: Translate, locale: Locale): string =>
  t('atm.control.sealsProgress', {
    n: formatNumber(line.seals.filter((s) => s.value !== null).length, locale),
    m: formatNumber(line.seals.length, locale),
  });

/**
 * Pure: what a line's cell in that column shows, as text — what its column filter lists. Null for
 * a column the table does not have.
 */
export const controlLineText = (
  line: ControlLine,
  key: string,
  { t, locale, banks, routeName }: ControlTextContext,
): string | null => {
  switch (key) {
    case 'serial':
      return line.serial === null ? '—' : formatNumber(line.serial, locale);
    case 'bank':
      return banks.name(line.bankCode, locale);
    case 'code':
      return lineCode(line);
    case 'name':
      return line.kind === 'spare'
        ? `${t('atm.paper.spareSet')} ${line.typeLabel ?? ''}`.trim()
        : (line.machineName ?? '—');
    case 'type':
      return line.typeLabel ?? '—';
    case 'area':
      return line.hubLabel ?? line.area ?? '—';
    case 'run':
      return `${runLabel(line.run, t)} ${formatTime12(line.scheduleTime, locale)}`.trim();
    case 'total':
      return formatEgp(line.egpTotalMinor, locale);
    case 'qr1':
      return qrOf(line, 1);
    case 'qr2':
      return line.bags.some((b) => b.bag === 2) ? qrOf(line, 2) : '—';
    case 'seals':
      return sealsText(line, t, locale);
    case 'preparation':
      return line.lineStatus === 'cancelled'
        ? t('atm.settlement.status.cancelled')
        : t(preparationStatusKey(line.preparationStatus));
    case 'route':
      // A route that is not live (deleted) holds nothing: the line is unassigned.
      return (
        (line.routeId === null ? undefined : routeName.get(line.routeId)) ??
        t('atm.control.unassignedOption')
      );
    default:
      return null;
  }
};

/** The day's live routes by id, for the route column. */
export const routeNames = (day: Pick<AtmControlDayDto, 'routes'>): Map<string, string> =>
  new Map(day.routes.map((r) => [r.id, r.name]));

/** Pure: the day's lines every column filter keeps, in the server's order. */
export const filterControlLines = (
  lines: readonly ControlLine[],
  values: ColumnFilterValues,
  context: ControlTextContext,
): ControlLine[] =>
  filterRowsByColumns(lines, values, (line, key) => controlLineText(line, key, context));

const TH = 'px-3 py-2.5 text-start text-xs font-semibold text-slate-600 dark:text-slate-300';
/**
 * The filter row's cells: a gutter a step narrower than the head's. Thirteen lists, each with the
 * floor that keeps «الكل» whole, would otherwise push the tab past its `min-w-[72rem]` and add a
 * sideways scroll the text boxes never needed; a list still sits under its own header.
 */
const FILTER_TH = 'px-2 pb-2 font-normal';
const TD = 'px-3 py-2.5 align-middle text-sm text-slate-700 dark:text-slate-200';

/** A bag's QR cell: the value, or «—», with ⚠ and the warning's words when it is a duplicate. */
const QrCell = ({ line, bag }: { line: ControlLine; bag: 1 | 2 }): JSX.Element => {
  const t = useT();
  const duplicate = line.duplicates.find((d) => d.field === 'bag' && d.bag === bag);
  const words = duplicate === undefined ? [] : duplicateTexts(undefined, duplicate, t);
  return (
    <span className="inline-flex items-center gap-1">
      <span dir="ltr" className="font-mono text-xs">
        {qrOf(line, bag)}
      </span>
      {words.length > 0 && (
        <span
          title={words.join(' ')}
          className="text-orange-600 dark:text-orange-400"
          data-control-duplicate="bag"
        >
          ⚠<span className="sr-only">{words.join(' ')}</span>
        </span>
      )}
    </span>
  );
};

/**
 * The data table's columns keep the widths the day's lines first gave them, whatever its lists keep
 * (`useSteadyColumns`). Called by the PAGE, beside the column filters it already keeps across a
 * switch to the routes and back: the table is drawn again on the way back, and must find its widths
 * as it left them.
 */
export const useControlLineWidths = ({
  lines,
  locale,
  filtered,
}: {
  lines: readonly ControlLine[];
  locale: Locale;
  filtered: boolean;
}): SteadyColumns =>
  useSteadyColumns({
    ready: lines.length > 0,
    signature: `${locale}|${CONTROL_LINE_COLUMNS.map((column) => column.key).join('|')}`,
    count: CONTROL_LINE_COLUMNS.length + 1,
    filtered,
    watch: lines,
  });

export const ControlDataTab = ({
  day,
  lines,
  locale,
  banks,
  columnFilters,
  steady,
}: {
  /**
   * The whole day — `day.lines` is what the column filters narrow and what their lists offer, and
   * an empty row blames them only when it holds lines.
   */
  day: AtmControlDayDto;
  /** The day's lines the column filters keep (`filterControlLines`) — the page filters. */
  lines: readonly ControlLine[];
  locale: Locale;
  /** The catalog's bank names (DEC-35): a line of a bank added since the workbook is named too. */
  banks: BankLookup;
  columnFilters: ColumnFilters;
  /** The columns' kept widths (`useControlLineWidths`) — held by the page, beside its filters. */
  steady: SteadyColumns;
}): JSX.Element => {
  const t = useT();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const routeName = routeNames(day);
  const text = (line: ControlLine, key: string): string =>
    controlLineText(line, key, { t, locale, banks, routeName }) ?? '';
  const toggle = (id: string): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    // The board frame's scroll box (`shared/ui/board-scroll.ts`): on a computer the page hands it
    // the height left and its rows scroll under a head that stays — opaque, as `DataTable
    // stickyHead` paints it, since rows pass beneath. A phone scrolls sideways only, as before.
    <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white lg:overflow-auto dark:border-slate-800 dark:bg-slate-900">
      <table
        ref={steady.ref}
        className="w-full min-w-[72rem] border-collapse"
        data-control-lines="true"
      >
        <SteadyColGroup shares={steady.shares} />
        <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
          <tr>
            <th className={cn(TH, 'w-8')}>
              <span className="sr-only">{t('atm.control.column.seals')}</span>
            </th>
            {CONTROL_LINE_COLUMNS.map((column) => (
              <th key={column.key} className={cn(TH, 'className' in column && column.className)}>
                {t(column.header)}
              </th>
            ))}
          </tr>
          {/* The filter row sticks with the head: the seals toggle's column takes no list. */}
          <tr key={`filters-${String(columnFilters.generation)}`} data-column-filters="true">
            <th className={FILTER_TH} />
            {CONTROL_LINE_COLUMNS.map((column) => (
              <th key={column.key} className={FILTER_TH}>
                <ColumnFilterSelect
                  value={columnFilters.values[column.key] ?? []}
                  choices={() =>
                    columnFilterChoices(
                      day.lines,
                      columnFilters.values,
                      column.key,
                      (line, key) => controlLineText(line, key, { t, locale, banks, routeName }),
                      runFirst,
                    )
                  }
                  onChange={(picked) => columnFilters.set(column.key, picked)}
                  label={t('atm.common.filterColumn', { column: t(column.header) })}
                  columnKey={column.key}
                  freshOnOpen={FRESH_ON_OPEN.includes(column.key)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && columnFilters.active && day.lines.length > 0 && (
            <tr data-control-lines-empty="true">
              <td
                colSpan={CONTROL_LINE_COLUMNS.length + 1}
                className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
              >
                {t('atm.common.emptyColumnFiltered')}
              </td>
            </tr>
          )}
          {lines.map((line) => {
            const sealsCaptured = line.seals.filter((s) => s.value !== null).length;
            const complete = line.seals.length > 0 && sealsCaptured === line.seals.length;
            const sealDuplicate = line.duplicates.some((d) => d.field === 'seal');
            const expanded = open.has(line.lineId);
            const cancelled = line.lineStatus === 'cancelled';
            return (
              <Fragment key={line.lineId}>
                <tr
                  data-control-line={line.lineId}
                  className={cn(
                    'border-t border-slate-100 dark:border-slate-800',
                    cancelled && 'text-slate-400',
                  )}
                >
                  <td className={TD}>
                    <button
                      type="button"
                      onClick={() => toggle(line.lineId)}
                      aria-expanded={expanded}
                      aria-label={`${t('atm.control.column.seals')} — ${lineCode(line)}`}
                      className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <ChevronIcon
                        className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')}
                      />
                    </button>
                  </td>
                  <td className={cn(TD, 'tabular-nums')}>{text(line, 'serial')}</td>
                  <td className={TD}>{text(line, 'bank')}</td>
                  <td className={TD}>
                    <span dir="ltr" className="font-medium">
                      {lineCode(line)}
                    </span>
                  </td>
                  <td className={TD}>{text(line, 'name')}</td>
                  <td className={TD}>{text(line, 'type')}</td>
                  <td className={TD}>{text(line, 'area')}</td>
                  <td className={TD}>
                    <RunChip run={line.run} time={line.scheduleTime} locale={locale} />
                  </td>
                  <td className={cn(TD, 'text-end tabular-nums')}>{text(line, 'total')}</td>
                  <td className={TD}>
                    <QrCell line={line} bag={1} />
                  </td>
                  <td className={TD}>
                    {line.bags.some((b) => b.bag === 2) ? <QrCell line={line} bag={2} /> : '—'}
                  </td>
                  <td className={TD}>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        complete
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : sealsCaptured > 0
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                      )}
                    >
                      {text(line, 'seals')}
                      {complete && ' ✓'}
                    </span>
                    {sealDuplicate && (
                      <span
                        className="ms-1 text-orange-600 dark:text-orange-400"
                        data-control-duplicate="seal"
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    <Badge
                      size="sm"
                      tone={cancelled ? 'neutral' : PREPARATION_STATUS_TONE[line.preparationStatus]}
                    >
                      {text(line, 'preparation')}
                    </Badge>
                  </td>
                  <td className={TD}>{text(line, 'route')}</td>
                </tr>
                {expanded && (
                  <tr
                    className="bg-slate-50/60 dark:bg-slate-800/30"
                    data-control-seals={line.lineId}
                  >
                    <td />
                    <td colSpan={13} className="px-3 py-2.5">
                      <ul className="grid gap-1 text-sm sm:grid-cols-2">
                        {line.seals.map((seal) => {
                          const duplicate = line.duplicates.find(
                            (d) => d.field === 'seal' && d.slot === seal.slot,
                          );
                          return (
                            <li key={seal.slot}>
                              <span className="text-slate-700 dark:text-slate-200">
                                {t('atm.control.sealRow', {
                                  slot: seal.slot,
                                  d: seal.denomination ?? '—',
                                  value: seal.value ?? '—',
                                })}
                              </span>
                              {duplicate !== undefined && (
                                <span
                                  aria-live="polite"
                                  className="block text-xs text-orange-700 dark:text-orange-300"
                                >
                                  <DuplicateNote local={undefined} server={duplicate} />
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
