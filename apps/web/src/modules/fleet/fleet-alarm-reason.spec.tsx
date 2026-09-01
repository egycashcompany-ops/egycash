// «لا يوجد» used to mean five things. Now it says which one.
//
// Four separate guards stop the alarm being calculated, and a fifth situation — a cycle measured
// and found healthy — produced the same word. The reader could not tell "this car is fine" from
// "this car's type has no service interval", and had nothing to act on.
//
// The reason comes from the SERVER, and this file's real job is to keep it that way. Three of the
// four causes are invisible from the client: the interval lives on the vehicle type, and the
// latest reading and its date are not in this projection at all. A screen guessing from what it
// happens to hold would state a cause that is wrong — so no screen may reason about it, and the
// text may exist in exactly one place.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetMaintenanceAlarmDto,
  type FleetNoAlarmReason,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { listKey } from '../../shared/lib/query-keys';
import { translate } from '../../platform/localization/i18n';
import { MaintenanceAlarmsPage } from './pages/MaintenanceAlarmsPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { OdometerPage } from './pages/OdometerPage';
import { currentMonthRange } from './lib/odometer-range';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

const REASONS: FleetNoAlarmReason[] = [
  'noInterval',
  'noReading',
  'noService',
  'readingOlderThanService',
];

// ── 1. Every reason is sayable, in both languages ───────────────────────────

describe('every reason has words', () => {
  it('in Arabic and in English, with nothing left untranslated', () => {
    for (const reason of REASONS) {
      const key = `fleet.alarms.noAlarmReason.${reason}`;
      // `translate` answers with the KEY itself when a string is missing, so "not the key" is
      // exactly the assertion that catches a forgotten translation.
      expect(translate('ar', key), `ar ${reason}`).not.toBe(key);
      expect(translate('en', key), `en ${reason}`).not.toBe(key);
    }
  });

  it('and they read as four DIFFERENT sentences', () => {
    // Four causes wearing one sentence would be the same defect in a new place.
    const arabic = REASONS.map((r) => translate('ar', `fleet.alarms.noAlarmReason.${r}`));
    expect(new Set(arabic).size).toBe(REASONS.length);
    // …and none of them is the old catch-all word.
    expect(arabic).not.toContain(translate('ar', 'fleet.vehicle.alarmNone'));
  });
});

// ── 2. The screens ──────────────────────────────────────────────────────────

const VEHICLE = '650000000000000000000001';
const VISIT = '650000000000000000000091';
const MONTH = currentMonthRange(new Date());

const alarm = (over: Partial<FleetMaintenanceAlarmDto> = {}): FleetMaintenanceAlarmDto => ({
  vehicleId: VEHICLE,
  code: '150',
  level: 'none',
  remainingKm: null,
  sinceServiceKm: null,
  lastServiceAt: null,
  lastServiceVisitId: null,
  noAlarmReason: 'noService',
  ...over,
});

/** A car whose cycle WAS measured and is fine: `none`, with figures, and no reason. */
const HEALTHY = alarm({
  level: 'none',
  remainingKm: 8000,
  sinceServiceKm: 2000,
  lastServiceAt: '2026-06-01T00:00:00.000Z',
  lastServiceVisitId: VISIT,
  noAlarmReason: null,
});

const ALL = ['fleetMaintenance.view', 'fleetOdometer.view', 'fleetVehicle.view', 'hrEmployee.view'];

