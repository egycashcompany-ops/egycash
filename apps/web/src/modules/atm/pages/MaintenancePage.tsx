// /atm/maintenance — the legacy /atm_maintenance page (atm_maintenance.ejs) by parity. The same
// board as replenishments, with the maintenance-only facts: service type, notes, reference number,
// and a CLOSE that requires assigning an employee (the modal). Rows can also arrive from an
// accepted mail ticket — the badge names that source. As on replenishments (2026-10-27): one day
// at a time, today's by default, with a switch to tomorrow, everything scheduled ahead or the
// earlier days left open (an earlier day's row keeps its close control and checkbox, D4); every
// column sorts; only the bank, the code, the name and the open time — when it is due — take a
// text selection; the head's «select all» appears on F8 only, and there is no bulk bar — a button
// on a checked row acts on every checked row (`actionTargets`); the leader edit carries the
// «الوردية» box; and the table leaves as Excel and PDF, «بيان صيانة ماكينات الصراف الآلي عن يوم …».
// The bank/area filters work the same way — an area on its own, a bank change dropping the areas
// it orphaned, every matching row read whole past one page (port doc D8) — and one reset clears
// them.
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AtmMaintenanceDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { useTableSelection } from '../../../shared/ui/useTableSelection';
import { Button } from '../../../shared/ui/Button';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { RowActions } from '../../../shared/ui/RowActions';
import { StatusBadge } from '../../../shared/ui/Badge';
import { EditIcon, LockIcon, TrashIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { hasError } from '../../../shared/lib/errors';
import {
  useAtmMaintenanceFacets,
  useDeleteAtmMaintenances,
  useOpenAtmMaintenancesList,
} from '../api/atm-queries';
import { COPY_COLUMN_CLASS, COPY_TABLE_CLASS, useSelectBoardText } from '../lib/board-copy';
import { useSelectAllReveal } from '../lib/select-all-reveal';
import { useBoardView } from '../lib/useBoardView';
import { maintenanceColumns, statementFilterLine } from '../lib/operation-sheet';
import { actionTargets } from '../lib/operation-view';
import { LiveTimerCell, useNowTick } from '../components/LiveTimer';
import { OpenMaintenancesForm } from '../components/OpenMaintenancesForm';
import { ConfirmActionDialog } from '../components/ReplenishmentDialogs';
import { CloseMaintenanceDialog, EditMaintenanceDialog } from '../components/MaintenanceDialogs';
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

export const MaintenancePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const filters = useBoardFilters([sp, setSp], useAtmMaintenanceFacets);
  const list = useOpenAtmMaintenancesList(filters, !filters.settling);

  const now = useNowTick();
  const rows = list.data?.items ?? [];
  const sheetColumns = maintenanceColumns(t, locale, 'open');
  const board = useBoardView([sp, setSp], rows, sheetColumns, now);

  // Selection is over the rows of the view on screen — another day's rows are another table.
  const selection = useTableSelection(board.rows.map((row) => row.id));
  const remove = useDeleteAtmMaintenances();

  const [closing, setClosing] = useState<AtmMaintenanceDto[] | null>(null);
  const [deleting, setDeleting] = useState<AtmMaintenanceDto[] | null>(null);
  const [editing, setEditing] = useState<AtmMaintenanceDto[] | null>(null);
  const dialogUp = closing !== null || deleting !== null || editing !== null;
  const selectAllShown = useSelectAllReveal(!dialogUp);
  const tableRef = useRef<HTMLDivElement>(null);
  useSelectBoardText(tableRef, !dialogUp);

  const boardReady = !list.isLoading && !filters.settling && !hasError(list.error);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selectedRows = selection.ids
    .map((id) => byId.get(id))
    .filter((row): row is AtmMaintenanceDto => row !== undefined);

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

  // The table is the sheet's columns, in its order — the service with its «mail» badge — with the
  // live timer after the open time on today's view and the row's buttons at the end.
  const textColumns: Column<AtmMaintenanceDto>[] = sheetColumns.map((column) => ({
    key: column.key,
    header: column.header,
    sortable: true,
    render:
      column.key === 'service'
        ? (row: AtmMaintenanceDto) => (
            <span className="inline-flex items-center gap-1.5">
              {column.text(row, '—')}
              {row.source === 'mail' && (
                <StatusBadge tone="info" label={t('atm.maintenance.fromMail')} />
              )}
            </span>
          )
        : (row: AtmMaintenanceDto) => column.text(row, '—'),
    ...(column.copy === true ? { className: COPY_COLUMN_CLASS } : {}),
  }));
  const timerColumn: Column<AtmMaintenanceDto> = {
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

  const actionsColumn: Column<AtmMaintenanceDto> = {
    key: 'actions',
    header: '',
    align: 'end',
    render: (row) => (
      // Always painted: the row's buttons are the board's work, not a secondary action.
      <RowActions always>
        {can('atmMaintenance.complete') && (
          <Button
            size="icon"
            variant="ghost-brand"
            title={t(rowTitle(row, 'close', 'closeSelected'))}
            onClick={() => setClosing(actionTargets(row, selectedRows))}
          >
            <LockIcon className="h-4 w-4" />
          </Button>
        )}
        {can('atmMaintenance.edit') && (
          <Button
            size="icon"
            variant="ghost"
            title={t(rowTitle(row, 'edit', 'editSelected'))}
            onClick={() => setEditing(actionTargets(row, selectedRows))}
          >
            <EditIcon className="h-4 w-4" />
          </Button>
        )}
        {can('atmMaintenance.delete') && (
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

  const columns: Column<AtmMaintenanceDto>[] = [
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
        <PageHeader title={t('atm.maintenance.title')} />

        {/* Entry and narrowing share ONE row: the form runs from the start of it, the filters sit
          at the far end — the LEFT in Arabic, and mirrored in English, because `ms-auto` follows
          the writing direction rather than picking a physical side. */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          {can('atmMaintenance.create') && <OpenMaintenancesForm />}

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
                kind="maintenance"
                name="atm-maintenance"
                sheetName={t('atm.maintenance.title')}
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
                : t(`atm.maintenance.empty.${board.view}`)
            }
            selection={selection}
            selectAll={selectAllShown}
            sort={board.sorts}
            onSortChange={board.changeSort}
            stickyHead
          />
        </div>
      </div>

      <CloseMaintenanceDialog
        open={closing !== null}
        rows={closing ?? []}
        onClose={() => {
          setClosing(null);
          selection.clear();
        }}
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
      <EditMaintenanceDialog
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
