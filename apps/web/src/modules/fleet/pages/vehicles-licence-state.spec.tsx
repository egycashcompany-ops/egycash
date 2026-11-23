// «السيارات», the car record and «التراخيص» say a licence's state the way «التراخيص والتجديدات» on
// the dashboard says it — the audit of the ten tabs (2026-11-17), findings D08, D14, D25, D28, D29,
// D32 and D50.
//
// The clock is pinned where the audit measured: 2026-10-31T23:30Z, 01:30 on 2026-11-01 in Cairo —
// the first hours of a Cairo day and of a Cairo month, when the stored instant and the browser's UTC
// month still read yesterday and last month. The world is the audit's, cut to what each screen
// reads:
//   · 601 active, licence of TODAY stamped 00:00Z; 602 active, of today stamped 10:00Z (an import);
//     603, 604, 608 active, run out before today — five active cars expired on the dashboard;
//   · 605 active, 19 days left; 607 active, 39 days left (amber only when the warning days are 45);
//   · 606 disposed and 610 out of service, both expiring this month; 611 out of service, run out.
//
// What is pinned, each against the figure the audit measured:
//   D08  «تراخيص منتهية» counts by the Cairo day: 5, not the instant's 3; the car record's tag says
//        «منتهٍ» for a licence of today.
//   D28  «تراخيص تنتهي هذا الشهر»: ACTIVE cars in the CAIRO month — 3, not every status (5).
//        «التراخيص» counts its month the same way.
//   D32  «شهر انتهاء الترخيص» counts the statuses the bar has chosen: «(3)» beside the dashboard's
//        column of 3 on `status=active`, not «(5)».
//   D29  with «إعدادات الحركة» at 45 days, the 39-day licence is «ينتهي قريبًا» on the list, the
//        record, the card and the licensing board — as the dashboard counts it.
//   D14  a branch closed since is named, never «—»: the list's column and the record.
//   D25  the record's «آخر قراءة عداد» is the newest reading; the highest under it when it differs.
//   D50  one spelling — «منتهٍ / ينتهي قريبًا / ساري» — read from one set of keys everywhere.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  FleetSettingKeys,
  type FleetLicensingRowDto,
  type FleetVehicleDto,
  type FleetVehicleLatestReadingDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { detailKey, listKey } from '../../../shared/lib/query-keys';
import { formatNumber } from '../../../shared/lib/format';
import { licenceMonthOptions } from '../lib/licence-months';
import { DEFAULT_LICENCE_WARN_DAYS, licenceWarnDaysOf } from '../lib/licence-warn-days';
import { LICENCE_STATE_KEY } from '../components/VehicleStatusBadge';
import { VehiclesListPage, ofStatuses, registryFiguresOf } from './VehiclesListPage';
import { VehicleDetailPage } from './VehicleDetailPage';
import { LicensingPage, licensingFiguresOf } from './LicensingPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

/** 01:30 on 2026-11-01 in Cairo. */
const NOW = new Date('2026-10-31T23:30:00.000Z');

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

const B_OPEN = 'b-open';
const B_CLOSED = 'b-closed';

const car = (
  code: string,
  licenseExpiresAt: string,
  status: FleetVehicleDto['status'] = 'active',
  over: Partial<FleetVehicleDto> = {},
): FleetVehicleDto =>
  ({
    id: `v${code}`,
    code,
    typeId: 't1',
    plateNumber: `س ص ${code}`,
    chassisNumber: `CH-${code}`,
    motorNumber: `MO-${code}`,
    joinedAt: '2024-01-01T00:00:00.000Z',
    licenseExpiresAt,
    licenseClassId: null,
    operationId: null,
    insuranceCompanyId: null,
    branchId: B_OPEN,
    departmentId: null,
    radio: { issi: null, motorolaSn: null },
    status,
    statusReason: null,
    licenseImage: null,
    inWorkshop: false,
    version: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...over,
  }) as FleetVehicleDto;

