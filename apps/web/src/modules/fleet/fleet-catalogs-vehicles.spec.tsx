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

describe('the drivers registry’s three catalogs are managed here too', () => {
  const DRIVER_KINDS = ['driverJob', 'driverSpecialization', 'driverLicenseType'] as const;

  it('are first-class kinds, so the admin screen picks them up with no code of their own', () => {
    // The whole reason «الوظيفة / التخصص / الرخصة» are catalogs: adding a value is data. Being
    // members of the enum is what gets them a tab, a create form, an edit action and an archive
    // switch without a line of screen code naming them.
    for (const kind of DRIVER_KINDS) expect(FLEET_CATALOG_KINDS).toContain(kind);
  });

  it('each gets its own tab, in both locales', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      const markup = render(<CatalogsPage />, { route: '/fleet/catalogs', locale });
      for (const kind of DRIVER_KINDS) {
        const label = translate(locale, `fleet.catalogs.kind.${kind}`);
        expect(label, `${kind} in ${locale}`).not.toBe(`fleet.catalogs.kind.${kind}`);
        expect(markup, `${kind} tab in ${locale}`).toContain(label);
      }
    }
  });

  it('the DRIVER FORM’s three controls offer the catalog’s own rows', () => {
    // The dialog itself renders through `createPortal(..., document.body)` and this suite carries
    // no jsdom, so the claim is made against the exact component the form mounts — the same
    // `CatalogSelect`, of the same kind, reading the same cache the filter bar reads. That is
    // what «Catalog = form = filter» means in practice: one list, three places, no third copy.
    const rows = {
      driverJob: [
        { id: 'j1', ar: 'سائق أ' },
        { id: 'j2', ar: 'سائق صراف الى' },
      ],
      driverSpecialization: [
        { id: 's1', ar: 'نقل اموال' },
        { id: 's2', ar: 'سزوكى' },
      ],
      driverLicenseType: [
        { id: 'l1', ar: 'اولى' },
        { id: 'l2', ar: 'تانيه' },
      ],
    } as const;
    for (const [kind, items] of Object.entries(rows)) {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      qc.setQueryData(
        listKey('fleet', 'catalogs', { kind, violationSide: undefined }),
        page(items.map((i) => catalogItem(kind, i.id, { ar: i.ar, en: i.ar }))),
      );
      const markup = render(
        <CatalogSelect
          kind={kind as never}
          value=""
          onChange={() => undefined}
          ariaLabel={kind}
        />,
        { client: qc },
      );
      for (const item of items) {
        expect(markup, `${kind} offers ${item.ar}`).toContain(
          `<option value="${item.id}">${item.ar}</option>`,
        );
      }
      // Nothing else: the control has no vocabulary of its own to add to the catalog's.
      expect(markup.match(/<option/g), `${kind} offers only the catalog + the empty row`).toHaveLength(
        items.length + 1,
      );
    }
  });

  it('a value the admin ADDS is offered by that same control, with no release', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(
      listKey('fleet', 'catalogs', { kind: 'driverJob', violationSide: undefined }),
      page([
        catalogItem('driverJob', 'j1', { ar: 'سائق أ', en: 'Driver A' }),
        catalogItem('driverJob', 'j9', { ar: 'سائق مدرّب', en: 'Trainer' }),
      ]),
    );
    const markup = render(
      <CatalogSelect kind="driverJob" value="" onChange={() => undefined} ariaLabel="الوظيفة" />,
      { client: qc },
    );
    expect(markup).toContain('<option value="j9">سائق مدرّب</option>');
  });

  it('an ARCHIVED value stays visible while a profile still points at it', () => {
    // Archiving is how a catalog value retires here — the rows that reference it must keep
    // naming it, or a driver's grade would silently become a dash.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(
      listKey('fleet', 'catalogs', { kind: 'driverSpecialization', violationSide: undefined }),
      page([
        { ...catalogItem('driverSpecialization', 's1', { ar: 'نقل اموال', en: 'Cash' }) },
        { ...catalogItem('driverSpecialization', 's9', { ar: 'تخصص متقاعد', en: 'Retired' }), isActive: false },
      ]),
    );
    const chosen = render(
      <CatalogSelect
        kind="driverSpecialization"
        value="s9"
        onChange={() => undefined}
        ariaLabel="التخصص"
      />,
      { client: qc },
    );
    expect(chosen, 'the archived value a profile points at').toContain('تخصص متقاعد');
    const fresh = render(
      <CatalogSelect
        kind="driverSpecialization"
        value=""
        onChange={() => undefined}
        ariaLabel="التخصص"
      />,
      { client: qc },
    );
    expect(fresh, 'but it is not on offer to a new record').not.toContain('تخصص متقاعد');
  });

  it('opening one selects THAT tab and offers the add action for it', () => {
    const markup = render(<CatalogsPage />, { route: '/fleet/catalogs?kind=driverJob' });
    // The selected tab is the one asked for, and only it — the tab bar reads the URL.
    const selected = markup.split('aria-selected="true"')[1] ?? '';
    expect(selected, 'the driverJob tab is the selected one').toContain(
      t('fleet.catalogs.kind.driverJob'),
    );
    expect(
      markup.split('aria-selected="true"').length - 1,
      'exactly one tab is selected',
    ).toBe(1);
    expect(markup, 'and the add action names the kind').toContain(
      translate('ar', 'fleet.catalogs.addItem', { kind: t('fleet.catalogs.kind.driverJob') }),
    );
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

  it('a DISPOSED car can still be brought back — the status action is offered on its row', () => {
    // REGRESSION, and a rule the owner changed rather than a bug: disposal used to be terminal and
    // this button was hidden for it, so a car keyed as disposed by mistake was disposed for good
    // and the only way back was a database edit. «مكهنة لازم ترجع نشطة تاني».
    const html = withRows([vehicle({ id: 'v-gone', status: 'disposed' })]);
    expect(html, 'the status action is there').toContain(t('fleet.vehicles.changeStatus'));
    // The record itself is still frozen while the car is out of the fleet — the way to EDIT one
    // is to return it first, which is now possible. That half is unchanged on purpose.
    const row = html.slice(html.indexOf('v-gone'));
    expect(row.slice(0, 4000), 'and editing it is still not offered').not.toContain(
      t('fleet.vehicles.edit'),
    );
  });

  it('and the dialog offers «نشطة» as the way out of «مكهنة», and only that', () => {
    const dialog = readFileSync(join(HERE, 'components/VehicleStatusDialog.tsx'), 'utf8');
    const code = dialog.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code, 'a disposed car has a way out').toMatch(/disposed: \['active'\]/);
    expect(code, 'and it is not the empty table any more').not.toMatch(/disposed: \[\]/);
  });

  it('the disposal warning no longer promises something untrue', () => {
    // It used to read «التكهين نهائي: السيارة المكهنة لا تُعدل ولا تعود للخدمة.» Half of that is
    // still true (it is not edited) and half is not (it does come back), and a warning that is
    // half wrong is worse than none. It also now says the thing the owner cared about most:
    // disposal deletes nothing.
    for (const locale of ['ar', 'en'] as const) {
      const warning = translate(locale, 'fleet.vehicles.disposedWarning');
      expect(warning, `${locale}: no longer claims it is final`).not.toMatch(/نهائي|final/i);
      expect(warning, `${locale}: says nothing is deleted`).toMatch(/مش بيمسح|deletes nothing/i);
    }
  });

  it('a disposed car’s licence scan can still be DELETED — the server always allowed it', () => {
    // The cell folded upload and delete into one `mayEdit` flag gated on the status. Upload is
    // genuinely refused by the API for a disposed car; delete is not — `deleteLicenseImage` has no
    // writability check and answers 200 — so the screen was hiding a control the server would have
    // served. The comment that used to sit there asserted the opposite, which is how it survived.
    const cell = readFileSync(join(HERE, 'components/VehicleLicenseImage.tsx'), 'utf8');
    const code = cell.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code, 'upload still respects the status').toMatch(
      /mayUpload = can\('fleetVehicle.edit'\) && vehicle.status !== 'disposed'/,
    );
    expect(code, 'delete asks only about the permission').toMatch(
      /mayDelete = can\('fleetVehicle.edit'\);/,
    );
    expect(code, 'and the two are no longer one flag').not.toContain('const mayEdit =');

    const html = withRows([
      vehicle({
        id: 'v-scan',
        status: 'disposed',
        licenseImage: WITH_IMAGE.licenseImage,
      }),
    ]);
    expect(html, 'the delete is on the row').toContain('data-vehicle-license-delete="v-scan"');
  });

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
    // The document carries HOW to get the bytes, not which registry holds them — a driver's
    // licence prints from the same builder. The builder itself never calls it: it is handed the
    // resolved data URL, which is what makes it testable at all.
    fetch: (): Promise<Blob> => Promise.resolve(new Blob()),
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

