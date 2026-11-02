// The screens a fleet-dashboard figure links to READ the link (plan P1-09, §5.7, D10, R-02).
//
// A figure equals its link only if the screen behind it asks the server the same question the
// dashboard counted. So for every parameter the dashboard sends, each case below renders the screen
// at that address and seeds the cache ONLY under the key carrying the parameter's API field: a
// screen that dropped it, renamed it, or sent the bare day instead of the day's last instant looks
// up a different key and paints no row, and the case fails. (No DOM here, so nothing is clicked;
// the request is the proof, as in `fleet-multi-filters.spec.tsx`.)
//
// Also pinned per screen: the parameter is in its `REMEMBERED_FILTERS` beside its other filters,
// it is read in the page's OWN source (where the remembered-filters census and the dashboard's link
// census look), and a narrowing a link set is SHOWN on the bar so it can be taken off.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FleetSettingKeys,
  MAX_PAGE_SIZE,
  calendarDayBounds,
  paperStage as contractsPaperStage,
  type FleetAccidentDto,
  type FleetDealershipInvoiceDto,
  type FleetDriverProfileDto,
  type FleetFuelCardDto,
  type FleetLicensingRowDto,
  type FleetReceiptDto,
  type FleetVehicleDto,
  type FleetViolationDto,
  type FleetViolationRollupDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../../platform/localization/i18n';
import { listKey } from '../../shared/lib/query-keys';
import { VehiclesListPage } from './pages/VehiclesListPage';
import { DriversListPage } from './pages/DriversListPage';
import { FuelCardsPage } from './pages/FuelCardsPage';
import { AccidentsPage } from './pages/AccidentsPage';
import { DealershipPage } from './pages/DealershipPage';
import { ReceiptsPage } from './pages/ReceiptsPage';
import { ViolationsPage } from './pages/ViolationsPage';
import { paperStage } from './pages/LicensingPage';

// The fuel-card board's dialogs portal into `document.body`, which this suite has no DOM for.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (page: string): string => readFileSync(join(HERE, 'pages', page), 'utf8');
const ar = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

/** What a screen declared, read out of its own `REMEMBERED_FILTERS` — the census's own reading. */
const remembered = (page: string): string[] => {
  const block = /const REMEMBERED_FILTERS = \[([^\]]*)\] as const;/.exec(source(page));
  return block === null ? [] : [...(block[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
};

/** Read in the page's own source, the two ways the censuses recognise. */
const readsInSource = (page: string, param: string): boolean =>
  source(page).includes(`sp.get('${param}')`) || source(page).includes(`readList(sp, '${param}')`);

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u-1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  }) as unknown as MeDto;

const client = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });

const mount = (
  qc: QueryClient,
  permissions: readonly string[],
  route: string,
  pattern: string,
  page: JSX.Element,
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={pattern} element={page} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const paged = <T,>(items: T[], pageSize = 25) => ({
  items,
  meta: { page: 1, pageSize, totalItems: items.length, totalPages: 1 },
});
const tbody = (html: string): string =>
  html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));

/** The R-02 bounds of the named days — the ONE rule the dashboard counts with. */
const firstInstant = (ymd: string): string => calendarDayBounds(ymd, ymd).from.toISOString();
const lastInstant = (ymd: string): string => calendarDayBounds(ymd, ymd).before.toISOString();

const TODAY = '2026-11-01';

// ── /fleet/vehicles — T1.2, T4.1–T4.3 ───────────────────────────────────────

const vehicle = (over: Partial<FleetVehicleDto> = {}): FleetVehicleDto => ({
  id: 'v1',
  code: '150',
  typeId: 'ty1',
  plateNumber: 'س ص 150',
  chassisNumber: 'CH-150',
  motorNumber: 'MO-150',
  joinedAt: '2024-01-01T00:00:00.000Z',
  licenseExpiresAt: '2026-11-01T10:00:00.000Z',
  licenseClassId: null,
  operationId: null,
  insuranceCompanyId: null,
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
  ...over,
});

