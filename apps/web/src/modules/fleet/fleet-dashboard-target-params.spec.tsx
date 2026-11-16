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
  type FleetMaintenanceAlarmDto,
  type FleetMaintenanceVisitDto,
  type FleetNoticeDto,
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
import { MaintenancePage } from './pages/MaintenancePage';
import { MaintenanceAlarmsPage } from './pages/MaintenanceAlarmsPage';
import { VehicleContractsPage } from './pages/VehicleContractsPage';
import { vehicleContractSummaryKey } from './api/vehicle-contract-queries';
import { ViolationsPage } from './pages/ViolationsPage';
import { NoticesPage } from './pages/NoticesPage';
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

  it('lets the accidents bar wrap, set or no set — the boards’ dark bar, as on receipts', () => {
    // The approved board (2026-11-09) dropped the old one-row bar measured at 1536: the dark bar
    // wraps like every other Fleet board's, so the set's three controls never push it off the page.
    for (const html of [
      accidentsAt('/fleet/accidents', {}),
      accidentsAt(`/fleet/accidents?${SET_ROUTE}`, SET_QUERY),
    ]) {
      expect(html).toContain('data-accidents-filters="true"');
      expect(html).not.toContain('min-[1536px]:flex-nowrap');
    }
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

// ── /fleet/notices — the notices follow the car's branch («الحوادث ومطالبات التأمين», «نظرة عامة») ──

const notice = (over: Partial<FleetNoticeDto> = {}): FleetNoticeDto => ({
  id: 'nt-1',
  template: 'misrInsurance',
  values: {},
  checks: {},
  vehicleId: 'v-247',
  vehicleCode: '247',
  driverEmployeeId: null,
  accidentId: null,
  noticeNumber: '24117',
  noticeDate: '2026-10-21',
  noticeImage: null,
  vehicleLicense: null,
  driverLicense: null,
  vehicleLicenseOnFile: false,
  driverLicenseOnFile: false,
  checkImage: null,
  completedAt: null,
  version: 0,
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
  ...over,
});

const noticesAt = (
  route: string,
  filters: Record<string, unknown>,
  extraKeys: readonly string[] = [],
): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'notices', { page: 1, pageSize: 25, ...filters }),
    paged([notice()]),
  );
  return mount(qc, ['fleetNotice.view', ...extraKeys], route, '/fleet/notices', <NoticesPage />);
};
const noticeRowShown = (html: string): boolean => html.includes('data-notice-row="nt-1"');

