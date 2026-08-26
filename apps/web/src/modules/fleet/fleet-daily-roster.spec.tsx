// The DAILY roster board (§4.5) — the day, and the two sources that make it.
//
// This screen is the fixed board's sibling and the difference is the whole point: it has a DATE.
// Everything asserted here follows from that — the past is not plannable, a vehicle's workshop
// visit is a fact about the selected day, a driver's availability is a verdict about that day,
// and the standing crew (§2.7b) is only ever a STARTING POINT for a day nobody has planned yet.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing drags: what a drop means
// is the server's (`roster.service.ts`, covered by the integration suite), the drag ATTRIBUTES
// are read out of the markup here, and the interaction itself is verified in a browser.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type FleetRosterDayDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { RosterPage } from './pages/RosterPage';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(HERE, 'pages/RosterPage.tsx'), 'utf8');
/** The page's CODE — the header explains the rules at length and would match either way. */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const SERVICE = readFileSync(
  join(HERE, '../../../../api/src/modules/fleet/roster/roster.service.ts'),
  'utf8',
);

const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';
const MT = '650000000000000000000021';

const day = (delta: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

const row = (
  vehicleId: string,
  code: string,
  over: Partial<FleetRosterDayDto['rows'][number]> = {},
) => ({
  vehicleId,
  code,
  plateNumber: `س ص ${code}`,
  typeId: 'vt1',
  inMaintenance: false,
  missionTypeId: null,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  notes: null,
  ...over,
});

const BOARD: FleetRosterDayDto = {
  date: `${day(1)}T00:00:00.000Z`,
  rows: [
    row(V1, '150', { missionTypeId: MT, driver1EmployeeId: E1 }),
    row(V2, '151', { inMaintenance: true }),
  ],
  availableDrivers: [{ employeeId: E1, assignedVehicleId: V1 }],
  unavailableDrivers: [{ employeeId: E2, reason: 'hrLeave' }],
};

const client = (board: FleetRosterDayDto = BOARD, date = day(1)): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'roster', 'day', date], board);
  qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'missionType' }], {
    items: [
      {
        id: MT,
        kind: 'missionType',
        name: { ar: 'نقل أموال (يومي)', en: 'Cash run' },
        isActive: true,
      },
    ],
    meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
  });
  for (const [id, ar] of [
    [E1, 'أحمد محمد'],
    [E2, 'محمد محمود'],
  ] as const) {
    qc.setQueryData(['hr', 'employees', 'detail', id], {
      id,
      code: 'HR-1',
      personal: { fullNameAr: ar },
    });
  }
  return qc;
};

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = ({
  permissions = ['fleetRoster.view', 'fleetRoster.plan'],
  date = day(1),
  qc = client(),
} = {}): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/fleet/roster?date=${date}`]}>
          <RosterPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);

// ── 1. the day is a PLAN, so the past is not offered ────────────────────────

describe('the assignment date', () => {
  it('floors the picker at today — tomorrow and beyond stay open', () => {
    const markup = render();
    expect(markup, 'the picker refuses earlier days').toContain(`min="${day(0)}"`);
    expect(SOURCE, 'the floor is one function, used by picker and guard alike').toContain(
      'earliestPlannableDay()',
    );
    // Tomorrow and a far future date are ordinary.
    expect(render({ date: day(1) })).toContain(`value="${day(1)}"`);
    expect(render({ date: day(45), qc: client(BOARD, day(45)) })).toContain(`value="${day(45)}"`);
  });

  it('will not show a past day even when the URL asks for one', () => {
    // `?date=` is user-writable. Without the floor the board would render a day whose every save
    // the server refuses — an editable-looking screen that cannot save is worse than no screen.
    const markup = render({ date: day(-30), qc: client(BOARD, day(0)) });
    expect(markup, 'it lands on the floor instead').toContain(`value="${day(0)}"`);
    expect(markup).not.toContain(`value="${day(-30)}"`);
  });

  it('does not offer the step back off the floor', () => {
    const markup = render({ date: day(0), qc: client(BOARD, day(0)) });
    const prev = markup.slice(0, markup.indexOf(t('fleet.roster.date')));
    expect(prev, 'yesterday is not one button away').toContain('disabled');
  });

  it('is refused SERVER-side too — the UI is not the guard', () => {
    // The floor above is a courtesy. This is the rule.
    expect(SERVICE, 'the service compares against today').toContain(
      'const todayUtc = utcDay(new Date())',
    );
    expect(SERVICE, 'and refuses what is earlier').toContain('PAST_DATE');
    expect(
      SERVICE,
      'in the SAME utcDay the board uses — not a second date interpretation',
    ).toContain('utcDay(input.date)');
  });
});

// ── 2. the mission filter, from the catalog ─────────────────────────────────

describe('the mission-type filter', () => {
  it('is the missionType catalog, never workType', () => {
    expect(SOURCE, 'the app’s own catalog select').toContain('<CatalogSelect');
    expect(SOURCE, 'on the mission vocabulary').toContain('kind="missionType"');
    expect(SOURCE, 'the workshop’s vocabulary has no place here').not.toContain('workType');
    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    expect(api, 'and no endpoint was added for it').not.toMatch(/mission-type|missionTypes\(/);
  });

  it('narrows the board to one mission', () => {
    const both: FleetRosterDayDto = {
      ...BOARD,
      rows: [row(V1, '150', { missionTypeId: MT }), row(V2, '151', { missionTypeId: null })],
    };
    const all = render({ qc: client(both) });
    expect(all).toContain('150');
    expect(all).toContain('151');
    const filtered = renderToStaticMarkup(
      <Provider store={store(['fleetRoster.view', 'fleetRoster.plan'])}>
        <QueryClientProvider client={client(both)}>
          <MemoryRouter initialEntries={[`/fleet/roster?date=${day(1)}&mission=${MT}`]}>
            <RosterPage />
          </MemoryRouter>
        </QueryClientProvider>
      </Provider>,
    );
    const body = filtered.slice(filtered.indexOf('<tbody'), filtered.indexOf('</tbody>'));
    expect(body, 'the mission’s vehicle stays').toContain('150');
    expect(body, 'the one without it goes').not.toContain('151');
  });
});

// ── 3. counters ─────────────────────────────────────────────────────────────

describe('the day’s counters', () => {
  it('counts the projection, and names missions from the catalog', () => {
    const markup = render();
    expect(markup, 'إجمالي').toContain('data-counter="total"');
    expect(markup, 'صيانة').toContain('data-counter="workshop"');
    expect(markup, 'تشغيل').toContain('data-counter="assigned"');
    // One counter per ACTIVE catalog mission — a vocabulary nobody wrote into the code.
    expect(markup, 'the catalog’s own name').toContain('نقل أموال (يومي)');
    expect(markup, 'keyed by the catalog id').toContain(`data-counter="${MT}"`);
    expect(SOURCE, 'no hardcoded mission list').not.toMatch(/'(سفر|مسائي|محصنة|شلاتين)'/);
  });

  it('reports what the board actually holds', () => {
    const markup = render();
    // 2 vehicles, 1 in the workshop, 1 carrying a plan.
    const strip = markup.slice(markup.indexOf('data-counter="total"'), markup.indexOf('</table>'));
    expect(strip).toContain('٢');
    expect(strip).toContain('١');
  });
});

// ── 4. the two driver lists ─────────────────────────────────────────────────

describe('the driver lists', () => {
  it('stands them side by side, not one under the other', () => {
    expect(SOURCE, 'two columns').toContain('grid min-w-0 grid-cols-2');
    const markup = render();
    expect(markup).toContain(t('fleet.roster.availableTitle'));
    expect(markup).toContain(t('fleet.roster.unavailableTitle'));
  });

  it('makes an AVAILABLE driver draggable', () => {
    const markup = render();
    const card = markup.slice(markup.indexOf(`data-driver-card="${E1}"`));
    expect(card.slice(0, 200), 'the pool row is a drag source').toContain('draggable="true"');
    expect(SOURCE, 'carrying the same payload the fixed board uses').toContain('setData(DRAG_TYPE');
  });

  it('does NOT make an unavailable driver draggable, and shows WHY', () => {
    const markup = render();
    const at = markup.indexOf(`data-unavailable-driver="${E2}"`);
    expect(at, 'the unavailable driver is listed — visible, not hidden').toBeGreaterThan(-1);
    const li = markup.slice(at, markup.indexOf('</li>', at));
    expect(li, 'and cannot be picked up').not.toContain('draggable');
    // The reason is the seam's own verdict, beside the name.
    expect(li, 'the reason is right there').toContain(t('fleet.roster.reason.hrLeave'));
  });

  it('uses the seam’s five reasons — no invented vocabulary', () => {
    const seam = readFileSync(
      join(HERE, '../../../../api/src/modules/fleet/availability/driver-availability.ts'),
      'utf8',
    );
    for (const reason of [
      'noProfile',
      'profileInactive',
      'notEmployed',
      'fleetUnavailability',
      'hrLeave',
    ]) {
      expect(seam, `${reason} is the seam’s`).toContain(`'${reason}'`);
      expect(SOURCE, `${reason} is known to the page`).toContain(reason);
      expect(translate('ar', `fleet.roster.reason.${reason}`)).not.toBe(
        `fleet.roster.reason.${reason}`,
      );
    }
    expect(SOURCE, 'the page re-derives no availability of its own').not.toContain(
      'isOnApprovedLeave',
    );
  });
});

// ── 5. dropping onto the board ──────────────────────────────────────────────

describe('assigning by drag', () => {
  const CELL = SOURCE.slice(
    SOURCE.indexOf('const RosterSlotCell = ('),
    SOURCE.indexOf('export const RosterPage'),
  );

  it('declares the slot cell at module level — the drag-cancelling bug is not repeated', () => {
    const inner = [...RAW.matchAll(/\n[ \t]+const ([A-Z]\w*) = \(/g)].map((m) => m[1]);
    expect(inner, `rebuilt every render: ${inner.join(', ')}`).toEqual([]);
    expect(SOURCE).toContain('\nconst RosterSlotCell = (');
  });

  it('refuses to be a drop target when the vehicle is in the workshop', () => {
    expect(CELL, 'droppable is gated on maintenance').toContain('!row.inMaintenance');
    const markup = render();
    const zone = markup.slice(markup.indexOf(`data-drop-zone="${V2}:driver1EmployeeId"`));
    expect(zone.slice(0, 300), 'and the cell says so').toContain(
      'data-drop-disabled="maintenance"',
    );
    expect(markup, 'the vehicle is still ON the board').toContain('151');
  });

  it('asks for no click before the drag', () => {
    const chip = CELL.slice(CELL.indexOf('draggable={mayPlan}'));
    expect(chip.slice(0, 400)).not.toContain('onClick');
    expect(chip.slice(0, 400)).not.toContain('onDoubleClick');
  });

  it('writes through the EXISTING plan mutation, not a new path', () => {
    const drop = SOURCE.slice(
      SOURCE.indexOf('const dropDriver ='),
      SOURCE.indexOf('const actionButton'),
    );
    expect(drop, 'the existing mutation').toContain('plan.mutateAsync(');
    expect(drop, 'sending the whole row, as the dialog does').toContain(
      'missionTypeId: row.missionTypeId',
    );
    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    expect(api, 'no second endpoint').not.toMatch(/roster\/assign|roster\/drop/);
  });
});

// ── 6. the standing crew is a STARTING POINT, and only the server decides ───

describe('where the day comes from', () => {
  it('derives an unplanned day from the fixed crew — and never rewrites it', () => {
    expect(SERVICE, 'the standing crew is read').toContain('fleetFixedCrewRepository.findAll()');
    // Read-only by construction: the roster path calls nothing that writes that collection.
    expect(SERVICE, 'nothing on this path writes the fixed crew').not.toMatch(
      /fleetFixedCrewRepository\.(create|updateById|updateMany|deleteMany|softDelete)/,
    );
  });

  it('lets an EXISTING assignment speak for its own day', () => {
    const board = SERVICE.slice(SERVICE.indexOf('async board('), SERVICE.indexOf('async plan('));
    expect(board, 'the distinction is the document’s existence').toContain(
      'assignment !== undefined',
    );
    expect(board, 'not whether its drivers happen to be null').not.toMatch(
      /driver1EmployeeId === null[\s\S]{0,80}fixed/,
    );
  });
});
