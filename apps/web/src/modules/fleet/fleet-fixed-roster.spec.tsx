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

// ── 2b. The audit: assignment must not make a driver DISAPPEAR ──────────────

describe('a driver assigned to a crew does not vanish', () => {
  // "The driver is gone" and "the driver is no longer in this slot" must never look alike. The
  // pool is the server's whole list and stays whole: an assigned driver keeps their card and
  // gains a badge naming the car, so nothing about assignment reads as removal.
  const CREWED: FleetFixedRosterDto = {
    rows: [row(V1, '150', E1), row(V2, '151')],
    drivers: [
      { employeeId: E1, assignedVehicleId: V1 },
      { employeeId: E2, assignedVehicleId: null },
    ],
  };

  it('keeps an assigned driver in the pool, badged with the car they hold', () => {
    const markup = render({ qc: client(CREWED) });
    expect(driverCards(markup), 'both drivers are still listed').toEqual([E1, E2]);
    const at = markup.indexOf(`data-driver-card="${E1}"`);
    const card = markup.slice(at, markup.indexOf('</li>', at));
    expect(card, 'and the assigned one names the car').toContain('150');
    expect(card).toContain('أحمد محمد');
  });

  it('renders the pool from the server list, never from the unassigned remainder', () => {
    // A page that filtered the pool by "not yet assigned" would shrink as the board fills, and
    // a reader would read that as drivers being consumed.
    expect(SOURCE).toContain('boardQuery.data.drivers.map');
    const pool = SOURCE.slice(SOURCE.indexOf('boardQuery.data.drivers.map'));
    expect(pool.slice(0, 400), 'the pool list is not filtered').not.toContain('.filter(');
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

  it('shows the same number of drivers whether the board is empty or full', () => {
    const empty = driverCards(render());
    const full = driverCards(render({ qc: client(CREWED) }));
    expect(full).toHaveLength(empty.length);
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
    // (query-client.ts: `if (mutation.options.onError === undefined) notify(error)`), and the
    // hook defines one so it can re-read the board. Without a catch at the call site the refusal
    // would be invisible: the button stops spinning, the refetch drops the drags, and the reader
    // is left guessing. The commonest refusal here is a driver another row still holds.
    const commit = SOURCE.slice(SOURCE.indexOf('const commit'), SOURCE.indexOf('const zoneKey'));
    expect(commit, 'the save is guarded').toContain('try {');
    expect(commit, 'and a failure is shown').toMatch(/catch[\s\S]*toast\.error/);
    expect(commit).toContain('errorMessage(');
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
