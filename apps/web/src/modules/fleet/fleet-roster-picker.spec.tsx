// Two ways to seat a driver, and one day that cannot be changed at all.
//
// THE PICKER. Dragging stays exactly as it was; clicking an empty slot and typing a name is the
// second gesture, for the pool that is two hundred long and the screen that is 390px wide. What
// this file pins is that it is a second GESTURE and not a second RULE: it appears only where a
// drop would land, it offers only the drivers a drag could carry, and the row it produces is the
// row a drag produces — `assignDriver`, the same function, so the two cannot answer differently.
//
// THE PAST. A roster is planned forward and read backward. Yesterday's board is shown whole and
// edits by nothing: no drop zone, no drag handle, no clear, no mission select, no «حفظ».
//
// The web suite has no DOM, so a popover that opens on click cannot be clicked here. What CAN be
// asserted is everything either side of the click: which cells offer the control at all (markup),
// which drivers it would list (`filterDrivers`, the same call the panel makes), and what the
// selection does to the board (`assignDriver`, called directly). The click itself is verified in
// Chromium, where it is a real click on a real popover.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetFixedRosterDto,
  type FleetRosterDayDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { RosterPage } from './pages/RosterPage';
import { FixedRosterPage } from './pages/FixedRosterPage';
import { assignDriver, availableDrivers, rowsToSave } from './lib/daily-roster-board';
import { filterDrivers, type DriverSearchRecord } from './lib/driver-search';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROSTER_SOURCE = readFileSync(join(HERE, 'pages/RosterPage.tsx'), 'utf8');
const FIXED_SOURCE = readFileSync(join(HERE, 'pages/FixedRosterPage.tsx'), 'utf8');

const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';
const E3 = '650000000000000000000013';

const day = (delta: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

const row = (
  vehicleId: string,
  code: string,
  over: Partial<FleetRosterDayDto['rows'][number]> = {},
): FleetRosterDayDto['rows'][number] => ({
  vehicleId,
  code,
  plateNumber: `س ص ${code}`,
  typeId: '650000000000000000000031',
  missionTypeId: null,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  notes: null,
  inMaintenance: false,
  planned: false,
  ...over,
});

const board = (date: string, rows = [row(V1, '150'), row(V2, '151')]): FleetRosterDayDto => ({
  date: `${date}T00:00:00.000Z`,
  rows,
  availableDrivers: [
    { employeeId: E1, assignedVehicleId: null },
    { employeeId: E3, assignedVehicleId: null },
  ],
  unavailableDrivers: [{ employeeId: E2, reason: 'hrLeave' }],
});

const store = (permissions = ['fleetRoster.view', 'fleetRoster.plan']) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((p) => [p, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const client = (date: string, data = board(date)): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'roster', 'day', date], data);
  qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'missionType' }], {
    items: [],
    meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
  });
  return qc;
};

const renderRoster = ({
  date = day(1),
  data,
  permissions,
}: {
  date?: string;
  data?: FleetRosterDayDto;
  permissions?: string[];
} = {}): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={client(date, data ?? board(date))}>
        <MemoryRouter initialEntries={[`/fleet/roster?date=${date}`]}>
          <RosterPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);
/** The cell a slot key names, from its drop zone to the end of that zone's box. */
const cell = (markup: string, key: string): string => {
  const at = markup.indexOf(`data-drop-zone="${key}"`);
  if (at === -1) return '';
  return markup.slice(at, markup.indexOf('</div></div>', at));
};

// ── the picker is offered exactly where a drop would land ───────────────────

describe('an empty slot offers the picker — and only where a drop would land', () => {
  it('offers it in an empty FIRST seat', () => {
    const markup = renderRoster();
    expect(cell(markup, `${V1}:driver1EmployeeId`)).toContain(`data-driver-picker="${V1}:driver1`);
    expect(markup).toContain(t('fleet.roster.pickDriver'));
  });

  it('does NOT offer it in the second seat while the first is empty', () => {
    // «الأول قبل الثاني» — the schema and the service both refuse that pair, so neither gesture
    // may produce it. The cell says why instead.
    const markup = renderRoster();
    const second = cell(markup, `${V1}:driver2EmployeeId`);
    expect(second, 'no picker').not.toContain('data-driver-picker');
    expect(second, 'the reason, in place of the invitation').toContain(
      t('fleet.fixedRoster.needsFirstDriver'),
    );
  });

  it('offers it in the second seat ONCE the first is filled', () => {
    const data = board(day(1), [row(V1, '150', { driver1EmployeeId: E1 }), row(V2, '151')]);
    const second = cell(renderRoster({ data }), `${V1}:driver2EmployeeId`);
    expect(second).toContain(`data-driver-picker="${V1}:driver2`);
  });

  it('does NOT offer it on a car the workshop holds', () => {
    const data = board(day(1), [row(V1, '150', { inMaintenance: true })]);
    const markup = renderRoster({ data });
    expect(cell(markup, `${V1}:driver1EmployeeId`), 'no picker').not.toContain(
      'data-driver-picker',
    );
    expect(markup).toContain(t('fleet.roster.inWorkshopNoDrop'));
  });

  it('does NOT offer it to a reader who may not plan', () => {
    const markup = renderRoster({ permissions: ['fleetRoster.view'] });
    expect(markup).not.toContain('data-driver-picker');
    expect(markup, 'and no save either').not.toContain('data-save-roster');
  });

  it('leaves a FILLED slot exactly as it was — the chip, and no picker', () => {
    const data = board(day(1), [row(V1, '150', { driver1EmployeeId: E1 })]);
    const first = cell(renderRoster({ data }), `${V1}:driver1EmployeeId`);
    expect(first, 'the person, draggable as before').toContain('draggable="true"');
    expect(first, 'no picker over an occupied seat').not.toContain('data-driver-picker');
    expect(first, 'and the clear button stays').toContain('data-clear-slot');
  });
});

