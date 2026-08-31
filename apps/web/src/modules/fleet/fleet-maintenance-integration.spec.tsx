// ONE alarm, three screens.
//
// `/fleet/maintenance`, `/fleet/maintenance-alarms` and `/fleet/odometer` each show the state of a
// vehicle's maintenance cycle. The rule behind it lives in exactly one place — `computeAlarm`, in
// the API — and these screens are readers of its projection, never second implementations of it.
//
// What this file guards is precisely that: the three read the SAME endpoint through the SAME hook
// and the SAME query key, and print the SAME numbers for the same car. A future change to the
// rule then moves all three at once, because there is only one thing to change. The rule's own
// arithmetic is proven in `apps/api/.../maintenance-alarm.spec.ts` and in the integration suite;
// nothing here re-states it.
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
  type FleetMaintenanceAlarmDto,
  type FleetMaintenanceVisitDto,
  type FleetOdometerLogDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { listKey } from '../../shared/lib/query-keys';
import { MaintenancePage } from './pages/MaintenancePage';
import { MaintenanceAlarmsPage } from './pages/MaintenanceAlarmsPage';
import { OdometerPage } from './pages/OdometerPage';
import { currentMonthRange } from './lib/odometer-range';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');
const MAINTENANCE = read('pages/MaintenancePage.tsx');
const ALARMS = read('pages/MaintenanceAlarmsPage.tsx');
const ODOMETER = read('pages/OdometerPage.tsx');
const API = read('api/fleet-api.ts');
const QUERIES = read('api/fleet-queries.ts');

// The odometer screen opens on the current month; its query key carries that range.
const MONTH = currentMonthRange(new Date());

const VEHICLE = '650000000000000000000001';
const VISIT = '650000000000000000000091';

/** One car, mid-cycle and overdue — the figures every screen must agree on. */
const ALARM: FleetMaintenanceAlarmDto = {
  vehicleId: VEHICLE,
  code: '150',
  level: 'red',
  remainingKm: -250,
  sinceServiceKm: 5250,
  lastServiceAt: '2026-06-01T00:00:00.000Z',
  lastServiceVisitId: VISIT,
};

const visit = (over: Partial<FleetMaintenanceVisitDto> = {}): FleetMaintenanceVisitDto =>
  ({
    id: VISIT,
    vehicleId: VEHICLE,
    vehicleCode: '150',
    driverInEmployeeId: null,
    driverOutEmployeeId: null,
    inDate: '2026-06-01T00:00:00.000Z',
    outDate: '2026-06-01T00:00:00.000Z',
    workshopId: 'w1',
    workTypeId: 'wt1',
    spareParts: [],
    sparePartIds: [],
    odometerAtService: 275_000,
    exitOdometer: 275_050,
    takenInByEmployeeId: null,
    takenOutByEmployeeId: null,
    notes: null,
    version: 0,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  }) as FleetMaintenanceVisitDto;

const log = (): FleetOdometerLogDto =>
  ({
    id: 'log-1',
    vehicleId: VEHICLE,
    vehicleCode: '150',
    date: '2026-08-20T00:00:00.000Z',
    outReading: 280_300,
    inReading: null,
    km: null,
    driver1EmployeeId: null,
    driver2EmployeeId: null,
    notes: null,
    version: 0,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  }) as FleetOdometerLogDto;

const ALL = ['fleetMaintenance.view', 'fleetOdometer.view', 'fleetVehicle.view', 'hrEmployee.view'];

const me = (permissions: string[]): MeDto =>
  ({
    id: 'u1',
    permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
  }) as unknown as MeDto;

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

/**
 * A client seeded with the alarm under the key the SHARED hook reads.
 *
 * Deliberately seeded once, under one key, for all three screens: if any of them asked for the
 * projection differently it would find nothing here and print dashes, and the tests below would
 * fail. That is the coupling being tested.
 */
const client = (alarms: FleetMaintenanceAlarmDto[] = [ALARM]): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'odometer', 'alarms'], alarms);
  return qc;
};

