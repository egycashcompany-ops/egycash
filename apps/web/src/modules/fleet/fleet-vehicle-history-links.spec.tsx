// The vehicle profile's «السجلات والأرشيف» rows open each screen ALREADY filtered to the car.
//
// Owner, 2026-10-12: the eye on a car opens its profile; a click on «العدادات», «الصيانات»,
// «المخالفات»… landed on the screen with no car picked. Four of the five rows sent
// `?vehicle=<id>`, a name none of those screens reads, so each opened on the whole fleet. Every
// target reads the car from its OWN URL param, as CODES: odometer, maintenance and accidents
// `vehicleCodes`, the violations screen `codes` (company half) and `dcodes` (drivers half), the
// roster `q`.
//
// «تاريخ العربيه كله»: the odometer row also sends `period=all`, so the screen opens on the car's
// WHOLE history — the span its count («N قراءة») covers — instead of the current month it opens on
// by itself. No date is sent, and the other four rows send nothing beyond the car.
//
// Two halves here. The page is rendered to static markup (the suite has no DOM) and each row's
// href is pinned. Then each link is checked against its TARGET's source, found through the route
// table: every param it sends must be one that page reads from the URL. A renamed param on either
// side now fails here instead of silently opening an unfiltered screen again.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  splitVehicleCodeList,
  type FleetVehicleDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { detailKey, listKey } from '../../shared/lib/query-keys';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { odometerRange, WHOLE_HISTORY } from './lib/odometer-range';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

const VEHICLE_ID = 'v-200';

const vehicleWith = (code: string): FleetVehicleDto =>
  ({
    id: VEHICLE_ID,
    code,
    typeId: 'type-1',
    plateNumber: 'س ص 200',
    chassisNumber: 'CH-200',
    motorNumber: 'MO-200',
    joinedAt: '2024-01-01T00:00:00.000Z',
    licenseExpiresAt: '2027-01-01T00:00:00.000Z',
    licenseClassId: null,
    operationId: null,
    insuranceCompanyId: null,
    branchId: null,
    departmentId: null,
    radio: { issi: null, motorolaSn: null },
    status: 'active',
    statusReason: null,
    licenseImage: null,
    inWorkshop: false,
    version: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }) as unknown as FleetVehicleDto;

