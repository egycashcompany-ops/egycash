// Maintenance visits (FW-6, legacy /cars_maintenance): the workshop lifecycle exactly as FL-4
// enforces it — one open visit per vehicle (FR-4), check-out records the exit reading and the
// custody, reopen undoes a mistaken check-out, and the closed counting visit is what resets the
// alarm cycle (owner point 5).
//
// Filtering is server-side throughout, including the two questions the visit collection cannot
// answer by itself: vehicle CODES resolve against the registry, and a driver NAME is HR's fact
// resolved through HR's own endpoint first. Nothing is filtered out of a fetched page.
//
// «حالة الصيانة» is ONE filter, not two, because the visit has exactly one state: design §4.2 gives
// it `open` ↔ `closed` and §2.6 stores no status beside them. «داخل الورشة» and «خرج من الورشة» are
// the two halves of that field. The derived alarm level (FR-3) is a property of the VEHICLE, not a
// maintenance status, and is deliberately not offered here as one.
//
// NO ALARM COLUMNS — «عاوز اشيل منذ الخدمه والمتبقى من الجدول». The distance since the last
// service and the distance left are the alarms board's to show; this register lists visits.
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  type FleetCatalogItemDto,
  type FleetMaintenanceVisitDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { ExportSheetButton } from '../components/ExportSheetButton';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { fetchEmployeeNames } from '../lib/fleet-people';
import * as fleetApi from '../api/fleet-api';
import { FilteredCount } from '../components/FilteredCount';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Dialog } from '../../../shared/ui/Dialog';
import { Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  CornerDownIcon,
  EditIcon,
  PlusIcon,
  TrashIcon,
  WrenchIcon,
} from '../../../shared/ui/icons';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import {
  useDeleteMaintenance,
  useFleetCatalog,
  useMaintenanceVisits,
  useReopenMaintenance,
} from '../api/fleet-queries';
import { RegistryDriverPicker } from '../components/RegistryDriverPicker';
import { CatalogMultiSelect } from '../components/CatalogMultiSelect';
import { DriverName } from '../components/EmployeeName';
import {
  CheckInDialog,
  CheckOutDialog,
  MaintenanceEditDialog,
} from '../components/MaintenanceDialogs';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { BranchFilterSelect } from '../../hr/recruitment/shared/BranchFilterSelect';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'branch',
  'drv',
  'from',
  'notes',
  'operation',
  'outFrom',
  'parts',
  'state',
  'vehicleCodes',
  'workTypes',
  'workshops',
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/** A csv URL parameter as the list it stands for; an absent one is an empty list, never `['']`. */
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');

/**
 * The order this screen opens in, before the reader has asked for one.
 *
 * Named, because it is used twice and the two must agree: the table is DRAWN in it, and a
 * first click REPLACES it rather than joining it — see `clickSort`.
 */
const DEFAULT_SORT = 'inDate:desc';

