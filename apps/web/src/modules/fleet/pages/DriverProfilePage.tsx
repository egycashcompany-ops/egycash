// Driver profile (FW-5): the fleet-owned facts about one driver (FR-11 — the PERSON lives in
// HR, linked below when the caller may open the directory) plus the driver's own التمامات
// timeline with record/edit/cancel in place — recording here skips the picker because the
// driver is already known. All writes version-aware, every action behind its §7 permission.
//
// «عاوز اعمل الشاشتين دول … خلى كل البيانات اللى ف الصوره تبقى موجوده … زى ما هى»: drawn as the
// owner's reference. Every figure it shows is read or counted from Fleet's own records:
//   • أيام العمل — the days this driver appears on an odometer reading (driver 1 or driver 2);
//   • المهام المنجزة — how many odometer readings carry them;
//   • معدل الالتزام — the working days over the working days plus the days they were unavailable;
//   • سجل الحضور — those readings; الملاحظات والتنبيهات — their violations, accidents, licence.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  type FleetCatalogKind,
  type FleetDriverUnavailabilityDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatAmount, formatDate, formatNumber, localized } from '../../../shared/lib/format';
import { listKey } from '../../../shared/lib/query-keys';
import { cn } from '../../../shared/lib/cn';
import { useBranches } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import * as fleetApi from '../api/fleet-api';
import {
  useAccidents,
  useCancelUnavailability,
  useDriver,
  useFleetCatalog,
  useOdometerLogs,
  useUnavailability,
  useViolations,
} from '../api/fleet-queries';
import { useEmployeeName, useEmployeeRecord } from '../components/EmployeeName';
import { BoardIcon } from '../components/FuelCardBoard';
import { printLicenceRecord } from '../components/vehicle-print';
import { fetchFilteredRows } from '../lib/fleet-sheet';
import {
  GLASS_PANEL,
  GlassTile,
  PROFILE_ICON,
  dayAndTime,
  initialsOf,
} from '../components/ProfileCard';
import { DriverFormDialog } from '../components/DriverFormDialog';
import { UnavailabilityDialog } from '../components/UnavailabilityDialog';

/**
 * One catalog reference, named by the catalog.
 *
 * A dash when nobody has chosen one — «غير محدد» is a real state for a driver whose licence was
 * written down before anybody decided their grade — and a dash again when the item has been
 * deleted outright, which says «this points at nothing» rather than printing an id.
 */
const useCatalogItem = (
  kind: FleetCatalogKind,
  id: string | null,
): { name: string | null; position: number | null } => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data } = useFleetCatalog(kind);
  const items = data?.items ?? [];
  const index = id === null ? -1 : items.findIndex((row) => row.id === id);
  const item = index < 0 ? undefined : items[index];
  return {
    name: item === undefined ? null : localized(item.name, locale),
    position: index < 0 ? null : index + 1,
  };
};

const dash = <span className="text-slate-400">—</span>;

/** The days one unavailability record covers, both ends counted. */
const spanDays = (from: string, to: string): number =>
  Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1);

type Tab = 'unavailability' | 'attendance' | 'notes';

