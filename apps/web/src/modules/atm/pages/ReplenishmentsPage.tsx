// /atm/replenishments — the legacy /atm_replenishment page (atm_replenishment.ejs), by parity:
//
//   · the multi-row open form: machine codes one per line, schedule times aligned BY LINE, one
//     force date for the batch (:558-580);
//   · ONE DAY AT A TIME (2026-10-27, «هنا يظهر فقط الماكينات اللى المفروض يتغذى … في اليوم دا مش
//     عموماً»): today's rows by default, with the live timer; a switch shows tomorrow, everything
//     scheduled ahead, or the earlier days left open (`lib/board-day.ts`). The legacy drew today
//     and «other days» as two groups at once (:1013 / :1086); an earlier day's row keeps the close
//     control and the checkbox the legacy grey group lacked (D4);
//   · the timer counts from open and paints ≥1h green / ≥2h yellow / ≥3h crimson (:1915-1921);
//   · bank/area narrowing — the legacy saved these per user server-side; the URL carries them
//     here so a bookmark keeps a desk's view. An area can be chosen with no bank (the legacy
//     header filter row), a bank change drops the areas it orphaned, and the board is read WHOLE —
//     every open row the filters match, past the hundred one page holds (`lib/board-filters.ts`,
//     `lib/whole-board.ts`, port doc D8) — and one reset clears them;
//   · every column sorts, in the browser — the board is whole (`lib/useBoardView.ts`);
//   · only the bank, the code, the name and the schedule take a text selection, so a drag or
//     Ctrl+A copies exactly those (`lib/board-copy.ts`);
//   · row actions: close, edit (schedule/open time/leader, the shift cascade behind the «الوردية»
//     box), delete. The legacy's bulk actions (:1016-1078) have no bar of their own (2026-10-27):
//     a button on a CHECKED row acts on every checked row (`actionTargets`). The head's «select
//     all» appears on F8 only (`lib/select-all-reveal.ts`);
//   · the table leaves as Excel and PDF — «بيان تغذية ماكينات الصراف الآلي عن يوم …»
//     (`components/StatementExportButtons.tsx`).
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AtmReplenishmentDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { useTableSelection } from '../../../shared/ui/useTableSelection';
import { Button } from '../../../shared/ui/Button';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { PINNED_ACTIONS, RowActions } from '../../../shared/ui/RowActions';
import { EditIcon, LockIcon, TrashIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { hasError } from '../../../shared/lib/errors';
import {
  useAtmReplenishmentFacets,
  useCloseAtmReplenishments,
  useDeleteAtmReplenishments,
  useOpenAtmReplenishmentsList,
} from '../api/atm-queries';
import { actionTargets, cairoToday } from '../lib/operation-view';
import { COPY_COLUMN_CLASS, COPY_TABLE_CLASS, useSelectBoardText } from '../lib/board-copy';
import { useSelectAllReveal } from '../lib/select-all-reveal';
import { useBoardView } from '../lib/useBoardView';
import { replenishmentColumns, statementFilterLine } from '../lib/operation-sheet';
import { LiveTimerCell, useNowTick } from '../components/LiveTimer';
import { OpenReplenishmentsForm } from '../components/OpenReplenishmentsForm';
import { ConfirmActionDialog, EditReplenishmentDialog } from '../components/ReplenishmentDialogs';
import { BoardDayToggle } from '../components/BoardDayToggle';
import { BoardResetButton } from '../components/BoardResetButton';
import { StatementExportButtons } from '../components/StatementExportButtons';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useBoardFilters } from '../lib/useBoardFilters';

/**
 * Remembered across visits: this screen's filters and order. `page` is derived, never kept — and
 * nor is the day view: the board opens on today, as asked.
 */
const REMEMBERED_FILTERS = ['areas', 'banks', 'sort'] as const;

