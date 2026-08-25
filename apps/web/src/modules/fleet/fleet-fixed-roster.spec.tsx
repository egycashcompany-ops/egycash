// The fixed-crew screen (الطقم الثابت), and the three things it must NOT have.
//
// This screen is a sibling of the daily roster, so most of the risk is in the difference rather
// than the likeness: a date that crept back in, an unavailable bucket copied along with the
// layout, or a save that quietly writes without being asked. Each is asserted directly, and the
// daily roster is asserted to still have all three — a regression there would be invisible from
// this file otherwise.
//
// The web suite runs with `environment: 'node'` and no jsdom, so nothing drags: what a drop
// MEANS is tested in `lib/fixed-roster-board.spec.ts`, the drag ATTRIBUTES are read out of the
// markup here, and the interaction itself is verified in a browser.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SaveFleetFixedRosterSchema,
  type FleetFixedCrewRowDto,
  type FleetFixedRosterDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { FixedRosterPage } from './pages/FixedRosterPage';
import { changedRows } from './lib/fixed-roster-board';

/** Real 24-hex ids: the save payload is parsed with the REAL schema, which demands ObjectIds. */
const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(HERE, 'pages/FixedRosterPage.tsx'), 'utf8');
/**
 * The page's CODE, with comments removed.
 *
 * The claims below are about what the screen DOES — no date reaches the server, no availability
 * verdict is read. The file's header discusses both at length, precisely to explain why they are
 * absent, so matching raw source would fail on its own explanation.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const ROSTER = readFileSync(join(HERE, 'pages/RosterPage.tsx'), 'utf8');

const row = (
  vehicleId: string,
  code: string,
  d1: string | null = null,
  d2: string | null = null,
): FleetFixedCrewRowDto => ({
  vehicleId,
  code,
  plateNumber: `س ص ${code}`,
  typeId: 'vt1',
  inMaintenance: false,
  driver1EmployeeId: d1,
  driver2EmployeeId: d2,
});

const BOARD: FleetFixedRosterDto = {
  rows: [row(V1, '150'), row(V2, '151')],
  drivers: [
    { employeeId: E1, assignedVehicleId: null },
    { employeeId: E2, assignedVehicleId: null },
  ],
};

const ALL = ['fleetRoster.view', 'fleetRoster.plan'];

const client = (board: FleetFixedRosterDto = BOARD): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'fixed-roster'], board);
  for (const [id, code, ar] of [
    [E1, 'HR-1', 'أحمد محمد'],
    [E2, 'HR-2', 'محمد محمود'],
  ] as const) {
    qc.setQueryData(['hr', 'employees', 'detail', id], { id, code, personal: { fullNameAr: ar } });
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

const render = ({ permissions = ALL, route = '/fleet/fixed-roster', qc = client() } = {}): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[route]}>
          <FixedRosterPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);
/** The table body — where the vehicles and their crews live. */
const tbody = (markup: string): string =>
  markup.slice(markup.indexOf('<tbody'), markup.indexOf('</tbody>'));
/** The header cells, in document order — the column contract. */
const headers = (markup: string): string[] =>
  [
    ...markup
      .slice(markup.indexOf('<thead'), markup.indexOf('</thead>'))
      .matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g),
  ].map((m) => (m[1] as string).replace(/<[^>]*>/g, '').trim());

/** Every element that declares itself a drop zone, by the vehicle:slot it stands for. */
const dropZones = (markup: string): string[] =>
  [...markup.matchAll(/data-drop-zone="([^"]*)"/g)].map((m) => m[1] as string);
const driverCards = (markup: string): string[] =>
  [...markup.matchAll(/data-driver-card="([^"]*)"/g)].map((m) => m[1] as string);

// ── 1. What the screen IS ───────────────────────────────────────────────────

