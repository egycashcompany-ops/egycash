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
// Each row's count is the number its link opens (owner, 2026-11-22: the code, not the id — and for
// «المخالفات» the rollup both violation halves draw, «أيوه صلحها»), written in Latin digits and in
// the form Arabic gives the noun for that count («حادث واحد · حادثان · 3 حوادث · 11 حادثًا»,
// «اه»). Owner, 2026-11-23: «اى ارقام خليها بالانجلش حتى لو عربى» — Latin in both languages.
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
  type FleetViolationRollupDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { detailKey, listKey } from '../../shared/lib/query-keys';
import { pluralKey } from '../../shared/lib/plural';
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

/** A history row's count phrase, as the page asks the catalogue for it: the form for `n`, Latin. */
const countOf = (
  key: 'odometer' | 'maintenance' | 'accidents' | 'violations',
  n: number,
  locale: Locale = 'ar',
): string =>
  translate(locale, pluralKey(`fleet.vehicle.count.${key}`, locale, n), {
    count: new Intl.NumberFormat('en-US').format(n),
  });

/** Every history row's count tag, keyed by the screen its link opens — exactly the tag's text. */
const rowTags = (markup: string): Map<string, string> => {
  const tags = new Map<string, string>();
  for (const match of markup.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = unescapeHtml(match[1] ?? '');
    if (!href.includes('?')) continue;
    const screen = new URL(href, 'http://profile.test').pathname.replace(/^\/fleet\//, '');
    const tag = /<span class="rounded-full[^"]*">([^<]*)<\/span>/.exec(match[2] ?? '')?.[1];
    if (tag !== undefined) tags.set(screen, unescapeHtml(tag));
  }
  return tags;
};

/** One-row page totals, as the three lists answer the count's question. */
const total = (totalItems: number) => ({
  items: [],
  meta: { page: 1, pageSize: 1, totalItems, totalPages: totalItems },
});

/** A (car, year) line of the violations rollup — what both halves of the violations screen draw. */
const rollupRow = (over: Partial<FleetViolationRollupDto> = {}): FleetViolationRollupDto => ({
  vehicleId: VEHICLE_ID,
  code: '200',
  year: 2026,
  vehicleCount: 0,
  vehicleAmount: 0,
  driverCount: 0,
  driverAmount: 0,
  totalCount: 0,
  totalAmount: 0,
  outstandingVehicleAmount: 0,
  outstandingDriverAmount: 0,
  outstandingTotalAmount: 0,
  outstandingVehicleCount: 0,
  outstandingDriverCount: 0,
  outstandingTotalCount: 0,
  rowCount: 0,
  collectedCount: 0,
  totalBeforeGrievance: 0,
  ...over,
});

