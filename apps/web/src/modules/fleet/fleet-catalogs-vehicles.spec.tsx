// The catalogs slice, proven against what the screens actually produce.
//
// Three claims, each one a rule from the brief that a typecheck cannot see:
//   • the three new catalogs are REAL tabs on /fleet/catalogs and REAL selects in the vehicle
//     form — reading live catalog rows, with no option written into the component;
//   • the registry table renders the frozen column order, and the license-image cell offers
//     upload when there is no scan and view/delete when there is;
//   • the print view includes the image section only when there IS an image (§9).
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing clicks: markup is
// rendered with `renderToStaticMarkup`, which is enough for presence, order, labels and state.
// The pure print composer is tested directly, where the §9 rule actually lives.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FLEET_CATALOG_KINDS,
  type FleetVehicleDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { detailKey, listKey } from '../../shared/lib/query-keys';
import { VehiclesListPage } from './pages/VehiclesListPage';
import { CatalogsPage } from './pages/CatalogsPage';
import { CatalogSelect } from './components/CatalogSelect';
import { buildVehiclePrintHtml } from './components/vehicle-print';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Fixtures ────────────────────────────────────────────────────────────────

const CATALOG = {
  licenseClass: { id: 'lc1', name: { ar: 'الأولى', en: 'First' } },
  operation: { id: 'op1', name: { ar: 'تشغيل القاهرة', en: 'Cairo operation' } },
  insuranceCompany: { id: 'in1', name: { ar: 'مصر للتأمين', en: 'Misr Insurance' } },
};