describe('the fixed-crew screen', () => {
  it('is titled «الطقم الثابت»', () => {
    expect(t('fleet.nav.fixedRoster')).toBe('الطقم الثابت');
    expect(render()).toContain('الطقم الثابت');
  });

  it('gives every vehicle exactly two slots, first driver and second', () => {
    const markup = render();
    expect(dropZones(markup)).toEqual([
      `${V1}:driver1EmployeeId`,
      `${V1}:driver2EmployeeId`,
      `${V2}:driver1EmployeeId`,
      `${V2}:driver2EmployeeId`,
    ]);
    expect(markup).toContain(t('fleet.odometer.fields.driver1'));
    expect(markup).toContain(t('fleet.odometer.fields.driver2'));
  });

  it('is a TABLE with the seven roster columns, in this order', () => {
    // The screen reads as another Fleet roster board, so the column list is the daily board's
    // own — minus its date, which this one does not have.
    expect(headers(render())).toEqual([
      t('fleet.odometer.columns.vehicle'),
      t('fleet.vehicles.columns.status'),
      t('fleet.roster.fields.mission'),
      t('fleet.odometer.fields.driver1'),
      t('fleet.odometer.fields.driver2'),
      t('fleet.attendance.fields.notes'),
      t('fleet.vehicles.columns.actions'),
    ]);
  });

  it('names each vehicle by code and plate, as the daily board does', () => {
    const body = tbody(render());
    expect(body).toContain('150');
    expect(body).toContain('س ص 150');
  });

  it('leaves mission and notes as an honest dash — a standing crew stores neither', () => {
    // §2.7b is the two driver slots and nothing else. The columns are there for the likeness;
    // inventing a value for a fact the row does not hold would be worse than the dash.
    expect(tbody(render())).toContain('—');
    expect(SOURCE).toMatch(/key: 'mission',[\s\S]{0,120}render: \(\) => dash/);
    expect(SOURCE).toMatch(/key: 'notes',[\s\S]{0,120}render: \(\) => dash/);
  });

  it('contains its own horizontal overflow — the page never scrolls sideways for it', () => {
    // `DataTable` wraps itself in `overflow-x-auto`; using it is what keeps 390px honest.
    expect(SOURCE, 'the board is the shared table').toContain('<DataTable');
    expect(readFileSync(join(HERE, '../../shared/ui/DataTable.tsx'), 'utf8')).toContain(
      'overflow-x-auto',
    );
  });

  it('asks for a driver in an empty slot instead of showing a blank box', () => {
    expect(render()).toContain(t('fleet.fixedRoster.dropHere'));
    expect(t('fleet.fixedRoster.dropHere')).toBe('اسحب السائق هنا');
  });

  it('shows a filled slot as the person, not the id', () => {
    const markup = render({ qc: client({ ...BOARD, rows: [row(V1, '150', E1), row(V2, '151')] }) });
    expect(markup).toContain('أحمد محمد');
    expect(markup).not.toContain(`>${E1}<`);
  });

  it('lists every driver as a draggable card', () => {
    const markup = render();
    expect(driverCards(markup)).toEqual([E1, E2]);
    // Each card declares itself draggable — without the attribute a dragstart never fires.
    for (const card of [E1, E2]) {
      const at = markup.indexOf(`data-driver-card="${card}"`);
      expect(markup.slice(at, at + 200), `${card} is draggable`).toContain('draggable="true"');
    }
  });

  it('leaves no placeholder unsubstituted — the catalogue interpolates {{name}}, not {name}', () => {
    // A single-brace placeholder is silently passed through by `translate`, so the screen would
    // print the template at the reader. Nothing about that is visible from a typecheck.
    const markup = render();
    expect(markup).not.toMatch(/\{\{?\w+\}?\}/);
    expect(markup, 'the summary really did count').toMatch(/٢|2/);
  });

  it('names both drivers in the pool', () => {
    const markup = render();
    expect(markup).toContain('أحمد محمد');
    expect(markup).toContain('محمد محمود');
  });
});

// ── 2. What the screen must NOT have ────────────────────────────────────────

