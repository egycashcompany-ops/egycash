// What red and yellow LOOK like — decided once, and applied to the surface each screen can spare.
//
// The three screens show the same alarm and have three different things already going on in the
// place a colour would land, so "colour the alarm" is not one instruction:
//
//   • `/fleet/maintenance-alarms` — one row IS one vehicle, so the row can carry it.
//   • `/fleet/odometer` — a row is one READING, and a car has many. A row tint there would draw
//     five alarms for one car, so the tint goes on the cell's own element.
//   • `/fleet/maintenance` — the row is ALREADY green when the car has left the workshop. That is
//     a different fact about a different thing, and an alarm painted across the row would take a
//     colour that is spoken for. The tint goes inside the cell, framed by the green.
//
// What must NOT happen is each screen deciding for itself what red is. This file holds the tint to
// one definition, holds each screen to the surface it chose, and holds the green row untouched.
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
  type FleetAlarmLevel,
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
import { alarmCellTint, alarmRowTint } from './components/AlarmBadge';
import { MaintenancePage } from './pages/MaintenancePage';
import { MaintenanceAlarmsPage } from './pages/MaintenanceAlarmsPage';
import { OdometerPage } from './pages/OdometerPage';
import { currentMonthRange } from './lib/odometer-range';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

// ── 1. One definition ───────────────────────────────────────────────────────

describe('the tint is decided once', () => {
  it('flags red and yellow, and says nothing about the ordinary case', () => {
    for (const tint of [alarmRowTint, alarmCellTint]) {
      expect(tint('red')).toBeDefined();
      expect(tint('yellow')).toBeDefined();
      // `none` is not a state worth colouring — spending attention on the healthy car is how a
      // table stops being scannable.
      expect(tint('none')).toBeUndefined();
      expect(tint(undefined)).toBeUndefined();
    }
  });

  it('keeps red and yellow apart, on both surfaces', () => {
    expect(alarmRowTint('red')).not.toBe(alarmRowTint('yellow'));
    expect(alarmCellTint('red')).not.toBe(alarmCellTint('yellow'));
    expect(alarmRowTint('red')).toContain('red');
    expect(alarmRowTint('yellow')).toContain('amber');
    expect(alarmCellTint('red')).toContain('red');
    expect(alarmCellTint('yellow')).toContain('amber');
  });

  it('answers for the dark theme too, on every colour it returns', () => {
    // A tint defined only for light leaves the dark theme with the default row and no signal.
    for (const level of ['red', 'yellow'] as const) {
      expect(alarmRowTint(level)).toMatch(/dark:bg-/);
      expect(alarmCellTint(level)).toMatch(/dark:bg-/);
    }
  });

  it('the cell tint carries its own shape — it is a patch, not a full-bleed background', () => {
    // It sits inside a cell beside a badge; without padding and a radius it reads as a smear.
    for (const level of ['red', 'yellow'] as const) {
      expect(alarmCellTint(level)).toMatch(/rounded/);
      expect(alarmCellTint(level)).toMatch(/px-/);
    }
  });

  it('and no screen spells an alarm colour of its own', () => {
    // The whole point. A screen naming `bg-red-…` for an alarm is a second definition of red.
    //
    // Scoped to where an alarm is actually drawn — the column definitions and the `rowClassName`
    // — because these pages legitimately hold other colours elsewhere (the HR-filter banners are
    // amber, and have nothing to do with the maintenance alarm).
    for (const page of ['MaintenanceAlarmsPage', 'OdometerPage', 'MaintenancePage']) {
      const source = read(`pages/${page}.tsx`);
      const from = source.indexOf('const columns');
      const region = source.slice(from, source.indexOf('\n  ];', from));
      expect(region.length, `${page} has a columns block to inspect`).toBeGreaterThan(0);
      expect(region, `${page} names no colour in its columns`).not.toMatch(
        /bg-(?:red|amber|rose|yellow)-\d/,
      );
      const at = source.indexOf('rowClassName={');
      if (at !== -1) {
        expect(source.slice(at, source.indexOf('}\n', at)), `${page}'s row tint`).not.toMatch(
          /bg-(?:red|amber|rose|yellow)-\d/,
        );
      }
    }
    // …and the definition lives in exactly one module.
    const badge = read('components/AlarmBadge.tsx');
    expect((badge.match(/const ALARM_TINT/g) ?? []).length).toBe(1);
  });
});

