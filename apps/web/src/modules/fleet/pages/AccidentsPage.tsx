// Accidents (FW-8, legacy car_accidents): the §4.6 file registry over FL-6. Amounts are shown
// exactly as stored — no derived money exists until §13-Q9 defines the formula, so the page
// sums nothing. The open/closed state is purely the backend's: flipping is one version-aware
// call in either direction (FR-10, one grant covers both), a no-op flip is refused server-side,
// and the UI simply offers the ONE direction the current state allows. URL-synced vehicle/
// status/date-range filters + sortable occurredAt + pagination, per the module idiom.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE, type FleetAccidentDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Field, Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { CheckIcon, CornerDownIcon, EditIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatDate, formatMoney } from '../../../shared/lib/format';
import {
  useAccidents,
  useDeleteAccident,
  useSetAccidentStatus,
  useVehicles,
} from '../api/fleet-queries';
import { VehicleSelect } from '../components/VehicleSelect';
import { AccidentFormDialog } from '../components/AccidentFormDialog';

const DEFAULT_PAGE_SIZE = 25;

export const AccidentsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const vehicle = sp.get('vehicle') ?? '';
  const status = sp.get('status') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'occurredAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'occurredAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
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
      vehicleId: vehicle || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useAccidents(params);
  const rows = data?.items ?? [];

  // Unfiltered registry map so files of retired vehicles still resolve to their codes.
  const vehiclesQuery = useVehicles({ pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' });
  const codeOf = (vehicleId: string): string =>
    vehiclesQuery.data?.items.find((v) => v.id === vehicleId)?.code ?? vehicleId.slice(-8);

  const [recordOpen, setRecordOpen] = useState(false);
  const [editing, setEditing] = useState<FleetAccidentDto | null>(null);
  const [flipping, setFlipping] = useState<FleetAccidentDto | null>(null);
  const [deleting, setDeleting] = useState<FleetAccidentDto | null>(null);
  const setStatus = useSetAccidentStatus();
  const remove = useDeleteAccident();

  const confirmFlip = async (): Promise<void> => {
    if (flipping === null) return;
    const next = flipping.status === 'open' ? 'closed' : 'open';
    await setStatus.mutateAsync({
      id: flipping.id,
      body: { status: next, version: flipping.version },
    });
    toast.success(t(next === 'closed' ? 'fleet.accidents.closed' : 'fleet.accidents.reopened'));
    setFlipping(null);
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.accidents.deleted'));
    setDeleting(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const money = (amount: number): JSX.Element => (
    <span className="tabular-nums" dir="ltr">
      {formatMoney(amount, 'EGP', locale)}
    </span>
  );

  const columns: Column<FleetAccidentDto>[] = [
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      render: (r) => (
        <span className="font-mono text-xs" dir="ltr">
          {codeOf(r.vehicleId)}
        </span>
      ),
    },
    {
      key: 'occurredAt',
      header: t('fleet.accidents.fields.occurredAt'),
      sortable: true,
      render: (r) => <span className="tabular-nums">{formatDate(r.occurredAt, locale)}</span>,
    },
    {
      key: 'status',
      header: t('fleet.vehicles.columns.status'),
      render: (r) => (
        <StatusBadge
          tone={r.status === 'open' ? 'warning' : 'success'}
          label={t(`fleet.accidents.status.${r.status}`)}
        />
      ),
    },
    { key: 'culprit', header: t('fleet.accidents.fields.culprit'), render: (r) => r.culprit },
    {
      key: 'statement',
      header: t('fleet.accidents.fields.statement'),
      render: (r) => <span className="block max-w-[18rem] truncate">{r.statement}</span>,
    },
    {
      key: 'companyCost',
      header: t('fleet.accidents.fields.companyCost'),
      align: 'end',
      render: (r) => money(r.companyCost),
    },
    {
      key: 'amountCollected',
      header: t('fleet.accidents.fields.amountCollected'),
      align: 'end',
      render: (r) => money(r.amountCollected),
    },
    {
      key: 'paidAmount',
      header: t('fleet.accidents.fields.paidAmount'),
      align: 'end',
      render: (r) => money(r.paidAmount),
    },
    ...(can('fleetAccident.edit') || can('fleetAccident.close') || can('fleetAccident.delete')
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (r: FleetAccidentDto) => (
              <span className="flex items-center justify-end gap-1">
                {can('fleetAccident.edit') && (
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('fleet.accidents.edit')}
                    title={t('fleet.accidents.edit')}
                    onClick={() => setEditing(r)}
                  >
                    <EditIcon className="h-4 w-4" />
                  </button>
                )}
                {can('fleetAccident.close') &&
                  (r.status === 'open' ? (
                    <button
                      type="button"
                      className={actionButton}
                      aria-label={t('fleet.accidents.close')}
                      title={t('fleet.accidents.close')}
                      onClick={() => setFlipping(r)}
                    >
                      <CheckIcon className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={actionButton}
                      aria-label={t('fleet.accidents.reopen')}
                      title={t('fleet.accidents.reopen')}
                      onClick={() => setFlipping(r)}
                    >
                      <CornerDownIcon className="h-4 w-4" />
                    </button>
                  ))}
                {can('fleetAccident.delete') && (
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('fleet.accidents.delete')}
                    title={t('fleet.accidents.delete')}
                    onClick={() => setDeleting(r)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </span>
            ),
          } satisfies Column<FleetAccidentDto>,
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.accidents')}
        description={t('fleet.accidents.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.accidents') },
        ]}
        actions={
          <Can permission="fleetAccident.create">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setRecordOpen(true)}
            >
              {t('fleet.accidents.record')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={vehicle !== '' || status !== '' || from !== '' || to !== ''}
          onClear={() => patch({ vehicle: null, status: null, from: null, to: null })}
        >
          <VehicleSelect
            value={vehicle}
            onChange={(id) => patch({ vehicle: id || null })}
            allLabel={t('fleet.odometer.allVehicles')}
            anyStatus
            ariaLabel={t('fleet.odometer.columns.vehicle')}
          />
          <Select
            aria-label={t('fleet.vehicles.columns.status')}
            value={status}
            onChange={(e) => patch({ status: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.accidents.allStatuses')}</option>
            <option value="open">{t('fleet.accidents.status.open')}</option>
            <option value="closed">{t('fleet.accidents.status.closed')}</option>
          </Select>
          <Field label={t('fleet.odometer.from')} htmlFor="accidents-from">
            <Input
              id="accidents-from"
              type="date"
              value={from}
              onChange={(e) => patch({ from: e.target.value || null })}
              className="w-auto"
            />
          </Field>
          <Field label={t('fleet.odometer.to')} htmlFor="accidents-to">
            <Input
              id="accidents-to"
              type="date"
              value={to}
              onChange={(e) => patch({ to: e.target.value || null })}
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

      <AccidentFormDialog
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        accident={null}
        initialVehicleId={vehicle}
      />
      <AccidentFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        accident={editing}
      />
      <Dialog
        open={flipping !== null}
        onClose={() => setFlipping(null)}
        title={
          flipping?.status === 'open'
            ? t('fleet.accidents.closeTitle', { code: codeOf(flipping.vehicleId) })
            : t('fleet.accidents.reopenTitle', {
                code: flipping === null ? '' : codeOf(flipping.vehicleId),
              })
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setFlipping(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={setStatus.isPending} onClick={() => void confirmFlip()}>
              {flipping?.status === 'open'
                ? t('fleet.accidents.close')
                : t('fleet.accidents.reopen')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {flipping?.status === 'open'
            ? t('fleet.accidents.closeBody')
            : t('fleet.accidents.reopenBody')}
        </p>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.accidents.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              {t('fleet.accidents.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.accidents.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