describe('what the fixed crew is not', () => {
  it('has NO date — not a picker, not a parameter, not a word', () => {
    const markup = render();
    expect(markup, 'no date input').not.toContain('type="date"');
    expect(markup).not.toContain(t('fleet.roster.date'));
    expect(markup).not.toContain(t('fleet.roster.prevDay'));
    expect(markup).not.toContain(t('fleet.roster.nextDay'));
    // And nothing in the source reaches for one, so no date can travel to the server either.
    expect(SOURCE).not.toContain('toISOString');
    expect(SOURCE).not.toMatch(/\bdate\b/i);
  });

  it('has NO unavailable half — the pool is one list', () => {
    const markup = render();
    expect(markup).not.toContain(t('fleet.roster.unavailableTitle'));
    expect(markup).not.toContain(t('fleet.roster.unavailableHint'));
    expect(SOURCE, 'the screen never reads an availability verdict').not.toContain('unavailable');
    expect(SOURCE).not.toContain('reason');
  });

  it('shows every driver the board sent, undivided', () => {
    const many: FleetFixedRosterDto = {
      rows: BOARD.rows,
      drivers: [E1, E2].map((employeeId) => ({ employeeId, assignedVehicleId: null })),
    };
    expect(driverCards(render({ qc: client(many) }))).toHaveLength(many.drivers.length);
  });
});

// ── 2b. The pool is the drivers you can still place ─────────────────────────

describe('the available-driver pool', () => {
  // The pool answers "who can I still put somewhere", so a driver the board already seats leaves
  // it — immediately, from the DRAFT, with no round trip. That is a UI list, and leaving it is
  // not disappearing: the driver keeps their profile, keeps their row on the board, and comes
  // back the moment a slot is cleared. The tests below hold both halves of that.
  const CREWED: FleetFixedRosterDto = {
    rows: [row(V1, '150', E1), row(V2, '151')],
    drivers: [
      { employeeId: E1, assignedVehicleId: V1 },
      { employeeId: E2, assignedVehicleId: null },
    ],
  };

  it('drops an assigned driver OUT of the pool, and keeps them on the board', () => {
    const markup = render({ qc: client(CREWED) });
    expect(driverCards(markup), 'only the unseated one is offered').toEqual([E2]);
    // Left the list, not the screen: they are in their slot, by name.
    expect(tbody(markup)).toContain('أحمد محمد');
  });

  it('returns a driver to the pool when the board seats them nowhere', () => {
    const free: FleetFixedRosterDto = {
      rows: [row(V1, '150'), row(V2, '151')],
      drivers: CREWED.drivers,
    };
    expect(driverCards(render({ qc: client(free) }))).toEqual([E1, E2]);
  });

  it('derives the pool from the DRAFT, so a drag changes it with no round trip', () => {
    // Rendering the server's list raw would leave an assigned driver sitting in the pool until
    // the next fetch; adjusting the list step by step would drift. It is computed from the seats.
    expect(SOURCE).toContain('availableDrivers(boardQuery.data?.drivers ?? [], draft)');
    expect(SOURCE, 'the pool renders the derived list').toContain('pool.map((driver)');
    expect(SOURCE, 'and never the raw server array').not.toContain('boardQuery.data.drivers.map');
  });

  it('says «سيارة أخرى» for a driver fixed to a car outside this reader’s scope', () => {
    // The board carries only the vehicles the reader may see. Calling such a driver free would
    // be false, and it would invite a drag the server then refuses — the releasing row is one
    // this client cannot even send.
    const OUT_OF_SCOPE = '650000000000000000000099';
    const markup = render({
      qc: client({
        rows: [row(V1, '150'), row(V2, '151')],
        drivers: [
          { employeeId: E1, assignedVehicleId: OUT_OF_SCOPE },
          { employeeId: E2, assignedVehicleId: null },
        ],
      }),
    });
    const at = markup.indexOf(`data-driver-card="${E1}"`);
    const card = markup.slice(at, markup.indexOf('</li>', at));
    expect(card, 'held elsewhere, and said so').toContain(t('fleet.roster.otherVehicle'));
    expect(card, 'not claimed as free').not.toContain(t('fleet.fixedRoster.unassigned'));

    // ...while a driver the board really does show as free still reads as free.
    const free = markup.indexOf(`data-driver-card="${E2}"`);
    expect(markup.slice(free, markup.indexOf('</li>', free))).toContain(
      t('fleet.fixedRoster.unassigned'),
    );
  });

  it('shrinks as the board fills', () => {
    expect(driverCards(render())).toHaveLength(2);
    expect(driverCards(render({ qc: client(CREWED) })), 'one is now seated').toHaveLength(1);
  });

  it('reaches the server through exactly two functions — read the board, save the board', () => {
    // Named precisely rather than by keyword: `patch()` legitimately calls
    // URLSearchParams.delete, and a keyword match would either miss the real thing or trip on
    // that. What matters is the SURFACE the page imports from the api layer.
    const imports = /import \{([^}]*)\} from '\.\.\/api\/fleet-queries';/.exec(SOURCE)?.[1] ?? '';
    expect(
      imports
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x !== '')
        .sort(),
    ).toEqual(['useFixedRoster', 'useSaveFixedRoster']);
    // No other api module is reached at all — not the drivers api, not HR.
    expect(SOURCE, 'no second api import').not.toMatch(/from '\.\.\/api\/fleet-api'/);
    expect(SOURCE).not.toMatch(/hr\/|employee-api|driver-api/);

    // And the two functions it does use touch one endpoint each, neither of them a DELETE.
    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    // Bounded to THIS feature's two declarations — the rest of the file serves other screens
    // and legitimately has delete verbs of its own.
    const from = api.indexOf('export const getFixedRoster');
    const fixed = api.slice(from, api.indexOf('\n\n', from));
    expect(fixed).toContain("get<FleetFixedRosterDto>('/fleet/fixed-roster')");
    expect(fixed).toContain(
      "post<FleetFixedRosterDto & { changedCount: number }>('/fleet/fixed-roster'",
    );
    expect(fixed, 'no delete verb in this feature’s client').not.toMatch(/\bdel</);
  });
});

