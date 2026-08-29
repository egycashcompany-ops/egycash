// The drivers registry, proven against what the screen actually produces.
//
// Four claims, each one a rule from the brief that a typecheck cannot see:
//   • the table renders the thirteen required columns, in the required order, filled from the two
//     real sources — Fleet's own profile and HR's employee record;
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

const driver = (overrides: Partial<FleetDriverProfileDto> = {}): FleetDriverProfileDto => ({
  id: 'd1',
  employeeId: EMPLOYEE_ID,
  licenseNumber: 'DL-4471',
  licenseExpiresAt: '2027-05-01T00:00:00.000Z',
  specialization: 'cashTransport',
  area: 'وسط البلد',
  isActive: true,
  licenseImage: null,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

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
      ...params,
    }),
    page(rows),
  );
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
  qc.setQueryData(
    ['hr', 'jobTitles', 'active'],
    page([{ id: 'jt1', name: { ar: HR.jobTitle, en: 'Cash transport driver' }, status: 'active' }]),
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
    jobTitleId: '',
    branchId: '',
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
        employeeIds: [],
      }),
      page([driver()]),
    );
  }
  qc.setQueryData(['hr', 'employees', 'fleet-driver-filter', full], {
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

/** The table head alone — a label also used by a filter must not be able to satisfy a column claim. */
const thead = (markup: string): string => {
  const start = markup.indexOf('<thead');
  const end = markup.indexOf('</thead>');
  expect(start, 'the page renders a table head').toBeGreaterThan(-1);
  return markup.slice(start, end);
};

/** The thirteen columns the brief names, in the order it names them. */
const REQUIRED_COLUMNS = [
  'driver',
  'employeeCode',
  'jobTitle',
  'licenseNumber',
  'licenseExpiresAt',
  'address',
  'area',
  'governorate',
  'phone',
  'hiredAt',
  'specialization',
  'branch',
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

describe('the columns are filled from the two real sources', () => {
  const markup = (): string => render(<DriversListPage />);

  it('shows the fleet-owned facts from the driver profile', () => {
    const html = markup();
    expect(html, 'license number').toContain('DL-4471');
    expect(html, 'area').toContain('وسط البلد');
    expect(html, 'specialization').toContain(t('fleet.drivers.specialization.cashTransport'));
  });

  it('shows the HR-owned facts from the employee record, resolved not echoed', () => {
    const html = markup();
    expect(html, 'driver name').toContain(HR.name);
    expect(html, 'employee code').toContain(HR.code);
    expect(html, 'job title').toContain(HR.jobTitle);
    expect(html, 'address').toContain(HR.line1);
    expect(html, 'governorate').toContain(HR.governorate);
    expect(html, 'mobile number').toContain(HR.phone);
    expect(html, 'branch').toContain(HR.branch);
  });

  it('degrades to a dash without `employee.view` rather than leaking an id', () => {
    const html = render(<DriversListPage />, {
      permissions: ['fleetDriver.view', 'fleetDriver.manage'],
      client: seededClient([driver()], {}, { hr: false }),
    });
    const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
    expect(body).not.toContain(HR.name);
    expect(body).not.toContain(HR.phone);
    expect(body, 'and never the raw employee id in its place').not.toContain(EMPLOYEE_ID);
    expect(body, 'the empty HR cells say so').toContain('—');
    // The fleet-owned columns are unaffected: HR access is not fleet access.
    expect(body).toContain('DL-4471');
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
  const FILTER_LABELS = [
    'fleet.drivers.columns.licenseNumber',
    'fleet.drivers.columns.area',
    'fleet.drivers.columns.specialization',
    'fleet.drivers.columns.licenseImage',
    'fleet.drivers.columns.status',
  ];

  it('exposes a labelled control for every fleet-owned filter', () => {
    const html = render(<DriversListPage />);
    for (const key of FILTER_LABELS) {
      expect(html, `${key} filter`).toContain(`aria-label="${t(key)}"`);
    }
  });

  it('reads its state from the URL, so a filtered view is a shareable link', () => {
    const route = '/fleet/drivers?q=DL-44&area=%D9%88%D8%B3%D8%B7&spec=atm&img=with&active=false';
    const html = render(<DriversListPage />, {
      route,
      client: seededClient([driver()], {
        search: 'DL-44',
        area: 'وسط',
        specialization: 'atm',
        hasLicenseImage: true,
        isActive: false,
      }),
    });
    expect(html).toContain('value="DL-44"');
    expect(html).toContain('value="وسط"');
    // A `<select>` renders its choice as the selected option, not as a value attribute.
    expect(html).toContain(`<option value="atm" selected=""`);
    expect(html).toContain(`<option value="with" selected=""`);
    expect(html).toContain(`<option value="false" selected=""`);
  });

  it('lays the controls out as ONE wrapping row — side by side, stacking when narrow', () => {
    const html = render(<DriversListPage />);
    const bar = html.slice(html.indexOf('flex flex-wrap'));
    expect(bar.startsWith('flex flex-wrap'), 'the bar wraps rather than stacking').toBe(true);
    // Each control is a DIRECT child of the bar. A control wrapped in its own block-level row is
    // what put the vehicle filters on separate lines; the widths live on the wrappers instead.
    const source = readFileSync(join(HERE, 'pages/DriversListPage.tsx'), 'utf8');
    const filterBar = source.slice(source.indexOf('<FilterBar'), source.indexOf('</FilterBar>'));
    expect(filterBar).not.toContain('grid');
    expect(filterBar).toContain('className="w-40"');
    expect(filterBar).toContain('className="w-36"');
  });

  it('sends every filter to the SERVER — none is applied to the fetched page', () => {
    const source = readFileSync(join(HERE, 'pages/DriversListPage.tsx'), 'utf8');
    const params = source.slice(
      source.indexOf('const params = useMemo'),
      source.indexOf('useDrivers(params)'),
    );
    for (const key of ['search:', 'area:', 'specialization:', 'hasLicenseImage:', 'isActive:']) {
      expect(params, `${key} reaches the query`).toContain(key);
    }
    // No `.filter(` over the rows: a client-side filter would silently trim one page of many.
    expect(source).not.toContain('rows.filter(');
  });

  it('the backend accepts the two filters this page added', () => {
    // The regression: before this slice `ListFleetDriversQuerySchema` was `.strict()` with neither
    // key, so both of these threw — the filters could not have worked server-side at all.
    expect(ListFleetDriversQuerySchema.parse({ area: 'وسط البلد' }).area).toBe('وسط البلد');
    expect(ListFleetDriversQuerySchema.parse({ hasLicenseImage: 'true' }).hasLicenseImage).toBe(
      true,
    );
    expect(ListFleetDriversQuerySchema.parse({ hasLicenseImage: 'false' }).hasLicenseImage).toBe(
      false,
    );
  });

  it('still refuses a filter the backend does not implement, rather than ignoring it', () => {
    // `governorate` is an HR fact: the fleet list cannot filter on it, and the schema says so
    // loudly instead of accepting the parameter and returning an unfiltered page.
    expect(() => ListFleetDriversQuerySchema.parse({ governorate: 'الجيزة' })).toThrow();
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
      'fleet.drivers.fields.area',
      'fleet.drivers.fields.isActive',
    ]) {
      expect(source, `${key} field`).toContain(key);
    }
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

describe('enrolling a driver is gone from the UI', () => {
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

  it('the dialog is edit-only — no employee picker, no create call', () => {
    const source = readFileSync(join(HERE, 'components/DriverFormDialog.tsx'), 'utf8');
    expect(source).not.toContain('EmployeeSearchPicker');
    expect(source).not.toContain('useCreateDriverProfile');
    expect(source).not.toContain('fleet.drivers.created');
  });

  it('but the API still offers create — the endpoint was not removed with the button', () => {
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
    // No hardcoded permission strings that could diverge from the table.
    expect(source).not.toContain("can('employee.editPersonal')");
    expect(source).not.toContain("can('employee.manageActions')");
  });

  it('still writes NOTHING of HR’s from Fleet — the delegation is a link, not a write', () => {
    expect(source).not.toContain('updateEmployeePersonal');
    expect(source).not.toContain('createEmploymentAction');
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
    expect(ListEmployeesQuerySchema.parse({ jobTitleId: objectIdish }).jobTitleId).toBe(
      objectIdish,
    );
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
      'fleet.drivers.columns.jobTitle',
      'fleet.drivers.columns.branch',
      'fleet.drivers.columns.governorate',
      'fleet.drivers.columns.phone',
    ]) {
      expect(html, `${key} filter`).toContain(`aria-label="${t(key)}"`);
    }
  });

  it('offers an HR filter ONLY to someone who can use it', () => {
    // Step ① of every HR filter is a query against HR's own endpoint. Without `employee.view` it
    // can only answer "no directory access" — the same reason the HR columns are dashes for that
    // caller — so the controls are not offered at all. A dead filter is the filter-bar version of
    // a link that lands on a permission wall.
    const hrControls = [
      'fleet.drivers.filters.employee',
      'fleet.drivers.columns.governorate',
      'fleet.drivers.columns.phone',
    ];
    const fleetControls = [
      'fleet.drivers.columns.licenseNumber',
      'fleet.drivers.columns.area',
      'fleet.drivers.columns.specialization',
      'fleet.drivers.columns.licenseImage',
      'fleet.drivers.columns.status',
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

  it('offers each reference select only with its OWN catalogue grant', () => {
    // Without `jobTitle.view` / `branch.view` the option list comes back empty, and the control
    // would be a dropdown with nothing to pick.
    const noCatalogues = render(<DriversListPage />, {
      permissions: ['fleetDriver.view', 'employee.view'],
    });
    expect(noCatalogues).not.toContain(`aria-label="${t('fleet.drivers.columns.jobTitle')}"`);
    expect(noCatalogues).not.toContain(`aria-label="${t('fleet.drivers.columns.branch')}"`);
    const withCatalogues = render(<DriversListPage />, {
      permissions: ['fleetDriver.view', 'employee.view', 'jobTitle.view', 'branch.view'],
    });
    expect(withCatalogues).toContain(`aria-label="${t('fleet.drivers.columns.jobTitle')}"`);
    expect(withCatalogues).toContain(`aria-label="${t('fleet.drivers.columns.branch')}"`);
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
        '/fleet/drivers?emp=%D9%85%D8%AD%D9%85%D9%88%D8%AF&gov=%D8%A7%D9%84%D8%AC%D9%8A%D8%B2%D8%A9&phone=0100&job=jt1&branch=b1',
      client: hrFilteredClient(1, {
        search: 'محمود',
        governorate: 'الجيزة',
        phone: '0100',
        jobTitleId: 'jt1',
        branchId: 'b1',
      }),
    });
    expect(html).toContain('value="محمود"');
    expect(html).toContain('value="الجيزة"');
    expect(html).toContain('value="0100"');
    expect(html).toContain('<option value="jt1" selected=""');
    expect(html).toContain('<option value="b1" selected=""');
  });

  it('narrows the fleet list by the ids HR returned', () => {
    const html = render(<DriversListPage />, {
      route: '/fleet/drivers?gov=%D8%A7%D9%84%D8%AC%D9%8A%D8%B2%D8%A9',
      client: hrFilteredClient(1),
    });
    expect(html, 'the matched driver is listed').toContain('DL-4471');
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
    const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
    expect(body, 'and NOTHING is shown as if it were filtered').not.toContain('DL-4471');
  });

  it('shows an empty table, not every driver, when HR matched nobody', () => {
    const html = render(<DriversListPage />, {
      route: '/fleet/drivers?gov=%D9%85%D9%81%D9%8A%D8%B4',
      client: hrFilteredClient(0, { governorate: 'مفيش' }),
    });
    const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
    expect(body).not.toContain('DL-4471');
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

  it('applies no filter on the fetched page — every filter is a query parameter', () => {
    const source = readFileSync(join(HERE, 'pages/DriversListPage.tsx'), 'utf8');
    expect(source).not.toContain('rows.filter(');
    expect(source).not.toContain('items.filter(');
    // The HR half never reaches the fleet endpoint as anything but resolved ids.
    const params = source.slice(
      source.indexOf('const params = useMemo'),
      source.indexOf('useDrivers(params'),
    );
    expect(params).toContain('employeeIds:');
    for (const hrKey of ['governorate:', 'phone:', 'jobTitleId:', 'branchId:']) {
      expect(params, `${hrKey} is HR's, not Fleet's`).not.toContain(hrKey);
    }
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