/** Each row's own permission, so all five rows are drawn. */
const ROW_PERMISSIONS = [
  'fleetVehicle.view',
  'fleetOdometer.view',
  'fleetMaintenance.view',
  'fleetAccident.view',
  'fleetViolation.view',
  'fleetRoster.view',
];

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(ROW_PERMISSIONS.map((p) => [p, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const drawProfile = (
  vehicle: FleetVehicleDto,
  seed: (qc: QueryClient) => void = () => undefined,
): string => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(detailKey('fleet', 'vehicles', vehicle.id), vehicle);
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/fleet/vehicles/${vehicle.id}`]}>
          <Routes>
            <Route path="/fleet/vehicles/:id" element={<VehicleDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const unescapeHtml = (raw: string): string =>
  raw
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

/** Every history row's href, keyed by the screen it opens (`/fleet/<screen>`). */
const historyHrefs = (markup: string): Map<string, string> => {
  const hrefs = new Map<string, string>();
  for (const match of markup.matchAll(/<a [^>]*href="([^"]*)"/g)) {
    const href = unescapeHtml(match[1] ?? '');
    // The breadcrumbs (/fleet, /fleet/vehicles) carry no query; only the history rows do.
    if (!href.includes('?')) continue;
    const screen = new URL(href, 'http://profile.test').pathname.replace(/^\/fleet\//, '');
    hrefs.set(screen, href);
  }
  return hrefs;
};

const queryOf = (href: string): URLSearchParams =>
  new URL(href, 'http://profile.test').searchParams;

/** The params that carry the CAR on each row — every other param is named on its own below. */
const CAR_PARAMS: Record<string, readonly string[]> = {
  odometer: ['vehicleCodes'],
  maintenance: ['vehicleCodes'],
  accidents: ['vehicleCodes'],
  violations: ['codes', 'dcodes'],
  roster: ['q'],
};

describe('each history row opens its screen filtered to THIS car', () => {
  it('draws the five rows, each in the param its screen reads, holding the code', () => {
    const vehicle = vehicleWith('200');
    const markup = drawProfile(vehicle);
    // The rows are really on the page (not a stale loading state) — one label per row.
    for (const key of ['odometer', 'maintenance', 'accidents', 'violations', 'roster']) {
      expect(markup, key).toContain(translate('ar', `fleet.nav.${key}`));
    }
    expect(Object.fromEntries(historyHrefs(markup))).toEqual({
      odometer: '/fleet/odometer?vehicleCodes=200&period=all',
      maintenance: '/fleet/maintenance?vehicleCodes=200',
      accidents: '/fleet/accidents?vehicleCodes=200',
      violations: '/fleet/violations?codes=200&dcodes=200',
      roster: '/fleet/roster?q=200',
    });
  });

  it('no row sends the car id, nor the old `vehicle` name no screen reads', () => {
    const markup = drawProfile(vehicleWith('200'));
    expect(markup).not.toContain(VEHICLE_ID);
    for (const href of historyHrefs(markup).values()) {
      expect(href, href).not.toMatch(/[?&](vehicle|vehicleId)=/);
    }
  });

  it('the violations row narrows BOTH halves — its count spans both kinds', () => {
    // One param alone leaves the other half on the whole fleet.
    const href = historyHrefs(drawProfile(vehicleWith('200'))).get('violations') ?? '';
    const query = queryOf(href);
    expect(query.get('codes')).toBe('200');
    expect(query.get('dcodes')).toBe('200');
  });

  it('a worded or symbol-bearing code arrives exactly as the registry holds it', () => {
    // The code is free text: Arabic letters must survive, and a raw `+` would read back as a space
    // — a different car, or none.
    for (const code of ['كوستر', 'A+15', 'A-15']) {
      const hrefs = historyHrefs(drawProfile(vehicleWith(code)));
      expect(hrefs.size, code).toBe(5);
      for (const [screen, href] of hrefs) {
        const query = queryOf(href);
        expect([...query.keys()].length, `${screen} ${code}`).toBeGreaterThan(0);
        for (const [param, value] of query) {
          // The odometer's `period` names a span, not the car — pinned on its own below.
          if (screen === 'odometer' && param === 'period') continue;
          expect(CAR_PARAMS[screen], `${screen} sends «${param}»`).toContain(param);
          expect(value, `${screen}.${param}`).toBe(code);
          // …and both ways the five screens split a code list read it back as this ONE car: the
          // shared parser (accidents, violations, the roster's matcher) and a plain comma split
          // (odometer, maintenance, the roster's chips). These are copies of the two splits, not
          // the screens' own code, so a change inside one of those screens is not caught here.
          expect(splitVehicleCodeList(value), `${screen}.${param}`).toEqual([code]);
          expect(
            value.split(',').filter((c) => c !== ''),
            `${screen}.${param}`,
          ).toEqual([code]);
        }
      }
    }
  });
});

describe('«العدادات» opens the car’s WHOLE history — the span its count covers', () => {
  // The count on the row is the odometer list's own total for `vehicleCodes=<code>` with no date:
  // every reading the screen lists for that code — the registry car's, and any kept from the old
  // book under its code with no car attached. Opened bare, the odometer narrows itself to the
  // current month, and the list was shorter than the number the reader clicked.
  const odometerHref = (code = '200'): string =>
    historyHrefs(drawProfile(vehicleWith(code))).get('odometer') ?? '';

  it('sends `period=all` and NO date — never a made-up first day', () => {
    const query = queryOf(odometerHref());
    expect(query.get('period')).toBe(WHOLE_HISTORY);
    expect(query.has('from'), 'no start date').toBe(false);
    expect(query.has('to'), 'no end date').toBe(false);
    expect([...query.keys()].sort()).toEqual(['period', 'vehicleCodes']);
  });

  it('is read by the odometer’s own range as NO bound at all — not as the month', () => {
    // The very helper the screen sends its request through, fed what the link puts in the URL.
    const query = queryOf(odometerHref());
    const now = new Date('2026-10-13T09:00:00.000Z');
    const range = odometerRange(
      {
        from: query.get('from') ?? '',
        to: query.get('to') ?? '',
        period: query.get('period') ?? '',
      },
      now,
    );
    expect(range, 'both bounds empty — the request carries none').toEqual({
      from: '',
      to: '',
      defaulted: false,
    });
    // …and without `period` the same link would have been the month — the bug this fixes.
    expect(odometerRange({ from: '', to: '' }, now).defaulted).toBe(true);
  });

  it('counts with the same car filter the link sends — the code, not the id', () => {
    // Two different totals in the cache: the one asked by CODE (what the screen lists) and the
    // one asked by id (which misses the old book's rows stored under the code with no car).
    const total = (totalItems: number) => ({
      items: [],
      meta: { page: 1, pageSize: 1, totalItems, totalPages: totalItems },
    });
    const markup = drawProfile(vehicleWith('200'), (qc) => {
      qc.setQueryData(
        listKey('fleet', 'odometer', { vehicleCodes: ['200'], page: 1, pageSize: 1 }),
        total(9),
      );
      qc.setQueryData(
        listKey('fleet', 'odometer', { vehicleId: VEHICLE_ID, page: 1, pageSize: 1 }),
        total(4),
      );
    });
    expect(markup).toContain(translate('ar', 'fleet.vehicle.count.odometer', { count: '9' }));
    expect(markup).not.toContain(translate('ar', 'fleet.vehicle.count.odometer', { count: '4' }));
    // …and the filter the count asked with is the one the link carries.
    expect(queryOf(odometerHref()).getAll('vehicleCodes')).toEqual(['200']);
  });

  it('the other four rows stay as they were — no `period`, no date', () => {
    for (const [screen, href] of historyHrefs(drawProfile(vehicleWith('200')))) {
      if (screen === 'odometer') continue;
      const query = queryOf(href);
      for (const param of ['period', 'from', 'to']) {
        expect(query.has(param), `${screen} sends no «${param}»`).toBe(false);
      }
    }
  });
});

describe('every param a history row sends is one its target screen reads', () => {
  const routes = read('routes.tsx');
  const profile = read('pages/VehicleDetailPage.tsx');

  /** The page source mounted at `/fleet/<path>`, found through the route table and its imports. */
  const targetSource = (path: string): { component: string; source: string } => {
    const route = new RegExp(`path="${path}"[\\s\\S]*?<(\\w+Page) />`).exec(routes);
    const component = route?.[1];
    expect(component, `/fleet/${path} is routed to a page`).toBeDefined();
    const imported = new RegExp(
      `import \\{[^}]*\\b${component ?? ''}\\b[^}]*\\} from '\\./([^']+)'`,
    ).exec(routes);
    expect(imported, `${component ?? ''} is imported in routes.tsx`).not.toBeNull();
    return { component: component ?? '', source: read(`${imported?.[1] ?? ''}.tsx`) };
  };

  /** True when the source reads `name` off the URL's search params. */
  const readsParam = (source: string, name: string): boolean =>
    new RegExp(`\\.get\\(\\s*['"\`]${name}['"\`]\\s*\\)`).test(source);

  it('the rendered links only use params their targets read', () => {
    const hrefs = historyHrefs(drawProfile(vehicleWith('200')));
    expect(hrefs.size).toBe(5);
    for (const [screen, href] of hrefs) {
      const { component, source } = targetSource(screen);
      for (const param of queryOf(href).keys()) {
        expect(readsParam(source, param), `${component} reads «${param}» from the URL`).toBe(true);
      }
    }
  });

  it('the guard bites: the old `vehicle` name is read by none of the four lists', () => {
    for (const screen of ['odometer', 'maintenance', 'accidents', 'violations']) {
      const { component, source } = targetSource(screen);
      expect(readsParam(source, 'vehicle'), component).toBe(false);
      expect(readsParam(source, 'vehicleId'), component).toBe(false);
    }
  });

  it('the profile builds every history link from the CODE, never the id', () => {
    const block = /const HISTORY_LINKS[\s\S]*?\n\];/.exec(profile)?.[0] ?? '';
    expect(block).not.toBe('');
    expect(block).not.toMatch(/v\.id\b/);
    expect(block).not.toMatch(/\?vehicle=/);
  });
});