describe('/fleet/notices reads the vehicle set — the car’s type, operation and branch', () => {
  it('sends the branch with «open» (the overview’s line, «إخطارات تأمين مفتوحة») and the whole set', () => {
    expect(
      noticeRowShown(
        noticesAt('/fleet/notices?status=open&branch=b1', { status: 'open', branchIds: ['b1'] }),
      ),
    ).toBe(true);
    expect(
      noticeRowShown(
        noticesAt(`/fleet/notices?status=open&${SET_ROUTE}`, { status: 'open', ...SET_QUERY }),
      ),
    ).toBe(true);
    // «بلا صورة الشيك» and a row's «فتح» carry it beside their own params.
    expect(
      noticeRowShown(
        noticesAt('/fleet/notices?status=open&checkImage=missing&branch=b1,b2', {
          status: 'open',
          checkImage: 'missing',
          branchIds: ['b1', 'b2'],
        }),
      ),
    ).toBe(true);
    expect(
      noticeRowShown(
        noticesAt(
          '/fleet/notices?status=open&vehicleCodes=247&number=24117&from=2026-10-21&to=2026-10-21&branch=b1',
          {
            status: 'open',
            vehicleCodes: '247',
            noticeNumber: '24117',
            from: '2026-10-21',
            to: '2026-10-21',
            branchIds: ['b1'],
          },
        ),
      ),
    ).toBe(true);
  });

  it('asks the figures above the list with the same set (one filter object for both)', () => {
    const flat = source('NoticesPage.tsx').replace(/\s+/gu, ' ');
    expect(flat).toContain('...vehicleSetQuery(vehicleSet),');
    expect(flat).toContain('useNotices({ page, pageSize, ...filters, })');
    expect(flat).toContain('const summary = useNoticesSummary(filters);');
  });

  it('does not answer a narrowed address from the un-narrowed list', () => {
    expect(
      noticeRowShown(noticesAt('/fleet/notices?status=open&branch=b1', { status: 'open' })),
    ).toBe(false);
    expect(noticeRowShown(noticesAt(`/fleet/notices?${SET_ROUTE}`, {}))).toBe(false);
    // …and an ordinary visit asks exactly what it asked before.
    expect(noticeRowShown(noticesAt('/fleet/notices?status=open', { status: 'open' }))).toBe(true);
  });

  it('shows the set on the bar while it narrows — nameless, removable chips without the lists’ guards', () => {
    const plain = noticesAt('/fleet/notices?status=open', { status: 'open' });
    expect(plain).not.toContain('data-vehicle-set-chip');
    const narrowed = noticesAt(`/fleet/notices?${SET_ROUTE}`, SET_QUERY);
    expect(narrowed).toContain('data-vehicle-set-chip="type"');
    expect(narrowed).toContain('data-vehicle-set-chip="operation"');
    expect(narrowed).toContain(ar('fleet.dash.filters.someTypes'));
    expect(narrowed).toContain(ar('fleet.dash.filters.someOperations'));
    expect(narrowed).toContain(ar('recruitment.filters.branch'));
    // With the types list's and the catalog's own guard: the named controls instead.
    const registry = noticesAt(`/fleet/notices?${SET_ROUTE}`, SET_QUERY, ['fleetVehicle.view']);
    expect(registry).toContain(ar('fleet.vehicles.filters.short.make'));
    expect(registry).toContain(ar('fleet.vehicles.filters.short.operation'));
  });

  it('remembers the set with its other filters, and reads it in its own source', () => {
    for (const param of ['type', 'operation', 'branch']) {
      expect(remembered('NoticesPage.tsx'), `remembers ${param}`).toContain(param);
      expect(readsInSource('NoticesPage.tsx', param), `reads ${param}`).toBe(true);
    }
  });
});

// ── «نظرة عامة»: «مصروف الوقود» and «زيارات الصيانة» by exit day ──────────────

describe('/fleet/receipts reads the fuel receipts of «مصروف الوقود» (kind=fuel)', () => {
  it('sends the kind with the month and the reader’s branches', () => {
    const html = receiptsAt(
      '/fleet/receipts?from=2026-11-01&to=2026-11-15&branch=b1,b2&kind=fuel',
      {
        from: '2026-11-01',
        to: '2026-11-15',
        kind: ['fuel'],
        branchIds: ['b1', 'b2'],
      },
    );
    expect(tbody(html)).toContain('سائق الإيصال المفلتر');
  });

  it('does not answer a fuel address from the list of every kind', () => {
    const html = receiptsAt('/fleet/receipts?from=2026-11-01&to=2026-11-15&kind=fuel', {
      from: '2026-11-01',
      to: '2026-11-15',
    });
    expect(tbody(html)).not.toContain('سائق الإيصال المفلتر');
  });

  it('remembers `kind` and reads it in its own source', () => {
    expect(remembered('ReceiptsPage.tsx')).toContain('kind');
    expect(source('ReceiptsPage.tsx')).toContain("csv(sp.get('kind'))");
  });
});

const visit = (over: Partial<FleetMaintenanceVisitDto> = {}): FleetMaintenanceVisitDto => ({
  id: 'm-1',
  vehicleId: 'v-1',
  vehicleCode: '150',
  operationId: null,
  branchId: 'b1',
  driverInEmployeeId: null,
  driverOutEmployeeId: null,
  driverInName: null,
  driverOutName: null,
  inDate: '2026-10-28T00:00:00.000Z',
  outDate: '2026-11-03T00:00:00.000Z',
  workshopId: 'ws1',
  workTypeId: 'wt1',
  spareParts: [],
  sparePartIds: [],
  odometerAtService: 98765,
  exitOdometer: null,
  takenInByEmployeeId: null,
  takenOutByEmployeeId: null,
  notes: null,
  version: 0,
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-11-03T00:00:00.000Z',
  ...over,
});

const maintenanceAt = (route: string, filters: Record<string, unknown>): string => {
  const qc = client();
  qc.setQueryData(
    listKey('fleet', 'maintenance', {
      ...filters,
      page: 1,
      pageSize: 25,
      sortBy: 'inDate',
      sortDir: 'desc',
      sort: 'inDate:desc',
    }),
    paged([visit()]),
  );
  return mount(qc, ['fleetMaintenance.view'], route, '/fleet/maintenance', <MaintenancePage />);
};