// ── 2c. The same person is on a crew once ───────────────────────────────────

describe('the same-driver rule', () => {
  // The rule itself — one person per crew, one seat per person — is arithmetic over rows, and
  // `fixed-roster-board.spec.ts` exercises every shape of it. What belongs HERE is that the page
  // still defers to that arithmetic instead of keeping a second, drifting copy of the rule.
  const drop = (): string =>
    SOURCE.slice(SOURCE.indexOf('const drop = ('), SOURCE.indexOf('const commit'));

  it('hands every drop to the board and writes whatever comes back', () => {
    expect(drop(), 'the board decides').toContain(
      'assignDriver(draft, vehicleId, slot, employeeId)',
    );
    expect(drop(), 'and the answer is kept').toContain('setDraft(');
  });

  it('turns no drop away — a slot change is a move, not an error to explain', () => {
    // The screen used to refuse a drop onto the other slot of the same car, forcing the user to
    // clear the slot and drag again. Nothing in the handler may reject a drop any more.
    expect(drop(), 'no refusal branch').not.toMatch(/=== null/);
    expect(drop(), 'no early return').not.toMatch(/\breturn;/);
    expect(drop(), 'nothing to apologise for').not.toContain('toast.error');
  });

  it('left no orphan message behind in either catalogue', () => {
    // A key nothing sends is a key that rots. Both spellings go when the refusal goes.
    for (const locale of ['ar', 'en'] as const) {
      const key = 'fleet.fixedRoster.alreadyOnThisVehicle';
      expect(translate(locale, key), `${locale} still carries the dead key`).toBe(key);
    }
  });
});

// ── 2d. The screen is reachable from the sidebar ────────────────────────────

