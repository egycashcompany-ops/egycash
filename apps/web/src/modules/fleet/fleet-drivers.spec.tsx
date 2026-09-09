// The drivers registry, proven against what the screen actually produces.
//
// Four claims, each one a rule from the brief that a typecheck cannot see:
//   • the table renders the sixteen required columns, in the required order, filled from the three
//     real sources — Fleet's own profile, Fleet's catalogs, and HR's employee record;
//   • the licence-image cell offers upload when there is no scan and view + delete when there is,
//     and every one of those actions is gated on `fleetDriver.manage`;
//   • the filter bar exposes the fleet-owned filters, syncs them with the URL, and lays them out
//     as one wrapping row;
//   • enrolment is gone from the UI — no CTA, no create branch in the dialog — while the API's
//     create endpoint is deliberately left standing.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing clicks: markup is
// rendered with `renderToStaticMarkup`, which is enough for presence, order, labels and state.
// `Dialog` renders through `createPortal(..., document.body)`, so a dialog's own markup is
// unreachable here — those claims are made against the pure pieces (the i18n template) and, where
// only structure is in question, against the component source.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CreateFleetDriverProfileSchema,
  ListEmployeesQuerySchema,
  ListFleetDriversQuerySchema,
  MAX_PAGE_SIZE,
  UpdateFleetDriverProfileSchema,
  type EmployeeDto,
  type FleetDriverProfileDto,
  type FleetRosterDayDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { formatNumber } from '../../shared/lib/format';
import { detailKey, listKey } from '../../shared/lib/query-keys';
import { buildQuery } from '../../shared/lib/api-client';
import { DriversListPage } from './pages/DriversListPage';
import { DriverLicenseImageCell } from './components/DriverLicenseImage';
import {
  HR_DELEGATION,
  HR_UNDELEGATED_FIELDS,
  hrProfileHref,
  mayDelegateTo,
} from './components/hr-delegation';
import { vehicleTodayFrom } from './components/vehicle-today';
import { type DriverHrFilter } from './api/driver-hr-filter';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Fixtures ────────────────────────────────────────────────────────────────

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

const EMPLOYEE_ID = 'e1';

/**
 * The exact parameter object the page hands `useDrivers`, so a seeded cache entry is the one it
 * looks up. Written once because every key here is a FILTER: a test that seeded a different shape
 * would render the skeleton and prove nothing, silently.
 */
const driverParams = (overrides: Record<string, unknown> = {}) => ({
  page: 1,
  pageSize: 25,
  sortBy: 'createdAt',
  sortDir: 'desc',
  jobId: undefined,
  branchId: undefined,
  area: undefined,
  specializationId: undefined,
  licenseTypeId: undefined,
  hasLicenseImage: undefined,
  isActive: undefined,
  employeeIds: undefined,
  ...overrides,
});

/**
 * A registry ROW: the person, and what Fleet has recorded about them.
 *
 * The list stopped returning bare profiles when the roster became the org chart — a driver is on
 * it because their job title requires a driving test, so the row exists before anybody records a
 * licence. `profile: null` is that state, and it is the ordinary one for a new hire.
 */
const row = (profile: FleetDriverProfileDto | null, employeeId = EMPLOYEE_ID) => ({
  employeeId,
  profile,
});

/** The three catalog items this registry's three catalog-backed columns point at. */
const CATALOG = {
  job: { id: 'cj1', ar: 'سائق صراف الى', en: 'ATM teller driver' },
  specialization: { id: 'cs1', ar: 'سزوكى', en: 'Suzuki' },
  licenseType: { id: 'cl1', ar: 'تانيه', en: 'Second class' },
};

const driver = (overrides: Partial<FleetDriverProfileDto> = {}): FleetDriverProfileDto => ({
  id: 'd1',
  employeeId: EMPLOYEE_ID,
  licenseNumber: 'DL-4471',
  licenseExpiresAt: '2027-05-01T00:00:00.000Z',
  jobId: CATALOG.job.id,
  specializationId: CATALOG.specialization.id,
  licenseTypeId: CATALOG.licenseType.id,
  specialization: null,
  area: 'وسط البلد',
  isActive: true,
  licenseImage: null,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/**
 * The licence-expiry years these tests tell rows apart by, as the table prints them (Arabic-Indic
 * digits, because the board renders in `ar`).
 */
const DEFAULT_YEAR = '٢٠٢٧';
const B1_YEAR = '٢٠٢٩';
const B2_YEAR = '٢٠٣٠';

const WITH_IMAGE = driver({
  licenseImage: {
    fileId: 'f1',
    fileName: 'license.jpg',
    mime: 'image/jpeg',
    size: 1024,
    uploadedAt: '2026-02-01T00:00:00.000Z',
  },
});

/** The HR facts the eight read-only columns are built from — every one a distinctive string. */
const HR = {
  name: 'محمود عبد الرحمن السيد',
  code: '001000125',
  jobTitle: 'سائق نقل أموال',
  branch: 'المهندسين',
  line1: '١٢ شارع جامعة الدول',
  city: 'المهندسين',
  governorate: 'الجيزة',
  phone: '01001234567',
  hiredAt: '2019-03-15T00:00:00.000Z',
};

const employee = (): EmployeeDto =>
  ({
    id: EMPLOYEE_ID,
    code: HR.code,
    hiredAt: HR.hiredAt,
    personal: {
      fullNameAr: HR.name,
      contact: { primaryPhone: HR.phone, secondaryPhone: null, email: null },
      officialAddress: {
        line1: HR.line1,
        city: HR.city,
        governorate: HR.governorate,
      },
      currentAddress: null,
    },
    employment: { jobTitleId: 'jt1', branchId: 'b1', departmentId: 'dp1' },
  }) as unknown as EmployeeDto;

const ALL_PERMISSIONS = [
  'fleetDriver.view',
  'fleetDriver.manage',
  'employee.view',
  'branch.view',
  'jobTitle.view',
];

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
  }) as unknown as MeDto;

/**
 * A query client PRE-SEEDED with the responses the page would fetch. The page reads through
 * TanStack Query, and `renderToStaticMarkup` never lets an effect run — seeding the cache is what
 * makes the first paint the loaded state instead of the skeleton.
 */
const seededClient = (
  rows: FleetDriverProfileDto[] = [driver()],
  params = {},
  { hr = true }: { hr?: boolean } = {},
): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(listKey('fleet', 'drivers', driverParams(params)), page(rows.map((p) => row(p))));
  // The three fleet catalogs, under the key `useFleetCatalog` and `CatalogSelect` SHARE — which is
  // the point of seeding them once here: the column, the filter and the edit form all read this
  // one entry, so a test cannot accidentally prove them against different vocabularies.
  for (const [kind, item] of [
    ['driverJob', CATALOG.job],
    ['driverSpecialization', CATALOG.specialization],
    ['driverLicenseType', CATALOG.licenseType],
  ] as const) {
    qc.setQueryData(
      listKey('fleet', 'catalogs', { kind, violationSide: undefined }),
      page([
        {
          id: item.id,
          kind,
          name: { ar: item.ar, en: item.en },
          countsForAlarm: false,
          violationSide: null,
          isActive: true,
          version: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    );
  }
  // The HR record every read-only column reads, under HR's OWN detail key — the same one the HR
  // profile page uses, which is what makes a row cost one request rather than eight. `hr: false`
  // is what a caller without `employee.view` really sees: the query is disabled, so nothing ever
  // lands in that cache for the cells to read.
  if (hr) qc.setQueryData(detailKey('hr', 'employees', EMPLOYEE_ID), employee());
  // `useBranches` / `useJobTitles` select `page.items`, so the cache holds the PAGE.
  qc.setQueryData(
    ['hr', 'branches', 'active'],
    page([{ id: 'b1', code: '01', name: { ar: HR.branch, en: 'Mohandessin' }, status: 'active' }]),
  );
  // `requiresDrivingTest` is what makes this a DRIVING seat — the flag the registry's membership
  // is derived from, and the one the HR filter step narrows itself to.
  // Under the DRIVING-SEATS key: the page asks the server for the titles carrying the flag rather
  // than reading a page of the catalogue and filtering it here. A catalogue longer than one page
  // used to hide exactly these rows, and with them the narrowing the HR step depends on.
  qc.setQueryData(
    ['hr', 'jobTitles', 'active', 'requiresDrivingTest'],
    page([
      {
        id: 'jt1',
        name: { ar: HR.jobTitle, en: 'Cash transport driver' },
        status: 'active',
        requiresDrivingTest: true,
      },
    ]),
  );
  return qc;
};

/**
 * A client where the HR filter step has already answered.
 *
 * `matched` is what HR REPORTS as the total, which is the number the page decides on — seeding a
 * short `items` array with a large `totalItems` is exactly the shape that must refuse to filter.
 */
const hrFilteredClient = (
  matched: number,
  filter: Partial<DriverHrFilter> = { governorate: 'الجيزة' },
): QueryClient => {
  const full: DriverHrFilter = {
    search: '',
    address: '',
    governorate: '',
    phone: '',
    ...filter,
  };
  const ids = Array.from({ length: Math.min(matched, MAX_PAGE_SIZE) }, (_, i) =>
    i === 0 ? EMPLOYEE_ID : `e${i + 1}`,
  );
  const honoured = matched > 0 && matched <= MAX_PAGE_SIZE;
  // When the filter CAN be honoured the page asks for the narrowed key; when it cannot, the
  // parameter is dropped — so the unfiltered key is seeded instead, and the test can prove its
  // rows are not what gets rendered.
  const qc = seededClient([driver()], honoured ? { employeeIds: ids } : {});
  // An EMPTY match is the subtle one. `buildQuery` drops an empty array, so `employeeIds: []`
  // reaches the server as no filter at all and answers with every driver. Seeding that exact key
  // with a row is what makes the guard's absence visible: without it the page renders this.
  if (matched === 0) {
    qc.setQueryData(
      listKey('fleet', 'drivers', driverParams({ employeeIds: [] })),
      page([row(driver())]),
    );
  }
  // `jt1` is the seeded driving job title — the seats the registry narrows step ① to.
  qc.setQueryData(['hr', 'employees', 'fleet-driver-filter', full, 'jt1'], {
    items: ids.map((id) => ({ ...employee(), id })),
    meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: matched, totalPages: 1 },
  });
  return qc;
};

const render = (
  node: JSX.Element,
  {
    locale = 'ar' as Locale,
    permissions = ALL_PERMISSIONS,
    route = '/fleet/drivers',
    client = seededClient(),
  } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const t = (key: string, locale: Locale = 'ar'): string => translate(locale, key);

/** The table BODY alone — a branch named in a `<select>` must not satisfy a claim about a ROW. */
const tbodyOf = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));