describe('/fleet/maintenance reads the visits that LEFT the workshop (exits)', () => {
  it('sends the month as check-out bounds with the set — never as check-in bounds', () => {
    const route = '/fleet/maintenance?outFrom=2026-11-01&outTo=2026-11-15&type=ty1&branch=b1,b2';
    expect(
      tbody(
        maintenanceAt(route, {
          outFrom: '2026-11-01',
          outTo: '2026-11-15',
          typeIds: ['ty1'],
          branchIds: ['b1', 'b2'],
        }),
      ),
    ).toContain('98,765');
    // The same days as check-in bounds are another question: not this list.
    expect(
      tbody(
        maintenanceAt(route, {
          from: '2026-11-01',
          to: '2026-11-15',
          typeIds: ['ty1'],
          branchIds: ['b1', 'b2'],
        }),
      ),
    ).not.toContain('98,765');
  });

  it('remembers both bounds and reads them in its own source', () => {
    expect(remembered('MaintenancePage.tsx')).toEqual(expect.arrayContaining(['outFrom', 'outTo']));
    expect(readsInSource('MaintenancePage.tsx', 'outFrom')).toBe(true);
    expect(readsInSource('MaintenancePage.tsx', 'outTo')).toBe(true);
  });
});

// ── «الصيانة والورش»: the alarms board on both levels, or on one car ──────────

const alarm = (
  code: string,
  level: FleetMaintenanceAlarmDto['level'],
): FleetMaintenanceAlarmDto => ({
  vehicleId: `v${code}`,
  code,
  level,
  remainingKm: level === 'red' ? -100 : level === 'yellow' ? 500 : 4000,
  sinceServiceKm: 4000,
  lastServiceAt: '2026-08-01T00:00:00.000Z',
  lastServiceVisitId: `visit-${code}`,
  noAlarmReason: null,
  daysWithoutReading: 0,
  latestReading: 12000,
  latestReadingAt: null,
  latestReadingLogId: null,
  baseline: null,
  newerUncountedVisit: null,
  rule: { vehicleType: null, intervalKm: 10000, yellowKm: 1000, redKm: 300 },
  newestReading: null,
});

/** The board's rows as drawn: the code cell's own mark, in row order. */
const alarmCodes = (route: string): string[] => {
  const qc = client();
  // The board's ONE read (`fleetKeys.alarms`), fetched whole: the screen narrows it to the link's
  // levels and codes.
  qc.setQueryData(
    ['fleet', 'alarms'],
    [alarm('247', 'red'), alarm('188', 'red'), alarm('305', 'yellow'), alarm('152', 'none')],
  );
  const html = mount(
    qc,
    ['fleetOdometer.view'],
    route,
    '/fleet/maintenance-alarms',
    <MaintenanceAlarmsPage />,
  );
  return [...tbody(html).matchAll(/data-alarm-code="true"[^>]*>([^<]*)<\/span>/gu)].map(
    (m) => m[1] ?? '',
  );
};

describe('/fleet/maintenance-alarms reads the levels and the car «الصيانة والورش» opens it on', () => {
  it('«كل إنذارات الصيانة»: both levels (a list), and no car without an alarm', () => {
    expect(alarmCodes('/fleet/maintenance-alarms?level=red,yellow').sort()).toEqual([
      '188',
      '247',
      '305',
    ]);
    // …under a branch, the branch's cars of both levels by code.
    expect(
      alarmCodes('/fleet/maintenance-alarms?level=red,yellow&vehicleCodes=247,305').sort(),
    ).toEqual(['247', '305']);
  });

  it('«فتح» on a row: that car alone, at its level', () => {
    expect(alarmCodes('/fleet/maintenance-alarms?level=red&vehicleCodes=247')).toEqual(['247']);
    expect(alarmCodes('/fleet/maintenance-alarms?level=yellow&vehicleCodes=247')).toEqual([]);
  });

  it('remembers both and reads them in its own source', () => {
    expect(remembered('MaintenanceAlarmsPage.tsx')).toEqual(
      expect.arrayContaining(['level', 'vehicleCodes']),
    );
    expect(readsInSource('MaintenanceAlarmsPage.tsx', 'level')).toBe(true);
    expect(readsInSource('MaintenanceAlarmsPage.tsx', 'vehicleCodes')).toBe(true);
  });
});

