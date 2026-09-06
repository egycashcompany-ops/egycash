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
import { describe, expect, it, vi } from 'vitest';
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
import {
  assignDriver,
  availableDrivers,
  rowsToSave,
  type DutySlot,
} from './lib/daily-roster-board';
import { rosterDraftKey } from './lib/draft-storage';
import { filterDrivers, type DriverSearchRecord } from './lib/driver-search';

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

  it('seats into the seat its own trigger names, taking the driver from the pool it is handed', () => {
    // The inputs are the PRODUCT's, not the test's: the vehicle and slot are parsed off the
    // trigger the page actually rendered, and the driver is the first of `availableDrivers` —
    // the same call the drag panel makes. So a trigger keyed to the wrong seat, or a pool that
    // stopped excluding seated drivers, changes the board this builds.
    //
    // What this does NOT claim is the wiring — that clicking an option reaches `onDrop`. The
    // panel is a popover that renders closed and this suite has no DOM to open it with, so that
    // link is proven in Chromium instead.
    const saved = [row(V1, '150'), row(V2, '151')];
    const markup = renderRoster({ date: day(1), data: board(day(1), saved) });

    // The panel is a popover and renders CLOSED, so its options are not in the markup — only the
    // trigger is, and the trigger's key is the product's own answer to "which car, which seat".
    const triggers = [...markup.matchAll(/data-driver-picker="([^"]+)"/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
    const trigger = triggers.find((k) => k.startsWith(`${V1}:`));
    expect(trigger, 'car 150 offers a first seat').toBe(`${V1}:driver1EmployeeId`);
    const [vehicleId, slot] = `${trigger}`.split(':') as [string, DutySlot];

    // And the driver comes from the pool the control is handed — `availableDrivers`, the same
    // call the drag panel makes — not from a constant chosen by the test.
    const pool = availableDrivers(board(day(1), saved).availableDrivers, saved);
    const picked = pool[0]?.employeeId as string;
    expect(picked, 'the pool the control would list').toBe(E1);

    // Exactly what the page does with them, through the rule a drop also runs.
    const seated = assignDriver(saved, vehicleId, slot, picked);
    expect(seated.find((r) => r.vehicleId === V1)?.driver1EmployeeId).toBe(picked);
    expect(seated.find((r) => r.vehicleId === V2)?.driver1EmployeeId, 'nobody else moved').toBeNull();

    // And a save carries that row — a seat the picker filled is a seat the server is told about.
    const pending = rowsToSave(saved, seated);
    expect(pending.map((r) => r.vehicleId)).toEqual([V1]);
    expect(pending[0]?.driver1EmployeeId).toBe(picked);
  });

  it('cannot seat one driver twice — the second seating releases the first car', () => {
    const saved = [row(V1, '150', { driver1EmployeeId: E3 }), row(V2, '151')];
    const moved = assignDriver(saved, V2, 'driver1EmployeeId', E3);
    expect(moved.find((r) => r.vehicleId === V1)?.driver1EmployeeId, 'released').toBeNull();
    expect(moved.find((r) => r.vehicleId === V2)?.driver1EmployeeId).toBe(E3);
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

  it('shows the SAVED crew on a past day even when a draft for that day is in storage', () => {
    // The rule under test is `shown = editable ? draft : saved`, and it is worth a real test
    // because a draft is keyed by DATE and survives a reload: a day edited at 23:55 and reopened
    // at 00:05 would otherwise present those edits as the record, with nothing on the screen able
    // to save or discard them.
    //
    // `sessionStorage` is stood up the way `draft-storage.spec.ts` already does it — the suite
    // runs in node, so the storage the draft layer reads has to be provided rather than assumed.
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    try {
      // A draft that puts a DIFFERENT driver on car 151 than the saved board has.
      const drafted = [
        row(V1, '150', { driver1EmployeeId: E1, planned: true }),
        row(V2, '151', { driver1EmployeeId: E3 }),
      ];
      store.set(rosterDraftKey(past), JSON.stringify(drafted));

      // Scoped to the SLOT, because `data-driver-chip` also appears in the available-drivers
      // panel beside the board — a page-wide match would pass for the wrong reason.
      const pastMarkup = renderRoster({ date: past, data: withCrew });
      expect(cell(pastMarkup, `${V1}:driver1EmployeeId`), 'the record’s own crew').toContain(
        `data-driver-chip="${E1}"`,
      );
      expect(cell(pastMarkup, `${V2}:driver1EmployeeId`), 'and not the draft’s').not.toContain(
        `data-driver-chip="${E3}"`,
      );

      // The same draft on a day that CAN be planned is shown — which is what makes the line above
      // a real branch rather than a draft that simply never loaded.
      const open = day(1);
      store.set(rosterDraftKey(open), JSON.stringify(drafted));
      const openMarkup = renderRoster({
        date: open,
        data: board(open, [row(V1, '150'), row(V2, '151')]),
      });
      expect(
        cell(openMarkup, `${V2}:driver1EmployeeId`),
        'a plannable day edits from its draft',
      ).toContain(`data-driver-chip="${E3}"`);
    } finally {
      vi.unstubAllGlobals();
    }
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
