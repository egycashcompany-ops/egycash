// /atm/replenishments — the legacy /atm_replenishment page (atm_replenishment.ejs), by parity:
//
//   · the multi-row open form: machine codes one per line, schedule times aligned BY LINE, one
//     force date for the batch (:558-580);
//   · the open grid in TWO groups — today's rows (white, live timer) and open rows of other days
//     (grey, no timer — :1013 / :1086). The legacy grey group had no close and no checkbox; both
//     groups have them here, because an open row of ANY day blocks its machine under the owner's
//     rule (port doc OD-1) and must be closable where it is shown (D4);
//   · the timer counts from open and paints ≥1h green / ≥2h yellow / ≥3h crimson (:1915-1921);
//   · bank/area narrowing — the legacy saved these per user server-side; the URL carries them
//     here so a bookmark keeps a desk's view. An area can be chosen with no bank (the legacy
//     header filter row), a bank change drops the areas it orphaned, and the board is read WHOLE —
//     every open row the filters match, past the hundred one page holds (`lib/board-filters.ts`,
//     `lib/whole-board.ts`, port doc D8);
//   · row actions: close, edit (schedule/open time/leader with the shift cascade), delete; the
//     checkbox column drives the same actions in bulk (:1016-1078), over both groups.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AtmReplenishmentDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { useTableSelection } from '../../../shared/ui/useTableSelection';
import { BulkActionBar } from '../../../shared/ui/BulkActionBar';
import { Button } from '../../../shared/ui/Button';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { RowActions } from '../../../shared/ui/RowActions';
import { EditIcon, LockIcon, TrashIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDateTime } from '../../../shared/lib/format';
import {
  useAtmReplenishmentFacets,
  useCloseAtmReplenishments,
  useDeleteAtmReplenishments,
  useOpenAtmReplenishmentsList,
} from '../api/atm-queries';
import { cairoToday, groupSelection, isOpenedToday } from '../lib/operation-view';
import { LiveTimerCell, useNowTick } from '../components/LiveTimer';
import { OpenReplenishmentsForm } from '../components/OpenReplenishmentsForm';
import { ConfirmActionDialog, EditReplenishmentDialog } from '../components/ReplenishmentDialogs';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useBoardFilters } from '../lib/useBoardFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'areas',
  'banks',
] as const;

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
  const todayRows = rows.filter((row) => isOpenedToday(row.openedAt, now));
  const otherRows = rows.filter((row) => !isOpenedToday(row.openedAt, now));

  // Selection spans BOTH groups' visible rows: a carried-over row blocks its machine like any open
  // row (OD-1), so it can be checked and closed, edited or deleted in bulk with today's.
  const todayIds = todayRows.map((row) => row.id);
  const otherIds = otherRows.map((row) => row.id);
  const selection = useTableSelection([...todayIds, ...otherIds]);

  const close = useCloseAtmReplenishments();
  const remove = useDeleteAtmReplenishments();

  const [closing, setClosing] = useState<AtmReplenishmentDto[] | null>(null);
  const [deleting, setDeleting] = useState<AtmReplenishmentDto[] | null>(null);
  const [editing, setEditing] = useState<AtmReplenishmentDto[] | null>(null);

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

  const baseColumns: Column<AtmReplenishmentDto>[] = [
    { key: 'bank', header: t('atm.common.bank'), render: (row) => row.bankName },
    { key: 'code', header: t('atm.common.machineId'), render: (row) => row.machineCode },
    { key: 'name', header: t('atm.common.machineName'), render: (row) => row.machineName },
    {
      key: 'schedule',
      header: t('atm.replenishments.scheduleTime'),
      render: (row) => row.scheduleTime ?? '—',
    },
    { key: 'area', header: t('atm.common.area'), render: (row) => row.area },
    {
      key: 'opened',
      header: t('atm.common.openTime'),
      render: (row) => formatDateTime(row.openedAt, locale),
    },
  ];

  // Both groups: close, edit, delete.
  const actionsColumn: Column<AtmReplenishmentDto> = {
    key: 'actions',
    header: '',
    align: 'end',
    render: (row) => (
      <RowActions>
        {can('atmReplenishment.complete') && (
          <Button
            size="icon"
            variant="ghost-brand"
            title={t('atm.common.close')}
            onClick={() => setClosing([row])}
          >
            <LockIcon className="h-4 w-4" />
          </Button>
        )}
        {can('atmReplenishment.edit') && (
          <Button
            size="icon"
            variant="ghost"
            title={t('atm.common.edit')}
            onClick={() => setEditing([row])}
          >
            <EditIcon className="h-4 w-4" />
          </Button>
        )}
        {can('atmReplenishment.delete') && (
          <Button
            size="icon"
            variant="ghost-danger"
            title={t('atm.common.delete')}
            onClick={() => setDeleting([row])}
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        )}
      </RowActions>
    ),
  };

  const todayColumns: Column<AtmReplenishmentDto>[] = [
    ...baseColumns,
    {
      key: 'timer',
      header: t('atm.common.takenTime'),
      render: (row) => <LiveTimerCell openedAt={row.openedAt} now={now} />,
    },
    { key: 'leader', header: t('atm.common.leader'), render: (row) => row.leaderName ?? '—' },
    { key: 'addedBy', header: t('atm.common.addedBy'), render: (row) => row.openedByName ?? '—' },
    actionsColumn,
  ];

  // Carried-over rows: no timer — the legacy grey group (:1086-1135). Its close is new (OD-1, D4).
  const carriedColumns: Column<AtmReplenishmentDto>[] = [
    ...baseColumns,
    { key: 'leader', header: t('atm.common.leader'), render: (row) => row.leaderName ?? '—' },
    { key: 'addedBy', header: t('atm.common.addedBy'), render: (row) => row.openedByName ?? '—' },
    actionsColumn,
  ];

  return (
    <PageContainer>
      <PageHeader title={t('atm.replenishments.title')} />

      {/* Entry and narrowing share ONE row: the form runs from the start of it, the filters sit
          at the far end — the LEFT in Arabic, and mirrored in English, because `ms-auto` follows
          the writing direction rather than picking a physical side. */}
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
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
        </div>
      </div>

      <BulkActionBar count={selection.count} onClear={selection.clear}>
        {can('atmReplenishment.complete') && (
          <Button variant="secondary" onClick={() => setClosing(selectedRows)}>
            {t('atm.common.closeSelected')}
          </Button>
        )}
        {can('atmReplenishment.edit') && (
          <Button variant="secondary" onClick={() => setEditing(selectedRows)}>
            {t('atm.common.editSelected')}
          </Button>
        )}
        {can('atmReplenishment.delete') && (
          <Button variant="danger" onClick={() => setDeleting(selectedRows)}>
            {t('atm.common.deleteSelected')}
          </Button>
        )}
      </BulkActionBar>

      <h2 className="mb-2 mt-4 text-sm font-semibold text-slate-600 dark:text-slate-300">
        {t('atm.replenishments.todayGroup')}
      </h2>
      <DataTable
        columns={todayColumns}
        rows={todayRows}
        rowKey={(row) => row.id}
        loading={list.isLoading || filters.settling}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={
          rows.length === 0 && filters.filtered
            ? t('atm.common.emptyFiltered')
            : t('atm.replenishments.emptyToday')
        }
        selection={groupSelection(selection, todayIds)}
      />

      {otherRows.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-500 dark:text-slate-400">
            {t('atm.replenishments.carriedGroup')}
          </h2>
          <div className="opacity-75">
            <DataTable
              columns={carriedColumns}
              rows={otherRows}
              rowKey={(row) => row.id}
              empty={t('atm.replenishments.emptyToday')}
              selection={groupSelection(selection, otherIds)}
            />
          </div>
        </>
      )}

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