// ── «توزيع السيارات»: the supply contracts of the year, and one alarm level ────

/** Renders the contracts screen at `route` and says which reads it built: the list and the figures. */
const contractReads = (route: string): readonly unknown[][] => {
  const qc = client();
  mount(
    qc,
    ['fleetVehicleContract.view'],
    route,
    '/fleet/vehicle-contracts',
    <VehicleContractsPage />,
  );
  return qc
    .getQueryCache()
    .findAll({ queryKey: ['fleet', 'vehicleContracts'] })
    .map((q) => [...q.queryKey]);
};

describe('/fleet/vehicle-contracts reads the year and the alarm level «عقود التوريد» opens it on', () => {
  const YEAR = { from: '2026-01-01', to: '2026-12-31' };
  const LIST = { page: 1, pageSize: 25, sortBy: 'date', sortDir: 'desc', sort: 'date:desc' };

  it('sends the dates to the list AND to its figures — the summary the dashboard reads', () => {
    const reads = contractReads('/fleet/vehicle-contracts?from=2026-01-01&to=2026-12-31');
    expect(reads).toContainEqual([...listKey('fleet', 'vehicleContracts', { ...LIST, ...YEAR })]);
    expect(reads).toContainEqual([...vehicleContractSummaryKey(YEAR)]);
  });

  it('sends one alarm level with them, as a list', () => {
    const reads = contractReads('/fleet/vehicle-contracts?from=2026-01-01&to=2026-12-31&alarm=red');
    expect(reads).toContainEqual([
      ...listKey('fleet', 'vehicleContracts', { ...LIST, ...YEAR, alarm: ['red'] }),
    ]);
    expect(reads).toContainEqual([...vehicleContractSummaryKey({ ...YEAR, alarm: ['red'] })]);
    // Not the un-narrowed figures.
    expect(reads).not.toContainEqual([...vehicleContractSummaryKey(YEAR)]);
  });

  it('remembers them and reads them in its own source', () => {
    expect(remembered('VehicleContractsPage.tsx')).toEqual(
      expect.arrayContaining(['from', 'to', 'alarm']),
    );
    for (const param of ['from', 'to', 'alarm']) {
      expect(readsInSource('VehicleContractsPage.tsx', param), param).toBe(true);
    }
  });
});

// ── «الحركة اليوم»: the day's board, searched or narrowed to the reasons ───────

describe('/fleet/roster reads the car and the reasons «الحركة اليوم» opens it on', () => {
  it('reads `q` (a car of «سيارات بلا سائق اليوم») and `unavailable` (the reasons) in its own source', () => {
    // The board is the day's one read (one key per date); both narrow it on the screen — the
    // roster specs render them (fleet-daily-roster.spec.tsx `q`, fleet-roster-licence.spec.tsx
    // several reasons at once).
    expect(readsInSource('RosterPage.tsx', 'q')).toBe(true);
    expect(readsInSource('RosterPage.tsx', 'unavailable')).toBe(true);
    expect(remembered('RosterPage.tsx')).toEqual(expect.arrayContaining(['q', 'unavailable']));
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

  it('asks both ledgers for EVERY year’s unpaid fines — «مخالفات قائمة» (cset + dset, no year)', () => {
    const html = violationsAt('/fleet/violations?cset=false&dset=false&branch=b1,b2', {
      rollup: { year: '', branchIds: 'b1,b2' },
      drivers: { collected: false, branchIds: ['b1', 'b2'] },
    });
    const { company, drivers } = halves(html);
    expect(company, 'the company rollup of every year').toContain('168');
    expect(drivers, 'the drivers’ unpaid fines of every year').toContain('733');
    // The one-year rollup is another question.
    const yearOnly = violationsAt('/fleet/violations?cset=false&dset=false&branch=b1,b2', {
      drivers: { collected: false, branchIds: ['b1', 'b2'] },
    });
    expect(halves(yearOnly).company).not.toContain('168');
  });

  it('remembers `cset` and `dset` and reads them in its own source', () => {
    for (const param of ['cset', 'dset']) {
      expect(remembered('ViolationsPage.tsx')).toContain(param);
      expect(readsInSource('ViolationsPage.tsx', param)).toBe(true);
    }
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
