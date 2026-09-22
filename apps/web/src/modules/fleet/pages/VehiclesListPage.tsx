// Vehicles registry (FW-3, legacy /fleet page): URL-synced search + filters + sort +
// pagination over the real FL-2 list API. Everything shown is a server fact — including the
// DERIVED inWorkshop pill (FR-12) — and every action is permission-gated exactly as the API
// enforces it.
//
// The catalogs slice extended it to the frozen column order (§7) and the two filter groups (§10).
// Every filter is SERVER-side, which is what keeps it correct across pagination: a client-side
// filter would only ever narrow the page you are looking at.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  type FleetCatalogKind,
  type FleetVehicleDto,
  type Locale,
  type LocalizedString,
  splitVehicleCodeList,
  vehicleCodeSearchQuery,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { readList, writeList } from '../../../shared/lib/list-param';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { ExportSheetButton } from '../components/ExportSheetButton';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import * as fleetApi from '../api/fleet-api';
import { migrateLegacyVehicleCodeParam } from '../lib/legacy-vehicle-filter';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  EditIcon,
  EyeIcon,
  PlusIcon,
  PrinterIcon,
  TrashIcon,
  WrenchIcon,
} from '../../../shared/ui/icons';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { BranchFilterSelect } from '../../hr/recruitment/shared/BranchFilterSelect';
import { useBranches } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import {
  useDeleteVehicle,
  useFleetCatalog,
  useVehicleTypes,
  useVehicles,
} from '../api/fleet-queries';
import { InWorkshopBadge, VehicleStatusBadge } from '../components/VehicleStatusBadge';
import { VehicleFormDialog } from '../components/VehicleFormDialog';
import { VehicleStatusDialog } from '../components/VehicleStatusDialog';
import { CatalogMultiSelect } from '../components/CatalogMultiSelect';
import {
  LicenseImagePreviewDialog,
  VehicleLicenseImageCell,
} from '../components/VehicleLicenseImage';
import { printLicenceRecord } from '../components/vehicle-print';
import { fetchVehicleLicenseImage } from '../api/fleet-api';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'branch',
  'chassis',
  'insurance',
  'licenseClass',
  'motor',
  'operation',
  'plate',
  'status',
  'type',
  'vehicleCodes',
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/** Build an id → localized-name map from a catalog list, for the table's reference columns. */
const nameMap = (
  items: readonly { id: string; name: LocalizedString }[] | undefined,
  locale: Locale,
): Map<string, string> =>
  new Map((items ?? []).map((item) => [item.id, localized(item.name, locale)]));

/**
 * The order this screen opens in, before the reader has asked for one.
 *
 * Named, because it is used twice and the two must agree: the table is DRAWN in it, and a
 * first click REPLACES it rather than joining it — see `clickSort`.
 */
const DEFAULT_SORT = 'code:asc';