const REGISTRY: FleetVehicleDto[] = [
  car('601', '2026-11-01T00:00:00.000Z'),
  car('602', '2026-11-01T10:00:00.000Z'),
  car('603', '2026-10-20T00:00:00.000Z'),
  car('604', '2026-09-30T00:00:00.000Z'),
  car('605', '2026-11-20T00:00:00.000Z'),
  car('606', '2026-11-05T00:00:00.000Z', 'disposed'),
  car('607', '2026-12-10T00:00:00.000Z'),
  car('608', '2026-10-31T00:00:00.000Z'),
  car('610', '2026-11-09T00:00:00.000Z', 'outOfService'),
  car('611', '2026-10-01T00:00:00.000Z', 'outOfService'),
];
const byCode = (code: string): FleetVehicleDto => {
  const found = REGISTRY.find((v) => v.code === code);
  if (found === undefined) throw new Error(`no car ${code}`);
  return found;
};

const BRANCH_OPEN = {
  id: B_OPEN,
  code: '01',
  name: { ar: 'فرع أ', en: 'Branch A' },
  parentId: null,
  catalogId: null,
};
const BRANCH_CLOSED = {
  id: B_CLOSED,
  code: '05',
  name: { ar: 'فرع هـ', en: 'Branch E' },
  parentId: null,
  catalogId: null,
};

const me = (permissions: readonly string[]): MeDto =>
  ({
    id: 'u1',
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
  }) as unknown as MeDto;

const SETTINGS_KEY = ['platform', 'settings', 'me'];
const warnSetting = (days: number) => [
  { key: FleetSettingKeys.VehicleLicenseWarnDays, value: days, resolvedFrom: 'organization' },
];

const seeded = ({ warnDays }: { warnDays?: number | undefined } = {}): QueryClient => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  if (warnDays !== undefined) qc.setQueryData(SETTINGS_KEY, warnSetting(warnDays));
  // The pickers offer the ACTIVE branches; the names include the closed ones.
  qc.setQueryData(['organization', 'branches', 'options'], [BRANCH_OPEN]);
  qc.setQueryData(
    ['organization', 'branches', 'options', 'withInactive'],
    [BRANCH_OPEN, BRANCH_CLOSED],
  );
  qc.setQueryData(listKey('fleet', 'vehicles', { whole: true, anyStatus: true }), {
    items: REGISTRY,
    meta: { page: 1, pageSize: REGISTRY.length, totalItems: REGISTRY.length, totalPages: 1 },
  });
  return qc;
};

const render = (
  path: string,
  routePath: string,
  element: JSX.Element,
  qc: QueryClient,
  { locale = 'ar' as Locale, permissions = ['fleetVehicle.view'] as readonly string[] } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The vehicles list over `rows`, in its own default order and page. */
const vehiclesList = (
  rows: FleetVehicleDto[],
  {
    warnDays,
    path = '/fleet/vehicles',
    locale,
  }: { warnDays?: number | undefined; path?: string; locale?: Locale | undefined } = {},
): string => {
  const qc = seeded({ warnDays });
  qc.setQueryData(
    listKey('fleet', 'vehicles', {
      page: 1,
      pageSize: 25,
      sortBy: 'code',
      sortDir: 'asc',
      sort: 'code:asc',
    }),
    { items: rows, meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 } },
  );
  return render(path, '/fleet/vehicles', <VehiclesListPage />, qc, { locale });
};

/** The car record of `vehicle`, with whatever else the test seeds. */
const record = (
  vehicle: FleetVehicleDto,
  {
    warnDays,
    readings,
    permissions = ['fleetVehicle.view'],
  }: {
    warnDays?: number | undefined;
    readings?: FleetVehicleLatestReadingDto[];
    permissions?: readonly string[];
  } = {},
): string => {
  const qc = seeded({ warnDays });
  qc.setQueryData(detailKey('fleet', 'vehicles', vehicle.id), vehicle);
  if (readings !== undefined) qc.setQueryData(['fleet', 'odometer', 'latestReadings'], readings);
  return render(`/fleet/vehicles/${vehicle.id}`, '/fleet/vehicles/:id', <VehicleDetailPage />, qc, {
    permissions,
  });
};