const render = (node: JSX.Element, path: string, qc: QueryClient, permissions = ALL): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path.split('?')[0] as string} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

/** Seed a maintenance page that has both its visits and the shared alarm. */
const maintenance = (alarms: FleetMaintenanceAlarmDto[] = [ALARM], visits = [visit()]): string => {
  const qc = client(alarms);
  qc.setQueryData(
    listKey('fleet', 'maintenance', {
      page: 1,
      pageSize: 25,
      sortBy: 'inDate',
      sortDir: 'desc',
    }),
    { items: visits, meta: { page: 1, pageSize: 25, totalItems: visits.length, totalPages: 1 } },
  );
  return render(<MaintenancePage />, '/fleet/maintenance', qc);
};

describe('there is exactly ONE alarm implementation', () => {
  it('no screen computes a level, a threshold or a remainder of its own', () => {
    // The arithmetic — `interval − (reading − baseline)` — and the yellow/red comparison belong to
    // the server. A screen that reproduced either would be a second source of truth by definition.
    for (const [name, source] of [
      ['maintenance', MAINTENANCE],
      ['alarms', ALARMS],
      ['odometer', ODOMETER],
    ] as const) {
      expect(source, `${name} does not hold an interval`).not.toContain('maintenanceIntervalKm');
      expect(source, `${name} does not threshold`).not.toMatch(/yellowKm|redKm/);
      // Nor by any other spelling: a screen that compares the remainder to a number of its own
      // has taken the yellow/red decision back off the server, whatever it calls the constant.
      expect(source, `${name} compares the remainder to no number of its own`).not.toMatch(
        /remainingKm\s*(?:!==|===|<=?|>=?)\s*-?\d/,
        // (zero is not a threshold — reading the SIGN is presentation, and lives in `RemainingKm`)
      );
      // The figures are READ off the projection, never bound to a local of the same name — a
      // `const remainingKm = …` on a screen is where a second implementation would start.
      expect(source, `${name} keeps no figure of its own`).not.toMatch(
        /\b(?:const|let|var)\s+(?:remainingKm|sinceServiceKm)\s*=[^=]/,
      );
      // And nothing on a screen does arithmetic with a workshop counter: that subtraction —
      // `latestReading − odometerAtService` — IS the rule, and it belongs to the server.
      expect(source, `${name} does not subtract a baseline`).not.toMatch(
        /(?:odometerAtService|exitOdometer|outReading)\s*[-+]\s|[-+]\s*(?:odometerAtService|exitOdometer)\b/,
      );
    }
  });

  it('all three read the SAME hook', () => {
    for (const [name, source] of [
      ['maintenance', MAINTENANCE],
      ['alarms', ALARMS],
      ['odometer', ODOMETER],
    ] as const) {
      // CALLS it — a mention in a comment or a stale import is not a reader.
      expect(source, `${name} reads the shared projection`).toMatch(/useMaintenanceAlarms\(/);
      // …and holds no second fetch of its own beside it.
      expect(source, `${name} opens no query of its own`).not.toMatch(/useQuery\(\s*\{/);
    }
  });

  it('which is ONE endpoint and ONE query key', () => {
    // One `listMaintenanceAlarms` in the api surface, one query key in the hook: three readers
    // therefore share a cache entry and cannot hold different answers for the same car.
    expect((API.match(/export const listMaintenanceAlarms/g) ?? []).length).toBe(1);
    expect(API).toContain("get<FleetMaintenanceAlarmDto[]>('/fleet/odometer/alarms')");
    expect(QUERIES, "and MODULE is what the seeds below assume").toContain("const MODULE = 'fleet'");
    expect((QUERIES.match(/\[MODULE, 'odometer', 'alarms'\]/g) ?? []).length).toBe(1);
  });

  it('draws a level ONE way — the badge is a component, not three copies', () => {
    for (const source of [MAINTENANCE, ALARMS, ODOMETER]) {
      expect(source).toContain('AlarmBadge');
      // The tone decision itself lives in the component; no screen re-derives it.
      expect(source).not.toMatch(/level === 'red' \? 'danger'/);
    }
  });
});

describe('the three screens agree about one vehicle', () => {
  const alarmsBoard = (): string => {
    const qc = client();
    return render(<MaintenanceAlarmsPage />, '/fleet/maintenance-alarms', qc);
  };
  const odometer = (): string => {
    const qc = client();
    qc.setQueryData(
      listKey('fleet', 'odometer', {
        page: 1,
        pageSize: 25,
        sortBy: 'date',
        sortDir: 'desc',
        vehicleCodes: undefined,
        from: MONTH.from,
        to: MONTH.to,
        alerts: undefined,
        driverEmployeeIds: undefined,
      }),
      { items: [log()], meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 } },
    );
    return render(<OdometerPage />, '/fleet/odometer', qc);
  };

  it('shows the same LEVEL on all three', () => {
    // «أحمر» — one word, three screens, one source.
    const red = 'أحمر';
    expect(maintenance(), 'maintenance').toContain(red);
    expect(alarmsBoard(), 'alarms board').toContain(red);
    expect(odometer(), 'odometer').toContain(red);
  });

  it('shows the same SINCE-SERVICE distance where it is shown', () => {
    const since = '٥٬٢٥٠';
    expect(maintenance(), 'maintenance').toContain(since);
    expect(alarmsBoard(), 'alarms board').toContain(since);
    expect(odometer(), 'odometer').toContain(since);
  });

  it('shows the same OVERDUE distance, as overdue and not as a negative number', () => {
    const overdue = '٢٥٠';
    for (const [name, markup] of [
      ['maintenance', maintenance()],
      ['alarms board', alarmsBoard()],
    ] as const) {
      expect(markup, name).toContain(overdue);
      expect(markup, `${name} never prints a bare minus`).not.toContain('-٢٥٠');
    }
  });

  it('shows the same LAST SERVICE date on the two screens that carry it', () => {
    expect(maintenance()).toContain('٢٠٢٦');
    expect(alarmsBoard()).toContain('٢٠٢٦');
  });
});

describe('the maintenance screen and the baseline visit', () => {
  it('marks the visit that IS the current baseline', () => {
    expect(maintenance()).toContain('أساس الإنذار');
  });

  it('does NOT mark a visit that is not the baseline', () => {
    const other = visit({ id: '650000000000000000000092' });
    expect(maintenance([ALARM], [other])).not.toContain('أساس الإنذار');
  });

  it('marks nothing when there is no counted service yet', () => {
    const noBaseline: FleetMaintenanceAlarmDto = {
      ...ALARM,
      level: 'none',
      remainingKm: null,
      sinceServiceKm: null,
      lastServiceAt: null,
      lastServiceVisitId: null,
    };
    const markup = maintenance([noBaseline]);
    expect(markup).not.toContain('أساس الإنذار');
    expect(markup, 'and it says so, in the alarms board’s own words').toContain(
      'لا صيانة محسوبة بعد',
    );
  });

  it('takes the mark from the SERVER’s id, never from its own guess at the last visit', () => {
    // A client-side "find the newest closed counting visit" would drift from the figures beside
    // it the moment the page holds a different slice of the visits than the aggregate saw.
    expect(MAINTENANCE).toContain('alarm.lastServiceVisitId === visit.id');
    expect(MAINTENANCE, 'no local baseline search').not.toMatch(/outDate !== null &&.*countsFor/);
  });
});

describe('a vehicle with no alarm data', () => {
  it('dashes the columns rather than inventing a level', () => {
    // The car has visits but the projection knows nothing about it — no rule, no readings, or no
    // counted service. Printing «لا يوجد» there would claim the cycle is healthy.
    const markup = maintenance([]);
    expect(markup).toContain('—');
    expect(markup).not.toContain('أحمر');
  });
});
