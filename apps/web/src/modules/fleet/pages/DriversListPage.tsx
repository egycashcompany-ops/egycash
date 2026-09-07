// Drivers registry (FW-5, legacy /drivers): the fleet-owned profiles over HR employees (FR-11).
//
// The table shows sixteen columns, and they come from THREE places on purpose:
//
//   • HR's — name, employee code, address, governorate, mobile, hire date, branch. The browser
//     reads them from HR's endpoint with HR's own `employee.view`, displays them, and never
//     writes them. That is FR-11 in practice: Fleet does not own people.
//   • Fleet's CATALOGS — the grade («الوظيفة»), the specialization («التخصص») and the licence
//     class («الرخصة»). Each is a `/fleet/catalogs` reference, so «سائق صراف الى» or «سزوكى» is
//     added by an admin rather than by a release. Nothing on this screen names a value of them.
//   • Fleet's own profile — the work area, the licence expiry, the scan, the active switch.
//
// The filter bar mirrors that split and stays server-side across all of it. The fleet filters —
// the picked drivers, the branch, the three catalogs, the area, the scan, the status — go straight
// to `/fleet/drivers`. The three HR text boxes (address, governorate, phone) go to `/hr/employees`
// FIRST and arrive here as `employeeIds` (see `useDriverHrFilter`), where they are intersected
// with whoever the reader picked by name. Two queries, each answered by the module that owns its
// data, joined by id in the browser — the same join the name column already performs. Nothing is
// ever filtered out of an already-fetched page, and when HR matches more employees than one
// `employeeIds` page can carry, the table says so instead of showing a truncated result that
// looks complete.
//
// THE BRANCH USED TO BE ONE OF THE HR THREE, AND COULD NOT WORK THERE. A branch's employees are
// its whole payroll, so the HR step always matched more than its one-page cap and the screen
// answered «narrow your filter» and filtered nothing. It is a fleet parameter now: the roster
// arrives from the directory seam with each driver's branch already on it.
//
// There is no "add driver" action: enrolment left the UI. The create endpoint still exists for the
// API's own consumers; nothing on this screen reaches it.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  type EmployeeDto,
  type FleetCatalogKind,
  type FleetDriverProfileDto,
  type FleetDriverRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Input, Select } from '../../../shared/ui/form';