// ── 2. Each screen tints the surface it chose ───────────────────────────────

const VEHICLE = '650000000000000000000001';
const QUIET = '650000000000000000000002';
const VISIT = '650000000000000000000091';
const MONTH = currentMonthRange(new Date());

const alarm = (over: Partial<FleetMaintenanceAlarmDto> = {}): FleetMaintenanceAlarmDto => ({
  vehicleId: VEHICLE,
  code: '150',
  level: 'red' as FleetAlarmLevel,
  remainingKm: -250,
  sinceServiceKm: 5250,
  lastServiceAt: '2026-06-01T00:00:00.000Z',
  lastServiceVisitId: VISIT,
  ...over,
});

const QUIET_ALARM = alarm({
  vehicleId: QUIET,
  code: '999',
  level: 'none',
  remainingKm: null,
  sinceServiceKm: null,
  lastServiceAt: null,
  lastServiceVisitId: null,
});

const visit = (over: Partial<FleetMaintenanceVisitDto> = {}): FleetMaintenanceVisitDto =>
  ({
    id: VISIT,
    vehicleId: VEHICLE,
    vehicleCode: '150',
    driverInEmployeeId: null,
    driverOutEmployeeId: null,
    inDate: '2026-06-01T00:00:00.000Z',
    outDate: '2026-06-02T00:00:00.000Z',
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

const log = (over: Partial<FleetOdometerLogDto> = {}): FleetOdometerLogDto =>
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
    ...over,
  }) as FleetOdometerLogDto;

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

/** The `<tr>` markup, one entry per row, so a claim can be made about the ROW and not the cell. */
const rows = (markup: string): string[] => markup.split('<tr').slice(2);

const alarmsBoard = (alarms: FleetMaintenanceAlarmDto[]): string =>
  draw(<MaintenanceAlarmsPage />, '/fleet/maintenance-alarms', client(alarms));

const maintenance = (alarms: FleetMaintenanceAlarmDto[], visits: FleetMaintenanceVisitDto[]): string => {
  const qc = client(alarms);
  qc.setQueryData(
    listKey('fleet', 'maintenance', { page: 1, pageSize: 25, sortBy: 'inDate', sortDir: 'desc' }),
    { items: visits, meta: { page: 1, pageSize: 25, totalItems: visits.length, totalPages: 1 } },
  );
  return draw(<MaintenancePage />, '/fleet/maintenance', qc);
};

const odometer = (alarms: FleetMaintenanceAlarmDto[], logs: FleetOdometerLogDto[]): string => {
  const qc = client(alarms);
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
    { items: logs, meta: { page: 1, pageSize: 25, totalItems: logs.length, totalPages: 1 } },
  );
  return draw(<OdometerPage />, '/fleet/odometer', qc);
};

describe('the alarms board tints the ROW — there, a row is a vehicle', () => {
  it('the red vehicle’s row carries it, the quiet one’s does not', () => {
    const markup = alarmsBoard([alarm(), QUIET_ALARM]);
    const [red, quiet] = rows(markup);
    expect(red).toContain(alarmRowTint('red') as string);
    expect(quiet, 'a healthy car is an ordinary row').not.toContain('bg-red');
    expect(quiet).not.toContain('bg-amber');
  });

  it('and yellow is drawn as yellow, not as a second red', () => {
    const markup = alarmsBoard([alarm({ level: 'yellow', remainingKm: 400 })]);
    expect(rows(markup)[0]).toContain(alarmRowTint('yellow') as string);
  });
});