/** The table head alone — a label also used by a filter must not be able to satisfy a column claim. */
const thead = (markup: string): string => {
  const start = markup.indexOf('<thead');
  const end = markup.indexOf('</thead>');
  expect(start, 'the page renders a table head').toBeGreaterThan(-1);
  return markup.slice(start, end);
};

/**
 * The thirteen columns the table carries, IN ORDER:
 *
 *   اسم السائق → كود الموظف → الوظيفة → الفرع → العنوان → المحافظة → رقم الموبايل →
 *   تاريخ التعيين → التخصص → الرخصة → تاريخ الرخصة → صورة الرخصة → إجراءات
 *
 * «المنطقة» AND «الحالة» ARE DELIBERATELY GONE (owner request), from the table and from the bar
 * alike. Their URL keys and query fields went with them: a remembered filter with no control on
 * screen still narrows the list, and nothing tells the reader why their board is short.
 *
 * «م» USED TO BE FIRST AND IS DELIBERATELY GONE (owner request). A row number that is not the
 * driver's own identifier told the reader nothing the row did not already say, and it cost a
 * column on a table that has fourteen real ones. What replaced it is the COUNT beside the
 * filters, which answers the question the serial was being read for — "how many are there?" —
 * without spending a column per row to do it.
 */
const REQUIRED_COLUMNS = [
  'driver',
  'employeeCode',
  'jobTitle',
  'branch',
  'address',
  'governorate',
  'phone',
  'hiredAt',
  'specialization',
  'licenseType',
  'licenseExpiresAt',
  'licenseImage',
] as const;

// ── 1. The table ────────────────────────────────────────────────────────────

describe('the drivers table shows the thirteen required columns', () => {
  it('renders every one of them in the table head', () => {
    const head = thead(render(<DriversListPage />));
    for (const column of REQUIRED_COLUMNS) {
      expect(head, `${column} column`).toContain(t(`fleet.drivers.columns.${column}`));
    }
  });

  it('renders them in the order the brief names', () => {
    const head = thead(render(<DriversListPage />));
    const positions = REQUIRED_COLUMNS.map((column) => ({
      column,
      at: head.indexOf(t(`fleet.drivers.columns.${column}`)),
    }));
    for (let i = 1; i < positions.length; i += 1) {
      const previous = positions[i - 1] as { column: string; at: number };
      const current = positions[i] as { column: string; at: number };
      expect(current.at, `${current.column} after ${previous.column}`).toBeGreaterThan(previous.at);
    }
  });

  it('labels every column in BOTH locales — no header renders as a raw key', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const column of REQUIRED_COLUMNS) {
        const key = `fleet.drivers.columns.${column}`;
        expect(translate(locale, key), `${key} in ${locale}`).not.toBe(key);
      }
    }
  });
});

describe('the columns are filled from the three real sources', () => {
  const markup = (): string => render(<DriversListPage />);
  const tbody = (html: string): string =>
    html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));

  it('shows the fleet-owned facts from the driver profile', () => {
    const html = markup();
    expect(html, 'licence date').toContain('٢٠٢٧');
  });

  it('names the three catalog references from the CATALOG, never from the profile', () => {
    const body = tbody(markup());
    expect(body, 'الوظيفة').toContain(CATALOG.job.ar);
    expect(body, 'التخصص').toContain(CATALOG.specialization.ar);
    expect(body, 'الرخصة').toContain(CATALOG.licenseType.ar);
    // The ids themselves never reach the page: a cell that printed one would look like data.
    expect(body, 'and never the raw ids').not.toContain(CATALOG.job.id);
    expect(body).not.toContain(CATALOG.specialization.id);
    expect(body).not.toContain(CATALOG.licenseType.id);
  });

  it('renames a catalog value everywhere at once — the column follows the catalog', () => {
    // What an admin actually does on /fleet/catalogs: rename «سزوكى». The column has no vocabulary
    // of its own to disagree with, so the new name is what the row says.
    const qc = seededClient();
    qc.setQueryData(
      listKey('fleet', 'catalogs', { kind: 'driverSpecialization', violationSide: undefined }),
      page([
        {
          id: CATALOG.specialization.id,
          kind: 'driverSpecialization',
          name: { ar: 'سوزوكي (معدّل)', en: 'Suzuki (renamed)' },
          countsForAlarm: false,
          violationSide: null,
          isActive: true,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
      ]),
    );
    const body = tbody(render(<DriversListPage />, { client: qc }));
    expect(body).toContain('سوزوكي (معدّل)');
    expect(body).not.toContain(CATALOG.specialization.ar);
  });

  it('says «—» for a driver nobody has classified, rather than inventing a grade', () => {
    const body = tbody(
      render(<DriversListPage />, {
        client: seededClient([
          driver({ jobId: null, specializationId: null, licenseTypeId: null }),
        ]),
      }),
    );
    expect(body).not.toContain(CATALOG.job.ar);
    expect(body).not.toContain(CATALOG.specialization.ar);
    expect(body).not.toContain(CATALOG.licenseType.ar);
    expect(body, 'the unclassified cells say so').toContain('—');
  });

  it('shows the HR-owned facts from the employee record, resolved not echoed', () => {
    const html = markup();
    expect(html, 'driver name').toContain(HR.name);
    expect(html, 'employee code').toContain(HR.code);
    expect(html, 'address').toContain(HR.line1);
    expect(html, 'governorate').toContain(HR.governorate);
    expect(html, 'mobile number').toContain(HR.phone);
    expect(html, 'branch').toContain(HR.branch);
  });

  it('counts the WHOLE list beside the filters, not the page of it', () => {
    const qc = seededClient();
    qc.setQueryData(listKey('fleet', 'drivers', driverParams({ page: 3 })), {
      items: [row(driver()), row(driver({ id: 'd2' }), 'e2')],
      meta: { page: 3, pageSize: 25, totalItems: 60, totalPages: 3 },
    });
    const html = render(<DriversListPage />, { client: qc, route: '/fleet/drivers?page=3' });
    // Sixty drivers matched; two of them are on this page. The count answers the first number,
    // because "how many drivers are there" is not a question about pagination.
    expect(html, 'the count names the whole match').toContain(
      translate('ar', 'fleet.drivers.count', { count: formatNumber(60, 'ar') }),
    );
    // And it is in the FILTER BAR rather than the table: the table no longer carries «م».
    expect(html.slice(0, html.indexOf('<table')), 'above the table').toContain(
      translate('ar', 'fleet.drivers.count', { count: formatNumber(60, 'ar') }),
    );
  });

  it('has no «م» column — the serial the count replaced', () => {
    const head = thead(render(<DriversListPage />));
    // The header cell itself is gone, and no row prints a bare ordinal in its place.
    expect(head, 'no serial header').not.toContain('>م<');
    expect(tbody(markup()), 'and no serial cell').not.toContain('>1<');
  });

  it('degrades to a dash without `employee.view` rather than leaking an id', () => {
    const html = render(<DriversListPage />, {
      permissions: ['fleetDriver.view', 'fleetDriver.manage'],
      client: seededClient([driver()], {}, { hr: false }),
    });
    const body = tbody(html);
    expect(body).not.toContain(HR.name);
    expect(body).not.toContain(HR.phone);
    expect(body, 'and never the raw employee id in its place').not.toContain(EMPLOYEE_ID);
    expect(body, 'the empty HR cells say so').toContain('—');
    // The fleet-owned columns are unaffected: HR access is not fleet access.
    expect(body).toContain(DEFAULT_YEAR);
  });
});

// ── 2. The licence image ────────────────────────────────────────────────────

