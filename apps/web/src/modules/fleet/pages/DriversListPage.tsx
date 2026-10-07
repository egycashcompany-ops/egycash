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
//
// «عاوز شاشه السائقون تكون زى السيارات»: the vehicles board's look — no page title, a bar with the
// count, «الإحصائيات» and the Excel / PDF pill, the figures behind it, the dark filter bar with an
// icon on every filter, and the vehicles table.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  type FleetCatalogKind,
  type FleetDriverProfileDto,
  type FleetDriverRowDto,
  type FleetPersonDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { FleetPager } from '../components/FleetPager';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { listKey } from '../../../shared/lib/query-keys';
import { readList, writeList } from '../../../shared/lib/list-param';
import { DebouncedInput } from '../../../shared/ui/DebouncedInput';
import { EditIcon, EyeIcon, PrinterIcon, UploadIcon } from '../../../shared/ui/icons';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useDrivers, useFleetCatalog } from '../api/fleet-queries';
import * as fleetApi from '../api/fleet-api';
import { useDriverHrFilter, type DriverHrFilter } from '../api/driver-hr-filter';
import {
  useBranches,
  useDrivingJobTitles,
} from '../../hr/recruitment/job-offers/api/job-offer-queries';
import { useEmployeeRecord } from '../components/EmployeeName';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { printFleetReport } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { DARK_FILTER_BAR, pickOne } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { BreakdownCard, FigureChip } from '../components/FleetFigures';
import { BoardIcon, PATH, expiryState } from '../components/FuelCardBoard';
import { DARK_TABLE } from './VehiclesListPage';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { CatalogMultiSelect } from '../components/CatalogMultiSelect';
import { DriverPickerFilter } from '../components/DriverPickerFilter';
import { DriverFormDialog } from '../components/DriverFormDialog';
import {
  DRIVER_LICENSE_IMAGE_ACCEPT,
  DriverLicenseImageCell,
  DriverLicenseImagePreviewDialog,
  usePrintDriverLicence,
} from '../components/DriverLicenseImage';
import { driverIdFilter } from '../lib/driver-filter-selection';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
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

/** Every filter is `density="tight"`, as on the vehicles board. */
const TIGHT = 'tight' as const;

/** The board's toolbar buttons, from the vehicles screen. */
const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-brand-200';
const PILL_BUTTON =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 transition active:scale-95 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs dark:text-slate-200';

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

/** id → its place in one fleet catalog, as the admin ordered it. */
const useCatalogIndex = (kind: FleetCatalogKind): ReadonlyMap<string, number> => {
  const { data } = useFleetCatalog(kind);
  return useMemo(() => new Map((data?.items ?? []).map((item, index) => [item.id, index])), [data]);
};

/**
 * One PERSON-owned cell.
 *
 * Every instance reads FLEET's own people list — one request for the whole board, shared by every
 * cell on it — so this screen needs no HR grant to print a driver. Absent value, absent person
 * and absent `fleetDriver.view` all render the same dash: the cell never leaks an id in place of
 * a name.
 */
const EmployeeFact = ({
  employeeId,
  pick,
  className,
  tone,
  titled = false,
}: {
  employeeId: string;
  pick: (person: FleetPersonDto) => string | null;
  className?: string;
  /** A colour picked from the value itself — a branch keeps its own. */
  tone?: (value: string) => string;
  /** Carry the whole value on hover — for a cell cut short with «…». */
  titled?: boolean;
}): JSX.Element => {
  const person = useEmployeeRecord(employeeId);
  const value = person === undefined ? null : pick(person);
  if (value === null || value === '') return <span className="text-slate-400">—</span>;
  return (
    <span className={cn(className, tone?.(value))} {...(titled ? { title: value } : {})}>
      {value}
    </span>
  );
};

/** `2020-09-06…` → `2020/09/06`, the way the Fleet boards write a day. */
const day = (iso: string | null): string | null =>
  iso === null ? null : iso.slice(0, 10).replace(/-/gu, '/');

/** The avatars' colours — a driver keeps the same one, picked from their code. */
const AVATAR_TONES = [
  'bg-gradient-to-br from-violet-500 to-indigo-600 text-white ring-violet-400/40',
  'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  'bg-gradient-to-br from-amber-400 to-orange-500 text-white ring-amber-400/40',
  'bg-rose-500/10 text-rose-300 ring-rose-500/30',
  'bg-gradient-to-br from-emerald-500 to-teal-600 text-white ring-emerald-400/40',
  'bg-indigo-500/10 text-indigo-300 ring-indigo-500/30',
  'bg-sky-500/10 text-sky-300 ring-sky-500/30',
] as const;

