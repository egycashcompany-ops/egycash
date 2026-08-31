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
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { ChevronEndIcon, EditIcon, GaugeIcon, WrenchIcon } from '../../../shared/ui/icons';
import { formatDate, formatDateTime, formatNumber, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useBranches } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import {
  useExpectedReading,
  useFleetCatalog,
  useCanReadAlarms,
  useMaintenanceAlarms,
  useMaintenanceVisits,
  useVehicle,
  useVehicleTypes,
} from '../api/fleet-queries';
import { FleetKpi } from '../components/FleetKpi';
import { InWorkshopBadge, VehicleStatusBadge } from '../components/VehicleStatusBadge';
import { VehicleFormDialog } from '../components/VehicleFormDialog';
import { VehicleStatusDialog } from '../components/VehicleStatusDialog';
import { LicenseImagePreviewDialog } from '../components/VehicleLicenseImage';

/**
 * The profile's history links, lit per slice as each page ships (owner navigation rule). Each
 * target is a URL-synced list, so the link pre-filters it to this vehicle.
 */
const HISTORY_LINKS: {
  key: string;
  to: (vehicle: FleetVehicleDto) => string;
  permission: string;
  shipped: boolean;
}[] = [
  {
    key: 'odometer',
    to: (v) => `/fleet/odometer?vehicle=${v.id}`,
    permission: 'fleetOdometer.view',
    shipped: true, // FW-6
  },
  {
    key: 'maintenance',
    to: (v) => `/fleet/maintenance?vehicle=${v.id}`,
    permission: 'fleetMaintenance.view',
    shipped: true, // FW-6
  },
  {
    key: 'accidents',
    to: (v) => `/fleet/accidents?vehicle=${v.id}`,
    permission: 'fleetAccident.view',
    shipped: true, // FW-8
  },
  {
    key: 'violations',
    to: (v) => `/fleet/violations?vehicle=${v.id}`,
    permission: 'fleetViolation.view',
    shipped: true, // FW-9
  },
  {
    key: 'roster',
    // The roster board is day-keyed, so the pre-filter is the vehicle's code in the search.
    to: (v) => `/fleet/roster?q=${encodeURIComponent(v.code)}`,
    permission: 'fleetRoster.view',
    shipped: true, // FW-7
  },
];

const Row = ({
  label,
  children,
  ltr = false,
}: {
  label: string;
  children: React.ReactNode;
  ltr?: boolean;
}): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd
      className={cn('mt-1 text-sm text-slate-700 dark:text-slate-200', ltr && 'font-mono text-xs')}
      dir={ltr ? 'ltr' : undefined}
    >
      {children}
    </dd>
  </div>
);

const Indicators = ({ vehicle }: { vehicle: FleetVehicleDto }): JSX.Element => {
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
    alarm === undefined || alarm.remainingKm === null
      ? undefined
      : alarm.remainingKm < 0
        ? t('fleet.dashboard.overdueKm', { km: formatNumber(Math.abs(alarm.remainingKm), locale) })
        : t('fleet.dashboard.remainingKm', { km: formatNumber(alarm.remainingKm, locale) });
  const visit = lastVisit.data?.items[0];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <FleetKpi
        label={t('fleet.dashboard.inWorkshop')}
        icon={WrenchIcon}
        value={vehicle.inWorkshop ? t('common.yes') : t('common.no')}
        caption={t('fleet.vehicle.inWorkshopHint')}
      />
      {canOdometer && (
        <FleetKpi
          label={t('fleet.vehicle.lastReading')}
          icon={GaugeIcon}
          value={
            expected.data === undefined
              ? undefined
              : expected.data.expectedReading === null
                ? t('fleet.vehicle.noReadings')
                : `${formatNumber(expected.data.expectedReading, locale)} ${t('fleet.vehicle.km')}`
          }
          caption={t('fleet.vehicle.lastReadingHint')}
        />
      )}
      {canAlarms && (
        <FleetKpi
          label={t('fleet.dashboard.alarms')}
          icon={GaugeIcon}
          value={alarmValue}
          caption={alarmCaption}
        />
      )}
      {canMaintenance && (
        <FleetKpi
          label={t('fleet.vehicle.lastService')}
          icon={WrenchIcon}
          value={
            lastVisit.data === undefined
              ? undefined
              : visit?.outDate == null
                ? t('fleet.vehicle.noService')
                : formatDate(visit.outDate, locale)
          }
          caption={
            visit?.outDate == null
              ? undefined
              : // The reading the car LEFT the workshop on — the same baseline the alarm counts
                // from. Visits closed before that number was collected carry `null`, and fall
                // back to the arrival reading, which is what those rows have always shown.
                t('fleet.vehicle.lastServiceAt', {
                  km: formatNumber(visit.exitOdometer ?? visit.odometerAtService, locale),
                })
          }
        />
      )}
    </div>
  );
};