const licensingRow = (code: string, licenseExpiresAt: string): FleetLicensingRowDto => ({
  vehicleId: `v${code}`,
  code,
  plateNumber: `س ص ${code}`,
  chassisNumber: `CH-${code}`,
  licenseClass: 'برقاش ت',
  licenseExpiresAt,
  insuranceHandover: false,
  insuranceReceipt: false,
  taxHandover: false,
  taxReceipt: false,
});

const licensingBoard = (rows: FleetLicensingRowDto[], warnDays?: number): string => {
  const qc = seeded({ warnDays });
  qc.setQueryData(['fleet', 'licensing'], rows);
  return render('/fleet/licensing', '/fleet/licensing', <LicensingPage />, qc, {
    permissions: ['fleetLicensing.view'],
  });
};

const t = (key: string, params?: Record<string, string>): string => translate('ar', key, params);

/** The markup of a list row's licence cell, by the date it prints. */
const licenceCell = (html: string, ymd: string): string => {
  const at = html.indexOf(`>${ymd}<`);
  expect(at, `${ymd} is on the list`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<td', at), html.indexOf('</td>', at));
};

describe('D08 — «تراخيص منتهية» by the Cairo day, expired ON its day', () => {
  it('counts 5 active cars beside the dashboard’s 5 — the instant counted 3', () => {
    const figures = registryFiguresOf(REGISTRY, DEFAULT_LICENCE_WARN_DAYS, NOW.getTime());
    expect(figures.expired).toBe(5);
    // The rule it replaced, for the record: the stored instant against the clock misses both
    // licences of today (601 at 00:00Z, 602 at 10:00Z) for the first hours of the Cairo day.
    const byInstant = REGISTRY.filter(
      (v) => v.status === 'active' && new Date(v.licenseExpiresAt).getTime() < NOW.getTime(),
    ).length;
    expect(byInstant).toBe(3);
  });

  it('a disposed or out-of-service car is not counted, however long its licence has run out', () => {
    expect(
      registryFiguresOf([byCode('611'), byCode('606')], DEFAULT_LICENCE_WARN_DAYS, NOW.getTime())
        .expired,
    ).toBe(0);
  });

  it('the car record says «منتهٍ» for a licence of today, stamped later in the day', () => {
    const html = record(byCode('602'));
    expect(html).toContain('data-vehicle-licence-state="expired"');
    expect(html).toContain(t(LICENCE_STATE_KEY.expired));
    // Never the old feminine two-state word.
    expect(html).not.toContain('سارية');
  });

  it('the record’s tag has the three states, not two — «ينتهي قريبًا» inside the warning days', () => {
    expect(record(byCode('605'))).toContain('data-vehicle-licence-state="soon"');
    expect(record(byCode('607'))).toContain('data-vehicle-licence-state="valid"');
  });
});

describe('D28 — «تراخيص تنتهي هذا الشهر»: active cars, in the Cairo month', () => {
  it('3 — 601, 602 and 605 — as the dashboard’s «هذا الشهر» column and its `status=active` link', () => {
    expect(registryFiguresOf(REGISTRY, 30, NOW.getTime()).thisMonth).toBe(3);
    // Every status in the same month was 5 (the disposed 606 and the out-of-service 610 too).
    expect(REGISTRY.filter((v) => v.licenseExpiresAt.slice(0, 7) === '2026-11')).toHaveLength(5);
    // …and the browser's UTC month at this hour is still October.
    expect(NOW.toISOString().slice(0, 7)).toBe('2026-10');
  });

  it('the licensing board counts its month in Cairo too', () => {
    const rows = [
      licensingRow('601', '2026-11-01T00:00:00.000Z'),
      licensingRow('605', '2026-11-20T00:00:00.000Z'),
      licensingRow('608', '2026-10-31T00:00:00.000Z'),
    ];
    const figures = licensingFiguresOf(rows, 30, NOW.getTime());
    expect(figures.thisMonth, 'November, not October').toBe(2);
    expect(figures.expired, '601 of today and 608 of yesterday').toBe(2);
  });
});

describe('D32 — «شهر انتهاء الترخيص» counts the chosen statuses', () => {
  it('on `status=active` November reads (3), the dashboard column’s 3 — not (5)', () => {
    const active = licenceMonthOptions(ofStatuses(REGISTRY, ['active']), 'en');
    expect(active.find((o) => o.value === '2026-11')?.label).toBe('November 2026 (3)');
    const every = licenceMonthOptions(ofStatuses(REGISTRY, []), 'en');
    expect(every.find((o) => o.value === '2026-11')?.label, 'no status chosen: every car').toBe(
      'November 2026 (5)',
    );
  });

  it('the dashboard’s link lands on a bar whose month says (3)', () => {
    const html = vehiclesList([], {
      path: '/fleet/vehicles?status=active&licenseMonths=2026-11',
      locale: 'en',
    });
    expect(html).toContain('November 2026 (3)');
    expect(html).not.toContain('November 2026 (5)');
  });
});

describe('D29 — the warning days are the setting’s, not a fixed thirty', () => {
  it('reads both days from the resolved settings, thirty for one missing or out of range', () => {
    expect(licenceWarnDaysOf(undefined)).toEqual({ vehicle: 30, driver: 30 });
    expect(
      licenceWarnDaysOf([
        { key: FleetSettingKeys.VehicleLicenseWarnDays, value: 45 },
        { key: FleetSettingKeys.DriverLicenseWarnDays, value: 60 },
      ]),
    ).toEqual({ vehicle: 45, driver: 60 });
    expect(
      licenceWarnDaysOf([
        { key: FleetSettingKeys.VehicleLicenseWarnDays, value: 0 },
        { key: FleetSettingKeys.DriverLicenseWarnDays, value: 'x' },
      ]),
    ).toEqual({ vehicle: 30, driver: 30 });
  });

  it('W = 45: the 39-day licence is amber on the vehicles list — «ساري» at the default 30', () => {
    const at45 = licenceCell(vehiclesList([byCode('607')], { warnDays: 45 }), '2026/12/10');
    expect(at45).toContain('text-amber-600');
    expect(at45).toContain(t(LICENCE_STATE_KEY.soon));
    const at30 = licenceCell(vehiclesList([byCode('607')]), '2026/12/10');
    expect(at30).not.toContain('text-amber-600');
    expect(at30).toContain(t(LICENCE_STATE_KEY.valid));
  });

  it('…on the car record', () => {
    expect(record(byCode('607'), { warnDays: 45 })).toContain('data-vehicle-licence-state="soon"');
  });

  it('…and on the licensing board', () => {
    const row = [licensingRow('607', '2026-12-10T00:00:00.000Z')];
    expect(licensingBoard(row, 45)).toContain('data-licensing-expiry="soon"');
    expect(licensingBoard(row)).toContain('data-licensing-expiry="valid"');
  });

  it('no screen that colours a car licence counts a fixed thirty any more', () => {
    for (const file of [
      'VehiclesListPage.tsx',
      'VehicleDetailPage.tsx',
      'LicensingPage.tsx',
      '../components/VehicleHoverCard.tsx',
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/expiryState\([^)]*,\s*30\b/u);
      expect(source, file).toContain('useLicenceWarnDays');
    }
  });
});

describe('D14 — a branch closed since is named, never «—»', () => {
  const inClosed = car('620', '2027-05-01T00:00:00.000Z', 'active', { branchId: B_CLOSED });

  it('the vehicles list names it in its column', () => {
    const html = vehiclesList([inClosed]);
    const body = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
    expect(body).toContain('فرع هـ');
  });

  it('the car record names it', () => {
    expect(record(inClosed)).toContain('فرع هـ');
  });
});

describe('D25 — the record’s «آخر قراءة عداد» is the newest reading', () => {
  const backwards: FleetVehicleLatestReadingDto = {
    vehicleId: 'v605',
    latestReading: 5000,
    latestReadingAt: '2026-10-15T00:00:00.000Z',
    newest: { reading: 4980, date: '2026-10-16T00:00:00.000Z' },
  };
  const ODOMETER = ['fleetVehicle.view', 'fleetOdometer.view'];

  // The tile writes its figures in Latin digits, as the whole record does since the owner's
  // 2026-11-22 follow-ups («صلحهم») — no longer in the shared `formatNumber`'s Arabic-Indic
  // («٤٬٩٨٠»), which each case below asserts is gone.
  const km = (n: number): string => new Intl.NumberFormat('en-US').format(n);
  const arabicIndic = (n: number): string => formatNumber(n, 'ar');

  it('a chain that went backwards: 4,980 under «آخر قراءة عداد», «أعلى قراءة 5,000 كم» under it', () => {
    const html = record(byCode('605'), { readings: [backwards], permissions: ODOMETER });
    expect(html).toContain(t('fleet.vehicle.lastReading'));
    expect(html).toContain(`>${km(4980)}<`);
    expect(km(4980)).toBe('4,980');
    expect(html).not.toContain(`>${km(5000)}<`);
    expect(html).toContain(t('fleet.vehicle.highestReading', { km: km(5000) }));
    expect(html).not.toContain(arabicIndic(4980));
    expect(html).not.toContain(arabicIndic(5000));
    expect(html).not.toContain(t('fleet.vehicle.lastReadingHint'));
  });

  it('a healthy chain: the one reading, and the tile’s own hint', () => {
    const healthy = { ...backwards, newest: { reading: 5000, date: backwards.latestReadingAt } };
    const html = record(byCode('605'), { readings: [healthy], permissions: ODOMETER });
    expect(html).toContain(`>${km(5000)}<`);
    expect(html).not.toContain(arabicIndic(5000));
    expect(html).toContain(t('fleet.vehicle.lastReadingHint'));
    expect(html).not.toContain(t('fleet.vehicle.highestReading', { km: km(5000) }));
  });

  it('no reading on file: «لا قراءات بعد»', () => {
    expect(record(byCode('605'), { readings: [], permissions: ODOMETER })).toContain(
      t('fleet.vehicle.noReadings'),
    );
  });
});

describe('D50 — one spelling of a car licence’s state', () => {
  it('«منتهٍ / ينتهي قريبًا / ساري» (W7.json, merged into i18n by the HUB)', () => {
    expect(translate('ar', LICENCE_STATE_KEY.expired)).toBe('منتهٍ');
    expect(translate('ar', LICENCE_STATE_KEY.soon)).toBe('ينتهي قريبًا');
    expect(translate('ar', LICENCE_STATE_KEY.valid)).toBe('ساري');
    expect(translate('en', LICENCE_STATE_KEY.valid)).toBe('Valid');
  });

  it('every screen that says it reads the one set of keys — never the fuel cards’ words', () => {
    for (const file of [
      'VehiclesListPage.tsx',
      'VehicleDetailPage.tsx',
      'LicensingPage.tsx',
      '../components/VehicleHoverCard.tsx',
      '../components/VehicleStatusBadge.tsx',
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/t\(\s*[`'"]fleet\.fuelCards\.expiry/u);
      expect(source, file).not.toContain("t('fleet.vehicle.licenseValid')");
    }
    // The fuel cards keep their own words (T19).
    expect(read('../components/FuelCardBoard.tsx')).toContain('fleet.fuelCards.expiry.');
  });
});