/** A stable pick from a palette, by a string — the same driver, branch or item, the same colour. */
const toneOf = <T,>(key: string, palette: readonly T[]): T =>
  palette[[...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % palette.length] as T;

/**
 * «اسم السائق والموقع», as the reference draws it — a round badge with the first letters of the
 * name (a green dot on an active driver) and the name. «اللى تحت اسم السواق اللى هى المدينه
 * والمحافظه شيلها»: nothing under it.
 */
const DriverNameCell = ({
  employeeId,
  active,
}: {
  employeeId: string;
  active: boolean;
}): JSX.Element => {
  const person = useEmployeeRecord(employeeId);
  if (person === undefined || person.fullNameAr === '') {
    return <span className="text-slate-400">—</span>;
  }
  const words = person.fullNameAr.trim().split(/\s+/u);
  const initials = words
    .slice(0, 2)
    // «السيد» gives «س», not «ا»: the article is not the name.
    .map((word) => (word.startsWith('ال') && word.length > 2 ? word.charAt(2) : word.charAt(0)))
    .join('');
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className={cn(
          'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black ring-1',
          toneOf(person.code, AVATAR_TONES),
        )}
      >
        {initials}
        {active && (
          <i className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-[#111827]" />
        )}
      </span>
      <span className="min-w-0 leading-tight">
        <span
          className="block max-w-[12rem] truncate font-bold min-[1750px]:max-w-[16rem]"
          title={person.fullNameAr}
        >
          {person.fullNameAr}
        </span>
      </span>
    </span>
  );
};

/** «درجة أولى» / «درجة ثانية» — the licence class by its place in the catalog. */
const GRADE_ORDINALS = ['أولى', 'ثانية', 'ثالثة', 'رابعة', 'خامسة'] as const;

/** The row's printer — the driver's licence on the registry's paper. */
const PrintLicenceButton = ({ driver }: { driver: FleetDriverProfileDto }): JSX.Element => {
  const t = useT();
  const print = usePrintDriverLicence(driver);
  return (
    <button
      type="button"
      data-driver-license-print={driver.id}
      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      aria-label={t('fleet.drivers.licenseImage.print')}
      title={t('fleet.drivers.licenseImage.print')}
      onClick={() => void print()}
    >
      <PrinterIcon className="h-4 w-4" />
    </button>
  );
};

/**
 * The order this screen opens in, before the reader has asked for one.
 *
 * Named, because it is used twice and the two must agree: the table is DRAWN in it, and a
 * first click REPLACES it rather than joining it — see `clickSort`.
 */
// «والسواقيين يتعرضوا بالترتيب بتاع الاكواد — كود الموظف». The code is how the company names a
// person, so it is the order somebody looking for one reads down. It also matches what the server
// falls back to, so a first load and a cleared sort agree.
const DEFAULT_SORT = 'employeeCode:asc';

export const DriversListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // Fleet's own half of the bar — every one of these travels to `/fleet/drivers`.
  const pickedDrivers = idList(sp.get('drv'));
  // The four reference filters take SEVERAL answers each — «اى فلتر ف الحركه زياده عن اتنين اختار
  // ما بينهم اعملى multi selection». A comma-separated list in the address bar, which is what the
  // API's own `listQuery` parses, so a link carrying one id still means exactly that one id.
  const jobs = readList(sp, 'job');
  const branchIds = readList(sp, 'branch');
  const specializations = readList(sp, 'spec');
  const licenseTypes = readList(sp, 'lic');
  // TWO ANSWERS, so it stays a single select: with «بصورة» and «بدون» a multi-select can only
  // say what one of them already says, or say both — which is the unfiltered registry.
  const image = sp.get('img') ?? '';
  // The HR half — every one of these travels to HR's endpoint, never to Fleet's.
  const hrFilter: DriverHrFilter = {
    // Never set here: this bar names people with the multi-select, which hands over ids rather
    // than a term HR has to resolve — see `DriverPickerFilter`.
    search: '',
    // «شيله كمان من الفلتر»: the address is no longer a filter here — an old link's `addr` is
    // ignored rather than narrowing the table by a box nobody can see.
    address: '',
    governorate: sp.get('gov') ?? '',
    phone: sp.get('phone') ?? '',
  };
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  /**
   * The columns this table is sorted by, in the order the reader clicked them —
   * «انا عاوز اقدر اعمل الاتنين مع بعض». One parameter carries the whole order; `createdAt:desc`
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
  /**
   * The driving seats — kept for ONE thing: the banner that says «no job title carries the
   * driving-test flag», which is why this registry would be empty.
   *
   * It no longer narrows any filter. That was the two-step's problem, not this screen's: step ①
   * asked HR about the whole payroll and had to be told which seats to look at, under
   * `jobTitle.view`. The roster Fleet publishes IS those seats.
   */
  const { data: drivingTitles = [], isSuccess: drivingTitlesRead } = useDrivingJobTitles(
    can('jobTitle.view'),
  );

  // THE PERSON FILTERS NARROW FLEET'S OWN ROSTER, in hand — no HR step, no page cap, and no job
  // titles to resolve first. See `useDriverHrFilter`, where the reasoning for each of those
  // disappearances lives.
  const hr = useDriverHrFilter(hrFilter);
  // The roster is the drivers' own view grant, and it gates the three text boxes as well as the
  // columns. A URL still carrying one of them is honoured differently: the hook reports `failed`
  // and the banner says why, rather than the page quietly returning an unfiltered list.
  const mayFilterByHr = can('fleetDriver.view');
  const hasActiveFilters =
    pickedDrivers.length > 0 ||
    jobs.length > 0 ||
    branchIds.length > 0 ||
    specializations.length > 0 ||
    licenseTypes.length > 0 ||
    image !== '' ||
    Object.values(hrFilter).some((value) => value !== '');

  // The two ways this bar names people, resolved to the ONE list the fleet query is asked for.
  const employeeIds = driverIdFilter(pickedDrivers, hr.employeeIds);
  const params = useMemo(
    () => ({
      page,
      pageSize,
      ...sortQuery(sorts),
      jobId: jobs.length === 0 ? undefined : jobs,
      branchId: branchIds.length === 0 ? undefined : branchIds,
      specializationId: specializations.length === 0 ? undefined : specializations,
      licenseTypeId: licenseTypes.length === 0 ? undefined : licenseTypes,
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
  const licenseTypeIndex = useCatalogIndex('driverLicenseType');
  const signatories = useReportSignatories();

  // The figures describe the WHOLE registry, as the vehicles board's do — read when the reader
  // opens them, never on the way in.
  const [statsOpen, setStatsOpen] = useState(false);
  const wholeRegistry = useQuery({
    queryKey: listKey('fleet', 'drivers', { whole: true }),
    queryFn: () =>
      fetchFilteredRows((pageNo, size) => fleetApi.listDrivers({ page: pageNo, pageSize: size })),
    enabled: statsOpen,
    staleTime: 60_000,
  });
  const figures = useMemo(() => {
    const items = wholeRegistry.data ?? [];
    const thisMonth = new Date().toISOString().slice(0, 7);
    const now = Date.now();
    /** How many drivers sit on each entry of one catalog; the unrecorded ones last. */
    const tally = (
      pick: (profile: FleetDriverProfileDto) => string | null,
      names: ReadonlyMap<string, string>,
    ): { id: string; name: string; count: number }[] => {
      const counts = new Map<string, number>();
      for (const d of items) {
        const id = d.profile === null ? '' : (pick(d.profile) ?? '');
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([id, count]) => ({
          id,
          name: id === '' ? t('fleet.drivers.notRecorded') : (names.get(id) ?? '—'),
          count,
        }))
        .sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : b.count - a.count));
    };
    const expiries = items.flatMap((d) =>
      d.profile?.licenseExpiresAt == null ? [] : [d.profile.licenseExpiresAt],
    );
    return {
      total: items.length,
      recorded: items.filter((d) => d.profile !== null).length,
      thisMonth: expiries.filter((day) => day.slice(0, 7) === thisMonth).length,
      expired: expiries.filter((day) => new Date(day).getTime() < now).length,
      noImage: items.filter((d) => d.profile === null || d.profile.licenseImage === null).length,
      jobs: tally((profile) => profile.jobId, jobName),
      specializations: tally((profile) => profile.specializationId, specializationName),
      licenseTypes: tally((profile) => profile.licenseTypeId, licenseTypeName),
    };
  }, [wholeRegistry.data, jobName, specializationName, licenseTypeName, t]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FleetDriverRowDto | null>(null);
  const [previewing, setPreviewing] = useState<FleetDriverProfileDto | null>(null);
  /**
   * The scan chosen from the licence cell of a driver who has NO profile yet, on its way into the
   * dialog that will create one. See the cell for why the picker comes first.
   *
   * `pickerKey` remounts the file input after each choice so picking the SAME file again still
   * fires a change event — the identical trick `DriverLicenseImageCell` uses for an enrolled
   * driver, and needed here for the same reason: a reader who cancels the dialog and comes back
   * to the same row is choosing the same file.
   */
  const [stagedScan, setStagedScan] = useState<File | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const actionButton =
    // The colour comes with each button, grey as on the vehicles table.
    'rounded-md p-1.5 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800';

  /**
   * The people this file names — FLEET's own roster, in one request.
   *
   * It used to fetch HR's record per driver, in batches, under `employee.view`; the roster is one
   * list, so the sheet asks for it once and looks every row up in hand. A reader without
   * `fleetDriver.view` gets an empty map and the person columns land blank — exactly the dash the
   * table draws — rather than the export leaking a raw employee id in place of a name.
   */
  const fleetPeople = async (): Promise<Map<string, FleetPersonDto>> => {
    try {
      const roster = await queryClient.fetchQuery({
        queryKey: ['fleet', 'people'],
        queryFn: () => fleetApi.listFleetPeople(),
        staleTime: 5 * 60_000,
      });
      return new Map(roster.map((person) => [person.employeeId, person]));
    } catch {
      return new Map();
    }
  };

  /** A catalog reference as the table resolves it: the item's own name, blank when nobody chose one. */
  const catalogText = (id: string | null, names: ReadonlyMap<string, string>): string =>
    (id === null ? undefined : names.get(id)) ?? '';

  /**
   * «للشاشات دى اعملى اكسلات هتاخد اللى الفلتر عامله بس · ومفيش امضاءات».
   *
   * THE FILTER'S WHOLE ANSWER, not the page's. `params` carries the reader's filters AND their
   * page; the page is dropped here and `fetchFilteredRows` walks every one of them, so a reader
   * who narrows to three hundred drivers gets three hundred rows rather than the twenty-five in
   * front of them. A file that is silently short is the worst kind of wrong, because it looks
   * complete. The sort goes with the filters untouched, so the file opens in the order the reader
   * is looking at.
   *
   * THE COLUMNS ARE THE TABLE'S, from all three of its sources, resolved the way the table
   * resolves them — the person's facts from Fleet's own roster, the three catalogs through the
   * same id → name maps the cells read, and never an id. The licence-scan column is a CONTROL on
   * screen, so what the sheet carries is the fact behind it: whether a scan is on file at all.
   *
   * A driver with no profile yet is blank in Fleet's own columns rather than carrying «لم يُسجَّل»
   * across five cells: an empty cell is how a spreadsheet says "nothing recorded", and it is what
   * the reader will filter and sort on.
   */
  const driverSheet = async (): Promise<{ header: string[]; rows: (string | number)[][] }> => {
    const filters = filtersOnly(params);
    const all = await fetchFilteredRows((pageNo, size) =>
      fleetApi.listDrivers({ ...filters, page: pageNo, pageSize: size }),
    );
    const people = await fleetPeople();
    return {
      header: [
        t('fleet.drivers.columns.driver'),
        t('fleet.drivers.columns.employeeCode'),
        t('fleet.drivers.columns.jobTitle'),
        t('fleet.drivers.columns.branch'),
        t('fleet.drivers.columns.address'),
        t('fleet.drivers.columns.governorate'),
        t('fleet.drivers.columns.phone'),
        t('fleet.drivers.columns.hiredAt'),
        t('fleet.drivers.columns.specialization'),
        t('fleet.drivers.columns.licenseType'),
        t('fleet.drivers.columns.licenseExpiresAt'),
        t('fleet.drivers.columns.licenseImage'),
      ],
      rows: all.map((d) => {
        const person = people.get(d.employeeId);
        const { profile } = d;
        const expiry = profile?.licenseExpiresAt ?? null;
        return [
          person?.fullNameAr ?? '',
          person?.code ?? '',
          profile === null ? '' : catalogText(profile.jobId, jobName),
          person?.branchId == null ? '' : (branchName.get(person.branchId) ?? ''),
          person?.address ?? '',
          person?.governorate ?? '',
          person?.phone ?? '',
          person?.hiredAt == null ? '' : formatDate(person.hiredAt, locale),
          profile === null ? '' : catalogText(profile.specializationId, specializationName),
          profile === null ? '' : catalogText(profile.licenseTypeId, licenseTypeName),
          expiry === null ? '' : formatDate(expiry, locale),
          profile !== null && profile.licenseImage !== null ? t('common.yes') : t('common.no'),
        ];
      }),
    };
  };
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const exportSheet = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('excel');
    try {
      const sheet = await driverSheet();
      saveSheet({
        name: t('fleet.nav.drivers'),
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
  // The same rows as the Excel file, on the Fleet report page — as the vehicles screen prints.
  const printSheet = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('pdf');
    try {
      const sheet = await driverSheet();
      printFleetReport({
        title: t('fleet.nav.drivers'),
        department: t('fleet.violations.report.department'),
        subtitle: '',
        header: sheet.header,
        rows: sheet.rows.map((row) => row.map(String)),
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

  const columns: Column<FleetDriverRowDto>[] = [
    {
      key: 'driver',
      header: t('fleet.drivers.columns.driver'),
      // THE FIVE HR COLUMNS ORDER THE WHOLE REGISTRY, not the page on screen: the roster is
      // assembled and paged on the server, and these facts travel with it from the directory seam.
      sortable: true,
      render: (d) => (
        <DriverNameCell employeeId={d.employeeId} active={d.profile?.isActive === true} />
      ),
    },
    {
      key: 'employeeCode',
      align: 'center',
      header: t('fleet.drivers.columns.employeeCode'),
      sortable: true,
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
      align: 'center',
      header: t('fleet.drivers.columns.jobTitle'),
      render: (d) => {
        const name = d.profile?.jobId == null ? undefined : jobName.get(d.profile.jobId);
        return name === undefined ? (
          <span className="text-xs text-slate-400" title={t('fleet.drivers.notRecordedHint')}>
            {t('fleet.drivers.notRecorded')}
          </span>
        ) : (
          <span>{name}</span>
        );
      },
    },
    {
      key: 'branch',
      align: 'center',
      header: t('fleet.drivers.columns.branch'),
      render: (d) => (
        <EmployeeFact
          employeeId={d.employeeId}
          pick={(e) => (e.branchId === null ? null : (branchName.get(e.branchId) ?? null))}
        />
      ),
    },
    {
      key: 'governorate',
      align: 'center',
      header: t('fleet.drivers.columns.governorate'),
      sortable: true,
      render: (d) => <EmployeeFact employeeId={d.employeeId} pick={(e) => e.governorate} />,
    },
    {
      key: 'phone',
      align: 'center',
      header: t('fleet.drivers.columns.phone'),
      sortable: true,
      render: (d) => (
        <EmployeeFact
          employeeId={d.employeeId}
          pick={(e) => e.phone}
          className="font-mono text-xs"
        />
      ),
    },
    {
      key: 'hiredAt',
      align: 'center',
      header: t('fleet.drivers.columns.hiredAt'),
      sortable: true,
      render: (d) => (
        <EmployeeFact
          employeeId={d.employeeId}
          pick={(e) => day(e.hiredAt)}
          className="tabular-nums"
        />
      ),
    },
    {
      key: 'specialization',
      align: 'center',
      header: t('fleet.drivers.columns.specialization'),
      render: (d) => {
        const id = d.profile?.specializationId ?? null;
        const name = id === null ? undefined : specializationName.get(id);
        return name === undefined ? (
          <span className="text-xs text-slate-400">{t('fleet.drivers.notRecorded')}</span>
        ) : (
          <span>{name}</span>
        );
      },
    },
    {
      key: 'licenseType',
      align: 'center',
      header: t('fleet.drivers.table.licenseGrade'),
      render: (d) => {
        const id = d.profile?.licenseTypeId ?? null;
        const index = id === null ? undefined : licenseTypeIndex.get(id);
        if (id === null || index === undefined) {
          return <span className="text-slate-400">—</span>;
        }
        // «درجة أولى» by the class's place in the list; past the fifth, its own name.
        const ordinal = GRADE_ORDINALS[index];
        return (
          <span title={licenseTypeName.get(id)}>
            {ordinal === undefined
              ? (licenseTypeName.get(id) ?? '—')
              : t('fleet.drivers.table.grade', { grade: ordinal })}
          </span>
        );
      },
    },
    {
      key: 'licenseExpiresAt',
      align: 'center',
      header: t('fleet.drivers.table.licenseExpiry'),
      sortable: true,
      render: (d) => {
        // A driver with no Fleet file yet is «قيد المراجعة»; a file with no expiry has no date to
        // show — never the epoch `new Date(null)` would paint red. As the vehicles table writes
        // a licence: red once lapsed, amber within the month.
        if (d.profile === null) {
          return (
            <span className="text-amber-600 dark:text-amber-400">
              {t('fleet.drivers.table.underReview')}
            </span>
          );
        }
        const { licenseExpiresAt } = d.profile;
        if (licenseExpiresAt === null) return <span className="text-slate-400">—</span>;
        const state = expiryState(licenseExpiresAt, 30);
        return (
          <span
            dir="ltr"
            data-licence-expired={state === 'expired'}
            className={cn(
              'font-semibold tabular-nums',
              state === 'expired'
                ? 'text-red-600 dark:text-red-400'
                : state === 'soon'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-slate-900 dark:text-slate-100',
            )}
          >
            {day(licenseExpiresAt)}
          </span>
        );
      },
    },
    {
      key: 'licenseImage',
      header: t('fleet.drivers.table.licenseImage'),
      align: 'center',
      render: (d) =>
        d.profile === null ? (
          // THE PICKER OPENS FIRST — «تدوس الأيقونة، مستكشف الملفات يفتح على طول، تختار الصورة».
          // A driver with no profile has no id to upload against, so the scan is chosen first and
          // handed to the profile dialog already staged; the dialog asks only for what it cannot
          // invent and uploads the file the moment the create returns an id.
          can('fleetDriver.manage') ? (
            <label
              data-driver-enrol={d.employeeId}
              className={cn(
                actionButton,
                'relative inline-flex cursor-pointer text-slate-500 dark:text-slate-400',
              )}
              title={t('fleet.drivers.licenseImage.addViaProfile')}
            >
              <UploadIcon className="h-4 w-4" />
              <input
                key={pickerKey}
                type="file"
                accept={DRIVER_LICENSE_IMAGE_ACCEPT}
                className="hidden"
                aria-label={t('fleet.drivers.licenseImage.addViaProfile')}
                title={t('fleet.drivers.licenseImage.addViaProfile')}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // A cancelled picker must change nothing — no dialog, no staged file.
                  if (file === undefined) return;
                  setStagedScan(file);
                  setEditing(d);
                  setFormOpen(true);
                  setPickerKey((k) => k + 1);
                }}
              />
            </label>
          ) : (
            <span className="text-slate-400">—</span>
          )
        ) : (
          <DriverLicenseImageCell driver={d.profile} onPreview={setPreviewing} />
        ),
    },
    {
      key: 'actions',
      header: t('fleet.drivers.table.actions'),
      align: 'end',
      render: (d) => (
        <span className="flex items-center justify-end gap-1">
          {d.profile !== null && d.profile.licenseImage !== null && (
            <PrintLicenceButton driver={d.profile} />
          )}
          {/* The detail screen is ABOUT a profile, so it is offered only once one exists. */}
          {d.profile !== null && (
            <button
              type="button"
              className={cn(actionButton, 'text-slate-500 dark:text-slate-400')}
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
              className={cn(actionButton, 'text-slate-500 dark:text-slate-400')}
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
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        <div className="flex items-center justify-between gap-2" data-drivers-toolbar="true">
          {/* The count belongs BESIDE the filters' answer: it is what the bar was just asked. */}
          <span
            role="status"
            title={t('fleet.drivers.countLabel')}
            className="text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {matchedDrivers === null
              ? ''
              : t('fleet.drivers.count', { count: formatNumber(matchedDrivers, locale) })}
          </span>
          <span className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              data-driver-stats-toggle="true"
              aria-expanded={statsOpen}
              onClick={() => setStatsOpen((open) => !open)}
              className={BRAND_BUTTON}
            >
              {statsOpen
                ? t('fleet.vehicles.board.breakdownHide')
                : t('fleet.vehicles.board.breakdown')}
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className={cn(
                  'h-3 w-3 transition-transform sm:h-3.5 sm:w-3.5',
                  statsOpen && 'rotate-180',
                )}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {/* OFFERED ONLY WHEN THE SCREEN HAS AN ANSWER TO EXPORT. The three states that hold
                the table back hold the files back too: an empty or absent `employeeIds` travels as
                no filter at all, and exporting under it would hand the reader the WHOLE registry
                under the name of a filter that matched nobody. */}
            {!blocked && !emptyMatch && (
              <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80">
                <button
                  type="button"
                  data-export="drivers"
                  disabled={exporting !== null}
                  onClick={() => void exportSheet()}
                  className={cn(
                    PILL_BUTTON,
                    'hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300',
                  )}
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
                  data-print="drivers"
                  disabled={exporting !== null}
                  onClick={() => void printSheet()}
                  className={cn(
                    PILL_BUTTON,
                    'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400',
                  )}
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
          </span>
        </div>

        {/* Every figure lives behind «الإحصائيات», over the whole registry. */}
        {statsOpen && wholeRegistry.data !== undefined && (
          <section data-driver-figures="true" className="animate-drop-in space-y-2">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <FigureChip
                icon={FILTER_ICON.person}
                iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                label={t('fleet.drivers.board.total')}
                value={figures.total}
                unit={t('fleet.drivers.board.unit')}
                note={t('fleet.drivers.board.totalNote', {
                  recorded: String(figures.recorded),
                  missing: String(figures.total - figures.recorded),
                })}
              />
              <FigureChip
                icon={PATH.calendar}
                iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                label={t('fleet.drivers.board.thisMonth')}
                value={figures.thisMonth}
                valueClass="text-amber-600 dark:text-amber-400"
                unit={t('fleet.drivers.board.licences')}
              />
              <FigureChip
                icon={PATH.warn}
                iconClass={
                  figures.expired > 0
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                }
                label={t('fleet.drivers.board.expired')}
                value={figures.expired}
                valueClass={
                  figures.expired > 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }
                unit={t('fleet.drivers.board.licences')}
              />
              <FigureChip
                icon={PATH.image}
                iconClass="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                label={t('fleet.drivers.withoutLicenseImage')}
                value={figures.noImage}
                unit={t('fleet.drivers.board.unit')}
              />
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <BreakdownCard
                title={t('fleet.drivers.columns.jobTitle')}
                rows={figures.jobs}
                total={figures.total}
              />
              <BreakdownCard
                title={t('fleet.drivers.columns.specialization')}
                rows={figures.specializations}
                total={figures.total}
              />
              <BreakdownCard
                title={t('fleet.drivers.columns.licenseType')}
                rows={figures.licenseTypes}
                total={figures.total}
              />
            </div>
          </section>
        )}

        {/* The vehicles board's dark bar: every filter's name written in its box, an icon at its
            start, one row on a computer. */}
        <div className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}>
          <FilterBar
            hasActiveFilters={hasActiveFilters}
            onClear={() =>
              patch({
                drv: null,
                job: null,
                branch: null,
                phone: null,
                gov: null,
                spec: null,
                lic: null,
                img: null,
              })
            }
          >
            {mayFilterByHr && (
              <FilterWithIcon
                icon={FILTER_ICON.person}
                tone="text-emerald-600 dark:text-emerald-400"
              >
                <DriverPickerFilter
                  value={pickedDrivers}
                  onChange={(next) => patch({ drv: next.length === 0 ? null : next.join(',') })}
                  density={TIGHT}
                  fullWidth
                  className="w-full"
                />
              </FilterWithIcon>
            )}
            <FilterWithIcon icon={FILTER_ICON.operation} tone="text-slate-600 dark:text-slate-300">
              <CatalogMultiSelect
                kind="driverJob"
                value={jobs}
                onChange={(ids) => patch({ job: writeList(ids) })}
                label={t('fleet.drivers.columns.jobTitle')}
                className="w-full"
                fullWidth
                density={TIGHT}
              />
            </FilterWithIcon>
            {can('branch.view') && (
              <FilterWithIcon icon={FILTER_ICON.branch} tone="text-violet-600 dark:text-violet-300">
                <MultiSelect
                  clearable
                  label={t('fleet.drivers.columns.branch')}
                  options={branches.map((b) => ({ value: b.id, label: localized(b.name, locale) }))}
                  value={branchIds}
                  onChange={(ids) => patch({ branch: writeList(ids) })}
                  showSelectedValues
                  chips
                  density={TIGHT}
                  fullWidth
                  className="w-full"
                />
              </FilterWithIcon>
            )}
            {mayFilterByHr && (
              <FilterWithIcon icon={FILTER_ICON.phone} tone="text-slate-500 dark:text-slate-400">
                <DebouncedInput
                  aria-label={t('fleet.drivers.columns.phone')}
                  placeholder={t('fleet.drivers.columns.phone')}
                  density={TIGHT}
                  value={hrFilter.phone}
                  onValueChange={(next) => patch({ phone: next || null })}
                  rule="phone"
                />
              </FilterWithIcon>
            )}
            {mayFilterByHr && (
              <FilterWithIcon icon={FILTER_ICON.map} tone="text-cyan-600 dark:text-cyan-400">
                <DebouncedInput
                  aria-label={t('fleet.drivers.columns.governorate')}
                  placeholder={t('fleet.drivers.columns.governorate')}
                  density={TIGHT}
                  value={hrFilter.governorate}
                  onValueChange={(next) => patch({ gov: next || null })}
                  rule="arabic"
                />
              </FilterWithIcon>
            )}
            <FilterWithIcon icon={FILTER_ICON.make} tone="text-slate-600 dark:text-slate-300">
              <CatalogMultiSelect
                kind="driverSpecialization"
                value={specializations}
                onChange={(ids) => patch({ spec: writeList(ids) })}
                label={t('fleet.drivers.columns.specialization')}
                className="w-full"
                fullWidth
                density={TIGHT}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.licence} tone="text-amber-700 dark:text-amber-300">
              <CatalogMultiSelect
                kind="driverLicenseType"
                value={licenseTypes}
                onChange={(ids) => patch({ lic: writeList(ids) })}
                label={t('fleet.drivers.columns.licenseType')}
                className="w-full"
                fullWidth
                density={TIGHT}
              />
            </FilterWithIcon>
            {/* TWO ANSWERS, so ticking one replaces the other — «بصورة» and «بدون» together are
                the unfiltered registry. */}
            <FilterWithIcon icon={FILTER_ICON.image} tone="text-emerald-600 dark:text-emerald-400">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('fleet.drivers.columns.licenseImage')}
                options={[
                  { value: 'with', label: t('fleet.drivers.withLicenseImage') },
                  { value: 'without', label: t('fleet.drivers.withoutLicenseImage') },
                ]}
                value={image === '' ? [] : [image]}
                onChange={(next) => patch({ img: pickOne(image === '' ? [] : [image], next) })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

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
        {/* The vehicles table — «زى السيارات». */}
        <div
          className={cn(
            DARK_TABLE,
            BOARD_TABLE_FILL,
            // Thirteen columns on a laptop: the cells take less room between them so the whole row
            // stays on the screen.
            'max-[1749px]:[&_tbody_td]:!px-[5px] max-[1749px]:[&_thead_th]:!px-[5px]',
            // «شيل الخطوط اللى بين العواميد»: no line between the columns on this table.
            '[&_td+td]:!border-s-0 [&_th+th]:!border-s-0',
            // «خلى الكلام bold»: every value heavy, the Arabic in Cairo's own bold.
            "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif] [&_td_*]:!font-bold",
          )}
        >
          <DataTable
            columns={columns}
            rows={rows}
            // The PERSON is the row's identity now — a driver with no profile has no profile id.
            rowKey={(d) => d.employeeId}
            loading={hr.loading || (isLoading && !emptyMatch && !blocked)}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            sort={sorts}
            onSortChange={changeSort}
            minColumnWidth={4}
            stickyHead
          />
        </div>
        {data !== undefined && !blocked && !emptyMatch && data.meta.totalItems > 0 && (
          <FleetPager
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
          // The staged scan belongs to ONE opening. Dropping it on close is what stops a file
          // picked for one driver, then cancelled, from riding into the next row's dialog.
          setStagedScan(null);
        }}
        employeeId={editing?.employeeId ?? ''}
        profile={editing?.profile ?? null}
        initialImage={stagedScan}
      />
      <DriverLicenseImagePreviewDialog
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        driver={previewing}
      />
    </PageContainer>
  );
};
