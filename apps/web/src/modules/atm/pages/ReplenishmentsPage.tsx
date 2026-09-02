// /atm/replenishments — the legacy /atm_replenishment page (atm_replenishment.ejs), by parity:
//
//   · the multi-row open form: machine codes one per line, schedule times aligned BY LINE, one
//     force date for the batch (:558-580);
//   · the open grid in TWO groups — today's rows (white, live timer, close control) and open rows
//     of other days (grey, no timer, no close — :1013 / :1086);
//   · the timer counts from open and paints ≥1h green / ≥2h yellow / ≥3h crimson (:1915-1921);
//   · bank/area narrowing — the legacy saved these per user server-side; the URL carries them
//     here so a bookmark keeps a desk's view (port doc §7.4);
//   · row actions: close, edit (schedule/open time/leader with the shift cascade), delete; the
//     checkbox column drives the same actions in bulk (:1016-1078).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE, type AtmReplenishmentDto } from '@ecms/contracts';
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
import { cairoToday, isOpenedToday } from '../lib/operation-view';
import { LiveTimerCell, useNowTick } from '../components/LiveTimer';
import { OpenReplenishmentsForm } from '../components/OpenReplenishmentsForm';
import { ConfirmActionDialog, EditReplenishmentDialog } from '../components/ReplenishmentDialogs';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

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

  const banks = useMemo(() => (sp.get('banks') ?? '').split(',').filter(Boolean), [sp]);
  const areas = useMemo(() => (sp.get('areas') ?? '').split(',').filter(Boolean), [sp]);

  const setFilter = (key: 'banks' | 'areas', values: string[]): void => {
    const next = new URLSearchParams(sp);
    if (values.length === 0) next.delete(key);
    else next.set(key, values.join(','));
    setSp(next);
  };

  const listParams = useMemo(
    () => ({
      pageSize: MAX_PAGE_SIZE,
      ...(banks.length > 0 ? { banks: banks.join(',') } : {}),
      ...(areas.length > 0 ? { areas: areas.join(',') } : {}),
    }),
    [banks, areas],
  );
  const list = useOpenAtmReplenishmentsList(listParams);
  const facets = useAtmReplenishmentFacets(banks);

  const now = useNowTick();
  const rows = list.data?.items ?? [];
  const todayRows = rows.filter((row) => isOpenedToday(row.openedAt, now));
  const otherRows = rows.filter((row) => !isOpenedToday(row.openedAt, now));

  // Selection spans BOTH groups' visible rows — checked carried-over rows can be edited/deleted
  // in bulk, exactly as legacy checkboxes allowed; close still applies to open rows only.
  const selection = useTableSelection(todayRows.map((row) => row.id));

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

  const todayColumns: Column<AtmReplenishmentDto>[] = [
    ...baseColumns,
    {
      key: 'timer',
      header: t('atm.common.takenTime'),
      render: (row) => <LiveTimerCell openedAt={row.openedAt} now={now} />,
    },
    { key: 'leader', header: t('atm.common.leader'), render: (row) => row.leaderName ?? '—' },
    { key: 'addedBy', header: t('atm.common.addedBy'), render: (row) => row.openedByName ?? '—' },
    {
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
    },
  ];

  // Carried-over rows: no timer, no close — the legacy grey group (:1086-1135) kept edit/delete.
  const carriedColumns: Column<AtmReplenishmentDto>[] = [
    ...baseColumns,
    { key: 'leader', header: t('atm.common.leader'), render: (row) => row.leaderName ?? '—' },
    { key: 'addedBy', header: t('atm.common.addedBy'), render: (row) => row.openedByName ?? '—' },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) => (
        <RowActions>
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
    },
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
            options={(facets.data?.banks ?? []).map((b) => ({ value: b, label: b }))}
            value={banks}
            onChange={(next) => setFilter('banks', next)}
          />
          <MultiSelect
            label={t('atm.common.area')}
            options={(facets.data?.areas ?? []).map((a) => ({ value: a, label: a }))}
            value={areas}
            onChange={(next) => setFilter('areas', next)}
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
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={t('atm.replenishments.emptyToday')}
        selection={selection}
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