/** The rollup's cache key for one car's code with no year — what the profile and its link ask. */
const rollupKey = (code: string) => [
  'fleet',
  'violations',
  'rollup',
  { year: '', vehicleCodes: code },
];

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
    expect(rowTags(markup).get('odometer')).toBe(countOf('odometer', 9));
    expect(countOf('odometer', 9)).toBe('9 قراءات');
    expect(markup).not.toContain(countOf('odometer', 4));
    // …and the filter the count asked with is the one the link carries.
    expect(queryOf(odometerHref()).getAll('vehicleCodes')).toEqual(['200']);
  });

  it('writes a record count grouped like the page’s other figures — «1,234 قراءة», Latin', () => {
    // Owner's (b), the car page consistently: «120,000» and «111,750 كم» are grouped, so a
    // history row's count is too — never «1234 قراءة», never Arabic-Indic.
    const markup = drawProfile(vehicleWith('150'), (qc) => {
      qc.setQueryData(
        listKey('fleet', 'odometer', { vehicleCodes: ['150'], page: 1, pageSize: 1 }),
        total(1234),
      );
    });
    expect(rowTags(markup).get('odometer')).toBe(countOf('odometer', 1234));
    expect(countOf('odometer', 1234)).toBe('1,234 قراءة');
    expect(markup).not.toContain('1234 قراءة');
    expect(markup).not.toContain('١٬٢٣٤');
  });

  it('«الصيانة» counts with the code its link sends too — the old book’s visits included', () => {
    // The audit's car 194: two visits on the registry car and one from the old book under its
    // code with no car attached. The maintenance screen opened by `vehicleCodes=194` lists 3; the
    // row counted by id promised 2.
    const markup = drawProfile(vehicleWith('194'), (qc) => {
      qc.setQueryData(
        listKey('fleet', 'maintenance', { vehicleCodes: ['194'], page: 1, pageSize: 1 }),
        total(3),
      );
      qc.setQueryData(
        listKey('fleet', 'maintenance', { vehicleId: VEHICLE_ID, page: 1, pageSize: 1 }),
        total(2),
      );
    });
    expect(rowTags(markup).get('maintenance')).toBe(countOf('maintenance', 3));
    expect(countOf('maintenance', 3)).toBe('3 عمليات');
    expect(markup).not.toContain(countOf('maintenance', 2));
    expect(
      queryOf(historyHrefs(drawProfile(vehicleWith('194'))).get('maintenance') ?? '').getAll(
        'vehicleCodes',
      ),
    ).toEqual(['194']);
  });

  it('«الحوادث» counts with the code its link sends too — the old book’s files included', () => {
    // Owner, 2026-11-22 («صلحهم»): the row counted the car's accidents by id while its link opens
    // `/fleet/accidents?vehicleCodes=<code>`, which also lists the old book's files under that code
    // (`vehicleClause`). Car 194: two files on the registry car, one from the old book.
    const byCode = (n: number) =>
      [
        listKey('fleet', 'accidents', { vehicleCodes: ['194'], page: 1, pageSize: 1 }),
        total(n),
      ] as const;
    const byId = (n: number) =>
      [
        listKey('fleet', 'accidents', { vehicleId: VEHICLE_ID, page: 1, pageSize: 1 }),
        total(n),
      ] as const;
    const accidents = (n: number): string => countOf('accidents', n);
    const clean = translate('ar', 'fleet.vehicle.count.accidentsClean');

    const three = drawProfile(vehicleWith('194'), (qc) => {
      qc.setQueryData(...byCode(3));
      qc.setQueryData(...byId(2));
    });
    expect(rowTags(three).get('accidents')).toBe(accidents(3));
    expect(three).not.toContain(accidents(2));
    // «اه» (owner, 2026-11-22): three accidents are «3 حوادث», not «3 حادث».
    expect(accidents(3)).toBe('3 حوادث');

    // The old book's file is the car's only accident: the row says so, never «سجل نظيف» above a
    // list that holds one.
    const one = drawProfile(vehicleWith('194'), (qc) => {
      qc.setQueryData(...byCode(1));
      qc.setQueryData(...byId(0));
    });
    expect(rowTags(one).get('accidents')).toBe(accidents(1));
    expect(accidents(1)).toBe('حادث واحد');
    expect(one).not.toContain(clean);

    // …and a car with none under its code is still «سجل نظيف», whatever the id count says.
    const none = drawProfile(vehicleWith('194'), (qc) => {
      qc.setQueryData(...byCode(0));
      qc.setQueryData(...byId(4));
    });
    expect(rowTags(none).get('accidents')).toBe(clean);
    expect(none).not.toContain(accidents(4));

    // The filter the count asked with is the one the link carries.
    expect(
      queryOf(historyHrefs(drawProfile(vehicleWith('194'))).get('accidents') ?? '').getAll(
        'vehicleCodes',
      ),
    ).toEqual(['194']);
  });

  it('the profile counts accidents by code in its source too — never by the car id', () => {
    const source = read('pages/VehicleDetailPage.tsx');
    const hook = /const useHistoryCounts[\s\S]*?\n\};\n/u.exec(source)?.[0] ?? '';
    expect(hook).not.toBe('');
    expect(hook).toMatch(
      /useAccidents\(\s*\{ vehicleCodes: \[vehicleCode\], page: 1, pageSize: 1 \},\s*can\('fleetAccident\.view'\) && vehicleCode !== '',?\s*\)/u,
    );
    expect(hook).not.toMatch(/useAccidents\(\s*one\b/u);
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

describe('«المخالفات» counts exactly what its link opens — both halves, by code', () => {
  // Owner, 2026-11-22 («أيوه صلحها»). The link opens `/fleet/violations?codes=<code>&dcodes=<code>`:
  // the company half draws the rollup for the code (`GET /fleet/violations/rollup?vehicleCodes=`),
  // the drivers half lists the code's fines, and both match the old book's rows kept under the
  // code with no car attached. The rollup's `totalCount` is the company lines' «الإجمالي» — the
  // statement rows by their «×N» plus the drivers' fines — so its sum over the car's (car, year)
  // lines is what the two halves show. The row used to count the LIST by id: documents, not fines,
  // and none of the old book's.
  it('sums the rollup the link’s halves draw — the old book’s line included', () => {
    const markup = drawProfile(vehicleWith('200'), (qc) => {
      qc.setQueryData(rollupKey('200'), [
        // The registry car's 2026: one statement «×3» (and nothing else).
        rollupRow({ year: 2026, vehicleCount: 3, totalCount: 3 }),
        // The old book's 2025 under the same code with no car: a statement «×1» and a driver fine.
        rollupRow({ vehicleId: null, year: 2025, vehicleCount: 1, driverCount: 1, totalCount: 2 }),
      ]);
      // What the row used to read: the list's documents on the car's id.
      qc.setQueryData(
        listKey('fleet', 'violations', { vehicleId: VEHICLE_ID, page: 1, pageSize: 1 }),
        total(1),
      );
    });
    expect(rowTags(markup).get('violations')).toBe(countOf('violations', 5));
    expect(countOf('violations', 5)).toBe('5 مخالفات');
    expect(markup).not.toContain(countOf('violations', 1));
    expect(markup).not.toContain('مخالفة واحدة');
    // …and the filter the count asked with is the one the link carries, on both halves.
    const query = queryOf(historyHrefs(markup).get('violations') ?? '');
    expect(query.get('codes')).toBe('200');
    expect(query.get('dcodes')).toBe('200');
  });

  it('a car with no violation line reads «0 مخالفات» — an empty rollup is a count, not a gap', () => {
    const markup = drawProfile(vehicleWith('200'), (qc) => {
      qc.setQueryData(rollupKey('200'), []);
    });
    expect(rowTags(markup).get('violations')).toBe(countOf('violations', 0));
    expect(countOf('violations', 0)).toBe('0 مخالفات');
  });

  it('the profile asks the rollup by code in its source — never the list by id', () => {
    const source = read('pages/VehicleDetailPage.tsx');
    const hook = /const useHistoryCounts[\s\S]*?\n\};\n/u.exec(source)?.[0] ?? '';
    expect(hook).not.toBe('');
    expect(hook).toMatch(
      /useViolationRollup\(\s*undefined,\s*\[vehicleCode\],\s*can\('fleetViolation\.view'\) && vehicleCode !== '',?\s*\)/u,
    );
    expect(hook).toMatch(/\.reduce\(\(sum, row\) => sum \+ row\.totalCount, 0\)/u);
    expect(hook).not.toMatch(/useViolations\(/u);
    expect(source).not.toMatch(/\buseViolations\b/u);
    // The hook takes no car id at all now: every count it asks is by the code its link sends.
    expect(hook).not.toMatch(/\bvehicleId\b/u);
  });
});

describe('each row’s count takes the form Arabic gives the noun — Latin digits', () => {
  // Owner, 2026-11-22 («اه»): «3 حادث», «14 عمليات» were wrong Arabic. The five forms come from
  // the catalogue through `pluralKey`, the custody boards' house style; zero reads as `few`.
  const EXPECTED: Record<
    number,
    Record<'odometer' | 'maintenance' | 'accidents' | 'violations', string>
  > = {
    0: {
      odometer: '0 قراءات',
      maintenance: '0 عمليات',
      accidents: 'سجل نظيف',
      violations: '0 مخالفات',
    },
    1: {
      odometer: 'قراءة واحدة',
      maintenance: 'عملية واحدة',
      accidents: 'حادث واحد',
      violations: 'مخالفة واحدة',
    },
    2: { odometer: 'قراءتان', maintenance: 'عمليتان', accidents: 'حادثان', violations: 'مخالفتان' },
    3: {
      odometer: '3 قراءات',
      maintenance: '3 عمليات',
      accidents: '3 حوادث',
      violations: '3 مخالفات',
    },
    11: {
      odometer: '11 قراءة',
      maintenance: '11 عملية',
      accidents: '11 حادثًا',
      violations: '11 مخالفة',
    },
    14: {
      odometer: '14 قراءة',
      maintenance: '14 عملية',
      accidents: '14 حادثًا',
      violations: '14 مخالفة',
    },
    100: {
      odometer: '100 قراءة',
      maintenance: '100 عملية',
      accidents: '100 حادث',
      violations: '100 مخالفة',
    },
    103: {
      odometer: '103 قراءات',
      maintenance: '103 عمليات',
      accidents: '103 حوادث',
      violations: '103 مخالفات',
    },
    1234: {
      odometer: '1,234 قراءة',
      maintenance: '1,234 عملية',
      accidents: '1,234 حادثًا',
      violations: '1,234 مخالفة',
    },
  };

  for (const [count, forms] of Object.entries(EXPECTED)) {
    const n = Number(count);
    it(`${n}: ${Object.values(forms).join(' · ')}`, () => {
      const markup = drawProfile(vehicleWith('200'), (qc) => {
        for (const screen of ['odometer', 'maintenance', 'accidents'] as const) {
          qc.setQueryData(
            listKey('fleet', screen, { vehicleCodes: ['200'], page: 1, pageSize: 1 }),
            total(n),
          );
        }
        qc.setQueryData(
          rollupKey('200'),
          n === 0 ? [] : [rollupRow({ vehicleCount: n, totalCount: n })],
        );
      });
      const tags = rowTags(markup);
      expect(Object.fromEntries(tags)).toEqual({ ...forms });
      // Latin digits only, and the masculine «many» carries its tanween on the alif (U+064B U+0627).
      for (const tag of tags.values()) expect(tag, tag).not.toMatch(/[٠-٩٫٬]/u);
      if (forms.accidents.includes('حادثًا')) expect(forms.accidents).toContain('ًا');
    });
  }

  it('English keeps its one form for every count — «1 readings» included', () => {
    for (const key of ['odometer', 'maintenance', 'accidents', 'violations'] as const) {
      const flat = {
        odometer: 'readings',
        maintenance: 'operations',
        accidents: 'accidents',
        violations: 'violations',
      }[key];
      for (const n of [0, 1, 2, 3, 11, 100, 1234]) {
        expect(countOf(key, n, 'en'), `${key} ${n}`).toBe(
          `${new Intl.NumberFormat('en-US').format(n)} ${flat}`,
        );
      }
    }
    expect(
      translate('en', pluralKey('fleet.vehicle.count.odometer', 'en', 1), { count: '1' }),
    ).toBe('1 readings');
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