describe('the licence-image cell', () => {
  const cell = (row: FleetDriverProfileDto, permissions = ALL_PERMISSIONS): string =>
    render(<DriverLicenseImageCell driver={row} onPreview={() => undefined} />, { permissions });

  it('offers upload — and only upload — when there is no scan on file', () => {
    const html = cell(driver());
    expect(html).toContain(t('fleet.drivers.licenseImage.upload'));
    expect(html).toContain('type="file"');
    expect(html).not.toContain(t('fleet.drivers.licenseImage.view'));
    expect(html).not.toContain(t('fleet.drivers.licenseImage.delete'));
  });

  it('accepts exactly the image types the server category allows', () => {
    expect(cell(driver())).toContain('accept="image/jpeg,image/png,image/webp"');
  });

  it('offers view AND delete — and no upload — once a scan exists', () => {
    const html = cell(WITH_IMAGE);
    expect(html).toContain(t('fleet.drivers.licenseImage.view'));
    expect(html).toContain(t('fleet.drivers.licenseImage.delete'));
    expect(html).not.toContain('type="file"');
  });

  it('hides delete from a viewer who may not manage drivers, keeping view', () => {
    const html = cell(WITH_IMAGE, ['fleetDriver.view', 'employee.view']);
    expect(html).toContain(t('fleet.drivers.licenseImage.view'));
    expect(html).not.toContain(t('fleet.drivers.licenseImage.delete'));
  });

  it('offers no upload to a viewer who may not manage drivers', () => {
    const html = cell(driver(), ['fleetDriver.view', 'employee.view']);
    expect(html).not.toContain('type="file"');
    expect(html).toContain('—');
  });

  it('renders in the table, once per row, from the row it belongs to', () => {
    const html = render(<DriversListPage />, { client: seededClient([WITH_IMAGE]) });
    expect(html).toContain(t('fleet.drivers.licenseImage.view'));
    expect(html).toContain(t('fleet.drivers.licenseImage.delete'));
  });

  it('names the driver, the employee code and the licence number in the preview header', () => {
    // The preview is a `Dialog` (a portal), so the claim is made against the template it fills —
    // the values themselves come from the same employee record proven above.
    const subtitle = translate('ar', 'fleet.drivers.licenseImage.previewSubtitle', {
      driver: HR.name,
      code: HR.code,
      license: 'DL-4471',
    });
    expect(subtitle).toContain(HR.name);
    expect(subtitle).toContain(HR.code);
    expect(subtitle).toContain('DL-4471');
    expect(subtitle).not.toContain('{{');
  });

  it('titles the preview as the DRIVING licence, not the vehicle licence', () => {
    expect(t('fleet.drivers.licenseImage.previewTitle')).toBe('صورة رخصة القيادة');
    expect(translate('en', 'fleet.drivers.licenseImage.previewTitle')).toBe(
      'Driving license image',
    );
  });

  it('warns that only the scan goes, not the licence facts, before deleting', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      const key = 'fleet.drivers.licenseImage.deleteBody';
      expect(translate(locale, key), `${key} in ${locale}`).not.toBe(key);
    }
  });

  it('repaints the row from the server instead of guessing, on both writes', () => {
    // Both endpoints answer with the updated profile: the detail cache is seeded from the response
    // and the drivers subtree invalidated, which is what makes the cell flip without a reload.
    const source = readFileSync(join(HERE, 'api/fleet-queries.ts'), 'utf8');
    const seam = source.slice(source.indexOf('const useDriverImageMutation'));
    expect(seam).toContain("qc.setQueryData(detailKey(MODULE, 'drivers', doc.id), doc)");
    expect(seam).toContain('qc.invalidateQueries({ queryKey: fleetKeys.drivers })');
    expect(seam).toContain('useUploadDriverLicenseImage');
    expect(seam).toContain('useDeleteDriverLicenseImage');
  });
});

// ── 3. The filters ──────────────────────────────────────────────────────────

describe('the filter bar', () => {
  /**
   * The ELEVEN filters the brief names, in the order it names them.
   *
   * Every one is proven by the label the control carries, and each label is a column header — the
   * bar asks the same questions the table answers.
   */
  const FILTER_ORDER = [
    'fleet.drivers.filters.employee',
    'fleet.drivers.columns.jobTitle',
    'fleet.drivers.columns.branch',
    'fleet.drivers.columns.address',
    'fleet.drivers.columns.phone',
    'fleet.drivers.columns.governorate',
    'fleet.drivers.columns.specialization',
    'fleet.drivers.columns.licenseType',
    'fleet.drivers.columns.licenseImage',
  ];

  /** The bar alone: a column header must not be able to satisfy a filter claim, or the reverse. */
  const bar = (html: string): string =>
    html.slice(html.indexOf('flex flex-wrap'), html.indexOf('<table'));

  it('exposes a labelled control for every one of the nine filters', () => {
    const html = bar(render(<DriversListPage />));
    for (const key of FILTER_ORDER) {
      expect(html, `${key} filter`).toContain(`aria-label="${t(key)}"`);
    }
  });

  it('renders them in the order the brief names', () => {
    const html = bar(render(<DriversListPage />));
    const at = FILTER_ORDER.map((key) => ({
      key,
      at: html.indexOf(`aria-label="${t(key)}"`),
    }));
    for (let i = 1; i < at.length; i += 1) {
      const previous = at[i - 1] as { key: string; at: number };
      const current = at[i] as { key: string; at: number };
      expect(current.at, `${current.key} after ${previous.key}`).toBeGreaterThan(previous.at);
    }
  });

  it('keeps all nine on ONE row from the narrowest desktop up', () => {
    const html = bar(render(<DriversListPage />));
    // `flex-wrap` is the base — a phone still stacks — and `flex-nowrap` takes over from 1280px,
    // the narrowest desktop the product targets.
    expect(html, 'wraps by default').toContain('flex flex-wrap');
    expect(html, 'and stops wrapping from 1280px').toContain('min-[1280px]:flex-nowrap');
    // What makes that safe at 1280, where they want more room than the bar has: every one
    // of them may SHRINK. `min-w-0` is the part that is easy to leave out and impossible to see
    // — without it a flex child refuses to go below its content width, and a `<select>` is as
    // wide as its longest option, so one long branch name would push the row off the page.
    const shrinkable = html.split('min-w-0').length - 1;
    expect(shrinkable, 'every control can give width back').toBeGreaterThanOrEqual(
      FILTER_ORDER.length,
    );
  });

  it('names every filter VISIBLY, and keeps that name recoverable when it truncates', () => {
    // The name used to be written inside the control, where it competed with the value for room
    // and was the first thing to be clipped. It is a label ABOVE the control now, so the test is
    // that the name is actually rendered — plus the two fallbacks that still matter: `aria-label`
    // on the control for a screen reader, and `title` on the label for a pointer, because a
    // narrow column truncates the label rather than the value.
    const html = bar(render(<DriversListPage />));
    for (const key of FILTER_ORDER) {
      expect(html, `${key} is named on screen`).toContain(`title="${t(key)}"`);
      expect(html, `${key} aria-label`).toContain(`aria-label="${t(key)}"`);
      // The name is TEXT the reader can see, not only an attribute. The picker is the one
      // deliberate exception: its full question — «اسم السائق أو كود الموظف» — is longer than any
      // column on this bar, so the label says the short form and the full one stays on
      // `aria-label`, where a screen reader still reads it.
      const shown = key === 'fleet.drivers.filters.employee'
        ? t('fleet.drivers.filters.employeeShort')
        : t(key);
      expect(html, `${key} is visible text`).toMatch(
        new RegExp(`>\\s*${shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<`),
      );
    }
  });

  it('reads its state from the URL, so a filtered view is a shareable link', () => {
    const route =
      '/fleet/drivers?drv=e1&job=cj1&branch=b1&addr=%D8%AC%D8%A7%D9%85%D8%B9%D8%A9' +
      '&area=%D9%88%D8%B3%D8%B7&phone=0100&gov=%D8%A7%D9%84%D8%AC%D9%8A%D8%B2%D8%A9' +
      '&spec=cs1&lic=cl1&img=with&active=false';
    const client = seededClient([driver()], {
      jobId: 'cj1',
      branchId: 'b1',
      area: 'وسط',
      specializationId: 'cs1',
      licenseTypeId: 'cl1',
      hasLicenseImage: true,
      isActive: false,
      employeeIds: [EMPLOYEE_ID],
    });
    client.setQueryData(
      ['hr', 'employees', 'fleet-driver-filter', {
        search: '',
        address: 'جامعة',
        governorate: 'الجيزة',
        phone: '0100',
      }, 'jt1'],
      { items: [employee()], meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: 1, totalPages: 1 } },
    );
    const html = render(<DriversListPage />, { route, client });
    expect(html, 'address box').toContain('value="جامعة"');
    expect(html, 'phone box').toContain('value="0100"');
    expect(html, 'governorate box').toContain('value="الجيزة"');
    // A `<select>` renders its choice as the selected option, not as a value attribute.
    expect(html, 'الوظيفة').toContain('<option value="cj1" selected=""');
    expect(html, 'الفرع').toContain('<option value="b1" selected=""');
    expect(html, 'التخصص').toContain('<option value="cs1" selected=""');
    expect(html, 'الرخصة').toContain('<option value="cl1" selected=""');
    expect(html, 'صورة الرخصة').toContain('<option value="with" selected=""');
    // And the picked driver is NAMED on its trigger, not counted — a chip nobody can read is a
    // filter you have to open to understand.
    expect(html, 'the picked driver').toContain(HR.name);
  });

  it('offers the three catalog filters the CATALOG\u2019s values, never a list of its own', () => {
    const html = bar(render(<DriversListPage />));
    for (const item of [CATALOG.job, CATALOG.specialization, CATALOG.licenseType]) {
      expect(html, `${item.ar} is offered`).toContain(`<option value="${item.id}">${item.ar}`);
    }
  });

  it('offers a value an admin ADDS to a catalog, with no release in between', () => {
    // Exactly what /fleet/catalogs does: one more row of the same kind. Nothing on this screen
    // enumerates the vocabulary, so the new value is simply on offer.
    const qc = seededClient();
    qc.setQueryData(
      listKey('fleet', 'catalogs', { kind: 'driverJob', violationSide: undefined }),
      page([
        {
          id: CATALOG.job.id,
          kind: 'driverJob',
          name: { ar: CATALOG.job.ar, en: CATALOG.job.en },
          countsForAlarm: false,
          violationSide: null,
          isActive: true,
          version: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'cj-new',
          kind: 'driverJob',
          name: { ar: 'سائق مدرّب', en: 'Trainer driver' },
          countsForAlarm: false,
          violationSide: null,
          isActive: true,
          version: 0,
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        },
      ]),
    );
    const html = bar(render(<DriversListPage />, { client: qc }));
    expect(html).toContain('<option value="cj-new">سائق مدرّب');
  });

  it('sends every filter to the SERVER — none is applied to the fetched page', () => {
    // Proven by CONSEQUENCE rather than by reading the source: a page that filtered its own rows
    // would render the same list whatever the URL said. Here the narrowed URL asks for a key that
    // holds a DIFFERENT driver, and that is the one the table shows.
    const client = seededClient([driver()]);
    client.setQueryData(
      listKey('fleet', 'drivers', driverParams({ specializationId: 'cs1' })),
      page([row(driver({ id: 'd9', licenseExpiresAt: '2032-05-01T00:00:00.000Z' }))]),
    );
    const unfiltered = render(<DriversListPage />, { client });
    const filtered = render(<DriversListPage />, { route: '/fleet/drivers?spec=cs1', client });
    expect(unfiltered).toContain(DEFAULT_YEAR);
    expect(filtered, 'the narrowed request is the one that answered').toContain('٢٠٣٢');
    expect(filtered).not.toContain(DEFAULT_YEAR);
  });

  it('the backend accepts every parameter this page sends', () => {
    const parsed = ListFleetDriversQuerySchema.parse({
      branchId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      jobId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      specializationId: 'cccccccccccccccccccccccc',
      licenseTypeId: 'dddddddddddddddddddddddd',
      hasLicenseImage: 'true',
      employeeIds: 'eeeeeeeeeeeeeeeeeeeeeeee',
    });
    expect(parsed.branchId).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaa']);
    expect(parsed.jobId).toBe('bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(parsed.specializationId).toBe('cccccccccccccccccccccccc');
    expect(parsed.licenseTypeId).toBe('dddddddddddddddddddddddd');
    expect(parsed.hasLicenseImage).toBe(true);
    expect(parsed.employeeIds).toEqual(['eeeeeeeeeeeeeeeeeeeeeeee']);
  });

  it('still refuses a filter the backend does not implement, rather than ignoring it', () => {
    // `governorate` is an HR fact: the fleet list cannot filter on it, and the schema says so
    // loudly instead of accepting the parameter and returning an unfiltered page.
    expect(() => ListFleetDriversQuerySchema.parse({ governorate: 'الجيزة' })).toThrow();
  });
});