export const VehicleDetailPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();

  const { data: vehicle, isPending, isError, error, refetch } = useVehicle(id);
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

  return (
    <PageContainer>
      <PageHeader
        title={vehicle.code}
        description={`${type === undefined ? '' : `${localized(type.name, locale)} · `}${vehicle.plateNumber}`}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.vehicles'), to: '/fleet/vehicles' },
          { label: vehicle.code },
        ]}
        actions={
          vehicle.status !== 'disposed' ? (
            <>
              <Can permission="fleetVehicle.edit">
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<EditIcon className="h-4 w-4" />}
                  onClick={() => setEditOpen(true)}
                >
                  {t('fleet.vehicles.edit')}
                </Button>
              </Can>
              <Can permission="fleetVehicle.changeStatus">
                <Button size="sm" variant="secondary" onClick={() => setStatusOpen(true)}>
                  {t('fleet.vehicles.changeStatus')}
                </Button>
              </Can>
            </>
          ) : undefined
        }
      />

      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <VehicleStatusBadge status={vehicle.status} />
          <InWorkshopBadge inWorkshop={vehicle.inWorkshop} />
          {vehicle.statusReason !== null && (
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {t('fleet.vehicle.statusReason')}: {vehicle.statusReason}
            </span>
          )}
        </div>

        <Indicators vehicle={vehicle} />

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title={t('fleet.vehicle.identityTitle')} />
            <CardBody>
              <dl className="grid grid-cols-2 gap-4">
                <Row label={t('fleet.vehicles.fields.code')} ltr>
                  {vehicle.code}
                </Row>
                <Row label={t('fleet.vehicles.fields.plate')}>{vehicle.plateNumber}</Row>
                <Row label={t('fleet.vehicles.fields.chassis')} ltr>
                  {vehicle.chassisNumber}
                </Row>
                <Row label={t('fleet.vehicles.fields.motor')} ltr>
                  {vehicle.motorNumber}
                </Row>
                <Row label={t('fleet.vehicles.fields.issi')} ltr>
                  {vehicle.radio.issi ?? '—'}
                </Row>
                <Row label={t('fleet.vehicles.fields.motorolaSn')} ltr>
                  {vehicle.radio.motorolaSn ?? '—'}
                </Row>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('fleet.vehicle.typeLicenseTitle')} />
            <CardBody>
              <dl className="grid grid-cols-2 gap-4">
                <Row label={t('fleet.vehicles.fields.type')}>
                  {type === undefined ? '—' : localized(type.name, locale)}
                </Row>
                <Row label={t('fleet.vehicle.maintenanceInterval')}>
                  {type === undefined
                    ? '—'
                    : type.maintenanceIntervalKm === 0
                      ? t('fleet.vehicle.noMaintenanceRule')
                      : `${formatNumber(type.maintenanceIntervalKm, locale)} ${t('fleet.vehicle.km')}`}
                </Row>
                <Row label={t('fleet.vehicles.fields.licenseExpiresAt')}>
                  <span
                    className={cn(licenseExpired && 'font-medium text-red-600 dark:text-red-400')}
                  >
                    {formatDate(vehicle.licenseExpiresAt, locale)}
                    {licenseExpired && ` — ${t('fleet.dashboard.licenseExpired')}`}
                  </span>
                </Row>
                <Row label={t('fleet.vehicles.fields.licenseClass')}>
                  {vehicle.licenseClassId === null
                    ? '—'
                    : (licenseClassName ?? '—')}
                </Row>
                <Row label={t('fleet.vehicles.fields.operation')}>
                  {vehicle.operationId === null ? '—' : (operationName ?? '—')}
                </Row>
                <Row label={t('fleet.vehicles.fields.insuranceCompany')}>
                  {vehicle.insuranceCompanyId === null ? '—' : (insurerName ?? '—')}
                </Row>
                <Row label={t('fleet.vehicles.fields.joinedAt')}>
                  {formatDate(vehicle.joinedAt, locale)}
                </Row>
                <Row label={t('fleet.vehicles.fields.branch')}>
                  {vehicle.branchId === null
                    ? t('fleet.vehicles.fields.noBranch')
                    : branch === undefined
                      ? '—'
                      : localized(branch.name, locale)}
                </Row>
                <Row label={t('fleet.vehicles.licenseImage.label')}>
                  {vehicle.licenseImage === null ? (
                    t('fleet.vehicles.licenseImage.none')
                  ) : (
                    <button
                      type="button"
                      className="text-brand-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300"
                      onClick={() => setPreviewOpen(true)}
                    >
                      {t('fleet.vehicles.licenseImage.view')}
                    </button>
                  )}
                </Row>
                <Row label={t('fleet.vehicle.createdAt')}>
                  {formatDateTime(vehicle.createdAt, locale)}
                </Row>
                <Row label={t('fleet.vehicle.updatedAt')}>
                  {formatDateTime(vehicle.updatedAt, locale)}
                </Row>
              </dl>
            </CardBody>
          </Card>
        </div>

        {historyLinks.length > 0 && (
          <Card>
            <CardHeader title={t('fleet.vehicle.historyTitle')} />
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {historyLinks.map((link) => (
                <li key={link.key}>
                  <Link
                    to={link.to(vehicle)}
                    className="flex items-center justify-between gap-3 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-200 dark:hover:bg-slate-800/50"
                  >
                    {t(`fleet.nav.${link.key}`)}
                    <ChevronEndIcon className="h-4 w-4 text-slate-400" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
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
