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
// URL-synced filters (vehicle codes + culprit search + date range + status), sortable
// occurredAt and pagination, per the module idiom.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  fleetAccidentRemaining,
  splitVehicleCodeList,
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
import { Input, Select } from '../../../shared/ui/form';
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
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { AccidentFormDialog } from '../components/AccidentFormDialog';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'culprit',
  'from',
  'status',
  'to',
  'vehicleCodes',
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

export const AccidentsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const vehicleCodes = splitVehicleCodeList(sp.get('vehicleCodes') ?? '');
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
      vehicleCodes: vehicleCodes.length === 0 ? undefined : vehicleCodes,
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
    patch({ vehicleCodes: null, culprit: null, status: null, from: null, to: null });
  const hasFilters =
    vehicleCodes.length > 0 || culprit !== '' || status !== '' || from !== '' || to !== '';

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

  // One step up the type scale for the filter row, to match the table under it. It is a PROP on
  // every control rather than a class, because a class would lose: `cn` has no tailwind-merge and
  // the control's own `text-sm` wins whichever order they are written in — measured, not assumed.
  const dateLabel = 'shrink-0 text-base font-medium text-slate-600 dark:text-slate-300';

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
          ONE row on desktop — and the two dates are why it was not one before.

          `Field` stacks its label ABOVE the control. Two of those in a row of bare controls make
          the bar two lines tall, push every neighbour's centre off, and cost the width that made
          the seventh control wrap. So «من» and «إلى» keep their visible labels and sit BESIDE
          them: same height as everything else, and the row is a row.

          Every child is `shrink-0` with a width of its own, which is what `singleRow`'s
          `flex-nowrap` needs — with no wrapping to fall back on, a child left to flex would be
          squeezed by its neighbours rather than moving to the next line.

          The width lives on a WRAPPER, never on the control. `cn` is a plain joiner: a `w-40`
          handed to a control whose base is `w-full` does not win, and the browser showed exactly
          that — date boxes that ignored their width, clipped their own placeholder and ran into
          the select beside them. Widths are sized to their content (a code is short, a name is
          not) so the bar spends its space where the typing happens, and each is the width its
          own contents MEASURE at this type size — a clipped placeholder is a filter nobody can
          name. `singleRowFrom` is measured the same way: seven controls at this size, with the
          shell's widest sidebar, fit from 1440 and not before.

          The exception is the two search boxes, which are `flex-1` over a `min-w` floor: a select
          and a date box have one right width and gain nothing from more, but a box somebody TYPES
          into does. So the slack a wide screen leaves goes to them instead of sitting empty at the
          end of the bar, and the floor is what stops `flex-nowrap` squeezing them under their own
          placeholder on the narrowest screen that still claims one row.

          The first two are BOTH about the vehicle and both stay: the box sweeps by code, the
          dropdown pins one car, and using them together narrows to the intersection rather than
          letting either replace the other. In Arabic the bar reads from the right exactly as
          specified: كود ← العربية ← اسم المتسبب ← من ← إلى ← الحالة ← Reset.
        */}
        <FilterBar
          singleRow
          singleRowFrom={1440}
          hasActiveFilters={hasFilters}
          onClear={clearFilters}
        >
          {/* ONE vehicle control. Until this there were two — a substring code box AND a
              single-car dropdown — and the server intersected them, so picking 215 and typing 216
              produced an empty page the filter bar itself had offered. */}
          <VehicleCodeFilter
            className="shrink-0"
            value={vehicleCodes}
            onChange={(next) => patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })}
          />
          <div className="min-w-[11rem] flex-1">
            <SearchInput
              value={culprit}
              onChange={(term) => patch({ culprit: term || null })}
              placeholder={t('fleet.accidents.searchCulprit')}
              textScale="comfortable"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label htmlFor="accidents-from" className={dateLabel}>
              {t('fleet.odometer.from')}
            </label>
            <div className="w-44">
              <Input
                id="accidents-from"
                type="date"
                value={from}
                onChange={(e) => patch({ from: e.target.value || null })}
                textScale="comfortable"
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <label htmlFor="accidents-to" className={dateLabel}>
              {t('fleet.odometer.to')}
            </label>
            <div className="w-44">
              <Input
                id="accidents-to"
                type="date"
                value={to}
                onChange={(e) => patch({ to: e.target.value || null })}
                textScale="comfortable"
              />
            </div>
          </div>
          <div className="w-32 shrink-0">
            <Select
              aria-label={t('fleet.vehicles.columns.status')}
              value={status}
              onChange={(e) => patch({ status: e.target.value || null })}
              textScale="comfortable"
            >
              <option value="">{t('fleet.accidents.allStatuses')}</option>
              <option value="open">{t('fleet.accidents.status.open')}</option>
              <option value="closed">{t('fleet.accidents.status.closed')}</option>
            </Select>
          </div>
        </FilterBar>

        {/*
          `labelFirst` — the name above the figure, both centred in the tile. Five money totals
          that differ only by the word beside them are READ, not glanced at: leading with the
          number would ask the reader to find the figure and then hunt for what it counts.
        */}
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <StatStrip columns={5} labelFirst items={totals} />
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          // A register somebody works through for an hour, not a panel they glance at: one step up
          // the type scale for the headers and every cell.
          textScale="comfortable"
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
        // Carried over from the filter, but only when it names ONE car — the same rule the other
        // screens' dialogs use. The id comes from the registry page this screen already holds to
        // print codes on its rows; the DIALOG still picks a single vehicle, as it should.
        initialVehicleId={
          vehicleCodes.length === 1
            ? (vehiclesQuery.data?.items.find((v) => v.code === vehicleCodes[0])?.id ?? '')
            : ''
        }
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