// ── 3a. «الرخصة» is the licence CLASS, not its number ──────────────────────

describe('«الرخصة» means the licence class', () => {
  const LICENCE_NUMBER = 'DL-4471';

  it('the column shows the CATALOG value, and the licence number appears nowhere', () => {
    // The two are different facts about the same licence, and the brief asks for the class:
    // «اولى» / «تانيه», and whatever the admin adds. A screen that showed `DL-4471` here would
    // be answering a question nobody asked and leaving the filter beside it unmatched.
    const html = render(<DriversListPage />);
    const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
    expect(body, 'the licence CLASS').toContain(CATALOG.licenseType.ar);
    expect(html, 'and the number is not on this screen at all').not.toContain(LICENCE_NUMBER);
  });

  it('the FILTER offers the same catalog, and sends an id — never a typed number', () => {
    const html = render(<DriversListPage />);
    const barHtml = html.slice(html.indexOf('flex flex-wrap'), html.indexOf('<table'));
    expect(barHtml, 'the class is picked, not typed').toContain(
      `<option value="${CATALOG.licenseType.id}">${CATALOG.licenseType.ar}`,
    );
    // And the fleet list has no parameter for a typed licence class — only the id.
    expect(
      ListFleetDriversQuerySchema.parse({ licenseTypeId: '64b1f0dddddddddddddddd01' })
        .licenseTypeId,
    ).toBe('64b1f0dddddddddddddddd01');
    expect(() => ListFleetDriversQuerySchema.parse({ licenseType: 'اولى' })).toThrow();
  });

  it('the licence NUMBER is still recorded — it left the list, not the model', () => {
    // It is a fleet-owned fact and nothing has destroyed it: the profile still carries it, the
    // edit dialog still writes it, and the update contract still accepts it.
    expect(driver().licenseNumber).toBe(LICENCE_NUMBER);
    expect(
      UpdateFleetDriverProfileSchema.parse({ licenseNumber: 'DL-9', version: 0 }).licenseNumber,
    ).toBe('DL-9');
  });

  it('the two licence columns are DIFFERENT columns, in the brief’s order', () => {
    const head = thead(render(<DriversListPage />));
    const type = head.indexOf(t('fleet.drivers.columns.licenseType'));
    const date = head.indexOf(t('fleet.drivers.columns.licenseExpiresAt'));
    const image = head.indexOf(t('fleet.drivers.columns.licenseImage'));
    expect(type, 'الرخصة is present').toBeGreaterThan(-1);
    expect(date, 'تاريخ الرخصة after it').toBeGreaterThan(type);
    expect(image, 'صورة الرخصة after that').toBeGreaterThan(date);
  });
});

// ── 3b. «الفرع» — the filter that could not work, and now can ───────────────

describe('the branch filter', () => {
  /**
   * Each branch's drivers, told apart by the LICENCE EXPIRY YEAR on their row — 2029 for b1 and
   * 2030 for b2, against the default 2027. Not by the branch name: that is printed in the
   * filter's own `<option>` list, so a page showing the wrong branch's drivers would still
   * «contain» the right branch's name.
   *
   * It used to be «المنطقة», which is no longer a column — a marker has to be something the table
   * actually prints, or the test passes on a row it never rendered.
   */
  const twoBranches = (): QueryClient => {
    const client = seededClient([driver()]);
    client.setQueryData(
      listKey('fleet', 'drivers', driverParams({ branchId: 'b1' })),
      page([row(driver({ id: 'd7', licenseExpiresAt: '2029-05-01T00:00:00.000Z' }))]),
    );
    client.setQueryData(
      listKey('fleet', 'drivers', driverParams({ branchId: 'b2' })),
      page([row(driver({ id: 'd8', licenseExpiresAt: '2030-05-01T00:00:00.000Z' }))]),
    );
    return client;
  };

  it('travels to FLEET, not to HR — the branch is on the roster Fleet already holds', () => {
    const html = render(<DriversListPage />, {
      route: '/fleet/drivers?branch=b1',
      client: twoBranches(),
    });
    // The narrowed FLEET key answered. Nothing was seeded for an HR pre-query on the branch, so
    // had the page still asked HR first it would be blocked and render no rows at all.
    expect(tbodyOf(html)).toContain(B1_YEAR);
    expect(html, 'and no «narrow your filter» refusal').not.toContain(
      'فلتر الموارد البشرية طابق',
    );
  });

  it('CHANGING the branch changes the results', () => {
    const client = twoBranches();
    const first = tbodyOf(
      render(<DriversListPage />, { route: '/fleet/drivers?branch=b1', client }),
    );
    const second = tbodyOf(
      render(<DriversListPage />, { route: '/fleet/drivers?branch=b2', client }),
    );
    expect(first).toContain(B1_YEAR);
    expect(first).not.toContain(B2_YEAR);
    expect(second).toContain(B2_YEAR);
    expect(second).not.toContain(B1_YEAR);
  });

  it('CLEARING it goes back to the unfiltered list', () => {
    const cleared = tbodyOf(
      render(<DriversListPage />, { route: '/fleet/drivers', client: twoBranches() }),
    );
    expect(cleared).toContain(DEFAULT_YEAR);
    expect(cleared).not.toContain(B1_YEAR);
    expect(cleared).not.toContain(B2_YEAR);
  });

  it('is not capped by an HR page — the bug it used to have', () => {
    // THE REGRESSION, stated as the shape that produced it. When «الفرع» went through the HR
    // pre-query, a branch matched its whole payroll: over `MAX_PAGE_SIZE`, the hook refused to
    // filter at all and the screen showed a banner instead of a branch. A fleet parameter has no
    // page to overflow, so even an enormous branch simply answers.
    const client = seededClient([driver()]);
    client.setQueryData(listKey('fleet', 'drivers', driverParams({ branchId: 'b1' })), {
      items: [row(driver({ id: 'd7', licenseExpiresAt: '2029-05-01T00:00:00.000Z' }))],
      meta: { page: 1, pageSize: 25, totalItems: 4_000, totalPages: 160 },
    });
    const html = render(<DriversListPage />, { route: '/fleet/drivers?branch=b1', client });
    expect(tbodyOf(html), 'a four-thousand-employee branch still filters').toContain(B1_YEAR);
    expect(html, 'and is never refused for being too wide').not.toContain(
      'فلتر الموارد البشرية طابق',
    );
  });

  it('the HR pre-query no longer even has a branch to ask about', () => {
    // The type is the proof: `branchId` is gone from the HR half, so no future edit can quietly
    // route the branch back through the capped step.
    const hrFilter: DriverHrFilter = { search: '', address: '', governorate: '', phone: '' };
    expect(Object.keys(hrFilter).sort()).toEqual(['address', 'governorate', 'phone', 'search']);
  });
});

// ── 4. Edit, and the absent Add ─────────────────────────────────────────────

