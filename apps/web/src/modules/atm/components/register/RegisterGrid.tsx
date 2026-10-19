// The register as the owner keeps it: the `ATMs` sheet, row for row, on one scrolling board.
//
// `DataTable` has neither frozen columns nor a grouped header, and this sheet needs both — 49
// columns nobody can read without Branch · Area · Bank · ATM ID · Name held in view, under the
// group names the owner's eye goes to first. So the table is hand-built, the way the licensing
// board builds its two-row head (fleet/pages/LicensingPage.tsx), generalised:
//
//   · ONE scrolling wrapper around a `border-separate` table — `border-collapse` is what breaks
//     the borders of a sticky cell, so every cell draws its own bottom and inline-end edge;
//   · a sticky, OPAQUE two-row head: the groups, then the columns. Rows scroll under it, so it
//     cannot be see-through;
//   · the five panes stick at their inline-start offsets (`lib/register-grid.ts`) — the right in
//     Arabic, where the sheet's column A is — and the actions stick at the inline end. Every
//     sticky cell paints the row's own opaque background, or the scrolled columns would show
//     through it. Panes freeze from `lg` up, and only on a board wide enough to leave a window
//     onto the rest; a narrow board scrolls whole, with only the head sticking.
//
// What a cell may show is decided by the server and only displayed here: a key column the reader
// may not see arrives as `null` with `secretsVisible:false` and is drawn as a lock; the safe-door
// combination never arrives at all (`safeCombinationSet` is all there is), so this file has no way
// to print one.
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  type AtmRegisterColumnDef,
  type AtmRegisterEntryDto,
  type AtmRegisterField,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { cn } from '../../../../shared/lib/cn';
import { Badge } from '../../../../shared/ui/Badge';
import { ChevronIcon, LinkIcon, LockIcon } from '../../../../shared/ui/icons';
import {
  REGISTER_ENDED_ROW,
  REGISTER_FROZEN_FIELDS,
  REGISTER_GRID_COLUMNS,
  REGISTER_LTR_FIELDS,
  REGISTER_SORT_KEYS,
  isRegisterHttpUrl,
  registerActionSlots,
  registerActionsWidth,
  registerFieldText,
  registerFrozenOffsets,
  registerGroupSpans,
  registerHeaderTitle,
  registerPanesFreeze,
  registerWidthOf,
  type RegisterActionGrants,
  type RegisterSort,
} from '../../lib/register-grid';
import {
  bankName,
  branchLabel,
  columnHeaderKey,
  formatRegisterDate,
} from '../../lib/register-labels';
import { IssueBadge } from './IssueBadge';
import { RegisterRowActions, type RegisterRowAction } from './RegisterRowActions';

const FROZEN = new Set<AtmRegisterField>(REGISTER_FROZEN_FIELDS);
const LAST_FROZEN = REGISTER_FROZEN_FIELDS[REGISTER_FROZEN_FIELDS.length - 1];
const OFFSETS = registerFrozenOffsets();
const SPANS = registerGroupSpans();
const COLUMNS_WIDTH = REGISTER_GRID_COLUMNS.reduce((sum, c) => sum + registerWidthOf(c), 0);

// The head's colours are the licensing board's: opaque, because the rows scroll under it.
const HEAD_BG = 'bg-slate-100 dark:bg-[#0c121e]';
const HEAD_EDGE = 'border-b border-e border-slate-300 dark:border-slate-700';
const CELL_EDGE = 'border-b border-e border-slate-200 dark:border-slate-800';
const ROW_BG = 'bg-white group-hover:bg-slate-50 dark:bg-slate-900 dark:group-hover:bg-slate-800';
// The pane edge: a heavier line where the frozen block ends, so the eye sees where scrolling starts.
const PANE_EDGE = 'lg:border-e-2 lg:border-e-slate-300 dark:lg:border-e-slate-600';

/** The board's width as laid out — `null` until measured (and always, in a server render). */
const useBoardWidth = (): [RefObject<HTMLDivElement>, number | null] => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0];
      if (box !== undefined) setWidth(box.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
};