import { StatusBadge } from '../../../shared/ui/Badge';
import { EditIcon, EyeIcon } from '../../../shared/ui/icons';
import { formatDate, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useDrivers, useFleetCatalog } from '../api/fleet-queries';
import { useDriverHrFilter, type DriverHrFilter } from '../api/driver-hr-filter';
import { useBranches, useJobTitles } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import { useEmployeeRecord } from '../components/EmployeeName';
import { CatalogSelect } from '../components/CatalogSelect';
import { DriverPickerFilter } from '../components/DriverPickerFilter';
import { DriverFormDialog } from '../components/DriverFormDialog';
import {
  DriverLicenseImageCell,
  DriverLicenseImagePreviewDialog,
} from '../components/DriverLicenseImage';
import { driverIdFilter } from '../lib/driver-filter-selection';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'active',
  'addr',
  'area',
  'branch',
  'drv',
  'gov',
  'img',
  'job',
  'lic',
  'phone',
  'spec',
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/** A comma-separated id list on the URL, as the picker holds it. */
const idList = (raw: string | null): string[] =>
  (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');

/** id → display name for one fleet catalog, in the reader's locale. */
const useCatalogNames = (kind: FleetCatalogKind, locale: Locale): ReadonlyMap<string, string> => {
  const { data } = useFleetCatalog(kind);
  return useMemo(
    () => new Map((data?.items ?? []).map((item) => [item.id, localized(item.name, locale)])),
    [data, locale],
  );
};

/**
 * One HR-owned cell.
 *
 * Every instance shares ONE cached query per employee (same key as the HR profile page), so a row
 * with seven HR columns still costs a single request. Absent value, absent record and absent
 * `employee.view` all render the same dash — the cell never leaks an id in place of a name.
 */
const EmployeeFact = ({
  employeeId,
  pick,
  className,
}: {
  employeeId: string;
  pick: (employee: EmployeeDto) => string | null;
  className?: string;
}): JSX.Element => {
  const employee = useEmployeeRecord(employeeId);
  const value = employee === undefined ? null : pick(employee);
  if (value === null || value === '') return <span className="text-slate-400">—</span>;
  return <span className={className}>{value}</span>;
};

export const DriversListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // Fleet's own half of the bar — every one of these travels to `/fleet/drivers`.
  const pickedDrivers = idList(sp.get('drv'));
  const job = sp.get('job') ?? '';
  const branch = sp.get('branch') ?? '';
  const area = sp.get('area') ?? '';
  const specialization = sp.get('spec') ?? '';
  const licenseType = sp.get('lic') ?? '';
  const image = sp.get('img') ?? '';
  const active = sp.get('active') ?? '';
  // The HR half — every one of these travels to HR's endpoint, never to Fleet's.
  const hrFilter: DriverHrFilter = {
    // Never set here: this bar names people with the multi-select, which hands over ids rather
    // than a term HR has to resolve — see `DriverPickerFilter`.
    search: '',
    address: sp.get('addr') ?? '',
    governorate: sp.get('gov') ?? '',
    phone: sp.get('phone') ?? '',
  };
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'createdAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'createdAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
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
  const hr = useDriverHrFilter(hrFilter);
  // Reading HR is HR's own permission, and it gates the three text boxes as well as the columns. A
  // URL still carrying one of them is honoured differently: the hook reports `failed` and the
  // banner says why, rather than the page quietly returning an unfiltered list.
  const mayFilterByHr = can('employee.view');
  const hasActiveFilters =
    pickedDrivers.length > 0 ||
    job !== '' ||
    branch !== '' ||
    area !== '' ||
    specialization !== '' ||
    licenseType !== '' ||
    image !== '' ||
    active !== '' ||
    Object.values(hrFilter).some((value) => value !== '');

  // The two ways this bar names people, resolved to the ONE list the fleet query is asked for.
  const employeeIds = driverIdFilter(pickedDrivers, hr.employeeIds);
  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      jobId: job || undefined,
      branchId: branch || undefined,
      area: area || undefined,
      specializationId: specialization || undefined,
      licenseTypeId: licenseType || undefined,
      hasLicenseImage: image === '' ? undefined : image === 'with',
      isActive: active === '' ? undefined : active === 'true',
      // `undefined` when nobody has been named. When somebody HAS the array is always sent,
      // including when it is empty: an empty `$in` is "these two questions agree on nobody", and
      // dropping the parameter there would answer a filtered question with an unfiltered list.
      employeeIds: employeeIds ?? undefined,
    }),
    [paramsKey, employeeIds],
  );
  // Three states hold the fleet query back, and each would otherwise produce a WRONG page rather
  // than a slow one: step ① still running, HR matched more than one page, HR refused or failed.
  const blocked = hr.loading || hr.tooMany || hr.failed;
  // An empty match needs no round-trip: the answer is already known to be nothing.
  const emptyMatch = employeeIds !== null && employeeIds.length === 0;
  const { data, isLoading, isError, error, refetch } = useDrivers(params, !blocked && !emptyMatch);
  // Held back means SHOW NOTHING, not "show what was there before". `useDrivers` keeps the
  // previous page as placeholder data, and when the HR step blocks the filter the parameter is
  // dropped — so the query key collapses back onto the UNFILTERED one, whose cached rows would
  // render underneath a "narrow your filter" banner and read as the filtered answer.
  const rows = blocked || emptyMatch ? [] : (data?.items ?? []);
  // The serial column counts from the start of the LIST, not of the page — «م ٢٦» is the
  // twenty-sixth driver, and restarting at 1 on page two would name two rows the same.
  const serialOffset = data === undefined ? 0 : (data.meta.page - 1) * data.meta.pageSize;

  // Reference names for the HR branch column. Without `branch.view` the list stays empty and the
  // column degrades to a dash rather than showing a raw id.
  const { data: branches = [] } = useBranches(can('branch.view'));
  const { data: jobTitles = [] } = useJobTitles(can('jobTitle.view'));
  const branchName = useMemo(
    () => new Map(branches.map((b) => [b.id, localized(b.name, locale)])),
    [branches, locale],
  );

  // The three fleet catalogs. The COLUMN and the FILTER read the same list — `useFleetCatalog` is
  // one cache entry per kind and `CatalogSelect` subscribes to it too — so a value an admin adds
  // to /fleet/catalogs shows up in both at once and the two cannot drift apart.
  const jobName = useCatalogNames('driverJob', locale);
  const specializationName = useCatalogNames('driverSpecialization', locale);
  const licenseTypeName = useCatalogNames('driverLicenseType', locale);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FleetDriverRowDto | null>(null);
  const [previewing, setPreviewing] = useState<FleetDriverProfileDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  // A cell Fleet has not filled in yet. Not «—» alone: the reader is looking at a driver who is
  // certainly a driver (their seat says so) and whose licence simply has not been entered.
  const NotRecorded = (): JSX.Element => (
    <span className="text-xs text-slate-400" title={t('fleet.drivers.notRecordedHint')}>
      {t('fleet.drivers.notRecorded')}
    </span>
  );

  /** One catalog-backed cell: the item's own name, a dash when nobody has chosen one. */
  const CatalogFact = ({
    id,
    names,
  }: {
    id: string | null | undefined;
    names: ReadonlyMap<string, string>;
  }): JSX.Element => {
    const name = id == null ? undefined : names.get(id);
    if (name === undefined) return <span className="text-slate-400">—</span>;
    return <span>{name}</span>;
  };

  const columns: Column<FleetDriverRowDto>[] = [
    {
      key: 'serial',
      header: t('fleet.drivers.columns.serial'),
      render: (_d, index) => (
        <span className="tabular-nums text-slate-500 dark:text-slate-400">
          {serialOffset + index + 1}
        </span>
      ),
    },
    {
      key: 'driver',
      header: t('fleet.drivers.columns.driver'),
      render: (d) => <EmployeeFact employeeId={d.employeeId} pick={(e) => e.personal.fullNameAr} />,
    },
    {
      key: 'employeeCode',
      header: t('fleet.drivers.columns.employeeCode'),
      render: (d) => (
        <EmployeeFact
          employeeId={d.employeeId}
          pick={(e) => e.code}
          className="font-mono text-xs"
        />
      ),
    },
    {
      key: 'jobTitle',
      header: t('fleet.drivers.columns.jobTitle'),
      render: (d) =>
        d.profile === null ? <NotRecorded /> : <CatalogFact id={d.profile.jobId} names={jobName} />,
    },
    {
      key: 'branch',
      header: t('fleet.drivers.columns.branch'),
      render: (d) => (
        <EmployeeFact
          employeeId={d.employeeId}
          pick={(e) => branchName.get(e.employment.branchId) ?? null}
        />
      ),
    },
    {
      key: 'address',
      header: t('fleet.drivers.columns.address'),
      render: (d) => (
        <EmployeeFact
          employeeId={d.employeeId}
          pick={(e) => {
            const address = e.personal.officialAddress ?? e.personal.currentAddress;
            return address == null ? null : [address.line1, address.city].join('، ');
          }}
        />
      ),
    },
    { key: 'area', header: t('fleet.drivers.columns.area'), render: (d) => d.profile?.area ?? '—' },
    {
      key: 'governorate',
      header: t('fleet.drivers.columns.governorate'),
      render: (d) => (
        <EmployeeFact
          employeeId={d.employeeId}
          pick={(e) =>
            (e.personal.officialAddress ?? e.personal.currentAddress)?.governorate ?? null
          }
        />
      ),
    },
    {
      key: 'phone',
      header: t('fleet.drivers.columns.phone'),
      render: (d) => (
        <EmployeeFact
          employeeId={d.employeeId}
          pick={(e) => e.personal.contact.primaryPhone}
          className="font-mono text-xs"
        />
      ),
    },
    {
      key: 'hiredAt',
      header: t('fleet.drivers.columns.hiredAt'),
      render: (d) => (
        <EmployeeFact
          employeeId={d.employeeId}
          pick={(e) => formatDate(e.hiredAt, locale)}
          className="tabular-nums"
        />
      ),
    },
    {
      key: 'specialization',
      header: t('fleet.drivers.columns.specialization'),
      render: (d) =>
        d.profile === null ? (
          <NotRecorded />
        ) : (
          <CatalogFact id={d.profile.specializationId} names={specializationName} />
        ),
    },
    {
      key: 'licenseType',
      header: t('fleet.drivers.columns.licenseType'),
      render: (d) =>
        d.profile === null ? (
          <NotRecorded />
        ) : (
          <CatalogFact id={d.profile.licenseTypeId} names={licenseTypeName} />
        ),
    },
    {
      key: 'licenseExpiresAt',
      header: t('fleet.drivers.columns.licenseExpiresAt'),
      sortable: true,
      render: (d) => {
        if (d.profile === null) return <NotRecorded />;
        const expired = new Date(d.profile.licenseExpiresAt).getTime() < Date.now();
        return (
          <span
            className={cn('tabular-nums', expired && 'font-medium text-red-600 dark:text-red-400')}
          >
            {formatDate(d.profile.licenseExpiresAt, locale)}
          </span>
        );
      },
    },
    {
      key: 'licenseImage',
      header: t('fleet.drivers.columns.licenseImage'),
      render: (d) =>
        d.profile === null ? (
          <NotRecorded />
        ) : (
          <DriverLicenseImageCell driver={d.profile} onPreview={setPreviewing} />
        ),
    },
    {
      key: 'isActive',
      header: t('fleet.drivers.columns.status'),
      render: (d) =>
        d.profile === null ? (
          // Not «inactive» — nothing has been recorded, and calling that inactive would state a
          // decision nobody made about a driver who is on the road.
          <StatusBadge tone="warning" label={t('fleet.drivers.notRecorded')} />
        ) : (
          <StatusBadge
            tone={d.profile.isActive ? 'success' : 'neutral'}
            label={d.profile.isActive ? t('fleet.drivers.active') : t('fleet.drivers.inactive')}
          />
        ),
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (d) => (
        <span className="flex items-center justify-end gap-1">
          {/* The detail screen is ABOUT a profile, so it is offered only once one exists. */}
          {d.profile !== null && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.drivers.view')}
              title={t('fleet.drivers.view')}
              onClick={() => navigate(d.profile === null ? '' : d.profile.id)}
            >
              <EyeIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetDriver.manage') && (
            <button
              type="button"
              className={actionButton}
              aria-label={d.profile === null ? t('fleet.drivers.record') : t('fleet.drivers.edit')}
              title={d.profile === null ? t('fleet.drivers.record') : t('fleet.drivers.edit')}
              onClick={() => {
                setEditing(d);
                setFormOpen(true);
              }}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.drivers')}
        description={t('fleet.drivers.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.drivers') },
        ]}
      />

      <div className="space-y-4">
        {/* ELEVEN filters, ONE row on a desktop, wrapping below it. `singleRow` does not shorten a
            row that will not fit — it pushes it off the page — so the threshold is measured, and
            every child carries its own width and `shrink-0`: with no wrapping to fall back on, a
            child left to flex would be squeezed by its neighbours instead of moving down.
            The width lives on the WRAPPER, never on the control: `cn` does not merge Tailwind
            classes, so `Input`'s own `w-full` would win over any width passed to it. */}
        <FilterBar
          singleRow
          singleRowFrom={1600}
          hasActiveFilters={hasActiveFilters}
          onClear={() =>
            patch({
              drv: null,
              job: null,
              branch: null,
              addr: null,
              area: null,
              phone: null,
              gov: null,
              spec: null,
              lic: null,
              img: null,
              active: null,
            })
          }
        >
          {/* 1 — the drivers themselves, picked by name or code, as many as the reader means.
              Offered ONLY to someone who can use it: the options are a search against HR's own
              endpoint, so without `employee.view` it can only answer "no directory access". */}
          {mayFilterByHr && (
            <DriverPickerFilter
              value={pickedDrivers}
              onChange={(next) => patch({ drv: next.length === 0 ? null : next.join(',') })}
              className="w-40 shrink-0"
            />
          )}
          {/* 2 — «الوظيفة», from the `driverJob` catalog. No value of it is named on this screen. */}
          <div className="shrink-0">
            <CatalogSelect
              kind="driverJob"
              value={job}
              onChange={(id) => patch({ job: id || null })}
              allLabel={t('fleet.drivers.allJobs')}
              ariaLabel={t('fleet.drivers.columns.jobTitle')}
            />
          </div>
          {/* 3 — «الفرع». A FLEET parameter: see the header note on why asking HR could not work. */}
          {can('branch.view') && (
            <Select
              aria-label={t('fleet.drivers.columns.branch')}
              value={branch}
              onChange={(e) => patch({ branch: e.target.value || null })}
              className="w-auto shrink-0"
            >
              <option value="">{t('fleet.drivers.allBranches')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {localized(b.name, locale)}
                </option>
              ))}
            </Select>
          )}
          {/* 4 — «ابحث بالعنوان», HR-owned, matched over the address as it is displayed. */}
          {mayFilterByHr && (
            <div className="w-28 shrink-0">
              <Input
                aria-label={t('fleet.drivers.columns.address')}
                placeholder={t('fleet.drivers.columns.address')}
                value={hrFilter.address}
                onChange={(e) => patch({ addr: e.target.value || null })}
              />
            </div>
          )}
          {/* 5 — «ابحث بالمنطقة», fleet-owned, straight to /fleet/drivers. */}
          <div className="w-24 shrink-0">
            <Input
              aria-label={t('fleet.drivers.columns.area')}
              placeholder={t('fleet.drivers.areaPlaceholder')}
              value={area}
              onChange={(e) => patch({ area: e.target.value || null })}
            />
          </div>
          {/* 6 — «ابحث برقم الهاتف», HR-owned. */}
          {mayFilterByHr && (
            <div className="w-28 shrink-0">
              <Input
                aria-label={t('fleet.drivers.columns.phone')}
                placeholder={t('fleet.drivers.columns.phone')}
                value={hrFilter.phone}
                onChange={(e) => patch({ phone: e.target.value || null })}
                dir="ltr"
              />
            </div>
          )}
          {/* 7 — «المحافظة», HR-owned. */}
          {mayFilterByHr && (
            <div className="w-24 shrink-0">
              <Input
                aria-label={t('fleet.drivers.columns.governorate')}
                placeholder={t('fleet.drivers.columns.governorate')}
                value={hrFilter.governorate}
                onChange={(e) => patch({ gov: e.target.value || null })}
              />
            </div>
          )}
          {/* 8 — «التخصص», from the `driverSpecialization` catalog. */}
          <div className="shrink-0">
            <CatalogSelect
              kind="driverSpecialization"
              value={specialization}
              onChange={(id) => patch({ spec: id || null })}
              allLabel={t('fleet.drivers.allSpecializations')}
              ariaLabel={t('fleet.drivers.columns.specialization')}
            />
          </div>
          {/* 9 — «الرخصة», from the `driverLicenseType` catalog. */}
          <div className="shrink-0">
            <CatalogSelect
              kind="driverLicenseType"
              value={licenseType}
              onChange={(id) => patch({ lic: id || null })}
              allLabel={t('fleet.drivers.allLicenseTypes')}
              ariaLabel={t('fleet.drivers.columns.licenseType')}
            />
          </div>
          {/* 10 and 11 — the scan and the status, exactly as they were. */}
          <Select
            aria-label={t('fleet.drivers.columns.licenseImage')}
            value={image}
            onChange={(e) => patch({ img: e.target.value || null })}
            className="w-auto shrink-0"
          >
            <option value="">{t('fleet.drivers.allLicenseImages')}</option>
            <option value="with">{t('fleet.drivers.withLicenseImage')}</option>
            <option value="without">{t('fleet.drivers.withoutLicenseImage')}</option>
          </Select>
          <Select
            aria-label={t('fleet.drivers.columns.status')}
            value={active}
            onChange={(e) => patch({ active: e.target.value || null })}
            className="w-auto shrink-0"
          >
            <option value="">{t('fleet.drivers.allStatuses')}</option>
            <option value="true">{t('fleet.drivers.active')}</option>
            <option value="false">{t('fleet.drivers.inactive')}</option>
          </Select>
        </FilterBar>

        {/*
          THE UNSET FLAG, SAID OUT LOUD.

          The registry is everyone whose job title requires a driving test. If no title carries
          that flag the roster is empty — and an empty table is indistinguishable from "this
          company has hired no drivers", which is the failure mode that made the identical problem
          in Operations go unreported rather than unnoticed (PR #375). So it is named, with the one
          screen that ends it.

          Only when the job titles actually loaded: without `jobTitle.view` this reader cannot tell
          the two apart either, and guessing would be worse than saying nothing.
        */}
        {jobTitles.length > 0 && !jobTitles.some((j) => j.requiresDrivingTest) && (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <span className="font-medium">{t('fleet.drivers.noDrivingTitles')}</span>{' '}
            {t('fleet.drivers.noDrivingTitlesHint')}
          </p>
        )}
        {hr.tooMany && (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {t('fleet.drivers.hrFilterTooMany', { matched: hr.matched, max: MAX_PAGE_SIZE })}
          </p>
        )}
        {hr.failed && (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {t('fleet.drivers.hrFilterUnavailable')}
          </p>
        )}
        <DataTable
          columns={columns}
          rows={rows}
          // The PERSON is the row's identity now — a driver with no profile has no profile id.
          rowKey={(d) => d.employeeId}
          loading={hr.loading || (isLoading && !emptyMatch && !blocked)}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
        />
        {data !== undefined && !blocked && !emptyMatch && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <DriverFormDialog
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        employeeId={editing?.employeeId ?? ''}
        profile={editing?.profile ?? null}
      />
      <DriverLicenseImagePreviewDialog
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        driver={previewing}
      />
    </PageContainer>
  );
};
