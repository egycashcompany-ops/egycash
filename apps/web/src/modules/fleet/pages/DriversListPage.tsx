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
import { FilterField } from '../../../shared/ui/FilterField';
import { Pagination } from '../../../shared/ui/Pagination';
import { Select } from '../../../shared/ui/form';
import { DebouncedInput } from '../../../shared/ui/DebouncedInput';
import { EditIcon, EyeIcon, UploadIcon } from '../../../shared/ui/icons';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useDrivers, useFleetCatalog } from '../api/fleet-queries';
import { useDriverHrFilter, type DriverHrFilter } from '../api/driver-hr-filter';
import {
  useBranches,
  useDrivingJobTitles,
} from '../../hr/recruitment/job-offers/api/job-offer-queries';
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
  'addr',
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

/**
 * Every filter is `density="tight"`: 8px off a text box, 24px off a select, and — since the
 * picker takes it too — the whole row is one size of control rather than ten of one and one of
 * another.
 *
 * That is not cosmetics, it is the arithmetic of the row. Eleven controls at the default gutters
 * spend 430px on their own chrome before a single letter is drawn, and the shell leaves this bar
 * 952px of content at 1280 — so the names had nowhere to go and clipped to «الـ». Tight gutters
 * give that back, which is what lets all eleven NAMES read at the narrowest desktop.
 *
 * MEASURED, not chosen: each wrapper's `basis` below is the width its own label actually needs
 * (text + gutters + chevron), so the eleven ask for 846px of the 864 available once the count
 * chip and the gaps are paid for. Every one of them was clipped mid-word before that arithmetic
 * was done — «الرخص», «التخصـ», «المحافظ», «الفرـ».
 */
const TIGHT = 'tight' as const;

/**
 * One filter's share of the row, and every filter gets the SAME one.
 *
 * `flex-1 basis-0` is the whole point: a control's width no longer depends on how long its own
 * words happen to be, which is what made the previous bar eleven boxes of eleven arbitrary sizes
 * with no rhythm to them. They divide the row equally and grow together as the screen does.
 *
 * That only became possible once the names moved ABOVE the controls (`FilterField`): a `<select>`
 * whose widest option is «صورة الرخصة» demands that much width, while one whose widest option is
 * «الكل» demands almost none. `min-w` is the floor at which a field's NAME is still readable.
 */
const CELL = 'flex-1 basis-0 min-w-[4.5rem]';

/**
 * A text box's own width. Unlike a `<select>`, an `<input>` has no content to be as wide as — its
 * intrinsic width is a browser default of about twenty characters, far more than any of these
 * four need — so the one width that has to be stated is theirs.
 */