const vehiclesAt = (route: string, key: Record<string, unknown>): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'vehicles', {
      page: 1,
      pageSize: 25,
      sortBy: 'code',
      sortDir: 'asc',
      sort: 'code:asc',
      ...key,
    }),
    paged([vehicle()]),
  );
  return mount(qc, ['fleetVehicle.view'], route, '/fleet/vehicles', <VehiclesListPage />);
};

describe('/fleet/vehicles reads the licence window in days', () => {
  it('asks for the licences expired TODAY up to the day’s last instant (licExpBefore)', () => {
    const html = vehiclesAt(`/fleet/vehicles?status=active&licExpBefore=${TODAY}`, {
      status: ['active'],
      licenseExpiresBefore: lastInstant(TODAY),
    });
    expect(tbody(html), 'a licence stamped 10:00 on its expiry day is in the list').toContain(
      '150',
    );
  });

  it('asks for a window from its first day’s first instant (licExpFrom + licExpBefore)', () => {
    const html = vehiclesAt(
      '/fleet/vehicles?status=active&licExpFrom=2026-11-02&licExpBefore=2026-12-01',
      {
        status: ['active'],
        licenseExpiresFrom: firstInstant('2026-11-02'),
        licenseExpiresBefore: lastInstant('2026-12-01'),
      },
    );
    expect(tbody(html)).toContain('150');
  });

  it('does not answer a windowed address from the un-windowed list', () => {
    // The control: the same address, the cache seeded WITHOUT the bound — no row.
    const html = vehiclesAt(`/fleet/vehicles?status=active&licExpBefore=${TODAY}`, {
      status: ['active'],
    });
    expect(tbody(html)).not.toContain('150');
  });

  it('shows the window on the bar while it narrows, and not otherwise', () => {
    const narrowed = vehiclesAt(`/fleet/vehicles?licExpBefore=${TODAY}`, {
      licenseExpiresBefore: lastInstant(TODAY),
    });
    expect(narrowed).toContain(ar('fleet.filters.expiryWindow.until', { to: '2026/11/01' }));
    expect(vehiclesAt('/fleet/vehicles', {})).not.toContain(
      ar('fleet.filters.expiryWindow.until', { to: '2026/11/01' }),
    );
  });

  it('remembers both bounds and reads them in its own source', () => {
    for (const param of ['licExpFrom', 'licExpBefore']) {
      expect(remembered('VehiclesListPage.tsx')).toContain(param);
      expect(readsInSource('VehiclesListPage.tsx', param), param).toBe(true);
    }
  });
});

// ── /fleet/drivers — T1.3, T4.5 ─────────────────────────────────────────────

const driver = (over: Partial<FleetDriverProfileDto> = {}): FleetDriverProfileDto => ({
  id: 'd1',
  employeeId: 'e1',
  licenseNumber: 'DL-4471',
  licenseExpiresAt: '2026-10-20T00:00:00.000Z',
  jobId: null,
  specializationId: null,
  licenseTypeId: null,
  specialization: null,
  area: null,
  isActive: true,
  licenseImage: null,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const driversAt = (route: string, key: Record<string, unknown>): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'drivers', {
      page: 1,
      pageSize: 25,
      sortBy: 'employeeCode',
      sortDir: 'asc',
      sort: 'employeeCode:asc',
      ...key,
    }),
    paged([{ employeeId: 'e1', profile: driver() }]),
  );
  qc.setQueryData(['fleet', 'people'], []);
  qc.setQueryData(['organization', 'branches', 'options'], []);
  return mount(qc, ['fleetDriver.view'], route, '/fleet/drivers', <DriversListPage />);
};

