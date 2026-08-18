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
  ListFleetDriversQuerySchema,
  UpdateFleetDriverProfileSchema,
  type EmployeeDto,
  type FleetDriverProfileDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { detailKey, listKey } from '../../shared/lib/query-keys';
import { DriversListPage } from './pages/DriversListPage';
import { DriverLicenseImageCell } from './components/DriverLicenseImage';

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
  { hr = true } = {},
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