// Each control's `basis` is measured from the WORDS ON IT, not from the longest thing it could
// ever hold. A `<select>` is otherwise as wide as its longest option — «سائق صراف الى», a branch
// name, a catalog value an admin adds tomorrow — and eleven of them demanded 1478px of a bar that
// holds 974 at 1280, so the names had nowhere to go. Sized to their own labels the row asks for
// 984px, every filter NAME reads at the narrowest desktop, and what gives way instead is a long
// chosen VALUE — the right thing to lose, because the table below is already showing it.

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
  const specialization = sp.get('spec') ?? '';
  const licenseType = sp.get('lic') ?? '';
  const image = sp.get('img') ?? '';
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
  // The two HR reference lists this screen reads. Declared before the HR filter step because it
  // needs one of them: without the matching `*.view` grant each stays empty, and the column that
  // depends on it degrades to a dash rather than showing a raw id.
  const { data: branches = [] } = useBranches(can('branch.view'));
  // WHO THIS REGISTRY IS: everyone whose job title requires a driving test. Handing those titles
  // to step ① is what keeps «الجيزة» a question about DRIVERS rather than about the payroll — see
  // `useDriverHrFilter`. Without `jobTitle.view` the list is empty and the hook does not narrow,
  // which is the same degradation this screen already makes everywhere else HR is involved.
  //
  // ASKED FOR BY THE FLAG, not filtered out of a page of the catalogue. Reading one page and
  // keeping the driving ones worked only while the whole catalogue fitted in that page: a company
  // with more than a hundred job titles lost the seats that fell off the end, the narrowing below
  // silently became "ask HR about everybody", and every text filter on this bar went back to
  // overflowing HR's cap and matching nobody. Measured at 122 titles: zero seats seen, «الجيزة»
  // answered «narrow your filter» and filtered nothing.
  const { data: drivingTitles = [], isSuccess: drivingTitlesRead } = useDrivingJobTitles(
    can('jobTitle.view'),
  );
  const drivingTitleIds = useMemo(() => drivingTitles.map((title) => title.id), [drivingTitles]);
  const hr = useDriverHrFilter(hrFilter, drivingTitleIds);
  // Reading HR is HR's own permission, and it gates the three text boxes as well as the columns. A
  // URL still carrying one of them is honoured differently: the hook reports `failed` and the
  // banner says why, rather than the page quietly returning an unfiltered list.
  const mayFilterByHr = can('employee.view');
  const hasActiveFilters =
    pickedDrivers.length > 0 ||
    job !== '' ||
    branch !== '' ||
    specialization !== '' ||
    licenseType !== '' ||
    image !== '' ||
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
      specializationId: specialization || undefined,
      licenseTypeId: licenseType || undefined,
      hasLicenseImage: image === '' ? undefined : image === 'with',
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
  /**
   * How many drivers the CURRENT filter matches — the whole answer, not this page of it.
   *
   * `null` while there is no answer to give: still loading, or held back because the HR step
   * blocked. A count is the one thing on this bar a reader will quote at somebody, so it says
   * nothing rather than a stale number from the previous filter.
   */
  const matchedDrivers = blocked
    ? null
    : emptyMatch
      ? 0
      : isLoading || data === undefined
        ? null
        : data.meta.totalItems;

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
      key: 'driver',
      header: t('fleet.drivers.columns.driver'),
      render: (d) => <EmployeeFact employeeId={d.employeeId} pick={(e) => e.personal.fullNameAr} />,
    },
    {
      key: 'employeeCode',
      header: t('fleet.drivers.columns.employeeCode'),
      // Plain, like the job title beside it. `font-mono text-xs` made the one column a reader
      // matches against a paper list the smallest and least legible thing on the row.
      render: (d) => <EmployeeFact employeeId={d.employeeId} pick={(e) => e.code} />,
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
          // «مفيش مكان ان ارفع صوره الرخصه لو مش موجوده بيقولى غير مسجل». The cell used to be dead
          // grey text. The licence file hangs on the PROFILE — every endpoint is
          // `/fleet/drivers/:profileId/license-image` — so there is genuinely nothing to attach a
          // scan to until the driver is enrolled, and enrolling needs a licence number and an
          // expiry date that only a person can supply. What was missing was not an upload button
          // but a WAY IN: the only affordance was the same pencil as every other row, telling a
          // reader nothing about what it would do from here.
          //
          // So the cell says what it is and opens the very dialog that fixes it — where the scan
          // can be chosen in the same visit and is uploaded the moment the profile exists.
          // AND IT LOOKS LIKE THE VEHICLES' COLUMN, because it is the same column — «زى شاشه
          // السيارات بالظبط». It was a two-line block of text, the only prose in a strip of icon
          // buttons, and it set the width of the column for every other row. An upload icon is
          // what a car with no scan shows; a driver with no PROFILE shows the same icon, and the
          // difference — that pressing it opens the enrolment dialog rather than a file picker —
          // lives in the accessible name and the tooltip, which is where a difference in what a
          // control DOES belongs when the thing it is aiming at is identical.
          can('fleetDriver.manage') ? (
            <button
              type="button"
              data-driver-enrol={d.employeeId}
              aria-label={t('fleet.drivers.licenseImage.addViaProfile')}
              title={t('fleet.drivers.licenseImage.addViaProfile')}
              className={actionButton}
              onClick={() => {
                setEditing(d);
                setFormOpen(true);
              }}
            >
              <UploadIcon className="h-4 w-4" />
            </button>
          ) : (
            <NotRecorded />
          )
        ) : (
          <DriverLicenseImageCell driver={d.profile} onPreview={setPreviewing} />
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
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.drivers') },
        ]}
      />

      <div className="space-y-4">
        {/*
          ELEVEN filters, ONE row, from 1280px up.

          They SHARE the bar's width rather than each demanding its own. Every child is
          `flex-1 min-w-0` over a `basis` that says how much of the row it deserves, so the eleven
          divide whatever there is: they grow on a 1920 screen and shrink on a 1280 one, and the
          row cannot be pushed off the page at any width in between. Fixed widths could not do
          this — the controls measure 1478px at their natural size and the bar holds 974px at
          1280, so a row of `shrink-0` children would have had to wrap (which the brief refuses)
          or overflow (which it refuses too).

          `min-w-0` is what makes shrinking legal: without it a flex child refuses to go below its
          content width, and `<select>` content is its longest option — one long branch name would
          push the row out on its own.

          The width lives on the WRAPPER and the control inside is `w-full`: `cn` does not merge
          Tailwind classes, so a width passed to `Input` would fight its own `w-full` rather than
          replace it.
        */}
        <FilterBar
          singleRow
          singleRowFrom={1280}
          hasActiveFilters={hasActiveFilters}
          // The count belongs BESIDE the filters, not in the table: it is the answer to what the
          // bar was just asked, and a reader comparing two filters compares two counts.
          trailing={
            matchedDrivers === null ? undefined : (
              <span
                role="status"
                className="whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-sm font-medium tabular-nums text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                title={t('fleet.drivers.countLabel')}
              >
                {t('fleet.drivers.count', { count: formatNumber(matchedDrivers, locale) })}
              </span>
            )
          }
          onClear={() =>
            patch({
              drv: null,
              job: null,
              branch: null,
              addr: null,
              phone: null,
              gov: null,
              spec: null,
              lic: null,
              img: null,
            })
          }
        >
          {/* Eleven fields, EQUAL width, each with its own name above it — see `FilterField`.
              `flex-1 basis-0` is what makes them equal: the share of the row a control gets no
              longer depends on how long its own words happen to be, which is what made the old bar
              read as eleven arbitrary boxes. `min-w` keeps a field from collapsing past the point
              where its name can be read at all. */}
          {mayFilterByHr && (
            <FilterField
              label={t('fleet.drivers.filters.employeeShort')}
              active={pickedDrivers.length > 0}
              className={CELL}
              density={TIGHT}
            >
              <DriverPickerFilter
                value={pickedDrivers}
                onChange={(next) => patch({ drv: next.length === 0 ? null : next.join(',') })}
                // The same seats the roster is built from, so every name it offers is a name this
                // table can actually show.
                jobTitleIds={drivingTitleIds}
                density={TIGHT}
                // The question is written above now, so the trigger says only the ANSWER.
                placeholder={t('common.filters.all')}
                // Its trigger is an `inline-flex`, so without this it shrank to the width of the
                // word «الكل» while the ten selects beside it filled theirs — one small box at the
                // end of an otherwise even row.
                fullWidth
                className="w-full"
              />
            </FilterField>
          )}
          <FilterField
            label={t('fleet.drivers.columns.jobTitle')}
            active={job !== ''}
            className={CELL}
            density={TIGHT}
          >
            <CatalogSelect
              kind="driverJob"
              value={job}
              onChange={(id) => patch({ job: id || null })}
              allLabel={t('common.filters.all')}
              ariaLabel={t('fleet.drivers.columns.jobTitle')}
              className="w-full"
              density={TIGHT}
            />
          </FilterField>
          {can('branch.view') && (
            <FilterField
              label={t('fleet.drivers.columns.branch')}
              active={branch !== ''}
              className={CELL}
              density={TIGHT}
            >
              <Select
                aria-label={t('fleet.drivers.columns.branch')}
                value={branch}
                onChange={(e) => patch({ branch: e.target.value || null })}
                density={TIGHT}
              >
                <option value="">{t('common.filters.all')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {localized(b.name, locale)}
                  </option>
                ))}
              </Select>
            </FilterField>
          )}
          {mayFilterByHr && (
            <FilterField
              label={t('fleet.drivers.columns.address')}
              active={hrFilter.address !== ''}
              className={CELL}
              density={TIGHT}
            >
              <DebouncedInput
                aria-label={t('fleet.drivers.columns.address')}
                density={TIGHT}
                value={hrFilter.address}
                onValueChange={(next) => patch({ addr: next || null })}
              />
            </FilterField>
          )}
          {mayFilterByHr && (
            <FilterField
              label={t('fleet.drivers.columns.phone')}
              active={hrFilter.phone !== ''}
              className={CELL}
              density={TIGHT}
            >
              <DebouncedInput
                aria-label={t('fleet.drivers.columns.phone')}
                density={TIGHT}
                value={hrFilter.phone}
                onValueChange={(next) => patch({ phone: next || null })}
                dir="ltr"
              />
            </FilterField>
          )}
          {mayFilterByHr && (
            <FilterField
              label={t('fleet.drivers.columns.governorate')}
              active={hrFilter.governorate !== ''}
              className={CELL}
              density={TIGHT}
            >
              <DebouncedInput
                aria-label={t('fleet.drivers.columns.governorate')}
                density={TIGHT}
                value={hrFilter.governorate}
                onValueChange={(next) => patch({ gov: next || null })}
              />
            </FilterField>
          )}
          <FilterField
            label={t('fleet.drivers.columns.specialization')}
            active={specialization !== ''}
            className={CELL}
            density={TIGHT}
          >
            <CatalogSelect
              kind="driverSpecialization"
              value={specialization}
              onChange={(id) => patch({ spec: id || null })}
              allLabel={t('common.filters.all')}
              ariaLabel={t('fleet.drivers.columns.specialization')}
              className="w-full"
              density={TIGHT}
            />
          </FilterField>
          <FilterField
            label={t('fleet.drivers.columns.licenseType')}
            active={licenseType !== ''}
            className={CELL}
            density={TIGHT}
          >
            <CatalogSelect
              kind="driverLicenseType"
              value={licenseType}
              onChange={(id) => patch({ lic: id || null })}
              allLabel={t('common.filters.all')}
              ariaLabel={t('fleet.drivers.columns.licenseType')}
              className="w-full"
              density={TIGHT}
            />
          </FilterField>
          <FilterField
            label={t('fleet.drivers.columns.licenseImage')}
            active={image !== ''}
            className={CELL}
            density={TIGHT}
          >
            <Select
              aria-label={t('fleet.drivers.columns.licenseImage')}
              value={image}
              onChange={(e) => patch({ img: e.target.value || null })}
              density={TIGHT}
            >
              <option value="">{t('common.filters.all')}</option>
              <option value="with">{t('fleet.drivers.withLicenseImage')}</option>
              <option value="without">{t('fleet.drivers.withoutLicenseImage')}</option>
            </Select>
          </FilterField>
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
        {drivingTitlesRead && drivingTitles.length === 0 && (
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
