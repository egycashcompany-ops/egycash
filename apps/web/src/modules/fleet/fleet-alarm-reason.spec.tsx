// «لا يوجد» used to mean six things. Now it says which one.
//
// Five separate guards stop the alarm being calculated, and a sixth situation — a cycle measured
// and found healthy — produced the same word. The reader could not tell "this car is fine" from
// "this car's type has no service interval", and had nothing to act on.
//
// The reason comes from the SERVER, and this file's real job is to keep it that way. Four of the
// five causes are invisible from the client: the interval lives on the vehicle type, and the
// latest reading, its date and the baseline counter are not in this projection at all. A screen
// guessing from what it happens to hold would state a cause that is wrong — so no screen may
// reason about it, and the text may exist in exactly one place.
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
  'baselineAboveReading',
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

  it('and they read as five DIFFERENT sentences', () => {
    // Five causes wearing one sentence would be the same defect in a new place.
    const arabic = REASONS.map((r) => translate('ar', `fleet.alarms.noAlarmReason.${r}`));
    expect(new Set(arabic).size).toBe(REASONS.length);
    // …and none of them is the old catch-all word.
    expect(arabic).not.toContain(translate('ar', 'fleet.vehicle.alarmNone'));
  });
});

describe('the new reason describes the COMPARISON, not a verdict on the baseline', () => {
  // What the guard actually knows is that two numbers do not compare. Which of them is untrue is
  // a provenance question this PR does not answer, so the sentence must not answer it either —
  // «العداد خطأ» would be a claim the code cannot support, on either number.
  const key = 'fleet.alarms.noAlarmReason.baselineAboveReading';

  it('names both sides — the recorded reading and the maintenance baseline', () => {
    expect(translate('ar', key)).toContain('قراءة العداد');
    expect(translate('ar', key)).toContain('صيانة');
    expect(translate('en', key).toLowerCase()).toContain('reading');
    expect(translate('en', key).toLowerCase()).toContain('baseline');
  });

  it('and calls neither of them wrong', () => {
    const verdicts = [/خطأ/, /خاطئ/, /غير صحيح/, /wrong/i, /invalid/i, /incorrect/i, /error/i];
    for (const word of verdicts) {
      expect(translate('ar', key), `ar states no verdict (${String(word)})`).not.toMatch(word);
      expect(translate('en', key), `en states no verdict (${String(word)})`).not.toMatch(word);
    }
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
  daysWithoutReading: 0,
  latestReading: 12000,
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

/** `count` VISITS of the SAME car — the shape that made the sentence repeat down the column. */
const maintenanceWithVisits = (a: FleetMaintenanceAlarmDto, count: number): string => {
  const qc = client([a]);
  const items = Array.from({ length: count }, (_unused, i) => ({
    id: `${VISIT}${i}`,
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
  }));
  qc.setQueryData(
    listKey('fleet', 'maintenance', {
      page: 1,
      pageSize: 25,
      sortBy: 'inDate',
      sortDir: 'desc',
      sort: 'inDate:desc',
    }),
    { items, meta: { page: 1, pageSize: 25, totalItems: count, totalPages: 1 } },
  );
  return draw(<MaintenancePage />, '/fleet/maintenance', qc);
};

const maintenance = (a: FleetMaintenanceAlarmDto): string => maintenanceWithVisits(a, 1);

/** `count` READINGS of the SAME car — five of these printed the sentence five times. */
const odometerWithLogs = (a: FleetMaintenanceAlarmDto, count: number): string => {
  const qc = client([a]);
  const items = Array.from({ length: count }, (_unused, i) => ({
    id: `log-${i}`,
    vehicleId: VEHICLE,
    vehicleCode: '150',
    date: '2026-08-20T00:00:00.000Z',
    outReading: 280_300 - i,
    inReading: null,
    km: null,
    driver1EmployeeId: null,
    driver2EmployeeId: null,
    notes: null,
    version: 0,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  }));
  qc.setQueryData(
    listKey('fleet', 'odometer', {
      page: 1,
      pageSize: 25,
      sortBy: 'date',
      sortDir: 'desc',
      sort: 'date:desc',
      vehicleCodes: undefined,
      from: MONTH.from,
      to: MONTH.to,
      alerts: undefined,
      driverEmployeeIds: undefined,
    }),
    { items, meta: { page: 1, pageSize: 25, totalItems: count, totalPages: 1 } },
  );
  return draw(<OdometerPage />, '/fleet/odometer', qc);
};

const odometer = (a: FleetMaintenanceAlarmDto): string => odometerWithLogs(a, 1);

const SCREENS = [
  ['maintenance-alarms', alarmsBoard],
  ['maintenance', maintenance],
  ['odometer', odometer],
] as const;

describe('each screen says the reason at the size its rows can carry', () => {
  // The screens differ in what ONE ROW is, and that decides how much room the reason may take.
  // A per-vehicle sentence printed on a per-visit or per-reading row repeats down the column and
  // reads as several problems instead of one — the same noise a per-row tint would have made.
  //
  // Maintenance used to carry it as a tooltip on a level column. That column was taken off the
  // grid by request («شيل دول من الجدول بتاع شاشه fleet/maintenance»), so the grid now sits with
  // the odometer: a row there is a VISIT, not a car, and the car's alarm is the board's subject.
  for (const reason of REASONS) {
    it(`«${translate('ar', `fleet.alarms.noAlarmReason.${reason}`)}» — in full on the board, absent from maintenance and from the odometer`, () => {
      const text = translate('ar', `fleet.alarms.noAlarmReason.${reason}`);
      const a = alarm({ noAlarmReason: reason });

      // One row IS one vehicle: the sentence is the answer, said once — as VISIBLE text.
      // `toContain(text)` alone cannot tell that apart from the text sitting in a `title`
      // attribute, so the shape is asserted: printed as the badge's own child, and not hidden
      // behind a hover the reader would have to discover.
      const onBoard = alarmsBoard(a);
      expect(onBoard, 'the alarms board spells it out').toContain(`>${text}<`);
      expect(onBoard, 'and does not demote it to a tooltip').not.toContain(`title="${text}"`);

      // Rows are VISITS: a visits grid stays a visits grid.
      const onMaintenance = maintenance(a);
      expect(onMaintenance, 'maintenance prints no reason at all').not.toContain(text);
      expect(onMaintenance, 'not even as a tooltip').not.toContain(`title="${text}"`);
      expect(onMaintenance, 'and not the short word either').not.toContain(
        translate('ar', 'fleet.vehicle.alarmNone'),
      );

      // Rows are READINGS: a distance column stays a distance column.
      const onOdometer = odometer(a);
      expect(onOdometer, 'the odometer prints no reason at all').not.toContain(text);
      expect(onOdometer, 'not even as a tooltip').not.toContain(`title="${text}"`);
    });
  }

  it('a car with SEVERAL readings does not repeat its reason once per reading', () => {
    // The defect this replaces: five readings of one car printed the same sentence five times.
    const text = translate('ar', 'fleet.alarms.noAlarmReason.noService');
    const markup = odometerWithLogs(alarm({ noAlarmReason: 'noService' }), 4);
    expect(markup.split('—').length - 1, 'four dashed cells').toBeGreaterThanOrEqual(4);
    expect(markup.split(text).length - 1, 'and the reason nowhere').toBe(0);
  });

  it('a car with SEVERAL visits says the reason NO times down the maintenance column', () => {
    // It used to be once per row, as a tooltip — the compromise a level column forced. With the
    // column gone the honest count is zero: three visits of one car, and not a word about why the
    // car has no alarm, because the grid no longer claims to answer that.
    const text = translate('ar', 'fleet.alarms.noAlarmReason.noInterval');
    const markup = maintenanceWithVisits(alarm({ noAlarmReason: 'noInterval' }), 3);
    expect(markup.split(`>${text}<`).length - 1, 'not printed in any cell').toBe(0);
    expect(markup.split(`title="${text}"`).length - 1, 'and not hung off one either').toBe(0);
  });

  it('a HEALTHY car is given no reason on ANY screen, and says «لا يوجد» where a level is shown', () => {
    // The distinction the change exists for: this `none` was measured, and inventing a cause for
    // it would be the same lie in the opposite direction. Only the screens that still SHOW a
    // level owe the word — maintenance stopped being one of them when its level column came off.
    // The odometer still prints the badge beside «فارق عداد الصيانة»; what it never prints is a
    // REASON.
    const SHOWS_A_LEVEL = new Set(['maintenance-alarms', 'odometer']);
    for (const [name, render] of SCREENS) {
      const markup = render(HEALTHY);
      if (SHOWS_A_LEVEL.has(name)) {
        expect(markup, `${name} says none`).toContain(translate('ar', 'fleet.vehicle.alarmNone'));
      } else {
        expect(markup, `${name} shows no level at all`).not.toContain(
          translate('ar', 'fleet.vehicle.alarmNone'),
        );
      }
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
  // The three screens that SHOW an alarm. The dashboard is no longer one of them: its landing
  // layout reads the fleet, the distance and the day, and the alarm board is one click away with
  // its own screen — so there is no reason text to get right here, and no panel to gate.
  const PAGES = ['MaintenanceAlarmsPage', 'MaintenancePage', 'OdometerPage'] as const;

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
    // order and an earlier one may have fired. Four of the five causes are not in this
    // projection at all, so any client-side inference is a guess. `baselineAboveReading` is the
    // starkest: the client holds NEITHER the reading nor the baseline counter, so it cannot even
    // form the comparison, let alone report its outcome.
    for (const page of PAGES) {
      const source = read(`pages/${page}.tsx`);
      for (const reason of REASONS) {
        expect(source, `${page} does not name ${reason}`).not.toContain(`'${reason}'`);
      }
      // Where a page shows the reason at all, it passes the SERVER's value straight through.
      // Two of the three show none, so they pass none — that is the point, not a gap. The
      // maintenance grid joined them when its level column came off.
      if (page === 'MaintenanceAlarmsPage') {
        expect(source, `${page} passes it through`).toMatch(
          /noAlarmReason=\{alarm\.noAlarmReason\}/,
        );
      } else {
        expect(source, `${page} asks for no reason`).not.toContain('noAlarmReason');
      }
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
