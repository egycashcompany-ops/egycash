// Vehicles registry (FW-3, legacy /fleet page): URL-synced search + filters + sort +
// pagination over the real FL-2 list API. Everything shown is a server fact — including the
// DERIVED inWorkshop pill (FR-12) — and every action is permission-gated exactly as the API
// enforces it.
//
// The catalogs slice extended it to the frozen column order (§7) and the two filter groups (§10).
// Every filter is SERVER-side, which is what keeps it correct across pagination: a client-side
// filter would only ever narrow the page you are looking at.
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  type FleetCatalogKind,
  type FleetVehicleDto,
  type Locale,
  type LocalizedString,
  splitVehicleCodeList,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { readList, writeList } from '../../../shared/lib/list-param';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { printFleetReport } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { errorMessage } from '../../../shared/lib/errors';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import * as fleetApi from '../api/fleet-api';
import {
  legacyCodeNamesAVehicle,
  migrateLegacyVehicleCodeParam,
} from '../lib/legacy-vehicle-filter';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { FleetPager } from '../components/FleetPager';
import { Spinner } from '../../../shared/ui/Spinner';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, EyeIcon, PrinterIcon, TrashIcon, WrenchIcon } from '../../../shared/ui/icons';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { BranchFilterSelect } from '../../hr/recruitment/shared/BranchFilterSelect';
import { useBranches } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import {
  useAllVehicles,
  useDeleteVehicle,
  useFleetCatalog,
  useVehicleTypes,
  useVehicles,
} from '../api/fleet-queries';
import { InWorkshopBadge, VehicleStatusBadge } from '../components/VehicleStatusBadge';
import { BOARD_FONT, BoardIcon, NUM, PATH, expiryState, ymd } from '../components/FuelCardBoard';
import { VehicleFormDialog } from '../components/VehicleFormDialog';
import { VehicleStatusDialog } from '../components/VehicleStatusDialog';
import { CatalogMultiSelect } from '../components/CatalogMultiSelect';
import { DARK_FILTER_BAR } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import {
  LicenseImagePreviewDialog,
  VehicleLicenseImageCell,
} from '../components/VehicleLicenseImage';
import { printLicenceRecord } from '../components/vehicle-print';
import { fetchVehicleLicenseImage } from '../api/fleet-api';
import { chosenSorts, clickChosenSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { licenceMonthOptions } from '../lib/licence-months';
import { BreakdownCard, FigureChip } from '../components/FleetFigures';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'branch',
  'chassis',
  'insurance',
  'licenseClass',
  'licenseMonths',
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
 * The list is fetched in it, and no header shows an arrow for it — it is the screen's order, not
 * one the reader chose. See `changeSort`.
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
  // «تاريخ انتهاء الترخيص … أقدر أختار شهر فى سنه معينه» — `YYYY-MM`, what `<input type="month">`
  // reads and writes; asked of the server as that month's first and last instant.
  // Several months — «أختار أكتر من شهر». A link from before carries one as `licenseMonth`.
  const licenseMonths =
    readList(sp, 'licenseMonths').length > 0
      ? readList(sp, 'licenseMonths')
      : readList(sp, 'licenseMonth');
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
  // that names a car is a pick, one that does not is a substring search. So it is looked up — only
  // while such a link is being read — against the WHOLE registry, exactly: «does a car carry this
  // code?». It used to read ONE row of a substring search, so `?code=61` read car 161 first and a
  // link that did name car 61 migrated to `search=` instead of ticking it.
  const legacyLookup = useAllVehicles(
    { anyStatus: true },
    legacyCode !== null && legacyCode.trim() !== '',
  );
  // The whole registry, for the months its licences run out in (cached with the code picker's).
  const wholeRegistry = useAllVehicles({ anyStatus: true });
  const signatories = useReportSignatories();
  // The figures across the top — the whole registry, whatever the filters narrow the table to.
  const registryFigures = useMemo(() => {
    const items = wholeRegistry.data?.items ?? [];
    const thisMonth = new Date().toISOString().slice(0, 7);
    const now = Date.now();
    return {
      total: items.length,
      active: items.filter((v) => v.status === 'active').length,
      thisMonth: items.filter((v) => v.licenseExpiresAt?.slice(0, 7) === thisMonth).length,
      expired: items.filter(
        (v) =>
          v.status === 'active' &&
          v.licenseExpiresAt !== null &&
          new Date(v.licenseExpiresAt).getTime() < now,
      ).length,
      workshop: items.filter((v) => v.inWorkshop).length,
    };
  }, [wholeRegistry.data]);
  const monthOptions = useMemo(
    () => licenceMonthOptions(wholeRegistry.data?.items ?? [], locale),
    [wholeRegistry.data, locale],
  );
  const legacyNamesAVehicle = legacyCodeNamesAVehicle(legacyLookup.data?.items ?? [], legacyCode);
  useEffect(() => {
    // Nothing is rewritten until the lookup has answered: migrating early would send every link to
    // `search`, including the ones that name a car.
    if (legacyCode !== null && legacyCode.trim() !== '' && !legacyLookup.isSuccess) return;
    const migrated = migrateLegacyVehicleCodeParam(sp, legacyNamesAVehicle);
    if (migrated !== null) setSp(migrated, { replace: true });
    // Keyed on the legacy value and the lookup's answer: `sp` changes on every filter edit, and
    // re-running there would fight the very rewrite this just made.
  }, [legacyCode, legacyLookup.isSuccess, legacyNamesAVehicle]);

  // «السهم الافتراضى معمول ل فوق المفروض يبقى متشال»: the screen's own order (by the code) is
  // not one the reader chose, so no header shows an arrow for it. A click on any column — the
  // code included — sorts it ascending, then descending, then lets go, which lands back on the
  // screen's own order with no arrow at all.
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickChosenSort(sortParam, by)) }, false);
  };
  /** What the headers show — the reader's own order only. */
  const chosen = useMemo(() => chosenSorts(sortParam), [sortParam]);
  /** «اعيد ترتيب الجدول من تانى» — back to the screen's own order, whatever was clicked. */
  const sortChosen = chosen.length > 0;
  const hasActiveFilters =
    statuses.length > 0 ||
    typeIds.length > 0 ||
    vehicleCodes.length > 0 ||
    plate !== '' ||
    chassis !== '' ||
    motor !== '' ||
    licenseClassIds.length > 0 ||
    licenseMonths.length > 0 ||
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
      licenseExpiryMonths: licenseMonths.length === 0 ? undefined : licenseMonths,
      operationId: operationIds.length === 0 ? undefined : operationIds,
      insuranceCompanyId: insuranceCompanyIds.length === 0 ? undefined : insuranceCompanyIds,
      branchId: branchIds.length === 0 ? undefined : branchIds,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useVehicles(params);
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
  // How many cars sit in each licence class, operation and insurer — every entry of each list, in
  // the list's own order, then the cars that have none.
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const breakdown = useMemo(() => {
    const items = wholeRegistry.data?.items ?? [];
    const tally = (
      list: readonly { id: string; name: LocalizedString }[] | undefined,
      pick: (v: (typeof items)[number]) => string | null,
    ): { id: string; name: string; count: number }[] => {
      const counts = new Map<string, number>();
      for (const v of items) {
        const id = pick(v) ?? '';
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      const rows = (list ?? []).map((item) => ({
        id: item.id,
        name: localized(item.name, locale),
        count: counts.get(item.id) ?? 0,
      }));
      const none = counts.get('') ?? 0;
      return none > 0
        ? [...rows, { id: '', name: t('fleet.vehicles.board.unassigned'), count: none }]
        : rows;
    };
    return {
      licenseClass: tally(licenseClasses.data?.items, (v) => v.licenseClassId),
      operation: tally(operations.data?.items, (v) => v.operationId),
      insurance: tally(insurers.data?.items, (v) => v.insuranceCompanyId),
    };
  }, [wholeRegistry.data, licenseClasses.data, operations.data, insurers.data, locale, t]);
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
  const vehicleSheet = async (): Promise<{ header: string[]; rows: string[][] }> => {
    const filters = filtersOnly(params);
    const all = await fetchFilteredRows((pageNo, size) =>
      fleetApi.listVehicles({ ...filters, page: pageNo, pageSize: size }),
    );
    return {
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
    };
  };
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const exportSheet = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('excel');
    try {
      const sheet = await vehicleSheet();
      saveSheet({
        name: t('fleet.nav.vehicles'),
        serialHeader: t('fleet.violations.report.serial'),
        header: sheet.header,
        rows: sheet.rows,
      });
    } catch (error) {
      toast.error(errorMessage(error, locale));
    } finally {
      setExporting(null);
    }
  };
  // The same rows as the Excel file, on the Fleet report page the charging screen prints.
  const printSheet = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('pdf');
    try {
      const sheet = await vehicleSheet();
      printFleetReport({
        title: t('fleet.nav.vehicles'),
        department: t('fleet.violations.report.department'),
        subtitle: '',
        header: sheet.header,
        rows: sheet.rows,
        totals: [],
        signatories,
        serialHeader: t('fleet.violations.report.serial'),
        emptyLabel: t('fleet.violations.report.empty'),
      });
    } catch (error) {
      toast.error(
        error instanceof Error && error.message === 'popup blocked'
          ? t('fleet.violations.popupBlocked')
          : errorMessage(error, locale),
      );
    } finally {
      setExporting(null);
    }
  };

  // The frozen §7 order, the code first («عمود الكود يبقى فى الاول») and the make after it. The lifecycle status and the DERIVED in-workshop pill ride with the code
  // rather than taking a fifteenth column: dropping them would lose real information the registry
  // has always shown, and the column list did not ask for them to go.
  const columns: Column<FleetVehicleDto>[] = [
    {
      key: 'code',
      align: 'center',
      header: t('fleet.vehicles.columns.code'),
      sortable: true,
      render: (v) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="font-mono text-sm font-bold" dir="ltr">
            {v.code}
          </span>
          {/* «الجدول … مش ظاهر كله»: a laptop has no room for two pills beside every code, so
              below the wide screen the state is a coloured dot and the workshop a small icon —
              the words on hover — and the whole table fits. A wide screen keeps the pills. */}
          <span className="hidden items-center gap-1.5 min-[1750px]:inline-flex">
            <VehicleStatusBadge status={v.status} />
            <InWorkshopBadge inWorkshop={v.inWorkshop} />
          </span>
          <CompactVehicleState status={v.status} inWorkshop={v.inWorkshop} />
        </span>
      ),
    },
    {
      key: 'type',
      align: 'center',
      className: WRAPS_ON_LAPTOP,
      header: t('fleet.vehicles.columns.type'),
      // «عاوز هنا يكون فيه سهم عشان ارتب العربيات على حسب النوع تصاعدى وتنازلى». The column shows a
      // NAME and the row stores a `typeId`, so the server joins the name in before it cuts the
      // page — `typeName`, which is what the sort parameter carries and what the table calls it.
      sortable: true,
      sortKey: 'typeName',
      render: (v) => dash(typeName.get(v.typeId)),
    },
    {
      key: 'plate',
      align: 'center',
      header: t('fleet.vehicles.columns.plate'),
      render: (v) => v.plateNumber,
    },
    {
      key: 'chassis',
      align: 'center',
      header: t('fleet.vehicles.columns.chassis'),
      render: (v) => (
        <span className="font-mono text-xs" dir="ltr">
          {v.chassisNumber}
        </span>
      ),
    },
    {
      key: 'motor',
      align: 'center',
      header: t('fleet.vehicles.columns.motor'),
      render: (v) => (
        <span className="font-mono text-xs" dir="ltr">
          {v.motorNumber}
        </span>
      ),
    },
    {
      key: 'branch',
      align: 'center',
      className: WRAPS_ON_LAPTOP,
      header: t('fleet.vehicles.columns.branch'),
      render: (v) => dash(v.branchId === null ? undefined : branchName.get(v.branchId)),
    },
    {
      key: 'operation',
      align: 'center',
      className: WRAPS_ON_LAPTOP,
      header: t('fleet.vehicles.columns.operation'),
      render: (v) => dash(v.operationId === null ? undefined : operationName.get(v.operationId)),
    },
    {
      key: 'insurance',
      align: 'center',
      className: WRAPS_ON_LAPTOP,
      header: t('fleet.vehicles.columns.insurance'),
      render: (v) =>
        dash(v.insuranceCompanyId === null ? undefined : insurerName.get(v.insuranceCompanyId)),
    },
    {
      key: 'licenseClass',
      align: 'center',
      className: WRAPS_ON_LAPTOP,
      header: t('fleet.vehicles.columns.licenseClass'),
      render: (v) =>
        dash(v.licenseClassId === null ? undefined : licenseClassName.get(v.licenseClassId)),
    },
    {
      key: 'joinedAt',
      align: 'center',
      header: t('fleet.vehicles.columns.joinedAt'),
      render: (v) => (
        <span className="tabular-nums" dir="ltr">
          {ymd(v.joinedAt)}
        </span>
      ),
    },
    {
      key: 'licenseExpiresAt',
      align: 'center',
      header: t('fleet.vehicles.columns.license'),
      sortable: true,
      render: (v) => {
        const state = expiryState(v.licenseExpiresAt, 30);
        return (
          <span className="inline-flex items-center gap-1.5">
            <span
              dir="ltr"
              className={cn(
                'font-semibold',
                NUM,
                state === 'expired'
                  ? 'text-red-600 dark:text-red-400'
                  : state === 'soon'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-900 dark:text-slate-100',
              )}
            >
              {ymd(v.licenseExpiresAt)}
            </span>
            <span className="hidden min-[1750px]:inline">
              <LicenceTag state={state} />
            </span>
          </span>
        );
      },
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
    // «بيانات الادخال ثابته والفلاتر وراس العمود … بس هى اللى بتنزل وبطلع»: the page is the
    // screen's height, the toolbar, the figures and the filters keep their place, and only the
    // table's rows scroll, under a head that stays. A phone, reading cards, scrolls as before.
    <PageContainer fullHeight>
      <div
        className={cn(
          BOARD_FONT,
          'flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto lg:gap-3 text-slate-900 antialiased dark:text-slate-100 lg:overflow-hidden',
        )}
      >
        {/* The count and the two buttons ride ABOVE the filters, so the filters have the
            whole width and stay on one line on any screen larger than a tablet. */}
        <div
          className="flex shrink-0 items-center justify-between gap-1.5 sm:gap-2"
          data-vehicle-toolbar="true"
        >
          <span
            data-vehicle-count
            className="min-w-0 truncate whitespace-nowrap text-xs font-bold text-slate-600 dark:text-slate-300 sm:text-sm min-[1750px]:text-base"
          >
            {data === undefined
              ? ''
              : t('fleet.vehicles.count', { count: formatNumber(data.meta.totalItems, locale) })}
          </span>
          {sortChosen && (
            <button
              type="button"
              data-vehicle-sort-reset="true"
              title={t('fleet.vehicles.sortResetTitle')}
              onClick={() => patch({ sort: null }, false)}
              className="me-auto ms-2 inline-flex shrink-0 animate-fade-in items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 dark:text-brand-200 sm:text-xs"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t('fleet.vehicles.sortReset')}
            </button>
          )}
          <span className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              data-vehicle-breakdown-toggle="true"
              aria-expanded={breakdownOpen}
              onClick={() => setBreakdownOpen((open) => !open)}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-1.5 py-1.5 text-[11px] font-bold text-brand-700 dark:text-brand-200 transition hover:bg-brand-500/25 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs active:scale-95"
            >
              {breakdownOpen
                ? t('fleet.vehicles.board.breakdownHide')
                : t('fleet.vehicles.board.breakdown')}
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className={cn('h-3 w-3 transition-transform sm:h-3.5 sm:w-3.5', breakdownOpen && 'rotate-180')}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {data !== undefined && !isError && (
              <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 p-0.5">
                <button
                  type="button"
                  data-export="vehicles"
                  disabled={exporting !== null}
                  onClick={() => void exportSheet()}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 dark:text-slate-200 transition hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs active:scale-95"
                >
                  {exporting === 'excel' ? (
                    <Spinner className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <BoardIcon
                      d={PATH.excel}
                      className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                    />
                  )}
                  <span className="sm:hidden">Excel</span>
                  <span className="hidden sm:inline">{t('fleet.fuelCards.board.excel')}</span>
                </button>
                <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
                <button
                  type="button"
                  data-print="vehicles"
                  disabled={exporting !== null}
                  onClick={() => void printSheet()}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 dark:text-slate-200 transition hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs active:scale-95"
                >
                  {exporting === 'pdf' ? (
                    <Spinner className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                  ) : (
                    <BoardIcon
                      d={PATH.pdf}
                      className="h-3.5 w-3.5 text-red-600 dark:text-red-400"
                    />
                  )}
                  <span className="sm:hidden">PDF</span>
                  <span className="hidden sm:inline">{t('fleet.fuelCards.board.pdf')}</span>
                </button>
              </div>
            )}
            <Can permission="fleetVehicle.create">
              <button
                type="button"
                data-vehicle-add="true"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-2 py-1.5 text-[11px] font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-xs active:scale-95"
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                <span className="sm:hidden">{t('fleet.vehicles.board.addShort')}</span>
                <span className="hidden sm:inline">{t('fleet.vehicles.create')}</span>
              </button>
            </Can>
          </span>
        </div>
        {/* Every figure lives behind «الإحصائيات»: the screen opens on the cars themselves. */}
        {breakdownOpen && (
          <section data-vehicle-figures="true" className="shrink-0 animate-drop-in space-y-2">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <FigureChip
                icon={PATH.truck}
                iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                label={t('fleet.vehicles.board.total')}
                value={registryFigures.total}
                unit={t('fleet.vehicles.board.totalUnit')}
                note={t('fleet.vehicles.board.totalNote', {
                  active: String(registryFigures.active),
                  stopped: String(registryFigures.total - registryFigures.active),
                })}
              />
              <FigureChip
                icon={PATH.calendar}
                iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                label={t('fleet.vehicles.board.thisMonth')}
                value={registryFigures.thisMonth}
                valueClass="text-amber-600 dark:text-amber-400"
                unit={t('fleet.vehicles.board.licences')}
              />
              <FigureChip
                icon={PATH.warn}
                iconClass={
                  registryFigures.expired > 0
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                }
                label={t('fleet.vehicles.board.expired')}
                value={registryFigures.expired}
                valueClass={registryFigures.expired > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}
                unit={t('fleet.vehicles.board.licences')}
              />
              <FigureChip
                icon={PATH.edit}
                iconClass="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                label={t('fleet.vehicles.board.workshop')}
                value={registryFigures.workshop}
                unit={t('fleet.vehicles.board.totalUnit')}
              />
            </div>
            <div data-vehicle-breakdown="true" className="grid gap-2 md:grid-cols-3">
              <BreakdownCard
                title={t('fleet.vehicles.board.licenseClasses')}
                rows={breakdown.licenseClass}
                total={registryFigures.total}
              />
              <BreakdownCard
                title={t('fleet.vehicles.board.operations')}
                rows={breakdown.operation}
                total={registryFigures.total}
              />
              <BreakdownCard
                title={t('fleet.vehicles.board.insurers')}
                rows={breakdown.insurance}
                total={registryFigures.total}
              />
            </div>
          </section>
        )}
        <div
          className={cn(
            DARK_BAR,
            'shrink-0',
            'min-[1750px]:[&_input]:!text-[15px] min-[1750px]:[&_button[aria-haspopup]]:!text-[15px]',
            // Every filter's list opens with the same small drop the menus use.
            '[&_[role=listbox]]:animate-menu-in',
          )}
        >
          <FilterBar
            hasActiveFilters={hasActiveFilters}
            onClear={() =>
              patch({
                status: null,
                type: null,
                vehicleCodes: null,
                plate: null,
                chassis: null,
                motor: null,
                licenseClass: null,
                licenseMonths: null,
                licenseMonth: null,
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
            {/* «عايز الفلتر فى صف واحد … طبقاً لطول البيانات اللى ممكن تتكتب فيه»: every control is
              as wide as what it holds — a plate is ten characters, a code four — and the
              dropdowns run tight, so the whole bar is one row on a desktop screen. */}
            <FilterWithIcon icon={FILTER_ICON.car} tone="text-emerald-600 dark:text-emerald-400" className="w-24 shrink-0">
              <VehicleCodeFilter
                fullWidth
                density="tight"
                placeholder={t('fleet.vehicles.filters.short.code')}
                value={vehicleCodes}
                onChange={(next) =>
                  patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })
                }
              />
            </FilterWithIcon>
            {/* «عدل ترتيب الفلاتر على اساس العواميد»: the filters run in the table's column order,
              status last. The dropdowns are EVERY ONE of them multi-valued. «الفئة أ أو ب» and «المتاحة والمتوقفة» are single
              questions about the fleet, and a one-answer control made the reader ask each of them
              twice and add the two counts up by hand. Branch has taken several since it was
              written; the other five now read the same way. */}
            <FilterWithIcon icon={FILTER_ICON.make} tone="text-slate-600 dark:text-slate-300" className="w-24 shrink-0">
              <MultiSelect
                clearable
                className="w-full"
                fullWidth
                density="tight"
                showSelectedValues
                chips
                label={t('fleet.vehicles.filters.short.make')}
                options={(types.data?.items ?? []).map((type) => ({
                  value: type.id,
                  label: localized(type.name, locale),
                }))}
                value={typeIds}
                onChange={(ids) => patch({ type: writeList(ids) })}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.plate} tone="text-sky-600 dark:text-sky-400" className="w-24 shrink-0">
              <Input
                aria-label={t('fleet.vehicles.columns.plate')}
                placeholder={t('fleet.vehicles.columns.plate')}
                value={plate}
                onChange={(e) => patch({ plate: e.target.value || null })}
                rule="plate"
                density="tight"
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.chassis} tone="text-slate-500 dark:text-slate-400" className="w-24 shrink-0">
              <Input
                aria-label={t('fleet.vehicles.columns.chassis')}
                placeholder={t('fleet.vehicles.columns.chassis')}
                value={chassis}
                onChange={(e) => patch({ chassis: e.target.value || null })}
                rule="english"
                density="tight"
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.motor} tone="text-slate-500 dark:text-slate-400" className="w-24 shrink-0">
              <Input
                aria-label={t('fleet.vehicles.columns.motor')}
                placeholder={t('fleet.vehicles.columns.motor')}
                value={motor}
                onChange={(e) => patch({ motor: e.target.value || null })}
                rule="english"
                density="tight"
              />
            </FilterWithIcon>
            {/* `BranchFilterSelect` takes no width of its own; its trigger is sized from here. */}
            <FilterWithIcon icon={FILTER_ICON.branch} tone="text-violet-600 dark:text-violet-300" className="w-20 shrink-0 [&>div>div:not([role=listbox])]:flex [&>div>div:not([role=listbox])]:w-full [&_button[aria-haspopup]]:w-full [&_button[aria-haspopup]]:justify-between [&_button[aria-haspopup]]:!pe-2">
              <BranchFilterSelect
                clearable
                value={branchIds}
                onChange={(ids) => patch({ branch: writeList(ids) })}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.operation} tone="text-slate-600 dark:text-slate-300" className="w-24 shrink-0">
              <CatalogMultiSelect
                kind="operation"
                className="w-full"
                fullWidth
                density="tight"
                value={operationIds}
                onChange={(ids) => patch({ operation: writeList(ids) })}
                label={t('fleet.vehicles.filters.short.operation')}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.insurance} tone="text-emerald-700 dark:text-emerald-300" className="w-24 shrink-0">
              <CatalogMultiSelect
                kind="insuranceCompany"
                className="w-full"
                fullWidth
                density="tight"
                value={insuranceCompanyIds}
                onChange={(ids) => patch({ insurance: writeList(ids) })}
                label={t('fleet.vehicles.filters.short.insurance')}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.licence} tone="text-amber-700 dark:text-amber-300" className="w-24 shrink-0">
              <CatalogMultiSelect
                kind="licenseClass"
                className="w-full"
                fullWidth
                density="tight"
                value={licenseClassIds}
                onChange={(ids) => patch({ licenseClass: writeList(ids) })}
                label={t('fleet.vehicles.filters.short.licenseClass')}
              />
            </FilterWithIcon>
            {/* The months the licences run out in — several at once, each with its count of cars. */}
            <FilterWithIcon icon={FILTER_ICON.calendar} tone="text-cyan-600 dark:text-cyan-400" className="w-32 shrink-0">
              <MultiSelect
                clearable
                className="w-full"
                fullWidth
                density="tight"
                showSelectedValues
                searchThreshold={0}
                panelWidth="w-60"
                label={t('fleet.vehicles.filters.short.licenseMonth')}
                options={monthOptions}
                value={licenseMonths}
                onChange={(next) => patch({ licenseMonths: writeList(next), licenseMonth: null })}
              />
            </FilterWithIcon>
            {/* THREE statuses, so it takes several — the two-answer filters elsewhere in Fleet
              («داخل الورشة / خرج», «مفتوح / مغلق») stay as they are: with two options a
              multi-select can only say what a single one already said. */}
            <FilterWithIcon icon={FILTER_ICON.status} tone="text-slate-600 dark:text-slate-300" className="w-20 shrink-0">
              <MultiSelect
                clearable
                className="w-full"
                fullWidth
                density="tight"
                showSelectedValues
                label={t('fleet.vehicles.columns.status')}
                options={(['active', 'outOfService', 'disposed'] as const).map((value) => ({
                  value,
                  label: t(`fleet.vehicles.status.${value}`),
                }))}
                value={statuses}
                onChange={(next) => patch({ status: writeList(next) })}
              />
            </FilterWithIcon>
            {/* HOW MANY CARS THE FILTER MATCHES — «حط جمب الفلاتر عدد العربيات».
              
              It reads the SERVER's `totalItems`, never `rows.length`. The rows in hand are one
              page of at most 25, so counting them would answer «how many are on this screen»
              while looking like an answer to «how many are there» — and the two differ the
              moment a filter matches more than a page.
              
              `trailing`, so it lands in the same group as the reset and the active-filter count
              that `FilterBar` already draws there, rather than as a twelfth control in a row of
              eleven filters. */}
          </FilterBar>
        </div>

        {/* A computer's screen reads the table; a tablet or a phone reads one card per car. */}
        <div
          key={dataUpdatedAt}
          className={cn(
            'hidden animate-fade-in lg:flex lg:min-h-[14rem] lg:flex-1 lg:flex-col [&>div]:min-h-0 [&>div]:flex-1',
            DARK_TABLE,
          )}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(v) => v.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            sort={chosen}
            onSortChange={changeSort}
            empty={undefined}
            minColumnWidth={4}
            stickyHead
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:hidden" data-vehicle-cards="true">
          {rows.map((v) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              typeName={dash(typeName.get(v.typeId))}
              facts={[
                [t('fleet.vehicles.columns.plate'), v.plateNumber],
                [t('fleet.vehicles.columns.chassis'), v.chassisNumber],
                [t('fleet.vehicles.columns.motor'), v.motorNumber],
                [t('fleet.vehicles.columns.joinedAt'), ymd(v.joinedAt)],
                [
                  t('fleet.vehicles.columns.licenseClass'),
                  v.licenseClassId === null ? '—' : (licenseClassName.get(v.licenseClassId) ?? '—'),
                ],
                [
                  t('fleet.vehicles.columns.branch'),
                  v.branchId === null ? '—' : (branchName.get(v.branchId) ?? '—'),
                ],
                [
                  t('fleet.vehicles.columns.operation'),
                  v.operationId === null ? '—' : (operationName.get(v.operationId) ?? '—'),
                ],
                [
                  t('fleet.vehicles.columns.insurance'),
                  v.insuranceCompanyId === null
                    ? '—'
                    : (insurerName.get(v.insuranceCompanyId) ?? '—'),
                ],
              ]}
              licence={
                <span className="flex items-center gap-1.5">
                  <span dir="ltr" className={cn('font-semibold text-slate-900 dark:text-slate-100', NUM)}>
                    {ymd(v.licenseExpiresAt)}
                  </span>
                  <LicenceTag state={expiryState(v.licenseExpiresAt, 30)} />
                </span>
              }
              image={columns.find((c) => c.key === 'licenseImage')?.render(v, 0)}
              actions={columns.find((c) => c.key === 'actions')?.render(v, 0)}
            />
          ))}
        </div>
        {data !== undefined && data.meta.totalItems > 0 && (
          // «اصغر الحاجات اللى ليها علاقه بالتبويب وكبر الجدول»: the pager is one slim line under
          // the table, so the rows get the height.
          <div className="shrink-0 [&>div]:!py-0 [&_button]:!h-7 [&_button]:!min-w-7 [&_button]:!px-2 [&_button]:!text-xs [&_span]:!text-xs [&_select]:!h-7 [&_select]:!py-0 [&_select]:!text-xs [&_button[aria-haspopup]]:!h-7">
            <FleetPager
              meta={data.meta}
              onPageChange={(p) => patch({ page: String(p) }, false)}
              onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
            />
          </div>
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

/** The fuel screens' dark bar, laid over `FilterBar` and the controls inside it. */
const DARK_BAR = DARK_FILTER_BAR;

/** The fuel screens' dark table, laid over `DataTable` — the drivers screen's too. */
export const DARK_TABLE = cn(
  '[&>div]:!rounded-2xl [&>div]:!border-slate-200 dark:[&>div]:!border-slate-800 [&>div]:!bg-white dark:[&>div]:!bg-[#111827]',
  '[&_thead_tr]:!bg-slate-100 dark:[&_thead_tr]:!bg-[#0c121e] [&_thead_th]:!text-slate-500 dark:[&_thead_th]:!text-slate-400 [&_thead_button]:hover:!text-slate-900 dark:[&_thead_button]:hover:!text-slate-100',
  '[&_tbody_tr]:!border-slate-200 dark:[&_tbody_tr]:!border-slate-800 [&_tbody_tr:hover]:!bg-slate-100 dark:[&_tbody_tr:hover]:!bg-[#16203a] [&_tbody_td]:!text-slate-800 dark:[&_tbody_td]:!text-slate-200',
  '[&_th]:!px-1.5 [&_th]:!whitespace-normal [&_th]:!leading-tight [&_th]:!text-[13px] [&_th]:!font-bold [&_td]:!px-1.5 [&_td]:!py-2.5 [&_td]:whitespace-nowrap [&_td]:!text-sm [&_td]:!font-semibold',
  '[&_td_button]:!h-7 [&_td_button]:!w-7 [&_td_.gap-1]:!gap-0.5',
  // «لما عملت المتصفح على 110 ف الميه الداتا ظاهره احسن»: a wide screen takes the type a size up,
  // from where the whole table still fits beside the menu.
  // «خط شاشه السيارات زى خط رقم الفيزا»: the card number's type — the system monospace, heavy —
  // for every figure in the table; Arabic words fall through to Cairo.
  "[&_td]:[font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Cairo',monospace] [&_td]:!font-bold",
  'min-[1750px]:[&_td]:!text-[15px] min-[1750px]:[&_th]:!text-sm min-[1750px]:[&_td]:!py-3 min-[1750px]:[&_td_.font-mono]:!text-base',
  // «على اللاب … المسافات قربت»: below that, the heavy figures take a size down and the columns
  // more room between them, so nothing sits against its neighbour.
  // «الداتا … داخله فى بعض»: a faint line between columns, so every value reads as its own.
  '[&_td+td]:border-s [&_th+th]:border-s [&_td+td]:border-slate-200/70 [&_th+th]:border-slate-200/70 dark:[&_td+td]:border-slate-700/40 dark:[&_th+th]:border-slate-700/40',
  'max-[1749px]:[&_td]:!px-[9px] max-[1749px]:[&_th]:!px-[9px] max-[1749px]:[&_td]:!text-[12.5px] max-[1749px]:[&_td_.font-mono]:!text-[12.5px] max-[1749px]:[&_td_button]:!h-6 max-[1749px]:[&_td_button]:!w-[22px]',
);

/**
 * «الداتا … داخله فى بعض»: on a laptop a NAME may take two lines — a make, an insurer — so the
 * figures beside it get the room between columns instead of sitting against it.
 */
const WRAPS_ON_LAPTOP = 'max-[1749px]:!whitespace-normal max-[1749px]:leading-snug';

/** «ساري» / «ينتهي قريباً» / «منتهي» beside a licence date — the fuel screens' tag. */
/** A wrench — the workshop. */
const WRENCH = [
  'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
];

/** A laptop's code cell: the car's state as a dot, and the workshop as a wrench — words on hover. */
const CompactVehicleState = ({
  status,
  inWorkshop,
}: {
  status: FleetVehicleDto['status'];
  inWorkshop: boolean;
}): JSX.Element => {
  const t = useT();
  const label = t(`fleet.vehicles.status.${status}`);
  return (
    <span className="inline-flex items-center gap-1 min-[1750px]:hidden">
      <span
        title={label}
        data-vehicle-state-dot={status}
        className={cn(
          'h-2.5 w-2.5 rounded-full',
          status === 'active'
            ? 'bg-emerald-500'
            : status === 'outOfService'
              ? 'bg-amber-500'
              : 'bg-slate-400',
        )}
      >
        <span className="sr-only">{label}</span>
      </span>
      {inWorkshop && (
        <span
          title={t('fleet.vehicles.inWorkshop')}
          className="inline-flex rounded bg-sky-500/15 p-0.5 text-sky-600 dark:text-sky-300"
        >
          <BoardIcon d={WRENCH} className="h-3 w-3" />
          <span className="sr-only">{t('fleet.vehicles.inWorkshop')}</span>
        </span>
      )}
    </span>
  );
};

const LicenceTag = ({ state }: { state: ReturnType<typeof expiryState> }): JSX.Element | null => {
  const t = useT();
  if (state === 'unknown') return null;
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded border px-1 py-0 text-[10px] font-medium leading-4',
        state === 'valid' && 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400',
        state === 'soon' && 'border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400',
        state === 'expired' && 'border-red-200 dark:border-red-700/50 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400',
      )}
    >
      {t(`fleet.fuelCards.expiry.${state}`)}
    </span>
  );
};