export const RegisterGrid = ({
  rows,
  sort,
  onSort,
  grants,
  onAction,
}: {
  rows: readonly AtmRegisterEntryDto[];
  sort: RegisterSort | null;
  /** A sortable header was pressed — the SERVER field it orders by. */
  onSort: (by: string) => void;
  grants: RegisterActionGrants;
  onAction: (action: RegisterRowAction, row: AtmRegisterEntryDto) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [boardRef, boardWidth] = useBoardWidth();

  const actionsWidth = registerActionsWidth(registerActionSlots(grants));
  const hasActions = actionsWidth > 0;
  const freeze = registerPanesFreeze(boardWidth, actionsWidth);
  const hidden = t('atm.register.secretHidden');

  /** Sticky placement of a frozen column's cell (head or body); nothing when the panes scroll. */
  const pane = (
    field: AtmRegisterField,
    layer: 'head' | 'body',
  ): { className: string; style?: CSSProperties } => {
    const offset = OFFSETS.get(field);
    if (!freeze || offset === undefined) return { className: '' };
    return {
      className: cn(
        'lg:sticky',
        layer === 'head' ? 'z-30' : 'z-10',
        field === LAST_FROZEN && PANE_EDGE,
      ),
      style: { insetInlineStart: offset },
    };
  };
  const actionsPane = (layer: 'head' | 'body'): { className: string; style?: CSSProperties } =>
    freeze
      ? {
          className: cn('lg:sticky', layer === 'head' ? 'z-30' : 'z-10'),
          style: { insetInlineEnd: 0 },
        }
      : { className: '' };

  // ── The group header row ────────────────────────────────────────────────────────────────────
  // A group that starts inside the frozen panes is drawn in two cells: the frozen part carries the
  // name and sticks with the panes, the rest continues it without a dividing line — otherwise the
  // scrolled groups' names would slide past above the frozen columns.
  const groupCells: ReactNode[] = [];
  let index = 0;
  for (const span of SPANS) {
    const columns = REGISTER_GRID_COLUMNS.slice(index, index + span.span);
    index += span.span;
    const frozenCount = columns.filter((c) => FROZEN.has(c.field)).length;
    const lock =
      (span.group === 'keys' || span.group === 'secret') && !grants.viewSecrets ? (
        <LockIcon className="h-3 w-3 shrink-0 opacity-70" />
      ) : null;
    const label = (
      <span className="inline-flex items-center gap-1">
        {lock}
        {t(`atm.register.group.${span.group}`)}
      </span>
    );
    const headClass =
      'px-2 py-1.5 text-start text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300';
    if (frozenCount > 0 && frozenCount < columns.length) {
      const frozenPane = freeze
        ? { className: 'lg:sticky z-30', style: { insetInlineStart: 0 } as CSSProperties }
        : { className: '' };
      groupCells.push(
        <th
          key={`${span.first}-frozen`}
          colSpan={frozenCount}
          data-register-group={span.group}
          className={cn(
            headClass,
            HEAD_BG,
            'border-b border-slate-300 dark:border-slate-700',
            frozenPane.className,
            freeze && PANE_EDGE,
          )}
          style={frozenPane.style}
        >
          {label}
        </th>,
        <th
          key={`${span.first}-rest`}
          colSpan={columns.length - frozenCount}
          aria-hidden="true"
          className={cn(headClass, HEAD_BG, HEAD_EDGE)}
        />,
      );
    } else {
      groupCells.push(
        <th
          key={span.first}
          colSpan={span.span}
          data-register-group={span.group}
          className={cn(headClass, HEAD_BG, HEAD_EDGE)}
        >
          {label}
        </th>,
      );
    }
  }

  // ── The column header row ───────────────────────────────────────────────────────────────────
  const columnHead = (column: AtmRegisterColumnDef): JSX.Element => {
    const sortKey = REGISTER_SORT_KEYS[column.field];
    const active = sort !== null && sortKey !== undefined && sort.by === sortKey;
    const placed = pane(column.field, 'head');
    const name = t(columnHeaderKey(column.field));
    return (
      <th
        key={column.excel}
        data-register-column={column.excel}
        title={registerHeaderTitle(column)}
        aria-sort={
          sortKey === undefined
            ? undefined
            : active
              ? sort.dir === 'asc'
                ? 'ascending'
                : 'descending'
              : 'none'
        }
        className={cn(
          'px-2 py-1.5 text-start align-bottom text-[11px] font-semibold leading-tight',
          active ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300',
          HEAD_BG,
          HEAD_EDGE,
          placed.className,
        )}
        style={placed.style}
      >
        {sortKey === undefined ? (
          <span className="line-clamp-2">{name}</span>
        ) : (
          <button
            type="button"
            onClick={() => onSort(sortKey)}
            className="inline-flex max-w-full items-center gap-1 rounded text-start hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 dark:hover:text-white"
          >
            <span className="line-clamp-2">{name}</span>
            <ChevronIcon
              className={cn(
                'h-3 w-3 shrink-0 transition-transform',
                active ? 'opacity-100' : 'opacity-30',
                active && sort.dir === 'asc' && 'rotate-180',
              )}
            />
          </button>
        )}
      </th>
    );
  };

  // ── One body cell ───────────────────────────────────────────────────────────────────────────
  const ltr = (value: string): JSX.Element => <span dir="ltr">{value}</span>;

  const cell = (
    row: AtmRegisterEntryDto,
    column: AtmRegisterColumnDef,
  ): { node: ReactNode; title?: string } => {
    const field = column.field;
    if (column.sensitivity === 'K' && !row.secretsVisible) {
      return {
        title: hidden,
        node: (
          <span data-secret-hidden="true" className="inline-flex items-center opacity-50">
            <LockIcon className="h-3.5 w-3.5" />
            <span className="sr-only">{hidden}</span>
          </span>
        ),
      };
    }
    switch (field) {
      case 'safeCombination':
        // AO: whether one is recorded — never what it is. Reading it is the audited Reveal.
        return {
          node: (
            <Badge size="sm" tone={row.safeCombinationSet ? 'info' : 'neutral'}>
              {t(
                row.safeCombinationSet
                  ? 'atm.register.combinationSet'
                  : 'atm.register.combinationUnset',
              )}
            </Badge>
          ),
        };
      case 'branchCode':
        return row.branchCode === null
          ? { node: '' }
          : {
              title: `${row.branchCode} · ${branchLabel(row.branchCode, locale)}`,
              node: ltr(row.branchCode),
            };
      case 'bankCode': {
        if (row.bankCode === null) return { node: '' };
        const opsLabel = row.opsBankLabel === null ? '' : ` · ${row.opsBankLabel}`;
        return { title: `${bankName(row.bankCode, locale)}${opsLabel}`, node: row.bankCode };
      }
      case 'machineCode': {
        const drift =
          row.status === 'open' && row.masterState !== null && row.masterState !== 'active'
            ? row.masterState
            : null;
        const driftLabel = drift === null ? '' : t(`atm.register.master.${drift}`);
        return {
          ...(row.machineCode === null ? {} : { title: row.machineCode }),
          node: (
            <span className="flex min-w-0 items-center gap-1">
              <span dir="ltr" className="truncate">
                {row.machineCode ?? ''}
              </span>
              {drift !== null && (
                <span
                  data-master-state={drift}
                  title={driftLabel}
                  className="inline-flex shrink-0 items-center rounded bg-amber-100 px-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                >
                  <LinkIcon className="h-3 w-3" />
                  <span className="sr-only">{driftLabel}</span>
                </span>
              )}
            </span>
          ),
        };
      }
      case 'name':
        return {
          ...(row.name === null ? {} : { title: row.name }),
          node: (
            <span className="flex min-w-0 items-center gap-1">
              {/* An imported row whose Name cell was blank stays blank (DEC-32). */}
              <span className={cn('truncate', row.name === null && 'opacity-60')}>
                {row.name ?? '—'}
              </span>
              <IssueBadge issues={row.importIssues} />
            </span>
          ),
        };
      case 'startDate':
        if (row.status === 'pending') {
          return {
            node: (
              <Badge size="sm" tone="warning">
                {t('atm.register.status.pending')}
              </Badge>
            ),
          };
        }
        return row.startDate === null
          ? { node: '' }
          : { node: ltr(formatRegisterDate(row.startDate)) };
      case 'endDate':
        return row.endDate === null ? { node: '' } : { node: ltr(formatRegisterDate(row.endDate)) };
      case 'locationUrl': {
        const url = row.locationUrl;
        if (url === null) return { node: '' };
        return {
          title: url,
          node: isRegisterHttpUrl(url) ? (
            <a
              href={url.trim()}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              {url}
            </a>
          ) : (
            ltr(url)
          ),
        };
      }
      default: {
        const text = registerFieldText(row, field);
        if (text === null) return { node: '' };
        return { title: text, node: REGISTER_LTR_FIELDS.has(field) ? ltr(text) : text };
      }
    }
  };

  return (
    <div
      ref={boardRef}
      data-register-grid="true"
      data-panes-frozen={freeze}
      // Its own rows scroll under its own head. On a phone the board is capped so that holds there
      // too; on a computer it takes whatever height the page leaves it.
      className="relative max-h-[70vh] min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:max-h-none lg:flex-1"
    >
      <table
        aria-label={t('atm.register.title')}
        className="table-fixed border-separate border-spacing-0 text-xs"
        style={{ width: COLUMNS_WIDTH + actionsWidth }}
      >
        <colgroup>
          {REGISTER_GRID_COLUMNS.map((column) => (
            <col key={column.excel} style={{ width: registerWidthOf(column) }} />
          ))}
          {hasActions && <col style={{ width: actionsWidth }} />}
        </colgroup>
        <thead className="sticky top-0 z-20">
          <tr data-register-groups="true">
            {groupCells}
            {hasActions && (
              <th
                rowSpan={2}
                className={cn(
                  'px-2 py-1.5 text-end align-bottom text-[11px] font-semibold text-slate-600 dark:text-slate-300',
                  HEAD_BG,
                  'border-b border-s border-slate-300 dark:border-slate-700',
                  actionsPane('head').className,
                )}
                style={actionsPane('head').style}
              >
                <span className="sr-only">{t('atm.register.actions')}</span>
              </th>
            )}
          </tr>
          <tr>{REGISTER_GRID_COLUMNS.map(columnHead)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const ended = row.status === 'ended';
            const rowTone = ended ? REGISTER_ENDED_ROW : ROW_BG;
            const textTone = ended ? '' : 'text-slate-700 dark:text-slate-200';
            return (
              <tr
                key={row.id}
                data-register-row={row.id}
                data-register-status={row.status}
                className={cn('group', ended && REGISTER_ENDED_ROW)}
              >
                {REGISTER_GRID_COLUMNS.map((column) => {
                  const placed = pane(column.field, 'body');
                  const { node, title } = cell(row, column);
                  return (
                    <td
                      key={column.excel}
                      data-register-cell={column.field}
                      {...(title === undefined ? {} : { title })}
                      className={cn(
                        'overflow-hidden text-ellipsis whitespace-nowrap px-2 py-1.5',
                        CELL_EDGE,
                        rowTone,
                        textTone,
                        placed.className,
                      )}
                      style={placed.style}
                    >
                      {node}
                    </td>
                  );
                })}
                {hasActions && (
                  <td
                    className={cn(
                      'px-2 py-1',
                      'border-b border-s border-slate-200 dark:border-slate-800',
                      rowTone,
                      actionsPane('body').className,
                    )}
                    style={actionsPane('body').style}
                  >
                    <RegisterRowActions row={row} grants={grants} onAction={onAction} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