const catalogItem = (kind: string, id: string, name: { ar: string; en: string }) => ({
  id,
  kind,
  name,
  countsForAlarm: false,
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const page = <T,>(items: T[]) => ({
  items,
  meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
});

const vehicle = (overrides: Partial<FleetVehicleDto> = {}): FleetVehicleDto => ({
  id: 'v1',
  code: '150',
  typeId: 'ty1',
  plateNumber: 'س ص 150',
  chassisNumber: 'CH-150',
  motorNumber: 'MO-150',
  joinedAt: '2024-01-01T00:00:00.000Z',
  licenseExpiresAt: '2027-01-01T00:00:00.000Z',
  licenseClassId: CATALOG.licenseClass.id,
  operationId: CATALOG.operation.id,
  insuranceCompanyId: CATALOG.insuranceCompany.id,
  branchId: 'b1',
  departmentId: null,
  radio: { issi: null, motorolaSn: null },
  status: 'active',
  statusReason: null,
  licenseImage: null,
  inWorkshop: false,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const WITH_IMAGE = vehicle({
  licenseImage: {
    fileId: 'f1',
    fileName: 'license.jpg',
    mime: 'image/jpeg',
    size: 1024,
    uploadedAt: '2026-02-01T00:00:00.000Z',
  },
});

const ALL_PERMISSIONS = [
  'fleetVehicle.view',
  'fleetVehicle.create',
  'fleetVehicle.edit',
  'fleetVehicle.changeStatus',
  'fleetVehicle.delete',
  'fleetCatalog.manage',
  'branch.view',
];

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
  }) as unknown as MeDto;

/**
 * A query client PRE-SEEDED with the responses the page would fetch. The pages read through
 * TanStack Query, and `renderToStaticMarkup` never lets an effect run — seeding the cache is what
 * makes the first paint the loaded state instead of the skeleton.
 */
const seededClient = (): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const M = 'fleet';
  qc.setQueryData(listKey(M, 'vehicleTypes', { pageSize: 100 }), page([
    {
      id: 'ty1',
      name: { ar: 'مرسيدس اسبرانتر 515', en: 'Mercedes Sprinter 515' },
      maintenanceIntervalKm: 10_000,
      isActive: true,
      version: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]));
  for (const [kind, item] of Object.entries(CATALOG)) {
    qc.setQueryData(listKey(M, 'catalogs', { kind }), page([catalogItem(kind, item.id, item.name)]));
  }
  // `useBranches` selects `page.items`, so the cache must hold the PAGE the endpoint returns.
  qc.setQueryData(['hr', 'branches', 'active'], page([
    { id: 'b1', code: '01', name: { ar: 'المهندسين', en: 'Mohandessin' }, status: 'active' },
    { id: 'b2', code: '02', name: { ar: 'الجيزة', en: 'Giza' }, status: 'active' },
  ]));
  qc.setQueryData(listKey(M, 'vehicles', { defaultBranch: true }), {
    branchId: 'b1',
    name: { ar: 'المهندسين', en: 'Mohandessin' },
    configuredName: 'المهندسين',
  });
  qc.setQueryData(detailKey(M, 'vehicles', 'v1'), WITH_IMAGE);
  return qc;
};

const render = (
  node: JSX.Element,
  {
    locale = 'ar' as Locale,
    permissions = ALL_PERMISSIONS,
    route = '/fleet/vehicles',
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

// ── 1. Catalogs ─────────────────────────────────────────────────────────────

describe('the three new catalogs are first-class kinds', () => {
  it('the contracts enum carries them, so every generic catalog surface picks them up', () => {
    expect(FLEET_CATALOG_KINDS).toContain('licenseClass');
    expect(FLEET_CATALOG_KINDS).toContain('operation');
    expect(FLEET_CATALOG_KINDS).toContain('insuranceCompany');
  });

  it('each has a tab label in BOTH locales — no kind renders as a raw key', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const kind of FLEET_CATALOG_KINDS) {
        const key = `fleet.catalogs.kind.${kind}`;
        expect(translate(locale, key), `${key} in ${locale}`).not.toBe(key);
      }
    }
  });

  it('renders a tab per kind on /fleet/catalogs, the three new ones included', () => {
    const markup = render(<CatalogsPage />, { route: '/fleet/catalogs' });
    for (const kind of FLEET_CATALOG_KINDS) {
      expect(markup, `${kind} tab`).toContain(t(`fleet.catalogs.kind.${kind}`));
    }
  });
});

// ── 2. The vehicle form ─────────────────────────────────────────────────────

/**
 * The form lives inside `Dialog`, which renders through `createPortal(..., document.body)` — and
 * the web suite carries no jsdom, so the dialog's own markup is unreachable here. The two claims
 * are therefore split:
 *
 *   • what the user SEES in each of the three new fields is proven by rendering `CatalogSelect`
 *     itself — the exact component the form mounts — against the same live catalog cache;
 *   • what the form WIRES is proven against its source, which is the only reachable evidence for
 *     a portal-rendered tree. These are structural claims ("this select is bound to this kind"),
 *     not reachability claims, so a scan is honest evidence for them.
 */
describe('the vehicle form reads real catalogs and requires a branch', () => {
  const source = readFileSync(join(HERE, 'components/VehicleFormDialog.tsx'), 'utf8');

  for (const [kind, item] of Object.entries(CATALOG)) {
    it(`the ${kind} select is filled from live catalog rows, not from written-in options`, () => {
      const html = render(
        <CatalogSelect kind={kind as never} value="" onChange={() => undefined} />,
      );
      expect(html).toContain(item.name.ar);
      expect(html).toContain(`value="${item.id}"`);
    });
  }

  it('binds one select to each of the three kinds', () => {
    for (const kind of ['licenseClass', 'operation', 'insuranceCompany']) {
      expect(source, kind).toContain(`kind="${kind}"`);
    }
  });

  it('labels the three fields, in both locales', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of [
        'fleet.vehicles.fields.licenseClass',
        'fleet.vehicles.fields.operation',
        'fleet.vehicles.fields.insuranceCompany',
      ]) {
        expect(translate(locale, key), `${key} in ${locale}`).not.toBe(key);
      }
    }
  });

  it('marks branch required and drops the "no branch" option entirely', () => {
    expect(source).toContain("label={t('fleet.vehicles.fields.branch')}");
    // The old optional-branch escape hatch must be gone, not merely hidden.
    expect(source).not.toContain('fleet.vehicles.fields.noBranch');
    // Branch joins the completeness gate, so the form cannot submit into a 422.
    expect(source).toContain("form.branchId !== ''");
  });

  it('never invents the default branch id — it comes from the server resolver', () => {
    expect(source).not.toContain('المهندسين');
    expect(source).toContain('useDefaultVehicleBranch');
  });

  it('offers the license-image field with upload and empty-state labels', () => {
    expect(source).toContain('fleet.vehicles.licenseImage.label');
    expect(source).toContain('fleet.vehicles.licenseImage.upload');
    expect(source).toContain('fleet.vehicles.licenseImage.none');
    expect(source).toContain('LICENSE_IMAGE_ACCEPT');
  });
});

// ── 3. The registry table ───────────────────────────────────────────────────

