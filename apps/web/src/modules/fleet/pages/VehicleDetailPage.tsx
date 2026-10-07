// Vehicle profile (FW-4, legacy /one_car): everything the platform knows about one car, all of
// it live server facts — identity and license from the registry, the type's maintenance rule
// from the catalog, the DERIVED workshop flag, the expected odometer reading, the FR-3 alarm
// projection, and the last closed maintenance visit. Each indicator gates its own §7 permission
// so nothing is fetched the caller may not see. Edit and status changes reuse the FW-3 dialogs
// (version-aware against the freshly loaded document). The history links to odometer,
// maintenance, accidents, violations and roster appear per SHIPPED_LINKS as their slices land —
// the owner's navigation rule: nothing unshipped is ever reachable.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type FleetVehicleDto, type Locale, type LocalizedString } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { formatDate, formatDateTime, formatNumber, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useBranches } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import {
  useExpectedReading,
  useFleetCatalog,
  useRosterDay,
  useCanReadAlarms,
  useMaintenanceAlarms,
  useAccidents,
  useMaintenanceVisits,
  useOdometerLogs,
  useVehicle,
  useVehicleTypes,
  useViolations,
} from '../api/fleet-queries';
import { toast } from '../../../shared/ui/toast/toast-store';
import { InWorkshopBadge, VehicleStatusBadge } from '../components/VehicleStatusBadge';
import { fetchVehicleLicenseImage } from '../api/fleet-api';
import { printLicenceRecord } from '../components/vehicle-print';
import { BoardIcon } from '../components/FuelCardBoard';
import {
  PROFILE_ICON,
  RecordRow,
  SURFACE,
  VehicleItem,
  VehicleKpi,
  VehicleSection,
} from '../components/ProfileCard';
import { VehicleFormDialog } from '../components/VehicleFormDialog';
import { VehicleStatusDialog } from '../components/VehicleStatusDialog';
import { LicenseImagePreviewDialog } from '../components/VehicleLicenseImage';

/**
 * The profile's history links, lit per slice as each page ships (owner navigation rule). Each
 * target is a URL-synced list, so the link pre-filters it to this vehicle.
 */
const HISTORY_LINKS: {
  key: 'odometer' | 'maintenance' | 'accidents' | 'violations' | 'roster';
  icon: readonly string[];
  to: (vehicle: FleetVehicleDto) => string;
  permission: string;
  shipped: boolean;
}[] = [
  {
    key: 'odometer',
    icon: PROFILE_ICON.bolt,
    to: (v) => `/fleet/odometer?vehicle=${v.id}`,
    permission: 'fleetOdometer.view',
    shipped: true, // FW-6
  },
  {
    key: 'maintenance',
    icon: PROFILE_ICON.gear,
    to: (v) => `/fleet/maintenance?vehicle=${v.id}`,
    permission: 'fleetMaintenance.view',
    shipped: true, // FW-6
  },
  {
    key: 'accidents',
    icon: PROFILE_ICON.warn,
    to: (v) => `/fleet/accidents?vehicle=${v.id}`,
    permission: 'fleetAccident.view',
    shipped: true, // FW-8
  },
  {
    key: 'violations',
    icon: PROFILE_ICON.doc,
    to: (v) => `/fleet/violations?vehicle=${v.id}`,
    permission: 'fleetViolation.view',
    shipped: true, // FW-9
  },
  {
    key: 'roster',
    icon: PROFILE_ICON.person,
    // The roster board is day-keyed, so the pre-filter is the vehicle's code in the search.
    to: (v) => `/fleet/roster?q=${encodeURIComponent(v.code)}`,
    permission: 'fleetRoster.view',
    shipped: true, // FW-7
  },
];