/** One car on a tablet or a phone: the code and its state on top, the facts, then the actions. */
/** «خط شاشه السيارات زى خط رقم الفيزا»: the card's figures in the card number's type. */
const CARD_FONT =
  "[font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Cairo',monospace]";

const VehicleCard = ({
  vehicle,
  typeName,
  facts,
  licence,
  image,
  actions,
}: {
  vehicle: FleetVehicleDto;
  typeName: string;
  facts: readonly (readonly [string, string])[];
  licence: ReactNode;
  image: ReactNode;
  actions: ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <article
      data-vehicle-card={vehicle.id}
      className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-l from-slate-50 dark:from-slate-900 via-slate-50 dark:via-[#11192b] to-white dark:to-[#0c121e] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'shrink-0 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xl font-black tracking-wider text-slate-900 dark:text-white',
              NUM,
            )}
          >
            {vehicle.code}
          </span>
          <span className="truncate text-base font-bold text-slate-900 dark:text-white">{typeName}</span>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <VehicleStatusBadge status={vehicle.status} />
          <InWorkshopBadge inWorkshop={vehicle.inWorkshop} />
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-2">
        <div className="col-span-2 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b0f19] px-2.5 py-1.5 sm:col-span-3 md:col-span-2">
          <span className="block text-[10px] text-slate-500">
            {t('fleet.vehicles.columns.license')}
          </span>
          {licence}
        </div>
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b0f19] px-2.5 py-1.5"
          >
            <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
            <span
              dir="auto"
              className={cn(
                'block truncate text-sm font-bold text-slate-900 dark:text-slate-100',
                CARD_FONT,
              )}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 px-3 py-2 [&_button]:!text-slate-600 dark:[&_button]:!text-slate-300 [&_label]:!text-slate-600 dark:[&_label]:!text-slate-300">
        <span className="flex items-center gap-1 text-[11px] text-slate-500">
          {t('fleet.vehicles.columns.licenseImage')} {image}
        </span>
        {actions}
      </div>
    </article>
  );
};