describe('the registry table renders the frozen column order', () => {
  const COLUMNS = [
    'ordinal',
    'type',
    'code',
    'plate',
    'chassis',
    'motor',
    'joinedAt',
    'license',
    'licenseClass',
    'branch',
    'operation',
    'insurance',
    'licenseImage',
    'actions',
  ];

  const withRows = (rows: FleetVehicleDto[], permissions = ALL_PERMISSIONS): string => {
    const client = seededClient();
    client.setQueryData(
      listKey('fleet', 'vehicles', {
        page: 1,
        pageSize: 25,
        sortBy: 'code',
        sortDir: 'asc',
        search: undefined,
        status: undefined,
        typeId: undefined,
        code: undefined,
        plateNumber: undefined,
        chassisNumber: undefined,
        motorNumber: undefined,
        licenseClassId: undefined,
        operationId: undefined,
        insuranceCompanyId: undefined,
        branchId: undefined,
      }),
      page(rows),
    );
    return render(<VehiclesListPage />, { client, permissions });
  };

  it('every column header appears, in order', () => {
    const html = withRows([vehicle()]);
    // Scoped to <thead>: several filter controls carry the same words as their columns ("الفرع"
    // labels both the branch filter and the branch column), and matching the whole document would
    // read the filter bar's position instead of the header's.
    const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
    const positions = COLUMNS.map((key) => {
      const label = t(`fleet.vehicles.columns.${key}`);
      const at = head.indexOf(`>${label}<`);
      expect(at, `${key} header missing`).toBeGreaterThan(-1);
      return at;
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('resolves the three catalog references and the branch to NAMES', () => {
    const html = withRows([vehicle()]);
    expect(html).toContain(CATALOG.licenseClass.name.ar);
    expect(html).toContain(CATALOG.operation.name.ar);
    expect(html).toContain(CATALOG.insuranceCompany.name.ar);
    expect(html).toContain('المهندسين');
    // A resolved reference must never leak its id into the cell.
    expect(html).not.toContain(`>${CATALOG.operation.id}<`);
  });

  // The four identifier boxes each stacked onto their own line in the registry, because the shared
  // `cn` is a plain joiner: the control's base class is `w-full`, so a `w-36` passed beside it
  // never won and every box filled the wrapping bar. The width has to come from a WRAPPER, the way
  // `SearchInput` already does it — and that is a structural fact worth pinning, since the visual
  // symptom is invisible to typecheck and to every other assertion in this file.
  it('gives each identifier filter a width wrapper instead of letting it stretch', () => {
    // The CODE filter is no longer one of these: it became the shared vehicle-code picker, whose
    // trigger sizes to its own content the way every other bar's picker does. The three physical
    // identifiers are still boxes, and still need the wrapper.
    const html = withRows([vehicle()]);
    for (const [label, width] of [
      [t('fleet.vehicles.columns.plate'), 'w-36'],
      [t('fleet.vehicles.columns.chassis'), 'w-40'],
      [t('fleet.vehicles.columns.motor'), 'w-40'],
    ] as const) {
      const at = html.indexOf(`aria-label="${label}"`);
      expect(at, `${label} filter missing`).toBeGreaterThan(-1);
      // The wrapper is the element immediately before this input.
      const wrapper = html.lastIndexOf('<div class="', at);
      const wrapperClass = html.slice(wrapper, html.indexOf('>', wrapper));
      expect(wrapperClass, `${label} has no width wrapper`).toContain(width);
    }
  });

  it('lays every filter out on one wrapping row, identifiers first', () => {
    const html = withRows([vehicle()]);
    // Each control is a direct child of FilterBar's own `flex flex-wrap` bar — no per-filter row,
    // and no group wrapper claiming a line of its own.
    expect(html).toContain('flex flex-wrap items-center gap-2 rounded-lg border');
    expect(html).not.toContain('basis-full');

    const order = [
      t('fleet.vehicles.columns.code'),
      t('fleet.vehicles.columns.plate'),
      t('fleet.vehicles.columns.chassis'),
      t('fleet.vehicles.columns.motor'),
    ].map((label) => html.indexOf(`aria-label="${label}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // Every dropdown follows the last identifier, so reading order matches the intended layout.
    const lastIdentifier = Math.max(...order);
    for (const key of ['make', 'licenseClass', 'operation', 'insurance']) {
      const at = html.indexOf(`aria-label="${t(`fleet.vehicles.filters.${key}`)}"`);
      expect(at, `${key} dropdown missing`).toBeGreaterThan(lastIdentifier);
    }
  });

  it('wraps rather than overflowing on a narrow screen', () => {
    const html = withRows([vehicle()]);
    // The bar itself carries the wrap; nothing inside it pins a row open.
    const bar = html.slice(html.indexOf('flex flex-wrap items-center gap-2'), html.indexOf('<thead>'));
    expect(bar).toContain('flex-wrap');
    expect(bar).not.toContain('flex-nowrap');
  });

  // The combined search box was removed from this screen: the four identifier filters cover the
  // same ground on the server, each one narrowing independently, so a fifth box that only ORed
  // them together was redundant. Asserted as an ABSENCE so it cannot quietly return.
  it('has no combined search box', () => {
    const html = withRows([vehicle()]);
    expect(html).not.toContain(t('fleet.vehicles.searchPlaceholder'));
    expect(html).not.toContain('type="search"');
  });

  it('offers all four catalog filters with their real options', () => {
    const html = withRows([vehicle()]);
    for (const key of ['make', 'licenseClass', 'operation', 'insurance']) {
      expect(html, key).toContain(t(`fleet.vehicles.filters.${key}`));
    }
  });

  it('the license-image cell offers UPLOAD when the vehicle has no scan', () => {
    const html = withRows([vehicle()]);
    expect(html).toContain(t('fleet.vehicles.licenseImage.upload'));
    expect(html).not.toContain(t('fleet.vehicles.licenseImage.view'));
  });

  it('and VIEW + DELETE when it has one', () => {
    const html = withRows([WITH_IMAGE]);
    expect(html).toContain(t('fleet.vehicles.licenseImage.view'));
    expect(html).toContain(t('fleet.vehicles.licenseImage.delete'));
  });

  it('offers neither write action to a reader — the UI mirrors the API grant', () => {
    const html = withRows([WITH_IMAGE], ['fleetVehicle.view']);
    expect(html).toContain(t('fleet.vehicles.licenseImage.view'));
    expect(html).not.toContain(t('fleet.vehicles.licenseImage.delete'));
    expect(html).not.toContain(t('fleet.vehicles.licenseImage.upload'));
  });

  it('numbers the rows from their position in the WHOLE result set', () => {
    const html = withRows([vehicle({ id: 'v1' }), vehicle({ id: 'v2', code: '151' })]);
    expect(html).toContain('>1<');
    expect(html).toContain('>2<');
  });
});

// ── 4. Print (§9) ───────────────────────────────────────────────────────────

describe('the print view carries the image only when there is one', () => {
  const base = {
    title: 'بيانات السيارة',
    subtitle: 'كود العربية: 150 | الماركة: مرسيدس اسبرانتر 515',
    rows: [{ label: 'كود السيارة', value: '150' }],
    locale: 'ar' as Locale,
  };
  const imageMeta = {
    heading: 'صورة رخصة السيارة',
    caption: 'كود العربية: 150 | الماركة: مرسيدس اسبرانتر 515',
    vehicleId: 'v1',
  };

  it('prints the record, the identity line and the rows', () => {
    const html = buildVehiclePrintHtml({ ...base, licenseImage: null }, null);
    expect(html).toContain('بيانات السيارة');
    expect(html).toContain('كود العربية: 150 | الماركة: مرسيدس اسبرانتر 515');
    expect(html).toContain('كود السيارة');
  });

  it('omits the image section entirely when the vehicle has no image', () => {
    const html = buildVehiclePrintHtml({ ...base, licenseImage: null }, null);
    expect(html).not.toContain('<section class="image">');
    expect(html).not.toContain('<img');
  });

  it('omits it just as completely when the bytes failed to load — never an empty section', () => {
    const html = buildVehiclePrintHtml({ ...base, licenseImage: imageMeta }, null);
    expect(html).not.toContain('<section class="image">');
  });

  it('includes heading, caption and the inlined image when there is one', () => {
    const html = buildVehiclePrintHtml(
      { ...base, licenseImage: imageMeta },
      'data:image/jpeg;base64,AAAA',
    );
    expect(html).toContain('<section class="image">');
    expect(html).toContain('صورة رخصة السيارة');
    expect(html).toContain('كود العربية: 150 | الماركة: مرسيدس اسبرانتر 515');
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
  });

  it('escapes vehicle text — a plate is data, never markup', () => {
    const html = buildVehiclePrintHtml(
      {
        ...base,
        rows: [{ label: 'x', value: '<script>alert(1)</script>' }],
        licenseImage: null,
      },
      null,
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sets the document direction from the locale', () => {
    expect(buildVehiclePrintHtml({ ...base, licenseImage: null }, null)).toContain('dir="rtl"');
    expect(
      buildVehiclePrintHtml({ ...base, locale: 'en', licenseImage: null }, null),
    ).toContain('dir="ltr"');
  });
});

// ── 5. i18n coverage ────────────────────────────────────────────────────────

describe('every literal fleet key the module uses resolves in both locales', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.') ? [full] : [];
    });

  const keys = (() => {
    const found = new Set<string>();
    for (const file of sources(HERE)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'(fleet\.[a-zA-Z0-9_.]+)'/g)) {
        if (match[1] !== undefined) found.add(match[1]);
      }
    }
    return [...found].sort();
  })();

  it('the scan finds keys at all', () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`resolves all of them — ${locale}`, () => {
      expect(keys.filter((key) => translate(locale, key) === key)).toEqual([]);
    });
  }
});