describe('/fleet/drivers reads the licence window and «بلا تاريخ»', () => {
  it('asks for the licences expired today, up to the day’s last instant', () => {
    const html = driversAt(`/fleet/drivers?licExpBefore=${TODAY}`, {
      licenseExpiresBefore: lastInstant(TODAY),
    });
    expect(tbody(html)).toContain('2026/10/20');
  });

  it('asks for a window with both bounds, beside the branch the dashboard carries', () => {
    const html = driversAt(
      '/fleet/drivers?licExpFrom=2026-11-02&licExpBefore=2026-12-01&branch=b1',
      {
        licenseExpiresFrom: firstInstant('2026-11-02'),
        licenseExpiresBefore: lastInstant('2026-12-01'),
        branchId: ['b1'],
      },
    );
    expect(tbody(html)).toContain('2026/10/20');
  });

  it('asks for the profiles with no expiry recorded (licExp=none → licenseNotRecorded)', () => {
    const html = driversAt('/fleet/drivers?licExp=none', { licenseNotRecorded: true });
    expect(tbody(html)).toContain('2026/10/20');
    expect(html, 'and says so on the bar').toContain(ar('fleet.drivers.notRecorded'));
  });

  it('does not answer a windowed address from the un-windowed list', () => {
    expect(tbody(driversAt(`/fleet/drivers?licExpBefore=${TODAY}`, {}))).not.toContain(
      '2026/10/20',
    );
  });

  it('shows the window on the bar while it narrows', () => {
    const html = driversAt('/fleet/drivers?licExpFrom=2026-11-02&licExpBefore=2026-12-01', {
      licenseExpiresFrom: firstInstant('2026-11-02'),
      licenseExpiresBefore: lastInstant('2026-12-01'),
    });
    expect(html).toContain(
      ar('fleet.filters.expiryWindow.between', { from: '2026/11/02', to: '2026/12/01' }),
    );
  });

  it('remembers all three and reads them in its own source', () => {
    for (const param of ['licExpFrom', 'licExpBefore', 'licExp']) {
      expect(remembered('DriversListPage.tsx')).toContain(param);
      expect(readsInSource('DriversListPage.tsx', param), param).toBe(true);
    }
  });
});

// ── /fleet/fuel-cards — T1.4, T4.7 ──────────────────────────────────────────

const card = (over: Partial<FleetFuelCardDto> = {}): FleetFuelCardDto => ({
  id: 'c-1',
  vehicleId: 'v-204',
  vehicleCode: '204',
  label: null,
  company: 'wataniya',
  name: 'كارت وطنية 204',
  number: '7045 1120 0098 2231',
  expiresAt: '2026-11-20T00:00:00.000Z',
  hasPassword: true,
  balance: 640,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const fuelCardsAt = (route: string, key: Record<string, unknown>): string => {
  const qc = client();
  qc.setQueryData(listKey('fleet', 'fuelCards', { whole: true, ...key }), paged([card()], 100));
  qc.setQueryData(
    ['settings', 'me'],
    [{ key: FleetSettingKeys.FuelCardExpiryWarnDays, value: 30, resolvedFrom: 'default' }],
  );
  return mount(qc, ['fleetFuelCard.view'], route, '/fleet/fuel-cards', <FuelCardsPage />);
};

describe('/fleet/fuel-cards reads both expiry bounds as days', () => {
  it('asks «expired» up to the LAST instant of the day named (expiresBefore)', () => {
    const html = fuelCardsAt(`/fleet/fuel-cards?expiresBefore=${TODAY}`, {
      expiresBefore: lastInstant(TODAY),
    });
    expect(html).toContain('data-fuel-line="wataniya"');
  });

  it('asks «expiring» from tomorrow’s first instant (expiresFrom), so expired cards stay out', () => {
    const html = fuelCardsAt('/fleet/fuel-cards?expiresFrom=2026-11-02&expiresBefore=2026-12-01', {
      expiresFrom: firstInstant('2026-11-02'),
      expiresBefore: lastInstant('2026-12-01'),
    });
    expect(html).toContain('data-fuel-line="wataniya"');
    expect(html, 'both bounds are on the bar, to see and to change').toContain(
      'data-fuel-expires-from="true"',
    );
    expect(html).toContain('value="2026-11-02"');
  });

  it('does not answer a windowed address from the bare-day request it used to send', () => {
    const html = fuelCardsAt(`/fleet/fuel-cards?expiresBefore=${TODAY}`, { expiresBefore: TODAY });
    expect(html).not.toContain('data-fuel-line="wataniya"');
  });

  it('remembers both bounds and reads them in its own source', () => {
    for (const param of ['expiresFrom', 'expiresBefore']) {
      expect(remembered('FuelCardsPage.tsx')).toContain(param);
      expect(readsInSource('FuelCardsPage.tsx', param), param).toBe(true);
    }
  });
});

// ── The vehicle set — accidents, dealership, receipts (D10) ─────────────────

const SET_ROUTE = 'type=ty1,ty2&operation=op1&branch=b1';
const SET_QUERY = { typeIds: ['ty1', 'ty2'], operationIds: ['op1'], branchIds: ['b1'] };

const accident = (over: Partial<FleetAccidentDto> = {}): FleetAccidentDto => ({
  id: 'a-1',
  vehicleId: 'v-1',
  vehicleCode: '150',
  occurredAt: '2026-10-09T00:00:00.000Z',
  culpritEmployeeId: null,
  culpritEmployeeIds: [],
  culprit: 'طرف آخر',
  statement: 'خبطة في الباب الخلفي',
  companyCost: 0,
  amountCollected: 0,
  paidAmount: 0,
  transferredIn: 0,
  transferredOut: 0,
  carHasTransfers: false,
  status: 'open',
  notes: null,
  version: 0,
  createdAt: '2026-10-09T00:00:00.000Z',
  updatedAt: '2026-10-09T00:00:00.000Z',
  ...over,
});

const accidentsAt = (
  route: string,
  filters: Record<string, unknown>,
  extraKeys: readonly string[] = [],
): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'accidents', {
      ...filters,
      page: 1,
      pageSize: 25,
      sortBy: 'occurredAt',
      sortDir: 'desc',
      sort: 'occurredAt:desc',
    }),
    paged([accident()]),
  );
  return mount(
    qc,
    ['fleetAccident.view', ...extraKeys],
    route,
    '/fleet/accidents',
    <AccidentsPage />,
  );
};