export const DriverProfilePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();

  const { data: profile, isPending, isError, error, refetch } = useDriver(id);
  const employeeId = profile?.employeeId ?? '';
  const { name } = useEmployeeName(employeeId);
  // The person's own facts — code, phone, governorate, branch, address — from Fleet's roster.
  const person = useEmployeeRecord(employeeId);
  const { data: branches = [] } = useBranches(can('branch.view'));
  const job = useCatalogItem('driverJob', profile?.jobId ?? null);
  const specialization = useCatalogItem('driverSpecialization', profile?.specializationId ?? null);
  const licenseType = useCatalogItem('driverLicenseType', profile?.licenseTypeId ?? null);

  const mayAvailability = can('fleetAvailability.view') && employeeId !== '';
  const unavailability = useUnavailability(
    { employeeId, pageSize: 25, sortBy: 'from', sortDir: 'desc' },
    // The overlay list is its own §7 surface.
    mayAvailability,
  );
  // Every record, for the days they cover — the compliance figure counts all of them.
  const allUnavailability = useQuery({
    queryKey: listKey('fleet', 'availability', { employeeId, whole: true }),
    queryFn: () =>
      fetchFilteredRows((page, pageSize) =>
        fleetApi.listUnavailability({ employeeId, page, pageSize }),
      ),
    enabled: mayAvailability,
  });
  // The odometer readings that name this driver: the working days, the missions, the log.
  const mayOdometer = can('fleetOdometer.view') && employeeId !== '';
  const readings = useQuery({
    queryKey: listKey('fleet', 'odometer', { driverEmployeeIds: [employeeId], whole: true }),
    queryFn: () =>
      fetchFilteredRows((page, pageSize) =>
        fleetApi.listOdometerLogs({
          driverEmployeeIds: [employeeId],
          page,
          pageSize,
          sortBy: 'date',
          sortDir: 'desc',
        }),
      ),
    enabled: mayOdometer,
  });
  const recentReadings = useOdometerLogs(
    { driverEmployeeIds: [employeeId], page: 1, pageSize: 25, sortBy: 'date', sortDir: 'desc' },
    mayOdometer,
  );
  // «الملاحظات والتنبيهات»: what the records say against this driver.
  const violations = useViolations(
    { driverEmployeeId: [employeeId], page: 1, pageSize: 25 },
    can('fleetViolation.view') && employeeId !== '',
  );
  const accidents = useAccidents(
    { culpritEmployeeId: [employeeId], page: 1, pageSize: 25 },
    can('fleetAccident.view') && employeeId !== '',
  );

  const [tab, setTab] = useState<Tab>('unavailability');
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

  // NO EXPIRY ON FILE IS NOT AN EXPIRED ONE. `new Date(null)` is the epoch, which would have
  // painted every driver whose paperwork has not arrived yet in the red reserved for a licence
  // that has actually lapsed — the loudest possible wrong answer.
  const licenseExpired =
    profile.licenseExpiresAt !== null && new Date(profile.licenseExpiresAt).getTime() < Date.now();
  const records = unavailability.data?.items ?? [];

  const confirmCancel = async (): Promise<void> => {
    if (cancelling === null) return;
    await cancel.mutateAsync(cancelling.id);
    toast.success(t('fleet.attendance.cancelled'));
    setCancelling(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';
  const displayName = name ?? profile.licenseNumber ?? t('fleet.nav.drivers');
  const branchName = (() => {
    const branch = branches.find((b) => b.id === person?.branchId);
    return branch === undefined ? null : localized(branch.name, locale);
  })();

  // The figures of «التمامات».
  const workingDays =
    readings.data === undefined
      ? undefined
      : new Set(readings.data.map((r) => r.date.slice(0, 10))).size;
  const missions = readings.data?.length;
  const unavailableDays =
    allUnavailability.data === undefined
      ? undefined
      : allUnavailability.data.reduce((sum, r) => sum + spanDays(r.from, r.to), 0);
  const compliance =
    workingDays === undefined ||
    unavailableDays === undefined ||
    workingDays + unavailableDays === 0
      ? undefined
      : Math.round((workingDays / (workingDays + unavailableDays)) * 100);

  const notes: { key: string; tone: string; text: string; when: string | null }[] = [
    ...(licenseExpired
      ? [
          {
            key: 'licence',
            tone: 'text-red-500',
            text: t('fleet.drivers.profile.note.licenceExpired'),
            when: profile.licenseExpiresAt,
          },
        ]
      : []),
    ...(violations.data?.items ?? []).map((v) => ({
      key: `v-${v.id}`,
      tone: 'text-amber-500',
      text: t('fleet.drivers.profile.note.violation', {
        code: v.vehicleCode ?? '—',
        amount: formatAmount(v.amount, locale),
      }),
      when: v.date,
    })),
    ...(accidents.data?.items ?? []).map((a) => ({
      key: `a-${a.id}`,
      tone: 'text-red-500',
      text: t('fleet.drivers.profile.note.accident', { code: a.vehicleCode ?? '—' }),
      when: a.occurredAt,
    })),
  ];

  /** «طباعة الملف»: the driver's file on one sheet, the licence scan at its end. */
  const printFile = async (): Promise<void> => {
    try {
      await printLicenceRecord({
        locale,
        title: t('fleet.drivers.profileTitle'),
        subtitle: person === undefined ? displayName : `${displayName} — ${person.code}`,
        rows: [
          { label: t('fleet.drivers.columns.driver'), value: name ?? '—' },
          { label: t('fleet.drivers.columns.employeeCode'), value: person?.code ?? '—' },
          { label: t('fleet.drivers.columns.jobTitle'), value: job.name ?? '—' },
          { label: t('fleet.drivers.columns.specialization'), value: specialization.name ?? '—' },
          { label: t('fleet.drivers.columns.area'), value: profile.area ?? '—' },
          { label: t('fleet.drivers.columns.branch'), value: branchName ?? '—' },
          { label: t('fleet.drivers.profile.licenseGrade'), value: licenseType.name ?? '—' },
          { label: t('fleet.drivers.profile.licenseNumber'), value: profile.licenseNumber ?? '—' },
          {
            label: t('fleet.drivers.columns.licenseExpiresAt'),
            value:
              profile.licenseExpiresAt === null
                ? '—'
                : formatDate(profile.licenseExpiresAt, locale),
          },
          { label: t('fleet.drivers.profile.phone'), value: person?.phone ?? '—' },
          { label: t('fleet.drivers.columns.address'), value: person?.address ?? '—' },
        ],
        licenseImage:
          profile.licenseImage === null
            ? null
            : {
                heading: t('fleet.drivers.licenseImage.previewTitle'),
                caption: displayName,
                fetch: () => fleetApi.fetchDriverLicenseImage(profile.id),
              },
      });
    } catch {
      toast.error(t('fleet.vehicles.print.failed'));
    }
  };

  const created = dayAndTime(profile.createdAt);
  const updated = dayAndTime(profile.updatedAt);
  const tag = (text: string, tone: string): JSX.Element => (
    <span className={cn('shrink-0 rounded px-2 py-0.5 text-xs', tone)}>{text}</span>
  );
  const metric = (
    label: string,
    value: string | undefined,
    tone: string,
    icon: readonly string[],
    iconTone: string,
  ): JSX.Element => (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-[#0b0f19]/50">
      <div>
        <span className="block text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
        <span className={cn('font-mono text-base font-bold', tone)}>{value ?? '—'}</span>
      </div>
      <BoardIcon d={icon} className={cn('h-5 w-5', iconTone)} />
    </div>
  );
  const tabButton = (
    key: Tab,
    icon: readonly string[],
    label: string,
    count?: number,
  ): JSX.Element => (
    <button
      type="button"
      data-driver-tab={key}
      onClick={() => setTab(key)}
      className={cn(
        'flex items-center gap-2 pb-3 transition-colors',
        tab === key
          ? 'border-b-2 border-brand-500 text-brand-600 dark:text-brand-400'
          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
      )}
    >
      <BoardIcon d={icon} className="h-4 w-4" />
      <span>{label}</span>
      {count !== undefined && (
        <span className="rounded-full border border-brand-300 bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-700 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300">
          {count}
        </span>
      )}
    </button>
  );
  const emptyState = (title: string, hint: string, action?: JSX.Element): JSX.Element => (
    <div
      className="flex flex-col items-center justify-center px-4 py-16 text-center sm:py-20"
      data-purpose="empty-state"
    >
      <div className="group relative mb-5">
        <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100 text-slate-400 shadow-xl transition-all duration-300 group-hover:scale-105 group-hover:border-brand-500/50 dark:border-slate-700/80 dark:from-[#1a243d] dark:to-[#0f172a]">
          <BoardIcon
            d={PROFILE_ICON.box}
            className="h-10 w-10 transition-colors group-hover:text-brand-400"
          />
        </div>
        <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-brand-500 blur-[2px]" />
        <span className="absolute -bottom-1 -left-1 h-2 w-2 rounded-full bg-indigo-400 blur-[1px]" />
      </div>
      <h3 className="mb-2 text-xl font-bold text-slate-900 dark:text-white">{title}</h3>
      <p className="mb-6 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        {hint}
      </p>
      {action}
    </div>
  );

  return (
    <PageContainer>
      <div className="relative flex min-h-full flex-col">
        <nav
          aria-label={t('fleet.drivers.profile.breadcrumb')}
          className="mb-4 flex items-center gap-2 text-xs font-medium text-slate-500 sm:text-sm dark:text-slate-400"
          data-purpose="breadcrumbs"
        >
          <Link
            to="/fleet"
            className="flex items-center gap-1.5 transition-colors hover:text-brand-500"
          >
            <BoardIcon d={PROFILE_ICON.truck} className="h-3.5 w-3.5 text-slate-500" />
            {t('fleet.module.title')}
          </Link>
          <BoardIcon d={PROFILE_ICON.chevron} className="h-3 w-3 text-slate-600" />
          <Link to="/fleet/drivers" className="transition-colors hover:text-brand-500">
            {t('fleet.nav.drivers')}
          </Link>
          <BoardIcon d={PROFILE_ICON.chevron} className="h-3 w-3 text-slate-600" />
          <span aria-current="page" className="font-semibold text-slate-700 dark:text-slate-300">
            {displayName}
          </span>
        </nav>

        <header
          className="mb-8 flex flex-col justify-between gap-6 border-b border-slate-200 pb-6 lg:flex-row lg:items-center dark:border-slate-800/80"
          data-purpose="page-header"
        >
          <div className="flex items-start gap-4 sm:items-center">
            <div className="relative shrink-0">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-tr from-brand-700 via-indigo-600 to-violet-500 text-2xl font-bold text-white shadow-lg shadow-brand-900/40 sm:h-20 sm:w-20">
                {name === null ? '—' : initialsOf(name)}
              </div>
              {profile.isActive && (
                <span
                  className="absolute -bottom-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.35)] dark:border-[#070913]"
                  title={t('fleet.drivers.active')}
                >
                  <span className="h-2 w-2 animate-ping rounded-full bg-white opacity-75" />
                </span>
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
                  {displayName}
                </h1>
                {person !== undefined && (
                  <span
                    className="inline-flex items-center rounded-md border border-slate-300 bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    title={t('fleet.drivers.columns.employeeCode')}
                  >
                    <BoardIcon
                      d={PROFILE_ICON.idCard}
                      className="ml-1.5 h-3.5 w-3.5 text-brand-500"
                    />
                    {person.code}
                  </span>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold',
                    profile.isActive
                      ? 'border-emerald-500/40 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400'
                      : 'border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800',
                  )}
                >
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      profile.isActive ? 'animate-pulse bg-emerald-400' : 'bg-slate-400',
                    )}
                  />
                  {profile.isActive ? t('fleet.drivers.active') : t('fleet.drivers.inactive')}
                </span>
                {can('employee.view') && (
                  <>
                    <span className="text-slate-400 dark:text-slate-600">|</span>
                    <Link
                      to={`/employees/${profile.employeeId}`}
                      className="group inline-flex items-center gap-2 text-xs font-medium text-sky-600 transition-colors hover:text-sky-500 sm:text-sm dark:text-sky-400 dark:hover:text-sky-300"
                    >
                      <BoardIcon
                        d={PROFILE_ICON.person}
                        className="h-4 w-4 text-sky-500 transition-transform group-hover:scale-110"
                      />
                      {t('fleet.drivers.openHrProfile')}
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
          <div
            className="flex flex-wrap items-center gap-3 self-end lg:self-center"
            data-purpose="header-actions"
          >
            <button
              type="button"
              data-driver-print="true"
              onClick={() => void printFile()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition duration-150 hover:text-slate-900 sm:text-sm dark:border-slate-700 dark:bg-[#141c30] dark:text-slate-300 dark:hover:bg-[#1a243d] dark:hover:text-white"
            >
              <BoardIcon d={PROFILE_ICON.printer} className="h-4 w-4 text-slate-400" />
              {t('fleet.drivers.profile.print')}
            </button>
            <Can permission="fleetDriver.manage">
              <button
                type="button"
                data-driver-edit="true"
                onClick={() => setEditOpen(true)}
                className="group inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-xs font-bold text-slate-900 shadow-lg transition duration-150 hover:border-brand-500 sm:text-sm dark:border-slate-600/80 dark:bg-[#141c30] dark:text-white dark:shadow-black/30 dark:hover:bg-[#1e293b]"
              >
                <EditIcon className="h-4 w-4 text-brand-500 transition-colors group-hover:text-brand-400" />
                {t('fleet.drivers.edit')}
              </button>
            </Can>
          </div>
        </header>

        <main className="flex-1 space-y-8">
          <section className={GLASS_PANEL} data-purpose="driver-information-card">
            <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-600/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-sky-600/10 blur-3xl" />
            <div className="relative mb-6 flex items-center justify-between border-b border-slate-200 pb-5 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-100 text-brand-500 dark:bg-brand-900/40 dark:text-brand-400">
                  <BoardIcon d={PROFILE_ICON.idCard} className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-wide text-slate-900 dark:text-white">
                    {t('fleet.drivers.profileTitle')}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('fleet.drivers.profile.hint')}
                  </p>
                </div>
              </div>
              <span className="hidden items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500 sm:inline-flex dark:border-slate-700/60 dark:bg-[#1a243d] dark:text-slate-400">
                <BoardIcon d={PROFILE_ICON.clock} className="h-3.5 w-3.5 text-slate-500" />
                {t('fleet.drivers.profile.sync')}
              </span>
            </div>

            <div className="relative grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <GlassTile
                icon={PROFILE_ICON.person}
                label={t('fleet.drivers.columns.driver')}
                // The tile carries the first three names, as the reference does; the header the whole.
                value={name === null ? dash : name.trim().split(/\s+/u).slice(0, 3).join(' ')}
                aside={
                  person === undefined
                    ? undefined
                    : tag(
                        person.code,
                        'border border-brand-300 bg-brand-50 font-mono text-brand-700 dark:border-brand-800/40 dark:bg-brand-950/60 dark:text-brand-300',
                      )
                }
              />
              <GlassTile
                icon={PROFILE_ICON.briefcase}
                label={t('fleet.drivers.columns.jobTitle')}
                value={job.name ?? dash}
                aside={tag(
                  t('fleet.drivers.profile.tag.jobCategory'),
                  'bg-slate-200/70 text-slate-500 dark:bg-[#1e293b]/60 dark:text-slate-400',
                )}
              />
              <GlassTile
                icon={PROFILE_ICON.shield}
                label={t('fleet.drivers.columns.specialization')}
                value={
                  specialization.name === null ? (
                    dash
                  ) : (
                    <span className="text-violet-600 dark:text-violet-300">
                      {specialization.name}
                    </span>
                  )
                }
                aside={tag(
                  t('fleet.drivers.profile.tag.security'),
                  'flex items-center gap-1 border border-violet-500/30 bg-violet-50 font-medium text-violet-600 dark:bg-violet-950/70 dark:text-violet-400',
                )}
              />
              {/* «شاشه معينه السواق مفيهاش المنطقه ولا الفرع»: the two places the reference left
                  empty are the area and the branch. */}
              <GlassTile
                icon={PROFILE_ICON.pin}
                label={t('fleet.drivers.columns.area')}
                value={profile.area ?? dash}
                aside={
                  person?.governorate == null || person.governorate === ''
                    ? undefined
                    : tag(
                        person.governorate,
                        'bg-slate-200/70 text-slate-500 dark:bg-[#1e293b]/60 dark:text-slate-400',
                      )
                }
              />
              <GlassTile
                icon={PROFILE_ICON.building}
                label={t('fleet.drivers.columns.branch')}
                value={branchName ?? dash}
                aside={
                  branchName === null
                    ? undefined
                    : tag(
                        t('fleet.drivers.profile.tag.mainBranch'),
                        'border border-brand-300 bg-brand-50 font-semibold text-brand-700 dark:border-brand-800/40 dark:bg-brand-950/60 dark:text-brand-300',
                      )
                }
              />
              <GlassTile
                icon={PROFILE_ICON.idCard}
                label={t('fleet.drivers.profile.licenseGrade')}
                value={
                  licenseType.name === null ? (
                    dash
                  ) : (
                    <span className="text-amber-500 dark:text-amber-400">{licenseType.name}</span>
                  )
                }
                aside={
                  licenseType.position === null
                    ? undefined
                    : tag(
                        t('fleet.drivers.profile.tag.grade', { n: String(licenseType.position) }),
                        'border border-amber-600/30 bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
                      )
                }
              />
              <GlassTile
                icon={PROFILE_ICON.calendar}
                label={t('fleet.drivers.table.licenseExpiry')}
                value={
                  profile.licenseExpiresAt === null ? (
                    dash
                  ) : (
                    <span className={cn('font-mono', licenseExpired && 'text-red-500')}>
                      {dayAndTime(profile.licenseExpiresAt).day}
                    </span>
                  )
                }
                aside={
                  profile.licenseExpiresAt === null
                    ? undefined
                    : tag(
                        licenseExpired
                          ? t('fleet.dashboard.licenseExpired')
                          : t('fleet.vehicle.licenseValid'),
                        licenseExpired
                          ? 'border border-red-500/30 bg-red-50 font-semibold text-red-600 dark:bg-red-950/60 dark:text-red-400'
                          : 'border border-emerald-500/30 bg-emerald-50 font-semibold text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400',
                      )
                }
              />
              <GlassTile
                icon={PROFILE_ICON.calendar}
                label={t('fleet.drivers.profile.createdAt')}
                value={<span className="font-mono text-xs font-semibold">{created.day}</span>}
                aside={<span className="font-mono text-[11px] text-slate-400">{created.time}</span>}
              />
              <GlassTile
                icon={PROFILE_ICON.clock}
                label={t('fleet.vehicle.updatedAt')}
                value={<span className="font-mono text-xs font-semibold">{updated.day}</span>}
                aside={<span className="font-mono text-[11px] text-slate-400">{updated.time}</span>}
              />
            </div>

            <div className="relative mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
              <div className="flex flex-wrap items-center gap-6">
                <span className="flex items-center gap-2">
                  <BoardIcon d={PROFILE_ICON.phone} className="h-3.5 w-3.5 text-slate-500" />
                  {t('fleet.drivers.profile.phone')}:{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-200" dir="ltr">
                    {person?.phone ?? '—'}
                  </strong>
                </span>
                <span className="hidden items-center gap-2 md:flex">
                  <BoardIcon d={PROFILE_ICON.building} className="h-3.5 w-3.5 text-slate-500" />
                  {t('fleet.drivers.profile.mainBranch')}:{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {branchName ?? '—'}
                  </strong>
                </span>
                {/* «عاوز اضيف عند دولا العنوان»: the address beside the phone and the branch. */}
                <span className="flex items-center gap-2">
                  <BoardIcon d={PROFILE_ICON.pin} className="h-3.5 w-3.5 text-slate-500" />
                  {t('fleet.drivers.columns.address')}:{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {person?.address ?? '—'}
                  </strong>
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                {t('fleet.drivers.profile.verified')}
              </div>
            </div>
          </section>

          <Can permission="fleetAvailability.view">
            <section className={GLASS_PANEL} data-purpose="attendance-and-shifts-card">
              <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-100 text-brand-500 dark:bg-violet-900/40 dark:text-brand-400">
                    <BoardIcon d={PROFILE_ICON.clipboard} className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold tracking-wide text-slate-900 dark:text-white">
                      {t('fleet.nav.attendance')}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('fleet.drivers.profile.attendanceHint')}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Can permission="fleetRoster.view">
                    <button
                      type="button"
                      data-driver-new-attendance="true"
                      onClick={() => navigate('/fleet/roster')}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:text-slate-900 sm:text-sm dark:border-slate-700 dark:bg-[#141c30] dark:text-slate-300 dark:hover:bg-[#1a243d] dark:hover:text-white"
                    >
                      <BoardIcon d={PROFILE_ICON.plus} className="h-4 w-4 text-slate-400" />
                      {t('fleet.drivers.profile.newAttendance')}
                    </button>
                  </Can>
                  <Can permission="fleetAvailability.record">
                    <button
                      type="button"
                      data-driver-record-unavailability="true"
                      onClick={() => setRecordOpen(true)}
                      className="inline-flex transform items-center gap-2 rounded-xl border border-violet-400/40 bg-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-violet-700/40 transition duration-150 hover:bg-violet-500 active:scale-95 sm:text-sm"
                    >
                      <BoardIcon d={PROFILE_ICON.userX} className="h-4 w-4" />
                      {t('fleet.drivers.profile.recordUnavailability')}
                    </button>
                  </Can>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-b border-slate-200 py-5 md:grid-cols-4 dark:border-slate-800/80">
                {metric(
                  t('fleet.drivers.profile.metric.workingDays'),
                  workingDays === undefined
                    ? undefined
                    : t('fleet.drivers.profile.metric.days', { count: String(workingDays) }),
                  'text-slate-900 dark:text-white',
                  PROFILE_ICON.calendar,
                  'text-slate-400 dark:text-slate-600',
                )}
                {metric(
                  t('fleet.drivers.profile.metric.unavailability'),
                  unavailability.data === undefined
                    ? undefined
                    : String(unavailability.data.meta.totalItems),
                  'text-slate-700 dark:text-slate-300',
                  PROFILE_ICON.ban,
                  'text-slate-400 dark:text-slate-600',
                )}
                {metric(
                  t('fleet.drivers.profile.metric.missions'),
                  missions === undefined
                    ? undefined
                    : t('fleet.drivers.profile.metric.missionsValue', { count: String(missions) }),
                  'text-emerald-500 dark:text-emerald-400',
                  PROFILE_ICON.check,
                  'text-emerald-500/50',
                )}
                {metric(
                  t('fleet.drivers.profile.metric.compliance'),
                  compliance === undefined ? undefined : `${compliance}%`,
                  'text-slate-900 dark:text-white',
                  PROFILE_ICON.chart,
                  'text-brand-500/50',
                )}
              </div>

              <div className="mt-4 flex items-center gap-6 overflow-x-auto border-b border-slate-200 text-xs font-semibold sm:text-sm dark:border-slate-800">
                {tabButton(
                  'unavailability',
                  PROFILE_ICON.calendar,
                  t('fleet.drivers.profile.unavailabilityTab'),
                  unavailability.data?.meta.totalItems ?? 0,
                )}
                {tabButton(
                  'attendance',
                  PROFILE_ICON.list,
                  t('fleet.drivers.profile.attendanceTab'),
                )}
                {tabButton('notes', PROFILE_ICON.warn, t('fleet.drivers.profile.notesTab'))}
              </div>

              {tab === 'unavailability' &&
                (unavailability.isPending ? (
                  <div className="space-y-3 py-6">
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
                  emptyState(
                    t('fleet.attendance.emptyForDriver'),
                    t('fleet.drivers.profile.emptyHint'),
                    <Can permission="fleetAvailability.record">
                      <button
                        type="button"
                        onClick={() => setRecordOpen(true)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-[#141c30] dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-[#1e293b]"
                      >
                        <BoardIcon d={PROFILE_ICON.plus} className="h-4 w-4 text-brand-400" />
                        {t('fleet.drivers.profile.addLeave')}
                      </button>
                    </Can>,
                  )
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                    {records.map((record) => (
                      <li key={record.id} className="flex items-center gap-3 py-3 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="font-bold text-slate-800 dark:text-slate-100">
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
                ))}

              {tab === 'attendance' &&
                ((recentReadings.data?.items.length ?? 0) === 0 ? (
                  emptyState(
                    t('fleet.drivers.profile.attendanceEmpty'),
                    t('fleet.drivers.profile.attendanceEmptyHint'),
                  )
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                    {(recentReadings.data?.items ?? []).map((reading) => (
                      <li
                        key={reading.id}
                        className="flex flex-wrap items-center gap-4 py-3 text-sm"
                      >
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                          {dayAndTime(reading.date).day}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">
                          {t('fleet.drivers.profile.readingCar', {
                            code: reading.vehicleCode ?? '—',
                          })}
                        </span>
                        <span className="font-mono text-slate-500 dark:text-slate-400">
                          {reading.km === null
                            ? '—'
                            : `${formatNumber(reading.km, locale)} ${t('fleet.vehicle.km')}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ))}

              {tab === 'notes' &&
                (notes.length === 0 ? (
                  emptyState(
                    t('fleet.drivers.profile.notesEmpty'),
                    t('fleet.drivers.profile.notesEmptyHint'),
                  )
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                    {notes.map((note) => (
                      <li key={note.key} className="flex items-center gap-3 py-3 text-sm">
                        <BoardIcon
                          d={PROFILE_ICON.warn}
                          className={cn('h-4 w-4 shrink-0', note.tone)}
                        />
                        <span className="flex-1 font-semibold text-slate-800 dark:text-slate-100">
                          {note.text}
                        </span>
                        {note.when !== null && (
                          <span className="font-mono text-xs text-slate-500">
                            {dayAndTime(note.when).day}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ))}
            </section>
          </Can>
        </main>

        <footer
          className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-slate-200 pt-4 text-xs text-slate-500 sm:flex-row dark:border-slate-900"
          data-purpose="system-footer"
        >
          <p>{t('fleet.drivers.profile.footer.copyright')}</p>
          <div className="flex items-center gap-4">
            <span>
              {t('fleet.drivers.profile.footer.server')}:{' '}
              {(import.meta.env['VITE_SERVER_ID'] as string | undefined) ?? '—'}
            </span>
            <span>•</span>
            <span>
              {t('fleet.drivers.profile.footer.version')}{' '}
              {(import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? '—'}
            </span>
          </div>
        </footer>
      </div>

      <DriverFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        employeeId={profile.employeeId}
        profile={profile}
      />
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
