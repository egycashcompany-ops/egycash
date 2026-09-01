// Drivers registry (FW-5, legacy /drivers): the fleet-owned profiles over HR employees (FR-11).
//
// The table shows thirteen columns, and they come from TWO places on purpose. Five are Fleet's own
// (licence number, licence date, area, specialization, licence image) and are filtered server-side
// and edited here. Eight are HR's (name, employee code, job title, address, governorate, mobile,
// hire date, branch): the browser reads them from HR's endpoint with HR's own `employee.view`,
// displays them, and never writes them. That is FR-11 in practice — Fleet does not own people.
//
// The filter bar spans both, and stays server-side on both. The fleet filters go straight to
// `/fleet/drivers`; the HR filters go to `/hr/employees` FIRST and arrive here as `employeeIds`
// (see `useDriverHrFilter`). Two queries, each answered by the module that owns its data, joined
// by id in the browser — the same join the name column already performs. Nothing is ever filtered
// out of an already-fetched page, and when HR matches more employees than one `employeeIds` page
// can carry, the table says so instead of showing a truncated result that looks complete.
//
// There is no "add driver" action: enrolment left the UI. The create endpoint still exists for the
// API's own consumers; nothing on this screen reaches it.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  type EmployeeDto,
  type FleetDriverProfileDto,
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
import { useDrivers } from '../api/fleet-queries';
import { useDriverHrFilter, type DriverHrFilter } from '../api/driver-hr-filter';
import { useBranches, useJobTitles } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import { useEmployeeRecord } from '../components/EmployeeName';
import { DriverFormDialog } from '../components/DriverFormDialog';
import {
  DriverLicenseImageCell,
  DriverLicenseImagePreviewDialog,
} from '../components/DriverLicenseImage';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'active',
  'area',
  'branch',
  'emp',
  'gov',
  'img',
  'job',
  'phone',
  'q',
  'spec',
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/**
 * One HR-owned cell.
 *
 * Every instance shares ONE cached query per employee (same key as the HR profile page), so a row
 * with eight HR columns still costs a single request. Absent value, absent record and absent
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

  const search = sp.get('q') ?? '';
  const area = sp.get('area') ?? '';
  const specialization = sp.get('spec') ?? '';
  const image = sp.get('img') ?? '';
  const active = sp.get('active') ?? '';
  // The HR half — every one of these travels to HR's endpoint, never to Fleet's.
  const hrFilter: DriverHrFilter = {
    search: sp.get('emp') ?? '',
    jobTitleId: sp.get('job') ?? '',
    branchId: sp.get('branch') ?? '',
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
  // Reading HR is HR's own permission, and it gates the CONTROLS as well as the columns. A URL
  // still carrying an HR filter is honoured differently: the hook reports `failed` and the banner
  // says why, rather than the page quietly returning an unfiltered list.
  const mayFilterByHr = can('employee.view');
  const hasActiveFilters =
    search !== '' ||
    area !== '' ||
    specialization !== '' ||
    image !== '' ||
    active !== '' ||
    Object.values(hrFilter).some((value) => value !== '');

  const employeeIds = hr.employeeIds;
  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      area: area || undefined,
      specialization: specialization || undefined,
      hasLicenseImage: image === '' ? undefined : image === 'with',
      isActive: active === '' ? undefined : active === 'true',
      // `undefined` when no HR filter is set. When one IS set the array is always sent, including
      // when it is empty: an empty `$in` is "HR matched nobody", and dropping the parameter there
      // would answer a filtered question with an unfiltered list.
      employeeIds: employeeIds ?? undefined,
    }),
    [paramsKey, employeeIds],
  );
  // Three states hold the fleet query back, and each would otherwise produce a WRONG page rather
  // than a slow one: step ① still running, HR matched more than one page, HR refused or failed.
  const blocked = hr.loading || hr.tooMany || hr.failed;
  // An empty HR match needs no round-trip: the answer is already known to be nothing.
  const emptyMatch = employeeIds !== null && employeeIds.length === 0;
  const { data, isLoading, isError, error, refetch } = useDrivers(params, !blocked && !emptyMatch);
  // Held back means SHOW NOTHING, not "show what was there before". `useDrivers` keeps the
  // previous page as placeholder data, and when the HR step blocks the filter the parameter is
  // dropped — so the query key collapses back onto the UNFILTERED one, whose cached rows would
  // render underneath a "narrow your filter" banner and read as the filtered answer.
  const rows = blocked || emptyMatch ? [] : (data?.items ?? []);

  // Reference names for the two HR id columns. Without the matching `*.view` grant each list stays
  // empty and the column degrades to a dash rather than showing a raw id.
  const { data: branches = [] } = useBranches(can('branch.view'));
  const { data: jobTitles = [] } = useJobTitles(can('jobTitle.view'));
  const branchName = useMemo(
    () => new Map(branches.map((b) => [b.id, localized(b.name, locale)])),
    [branches, locale],
  );
  const jobTitleName = useMemo(
    () => new Map(jobTitles.map((j) => [j.id, localized(j.name, locale)])),
    [jobTitles, locale],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FleetDriverProfileDto | null>(null);
  const [previewing, setPreviewing] = useState<FleetDriverProfileDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetDriverProfileDto>[] = [
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
      render: (d) => (
        <EmployeeFact
          employeeId={d.employeeId}
          pick={(e) => jobTitleName.get(e.employment.jobTitleId) ?? null}
        />
      ),
    },
    {
      key: 'licenseNumber',
      header: t('fleet.drivers.columns.licenseNumber'),
      render: (d) => (
        <span className="font-mono text-xs" dir="ltr">
          {d.licenseNumber}
        </span>
      ),
    },
    {
      key: 'licenseExpiresAt',
      header: t('fleet.drivers.columns.licenseExpiresAt'),
      sortable: true,
      render: (d) => {
        const expired = new Date(d.licenseExpiresAt).getTime() < Date.now();
        return (
          <span
            className={cn('tabular-nums', expired && 'font-medium text-red-600 dark:text-red-400')}
          >
            {formatDate(d.licenseExpiresAt, locale)}
          </span>
        );
      },
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
    { key: 'area', header: t('fleet.drivers.columns.area'), render: (d) => d.area ?? '—' },
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
      render: (d) => t(`fleet.drivers.specialization.${d.specialization}`),
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
      key: 'licenseImage',
      header: t('fleet.drivers.columns.licenseImage'),
      render: (d) => <DriverLicenseImageCell driver={d} onPreview={setPreviewing} />,
    },
    {
      key: 'isActive',
      header: t('fleet.drivers.columns.status'),
      render: (d) => (
        <StatusBadge
          tone={d.isActive ? 'success' : 'neutral'}
          label={d.isActive ? t('fleet.drivers.active') : t('fleet.drivers.inactive')}
        />
      ),
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (d) => (
        <span className="flex items-center justify-end gap-1">
          <button
            type="button"
            className={actionButton}
            aria-label={t('fleet.drivers.view')}
            title={t('fleet.drivers.view')}
            onClick={() => navigate(d.id)}
          >
            <EyeIcon className="h-4 w-4" />
          </button>
          {can('fleetDriver.manage') && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.drivers.edit')}
              title={t('fleet.drivers.edit')}
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
        {/* One wrapping row on desktop, stacked on a narrow screen. The width lives on the WRAPPER,
            never on the control: `cn` does not merge Tailwind classes, so `Input`'s own `w-full`
            would win over any width passed to it. */}
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() =>
            patch({
              q: null,
              area: null,
              spec: null,
              img: null,
              active: null,
              emp: null,
              job: null,
              branch: null,
              gov: null,
              phone: null,
            })
          }
        >
          {/* HR-owned, and offered ONLY to someone who can use them. Step ① of these filters is a
              query against HR's own endpoint, so without `employee.view` every one of them can
              only answer "no directory access" — the same reason the HR columns show dashes for
              that caller. Offering a control that cannot work is the filter-bar version of
              offering a link that lands on a permission wall.

              One box for name AND employee code because HR's `search` is one parameter covering
              both — two boxes would need two HR queries whose capped pages could intersect to a
              WRONG answer, which is the false filtering this design exists to avoid. */}
          {mayFilterByHr && (
            <>
              <div className="w-48">
                <Input
                  aria-label={t('fleet.drivers.filters.employee')}
                  placeholder={t('fleet.drivers.filters.employee')}
                  value={hrFilter.search}
                  onChange={(e) => patch({ emp: e.target.value || null })}
                />
              </div>
              {/* Each reference select needs its own catalogue grant too: without it the list comes
              back empty and the control would be a dropdown with nothing to pick. */}
              {can('jobTitle.view') && (
                <Select
                  aria-label={t('fleet.drivers.columns.jobTitle')}
                  value={hrFilter.jobTitleId}
                  onChange={(e) => patch({ job: e.target.value || null })}
                  className="w-auto"
                >
                  <option value="">{t('fleet.drivers.allJobTitles')}</option>
                  {jobTitles.map((jobTitle) => (
                    <option key={jobTitle.id} value={jobTitle.id}>
                      {localized(jobTitle.name, locale)}
                    </option>
                  ))}
                </Select>
              )}
              {can('branch.view') && (
                <Select
                  aria-label={t('fleet.drivers.columns.branch')}
                  value={hrFilter.branchId}
                  onChange={(e) => patch({ branch: e.target.value || null })}
                  className="w-auto"
                >
                  <option value="">{t('fleet.drivers.allBranches')}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {localized(branch.name, locale)}
                    </option>
                  ))}
                </Select>
              )}
              <div className="w-32">
                <Input
                  aria-label={t('fleet.drivers.columns.governorate')}
                  placeholder={t('fleet.drivers.columns.governorate')}
                  value={hrFilter.governorate}
                  onChange={(e) => patch({ gov: e.target.value || null })}
                />
              </div>
              <div className="w-36">
                <Input
                  aria-label={t('fleet.drivers.columns.phone')}
                  placeholder={t('fleet.drivers.columns.phone')}
                  value={hrFilter.phone}
                  onChange={(e) => patch({ phone: e.target.value || null })}
                  dir="ltr"
                />
              </div>
            </>
          )}
          {/* Fleet-owned, straight to /fleet/drivers. */}
          <div className="w-40">
            <Input
              aria-label={t('fleet.drivers.columns.licenseNumber')}
              placeholder={t('fleet.drivers.searchPlaceholder')}
              value={search}
              onChange={(e) => patch({ q: e.target.value || null })}
            />
          </div>
          <div className="w-36">
            <Input
              aria-label={t('fleet.drivers.columns.area')}
              placeholder={t('fleet.drivers.areaPlaceholder')}
              value={area}
              onChange={(e) => patch({ area: e.target.value || null })}
            />
          </div>
          <Select
            aria-label={t('fleet.drivers.columns.specialization')}
            value={specialization}
            onChange={(e) => patch({ spec: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.drivers.allSpecializations')}</option>
            {(['cashTransport', 'atm', 'both'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`fleet.drivers.specialization.${value}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('fleet.drivers.columns.licenseImage')}
            value={image}
            onChange={(e) => patch({ img: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.drivers.allLicenseImages')}</option>
            <option value="with">{t('fleet.drivers.withLicenseImage')}</option>
            <option value="without">{t('fleet.drivers.withoutLicenseImage')}</option>
          </Select>
          <Select
            aria-label={t('fleet.drivers.columns.status')}
            value={active}
            onChange={(e) => patch({ active: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.drivers.allStatuses')}</option>
            <option value="true">{t('fleet.drivers.active')}</option>
            <option value="false">{t('fleet.drivers.inactive')}</option>
          </Select>
        </FilterBar>

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
          rowKey={(d) => d.id}
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
        profile={editing}
      />
      <DriverLicenseImagePreviewDialog
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        driver={previewing}
      />
    </PageContainer>
  );
};