const dealershipRow = (
  over: Partial<FleetDealershipInvoiceDto> = {},
): FleetDealershipInvoiceDto => ({
  id: 'd-1',
  visitId: 'm-1',
  vehicleId: 'v-1',
  vehicleCode: '987',
  outDate: '2026-10-01T00:00:00.000Z',
  workKind: 'maintenance',
  workTypeLabel: 'صيانة',
  privateCar: false,
  insuranceCompanyId: null,
  insuranceCompanyName: null,
  vehicleInsuranceCompanyId: null,
  vehicleInsuranceCompanyName: null,
  vehicleInsuranceCompanyActive: false,
  invoiceNumber: null,
  invoiceAmount: null,
  image: null,
  side: null,
  pending: true,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const dealershipAt = (
  route: string,
  filters: Record<string, unknown>,
  extraKeys: readonly string[] = [],
): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'dealership', {
      ...filters,
      page: 1,
      pageSize: 25,
      sortBy: 'outDate',
      sortDir: 'desc',
      sort: 'outDate:desc',
    }),
    paged([dealershipRow()]),
  );
  return mount(
    qc,
    ['fleetDealership.view', ...extraKeys],
    route,
    '/fleet/dealership',
    <DealershipPage />,
  );
};

const receipt = (over: Partial<FleetReceiptDto> = {}): FleetReceiptDto => ({
  id: 'r-1',
  date: '2026-11-01T00:00:00.000Z',
  vehicleId: 'v-204',
  vehicleCode: '204',
  driverEmployeeId: null,
  driverName: 'سائق الإيصال المفلتر',
  kind: 'fuel',
  source: 'card',
  cardId: 'c-1',
  cardCompany: 'wataniya',
  cardNumber: '7045 1120 0098 2231',
  cardVehicleId: 'v-204',
  cardVehicleCode: '204',
  cardLabel: null,
  fuelType: 'petrol92',
  pricePerLitre: 17.25,
  litres: 37.1,
  amount: 640,
  odometer: null,
  company: null,
  image: null,
  memo: null,
  version: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

const receiptsAt = (
  route: string,
  filters: Record<string, unknown>,
  extraKeys: readonly string[] = [],
): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'receipts', {
      ...filters,
      page: 1,
      pageSize: 25,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
    }),
    paged([receipt()]),
  );
  return mount(qc, ['fleetReceipt.view', ...extraKeys], route, '/fleet/receipts', <ReceiptsPage />);
};