// ── a form dialog is not dismissed by a stray click ─────────────────────────
//
// «لو دوست في اى حته الموديل ميتقفلش غير لما ادوس على الاكس». `Dialog` closed on any click
// outside its panel, so a half-filled reading or check-in vanished with nothing to undo it.
// Reproduced in Chromium before the fix: the panel was gone after one click on the backdrop.
describe('the Fleet form dialogs survive a click outside them', () => {
  const HERE_DIR = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string): string => readFileSync(join(HERE_DIR, rel), 'utf8');
  const DIALOG = readFileSync(join(HERE_DIR, '../../shared/ui/Dialog.tsx'), 'utf8');

  it('the shared dialog lets each caller decide', () => {
    expect(DIALOG, 'the option exists').toContain('dismissOnOutsideClick');
    expect(DIALOG, 'and it gates the listener').toContain(
      'useOnClickOutside(panelRef, onClose, open && dismissOnOutsideClick)',
    );
  });

  it('and still closes on Escape, which is a decision rather than a slip', () => {
    expect(DIALOG).toContain("if (e.key === 'Escape') onClose()");
  });

  it('the reading dialog turns it off', () => {
    expect(read('components/RecordOdometerDialog.tsx')).toContain('dismissOnOutsideClick={false}');
  });

  it('so do all three workshop dialogs — in, out, and the edit', () => {
    const source = read('components/MaintenanceDialogs.tsx');
    expect(source.split('dismissOnOutsideClick={false}')).toHaveLength(4);
  });

  it('the default is untouched, so no other module′s dialogs change', () => {
    // The same trap sits under every other module's forms. That is their call, not a change to
    // make on the way past.
    expect(DIALOG).toContain('dismissOnOutsideClick = true');
  });
});