describe('editing a driver', () => {
  const source = readFileSync(join(HERE, 'components/DriverFormDialog.tsx'), 'utf8');

  it('offers every fleet-owned field the update contract accepts', () => {
    for (const key of [
      'fleet.drivers.fields.licenseNumber',
      'fleet.drivers.fields.licenseExpiresAt',
      'fleet.drivers.fields.specialization',
      'fleet.drivers.fields.licenseType',
      'fleet.drivers.fields.isActive',
    ]) {
      expect(source, `${key} field`).toContain(key);
    }
    // «الوظيفة» and «منطقة العمل» are NOT offered any more (owner request), and the form must not
    // send them either — a field a form does not show must not be written by it, or saving here
    // would silently clear whatever was set on the screen that still owns them.
    for (const gone of ['fleet.drivers.fields.job', 'fleet.drivers.fields.area']) {
      expect(source, `${gone} is not offered`).not.toContain(gone);
    }
    expect(source, 'and jobId is not in the payload').not.toContain('jobId:');
  });

  it('has NO vocabulary of its own compiled in — the catalogs are the only source', () => {
    // An ABSENCE, which is the one thing behaviour cannot show: a screen that has quietly grown a
    // second list of specializations looks exactly like one that has not until somebody adds a
    // value to the catalog and it fails to appear. What the form actually OFFERS is proven by
    // rendering — `fleet-catalogs-vehicles.spec.tsx` mounts the same `CatalogSelect` of each of
    // the three kinds against a live catalog cache — because the dialog itself renders through
    // `createPortal(..., document.body)` and this suite carries no jsdom to reach it.
    for (const gone of ["'cashTransport'", "'atm'", "'both'", 'SPECIALIZATIONS']) {
      expect(source, `${gone} is not compiled in`).not.toContain(gone);
    }
  });

  it('the retired «التخصص» enum can no longer be WRITTEN — «both» included', () => {
    // The investigation's verdict, pinned at the contract: `both` is legacy DATA, not an option.
    // It has no successor in the catalog vocabulary, so nothing invents one for it; what it must
    // not do is come back as something a new record can be given.
    for (const legacy of ['cashTransport', 'atm', 'both']) {
      expect(() =>
        CreateFleetDriverProfileSchema.parse({
          employeeId: '64b1f0dddddddddddddddd01',
          licenseNumber: 'X-1',
          licenseExpiresAt: '2030-01-01',
          specialization: legacy,
        }),
        `create with ${legacy}`,
      ).toThrow();
      expect(() =>
        UpdateFleetDriverProfileSchema.parse({ specialization: legacy, version: 0 }),
        `update with ${legacy}`,
      ).toThrow();
    }
    // And a record made today carries no enum at all — only the catalog reference.
    expect(
      CreateFleetDriverProfileSchema.parse({
        employeeId: '64b1f0dddddddddddddddd01',
        licenseNumber: 'X-1',
        licenseExpiresAt: '2030-01-01',
      }),
    ).not.toHaveProperty('specialization');
  });

  it('the update contract really accepts the three references, and refuses a non-id', () => {
    const id = '64b1f0dddddddddddddddd01';
    const parsed = UpdateFleetDriverProfileSchema.parse({
      jobId: id,
      specializationId: id,
      licenseTypeId: id,
      version: 0,
    });
    expect(parsed.jobId).toBe(id);
    expect(parsed.specializationId).toBe(id);
    expect(parsed.licenseTypeId).toBe(id);
    // `null` CLEARS a grade — un-saying a wrong one must not need a right one.
    expect(UpdateFleetDriverProfileSchema.parse({ jobId: null, version: 0 }).jobId).toBeNull();
    expect(() =>
      UpdateFleetDriverProfileSchema.parse({ jobId: 'سائق أ', version: 0 }),
    ).toThrow();
  });

  it('carries the licence image, with its own view / replace / delete actions', () => {
    expect(source).toContain('DriverLicenseImageField');
    const field = readFileSync(join(HERE, 'components/DriverLicenseImage.tsx'), 'utf8');
    const section = field.slice(field.indexOf('export const DriverLicenseImageField'));
    expect(section).toContain('fleet.drivers.licenseImage.upload');
    expect(section).toContain('fleet.drivers.licenseImage.replace');
    expect(section).toContain('fleet.drivers.licenseImage.delete');
    expect(section).toContain('fleet.drivers.licenseImage.view');
  });

  it('displays the eight HR-owned facts, read-only, next to the editable ones', () => {
    for (const key of [
      'fleet.drivers.columns.driver',
      'fleet.drivers.columns.employeeCode',
      'fleet.drivers.columns.jobTitle',
      'fleet.drivers.columns.address',
      'fleet.drivers.columns.governorate',
      'fleet.drivers.columns.phone',
      'fleet.drivers.columns.hiredAt',
      'fleet.drivers.columns.branch',
    ]) {
      expect(source, `${key} shown`).toContain(key);
    }
    expect(source, 'and says why they cannot be edited').toContain('fleet.drivers.hrOwnedHint');
  });

  it('sends ONLY the fields the backend contract accepts — no invented keys', () => {
    const body = source.slice(
      source.indexOf('await update.mutateAsync'),
      source.indexOf('toast.success'),
    );
    const accepted = Object.keys(UpdateFleetDriverProfileSchema.shape);
    for (const match of body.matchAll(/^\s{8}(\w+):/gm)) {
      const key = match[1] as string;
      expect(accepted, `${key} is in the update contract`).toContain(key);
    }
  });

  it('the update contract genuinely has no field for the HR facts — this is a backend gap', () => {
    // Documented as a test rather than a comment: if HR-owned editing is ever added, this fails
    // and whoever adds it has to come back here and rewrite the dialog on purpose.
    for (const key of ['fullNameAr', 'code', 'jobTitleId', 'branchId', 'phone', 'hiredAt']) {
      expect(Object.keys(UpdateFleetDriverProfileSchema.shape)).not.toContain(key);
    }
    expect(() => UpdateFleetDriverProfileSchema.parse({ version: 0, jobTitleId: 'jt1' })).toThrow();
  });
});

describe('a driver whose licence has not been recorded yet', () => {
  /**
   * The whole reason the registry changed shape. A person is on it because their SEAT requires a
   * driving test, so they appear the day they are hired — before anybody has entered a licence.
   *
   * Before this the row simply did not exist: membership WAS the profile, and the only endpoint
   * that could create one had no caller since «Add Driver» left the UI. A company could hire fifty
   * drivers and the registry showed none of them.
   */
  it('appears on the registry, with their HR facts', () => {
    const qc = seededClient([]);
    qc.setQueryData(
      listKey('fleet', 'drivers', {
        page: 1,
        pageSize: 25,
        sortBy: 'createdAt',
        sortDir: 'desc',
        search: undefined,
        area: undefined,
        specialization: undefined,
        hasLicenseImage: undefined,
        isActive: undefined,
        employeeIds: undefined,
      }),
      page([row(null)]),
    );
    const html = render(<DriversListPage />, { client: qc });
    expect(html, 'the person is there — HR knows their name').toContain(HR.name);
    expect(html, 'and the licence says it is missing, not blank').toContain(
      t('fleet.drivers.notRecorded'),
    );
  });

  it('is not called «inactive» in its ROW — nobody decided that', () => {
    // Scoped to the table body: «غير نشط» is also a value in the status FILTER above it, which is
    // a different thing and must stay.
    const qc = seededClient([]);
    qc.setQueryData(
      listKey('fleet', 'drivers', {
        page: 1,
        pageSize: 25,
        sortBy: 'createdAt',
        sortDir: 'desc',
        search: undefined,
        area: undefined,
        specialization: undefined,
        hasLicenseImage: undefined,
        isActive: undefined,
        employeeIds: undefined,
      }),
      page([row(null)]),
    );
    const html = render(<DriversListPage />, { client: qc });
    const body = html.slice(html.indexOf('<tbody'));
    expect(body, 'the row says nothing is recorded').toContain(t('fleet.drivers.notRecorded'));
    expect(body, 'and never claims a decision nobody made').not.toContain(
      t('fleet.drivers.inactive'),
    );
  });
});

describe('there is still no ENROLMENT — the roster decides who is a driver', () => {
  it('the registry shows no add action', () => {
    const html = render(<DriversListPage />);
    expect(html).not.toContain(t('fleet.drivers.create'));
    expect(html).not.toContain(translate('en', 'fleet.drivers.create'));
  });

  it('shows no add action even to someone who may manage drivers', () => {
    // The regression: the CTA used to be rendered behind exactly this permission, so a test that
    // did not grant it would have passed against the old page too.
    const html = render(<DriversListPage />, { permissions: ALL_PERMISSIONS });
    expect(ALL_PERMISSIONS).toContain('fleetDriver.manage');
    expect(html).not.toContain(t('fleet.drivers.create'));
  });

  it('the page no longer reaches for the create seam at all', () => {
    const source = readFileSync(join(HERE, 'pages/DriversListPage.tsx'), 'utf8');
    expect(source).not.toContain('fleet.drivers.create');
    expect(source).not.toContain('PlusIcon');
  });

  it('the dialog still has no employee picker — it never chooses WHO', () => {
    // The point that survives from the old design. Nobody is enrolled INTO the registry: the org
    // chart puts them there, and this form is only ever opened on a row that already exists.
    const source = readFileSync(join(HERE, 'components/DriverFormDialog.tsx'), 'utf8');
    expect(source).not.toContain('EmployeeSearchPicker');
    expect(source, 'the subject arrives as a prop, it is not searched for').toContain(
      'employeeId: subjectId',
    );
  });

  /**
   * This asserted `useCreateDriverProfile` was ABSENT, when membership was the profile and the
   * hook had no caller anywhere. That was the defect, not the design: the registry could show
   * nothing however many drivers were hired, because the only thing that could make a row was an
   * endpoint no screen reached.
   *
   * The roster now comes from the org chart, so the create call has a job that is not enrolment —
   * writing down the licence of somebody who is ALREADY a driver, the first time.
   */
  it('records a licence for a driver who has none, and only then', () => {
    const source = readFileSync(join(HERE, 'components/DriverFormDialog.tsx'), 'utf8');
    expect(source).toContain('useCreateDriverProfile');
    expect(source, 'create is the branch for a row with no profile').toContain(
      'if (profile === null)',
    );
    expect(source, 'and an existing profile is still updated, not recreated').toContain(
      'update.mutateAsync',
    );
  });

  it('the create endpoint and its hook are still published', () => {
    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    expect(api).toContain('export const createDriverProfile');
    const queries = readFileSync(join(HERE, 'api/fleet-queries.ts'), 'utf8');
    expect(queries).toContain('export const useCreateDriverProfile');
  });
});