export const VehiclesListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // EVERY dropdown on this bar takes SEVERAL answers — «اى فلتر ف الحركه زياده عن اتنين اختار ما
  // بينهم اعملى multi selection». Each is a comma-separated list in the address bar, which is the
  // shape the API's own `listQuery` parses, so what the reader sees in the URL is what the server
  // receives and a link carrying one value still means exactly that one value.
  const statuses = readList(sp, 'status');
  const typeIds = readList(sp, 'type');
  const vehicleCodes = splitVehicleCodeList(sp.get('vehicleCodes') ?? '');
  const plate = sp.get('plate') ?? '';
  const chassis = sp.get('chassis') ?? '';
  const motor = sp.get('motor') ?? '';
  const licenseClassIds = readList(sp, 'licenseClass');
  const operationIds = readList(sp, 'operation');
  const insuranceCompanyIds = readList(sp, 'insurance');
  const branchIds = readList(sp, 'branch');
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  /**
   * The columns this table is sorted by, in the order the reader clicked them —
   * «انا عاوز اقدر اعمل الاتنين مع بعض». One parameter carries the whole order; `code:asc`
   * is where the screen starts when the reader has not said otherwise.
   */
  const sortParam = sp.get('sort');
  const sorts = useMemo(() => readSorts(sortParam, DEFAULT_SORT), [sortParam]);
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
  // A saved link from before the picker — the rule, and why, live beside their own test in
  // `migrateLegacyVehicleCodeParam`. Applied with `replace` so the rewrite does not become a
  // history entry the reader has to press Back through twice.
  const legacyCode = sp.get('code');
  // Which of the two controls the old text meant depends on the REGISTRY, not on the text: a value
  // that names a car is a pick, one that does not is a substring search. So it is looked up — one
  // search, and only while such a link is being read.
  // Asked of the CODE, not of `search`: the question is literally "does a car carry this code?",
  // and the four-identifier search answers a wider one. With `pageSize: 1` that mattered — a car
  // whose PLATE contained the value could come back first and be the only row read, so a link that
  // did name a car migrated to `search=` instead of ticking it.
  const legacyLookup = useVehicles(
    { ...vehicleCodeSearchQuery(legacyCode ?? ''), pageSize: 1, sortBy: 'code', sortDir: 'asc' },
    legacyCode !== null && legacyCode.trim() !== '',
  );
  const legacyNamesAVehicle = (legacyLookup.data?.items ?? []).some((v) => v.code === legacyCode);
  useEffect(() => {
    // Nothing is rewritten until the lookup has answered: migrating early would send every link to
    // `search`, including the ones that name a car.
    if (legacyCode !== null && legacyCode.trim() !== '' && !legacyLookup.isSuccess) return;
    const migrated = migrateLegacyVehicleCodeParam(sp, legacyNamesAVehicle);
    if (migrated !== null) setSp(migrated, { replace: true });
    // Keyed on the legacy value and the lookup's answer: `sp` changes on every filter edit, and
    // re-running there would fight the very rewrite this just made.
  }, [legacyCode, legacyLookup.isSuccess, legacyNamesAVehicle]);

  // Ascending, then descending, then out of the order altogether — and a column the table
  // is NOT sorted by joins the end of it rather than replacing what is there.
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) }, false);
  };
  const hasActiveFilters =
    statuses.length > 0 ||
    typeIds.length > 0 ||
    vehicleCodes.length > 0 ||
    plate !== '' ||
    chassis !== '' ||
    motor !== '' ||
    licenseClassIds.length > 0 ||
    operationIds.length > 0 ||
    insuranceCompanyIds.length > 0 ||
    branchIds.length > 0;

  const params = useMemo(
    () => ({
      page,
      pageSize,
      ...sortQuery(sorts),
      status: statuses.length === 0 ? undefined : statuses,
      typeId: typeIds.length === 0 ? undefined : typeIds,
      vehicleCodes: vehicleCodes.length === 0 ? undefined : vehicleCodes,
      plateNumber: plate || undefined,
      chassisNumber: chassis || undefined,
      motorNumber: motor || undefined,
      licenseClassId: licenseClassIds.length === 0 ? undefined : licenseClassIds,
      operationId: operationIds.length === 0 ? undefined : operationIds,
      insuranceCompanyId: insuranceCompanyIds.length === 0 ? undefined : insuranceCompanyIds,
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

  /**
   * TWO SHEETS, one builder — «لو هدوس على زرار طباعه الرخصه يبقى الصوره و الكود العربيه والنوع
   * والفرع لكن لو هطبع من زرار الاجراءت يبقى كل تفاصيل العربيه».
   *
   * They are two different documents because they answer two different questions. The one that
   * leaves with a licence names the car just well enough to say WHOSE licence this is — the code,
   * the make and the branch it belongs to, over the scan itself. The registry record is the car's
   * whole file, and the scan rides along at the end of it.
   *
   * `licenceCard` is therefore not a shorter version of the record: it is the SCAN's sheet, and
   * the three rows are its caption. Both go through the one builder, so they print in one
   * typeface, one direction and one page shape.
   */
  const licenceCard = async (vehicle: FleetVehicleDto): Promise<void> => {
    const make = dash(typeName.get(vehicle.typeId));
    try {
      await printLicenceRecord({
        locale,
        title: t('fleet.vehicles.licenseImage.previewTitle'),
        subtitle: t('fleet.vehicles.licenseImage.previewSubtitle', { code: vehicle.code, make }),
        // Exactly the three the owner named, in the order they named them. No expiry, no plate,
        // no chassis: those are the record's, and a licence sheet carrying them is the record.
        rows: [
          { label: t('fleet.vehicles.columns.code'), value: vehicle.code },
          { label: t('fleet.vehicles.columns.type'), value: make },
          {
            label: t('fleet.vehicles.columns.branch'),
            value: dash(vehicle.branchId === null ? undefined : branchName.get(vehicle.branchId)),
          },
        ],
        // The button that opens this sheet is only drawn on a car that HAS a scan (see the
        // licence cell), so the section is never the empty heading the builder guards against.
        licenseImage:
          vehicle.licenseImage === null
            ? null
            : {
                fetch: () => fetchVehicleLicenseImage(vehicle.id),
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

  /** The car's WHOLE file — every column the registry holds, and the scan at the end of it. */
  const print = async (vehicle: FleetVehicleDto): Promise<void> => {
    const make = dash(typeName.get(vehicle.typeId));
    try {
      await printLicenceRecord({
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
                fetch: () => fetchVehicleLicenseImage(vehicle.id),
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

  /**
   * «للشاشات دى اعملى اكسلات هتاخد اللى الفلتر عامله بس · ومفيش امضاءات».
   *
   * THE FILTER'S WHOLE ANSWER, not the page's. `params` carries the reader's filters AND their
   * page; the page is dropped here and `fetchFilteredRows` walks every one of them, so a reader
   * who narrows to three hundred cars gets three hundred rows rather than the fifty in front of
   * them. A file that is silently short is the worst kind of wrong, because it looks complete.
   *
   * The columns are the table's, resolved the way the table resolves them — names, not ids — and
   * the code cell is SPLIT. On screen it carries three facts at once: the code, the lifecycle
   * status and the in-workshop pill. A spreadsheet cell cannot stack three things, so each gets a
   * column; folding them back into one would drop two facts the register has always shown.
   *
   * The sort goes with the filters, untouched: the file opens in the order the reader is looking
   * at, which is the order they will look for a row in.
   */
  const exportSheet = async (): Promise<void> => {
    const filters = filtersOnly(params);
    const all = await fetchFilteredRows((pageNo, size) =>
      fleetApi.listVehicles({ ...filters, page: pageNo, pageSize: size }),
    );
    saveSheet(
      {
        name: t('fleet.nav.vehicles'),
        serialHeader: t('fleet.violations.report.serial'),
        header: [
          t('fleet.vehicles.columns.type'),
          t('fleet.vehicles.columns.code'),
          t('fleet.vehicles.columns.status'),
          t('fleet.vehicles.inWorkshop'),
          t('fleet.vehicles.columns.plate'),
          t('fleet.vehicles.columns.chassis'),
          t('fleet.vehicles.columns.motor'),
          t('fleet.vehicles.columns.joinedAt'),
          t('fleet.vehicles.columns.license'),
          t('fleet.vehicles.columns.licenseClass'),
          t('fleet.vehicles.columns.branch'),
          t('fleet.vehicles.columns.operation'),
          t('fleet.vehicles.columns.insurance'),
        ],
        rows: all.map((v) => [
          typeName.get(v.typeId) ?? '',
          v.code,
          t(`fleet.vehicles.status.${v.status}`),
          v.inWorkshop ? t('common.yes') : t('common.no'),
          v.plateNumber,
          v.chassisNumber,
          v.motorNumber,
          formatDate(v.joinedAt, locale),
          formatDate(v.licenseExpiresAt, locale),
          (v.licenseClassId === null ? undefined : licenseClassName.get(v.licenseClassId)) ?? '',
          (v.branchId === null ? undefined : branchName.get(v.branchId)) ?? '',
          (v.operationId === null ? undefined : operationName.get(v.operationId)) ?? '',
          (v.insuranceCompanyId === null ? undefined : insurerName.get(v.insuranceCompanyId)) ?? '',
        ]),
      },
    );
  };

  // The frozen §7 order. The lifecycle status and the DERIVED in-workshop pill ride with the code
  // rather than taking a fifteenth column: dropping them would lose real information the registry
  // has always shown, and the column list did not ask for them to go.
  const columns: Column<FleetVehicleDto>[] = [
    {
      key: 'type',
      header: t('fleet.vehicles.columns.type'),
      // «عاوز هنا يكون فيه سهم عشان ارتب العربيات على حسب النوع تصاعدى وتنازلى». The column shows a
      // NAME and the row stores a `typeId`, so the server joins the name in before it cuts the
      // page — `typeName`, which is what the sort parameter carries and what the table calls it.
      sortable: true,
      sortKey: 'typeName',
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
      // PRINT SITS BESIDE THE SCAN as well as in the actions column — «عاوز اضيف زرار الطباعه
      // هنا للعربيه فى خانة صوره الرخصه». The same sheet either way: the page owns the printing
      // and both buttons call it, so there is one print and two doors to it.
      render: (v) => (
        <VehicleLicenseImageCell
          vehicle={v}
          onPreview={setPreviewing}
          onPrint={(vehicle) => void licenceCard(vehicle)}
        />
      ),
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
          {/* OFFERED ON A DISPOSED CAR TOO — it is the only way back, and hiding it was what made
              a mis-keyed disposal permanent. Editing such a car is still hidden above: the record
              stays frozen while it is out of the fleet, and the way to edit one is to return it. */}
          {can('fleetVehicle.changeStatus') && (
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
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.vehicles') },
        ]}
        actions={
          <>
            {/* NOT OFFERED WHEN THE LIST FAILED. A green button on a screen that has just
                told the reader it has no data reads as a way out of the failure, and the
                file behind it would be empty or short. Disabling is not enough — it still
                draws. */}
            {!isError && <ExportSheetButton name="vehicles" onExport={exportSheet} />}
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
          </>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          {...(data === undefined
            ? {}
            : {
                trailing: (
                  <span
                    data-vehicle-count
                    className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400"
                  >
                    {t('fleet.vehicles.count', {
                      count: formatNumber(data.meta.totalItems, locale),
                    })}
                  </span>
                ),
              })}
          onClear={() =>
            patch({
              status: null,
              type: null,
              vehicleCodes: null,
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
            ONE wrapping row. FilterBar is already `flex flex-wrap items-center gap-2`, so every
            control below is a direct child of it and they sit side by side on desktop, reflowing
            onto further lines only when the viewport runs out — never one filter per line.

            Each Input sits in a WIDTH WRAPPER rather than taking the width itself. `cn` is a plain
            joiner with no tailwind-merge, and the control's base class is `w-full`; a `w-36` passed
            alongside it does not win, so every box stretched to the full bar and stacked one per
            line. `SearchInput` solves it the same way — width on the wrapper, `w-full` inside.
            Direction is untouched: the bar inherits RTL from the page, so in Arabic the row reads
            الكود → اللوحة → الشاسيه → الموتور from the right.
          */}
          <VehicleCodeFilter
            className="shrink-0"
            value={vehicleCodes}
            onChange={(next) => patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })}
          />
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
          {/* The dropdowns: make, then the three catalog references, then branch and status —
              EVERY ONE of them multi-valued. «الفئة أ أو ب» and «المتاحة والمتوقفة» are single
              questions about the fleet, and a one-answer control made the reader ask each of them
              twice and add the two counts up by hand. Branch has taken several since it was
              written; the other five now read the same way. */}
          <MultiSelect
            className="shrink-0"
            showSelectedValues
            chips
            label={t('fleet.vehicles.filters.make')}
            options={(types.data?.items ?? []).map((type) => ({
              value: type.id,
              label: localized(type.name, locale),
            }))}
            value={typeIds}
            onChange={(ids) => patch({ type: writeList(ids) })}
          />
          <CatalogMultiSelect
            kind="licenseClass"
            value={licenseClassIds}
            onChange={(ids) => patch({ licenseClass: writeList(ids) })}
            label={t('fleet.vehicles.filters.licenseClass')}
          />
          <BranchFilterSelect
            value={branchIds}
            onChange={(ids) => patch({ branch: writeList(ids) })}
          />
          <CatalogMultiSelect
            kind="operation"
            value={operationIds}
            onChange={(ids) => patch({ operation: writeList(ids) })}
            label={t('fleet.vehicles.filters.operation')}
          />
          <CatalogMultiSelect
            kind="insuranceCompany"
            value={insuranceCompanyIds}
            onChange={(ids) => patch({ insurance: writeList(ids) })}
            label={t('fleet.vehicles.filters.insurance')}
          />
          {/* THREE statuses, so it takes several — the two-answer filters elsewhere in Fleet
              («داخل الورشة / خرج», «مفتوح / مغلق») stay as they are: with two options a
              multi-select can only say what a single one already said. */}
          <MultiSelect
            className="shrink-0"
            showSelectedValues
            label={t('fleet.vehicles.columns.status')}
            options={(['active', 'outOfService', 'disposed'] as const).map((value) => ({
              value,
              label: t(`fleet.vehicles.status.${value}`),
            }))}
            value={statuses}
            onChange={(next) => patch({ status: writeList(next) })}
          />
          {/* HOW MANY CARS THE FILTER MATCHES — «حط جمب الفلاتر عدد العربيات».
              
              It reads the SERVER's `totalItems`, never `rows.length`. The rows in hand are one
              page of at most 25, so counting them would answer «how many are on this screen»
              while looking like an answer to «how many are there» — and the two differ the
              moment a filter matches more than a page.
              
              `trailing`, so it lands in the same group as the reset and the active-filter count
              that `FilterBar` already draws there, rather than as a twelfth control in a row of
              eleven filters. */}
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(v) => v.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sorts}
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