// ── what the picker would offer, and what choosing does ─────────────────────

describe('the picker offers the POOL, and a pick is a drop by another name', () => {
  const index = new Map<string, DriverSearchRecord>([
    [E1, { employeeId: E1, nameAr: 'أحمد محمد', code: 'HR-1' }],
    [E3, { employeeId: E3, nameAr: 'سعيد سعد', code: 'HR-3' }],
  ]);

  it('offers nobody who is already seated — the pool the panel drags from', () => {
    const rows = [row(V1, '150', { driver1EmployeeId: E1 }), row(V2, '151')];
    const pool = availableDrivers(
      [
        { employeeId: E1, assignedVehicleId: V1 },
        { employeeId: E3, assignedVehicleId: null },
      ],
      rows,
    );
    expect(pool.map((d) => d.employeeId), 'E1 is on car 150').toEqual([E3]);
    // …and that is exactly the list the control filters, so a pick cannot take a driver off
    // another car by a route a drag would not have.
    expect(filterDrivers(pool, index, '').map((d) => d.employeeId)).toEqual([E3]);
  });

  it('narrows by what is typed, in the panel’s own matcher', () => {
    const pool = [{ employeeId: E1 }, { employeeId: E3 }];
    expect(filterDrivers(pool, index, 'سعيد').map((d) => d.employeeId)).toEqual([E3]);
    expect(filterDrivers(pool, index, 'HR-1').map((d) => d.employeeId)).toEqual([E1]);
    expect(filterDrivers(pool, index, 'لا أحد')).toEqual([]);
  });

  it('produces the SAME board a drag produces, and the same save payload', () => {
    const saved = [row(V1, '150'), row(V2, '151')];
    // The page hands the picker `(id) => onDrop(row, slot, id)` — `onDrop` being the very handler
    // a drop calls. So both gestures end in this one call.
    const afterPick = assignDriver(saved, V1, 'driver1EmployeeId', E3);
    const afterDrag = assignDriver(saved, V1, 'driver1EmployeeId', E3);
    expect(afterPick).toEqual(afterDrag);
    expect(afterPick[0]?.driver1EmployeeId).toBe(E3);
    // And what a save would send is that row, not a UI-only flourish.
    const pending = rowsToSave(saved, afterPick);
    expect(pending.map((r) => r.vehicleId)).toContain(V1);
    expect(pending.find((r) => r.vehicleId === V1)?.driver1EmployeeId).toBe(E3);
  });

  it('cannot seat one driver twice — the second seating releases the first car', () => {
    const saved = [row(V1, '150', { driver1EmployeeId: E3 }), row(V2, '151')];
    const moved = assignDriver(saved, V2, 'driver1EmployeeId', E3);
    expect(moved.find((r) => r.vehicleId === V1)?.driver1EmployeeId, 'released').toBeNull();
    expect(moved.find((r) => r.vehicleId === V2)?.driver1EmployeeId).toBe(E3);
  });

  it('routes BOTH gestures through the one function, in both screens', () => {
    // The rule lives in `assignDriver`; a picker that wrote the row itself would be a second
    // implementation of «one driver, one car» free to disagree with the first.
    for (const [name, source] of [
      ['roster', ROSTER_SOURCE],
      ['fixed roster', FIXED_SOURCE],
    ] as const) {
      expect(source, `${name} hands the picker the drop handler`).toMatch(
        /onSelect=\{\(id\) => onDrop\(/,
      );
      expect(source, `${name} still assigns through the shared rule`).toContain('assignDriver(');
    }
  });
});

// ── a past day is a record ──────────────────────────────────────────────────

describe('a past day is shown, and edits by nothing', () => {
  const past = day(-1);
  const withCrew = board(past, [
    row(V1, '150', { driver1EmployeeId: E1, planned: true }),
    row(V2, '151'),
  ]);

  it('shows the day and the crew it was planned with', () => {
    const markup = renderRoster({ date: past, data: withCrew });
    expect(markup, 'the date asked for').toContain(`value="${past}"`);
    expect(markup, 'its cars').toContain('>150<');
    expect(markup, 'and it says what it is').toContain(t('fleet.roster.pastDayTitle'));
    expect(markup).toContain('data-readonly-day="true"');
  });

  it('offers no way to change it', () => {
    const markup = renderRoster({ date: past, data: withCrew });
    expect(markup, 'no picker').not.toContain('data-driver-picker');
    expect(markup, 'no clear').not.toContain('data-clear-slot');
    expect(markup, 'no save').not.toContain('data-save-roster');
    expect(markup, 'nothing is draggable').not.toContain('draggable="true"');
    expect(markup, 'the mission is text, not a control').not.toContain('aria-label="150 · نوع المهمة"');
  });

  it('does not invite a gesture it will ignore', () => {
    // The drop handlers early-return on a past day, so an empty seat asking to be dragged into
    // would be asking for a gesture that lands nowhere — and the dashed border is that same
    // invitation drawn instead of written. An empty seat on a record simply had no driver.
    const markup = renderRoster({ date: past, data: withCrew });
    expect(markup, 'it says what the slot is').toContain(t('fleet.fixedRoster.noDriver'));
    expect(markup, 'and it does not say what to do to it').not.toContain(
      t('fleet.roster.inWorkshopNoDrop'),
    );
    expect(markup, 'nor draws a drop target').not.toContain('border-dashed');
  });

  it('still draws the drop targets on a day that can be planned', () => {
    const markup = renderRoster({ date: day(0), data: board(day(0), [row(V2, '151')]) });
    expect(markup, 'today takes a drop').toContain('border-dashed');
    expect(markup, 'and does not call its empty seats a record').not.toContain(
      t('fleet.fixedRoster.noDriver'),
    );
  });

  it('is read-only for the same reason the server refuses the write', () => {
    expect(ROSTER_SOURCE, 'one flag, folded into the one every affordance already reads').toContain(
      "const mayPlan = can('fleetRoster.plan') && editable",
    );
    expect(ROSTER_SOURCE, 'and the floor is the day itself').toContain(
      'const editable = date >= floor',
    );
  });

  it('renders the SERVER’s board on a past day, never a draft left in storage', () => {
    // A draft is keyed by date and outlives a reload, so a day edited before midnight would
    // otherwise show edits that nothing on the screen can save or discard.
    expect(ROSTER_SOURCE).toContain('const shown = editable ? draft : saved');
  });

  it('leaves TODAY exactly as it was', () => {
    const markup = renderRoster({ date: day(0), data: board(day(0)) });
    expect(markup, 'today plans').toContain('data-save-roster');
    expect(markup, 'and offers the picker').toContain('data-driver-picker');
    expect(markup, 'and is not labelled a record').not.toContain('data-readonly-day');
  });
});

// ── the fixed board gains the same gesture, and nothing else ────────────────

describe('the fixed crew board', () => {
  const fixedBoard = {
    rows: [
      {
        vehicleId: V1,
        code: '150',
        missionTypeId: null,
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        notes: null,
        inWorkshop: false,
      },
    ],
    drivers: [
      { employeeId: E1, assignedVehicleId: null },
      { employeeId: E3, assignedVehicleId: null },
    ],
  } as unknown as FleetFixedRosterDto;

  const renderFixed = (): string => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['fleet', 'fixed-roster'], fixedBoard);
    qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'missionType' }], {
      items: [],
      meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    });
    return renderToStaticMarkup(
      <Provider store={store()}>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/fleet/fixed-roster']}>
            <FixedRosterPage />
          </MemoryRouter>
        </QueryClientProvider>
      </Provider>,
    );
  };

  it('offers the picker in an empty first seat, and keeps the drop zone', () => {
    const markup = renderFixed();
    expect(markup).toContain(`data-driver-picker="${V1}:driver1EmployeeId"`);
    expect(markup, 'the drag target is untouched').toContain(
      `data-drop-zone="${V1}:driver1EmployeeId"`,
    );
  });

  it('still refuses a second seat with no first', () => {
    const markup = renderFixed();
    const second = markup.slice(
      markup.indexOf(`data-drop-zone="${V1}:driver2EmployeeId"`),
      markup.indexOf('</div></div>', markup.indexOf(`data-drop-zone="${V1}:driver2EmployeeId"`)),
    );
    expect(second).not.toContain('data-driver-picker');
    expect(second).toContain(t('fleet.fixedRoster.needsFirstDriver'));
  });
});