describe('the odometer log tints the CELL — there, a row is a reading', () => {
  it('two readings of ONE red car tint two cells, and neither row', () => {
    // The point of the choice: a row tint would show five alarms for a car that has one.
    const markup = odometer(
      [alarm()],
      [log(), log({ id: 'log-2', date: '2026-08-19T00:00:00.000Z', outReading: 280_100 })],
    );
    const body = rows(markup);
    expect(body.length).toBe(2);
    for (const row of body) {
      expect(row, 'the cell is tinted').toContain(alarmCellTint('red') as string);
      // …and the row itself opens without one. Everything before the first cell is the `<tr>`.
      expect(row.slice(0, row.indexOf('<td')), 'the row is not').not.toMatch(/bg-(?:red|amber)/);
    }
  });

  it('a quiet car’s reading is tinted nowhere at all', () => {
    const markup = odometer([QUIET_ALARM], [log({ vehicleId: QUIET, vehicleCode: '999' })]);
    expect(rows(markup)[0]).not.toMatch(/bg-(?:red|amber)/);
  });
});

describe('the maintenance screen tints the CELL, and the green row is untouched', () => {
  it('a CLOSED visit on a red car stays green — and the alarm sits inside the cell', () => {
    // The decision, in one assertion: both colours are present, each on its own surface.
    const markup = maintenance([alarm()], [visit()]);
    const row = rows(markup)[0] as string;
    const beforeCells = row.slice(0, row.indexOf('<td'));
    expect(beforeCells, 'the row keeps its green').toContain('bg-emerald-50/70');
    expect(beforeCells, 'and the alarm never reaches it').not.toMatch(/bg-(?:red|amber)/);
    expect(row, 'the alarm is in the cell').toContain(alarmCellTint('red') as string);
  });

  it('an OPEN visit on a red car has no row colour at all, and still tints its cell', () => {
    const markup = maintenance([alarm()], [visit({ outDate: null })]);
    const row = rows(markup)[0] as string;
    expect(row.slice(0, row.indexOf('<td'))).not.toMatch(/bg-(?:emerald|red|amber)/);
    expect(row).toContain(alarmCellTint('red') as string);
  });

  it('the row colour is still decided by the VISIT, not by the alarm', () => {
    // Source-level, because this is the rule the brief is about: `rowClassName` here reads
    // `outDate` and nothing else.
    const source = read('pages/MaintenancePage.tsx');
    const at = source.indexOf('rowClassName={');
    const prop = source.slice(at, source.indexOf('}\n', at));
    expect(prop).toContain('outDate');
    expect(prop, 'no alarm anywhere near the row').not.toMatch(/alarm|level|Tint/i);
  });

  it('and the alarms board is the ONLY screen that tints a row', () => {
    expect(read('pages/MaintenanceAlarmsPage.tsx')).toContain('alarmRowTint');
    for (const page of ['OdometerPage', 'MaintenancePage']) {
      expect(read(`pages/${page}.tsx`), `${page} tints no row`).not.toContain('alarmRowTint');
      expect(read(`pages/${page}.tsx`), `${page} tints its cell`).toContain('alarmCellTint');
    }
  });
});

describe('colour is a second signal, never the only one', () => {
  it('every tinted surface still carries the level in WORDS', () => {
    // A reader who cannot separate the two tints must lose nothing. The badge says «أحمر».
    for (const markup of [
      alarmsBoard([alarm()]),
      maintenance([alarm()], [visit()]),
      odometer([alarm()], [log()]),
    ]) {
      expect(markup).toContain('أحمر');
    }
  });

  it('and nothing about the table’s behaviour changed', () => {
    // No row became clickable, selectable or hoverable to carry a colour.
    for (const page of ['MaintenanceAlarmsPage', 'OdometerPage', 'MaintenancePage']) {
      const source = read(`pages/${page}.tsx`);
      expect(source, `${page} adds no row click`).not.toContain('onRowClick');
      expect(source, `${page} adds no selection`).not.toContain('selectable');
    }
  });
});
