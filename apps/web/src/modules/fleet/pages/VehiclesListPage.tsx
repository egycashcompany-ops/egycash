// Vehicles registry (FW-3, legacy /fleet page): URL-synced search + filters + sort +
// pagination over the real FL-2 list API. Everything shown is a server fact — including the
// DERIVED inWorkshop pill (FR-12) — and every action is permission-gated exactly as the API
// enforces it.
//
// The catalogs slice extended it to the frozen column order (§7) and the two filter groups (§10).
// Every filter is SERVER-side, which is what keeps it correct across pagination: a client-side
// filter would only ever narrow the page you are looking at.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  type FleetCatalogKind,
  type FleetVehicleDto,
  type Locale,
  type LocalizedString,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { readList, writeList } from '../../../shared/lib/list-param';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, EyeIcon, PlusIcon, PrinterIcon, TrashIcon, WrenchIcon } from '../../../shared/ui/icons';
import { formatDate, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { BranchFilterSelect } from '../../hr/recruitment/shared/BranchFilterSelect';
import { useBranches } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import { useDeleteVehicle, useFleetCatalog, useVehicleTypes, useVehicles } from '../api/fleet-queries';
import { InWorkshopBadge, VehicleStatusBadge } from '../components/VehicleStatusBadge';
import { VehicleFormDialog } from '../components/VehicleFormDialog';
import { VehicleStatusDialog } from '../components/VehicleStatusDialog';
import { CatalogSelect } from '../components/CatalogSelect';
import { LicenseImagePreviewDialog, VehicleLicenseImageCell } from '../components/VehicleLicenseImage';
import { printVehicle } from '../components/vehicle-print';

const DEFAULT_PAGE_SIZE = 25;

/** Build an id → localized-name map from a catalog list, for the table's reference columns. */
const nameMap = (
  items: readonly { id: string; name: LocalizedString }[] | undefined,
  locale: Locale,
): Map<string, string> =>
  new Map((items ?? []).map((item) => [item.id, localized(item.name, locale)]));

export const VehiclesListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const typeId = sp.get('type') ?? '';
  const code = sp.get('code') ?? '';
  const plate = sp.get('plate') ?? '';
  const chassis = sp.get('chassis') ?? '';
  const motor = sp.get('motor') ?? '';
  const licenseClassId = sp.get('licenseClass') ?? '';
  const operationId = sp.get('operation') ?? '';
  const insuranceCompanyId = sp.get('insurance') ?? '';
  const branchIds = readList(sp, 'branch');
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'code:asc').split(':');
  const sort = { by: sortByRaw ?? 'code', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
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
  const hasActiveFilters =
    search !== '' ||
    status !== '' ||
    typeId !== '' ||
    code !== '' ||
    plate !== '' ||
    chassis !== '' ||
    motor !== '' ||
    licenseClassId !== '' ||
    operationId !== '' ||
    insuranceCompanyId !== '' ||
    branchIds.length > 0;

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      status: status || undefined,
      typeId: typeId || undefined,
      code: code || undefined,
      plateNumber: plate || undefined,
      chassisNumber: chassis || undefined,
      motorNumber: motor || undefined,
      licenseClassId: licenseClassId || undefined,
      operationId: operationId || undefined,
      insuranceCompanyId: insuranceCompanyId || undefined,
      branchId: branchIds.length === 0 ? undefined : branchIds,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useVehicles(params);
  const rows = data?.items ?? [];

  // Reference name maps. Each list is cached per kind, so the three catalog columns and the three
  // catalog filters below share exactly one request each.
  const types = useVehicleTypes();
  const typeName = useMemo(() => nameMap(types.data?.items, locale), [types.data, locale]);
  const licenseClasses = useFleetCatalog('licenseClass' satisfies FleetCatalogKind);
  const operations = useFleetCatalog('operation' satisfies FleetCatalogKind);
  const insurers = useFleetCatalog('insuranceCompany' satisfies FleetCatalogKind);
  const licenseClassName = useMemo(
    () => nameMap(licenseClasses.data?.items, locale),
    [licenseClasses.data, locale],
  );
  const operationName = useMemo(
    () => nameMap(operations.data?.items, locale),
    [operations.data, locale],
  );
  const insurerName = useMemo(() => nameMap(insurers.data?.items, locale), [insurers.data, locale]);
  // Branch names come from the same hook the filter uses; without `branch.view` it stays empty and
  // the column degrades to a dash rather than leaking an id.
  const { data: branches = [] } = useBranches(can('branch.view'));
  const branchName = useMemo(() => nameMap(branches, locale), [branches, locale]);

  // "الترتيب" — the row's position in the WHOLE result set, not on the page, so paging forward
  // continues the count instead of restarting it.
  const ordinalBase = (page - 1) * pageSize;
  const ordinal = useMemo(
    () => new Map(rows.map((row, index) => [row.id, ordinalBase + index + 1])),
    [rows, ordinalBase],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FleetVehicleDto | null>(null);
  const [statusFor, setStatusFor] = useState<FleetVehicleDto | null>(null);
  const [deleting, setDeleting] = useState<FleetVehicleDto | null>(null);
  const [previewing, setPreviewing] = useState<FleetVehicleDto | null>(null);
  const remove = useDeleteVehicle();

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.vehicles.deleted'));
    setDeleting(null);
  };

  const dash = (value: string | undefined): string => value ?? '—';

  const print = async (vehicle: FleetVehicleDto): Promise<void> => {
    const make = dash(typeName.get(vehicle.typeId));
    try {
      await printVehicle({
        locale,
        title: t('fleet.vehicles.print.title'),
        subtitle: t('fleet.vehicles.licenseImage.previewSubtitle', {
          code: vehicle.code,
          make,
        }),
        rows: [
          { label: t('fleet.vehicles.columns.type'), value: make },
          { label: t('fleet.vehicles.columns.code'), value: vehicle.code },
          { label: t('fleet.vehicles.columns.plate'), value: vehicle.plateNumber },
          { label: t('fleet.vehicles.columns.chassis'), value: vehicle.chassisNumber },
          { label: t('fleet.vehicles.columns.motor'), value: vehicle.motorNumber },
          {
            label: t('fleet.vehicles.columns.joinedAt'),
            value: formatDate(vehicle.joinedAt, locale),
          },
          {
            label: t('fleet.vehicles.columns.license'),
            value: formatDate(vehicle.licenseExpiresAt, locale),
          },
          {
            label: t('fleet.vehicles.columns.licenseClass'),
            value: dash(
              vehicle.licenseClassId === null
                ? undefined
                : licenseClassName.get(vehicle.licenseClassId),
            ),
          },
          {
            label: t('fleet.vehicles.columns.branch'),
            value: dash(vehicle.branchId === null ? undefined : branchName.get(vehicle.branchId)),
          },
          {
            label: t('fleet.vehicles.columns.operation'),
            value: dash(
              vehicle.operationId === null ? undefined : operationName.get(vehicle.operationId),
            ),
          },
          {
            label: t('fleet.vehicles.columns.insurance'),
            value: dash(
              vehicle.insuranceCompanyId === null
                ? undefined
                : insurerName.get(vehicle.insuranceCompanyId),
            ),
          },
          {
            label: t('fleet.vehicles.columns.status'),
            value: t(`fleet.vehicles.status.${vehicle.status}`),
          },
        ],
        licenseImage:
          vehicle.licenseImage === null
            ? null
            : {
                vehicleId: vehicle.id,
                heading: t('fleet.vehicles.licenseImage.previewTitle'),
                caption: t('fleet.vehicles.licenseImage.previewSubtitle', {
                  code: vehicle.code,
                  make,
                }),
              },
      });
    } catch {
      toast.error(t('fleet.vehicles.print.failed'));
    }
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  // The frozen §7 order. The lifecycle status and the DERIVED in-workshop pill ride with the code
  // rather than taking a fifteenth column: dropping them would lose real information the registry
  // has always shown, and the column list did not ask for them to go.
  const columns: Column<FleetVehicleDto>[] = [
    {
      key: 'ordinal',
      header: t('fleet.vehicles.columns.ordinal'),
      align: 'center',
      render: (v) => <span className="tabular-nums text-xs">{ordinal.get(v.id) ?? '—'}</span>,
    },
    {
      key: 'type',
      header: t('fleet.vehicles.columns.type'),
      render: (v) => dash(typeName.get(v.typeId)),
    },
    {
      key: 'code',
      header: t('fleet.vehicles.columns.code'),
      sortable: true,
      render: (v) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs" dir="ltr">
            {v.code}
          </span>
          <VehicleStatusBadge status={v.status} />
          <InWorkshopBadge inWorkshop={v.inWorkshop} />
        </span>
      ),
    },
    { key: 'plate', header: t('fleet.vehicles.columns.plate'), render: (v) => v.plateNumber },
    {
      key: 'chassis',
      header: t('fleet.vehicles.columns.chassis'),
      render: (v) => (
        <span className="font-mono text-xs" dir="ltr">
          {v.chassisNumber}
        </span>
      ),
    },
    {
      key: 'motor',
      header: t('fleet.vehicles.columns.motor'),
      render: (v) => (
        <span className="font-mono text-xs" dir="ltr">
          {v.motorNumber}
        </span>
      ),
    },
    {
      key: 'joinedAt',
      header: t('fleet.vehicles.columns.joinedAt'),
      render: (v) => <span className="tabular-nums">{formatDate(v.joinedAt, locale)}</span>,
    },
    {
      key: 'licenseExpiresAt',
      header: t('fleet.vehicles.columns.license'),
      sortable: true,
      render: (v) => {
        const expired = new Date(v.licenseExpiresAt).getTime() < Date.now();
        return (
          <span
            className={cn('tabular-nums', expired && 'font-medium text-red-600 dark:text-red-400')}
          >
            {formatDate(v.licenseExpiresAt, locale)}
          </span>
        );
      },
    },
    {
      key: 'licenseClass',
      header: t('fleet.vehicles.columns.licenseClass'),
      render: (v) =>
        dash(v.licenseClassId === null ? undefined : licenseClassName.get(v.licenseClassId)),
    },
    {
      key: 'branch',
      header: t('fleet.vehicles.columns.branch'),
      render: (v) => dash(v.branchId === null ? undefined : branchName.get(v.branchId)),
    },
    {
      key: 'operation',
      header: t('fleet.vehicles.columns.operation'),
      render: (v) => dash(v.operationId === null ? undefined : operationName.get(v.operationId)),
    },
    {
      key: 'insurance',
      header: t('fleet.vehicles.columns.insurance'),
      render: (v) =>
        dash(v.insuranceCompanyId === null ? undefined : insurerName.get(v.insuranceCompanyId)),
    },
    {
      key: 'licenseImage',
      header: t('fleet.vehicles.columns.licenseImage'),
      align: 'center',
      render: (v) => <VehicleLicenseImageCell vehicle={v} onPreview={setPreviewing} />,
    },
    // Owner UI decision (FW-4): no whole-row navigation — an explicit View action instead. It
    // avoids accidental navigation, matches the other ECMS modules, and leaves row selection
    // free for later. The column always renders: View needs only the page's own permission.
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (v) => (
        <span className="flex items-center justify-end gap-1">
          <button
            type="button"
            className={actionButton}
            aria-label={t('fleet.vehicles.view')}
            title={t('fleet.vehicles.view')}
            onClick={() => navigate(v.id)}
          >
            <EyeIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={actionButton}
            aria-label={t('fleet.vehicles.print.action')}
            title={t('fleet.vehicles.print.action')}
            onClick={() => void print(v)}
          >
            <PrinterIcon className="h-4 w-4" />
          </button>
          {can('fleetVehicle.edit') && v.status !== 'disposed' && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.vehicles.edit')}
              title={t('fleet.vehicles.edit')}
              onClick={() => {
                setEditing(v);
                setFormOpen(true);
              }}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetVehicle.changeStatus') && v.status !== 'disposed' && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.vehicles.changeStatus')}
              title={t('fleet.vehicles.changeStatus')}
              onClick={() => setStatusFor(v)}
            >
              <WrenchIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetVehicle.delete') && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('common.delete')}
              title={t('common.delete')}
              onClick={() => setDeleting(v)}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.vehicles')}
        description={t('fleet.vehicles.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.vehicles') },
        ]}
        actions={
          <Can permission="fleetVehicle.create">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t('fleet.vehicles.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() =>
            patch({
              q: null,
              status: null,
              type: null,
              code: null,
              plate: null,
              chassis: null,
              motor: null,
              licenseClass: null,
              operation: null,
              insurance: null,
              branch: null,
            })
          }
        >
          {/*
            Two logical rows. `basis-full` makes the identifier row claim a line of the wrapping
            bar to itself, so the four boxes read as one set on desktop; the selects then flow onto
            the next line, where FilterBar's own reset icon (`ms-auto`) still lands at the end.
            Both rows are `flex-wrap`, so a narrow screen wraps naturally instead of overflowing.

            Each Input sits in a WIDTH WRAPPER rather than taking the width itself. `cn` is a plain
            joiner with no tailwind-merge, and the control's base class is `w-full`; a `w-36` passed
            alongside it does not win, so every box stretched to the full bar and stacked one per
            line. `SearchInput` already solves it this way — width on the wrapper, `w-full` inside.
            Direction is untouched: the bar inherits RTL from the page, so in Arabic the row reads
            الكود → اللوحة → الشاسيه → الموتور from the right.
          */}
          <div className="flex basis-full flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onChange={(value) => patch({ q: value || null })}
              placeholder={t('fleet.vehicles.searchPlaceholder')}
              className="w-64"
            />
            <div className="w-32">
              <Input
                aria-label={t('fleet.vehicles.columns.code')}
                placeholder={t('fleet.vehicles.columns.code')}
                value={code}
                onChange={(e) => patch({ code: e.target.value || null })}
                dir="ltr"
              />
            </div>
            <div className="w-36">
              <Input
                aria-label={t('fleet.vehicles.columns.plate')}
                placeholder={t('fleet.vehicles.columns.plate')}
                value={plate}
                onChange={(e) => patch({ plate: e.target.value || null })}
              />
            </div>
            <div className="w-40">
              <Input
                aria-label={t('fleet.vehicles.columns.chassis')}
                placeholder={t('fleet.vehicles.columns.chassis')}
                value={chassis}
                onChange={(e) => patch({ chassis: e.target.value || null })}
                dir="ltr"
              />
            </div>
            <div className="w-40">
              <Input
                aria-label={t('fleet.vehicles.columns.motor')}
                placeholder={t('fleet.vehicles.columns.motor')}
                value={motor}
                onChange={(e) => patch({ motor: e.target.value || null })}
                dir="ltr"
              />
            </div>
          </div>

          {/* The dropdowns: make, then the three catalog references, then branch and status. */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={t('fleet.vehicles.filters.make')}
              value={typeId}
              onChange={(e) => patch({ type: e.target.value || null })}
              className="w-auto"
            >
              <option value="">{t('fleet.vehicles.filters.make')}</option>
              {(types.data?.items ?? []).map((type) => (
                <option key={type.id} value={type.id}>
                  {localized(type.name, locale)}
                </option>
              ))}
            </Select>
            <CatalogSelect
              kind="licenseClass"
              value={licenseClassId}
              onChange={(id) => patch({ licenseClass: id || null })}
              allLabel={t('fleet.vehicles.filters.licenseClass')}
              ariaLabel={t('fleet.vehicles.filters.licenseClass')}
            />
            <BranchFilterSelect
              value={branchIds}
              onChange={(ids) => patch({ branch: writeList(ids) })}
            />
            <CatalogSelect
              kind="operation"
              value={operationId}
              onChange={(id) => patch({ operation: id || null })}
              allLabel={t('fleet.vehicles.filters.operation')}
              ariaLabel={t('fleet.vehicles.filters.operation')}
            />
            <CatalogSelect
              kind="insuranceCompany"
              value={insuranceCompanyId}
              onChange={(id) => patch({ insurance: id || null })}
              allLabel={t('fleet.vehicles.filters.insurance')}
              ariaLabel={t('fleet.vehicles.filters.insurance')}
            />
            <Select
              aria-label={t('fleet.vehicles.columns.status')}
              value={status}
              onChange={(e) => patch({ status: e.target.value || null })}
              className="w-auto"
            >
              <option value="">{t('fleet.vehicles.allStatuses')}</option>
              {(['active', 'outOfService', 'disposed'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`fleet.vehicles.status.${s}`)}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(v) => v.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          empty={undefined}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <VehicleFormDialog
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        vehicle={editing}
      />
      <VehicleStatusDialog
        open={statusFor !== null}
        onClose={() => setStatusFor(null)}
        vehicle={statusFor}
      />
      <LicenseImagePreviewDialog
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        vehicle={previewing}
        typeName={previewing === null ? '' : dash(typeName.get(previewing.typeId))}
      />
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.vehicles.deleteTitle')}
        description={deleting === null ? '' : `${deleting.code} — ${deleting.plateNumber}`}
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
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.vehicles.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