describe('navigation', () => {
  // The sidebar is data-driven: it renders the applications `GET /platform/me/applications`
  // returns, and `seed-navigation.ts` is the catalog that boot syncs. A screen missing from it
  // is reachable only by typing the URL.
  const NAV = readFileSync(join(HERE, '../../../../api/src/seed-navigation.ts'), 'utf8');

  it('registers «الطقم الثابت» as a Fleet application on its real route', () => {
    const at = NAV.indexOf("route: '/fleet/fixed-roster'");
    expect(at, 'the row exists').toBeGreaterThan(-1);
    const row = NAV.slice(NAV.lastIndexOf('{', at), NAV.indexOf('}', at));
    expect(row).toContain("ar: 'الطقم الثابت'");
    expect(row, 'an icon the registry knows').toMatch(/icon: '(users|clipboard|truck)'/);
  });

  it('reuses the roster grant rather than inventing a permission', () => {
    const at = NAV.indexOf("route: '/fleet/fixed-roster'");
    const row = NAV.slice(NAV.lastIndexOf('{', at), NAV.indexOf('}', at));
    expect(row).toContain("permission: 'fleetRoster.view'");
    expect(NAV, 'no fixed-crew permission was added').not.toContain('fleetFixedRoster');
  });

  it('sits beside the daily roster, inside the Fleet category', () => {
    const daily = NAV.indexOf("route: '/fleet/roster'");
    const fixed = NAV.indexOf("route: '/fleet/fixed-roster'");
    expect(fixed).toBeGreaterThan(daily);
    expect(fixed - daily, 'adjacent rows').toBeLessThan(400);
  });
});

// ── 3. Saving — explicit, and only what moved ───────────────────────────────