export const Indicators = ({ vehicle }: { vehicle: FleetVehicleDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const canOdometer = can('fleetOdometer.view');
  const canMaintenance = can('fleetMaintenance.view');
  // The last READING is the odometer log's own fact; the ALARM is the derived projection, which
  // either audience may read. Gating both on the odometer permission hid a maintenance fact
  // behind a log permission.
  const canAlarms = useCanReadAlarms();

  const expected = useExpectedReading(vehicle.id, canOdometer);
  const alarms = useMaintenanceAlarms();
  const lastVisit = useMaintenanceVisits(
    { vehicleId: vehicle.id, open: false, pageSize: 1, sortBy: 'outDate', sortDir: 'desc' },
    canMaintenance,
  );

  const alarm = alarms.data?.find((a) => a.vehicleId === vehicle.id);
  const alarmValue =
    alarms.data === undefined
      ? undefined
      : alarm === undefined || alarm.level === 'none'
        ? t('fleet.vehicle.alarmNone')
        : t(`fleet.dashboard.level.${alarm.level}`);
  const alarmCaption =
    alarm !== undefined && alarm.noAlarmReason !== null
      ? // «لا يوجد» means two different things and the tile used to say only the word: a car with a
        // healthy cycle, and a car whose cycle could not be measured at all. The server names the
        // guard that stopped it, the alarms board prints that name, and this tile — where the empty
        // caption sat — says the same sentence rather than leaving the reader to guess which of the
        // two they are looking at. Read from the projection, never inferred here.
        t(`fleet.alarms.noAlarmReason.${alarm.noAlarmReason}`)
      : alarm === undefined || alarm.remainingKm === null
        ? undefined
        : alarm.remainingKm < 0
          ? t('fleet.dashboard.overdueKm', {
              km: formatNumber(Math.abs(alarm.remainingKm), locale),
            })
          : t('fleet.dashboard.remainingKm', { km: formatNumber(alarm.remainingKm, locale) });
  const visit = lastVisit.data?.items[0];
  /**
   * The service this tile names must be the one the countdown beside it is measured FROM.
   *
   * The visits query answers a different question — "the last closed visit of any kind" — and the
   * two part company the moment a NON-counting visit closes after the baseline: the alarm keeps
   * counting from the periodic service, while this tile moved on to the panel-beating that closed
   * last week. Two «آخر صيانة» on one screen, one of them contradicting the remaining-km figure
   * printed inches away, and a third answer on the alarms board.
   *
   * So the date comes from the projection, which is the server's own choice of baseline, and the
   * counter is shown only when the visit this page happens to hold IS that baseline — identified
   * by `lastServiceVisitId`, not by re-deciding which visit counts. A vehicle with no alarm row at
   * all (the projection covers ACTIVE vehicles) keeps the visit-derived answer it has always had.
   */
  const baselineVisit =
    visit === undefined || visit.outDate === null
      ? undefined
      : // No alarm row at all: nothing to contradict, and this tile is the only place the visit is
        // shown. A row that names a DIFFERENT visit as the baseline is what the counter must not
        // be printed under.
        alarm === undefined || alarm.lastServiceVisitId === visit.id
        ? visit
        : undefined;
  const lastServiceValue =
    alarm !== undefined
      ? alarm.lastServiceAt === null
        ? t('fleet.vehicle.noService')
        : formatDate(alarm.lastServiceAt, locale)
      : alarms.data === undefined || lastVisit.data === undefined
        ? undefined
        : visit?.outDate == null
          ? t('fleet.vehicle.noService')
          : formatDate(visit.outDate, locale);

  // The caption under the alarm figure: amber when it names a reason or a coming service, red
  // once the service is overdue.
  const alarmTone =
    alarm === undefined
      ? undefined
      : alarm.remainingKm !== null && alarm.remainingKm < 0
        ? 'text-red-500'
        : alarm.noAlarmReason !== null || alarm.level !== 'none'
          ? 'text-amber-500/90'
          : undefined;
  const reading = expected.data?.expectedReading;

  return (
    <section
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      data-purpose="stat-cards"
    >
      <VehicleKpi
        icon={PROFILE_ICON.gear}
        hoverTone="group-hover:border-emerald-500/30 group-hover:text-emerald-400"
        label={t('fleet.dashboard.inWorkshop')}
        value={vehicle.inWorkshop ? t('common.yes') : t('common.no')}
        caption={t('fleet.vehicle.inWorkshopHint')}
      />
      {canOdometer && (
        <VehicleKpi
          icon={PROFILE_ICON.clock}
          hoverTone="group-hover:border-blue-500/30 group-hover:text-blue-400"
          label={t('fleet.vehicle.lastReading')}
          value={
            expected.data === undefined
              ? undefined
              : reading === null || reading === undefined
                ? t('fleet.vehicle.noReadings')
                : formatNumber(reading, locale)
          }
          unit={reading === null || reading === undefined ? undefined : t('fleet.vehicle.km')}
          caption={t('fleet.vehicle.lastReadingHint')}
        />
      )}
      {canAlarms && (
        <VehicleKpi
          icon={PROFILE_ICON.warn}
          hoverTone="group-hover:border-amber-500/30 group-hover:text-amber-400"
          label={t('fleet.dashboard.alarms')}
          value={alarmValue}
          caption={alarmCaption}
          captionTone={alarmTone}
        />
      )}
      {canMaintenance && (
        <VehicleKpi
          icon={PROFILE_ICON.calendar}
          hoverTone="group-hover:border-purple-500/30 group-hover:text-purple-400"
          label={t('fleet.vehicle.lastService')}
          value={lastServiceValue}
          caption={
            baselineVisit === undefined
              ? undefined
              : // The reading the car LEFT the workshop on — of the visit the SERVER named as the
                // baseline, so this number and the countdown above it describe one service. Visits
                // closed before that reading was collected carry `null` and fall back to the
                // arrival reading, which is what those rows have always shown.
                t('fleet.vehicle.lastServiceAt', {
                  km: formatNumber(
                    baselineVisit.exitOdometer ?? baselineVisit.odometerAtService,
                    locale,
                  ),
                })
          }
        />
      )}
    </section>
  );
};

/**
 * How many records each history row leads to — the list's own total for this car, asked with a
 * one-row page so nothing but the count travels. Each is asked only under its own permission.
 */
const useHistoryCounts = (
  vehicleId: string,
  can: (permission: string) => boolean,
): Partial<Record<(typeof HISTORY_LINKS)[number]['key'], number>> => {
  const one = { vehicleId, page: 1, pageSize: 1 };
  const odometer = useOdometerLogs(one, can('fleetOdometer.view') && vehicleId !== '');
  const maintenance = useMaintenanceVisits(one, can('fleetMaintenance.view') && vehicleId !== '');
  const accidents = useAccidents(one, can('fleetAccident.view') && vehicleId !== '');
  const violations = useViolations(one, can('fleetViolation.view') && vehicleId !== '');
  return {
    ...(odometer.data === undefined ? {} : { odometer: odometer.data.meta.totalItems }),
    ...(maintenance.data === undefined ? {} : { maintenance: maintenance.data.meta.totalItems }),
    ...(accidents.data === undefined ? {} : { accidents: accidents.data.meta.totalItems }),
    ...(violations.data === undefined ? {} : { violations: violations.data.meta.totalItems }),
  };
};

export const VehicleDetailPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();

  const { data: vehicle, isPending, isError, error, refetch } = useVehicle(id);
  const counts = useHistoryCounts(vehicle?.id ?? '', can);
  // «تعيين السيارات — سائق نشط»: today's roster, when the reader may read it.
  const today = (() => {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  })();
  const rosterToday = useRosterDay(can('fleetRoster.view') ? today : '');
  const types = useVehicleTypes();
  const { data: branches = [] } = useBranches(can('branch.view'));
  // The three catalog references, resolved to names from the same cached per-kind lists the
  // registry's columns and the form's selects read — one request per kind for the whole app.
  const licenseClasses = useFleetCatalog('licenseClass');
  const operations = useFleetCatalog('operation');
  const insurers = useFleetCatalog('insuranceCompany');

  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  if (isPending) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || vehicle === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const type = types.data?.items.find((item) => item.id === vehicle.typeId);
  const branch = branches.find((b) => b.id === vehicle.branchId);
  const catalogName = (
    list: { items: { id: string; name: LocalizedString }[] } | undefined,
    itemId: string | null,
  ): string | undefined => {
    if (itemId === null) return undefined;
    const item = list?.items.find((row) => row.id === itemId);
    return item === undefined ? undefined : localized(item.name, locale);
  };
  const licenseClassName = catalogName(licenseClasses.data, vehicle.licenseClassId);
  const operationName = catalogName(operations.data, vehicle.operationId);
  const insurerName = catalogName(insurers.data, vehicle.insuranceCompanyId);
  const licenseExpired = new Date(vehicle.licenseExpiresAt).getTime() < Date.now();
  const historyLinks = HISTORY_LINKS.filter((link) => link.shipped && can(link.permission));

  const todayRow = rosterToday.data?.rows.find((row) => row.vehicleId === vehicle.id);
  const hasDriverToday =
    todayRow !== undefined &&
    (todayRow.driver1EmployeeId !== null || todayRow.driver2EmployeeId !== null);
  const countTag = (
    key: (typeof HISTORY_LINKS)[number]['key'],
  ): { tag?: string; tagTone?: string } => {
    if (key === 'roster') {
      return hasDriverToday
        ? {
            tag: t('fleet.vehicle.count.activeDriver'),
            tagTone:
              'border-indigo-500/20 bg-indigo-500/10 font-medium text-indigo-500 dark:text-indigo-400',
          }
        : {};
    }
    const n = counts[key];
    if (n === undefined) return {};
    // «سجل نظيف»: a car with no accident says so, in the state's green.
    if (key === 'accidents' && n === 0) {
      return {
        tag: t('fleet.vehicle.count.accidentsClean'),
        tagTone:
          'border-emerald-500/20 bg-emerald-500/10 font-medium text-emerald-600 dark:text-emerald-400',
      };
    }
    return { tag: t(`fleet.vehicle.count.${key}`, { count: String(n) }) };
  };
  const make = type === undefined ? '—' : localized(type.name, locale);
  /** «طباعة التقرير»: the car's whole file, the same sheet the registry's print button opens. */
  const printReport = async (): Promise<void> => {
    try {
      await printLicenceRecord({
        locale,
        title: t('fleet.vehicles.print.title'),
        subtitle: t('fleet.vehicles.licenseImage.previewSubtitle', { code: vehicle.code, make }),
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
          { label: t('fleet.vehicles.columns.licenseClass'), value: licenseClassName ?? '—' },
          { label: t('fleet.vehicles.columns.operation'), value: operationName ?? '—' },
          { label: t('fleet.vehicles.columns.insurance'), value: insurerName ?? '—' },
          {
            label: t('fleet.vehicles.columns.branch'),
            value: branch === undefined ? '—' : localized(branch.name, locale),
          },
          { label: t('fleet.vehicles.fields.issi'), value: vehicle.radio.issi ?? '—' },
          { label: t('fleet.vehicles.fields.motorolaSn'), value: vehicle.radio.motorolaSn ?? '—' },
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
  const chevron = (
    <BoardIcon
      d={['M9 5l7 7-7 7']}
      className="h-3.5 w-3.5 rotate-180 text-slate-400 dark:text-slate-600"
    />
  );
  const active = vehicle.status === 'active';

  return (
    <PageContainer>
      <div className="space-y-6">
        {/* «عاوز اعمل الشاشتين دول … زى ما هى»: the reference's head, word for word. */}
        <header
          className={cn(
            'flex flex-col gap-4 border-b pb-4 md:flex-row md:items-center md:justify-between',
            SURFACE.border,
          )}
          data-purpose="header-section"
        >
          <div className="space-y-1">
            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-2 text-xs font-medium text-slate-500 md:text-sm dark:text-slate-400"
            >
              <Link to="/fleet" className="transition-colors hover:text-indigo-400">
                {t('fleet.module.title')}
              </Link>
              {chevron}
              <Link to="/fleet/vehicles" className="transition-colors hover:text-indigo-400">
                {t('fleet.nav.vehicles')}
              </Link>
              {chevron}
              <span className="font-semibold text-indigo-500 dark:text-indigo-400">
                {vehicle.code}
              </span>
            </nav>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <h1 className="flex items-center gap-3 text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl dark:text-white">
                {t('fleet.vehicle.title', { code: vehicle.code })}
                <span
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs font-normal text-slate-500 md:text-sm dark:text-slate-400',
                    SURFACE.card,
                    SURFACE.border,
                  )}
                >
                  {t('fleet.vehicle.codeChip', { code: vehicle.code })}
                </span>
              </h1>
              {active ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 shadow-sm shadow-emerald-500/5 dark:text-emerald-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  {t(`fleet.vehicles.status.${vehicle.status}`)}
                </span>
              ) : (
                <VehicleStatusBadge status={vehicle.status} />
              )}
              <InWorkshopBadge inWorkshop={vehicle.inWorkshop} />
            </div>
            {vehicle.statusReason !== null && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('fleet.vehicle.statusReason')}: {vehicle.statusReason}
              </p>
            )}
          </div>
          <div
            className="flex flex-wrap items-center gap-2.5 sm:gap-3"
            data-purpose="quick-actions"
          >
            <button
              type="button"
              data-vehicle-print="true"
              onClick={() => void printReport()}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-400 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-[#162032]',
                SURFACE.card,
                SURFACE.border,
              )}
            >
              <BoardIcon d={PROFILE_ICON.printer} className="h-4 w-4 text-slate-400" />
              {t('fleet.vehicle.printReport')}
            </button>
            {vehicle.status !== 'disposed' && (
              <>
                <Can permission="fleetVehicle.changeStatus">
                  <button
                    type="button"
                    data-vehicle-change-status="true"
                    onClick={() => setStatusOpen(true)}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-sm font-medium text-amber-600 shadow-sm transition-all duration-200 hover:bg-amber-500/20 dark:text-amber-300"
                  >
                    <BoardIcon
                      d={PROFILE_ICON.refresh}
                      className="h-4 w-4 text-amber-500 dark:text-amber-400"
                    />
                    {t('fleet.vehicles.changeStatus')}
                  </button>
                </Can>
                <Can permission="fleetVehicle.edit">
                  <button
                    type="button"
                    data-vehicle-edit="true"
                    onClick={() => setEditOpen(true)}
                    className="inline-flex items-center gap-2 rounded-lg border border-indigo-500 bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-indigo-600/20 transition-all duration-200 hover:bg-indigo-500"
                  >
                    <BoardIcon d={PROFILE_ICON.edit} className="h-4 w-4" />
                    {t('fleet.vehicles.edit')}
                  </button>
                </Can>
              </>
            )}
          </div>
        </header>

        <Indicators vehicle={vehicle} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" data-purpose="details-sections">
          <VehicleSection
            icon={PROFILE_ICON.doc}
            title={t('fleet.vehicle.typeLicenseTitle')}
            tag={t('fleet.vehicle.tag.operating')}
            footer={
              <>
                <span>
                  {t('fleet.vehicle.createdAt')}: {formatDateTime(vehicle.createdAt, locale)}
                </span>
                <span>
                  {t('fleet.vehicle.updatedAt')}: {formatDateTime(vehicle.updatedAt, locale)}
                </span>
              </>
            }
          >
            <VehicleItem label={t('fleet.vehicles.fields.type')}>
              <span className="text-slate-900 dark:text-white">{make}</span>
            </VehicleItem>
            <VehicleItem label={t('fleet.vehicle.maintenanceInterval')}>
              {type === undefined
                ? '—'
                : type.maintenanceIntervalKm === 0
                  ? t('fleet.vehicle.noMaintenanceRule')
                  : `${formatNumber(type.maintenanceIntervalKm, locale)} ${t('fleet.vehicle.km')}`}
            </VehicleItem>
            <VehicleItem label={t('fleet.vehicles.fields.licenseExpiresAt')}>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    licenseExpired
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-slate-900 dark:text-white',
                  )}
                >
                  {formatDate(vehicle.licenseExpiresAt, locale)}
                </span>
                <span
                  className={cn(
                    'rounded border px-2 py-0.5 text-[11px] font-medium',
                    licenseExpired
                      ? 'border-red-500/20 bg-red-500/10 text-red-500 dark:text-red-400'
                      : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  {licenseExpired
                    ? t('fleet.dashboard.licenseExpired')
                    : t('fleet.vehicle.licenseValid')}
                </span>
              </span>
            </VehicleItem>
            <VehicleItem label={t('fleet.vehicles.fields.licenseClass')}>
              {vehicle.licenseClassId === null ? '—' : (licenseClassName ?? '—')}
            </VehicleItem>
            <VehicleItem label={t('fleet.vehicles.fields.operation')}>
              <span className="font-bold text-indigo-500 dark:text-indigo-400">
                {vehicle.operationId === null ? '—' : (operationName ?? '—')}
              </span>
            </VehicleItem>
            <VehicleItem label={t('fleet.vehicles.fields.insuranceCompany')}>
              {vehicle.insuranceCompanyId === null ? '—' : (insurerName ?? '—')}
            </VehicleItem>
            <VehicleItem label={t('fleet.vehicles.fields.joinedAt')}>
              {formatDate(vehicle.joinedAt, locale)}
            </VehicleItem>
            <VehicleItem label={t('fleet.vehicles.fields.branch')}>
              {vehicle.branchId === null
                ? t('fleet.vehicles.fields.noBranch')
                : branch === undefined
                  ? '—'
                  : localized(branch.name, locale)}
            </VehicleItem>
            <div className="space-y-1 pt-2 sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">
                {t('fleet.vehicles.licenseImage.label')}
              </span>
              {vehicle.licenseImage === null ? (
                <span className="text-sm text-slate-500">
                  {t('fleet.vehicles.licenseImage.none')}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:border-slate-400 hover:text-indigo-500 dark:text-indigo-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-indigo-200',
                    SURFACE.inner,
                    SURFACE.border,
                  )}
                >
                  <BoardIcon
                    d={PROFILE_ICON.image}
                    className="h-4 w-4 text-indigo-500 dark:text-indigo-400"
                  />
                  {t('fleet.vehicle.viewImage')}
                </button>
              )}
            </div>
          </VehicleSection>

          <VehicleSection
            icon={PROFILE_ICON.bank}
            title={t('fleet.vehicle.identityTitle')}
            tag={t('fleet.vehicle.tag.identity')}
            footer={
              <>
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      vehicle.radio.issi === null ? 'bg-slate-400' : 'bg-emerald-500',
                    )}
                  />
                  {vehicle.radio.issi === null
                    ? t('fleet.vehicle.radioNone')
                    : t('fleet.vehicle.radioOn')}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {t('fleet.vehicle.tetra')}
                </span>
              </>
            }
          >
            <VehicleItem label={t('fleet.vehicles.fields.code')}>
              <span className="text-base font-extrabold text-slate-900 dark:text-white">
                {vehicle.code}
              </span>
            </VehicleItem>
            <VehicleItem label={t('fleet.vehicles.fields.plate')}>
              <span
                className={cn(
                  'inline-flex items-center rounded border border-slate-300 px-3 py-1 text-sm font-bold tracking-wider text-slate-900 shadow-inner dark:border-slate-600 dark:text-white',
                  SURFACE.inner,
                )}
              >
                {vehicle.plateNumber}
              </span>
            </VehicleItem>
            <VehicleItem label={t('fleet.vehicles.fields.chassis')}>
              <span className="font-mono font-medium tracking-wider">{vehicle.chassisNumber}</span>
            </VehicleItem>
            <VehicleItem label={t('fleet.vehicles.fields.motor')}>
              <span className="font-mono font-medium tracking-wider">{vehicle.motorNumber}</span>
            </VehicleItem>
            {(
              [
                ['fleet.vehicle.issiLabel', vehicle.radio.issi],
                ['fleet.vehicles.fields.motorolaSn', vehicle.radio.motorolaSn],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className={cn('space-y-1 rounded-lg border p-3', SURFACE.inner, SURFACE.border)}
              >
                <span className="text-xs font-medium text-indigo-500 dark:text-indigo-300">
                  {t(label)}
                </span>
                <p className="font-mono text-sm font-bold tracking-wider text-slate-900 dark:text-white">
                  {value ?? '—'}
                </p>
              </div>
            ))}
          </VehicleSection>
        </div>

        {historyLinks.length > 0 && (
          <VehicleSection
            icon={PROFILE_ICON.archive}
            title={t('fleet.vehicle.historyTitle')}
            subtitle={t('fleet.vehicle.historyHint')}
            bodyClass="divide-y divide-slate-200 dark:divide-[#1f293d]"
          >
            {historyLinks.map((link) => (
              <RecordRow
                key={link.key}
                to={link.to(vehicle)}
                icon={link.icon}
                label={t(`fleet.nav.${link.key}`)}
                {...countTag(link.key)}
              />
            ))}
          </VehicleSection>
        )}
      </div>

      <VehicleFormDialog open={editOpen} onClose={() => setEditOpen(false)} vehicle={vehicle} />
      <VehicleStatusDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        vehicle={statusOpen ? vehicle : null}
      />
      <LicenseImagePreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        vehicle={vehicle}
        typeName={type === undefined ? '' : localized(type.name, locale)}
      />
    </PageContainer>
  );
};