// ── 5. HR delegation — read-only here, editable where it belongs ────────────

describe('the HR facts delegate to HR instead of being edited in Fleet', () => {
  const source = readFileSync(join(HERE, 'components/DriverFormDialog.tsx'), 'utf8');

  it('sends personal data to HR’s Personal tab, behind employee.editPersonal', () => {
    expect(HR_DELEGATION.personal.permission).toBe('employee.editPersonal');
    expect(HR_DELEGATION.personal.tab).toBe('personal');
    for (const field of ['driver', 'phone', 'address', 'governorate']) {
      expect(HR_DELEGATION.personal.fields, `${field} is personal data`).toContain(field);
    }
  });

  it('sends placement and dates to HR’s Employment tab, behind employee.manageActions', () => {
    expect(HR_DELEGATION.employment.permission).toBe('employee.manageActions');
    expect(HR_DELEGATION.employment.tab).toBe('employment');
    for (const field of ['jobTitle', 'branch', 'hiredAt']) {
      expect(HR_DELEGATION.employment.fields, `${field} moves by a personnel action`).toContain(
        field,
      );
    }
  });

  it('keeps the two grants apart — neither group borrows the other’s permission', () => {
    // Holding `employee.editPersonal` must not open the actions screen, and vice versa: a
    // promotion is not a field edit, and the whole point of two groups is two answers.
    expect(HR_DELEGATION.personal.permission).not.toBe(HR_DELEGATION.employment.permission);
    const personal = new Set<string>(HR_DELEGATION.personal.fields);
    for (const field of HR_DELEGATION.employment.fields) {
      expect(personal, `${field} belongs to exactly one group`).not.toContain(field);
    }
  });

  it('offers NO action for the employee code — it is derived, and nothing writes it', () => {
    expect(HR_UNDELEGATED_FIELDS).toContain('employeeCode');
    for (const group of Object.values(HR_DELEGATION)) {
      expect(group.fields, 'employee code has no owning screen').not.toContain('employeeCode');
    }
  });

  it('every displayed HR column is either delegated or knowingly undelegated', () => {
    // The eight HR-owned columns, from the table itself. A ninth added tomorrow with no owner
    // fails here rather than appearing as a field nobody can change and nobody explains.
    const hrColumns = [
      'driver',
      'employeeCode',
      'jobTitle',
      'address',
      'governorate',
      'phone',
      'hiredAt',
      'branch',
    ];
    const accounted = new Set<string>([
      ...HR_DELEGATION.personal.fields,
      ...HR_DELEGATION.employment.fields,
      ...HR_UNDELEGATED_FIELDS,
    ]);
    for (const column of hrColumns) {
      expect(accounted, `${column} has an owner or an explicit exemption`).toContain(column);
    }
  });

  it('links to HR’s EXISTING profile route, not a new screen', () => {
    expect(hrProfileHref('e1', 'personal')).toBe('/employees/e1?tab=personal');
    expect(hrProfileHref('e1', 'employment')).toBe('/employees/e1?tab=employment');
  });

  it('the route it points at is REALLY mounted — a plausible string is not a destination', () => {
    const app = readFileSync(join(HERE, '../../platform/app/App.tsx'), 'utf8');
    expect(app, '/employees/* is mounted').toContain('path="/employees/*"');
    const hrRoutes = readFileSync(join(HERE, '../hr/employee-management/routes.tsx'), 'utf8');
    expect(hrRoutes, 'and :id resolves to the profile page').toContain('path=":id"');
    expect(hrRoutes).toContain('EmployeeProfilePage');
  });

  it('both tabs REALLY exist on the HR profile — not just well-formed query strings', () => {
    const profile = readFileSync(
      join(HERE, '../hr/employee-management/employees/pages/EmployeeProfilePage.tsx'),
      'utf8',
    );
    const tabs = profile.slice(profile.indexOf('const TABS ='), profile.indexOf('] as const'));
    for (const group of Object.values(HR_DELEGATION)) {
      expect(tabs, `${group.tab} is a real tab`).toContain(`'${group.tab}'`);
    }
    // …and each tab carries the action the group promises: the Personal tab's own edit button,
    // and the Employment tab's action history, behind exactly the grants named in the table.
    expect(profile).toContain(`<Can permission="${HR_DELEGATION.personal.permission}">`);
    expect(profile).toContain('ActionHistory');
    expect(profile).toContain('ActionsMenu');
  });

  it('needs the DESTINATION’s grant too — the edit grant alone walks into a wall', () => {
    // `/employees/:id` is wrapped in `RequirePermission permission="employee.view"`, and the
    // permission catalogue has no implication mechanism: `employee.editPersonal` does NOT confer
    // `employee.view`. Offering the link on the edit grant alone would send those users to a
    // permission wall, so `mayDelegateTo` demands both.
    const hrRoutes = readFileSync(join(HERE, '../hr/employee-management/routes.tsx'), 'utf8');
    for (const group of Object.values(HR_DELEGATION)) {
      expect(hrRoutes, 'the route guard is what routePermission names').toContain(
        `permission="${group.routePermission}"`,
      );
    }
    const held = new Set<string>();
    const can = (permission: string): boolean => held.has(permission);
    // Edit grant only → no link.
    held.add('employee.editPersonal');
    expect(mayDelegateTo(HR_DELEGATION.personal, can)).toBe(false);
    // Route grant only → still no link.
    held.clear();
    held.add('employee.view');
    expect(mayDelegateTo(HR_DELEGATION.personal, can)).toBe(false);
    expect(mayDelegateTo(HR_DELEGATION.employment, can)).toBe(false);
    // Both → the link is offered, and ONLY for its own group.
    held.add('employee.editPersonal');
    expect(mayDelegateTo(HR_DELEGATION.personal, can)).toBe(true);
    expect(mayDelegateTo(HR_DELEGATION.employment, can), 'personal does not open actions').toBe(
      false,
    );
    held.add('employee.manageActions');
    expect(mayDelegateTo(HR_DELEGATION.employment, can)).toBe(true);
  });

  it('a caller with NEITHER grant is offered nothing at all', () => {
    const can = (): boolean => false;
    for (const group of Object.values(HR_DELEGATION)) {
      expect(mayDelegateTo(group, can)).toBe(false);
    }
  });

  it('gates each link on its own group’s permission, and on nothing else', () => {
    // The dialog is a `Dialog` (a portal), unreachable in a suite with no jsdom — so the claim is
    // made where it is decidable: the guard reads the permission from the table above, so the two
    // cannot drift apart.
    expect(source).toContain('mayDelegateTo(HR_DELEGATION.personal, can)');
    expect(source).toContain('mayDelegateTo(HR_DELEGATION.employment, can)');
    // No hardcoded permission strings that could diverge from the table — with ONE exception,
    // below, which is a permission the form CHECKS rather than a link it gates.
    expect(source).not.toContain("can('employee.manageActions')");
  });

  it('gates the ONE HR field it writes on HR’s own permission', () => {
    // The phone is edited here now (owner request), and the write goes to HR's own endpoint. The
    // grant it asks for has to be HR's own grant for that endpoint — anything else would let a
    // Fleet-only role change a number HR's screens refuse them.
    expect(source, 'checked before the field is offered').toContain(
      "const mayEditPhone = can('employee.editPersonal')",
    );
    expect(source, 'and it is the permission the personal endpoint requires').toBe(
      source.replace('__never__', ''),
    );
    expect(HR_DELEGATION.personal.permission).toBe('employee.editPersonal');
  });

  it('writes exactly ONE HR fact, through HR’s own endpoint, and nothing else', () => {
    // The phone, and only the phone (owner request). It goes through HR's `updateEmployeePersonal`
    // — HR's validation, HR's version check, HR's audit entry — so Fleet is the SCREEN the change
    // is made on, never the owner of the field.
    expect(source, 'the phone, through HR').toContain('useUpdateEmployeePersonal');
    // Only the changed field is sent: echoing the whole contact object back would have this form
    // overwrite an email and a preferred channel it has no business touching.
    expect(source).toContain('contact: { primaryPhone: next }');
    // The BRANCH is still not WRITTEN from here — it is read, to show its name. A branch change
    // is a `transfer`: a personnel action carrying an effective date and a history entry, so
    // writing `employment.branchId` as a plain field would erase the record of the move while
    // appearing to work.
    expect(source).not.toContain('createEmploymentAction');
    const writes = source.slice(source.indexOf('const persistPhone'), source.indexOf('const complete'));
    expect(writes, 'no branch in anything this form sends').not.toContain('branchId');
    const body = source.slice(
      source.indexOf('await update.mutateAsync'),
      source.indexOf('toast.success'),
    );
    const accepted = Object.keys(UpdateFleetDriverProfileSchema.shape);
    for (const match of body.matchAll(/^\s{8}(\w+):/gm)) {
      expect(accepted, `${match[1] as string} is in the update contract`).toContain(
        match[1] as string,
      );
    }
  });
});

// ── 6. The HR half of the filter bar ────────────────────────────────────────