describe('saving', () => {
  it('offers nothing to save on a board nobody has touched', () => {
    const markup = render();
    expect(markup).toContain(t('common.save'));
    expect(markup, 'the save button is disabled').toMatch(/disabled[^>]*>[^<]*حفظ|حفظ/);
    expect(markup, 'and there is no unsaved banner').not.toContain(t('fleet.fixedRoster.unsaved'));
  });

  it('sends only the rows whose crew moved, and in the shape the contract accepts', () => {
    // The payload the page builds is `changedRows`; parsing it with the real schema is what
    // proves the screen and the API agree.
    const saved = [row(V1, '150', E1), row(V2, '151')];
    const draft = [row(V1, '150'), row(V2, '151', E1)];
    const rows = changedRows(saved, draft);
    expect(rows).toHaveLength(2);
    expect(SaveFleetFixedRosterSchema.safeParse({ rows }).success).toBe(true);
  });

  it('refuses a payload that would seat one person twice on a car', () => {
    const bad = { rows: [{ vehicleId: V1, driver1EmployeeId: E1, driver2EmployeeId: E1 }] };
    const parsed = SaveFleetFixedRosterSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it('refuses a payload that would put one driver in two crews', () => {
    const bad = {
      rows: [
        { vehicleId: V1, driver1EmployeeId: E1 },
        { vehicleId: V2, driver1EmployeeId: E1 },
      ],
    };
    expect(SaveFleetFixedRosterSchema.safeParse(bad).success).toBe(false);
  });

  it('writes only when asked — a drag edits a draft, never the server', () => {
    // The mutation has exactly one caller, and it is the save handler.
    expect(SOURCE.match(/save\.mutateAsync/g) ?? []).toHaveLength(1);
    expect(SOURCE).toMatch(/const commit = async[\s\S]{0,400}save\.mutateAsync/);
    // The drop handler edits local state and nothing else.
    expect(SOURCE).toMatch(/const drop = \([\s\S]{0,300}setDraft/);
    expect(
      SOURCE.slice(SOURCE.indexOf('const drop = ('), SOURCE.indexOf('const commit')),
    ).not.toContain('mutate');
  });

  it('never lets a refused save fail in silence', () => {
    // Defining `onError` on the mutation opts it OUT of the global error toast
    // (query-client.ts: `if (mutation.options.onError === undefined) notify(error)`), and this
    // hook defines one — so the page's own catch is the single message the reader gets. Without
    // that catch the refusal would be invisible: the button stops spinning and nothing is said.
    // The commonest refusal here is a driver another row still holds.
    const commit = SOURCE.slice(SOURCE.indexOf('const commit'), SOURCE.indexOf('const zoneKey'));
    expect(commit, 'the save is guarded').toContain('try {');
    expect(commit, 'and a failure is shown').toMatch(/catch[\s\S]*toast\.error/);
    expect(commit).toContain('errorMessage(');
  });

  // ── a refused save must not throw the reader's work away ──────────────────
  //
  // This is the requirement with the most ways to lose it by accident, and the fewest visible
  // symptoms when it goes: the drags simply are not there any more, and the board looks like it
  // was never edited. Two independent mechanisms hold it up, so both are pinned here.

  it('does NOT re-read the board when the save is refused', () => {
    // An invalidate would answer with a fresh `rows` array; the page keys its draft to the saved
    // board's IDENTITY, so a new array resets the draft — wiping the very drags the reader now
    // has to fix. The handler still has to EXIST, because that is what keeps this mutation off
    // the global toast and leaves `commit`'s catch as the one message shown.
    const QUERIES = readFileSync(join(HERE, 'api/fleet-queries.ts'), 'utf8');
    const at = QUERIES.indexOf('export const useSaveFixedRoster');
    const hook = QUERIES.slice(at, QUERIES.indexOf('\n};', at));
    expect(at, 'the hook exists').toBeGreaterThan(-1);
    expect(hook, 'a handler is defined — no global toast on top of ours').toMatch(/onError:/);

    const onError = hook.slice(hook.indexOf('onError:'));
    for (const reread of ['invalidateQueries', 'setQueryData', 'refetch', 'resetQueries']) {
      expect(onError, `a refusal must not ${reread}`).not.toContain(reread);
    }
  });

  it('keys the draft to the saved board, so an unchanged board leaves the drags standing', () => {
    // The other half. Derived DURING RENDER, not seeded by an effect: an effect runs after the
    // first paint, so the board would flash empty on arrival — and never runs at all under
    // `renderToStaticMarkup`, which is how this whole file tests the screen. Keying on identity
    // is what makes "the server refused, nothing changed" mean "your draft is still here".
    expect(SOURCE).toContain('const draft = edit.base === saved ? edit.rows : saved;');
    expect(SOURCE, 'the saved board is a stable reference').toMatch(
      /const saved = useMemo\(\(\) => boardQuery\.data\?\.rows \?\? \[\], \[boardQuery\.data\]\)/,
    );
    expect(SOURCE, 'no effect seeds the draft').not.toContain('useEffect');
  });

  it('hides the whole editing surface from a reader who may not plan', () => {
    const markup = render({ permissions: ['fleetRoster.view'] });
    expect(markup).not.toContain(t('common.save'));
    expect(markup, 'and the cards are inert').not.toContain('draggable="true"');
  });
});

// ── 4. The DAILY roster still has everything this screen dropped ────────────

describe('the daily roster is untouched', () => {
  it('still has its date picker and its day arrows', () => {
    expect(ROSTER).toContain('type="date"');
    expect(ROSTER).toContain('fleet.roster.prevDay');
    expect(ROSTER).toContain('fleet.roster.nextDay');
    expect(ROSTER).toContain('shiftDay');
  });

  it('still has its unavailable section, reasons and all', () => {
    expect(ROSTER).toContain('unavailableDrivers');
    expect(ROSTER).toContain('fleet.roster.unavailableTitle');
    expect(ROSTER).toContain('reasonLabel');
  });

  it('still plans by date', () => {
    expect(ROSTER).toContain('usePlanRoster');
    expect(ROSTER).toMatch(/dateKey: date/);
  });
});
