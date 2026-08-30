// Accidents (FW-8, legacy car_accidents): the §4.6 file registry over FL-6.
//
// AMOUNTS. The three money facts are shown exactly as stored, and «إجمالي المتبقي» beside them is
// DERIVED on read — `amountCollected + companyCost − paidAmount`, the contract's own
// `fleetAccidentRemaining`, which is also what the server sums for the strip above the table.
// Nothing about it is stored: no column, no migration, no second copy to fall out of step.
//
// THE FIGURES ARE THE SERVER'S. They describe every accident the filters match, not the page in
// front of the reader, so they come from their own endpoint whose query has no `page` at all —
// summing the rows in hand would produce a number that changed when you turned the page.
//
// OPEN/CLOSED is purely the backend's, and so is the green row: the tint is read from the
// persisted `status` on every render, never from anything the screen remembers, which is why a
// refresh cannot lose it and a failed flip cannot invent it. Flipping is one version-aware call in
// either direction (FR-10, one grant covers both), a no-op flip is refused server-side, and the UI
// offers the ONE direction the current state allows. There is no Status COLUMN: the state is the
// row's colour, the direction of its action, and a word for screen readers — three carriers, none
// of them colour alone.
//
// URL-synced filters (code search + vehicle pick + culprit search + date range + status), sortable
// occurredAt and pagination, per the module idiom.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  fleetAccidentRemaining,
  type FleetAccidentDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { StatStrip, type StatStripItem } from '../../../shared/ui/StatStrip';