// ── «مين السائق؟» is asked of the drivers registry, never of the payroll ────
//
// Five driver slots searched every employee in the company and showed nothing until a letter was
// typed — so the control offered colleagues who are not drivers, and clearing a name left an empty
// box with no way to discover who could go in it. The violations screen met both halves of this
// and answered them with `RegistryDriverPicker`; this is the same swap at the places that still
// had the payroll box.
describe('the odometer and workshop driver slots ask the registry', () => {
  const HERE_DIR = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string): string => readFileSync(join(HERE_DIR, rel), 'utf8');

  it('the field reaches for the registry picker', () => {
    const field = read('components/OptionalDriverField.tsx');
    expect(field).toContain('RegistryDriverPicker');
    expect(field, 'not the payroll search box').not.toContain('EmployeeSearchPicker');
  });

  it('the payroll-backed field is gone from the module', () => {
    for (const rel of ['components/RecordOdometerDialog.tsx', 'components/MaintenanceDialogs.tsx']) {
      expect(read(rel), `${rel} still imports the payroll field`).not.toContain(
        'OptionalEmployeeField',
      );
    }
  });

  it('both odometer seats and all three workshop slots use it', () => {
    expect(read('components/RecordOdometerDialog.tsx').split('<OptionalDriverField')).toHaveLength(
      3,
    );
    expect(read('components/MaintenanceDialogs.tsx').split('<OptionalDriverField')).toHaveLength(4);
  });

  it('the seat stays OPTIONAL — a reading with nobody named is a real state', () => {
    const field = read('components/OptionalDriverField.tsx');
    expect(field, 'clearing it is offered').toContain("onChange('')");
  });
});