const store = () =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(ALL.map((p) => [p, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const draw = (node: JSX.Element, path: string, qc: QueryClient): string =>
  renderToStaticMarkup(
    <Provider store={store()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const client = (alarms: FleetMaintenanceAlarmDto[]): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'alarms'], alarms);
  return qc;
};

const alarmsBoard = (a: FleetMaintenanceAlarmDto): string =>
  draw(<MaintenanceAlarmsPage />, '/fleet/maintenance-alarms', client([a]));

const maintenance = (a: FleetMaintenanceAlarmDto): string => {
  const qc = client([a]);
  qc.setQueryData(
    listKey('fleet', 'maintenance', { page: 1, pageSize: 25, sortBy: 'inDate', sortDir: 'desc' }),
    {
      items: [
        {
          id: VISIT,
          vehicleId: VEHICLE,
          vehicleCode: '150',
          driverInEmployeeId: null,
          driverOutEmployeeId: null,
          inDate: '2026-06-01T00:00:00.000Z',
          outDate: null,
          workshopId: 'w1',
          workTypeId: 'wt1',
          spareParts: [],
          sparePartIds: [],
          odometerAtService: 275_000,
          exitOdometer: null,
          takenInByEmployeeId: null,
          takenOutByEmployeeId: null,
          notes: null,
          version: 0,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    },
  );
  return draw(<MaintenancePage />, '/fleet/maintenance', qc);
};

const odometer = (a: FleetMaintenanceAlarmDto): string => {
  const qc = client([a]);
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
    {
      items: [
        {
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
        },
      ],
      meta: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    },
  );
  return draw(<OdometerPage />, '/fleet/odometer', qc);
};

const SCREENS = [
  ['maintenance-alarms', alarmsBoard],
  ['maintenance', maintenance],
  ['odometer', odometer],
] as const;

describe('all three screens say the reason, and say the same one', () => {
  for (const reason of REASONS) {
    it(`«${translate('ar', `fleet.alarms.noAlarmReason.${reason}`)}» reaches every screen`, () => {
      for (const [name, render] of SCREENS) {
        const markup = render(alarm({ noAlarmReason: reason }));
        expect(markup, `${name} states the reason`).toContain(
          translate('ar', `fleet.alarms.noAlarmReason.${reason}`),
        );
        // …and does not fall back to the word that hid it.
        expect(markup, `${name} drops the catch-all`).not.toContain(
          translate('ar', 'fleet.vehicle.alarmNone'),
        );
      }
    });
  }

  it('a HEALTHY car keeps «لا يوجد» and is given no reason', () => {
    // The distinction the change exists for: this `none` was measured, and inventing a cause for
    // it would be the same lie in the opposite direction.
    for (const [name, render] of SCREENS) {
      const markup = render(HEALTHY);
      expect(markup, `${name} says none`).toContain(translate('ar', 'fleet.vehicle.alarmNone'));
      for (const reason of REASONS) {
        expect(markup, `${name} invents no cause`).not.toContain(
          translate('ar', `fleet.alarms.noAlarmReason.${reason}`),
        );
      }
    }
  });
});

// ── 3. Where the reason may and may not live ────────────────────────────────

describe('the reason is the server’s, and is written in ONE place', () => {
  const PAGES = [
    'MaintenanceAlarmsPage',
    'MaintenancePage',
    'OdometerPage',
    'FleetDashboardPage',
  ] as const;

  it('no page writes the text', () => {
    for (const page of PAGES) {
      expect(read(`pages/${page}.tsx`), `${page} names no reason string`).not.toContain(
        'noAlarmReason.',
      );
    }
    // The one place that does.
    expect(read('components/AlarmBadge.tsx')).toContain('fleet.alarms.noAlarmReason.');
  });

  it('and no page DERIVES the reason — it only passes the server’s through', () => {
    // The trap: `lastServiceAt === null` looks like it proves "no service", but the guards run in
    // order and an earlier one may have fired. Three of the four causes are not in this
    // projection at all, so any client-side inference is a guess.
    for (const page of PAGES) {
      const source = read(`pages/${page}.tsx`);
      for (const reason of REASONS) {
        expect(source, `${page} does not name ${reason}`).not.toContain(`'${reason}'`);
      }
      // (The «آخر صيانة» column legitimately tests `lastServiceAt` — it is describing its own
      //  field, not inferring why the alarm is missing. What must not happen is a page turning
      //  that, or anything else it holds, into a REASON — which the checks above and below
      //  forbid: no reason literal, no reason string, and the server's value passed through.)
      expect(source, `${page} passes it through`).toMatch(
        /noAlarmReason=\{alarm\.noAlarmReason\}/,
      );
    }
  });

  it('the badge decides nothing either — it reads the field and looks up a word', () => {
    const badge = read('components/AlarmBadge.tsx');
    for (const reason of REASONS) {
      expect(badge, `no branch on ${reason}`).not.toContain(`=== '${reason}'`);
    }
    // A reason is shown when there IS one, and the catch-all only when there is not.
    expect(badge).toContain('noAlarmReason === null');
  });
});

describe('PR #381’s colours are untouched by this', () => {
  it('a reason is text, never a tint — `none` stays uncoloured whatever the cause', () => {
    const badge = read('components/AlarmBadge.tsx');
    const tint = badge.slice(badge.indexOf('const ALARM_TINT'));
    const map = tint.slice(0, tint.indexOf('};') + 2);
    expect(map, 'the tint map still knows only red and yellow').not.toContain('noAlarmReason');
    for (const reason of REASONS) expect(map).not.toContain(reason);
  });
});