describe('the period screens read the vehicle set — type, operation, branch', () => {
  it('/fleet/accidents sends it with the period (T6.5, T10.2)', () => {
    const html = accidentsAt(`/fleet/accidents?from=2026-10-01&to=2026-10-31&${SET_ROUTE}`, {
      from: '2026-10-01',
      to: '2026-10-31',
      ...SET_QUERY,
    });
    expect(tbody(html)).toContain('خبطة في الباب الخلفي');
  });

  it('/fleet/accidents sends a branch alone with «open» (T5.10)', () => {
    const html = accidentsAt('/fleet/accidents?status=open&branch=b1', {
      status: 'open',
      branchIds: ['b1'],
    });
    expect(tbody(html)).toContain('خبطة في الباب الخلفي');
  });

  it('/fleet/dealership sends it with «pending» (T1.9) and with the period (T6.9)', () => {
    expect(
      tbody(
        dealershipAt('/fleet/dealership?state=pending&branch=b1', {
          pending: true,
          branchIds: ['b1'],
        }),
      ),
    ).toContain('987');
    expect(
      tbody(
        dealershipAt(`/fleet/dealership?from=2026-10-01&to=2026-10-31&${SET_ROUTE}`, {
          from: '2026-10-01',
          to: '2026-10-31',
          ...SET_QUERY,
        }),
      ),
    ).toContain('987');
  });

  it('/fleet/receipts sends it with the period and the source (T6.7, D20)', () => {
    const html = receiptsAt(
      `/fleet/receipts?source=card&from=2026-11-01&to=2026-11-30&${SET_ROUTE}`,
      {
        source: 'card',
        from: '2026-11-01',
        to: '2026-11-30',
        ...SET_QUERY,
      },
    );
    expect(tbody(html)).toContain('سائق الإيصال المفلتر');
  });

  it('does not answer a narrowed address from the un-narrowed list', () => {
    expect(tbody(accidentsAt(`/fleet/accidents?${SET_ROUTE}`, {}))).not.toContain(
      'خبطة في الباب الخلفي',
    );
    expect(tbody(dealershipAt(`/fleet/dealership?${SET_ROUTE}`, {}))).not.toContain('987');
    expect(tbody(receiptsAt(`/fleet/receipts?${SET_ROUTE}`, {}))).not.toContain(
      'سائق الإيصال المفلتر',
    );
  });

  it('shows the three controls while the set narrows, and only then', () => {
    const make = ar('fleet.vehicles.filters.short.make');
    const operation = ar('fleet.vehicles.filters.short.operation');
    const branch = ar('recruitment.filters.branch');
    // A reader who may read the types list and the operations catalog (fleetVehicle.view).
    const registry = ['fleetVehicle.view'];
    for (const [name, narrowed, plain] of [
      [
        'accidents',
        accidentsAt(`/fleet/accidents?${SET_ROUTE}`, SET_QUERY, registry),
        accidentsAt('/fleet/accidents', {}, registry),
      ],
      [
        'dealership',
        dealershipAt(`/fleet/dealership?${SET_ROUTE}`, SET_QUERY, registry),
        dealershipAt('/fleet/dealership', {}, registry),
      ],
      [
        'receipts',
        receiptsAt(`/fleet/receipts?${SET_ROUTE}`, SET_QUERY, registry),
        receiptsAt('/fleet/receipts', {}, registry),
      ],
    ] as const) {
      for (const label of [make, operation, branch]) {
        expect(narrowed, `${name}: ${label} is on the bar`).toContain(label);
      }
      expect(plain, `${name}: no operation control on an ordinary visit`).not.toContain(operation);
    }
  });

  it('without the types list’s and the catalog’s own guards: nameless, removable chips — no 403s', () => {
    // The screen's own key opens neither GET /fleet/vehicle-types nor the operations catalog, so
    // the named controls are not drawn (their hooks never ask); the narrowing still shows.
    for (const [name, html] of [
      ['accidents', accidentsAt(`/fleet/accidents?${SET_ROUTE}`, SET_QUERY)],
      ['dealership', dealershipAt(`/fleet/dealership?${SET_ROUTE}`, SET_QUERY)],
      ['receipts', receiptsAt(`/fleet/receipts?${SET_ROUTE}`, SET_QUERY)],
    ] as const) {
      expect(html, `${name}: no make control`).not.toContain(
        ar('fleet.vehicles.filters.short.make'),
      );
      expect(html, `${name}: the type chip`).toContain('data-vehicle-set-chip="type"');
      expect(html, `${name}: the operation chip`).toContain('data-vehicle-set-chip="operation"');
      expect(html).toContain(ar('fleet.dash.filters.someTypes'));
      expect(html).toContain(ar('fleet.dash.filters.someOperations'));
    }
  });

  it('lets the accidents bar wrap while the set is shown — its one row was measured without it', () => {
    expect(accidentsAt('/fleet/accidents', {})).toContain('min-[1536px]:flex-nowrap');
    expect(accidentsAt(`/fleet/accidents?${SET_ROUTE}`, SET_QUERY)).not.toContain(
      'min-[1536px]:flex-nowrap',
    );
  });

  it('remembers the set with each screen’s other filters, and reads it in its own source', () => {
    for (const page of [
      'AccidentsPage.tsx',
      'DealershipPage.tsx',
      'ReceiptsPage.tsx',
      'ViolationsPage.tsx',
    ]) {
      for (const param of ['type', 'operation', 'branch']) {
        expect(remembered(page), `${page} remembers ${param}`).toContain(param);
        expect(readsInSource(page, param), `${page} reads ${param}`).toBe(true);
      }
    }
  });
});