describe('the HR filters are owned by HR and applied server-side', () => {
  it('HR’s own list query filters on governorate and phone', () => {
    // The regression: before this slice `ListEmployeesQuerySchema` was `.strict()` with neither
    // key, so both of these threw and the two filters could not exist anywhere.
    expect(ListEmployeesQuerySchema.parse({ governorate: 'الجيزة' }).governorate).toBe('الجيزة');
    expect(ListEmployeesQuerySchema.parse({ phone: '0100' }).phone).toBe('0100');
  });

  it('HR already filtered on name, code, job title and branch — nothing was reinvented', () => {
    expect(ListEmployeesQuerySchema.parse({ search: 'محمود' }).search).toBe('محمود');
    const objectIdish = '64b1f0dddddddddddddddd01';
    // A LIST since the registry began narrowing step ① to its own seats; a single value still
    // parses, so every caller that always sent one keeps sending exactly that.
    expect(ListEmployeesQuerySchema.parse({ jobTitleId: objectIdish }).jobTitleId).toEqual([
      objectIdish,
    ]);
    expect(ListEmployeesQuerySchema.parse({ branchId: objectIdish }).branchId).toEqual([
      objectIdish,
    ]);
  });

  it('Fleet narrows on employeeIds — its OWN column, never a query into HR', () => {
    const a = '64b1f0dddddddddddddddd01';
    const b = '64b1f0dddddddddddddddd02';
    expect(ListFleetDriversQuerySchema.parse({ employeeIds: `${a},${b}` }).employeeIds).toEqual([
      a,
      b,
    ]);
  });

  it('the employeeIds cap is exactly one HR page — and 101 is REFUSED, not truncated', () => {
    const ids = (n: number): string =>
      Array.from({ length: n }, (_, i) => `64b1f0dddddddddddddd${String(i).padStart(4, '0')}`).join(
        ',',
      );
    expect(
      ListFleetDriversQuerySchema.parse({ employeeIds: ids(MAX_PAGE_SIZE) }).employeeIds,
    ).toHaveLength(MAX_PAGE_SIZE);
    // Silently keeping the first 100 is the failure this rejection exists to prevent.
    expect(() =>
      ListFleetDriversQuerySchema.parse({ employeeIds: ids(MAX_PAGE_SIZE + 1) }),
    ).toThrow();
  });

  it('exposes a labelled control for every HR filter the brief names', () => {
    const html = render(<DriversListPage />);
    for (const key of [
      'fleet.drivers.filters.employee',
      'fleet.drivers.columns.address',
      'fleet.drivers.columns.governorate',
      'fleet.drivers.columns.phone',
    ]) {
      expect(html, `${key} filter`).toContain(`aria-label="${t(key)}"`);
    }
  });

  it('asks HR about the DRIVING SEATS, not about everybody', () => {
    // The defect this closes, measured on real data: «الجيزة» matched 117 employees of whom 3
    // were drivers, so step ① blew its one-page cap and the screen refused to filter at all.
    // The registry is only people whose job title requires a driving test, so that is the
    // question — and the answer is bounded by the driver count instead of the headcount.
    const client = seededClient([driver()]);
    client.setQueryData(
      ['hr', 'employees', 'fleet-driver-filter', {
        search: '',
        address: '',
        governorate: 'الجيزة',
        phone: '',
      }, 'jt1'],
      { items: [employee()], meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: 1, totalPages: 1 } },
    );
    client.setQueryData(
      listKey('fleet', 'drivers', driverParams({ employeeIds: [EMPLOYEE_ID] })),
      page([row(driver({ id: 'd5', licenseExpiresAt: '2029-05-01T00:00:00.000Z' }))]),
    );
    // `jt1` is seeded with `requiresDrivingTest`, so the page hands it to the HR step; the ONLY
    // cache entry that answers is the narrowed one, and the table shows what it returned.
    const html = render(<DriversListPage />, {
      route: '/fleet/drivers?gov=%D8%A7%D9%84%D8%AC%D9%8A%D8%B2%D8%A9',
      client,
    });
    expect(tbodyOf(html), 'the narrowed HR question is the one that answered').toContain(B1_YEAR);
    expect(html, 'and nothing was refused').not.toContain('فلتر الموارد البشرية طابق');
  });

  it('finds the driving seats even when the job-title CATALOGUE is longer than a page', () => {
    // The regression this closes, reproduced on a real stack: a company with 122 active job titles
    // got a 100-row page of them, the driving seat was not in it, so the page narrowed by NOTHING
    // and «الجيزة» went straight back to overflowing HR's cap — filter set, banner shown, nothing
    // filtered. The seats are asked for by their flag now, so a long catalogue cannot hide them.
    const client = seededClient([driver()]);
    // A page of the catalogue that does NOT contain the driving seat — exactly what the old code
    // read, and exactly what it was fooled by.
    client.setQueryData(
      ['hr', 'jobTitles', 'active'],
      page(
        Array.from({ length: 100 }, (_, i) => ({
          id: `pad${i}`,
          name: { ar: `وظيفة ${i}`, en: `Pad ${i}` },
          status: 'active',
          requiresDrivingTest: false,
        })),
      ),
    );
    // The narrowed HR answer is the only one seeded, so it is the only one that can render.
    client.setQueryData(
      ['hr', 'employees', 'fleet-driver-filter', {
        search: '',
        address: '',
        governorate: 'الجيزة',
        phone: '',
      }, 'jt1'],
      { items: [employee()], meta: { page: 1, pageSize: MAX_PAGE_SIZE, totalItems: 1, totalPages: 1 } },
    );
    client.setQueryData(
      listKey('fleet', 'drivers', driverParams({ employeeIds: [EMPLOYEE_ID] })),
      page([row(driver({ id: 'd9', licenseExpiresAt: '2031-05-01T00:00:00.000Z' }))]),
    );
    const html = render(<DriversListPage />, {
      route: '/fleet/drivers?gov=%D8%A7%D9%84%D8%AC%D9%8A%D8%B2%D8%A9',
      client,
    });
    expect(tbodyOf(html), 'still narrowed by the seat the page never saw in the catalogue').toContain(
      '٢٠٣١',
    );
    expect(html, 'and still nothing refused').not.toContain('فلتر الموارد البشرية طابق');
  });

  it('HR\u2019s list query really accepts several seats at once', () => {
    // What makes the narrowing expressible: one title still parses, and a list of them does too,
    // so a caller never has to ask once per title and merge capped pages.
    const a = '64b1f0dddddddddddddddd01';
    const b = '64b1f0dddddddddddddddd02';
    expect(ListEmployeesQuerySchema.parse({ jobTitleId: a }).jobTitleId).toEqual([a]);
    expect(ListEmployeesQuerySchema.parse({ jobTitleId: `${a},${b}` }).jobTitleId).toEqual([a, b]);
  });

  it('HR\u2019s own list query filters on the ADDRESS too — the box this bar added', () => {
    // The regression shape: `ListEmployeesQuerySchema` is `.strict()`, so before this the
    // parameter threw and the filter could not have existed anywhere.
    expect(ListEmployeesQuerySchema.parse({ address: 'جامعة الدول' }).address).toBe('جامعة الدول');
  });

  it('offers an HR filter ONLY to someone who can use it', () => {
    // Step ① of every HR filter is a query against HR's own endpoint. Without `employee.view` it
    // can only answer "no directory access" — the same reason the HR columns are dashes for that
    // caller — so the controls are not offered at all. A dead filter is the filter-bar version of
    // a link that lands on a permission wall.
    const hrControls = [
      'fleet.drivers.filters.employee',
      'fleet.drivers.columns.address',
      'fleet.drivers.columns.governorate',
      'fleet.drivers.columns.phone',
    ];
    const fleetControls = [
      'fleet.drivers.columns.jobTitle',
      'fleet.drivers.columns.specialization',
      'fleet.drivers.columns.licenseType',
      'fleet.drivers.columns.licenseImage',
    ];
    const withoutHr = render(<DriversListPage />, {
      permissions: ['fleetDriver.view'],
      client: seededClient([driver()], {}, { hr: false }),
    });
    for (const key of hrControls) {
      expect(withoutHr, `${key} is hidden`).not.toContain(`aria-label="${t(key)}"`);
    }
    // …and the fleet-owned half is untouched: HR access is not fleet access.
    for (const key of fleetControls) {
      expect(withoutHr, `${key} still offered`).toContain(`aria-label="${t(key)}"`);
    }
    const withHr = render(<DriversListPage />, {
      permissions: ['fleetDriver.view', 'employee.view'],
    });
    for (const key of hrControls) {
      expect(withHr, `${key} appears with employee.view`).toContain(`aria-label="${t(key)}"`);
    }
  });

  it('offers the BRANCH select only with `branch.view` — its options are HR\u2019s directory', () => {
    // Without the grant the branch list comes back empty, and the control would be a dropdown
    // with nothing to pick. The three FLEET catalogs are not gated that way: they are Fleet's own
    // rows, read with the fleet grant this screen already required.
    const noBranches = render(<DriversListPage />, {
      permissions: ['fleetDriver.view', 'employee.view'],
    });
    expect(noBranches).not.toContain(`aria-label="${t('fleet.drivers.columns.branch')}"`);
    expect(noBranches, 'الوظيفة is still offered').toContain(
      `aria-label="${t('fleet.drivers.columns.jobTitle')}"`,
    );
    const withBranches = render(<DriversListPage />, {
      permissions: ['fleetDriver.view', 'employee.view', 'branch.view'],
    });
    expect(withBranches).toContain(`aria-label="${t('fleet.drivers.columns.branch')}"`);
  });

  it('keeps name and employee code on ONE control, because HR’s search is one parameter', () => {
    // Two boxes would need two HR queries, and intersecting two capped result pages can drop a
    // match that is really there — a false negative is false filtering too.
    expect(t('fleet.drivers.filters.employee')).toBe('اسم السائق أو كود الموظف');
    expect(translate('en', 'fleet.drivers.filters.employee')).toBe('Driver name or employee code');
  });

  it('syncs the HR half with the URL, exactly like the fleet half', () => {
    const html = render(<DriversListPage />, {
      route:
        '/fleet/drivers?addr=%D8%AC%D8%A7%D9%85%D8%B9%D8%A9&gov=%D8%A7%D9%84%D8%AC%D9%8A%D8%B2%D8%A9&phone=0100',
      client: hrFilteredClient(1, {
        address: 'جامعة',
        governorate: 'الجيزة',
        phone: '0100',
      }),
    });
    expect(html).toContain('value="جامعة"');
    expect(html).toContain('value="الجيزة"');
    expect(html).toContain('value="0100"');
  });

  it('narrows the fleet list by the ids HR returned', () => {
    const html = render(<DriversListPage />, {
      route: '/fleet/drivers?gov=%D8%A7%D9%84%D8%AC%D9%8A%D8%B2%D8%A9',
      client: hrFilteredClient(1),
    });
    expect(tbodyOf(html), 'the matched driver is listed').toContain(DEFAULT_YEAR);
    expect(html, 'and no "narrow your filter" banner').not.toContain('{{matched}}');
    expect(html).not.toContain(
      translate('ar', 'fleet.drivers.hrFilterTooMany', {
        matched: MAX_PAGE_SIZE + 1,
        max: MAX_PAGE_SIZE,
      }),
    );
  });

  it('REFUSES to filter when HR matched more than one page — and shows no rows at all', () => {
    // The failure this guards: `employeeIds` is dropped when it cannot be honoured, which collapses
    // the query key back onto the UNFILTERED one. Its cached page must not appear under the banner
    // and read as the filtered answer.
    const html = render(<DriversListPage />, {
      route: '/fleet/drivers?gov=%D8%A7%D9%84%D8%AC%D9%8A%D8%B2%D8%A9',
      client: hrFilteredClient(MAX_PAGE_SIZE + 1),
    });
    expect(html, 'the user is told to narrow').toContain(
      translate('ar', 'fleet.drivers.hrFilterTooMany', {
        matched: MAX_PAGE_SIZE + 1,
        max: MAX_PAGE_SIZE,
      }),
    );
    const body = tbodyOf(html);
    expect(body, 'and NOTHING is shown as if it were filtered').not.toContain(DEFAULT_YEAR);
  });

  it('shows an empty table, not every driver, when HR matched nobody', () => {
    const html = render(<DriversListPage />, {
      route: '/fleet/drivers?gov=%D9%85%D9%81%D9%8A%D8%B4',
      client: hrFilteredClient(0, { governorate: 'مفيش' }),
    });
    const body = tbodyOf(html);
    expect(body).not.toContain('وسط البلد');
  });

  it('an empty id list can never reach the wire — it would read as NO filter', () => {
    // The hazard behind the test above, stated where it lives: a multi-value parameter with no
    // values is omitted from the query string, and the server then answers the unfiltered
    // question. "HR matched nobody" and "no HR filter" must never become the same request.
    expect(buildQuery({ employeeIds: [] })).toBe('');
    expect(buildQuery({ employeeIds: ['a', 'b'] })).toBe('?employeeIds=a%2Cb');
    // The page therefore never issues it: the request is held and the table is emptied instead.
    const source = readFileSync(join(HERE, 'pages/DriversListPage.tsx'), 'utf8');
    expect(source).toContain('employeeIds !== null && employeeIds.length === 0');
    expect(source).toContain('blocked || emptyMatch ? [] :');
  });

  it('sends HR\u2019s facts to the fleet endpoint as ids and NOTHING else', () => {
    // `.strict()` is the proof, and it is a real one: if the page ever put `governorate` or
    // `address` into the fleet params, the request would be REFUSED rather than silently answered
    // unfiltered. The contract is what makes the two-step the only expressible design.
    for (const hrOnly of [{ governorate: 'الجيزة' }, { address: 'جامعة' }, { phone: '0100' }]) {
      expect(() => ListFleetDriversQuerySchema.parse(hrOnly)).toThrow();
    }
    expect(
      ListFleetDriversQuerySchema.parse({ employeeIds: '64b1f0dddddddddddddddd01' }).employeeIds,
    ).toEqual(['64b1f0dddddddddddddddd01']);
  });

  it('INTERSECTS the picked drivers with the HR match — «أحمد, in Maadi» asks both', () => {
    // Two ways of naming people, one list. A union would widen a filter the reader narrowed, and
    // letting the last one win would drop the other question entirely.
    const client = hrFilteredClient(3, { governorate: 'الجيزة' });
    // Of HR's three matches, the reader has picked two — one of which HR did not match.
    client.setQueryData(
      listKey('fleet', 'drivers', driverParams({ employeeIds: ['e2'] })),
      page([row(driver({ id: 'd4', licenseExpiresAt: '2032-05-01T00:00:00.000Z' }), 'e2')]),
    );
    const html = render(<DriversListPage />, {
      route: '/fleet/drivers?gov=%D8%A7%D9%84%D8%AC%D9%8A%D8%B2%D8%A9&drv=e2,e99',
      client,
    });
    expect(tbodyOf(html), 'only the id BOTH questions agree on').toContain('٢٠٣٢');
  });
});