export const MaintenancePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  // The shared query cache, for the export's driver names — see `driverNames` below.
  const queryClient = useQueryClient();

  const from = sp.get('from') ?? '';
  const outFrom = sp.get('outFrom') ?? '';
  const vehicleCodes = csv(sp.get('vehicleCodes'));
  // «انا اقدر اعمل فلتر ب نوع التشغيل» — the car's «التشغيل», several at once, under the same
  // `operation` parameter the vehicles screen carries.
  const operationIds = csv(sp.get('operation'));
  // «وحطلى الفرع فى الفلاتر» — the car's branch, several at once, under the `branch` parameter
  // the vehicles screen carries.
  const branchIds = csv(sp.get('branch'));
  // WHO, as ids picked off the drivers registry — the same `drv` parameter the drivers screen
  // and the odometer carry, so a filtered link reads the same on all three.
  const drivers = csv(sp.get('drv'));
  const workshopIds = csv(sp.get('workshops'));
  const workTypeIds = csv(sp.get('workTypes'));
  const sparePartIds = csv(sp.get('parts'));
  const notes = sp.get('notes') ?? '';
  const state = sp.get('state') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  /**
   * The columns this table is sorted by, in the order the reader clicked them —
   * «انا عاوز اقدر اعمل الاتنين مع بعض». One parameter carries the whole order; `inDate:desc`
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
  // Ascending, then descending, then out of the order altogether — and a column the table
  // is NOT sorted by joins the end of it rather than replacing what is there.
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) }, false);
  };
  const hasActiveFilters =
    from !== '' ||
    outFrom !== '' ||
    vehicleCodes.length > 0 ||
    operationIds.length > 0 ||
    branchIds.length > 0 ||
    drivers.length > 0 ||
    workshopIds.length > 0 ||
    workTypeIds.length > 0 ||
    sparePartIds.length > 0 ||
    notes !== '' ||
    state !== '';

  // NO HR SEARCH STEP ANY MORE — see the same note on `OdometerPage`. A text box routed through
  // HR's `search` brought three states the reader had to be warned about (still answering, more
  // matches than one page, refused) and searched the whole payroll, so a name that belonged to
  // nobody with a driving seat returned an empty grid under a bar insisting a driver was picked.
  // Ids picked off the registry need no resolving and can only name people this table can show.
  // The picker reads FLEET's roster now, so the grant that decides whether it can be offered
  // is Fleet's own — a dispatcher with no HR permission still filters by driver.
  const mayFilterByDriver = can('fleetDriver.view');

  /** WHAT THE READER IS LOOKING AT — the filters, and only the filters. */
  const filters = useMemo(
    () => ({
      from: from || undefined,
      outFrom: outFrom || undefined,
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      operationIds: operationIds.length > 0 ? operationIds : undefined,
      branchIds: branchIds.length > 0 ? branchIds : undefined,
      workshopIds: workshopIds.length > 0 ? workshopIds : undefined,
      workTypeIds: workTypeIds.length > 0 ? workTypeIds : undefined,
      sparePartIds: sparePartIds.length > 0 ? sparePartIds : undefined,
      notes: notes || undefined,
      open: state === '' ? undefined : state === 'open',
      // Matched against the entry driver OR the exit driver, server-side.
      driverEmployeeIds: drivers.length > 0 ? drivers : undefined,
    }),
    [paramsKey],
  );
  const params = useMemo(
    () => ({ ...filters, page, pageSize, ...sortQuery(sorts) }),
    [filters, page, pageSize, sorts],
  );
  const { data, isLoading, isError, error, refetch } = useMaintenanceVisits(params);
  const rows = data?.items ?? [];

  // The three catalogs the screen names — the same admin-owned lists the Fleet Catalogs screen
  // edits, read through the same per-kind cached hook one request at a time.
  const workshops = useFleetCatalog('workshop');
  const workTypes = useFleetCatalog('workType');
  const spareParts = useFleetCatalog('sparePart');
  // «التشغيل» — the car's operation, for the column and the filter.
  const operations = useFleetCatalog('operation');
  const optionsOf = (items: readonly FleetCatalogItemDto[] | undefined) =>
    (items ?? []).map((item) => ({ value: item.id, label: localized(item.name, locale) }));
  const workshopOptions = useMemo(() => optionsOf(workshops.data?.items), [workshops.data, locale]);
  const workTypeOptions = useMemo(() => optionsOf(workTypes.data?.items), [workTypes.data, locale]);
  const sparePartOptions = useMemo(
    () => optionsOf(spareParts.data?.items),
    [spareParts.data, locale],
  );
  const catalogName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of [
      ...(workshops.data?.items ?? []),
      ...(workTypes.data?.items ?? []),
      ...(spareParts.data?.items ?? []),
      ...(operations.data?.items ?? []),
    ]) {
      map.set(item.id, localized(item.name, locale));
    }
    return map;
  }, [workshops.data, workTypes.data, spareParts.data, operations.data, locale]);

  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState<FleetMaintenanceVisitDto | null>(null);
  const [editing, setEditing] = useState<FleetMaintenanceVisitDto | null>(null);
  const [reopening, setReopening] = useState<FleetMaintenanceVisitDto | null>(null);
  const [deleting, setDeleting] = useState<FleetMaintenanceVisitDto | null>(null);
  const reopen = useReopenMaintenance();
  const remove = useDeleteMaintenance();

  const confirmReopen = async (): Promise<void> => {
    if (reopening === null) return;
    await reopen.mutateAsync({ id: reopening.id, version: reopening.version });
    toast.success(t('fleet.maintenance.reopened'));
    setReopening(null);
  };
  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.maintenance.deleted'));
    setDeleting(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';
  const dash = <span className="text-slate-400">—</span>;

  /**
   * The drivers' NAMES for the export, out of the SAME cache the cells read.
   *
   * A driver cell resolves its person through `useEmployeeRecord`, which is a HOOK — the export
   * runs in a callback, over rows that were never rendered, so it cannot call it. It asks for the
   * same list by the SAME query key, fetcher and staleTime instead. That is not a second cache:
   * the roster a cell already fetched serves the file, and the file makes the next cell free.
   *
   * ONE request, whatever the filter matched — Fleet's people are one list. Without the roster
   * grant it comes back empty, which is the same degradation the cells make rather than a failed
   * export.
   */
  const driverNames = async (
    visits: readonly FleetMaintenanceVisitDto[],
  ): Promise<Map<string, string>> => {
    return fetchEmployeeNames(
      queryClient,
      visits
        .flatMap((visit) => [visit.driverInEmployeeId, visit.driverOutEmployeeId])
        .filter((id): id is string => id !== null),
    );
  };

  /** One driver cell, resolved as the column resolves it — see `DriverName`. */
  const driverCell = (
    employeeId: string | null,
    legacyName: string | null,
    names: Map<string, string>,
  ): string =>
    employeeId === null ? (legacyName ?? '') : (names.get(employeeId) ?? employeeId.slice(-8));

  /**
   * «للشاشات دى اعملى اكسلات هتاخد اللى الفلتر عامله بس · ومفيش امضاءات».
   *
   * THE FILTER'S WHOLE ANSWER, not the page's. `params` carries the reader's filters, their sort
   * AND their page; `filtersOnly` drops the last of the three and `fetchFilteredRows` walks every
   * page, so a reader who narrows to three hundred visits gets three hundred rows rather than the
   * twenty-five in front of them. A file that is silently short is the worst kind of wrong,
   * because it looks complete. The sort rides along untouched: the file opens in the order the
   * reader is looking at, which is the order they will look for a row in.
   *
   * THE PARTS CELL IS SPLIT, because a spreadsheet cell cannot stack two records of one thing.
   * On screen the catalog parts and the words an older visit recorded as free text sit one above
   * the other under one heading; here each takes a column, so «مسجلة كنص» stays readable as what
   * it is instead of being run together with names the catalog knows.
   *
   * The exit column keeps its WORD. An open visit has no exit date and the table says «في الورشة»
   * rather than leaving the cell blank — that is a fact about the visit, not a missing value, and
   * a blank there would read as data nobody entered. The green row tint says the same thing twice
   * and carries nothing the word does not.
   *
   * Every genuine figure goes in as a NUMBER so the sheet stays summable — the counter. Nothing
   * here is money, so there are no money columns. The row's buttons are controls, not facts, so they are left out.
   */
  const exportSheet = async (): Promise<void> => {
    const all = await fetchFilteredRows((pageNo, size) =>
      fleetApi.listMaintenanceVisits({ ...filtersOnly(params), page: pageNo, pageSize: size }),
    );
    const names = await driverNames(all);
    saveSheet({
      name: t('fleet.nav.maintenance'),
      serialHeader: t('fleet.violations.report.serial'),
      header: [
        t('fleet.maintenance.fields.inDate'),
        t('fleet.maintenance.fields.outDate'),
        t('fleet.odometer.columns.vehicle'),
        t('fleet.maintenance.fields.operation'),
        t('fleet.maintenance.fields.driverIn'),
        t('fleet.maintenance.fields.driverOut'),
        t('fleet.maintenance.fields.workshop'),
        t('fleet.maintenance.fields.workType'),
        t('fleet.maintenance.fields.spareParts'),
        t('fleet.maintenance.legacyParts'),
        t('fleet.maintenance.fields.odometerAtService'),
        t('fleet.odometer.columns.notes'),
      ],
      rows: all.map((visit) => {
        return [
          formatDate(visit.inDate, locale),
          visit.outDate === null ? t('fleet.maintenance.open') : formatDate(visit.outDate, locale),
          visit.vehicleCode ?? '',
          visit.operationId === null ? '' : (catalogName.get(visit.operationId) ?? ''),
          driverCell(visit.driverInEmployeeId, visit.driverInName, names),
          driverCell(visit.driverOutEmployeeId, visit.driverOutName, names),
          catalogName.get(visit.workshopId) ?? '',
          catalogName.get(visit.workTypeId) ?? '',
          // An id the catalog cannot name is printed as the id, exactly as the cell prints it —
          // a part that was deleted from the list is still what this visit had fitted.
          visit.sparePartIds.map((id) => catalogName.get(id) ?? id).join('، '),
          visit.spareParts.join('، '),
          visit.odometerAtService,
          visit.notes ?? '',
        ];
      }),
    });
  };

  const columns: Column<FleetMaintenanceVisitDto>[] = [
    {
      key: 'inDate',
      header: t('fleet.maintenance.fields.inDate'),
      sortable: true,
      render: (visit) => <span className="tabular-nums">{formatDate(visit.inDate, locale)}</span>,
    },
    {
      key: 'outDate',
      header: t('fleet.maintenance.fields.outDate'),
      sortable: true,
      render: (visit) =>
        visit.outDate === null ? (
          <Badge tone="info">{t('fleet.maintenance.open')}</Badge>
        ) : (
          <span className="tabular-nums">{formatDate(visit.outDate, locale)}</span>
        ),
    },
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      // The car's CODE, joined in by the server before the page is cut — see the odometer board.
      sortable: true,
      sortKey: 'vehicleCode',
      // A SERVER fact on the row. `null` only when the vehicle no longer exists at all — a
      // scrapped one keeps its code, so history stays readable.
      render: (visit) => (
        <span className="font-mono text-xs" dir="ltr">
          {visit.vehicleCode ?? '—'}
        </span>
      ),
    },
    // «ضيف عمود فى الجدول ب نوع التشغيل» — the CAR's operation, beside its code. The server reads
    // it off the registry for the page like the code; it is the car's operation today, and a car
    // with none on file (or one the registry never had) prints a dash.
    {
      key: 'operation',
      header: t('fleet.maintenance.fields.operation'),
      render: (visit) =>
        visit.operationId === null ? dash : (catalogName.get(visit.operationId) ?? dash),
    },
    // TWO COLUMNS, ONE PER LEG — «تفصل الصباحى عن المسائى كل واحد فى عمود», the same split the
    // odometer register just took. The grid printed both drivers in one cell, one above the other,
    // which reads perfectly well and cannot be ORDERED: a cell holding two people has no single
    // value for «رتب بإسم السائق» to point at. Each leg is now its own column with its own arrow,
    // and the arrow orders the whole register — the name is joined in by the server before the
    // page is cut.
    //
    // The tones are the ones the shared cell used: the entry driver in the danger tone, the exit
    // driver in the success tone. Deliberately NOT `takenInByEmployeeId` / `takenOutByEmployeeId`:
    // those are the custody employees, they belong to the audit trail, and this grid never showed
    // them. An open visit has no exit driver yet, and that is a dash.
    {
      key: 'driverIn',
      header: t('fleet.maintenance.fields.driverIn'),
      sortable: true,
      sortKey: 'driverInName',
      render: (visit) =>
        visit.driverInEmployeeId === null && !visit.driverInName ? (
          dash
        ) : (
          <span className="text-red-700 dark:text-red-300">
            <DriverName employeeId={visit.driverInEmployeeId} name={visit.driverInName} />
          </span>
        ),
    },
    {
      key: 'driverOut',
      header: t('fleet.maintenance.fields.driverOut'),
      sortable: true,
      sortKey: 'driverOutName',
      render: (visit) =>
        visit.driverOutEmployeeId === null && !visit.driverOutName ? (
          dash
        ) : (
          <span className="text-emerald-700 dark:text-emerald-300">
            <DriverName employeeId={visit.driverOutEmployeeId} name={visit.driverOutName} />
          </span>
        ),
    },
    {
      key: 'workshop',
      header: t('fleet.maintenance.fields.workshop'),
      render: (visit) => catalogName.get(visit.workshopId) ?? dash,
    },
    {
      key: 'workType',
      header: t('fleet.maintenance.fields.workType'),
      render: (visit) => catalogName.get(visit.workTypeId) ?? dash,
    },
    {
      key: 'spareParts',
      header: t('fleet.maintenance.fields.spareParts'),
      // Catalog parts first, then whatever an older visit recorded as free text. The old words
      // are the only record of what was fitted on those visits, so they are SHOWN rather than
      // migrated by name — a name match would have silently dropped everything it could not pair.
      render: (visit) => {
        const named = visit.sparePartIds.map((id) => catalogName.get(id) ?? id);
        const legacy = visit.spareParts;
        if (named.length === 0 && legacy.length === 0) return dash;
        return (
          <span className="flex flex-col gap-0.5">
            {named.length > 0 && (
              <span className="block max-w-xs break-words">{named.join('، ')}</span>
            )}
            {legacy.length > 0 && (
              <span className="block max-w-xs break-words text-xs text-slate-500 dark:text-slate-400">
                {t('fleet.maintenance.legacyParts')}: {legacy.join('، ')}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'odometerAtService',
      header: t('fleet.maintenance.fields.odometerAtService'),
      // A stored figure on the visit, so the whole register orders by it for free.
      sortable: true,
      align: 'end',
      render: (visit) => formatNumber(visit.odometerAtService, locale),
    },
    {
      key: 'notes',
      // LAST of the data columns, by request — «الملاحظات تكون اخر حاجه خالص». It is also where
      // it does least harm: the one free-text column, and a table column is sized by its content,
      // so an unbroken run of characters has no break point to wrap at and the column grows to fit
      // it. A bounded box allowed to break inside a word keeps the rest of the row honest, and at
      // the end there is nothing left for it to push off the screen anyway.
      //
      // `actions` still follows it: those are the row's CONTROLS, not a fact about the visit, and
      // they sit at the end of every other grid in the module.
      header: t('fleet.odometer.columns.notes'),
      render: (visit) =>
        visit.notes === null ? (
          dash
        ) : (
          <span className="block max-w-xs break-words">{visit.notes}</span>
        ),
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (visit) => (
        <span className="flex items-center justify-end gap-1">
          {can('fleetMaintenance.checkOut') && visit.outDate === null && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.maintenance.checkOut')}
              title={t('fleet.maintenance.checkOut')}
              onClick={() => setCheckingOut(visit)}
            >
              <WrenchIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetMaintenance.checkOut') && visit.outDate !== null && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.maintenance.reopen')}
              title={t('fleet.maintenance.reopen')}
              onClick={() => setReopening(visit)}
            >
              <CornerDownIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetMaintenance.edit') && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.maintenance.edit')}
              title={t('fleet.maintenance.edit')}
              onClick={() => setEditing(visit)}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetMaintenance.delete') && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('common.delete')}
              title={t('common.delete')}
              onClick={() => setDeleting(visit)}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
    },
  ];

  /**
   * One date BOUND. The width lives on the wrapper: `Input` is `w-full` at its base and `cn` does
   * not merge Tailwind classes, so a `w-*` passed to it would only compete with that. `w-36` is
   * the floor — Chromium refuses to paint `type="date"` narrower than about 144px.
   *
   * «عاوز الفلاتر التواريخ تاريخ الدخول تكون مكتوبه على المكان اللى هسجل فيه التاريخ مش جمبها».
   * The caption is written INSIDE the field, where the date goes, not beside it. A date input has
   * no placeholder — Chromium paints «yyyy-mm-dd» there whatever it is given — so while the field
   * is empty and not being typed in, that mask is made invisible and the caption is drawn over it.
   * The moment the reader clicks in (or a date is set) the caption goes and the mask comes back,
   * so typing a date works exactly as before. The caption is decoration only: the field keeps its
   * `aria-label`, and clicks pass straight through the caption to the field underneath.
   */
  const dateBound = (labelKey: string, value: string, param: string): JSX.Element => (
    <span className="relative w-36">
      <Input
        type="date"
        dir="ltr"
        aria-label={t(labelKey)}
        title={t(labelKey)}
        value={value}
        onChange={(e) => patch({ [param]: e.target.value || null })}
        className={
          value === '' ? 'peer [&:not(:focus)::-webkit-datetime-edit]:opacity-0' : undefined
        }
      />
      {value === '' && (
        <span
          aria-hidden="true"
          data-date-caption={param}
          className="pointer-events-none absolute inset-y-0 left-2 right-8 flex items-center justify-center truncate text-sm text-slate-400 peer-focus:hidden dark:text-slate-500"
        >
          {t(labelKey)}
        </span>
      )}
    </span>
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.maintenance')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.maintenance') },
        ]}
        actions={
          <>
            {/* NOT OFFERED WHEN THE LIST FAILED. A green button on a screen that has just
                told the reader it has no data reads as a way out of the failure, and the
                file behind it would be empty or short. Disabling is not enough — it still
                draws. */}
            {!isError && <ExportSheetButton name="maintenance" onExport={exportSheet} />}
            <Can permission="fleetMaintenance.checkIn">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setCheckInOpen(true)}
              >
                {t('fleet.maintenance.checkIn')}
              </Button>
            </Can>
          </>
        }
      />

      <div className="space-y-4">
        {/* Ten filters, in the order the question is asked, each sized to what it holds so the row
            packs as tightly as it honestly can: the two date ranges and the counter range are ONE
            caption apiece rather than two, and nothing takes the leftover space.
            
            They are NOT pinned to one row. `flex-nowrap` does not shorten a row that will not fit,
            it pushes it off the page — so the bar wraps, filling a wide desktop left to right and
            flowing onto a second line only where the viewport actually runs out. No horizontal
            page scroll, nothing clipped, nothing overlapping. */}
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() =>
            patch({
              from: null,
              outFrom: null,
              vehicleCodes: null,
              operation: null,
              branch: null,
              drv: null,
              workshops: null,
              workTypes: null,
              parts: null,
              notes: null,
              state: null,
            })
          }
          // How many visits the filter matched, over the WHOLE set — see the odometer register.
          trailing={<FilteredCount value={data?.meta.totalItems} />}
        >
          {/* One bound, not a range: the screen asks "checked in from this date". The caption is
              inside the field — see `dateBound`. */}
          {dateBound('fleet.maintenance.inRange', from, 'from')}
          {dateBound('fleet.maintenance.outRange', outFrom, 'outFrom')}
          <VehicleCodeFilter
            className="shrink-0"
            value={vehicleCodes}
            onChange={(next) => patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })}
          />
          <CatalogMultiSelect
            kind="operation"
            value={operationIds}
            onChange={(next) => patch({ operation: next.length === 0 ? null : next.join(',') })}
            label={t('fleet.vehicles.filters.operation')}
          />
          <BranchFilterSelect
            clearable
            value={branchIds}
            onChange={(next) => patch({ branch: next.length === 0 ? null : next.join(',') })}
          />
          {/* Several drivers at once: a visit is matched on its ENTRY driver or its EXIT driver,
              so asking about a crew is one question, not two searches run in turn. */}
          {mayFilterByDriver && (
            <div className="w-52 min-w-0">
              <RegistryDriverPicker
                multiple
                fullWidth
                value={drivers}
                onChange={(next) => patch({ drv: next.length === 0 ? null : next.join(',') })}
              />
            </div>
          )}
          <MultiSelect
            clearable
            className="shrink-0"
            showSelectedValues
            label={t('fleet.maintenance.fields.workshop')}
            options={workshopOptions}
            value={workshopIds}
            onChange={(next) => patch({ workshops: next.length === 0 ? null : next.join(',') })}
          />
          <MultiSelect
            clearable
            className="shrink-0"
            showSelectedValues
            label={t('fleet.maintenance.fields.workType')}
            options={workTypeOptions}
            value={workTypeIds}
            onChange={(next) => patch({ workTypes: next.length === 0 ? null : next.join(',') })}
          />
          <MultiSelect
            clearable
            className="shrink-0"
            showSelectedValues
            label={t('fleet.maintenance.fields.spareParts')}
            clearSearchOnPick
            options={sparePartOptions}
            value={sparePartIds}
            onChange={(next) => patch({ parts: next.length === 0 ? null : next.join(',') })}
          />
          <div className="w-40 min-w-0">
            <Input
              aria-label={t('fleet.odometer.columns.notes')}
              placeholder={t('fleet.maintenance.notesFilter')}
              value={notes}
              onChange={(e) => patch({ notes: e.target.value || null })}
            />
          </div>
          {/* «حالة الصيانة» — the visit's one state, in the words the screen uses for it. */}
          <Select
            aria-label={t('fleet.maintenance.stateFilter')}
            title={t('fleet.maintenance.stateFilter')}
            value={state}
            onChange={(e) => patch({ state: e.target.value || null })}
            className="w-auto shrink-0"
          >
            <option value="">{t('fleet.maintenance.allStates')}</option>
            <option value="open">{t('fleet.maintenance.stillIn')}</option>
            <option value="closed">{t('fleet.maintenance.leftWorkshop')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(visit) => visit.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sorts}
          onSortChange={changeSort}
          // A closed visit reads green across the whole row. The colour is a SECOND signal only:
          // the exit cell says «خرجت من الورشة» in words, so the state survives a reader who
          // cannot separate the two tints.
          rowClassName={(visit) =>
            visit.outDate === null ? undefined : 'bg-emerald-50/70 dark:bg-emerald-950/30'
          }
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <CheckInDialog
        open={checkInOpen}
        onClose={() => setCheckInOpen(false)}
        // Carried over from the filter, but only when it names ONE car: with several selected
        // there is no single answer to preselect, and guessing one would be worse than asking.
        initialVehicleCode={vehicleCodes.length === 1 ? (vehicleCodes[0] ?? '') : ''}
      />
      <CheckOutDialog
        open={checkingOut !== null}
        onClose={() => setCheckingOut(null)}
        visit={checkingOut}
      />
      <MaintenanceEditDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        visit={editing}
      />
      <Dialog
        open={reopening !== null}
        onClose={() => setReopening(null)}
        title={t('fleet.maintenance.reopenTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReopening(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={reopen.isPending} onClick={() => void confirmReopen()}>
              {t('fleet.maintenance.reopen')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.maintenance.reopenBody')}
        </p>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.maintenance.deleteTitle')}
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
          {t('fleet.maintenance.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