// ── /fleet/violations — T5.11, T5.12 ────────────────────────────────────────

const rollupRow = (over: Partial<FleetViolationRollupDto> = {}): FleetViolationRollupDto => ({
  vehicleId: 'v1',
  code: '168',
  year: 2026,
  vehicleCount: 4,
  vehicleAmount: 2040.15,
  driverCount: 0,
  driverAmount: 0,
  totalCount: 4,
  totalAmount: 2040.15,
  outstandingVehicleAmount: 2040.15,
  outstandingDriverAmount: 0,
  outstandingTotalAmount: 2040.15,
  outstandingVehicleCount: 4,
  outstandingDriverCount: 0,
  outstandingTotalCount: 4,
  rowCount: 4,
  collectedCount: 0,
  totalBeforeGrievance: 0,
  ...over,
});

const fine = (over: Partial<FleetViolationDto> = {}): FleetViolationDto => ({
  id: 'vio-1',
  kind: 'driver',
  vehicleId: null,
  vehicleCode: '733',
  violationTypeId: 'dt-1',
  amount: 400,
  year: null,
  count: null,
  unitValue: null,
  date: '2026-02-01T00:00:00.000Z',
  filedYear: null,
  homeVehicleId: null,
  driverEmployeeId: null,
  driverName: null,
  collected: false,
  fromOldBook: false,
  version: 0,
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  ...over,
});

const violationsAt = (
  route: string,
  {
    rollup = {},
    drivers = {},
  }: { rollup?: Record<string, string>; drivers?: Record<string, unknown> },
): string => {
  const qc = client();
  qc.setQueryData(
    ['fleet', 'violations', 'rollup', { year: '2026', vehicleCodes: '', ...rollup }],
    [rollupRow()],
  );
  qc.setQueryData(
    listKey('fleet', 'violations', {
      kind: 'driver',
      pageSize: MAX_PAGE_SIZE,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
      ...drivers,
      paged: 'infinite',
    }),
    { pages: [paged([fine()], MAX_PAGE_SIZE)], pageParams: [1] },
  );
  return mount(qc, ['fleetViolation.view'], route, '/fleet/violations', <ViolationsPage />);
};

/** The two halves, by the order they are drawn in: the company first, the drivers second. */
const halves = (html: string): { company: string; drivers: string } => {
  const split = html.indexOf('data-violations-split="true"');
  const body = html.slice(split);
  const second = body.indexOf('<section', body.indexOf('<section') + 1);
  return { company: body.slice(0, second), drivers: body.slice(second) };
};

