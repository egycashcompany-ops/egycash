// التمامات (FW-5, legacy /fleet_attendance): the fleet's operational unavailability overlay —
// official leave stays in HR and is consulted by the availability seam server-side. URL-synced
// covers-date filter + pagination + sortable date columns; record picks the driver through the
// directory; edit/cancel are version-aware and behind `fleetAvailability.edit`.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetDriverUnavailabilityDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatDate } from '../../../shared/lib/format';
import { useCancelUnavailability, useUnavailability } from '../api/fleet-queries';
import { EmployeeName } from '../components/EmployeeName';
import { UnavailabilityDialog } from '../components/UnavailabilityDialog';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

export const AttendancePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const coversDate = sp.get('date') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'from:desc').split(':');
  const sort = { by: sortByRaw ?? 'from', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
    by: string;
    dir: 'asc' | 'desc';
  };
  const paramsKey = sp.toString();

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      coversDate: coversDate || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useUnavailability(params);
  const rows = data?.items ?? [];

  const [recordOpen, setRecordOpen] = useState(false);
  const [editing, setEditing] = useState<FleetDriverUnavailabilityDto | null>(null);
  const [cancelling, setCancelling] = useState<FleetDriverUnavailabilityDto | null>(null);
  const cancel = useCancelUnavailability();

  const confirmCancel = async (): Promise<void> => {
    if (cancelling === null) return;
    await cancel.mutateAsync(cancelling.id);
    toast.success(t('fleet.attendance.cancelled'));
    setCancelling(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetDriverUnavailabilityDto>[] = [
    {
      key: 'driver',
      header: t('fleet.attendance.fields.driver'),
      render: (r) => <EmployeeName employeeId={r.employeeId} />,
    },
    {
      key: 'from',
      header: t('fleet.attendance.fields.from'),
      sortable: true,
      render: (r) => <span className="tabular-nums">{formatDate(r.from, locale)}</span>,
    },
    {
      key: 'to',
      header: t('fleet.attendance.fields.to'),
      sortable: true,
      render: (r) => <span className="tabular-nums">{formatDate(r.to, locale)}</span>,
    },
    { key: 'reason', header: t('fleet.attendance.fields.reason'), render: (r) => r.reason },
    {
      key: 'notes',
      header: t('fleet.attendance.fields.notes'),
      render: (r) => r.notes ?? '—',
    },
    ...(can('fleetAvailability.edit')
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (r: FleetDriverUnavailabilityDto) => (
              <span className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  className={actionButton}
                  aria-label={t('fleet.attendance.edit')}
                  title={t('fleet.attendance.edit')}
                  onClick={() => setEditing(r)}
                >
                  <EditIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={actionButton}
                  aria-label={t('fleet.attendance.cancel')}
                  title={t('fleet.attendance.cancel')}
                  onClick={() => setCancelling(r)}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </span>
            ),
          } satisfies Column<FleetDriverUnavailabilityDto>,
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.attendance')}
        description={t('fleet.attendance.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.attendance') },
        ]}
        actions={
          <Can permission="fleetAvailability.record">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setRecordOpen(true)}
            >
              {t('fleet.attendance.record')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar hasActiveFilters={coversDate !== ''} onClear={() => patch({ date: null })}>
          <Field label={t('fleet.attendance.coversDate')} htmlFor="attendance-covers-date">
            <Input
              id="attendance-covers-date"
              type="date"
              value={coversDate}
              onChange={(e) => patch({ date: e.target.value || null })}
              className="w-auto"
            />
          </Field>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <UnavailabilityDialog open={recordOpen} onClose={() => setRecordOpen(false)} record={null} />
      <UnavailabilityDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        record={editing}
      />
      <Dialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={t('fleet.attendance.cancelTitle')}
        description={cancelling?.reason ?? ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() => void confirmCancel()}
            >
              {t('fleet.attendance.cancel')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.attendance.cancelBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