import { Field, Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { CheckIcon, CornerDownIcon, EditIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatDate, formatMoney, formatNumber } from '../../../shared/lib/format';
import {
  useAccidentSummary,
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

  const code = sp.get('code') ?? '';
  const vehicle = sp.get('vehicle') ?? '';
  const culprit = sp.get('culprit') ?? '';
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

  /**
   * WHAT THE READER IS LOOKING AT — the filters, and only the filters.
   *
   * `code` and `vehicleId` are two narrowings of the same axis and are sent SEPARATELY on purpose:
   * the server applies both (an AND), so typing part of a code while a vehicle is picked shows
   * their intersection, and a code the registry does not have shows nothing rather than
   * everything. Neither control cancels the other, here or there.
   *
   * This object is also exactly what the totals are asked for, which is the whole reason it is
   * split out from the page: the figures below describe THIS set, and paging cannot reach them.
   */
  const filters = useMemo(
    () => ({
      code: code || undefined,
      vehicleId: vehicle || undefined,
      culprit: culprit || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [paramsKey],
  );
  const params = useMemo(
    () => ({ ...filters, page, pageSize, sortBy: sort.by, sortDir: sort.dir }),
    [filters, page, pageSize, sort.by, sort.dir],
  );
  const { data, isLoading, isError, error, refetch } = useAccidents(params);
  const rows = data?.items ?? [];
  const summary = useAccidentSummary(filters);

  // A serial column counts from the start of the LIST, not of the page: row 26 is row 26 on page
  // two. The table only ever sees one page, so the offset comes from the server's own meta.
  const serialOffset = data === undefined ? 0 : (data.meta.page - 1) * data.meta.pageSize;

  const clearFilters = (): void =>
    // ONE update, all six keys. The code search and the vehicle pick go together — leaving either
    // behind would hand back a "cleared" bar that is still filtering.
    patch({ code: null, vehicle: null, culprit: null, status: null, from: null, to: null });
  const hasFilters =
    code !== '' || vehicle !== '' || culprit !== '' || status !== '' || from !== '' || to !== '';

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

  /**
   * The five figures above the table, straight from the server's own sums.
   *
   * Nothing here reads `rows`. It could not: `rows` is one page, and these describe the whole
   * filtered set — which is also why they are given as absent while the request is in flight
   * rather than as zeros, so the strip shows a skeleton instead of a number that is about to be
   * contradicted.
   */
  const figures = summary.data;
  const asMoney = (value: number): string => formatMoney(value, 'EGP', locale);
  const asCount = (value: number): string => formatNumber(value, locale);
  // `value` is OMITTED, not undefined, while the sums are in flight — `exactOptionalPropertyTypes`
  // draws that distinction and `StatStrip` reads the absence as "hold the space, do not invent a
  // number". A zero here would be a claim, and it would be wrong as often as it was right.
  const figure = (
    key: string,
    figureValue: number | undefined,
    format: (value: number) => string,
  ): StatStripItem => ({
    key,
    label: t(`fleet.accidents.totals.${key}`),
    loading: summary.isPending,
    ...(figureValue === undefined ? {} : { value: format(figureValue) }),
  });
  const totals: StatStripItem[] = [
    // A count of files is not money and keeps the reader's own digits; the four sums are money.
    figure('count', figures?.count, asCount),
    figure('amountCollected', figures?.amountCollected, asMoney),
    figure('companyCost', figures?.companyCost, asMoney),
    figure('paidAmount', figures?.paidAmount, asMoney),
    figure('remaining', figures?.remaining, asMoney),
  ];

  const columns: Column<FleetAccidentDto>[] = [
    {
      key: 'serial',
      header: t('fleet.accidents.columns.serial'),
      render: (r, index) => (
        <span className="tabular-nums text-slate-500 dark:text-slate-400">
          {serialOffset + index + 1}
          {/*
            The row's state, for anyone the colour does not reach. With the Status column gone the
            open/closed fact is carried by the tint and by the direction of the action button —
            and a reader who has neither the colour nor the close grant would be left with
            nothing. This is that third carrier, and it costs no width.
          */}
          <span className="sr-only"> — {t(`fleet.accidents.status.${r.status}`)}</span>
        </span>
      ),
    },
    {
      key: 'vehicle',
      header: t('fleet.vehicles.columns.code'),
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
    { key: 'culprit', header: t('fleet.accidents.fields.culprit'), render: (r) => r.culprit },
    {
      key: 'statement',
      header: t('fleet.accidents.fields.statement'),
      render: (r) => <span className="block max-w-[18rem] truncate">{r.statement}</span>,
    },
    {
      key: 'amountCollected',
      header: t('fleet.accidents.fields.amountCollected'),
      align: 'end',
      render: (r) => money(r.amountCollected),
    },
    {
      key: 'companyCost',
      header: t('fleet.accidents.fields.companyCost'),
      align: 'end',
      render: (r) => money(r.companyCost),
    },
    {
      key: 'paidAmount',
      header: t('fleet.accidents.fields.paidAmount'),
      align: 'end',
      render: (r) => money(r.paidAmount),
    },
    {
      // Derived here from the three facts beside it, by the CONTRACT's formula — the same one the
      // server sums for the strip above, so the column and its total are one statement.
      key: 'remaining',
      header: t('fleet.accidents.fields.remaining'),
      align: 'end',
      className: 'font-medium',
      render: (r) => money(fleetAccidentRemaining(r)),
    },
    {
      key: 'notes',
      header: t('fleet.accidents.fields.notes'),
      render: (r) =>
        r.notes === null ? (
          <span className="text-slate-400 dark:text-slate-600">—</span>
        ) : (
          <span className="block max-w-[14rem] truncate">{r.notes}</span>
        ),
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
        {/*
          ONE row on a wide screen — `singleRow` plus a width wrapper on every control, which is
          what that flag needs: with no wrapping to fall back on, a child left to flex would be
          squeezed by its neighbours instead of moving to the next line.

          The first two are BOTH about the vehicle and both stay: the box sweeps by code, the
          dropdown pins one car, and using them together narrows to the intersection rather than
          letting either replace the other. In Arabic the bar reads from the right exactly as
          specified: كود بحث ← العربية ← اسم المتسبب ← من ← إلى ← الحالة ← Reset.
        */}
        <FilterBar singleRow hasActiveFilters={hasFilters} onClear={clearFilters}>
          <div className="w-40 shrink-0">
            <SearchInput
              value={code}
              onChange={(term) => patch({ code: term || null })}
              placeholder={t('fleet.accidents.searchCode')}
            />
          </div>
          <VehicleSelect
            value={vehicle}
            onChange={(id) => patch({ vehicle: id || null })}
            allLabel={t('fleet.odometer.allVehicles')}
            anyStatus
            ariaLabel={t('fleet.odometer.columns.vehicle')}
          />
          <div className="w-44 shrink-0">
            <SearchInput
              value={culprit}
              onChange={(term) => patch({ culprit: term || null })}
              placeholder={t('fleet.accidents.searchCulprit')}
            />
          </div>
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
        </FilterBar>

        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <StatStrip columns={5} items={totals} />
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowClassName={(r) =>
            // Read from the PERSISTED status on every render, and from nothing else. A file the
            // server says is closed is green after a refresh, in another tab, and for the next
            // reader; a flip that fails leaves the row exactly as the server still has it.
            r.status === 'closed'
              ? 'bg-emerald-50 hover:bg-emerald-100/70 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60'
              : undefined
          }
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