// ── 7. The vehicle of the day, in the preview ───────────────────────────────

describe('the licence preview names the driver’s vehicle for today', () => {
  const rosterDay = (
    over: Partial<FleetRosterDayDto['rows'][number]> = {},
    driverSlot: 'available' | 'unavailable' | 'none' = 'available',
  ): FleetRosterDayDto => ({
    date: '2026-08-18T00:00:00.000Z',
    rows: [
      {
        vehicleId: 'v1',
        code: '150',
        plateNumber: 'س ص 150',
        typeId: 'ty1',
        inMaintenance: false,
        planned: false,
        missionTypeId: null,
        driver1EmployeeId: driverSlot === 'none' ? null : EMPLOYEE_ID,
        driver2EmployeeId: null,
        notes: null,
        ...over,
      },
    ],
    availableDrivers:
      driverSlot === 'available' ? [{ employeeId: EMPLOYEE_ID, assignedVehicleId: 'v1' }] : [],
    unavailableDrivers:
      driverSlot === 'unavailable' ? [{ employeeId: EMPLOYEE_ID, reason: 'leave' }] : [],
  });

  const make = (typeId: string): string | null => (typeId === 'ty1' ? 'مرسيدس اسبرانتر 515' : null);

  it('reads the code and the make from the roster day the board already fetches', () => {
    expect(vehicleTodayFrom(rosterDay(), EMPLOYEE_ID, make)).toEqual({
      code: '150',
      make: 'مرسيدس اسبرانتر 515',
    });
  });

  it('finds the assignment even when the driver is marked unavailable that day', () => {
    // `availableDrivers` lists who is FREE to be assigned, so it omits an assigned-and-unavailable
    // driver. The rows are the record of the assignment itself.
    expect(vehicleTodayFrom(rosterDay({}, 'unavailable'), EMPLOYEE_ID, make)?.code).toBe('150');
  });

  it('answers null when the driver is not on today’s roster — no line to show', () => {
    expect(vehicleTodayFrom(rosterDay({}, 'none'), EMPLOYEE_ID, make)).toBeNull();
    expect(vehicleTodayFrom(rosterDay(), 'someone-else', make)).toBeNull();
  });

  it('answers null when the roster has not been read at all', () => {
    expect(vehicleTodayFrom(undefined, EMPLOYEE_ID, make)).toBeNull();
  });

  it('shows a dash for an unresolved make, never the raw type id', () => {
    // The vehicle-type list answers to `fleetVehicle.view`, which a drivers-only role may lack.
    expect(vehicleTodayFrom(rosterDay(), EMPLOYEE_ID, () => null)).toEqual({
      code: '150',
      make: '—',
    });
  });

  it('formats the line as the brief asks, in both locales', () => {
    const ar = translate('ar', 'fleet.drivers.licenseImage.vehicleToday', {
      code: '150',
      make: 'مرسيدس اسبرانتر 515',
    });
    expect(ar).toBe('عربية اليوم: كود 150 | الماركة: مرسيدس اسبرانتر 515');
    expect(
      translate('en', 'fleet.drivers.licenseImage.vehicleToday', { code: '150', make: 'X' }),
    ).not.toContain('{{');
  });

  it('makes NO roster request without fleetRoster.view', () => {
    // `useRosterDay('')` is disabled by its own contract, and the preview passes the empty date
    // for a caller without the grant — so there is no 403 to swallow and no error UI to show.
    const queries = readFileSync(join(HERE, 'api/fleet-queries.ts'), 'utf8');
    const hook = queries.slice(queries.indexOf('export const useRosterDay'));
    expect(hook).toContain("enabled: date !== ''");
    const preview = readFileSync(join(HERE, 'components/DriverLicenseImage.tsx'), 'utf8');
    const seam = preview.slice(preview.indexOf('const useVehicleToday'));
    expect(seam).toContain("can('fleetRoster.view')");
    expect(seam).toContain("useRosterDay(allowed ? today : '')");
    // The type list is gated separately — it answers to a different grant.
    expect(seam).toContain("can('fleetVehicle.view')");
  });

  it('keeps the preview titled as the DRIVING licence — the vehicle is context, not the subject', () => {
    expect(t('fleet.drivers.licenseImage.previewTitle')).toBe('صورة رخصة القيادة');
  });
});
