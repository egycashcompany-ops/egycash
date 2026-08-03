// Driver profile (FW-5): the fleet-owned facts about one driver (FR-11 — the PERSON lives in
// HR, linked below when the caller may open the directory) plus the driver's own التمامات
// timeline with record/edit/cancel in place — recording here skips the picker because the
// driver is already known. All writes version-aware, every action behind its §7 permission.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type FleetDriverUnavailabilityDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { StatusBadge } from '../../../shared/ui/Badge';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatDate, formatDateTime } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useCancelUnavailability, useDriver, useUnavailability } from '../api/fleet-queries';
import { EmployeeName, useEmployeeName } from '../components/EmployeeName';
import { DriverFormDialog } from '../components/DriverFormDialog';
import { UnavailabilityDialog } from '../components/UnavailabilityDialog';

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-1 text-sm text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

export const DriverProfilePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();

  const { data: profile, isPending, isError, error, refetch } = useDriver(id);
  const employeeId = profile?.employeeId ?? '';
  const { name } = useEmployeeName(employeeId);
  const unavailability = useUnavailability(
    { employeeId, pageSize: 25, sortBy: 'from', sortDir: 'desc' },
    // The overlay list is its own §7 surface.
    can('fleetAvailability.view') && employeeId !== '',
  );

  const [editOpen, setEditOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<FleetDriverUnavailabilityDto | null>(null);
  const [cancelling, setCancelling] = useState<FleetDriverUnavailabilityDto | null>(null);
  const cancel = useCancelUnavailability();

  if (isPending) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || profile === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const licenseExpired = new Date(profile.licenseExpiresAt).getTime() < Date.now();
  const records = unavailability.data?.items ?? [];

  const confirmCancel = async (): Promise<void> => {
    if (cancelling === null) return;
    await cancel.mutateAsync(cancelling.id);
    toast.success(t('fleet.attendance.cancelled'));
    setCancelling(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  return (
    <PageContainer>
      <PageHeader
        title={name ?? profile.licenseNumber}
        description={t('fleet.drivers.profileSubtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.drivers'), to: '/fleet/drivers' },
          { label: name ?? profile.licenseNumber },
        ]}
        actions={
          <Can permission="fleetDriver.manage">
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<EditIcon className="h-4 w-4" />}
              onClick={() => setEditOpen(true)}
            >
              {t('fleet.drivers.edit')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={profile.isActive ? 'success' : 'neutral'}
            label={profile.isActive ? t('fleet.drivers.active') : t('fleet.drivers.inactive')}
          />
          {can('employee.view') && (
            <Link
              to={`/employees/${profile.employeeId}`}
              className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {t('fleet.drivers.openHrProfile')}
            </Link>
          )}
        </div>

        <Card>
          <CardHeader title={t('fleet.drivers.profileTitle')} />
          <CardBody>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Row label={t('fleet.drivers.columns.driver')}>
                <EmployeeName employeeId={profile.employeeId} />
              </Row>
              <Row label={t('fleet.drivers.columns.licenseNumber')}>
                <span className="font-mono text-xs" dir="ltr">
                  {profile.licenseNumber}
                </span>
              </Row>
              <Row label={t('fleet.drivers.columns.licenseExpiresAt')}>
                <span
                  className={cn(licenseExpired && 'font-medium text-red-600 dark:text-red-400')}
                >
                  {formatDate(profile.licenseExpiresAt, locale)}
                  {licenseExpired && ` — ${t('fleet.dashboard.licenseExpired')}`}
                </span>
              </Row>
              <Row label={t('fleet.drivers.columns.specialization')}>
                {t(`fleet.drivers.specialization.${profile.specialization}`)}
              </Row>
              <Row label={t('fleet.drivers.columns.area')}>{profile.area ?? '—'}</Row>
              <Row label={t('fleet.vehicle.createdAt')}>
                {formatDateTime(profile.createdAt, locale)}
              </Row>
              <Row label={t('fleet.vehicle.updatedAt')}>
                {formatDateTime(profile.updatedAt, locale)}
              </Row>
            </dl>
          </CardBody>
        </Card>

        <Can permission="fleetAvailability.view">
          <Card>
            <CardHeader
              title={t('fleet.nav.attendance')}
              description={t('fleet.attendance.driverSubtitle')}
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
            {unavailability.isPending ? (
              <div className="space-y-3 p-5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-5 w-full" />
                ))}
              </div>
            ) : unavailability.isError ? (
              <ErrorState
                error={unavailability.error}
                onRetry={() => void unavailability.refetch()}
              />
            ) : records.length === 0 ? (
              <EmptyState
                title={t('fleet.attendance.emptyForDriver')}
                description={t('fleet.attendance.emptyForDriverHint')}
              />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {records.map((record) => (
                  <li key={record.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-800 dark:text-slate-100">
                        {record.reason}
                      </span>
                      <span className="ms-3 tabular-nums text-slate-500 dark:text-slate-400">
                        {formatDate(record.from, locale)} ← {formatDate(record.to, locale)}
                      </span>
                      {record.notes !== null && (
                        <span className="ms-3 text-slate-400 dark:text-slate-500">
                          {record.notes}
                        </span>
                      )}
                    </span>
                    <Can permission="fleetAvailability.edit">
                      <button
                        type="button"
                        className={actionButton}
                        aria-label={t('fleet.attendance.edit')}
                        title={t('fleet.attendance.edit')}
                        onClick={() => setEditingRecord(record)}
                      >
                        <EditIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className={actionButton}
                        aria-label={t('fleet.attendance.cancel')}
                        title={t('fleet.attendance.cancel')}
                        onClick={() => setCancelling(record)}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </Can>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Can>
      </div>

      <DriverFormDialog open={editOpen} onClose={() => setEditOpen(false)} profile={profile} />
      <UnavailabilityDialog
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        record={null}
        fixedEmployeeId={profile.employeeId}
      />
      <UnavailabilityDialog
        open={editingRecord !== null}
        onClose={() => setEditingRecord(null)}
        record={editingRecord}
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