export const ReplenishmentsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const filters = useBoardFilters([sp, setSp], useAtmReplenishmentFacets);
  const list = useOpenAtmReplenishmentsList(filters, !filters.settling);

  const now = useNowTick();
  const rows = list.data?.items ?? [];
  const sheetColumns = replenishmentColumns(t, locale, 'open');
  const board = useBoardView([sp, setSp], rows, sheetColumns, now);

  // Selection is over the rows of the view on screen — another day's rows are another table.
  const selection = useTableSelection(board.rows.map((row) => row.id));

  const close = useCloseAtmReplenishments();
  const remove = useDeleteAtmReplenishments();

  const [closing, setClosing] = useState<AtmReplenishmentDto[] | null>(null);
  const [deleting, setDeleting] = useState<AtmReplenishmentDto[] | null>(null);
  const [editing, setEditing] = useState<AtmReplenishmentDto[] | null>(null);
  const dialogUp = closing !== null || deleting !== null || editing !== null;
  const selectAllShown = useSelectAllReveal(!dialogUp);
  const tableRef = useRef<HTMLDivElement>(null);
  useSelectBoardText(tableRef, !dialogUp);

  const boardReady = !list.isLoading && !filters.settling && !hasError(list.error);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selectedRows = selection.ids
    .map((id) => byId.get(id))
    .filter((row): row is AtmReplenishmentDto => row !== undefined);

  const confirmClose = async (): Promise<void> => {
    if (closing === null) return;
    try {
      await close.mutateAsync(closing.map((row) => row.id));
      toast.success(t('atm.replenishments.closed'));
      selection.clear();
      setClosing(null);
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await remove.mutateAsync(deleting.map((row) => row.id));
      toast.success(t('atm.common.deleted'));
      selection.clear();
      setDeleting(null);
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  // The table is the sheet's columns, in its order, with the live timer after the open time on
  // today's view and the row's buttons at the end.
  const textColumns: Column<AtmReplenishmentDto>[] = sheetColumns.map((column) => ({
    key: column.key,
    header: column.header,
    sortable: true,
    render: (row) => column.text(row, '—'),
    ...(column.copy === true ? { className: COPY_COLUMN_CLASS } : {}),
  }));
  const timerColumn: Column<AtmReplenishmentDto> = {
    key: 'timer',
    header: t('atm.common.takenTime'),
    render: (row) => <LiveTimerCell openedAt={row.openedAt} now={now} />,
  };
  const afterOpened = textColumns.findIndex((column) => column.key === 'opened') + 1;

  // Every view: close, edit, delete.
  // A checked row's buttons act on every checked row (`actionTargets`), and say so.
  const rowTitle = (
    row: { id: string },
    one: 'close' | 'edit' | 'delete',
    all: 'closeSelected' | 'editSelected' | 'deleteSelected',
  ): string =>
    selectedRows.length > 1 && selection.selectedIds.has(row.id)
      ? `atm.common.${all}`
      : `atm.common.${one}`;

  const actionsColumn: Column<AtmReplenishmentDto> = {
    key: 'actions',
    header: '',
    align: 'end',
    // Pinned to the row's end: on a laptop the board is wider than the screen, and the buttons
    // must stay in view without a sideways scroll.
    className: PINNED_ACTIONS.cell,
    headerClassName: PINNED_ACTIONS.head,
    render: (row) => (
      // Always painted: the row's buttons are the board's work, not a secondary action.
      <RowActions always>
        {can('atmReplenishment.complete') && (
          <Button
            size="icon"
            variant="ghost-brand"
            title={t(rowTitle(row, 'close', 'closeSelected'))}
            onClick={() => setClosing(actionTargets(row, selectedRows))}
          >
            <LockIcon className="h-4 w-4" />
          </Button>
        )}
        {can('atmReplenishment.edit') && (
          <Button
            size="icon"
            variant="ghost"
            title={t(rowTitle(row, 'edit', 'editSelected'))}
            onClick={() => setEditing(actionTargets(row, selectedRows))}
          >
            <EditIcon className="h-4 w-4" />
          </Button>
        )}
        {can('atmReplenishment.delete') && (
          <Button
            size="icon"
            variant="ghost-danger"
            title={t(rowTitle(row, 'delete', 'deleteSelected'))}
            onClick={() => setDeleting(actionTargets(row, selectedRows))}
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        )}
      </RowActions>
    ),
  };

  const columns: Column<AtmReplenishmentDto>[] = [
    ...textColumns.slice(0, afterOpened),
    ...(board.view === 'today' ? [timerColumn] : []),
    ...textColumns.slice(afterOpened),
    actionsColumn,
  ];

  return (
    <PageContainer fullHeight>
      {/* The board frame (`shared/ui/board-scroll.ts`, 2026-10-27 «تثبت الفورم والفلتر وتخلي الجدول
          بس هو اللى يعمل Scroll»): on a computer the title, the form, the filters and the day switch
          keep their place, and only the table's rows scroll, under a head that stays. */}
      <div className={BOARD_FRAME}>
        <PageHeader title={t('atm.replenishments.title')} />

        {/* Entry and narrowing share ONE row: the form runs from the start of it, the filters sit
          at the far end — the LEFT in Arabic, and mirrored in English, because `ms-auto` follows
          the writing direction rather than picking a physical side. */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          {can('atmReplenishment.create') && <OpenReplenishmentsForm defaultDate={cairoToday()} />}

          <div className="ms-auto flex flex-wrap items-end gap-2">
            <MultiSelect
              label={t('atm.common.bank')}
              options={filters.bankOptions}
              value={filters.banks}
              onChange={filters.setBanks}
            />
            <MultiSelect
              label={t('atm.common.area')}
              options={filters.areaOptions}
              value={filters.areas}
              onChange={filters.setAreas}
              searching={filters.areasLoading}
            />
            <BoardResetButton active={filters.filtered} onReset={filters.reset} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <BoardDayToggle value={board.view} counts={board.counts} onChange={board.setView} />
          {/* Only once the rows on screen ARE the answer — a statement made while the board loads,
            fails or settles a bank change would print «nothing» as if it were the truth. */}
          {boardReady && (
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <StatementExportButtons
                kind="replenishment"
                name="atm-replenishments"
                sheetName={t('atm.replenishments.title')}
                range={board.range}
                rows={board.rows}
                columns={sheetColumns}
                filterLine={statementFilterLine(t, locale, filters)}
              />
            </div>
          )}
        </div>

        {/* Unselectable as a whole; the copy columns take a selection back (`lib/board-copy.ts`). An
          earlier day's rows keep the legacy grey of the «other days» group. */}
        <div
          ref={tableRef}
          className={cn(
            COPY_TABLE_CLASS,
            BOARD_TABLE_FILL,
            board.view === 'earlier' && 'opacity-75',
          )}
          data-board-view={board.view}
        >
          <DataTable
            columns={columns}
            rows={board.rows}
            rowKey={(row) => row.id}
            loading={list.isLoading || filters.settling}
            error={list.error}
            onRetry={() => void list.refetch()}
            empty={
              rows.length === 0 && filters.filtered
                ? t('atm.common.emptyFiltered')
                : t(`atm.replenishments.empty.${board.view}`)
            }
            selection={selection}
            selectAll={selectAllShown}
            sort={board.sorts}
            onSortChange={board.changeSort}
            stickyHead
          />
        </div>
      </div>

      <ConfirmActionDialog
        open={closing !== null}
        title={t('atm.replenishments.closeTitle')}
        body={t('atm.replenishments.closeBody', { count: closing?.length ?? 0 })}
        confirmLabel={t('atm.common.close')}
        busy={close.isPending}
        onConfirm={() => void confirmClose()}
        onClose={() => setClosing(null)}
      />
      <ConfirmActionDialog
        open={deleting !== null}
        title={t('atm.common.deleteTitle')}
        body={t('atm.common.deleteBody', { count: deleting?.length ?? 0 })}
        confirmLabel={t('atm.common.delete')}
        danger
        busy={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
      <EditReplenishmentDialog
        open={editing !== null}
        rows={editing ?? []}
        onClose={() => {
          setEditing(null);
          selection.clear();
        }}
      />
    </PageContainer>
  );
};