describe('/fleet/violations reads «مجهول» and the vehicle set', () => {
  it('asks the drivers’ ledger for the fines with nobody named (dunknown → unknownDriver)', () => {
    const html = violationsAt('/fleet/violations?year=2026&dunknown=true&dset=false', {
      drivers: { unknownDriver: 'true', collected: false },
    });
    expect(halves(html).drivers, 'the seeded fine is on the board').toContain('733');
  });

  it('asks the drivers’ ledger for the dashboard’s YEAR only (dyear → year), shown as its chip', () => {
    // The figure counts the Cairo year's unpaid fines; the link must list that year, not every one.
    const html = violationsAt('/fleet/violations?year=2026&dyear=2026&dunknown=true&dset=false', {
      drivers: { unknownDriver: 'true', collected: false, year: 2026 },
    });
    const { drivers } = halves(html);
    expect(drivers, 'the seeded fine is on the board').toContain('733');
    expect(drivers).toContain('data-driver-year="2026"');
    expect(source('ViolationsPage.tsx')).toContain('onYearClear={() => patch({ dyear: null })}');
  });

  it('shows «مجهول» as the drivers picker’s own chip, so it comes off the way it went on', () => {
    const html = violationsAt('/fleet/violations?year=2026&dunknown=true', {
      drivers: { unknownDriver: 'true' },
    });
    expect(halves(html).drivers).toContain(ar('fleet.violations.unknownDriver'));
    // …and editing the picker folds it into `driver`, the picker's own parameter.
    expect(source('ViolationsPage.tsx')).toContain(
      'onDriverChange={(next) => patch({ driver: next, dunknown: null })}',
    );
  });

  it('asks BOTH ledgers for the vehicle set the dashboard carries (T5.11 with a branch)', () => {
    const html = violationsAt('/fleet/violations?year=2026&branch=b1', {
      rollup: { branchIds: 'b1' },
      drivers: { branchIds: ['b1'] },
    });
    const { company, drivers } = halves(html);
    expect(company, 'the company rollup asked for the branch').toContain('168');
    expect(drivers, 'the drivers’ ledger asked for it too').toContain('733');
  });

  it('shows the set above the two ledgers while it narrows them, and only then', () => {
    expect(
      violationsAt('/fleet/violations?year=2026&branch=b1', {
        rollup: { branchIds: 'b1' },
        drivers: { branchIds: ['b1'] },
      }),
    ).toContain('data-violations-vehicle-set="true"');
    expect(violationsAt('/fleet/violations?year=2026', {})).not.toContain(
      'data-violations-vehicle-set',
    );
  });

  it('remembers `dunknown` and reads it in its own source', () => {
    expect(remembered('ViolationsPage.tsx')).toContain('dunknown');
    expect(readsInSource('ViolationsPage.tsx', 'dunknown')).toBe(true);
  });
});

// ── /fleet/licensing — T4.6 ─────────────────────────────────────────────────

describe('/fleet/licensing reads its papers with the contracts’ rule', () => {
  const row = (ticks: Partial<FleetLicensingRowDto>): FleetLicensingRowDto =>
    ({
      insuranceHandover: false,
      insuranceReceipt: false,
      taxHandover: false,
      taxReceipt: false,
      ...ticks,
    }) as FleetLicensingRowDto;
  const PAPERS = [
    {
      key: 'insurance',
      label: 'fleet.licensing.columns.insurance',
      handover: 'insuranceHandover',
      receipt: 'insuranceReceipt',
    },
    {
      key: 'tax',
      label: 'fleet.licensing.columns.tax',
      handover: 'taxHandover',
      receipt: 'taxReceipt',
    },
  ] as const;

  it('answers exactly what the dashboard counts with, for every pair of ticks on both papers', () => {
    for (const paper of PAPERS) {
      for (const out of [false, true]) {
        for (const back of [false, true]) {
          const r = row({ [paper.handover]: out, [paper.receipt]: back });
          expect(paperStage(r, paper), `${paper.key} ${out}/${back}`).toBe(
            contractsPaperStage(r, paper),
          );
        }
      }
    }
  });

  it('keeps no second copy of the rule on the page', () => {
    const page = source('LicensingPage.tsx');
    expect(page).toContain('paperStage as licensingPaperStage');
    expect(page).toContain('=>\n  licensingPaperStage(row, paper);');
    expect(page, 'the old body is gone').not.toContain("if (out && back) return 'done';");
  });
});
