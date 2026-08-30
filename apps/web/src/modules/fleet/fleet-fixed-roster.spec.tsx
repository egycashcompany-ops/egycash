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
import { applyEdit, changedRows } from './lib/fixed-roster-board';

/** Real 24-hex ids: the save payload is parsed with the REAL schema, which demands ObjectIds. */
const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';
const MT = '650000000000000000000021';

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
  missionTypeId: null,
  driver1EmployeeId: d1,
  driver2EmployeeId: d2,
  notes: null,
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
  // The REAL `missionType` catalog key, in the shape `useFleetCatalog('missionType')` reads —
  // the same catalog and the same key the DAILY roster's mission column reads.
  qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'missionType' }], {
    items: [
      { id: MT, kind: 'missionType', name: { ar: 'نقل نقدية', en: 'Cash run' }, isActive: true },
    ],
    meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
  });
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

  it('names each vehicle by its CODE, and prints no plate under it', () => {
    // The plate used to sit under the code as a second line. It is gone from this board: a fixed
    // crew belongs to the vehicle, and the vehicle is identified here by its code, so the second
    // line spent a row's height on a fact this screen never asks. The plate is untouched on the
    // record and on the screens that are ABOUT the vehicle — this is a presentation change only.
    const body = tbody(render());
    expect(body, 'the code names the vehicle').toContain('150');
    expect(body, 'and the plate is not printed').not.toContain('س ص 150');
    expect(render(), 'nowhere else on the screen either').not.toContain('س ص 150');
  });

  it('still FINDS a vehicle by its plate, which is not the same as showing it', () => {
    // Removing a line from a cell must not remove a way in. The search box says «الكود أو رقم
    // اللوحة» and still means it: a reader holding a plate number reaches the row, they just are
    // not made to read the plate on every other row to get there.
    expect(SOURCE, 'the filter still reads the plate').toContain('row.plateNumber.toLowerCase()');
    const found = tbody(
      render({ route: '/fleet/fixed-roster?q=' + encodeURIComponent('س ص 150') }),
    );
    expect(found, 'the matching row is there').toContain('150');
    expect(found, 'and the other one is filtered out').not.toContain('151');
  });

  it('shows the mission type and the note as REAL values, dashed only when empty', () => {
    // These were permanent placeholders until the crew gained the two fields. The dash is now
    // what "this row holds nothing" looks like, not what the column always looks like — so a
    // populated row must actually print its values.
    const filled: FleetFixedRosterDto = {
      ...BOARD,
      rows: [{ ...row(V1, '150'), missionTypeId: MT, notes: 'يبدأ من المخزن' }, row(V2, '151')],
    };
    const body = tbody(render({ qc: client(filled) }));
    expect(body, 'the catalog item name, not its id').toContain('نقل نقدية');
    // The id may appear in an `<option value>` — that is how a select carries its reference —
    // but it must never be a thing the reader is shown. So the claim is about the VISIBLE text,
    // which is what it always meant; matching raw markup only happened to say the same thing
    // back when the cell was a bare `<span>`.
    const visible = body.replace(/<[^>]*>/g, ' ');
    expect(visible, 'no ObjectId is ever displayed').not.toContain(MT);
    expect(visible, 'the name is').toContain('نقل نقدية');
    expect(body).toContain('يبدأ من المخزن');
    // …and the untouched row still reads as empty.
    expect(body).toContain('—');
  });

  it('renders the mission type by NAME, resolved from the catalog, never the raw id', () => {
    // Persisting the id and displaying the label is the project's catalog convention; printing
    // the ObjectId would be unreadable and would leak a key the reader cannot act on.
    expect(SOURCE, 'the id is resolved through the catalog').toContain(
      'missionTypeName(row.missionTypeId)',
    );
    expect(SOURCE).toContain("useFleetCatalog('missionType')");
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
    // The chain is server list -> pool (derived from the draft) -> shownDrivers (the search's
    // view of the pool). The list rendered is the LAST of those, and the search must sit on top
    // of the derived pool rather than beside it, or a driver seated by a drag could still be
    // offered while a term is typed.
    expect(SOURCE, 'the search filters the derived pool').toContain(
      'filterDrivers(pool, searchIndex, driverSearch)',
    );
    expect(SOURCE, 'and the list renders that').toContain('shownDrivers.map((driver)');
    expect(SOURCE, 'never the raw server array').not.toContain('boardQuery.data.drivers.map');
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

    // ...while a driver the board really does show as free carries NO badge at all. Free is what
    // every other row in this list already means, so the badge marks the exception only — and
    // that is what keeps the row narrow enough for the name.
    const free = markup.indexOf(`data-driver-card="${E2}"`);
    const freeCard = markup.slice(free, markup.indexOf('</li>', free));
    expect(freeCard, 'no «سيارة أخرى» on a free driver').not.toContain(
      t('fleet.roster.otherVehicle'),
    );
    expect(freeCard, 'and no redundant «بلا طقم» either').not.toContain(
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
      // Three now, and the third is a READ of an existing catalog the maintenance screen already
      // uses. The list is exact on purpose: it is what stops a fourth — a driver-profile write,
      // a vehicle patch — from arriving unremarked.
    ).toEqual(['useFixedRoster', 'useFleetCatalog', 'useSaveFixedRoster']);
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

// ── 2e. The «تعديل» dialog ──────────────────────────────────────────────────
//
// The dialog is a form, and forms are where a screen most easily grows a SECOND copy of a rule.
// The claims here are that it does not: the driver rules it obeys are the board's, reached
// through `applyEdit`, and cancelling reaches nothing at all. The node suite cannot click, so
// the behaviour of `applyEdit` itself lives in `lib/fixed-roster-board.spec.ts` and the click is
// verified in a browser; what is asserted here is the wiring between them.

describe('the edit dialog', () => {
  // The dialog's form is now two declarations, not one: `DriverSelect` was lifted out of the
  // dialog body (a component declared during render is rebuilt on every keystroke — the same
  // root cause that made a seated driver undraggable). They are read together, because together
  // is what the reader sees.
  const DIALOG = SOURCE.slice(
    SOURCE.indexOf('const DriverSelect'),
    SOURCE.indexOf('const zoneKey'),
  );

  it('offers «تعديل» on EVERY row, crewed or not', () => {
    // A car with no crew is exactly the one that needs a work type or a note put on it.
    const markup = render();
    const buttons = [...markup.matchAll(/data-edit-row="([^"]*)"/g)].map((m) => m[1]);
    expect(buttons).toEqual([V1, V2]);
    expect(markup).toContain(t('common.edit'));
    expect(t('common.edit')).toBe('تعديل');
  });

  it('hides the action from a reader who may not plan', () => {
    expect(render({ permissions: ['fleetRoster.view'] })).not.toContain('data-edit-row');
  });

  it('edits exactly the four fields, and never the workshop status', () => {
    for (const field of [
      "t('fleet.roster.fields.mission')",
      "t('fleet.odometer.fields.driver1')",
      "t('fleet.odometer.fields.driver2')",
      "t('fleet.attendance.fields.notes')",
    ]) {
      expect(DIALOG, `${field} is editable`).toContain(field);
    }
    expect(DIALOG, 'the workshop badge is not in the form').not.toContain('InWorkshopBadge');
    expect(DIALOG, 'and nothing sets inMaintenance').not.toContain('inMaintenance');
  });

  it('opens with the row’s CURRENT values, not empty ones', () => {
    for (const seed of [
      'useState<string | null>(row.missionTypeId)',
      'useState<string | null>(row.driver1EmployeeId)',
      'useState<string | null>(row.driver2EmployeeId)',
      "useState<string>(row.notes ?? '')",
    ]) {
      expect(DIALOG, seed).toContain(seed);
    }
  });

  it('fills the mission-type select from the REAL catalog, never a hardcoded list', () => {
    expect(SOURCE).toContain("useFleetCatalog('missionType')");
    expect(DIALOG, 'options come from the query').toContain('missionTypes.data?.items ?? []');
    expect(DIALOG, 'and the id is what is stored').toContain('value={item.id}');
    expect(DIALOG, 'the label is the localized catalog name').toContain(
      'localized(item.name, locale)',
    );
  });

  it('is a SINGLE select — one mission type per vehicle', () => {
    expect(DIALOG, 'a <select>, not a multi-select').toContain('<Select');
    expect(DIALOG).not.toContain('MultiSelect');
    expect(DIALOG, 'no multiple attribute').not.toMatch(/\bmultiple\b/);
  });

  it('handles the catalog’s loading, empty and failed states', () => {
    expect(DIALOG, 'loading').toContain('missionTypes.isPending');
    expect(DIALOG, 'error').toContain('missionTypes.isError');
    expect(DIALOG, 'empty').toContain('noMissionTypesYet');
  });

  it('lets a vehicle have NO mission type, and no driver', () => {
    expect(DIALOG).toContain("t('fleet.fixedRoster.noMissionType')");
    expect(DIALOG).toContain("t('fleet.fixedRoster.noDriver')");
    // '' is the empty option's value and must come back as null, not as an empty string.
    expect(DIALOG).toContain('e.target.value || null');
  });

  it('offers the pool PLUS this vehicle’s own crew, so they stay selectable', () => {
    expect(DIALOG).toMatch(/candidates[\s\S]{0,300}pool\.map/);
    expect(DIALOG, 'the row’s own drivers are added back').toMatch(
      /row\.driver1EmployeeId, row\.driver2EmployeeId\]/,
    );
  });

  it('does not OFFER the other slot’s driver, so one person cannot fill both', () => {
    // The structural half, and the one that actually fires: each select drops the other slot's
    // current driver from its options, so the illegal pair cannot be chosen in the first place.
    // `|| id === value` is what keeps a slot's OWN driver listed — without it the dialog would
    // open showing a selected value that is not among its options, which browsers render blank.
    expect(DIALOG).toContain('.filter((id) => id !== exclude || id === value)');
    expect(DIALOG, 'slot 1 excludes slot 2').toContain('exclude={driver2}');
    expect(DIALOG, 'slot 2 excludes slot 1').toContain('exclude={driver1}');
  });

  it('and refuses the pair anyway, if it is ever reached', () => {
    // Defence in depth behind the filtering above: `applyEdit` would silently displace the
    // first driver with the second, which is a worse outcome than a blocked button.
    expect(DIALOG).toContain('const sameTwice = driver1 !== null && driver1 === driver2');
    expect(DIALOG, 'and the save is blocked while it holds').toContain('disabled={sameTwice}');
  });

  it('commits through applyEdit — the board’s rules, not a second copy', () => {
    // This is the whole reason the dialog cannot become a way around exclusivity.
    expect(SOURCE).toContain('applyEdit(rows, editingRow.vehicleId, edit)');
    expect(DIALOG, 'the dialog itself writes no row').not.toContain('setDraft');
  });

  it('normalizes an empty note to null, the way the contract demands', () => {
    expect(DIALOG).toContain("notes: notes.trim() === '' ? null : notes.trim()");
    // The schema refuses '' outright, so sending it would 400 the whole save.
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V1, notes: '' }] }).success,
    ).toBe(false);
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V1, notes: null }] }).success,
    ).toBe(true);
  });

  it('CANCEL touches nothing — not the draft, not the server', () => {
    // The dialog holds its own state and hands it back only via onSave, so closing discards it.
    // The handler is asserted WHOLE: closing sets the open-state and does nothing else, so a
    // future edit that also reset or committed the draft would not match this string.
    expect(SOURCE).toContain('onClose={() => setEditing(null)}');
    expect(DIALOG, 'the dialog writes no draft of its own').not.toContain('setDraft');
    expect(DIALOG, 'and never calls the mutation').not.toContain('mutate');
    // The only path from the DIALOG to the board is its save handler — it never edits the draft
    // itself. `applyEdit` now has two callers, because the mission type is editable in the cell
    // as well; that is two entry points into ONE rule, which is the point of the function. What
    // must stay impossible is a THIRD way that writes the row without it.
    expect(DIALOG, 'the dialog does not commit, it hands back').not.toContain('applyEdit(');
    const callers = SOURCE.match(/applyEdit\(/g) ?? [];
    expect(callers, 'the dialog save and the mission cell — no others').toHaveLength(2);
    // Neither entry point may assemble the row by hand: that would be the second persistence
    // mechanism, agreeing with `applyEdit` only until somebody changed one of them.
    expect(SOURCE, 'no row is spread into a new one outside the board lib').not.toMatch(
      /\{\s*\.\.\.row,\s*(missionTypeId|driver[12]EmployeeId|notes)/,
    );
  });
});

// ── 2e-bis. «نوع المهمة», editable where it is read ─────────────────────────
//
// The mission type changes as often as the crew does, and it used to cost four interactions:
// open «تعديل», pick, save, close. It is a select in the cell now. The dialog still edits it —
// two entry points into ONE rule (`applyEdit`), which is the same shape the drag and the dialog
// already share for drivers.
//
// The node suite cannot open a native select. What it pins is that the control IS in the table,
// that it is the app's own catalog select on the `missionType` kind, and that the change goes
// through the authoritative path; the interaction itself is measured in a browser.

describe('the mission type, edited in the cell', () => {
  const MISSION_CELL = SOURCE.slice(
    SOURCE.indexOf("key: 'mission'"),
    SOURCE.indexOf("key: 'driver1'"),
  );

  it('renders a real select in the table, not only inside the dialog', () => {
    const body = tbody(render());
    expect(body, 'the cell holds a control').toContain('<select');
    expect(MISSION_CELL, 'and it is the app’s own catalog select').toContain('<CatalogSelect');
    // Reachable without «تعديل»: the select is in the row, the dialog is not rendered at all
    // until a row is being edited.
    expect(body, 'no dialog is open').not.toContain('role="dialog"');
  });

  it('offers the missionType catalog — never workType', () => {
    expect(MISSION_CELL, 'the mission vocabulary').toContain('kind="missionType"');
    expect(MISSION_CELL, 'not the workshop’s').not.toContain('workType');
    expect(SOURCE, 'nowhere on this screen').not.toContain("useFleetCatalog('workType')");
    // …and it costs no new request: `CatalogSelect` reads the same cached hook the page does.
    const select = readFileSync(join(HERE, 'components/CatalogSelect.tsx'), 'utf8');
    expect(select, 'the shared hook').toContain('useFleetCatalog(kind)');
    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    expect(api, 'no endpoint was added for this').not.toMatch(/mission-type|missionTypes\(/);
  });

  it('shows each option by its localized NAME and stores the id', () => {
    const body = tbody(render());
    expect(body, 'the catalog name is the option label').toContain('نقل نقدية');
    const select = readFileSync(join(HERE, 'components/CatalogSelect.tsx'), 'utf8');
    expect(select, 'label localized the project’s way').toContain('localized(item.name, locale)');
    expect(select, 'value is the id').toContain('value={item.id}');
  });

  it('sends the change through `applyEdit` as missionTypeId — the dialog’s own path', () => {
    expect(MISSION_CELL, 'the cell delegates').toContain('setMission(row,');
    const setter = SOURCE.slice(
      SOURCE.indexOf('const setMission ='),
      SOURCE.indexOf("key: 'vehicle'"),
    );
    expect(setter, 'through the authoritative rule').toContain('applyEdit(rows, row.vehicleId');
    expect(setter, 'as missionTypeId').toContain('missionTypeId,');
    expect(setter, 'editing the draft, as a drag does').toContain('setDraft(');
    expect(setter, 'and it never calls the mutation itself').not.toContain('mutate');
    // The drivers and the note ride along unchanged — the cell edits ONE field.
    for (const carried of ['driver1EmployeeId: row.driver1EmployeeId', 'notes: row.notes']) {
      expect(setter, carried).toContain(carried);
    }
  });

  it('clears to null, which is how this module spells "nothing"', () => {
    expect(MISSION_CELL, 'the empty option means cleared').toContain("id === '' ? null : id");
    expect(MISSION_CELL, 'and it is labelled as such').toContain(
      "t('fleet.fixedRoster.noMissionType')",
    );
    expect(translate('ar', 'fleet.fixedRoster.noMissionType')).toBe('بدون نوع مهمة');
    // `null` survives the real contract, which is what makes "cleared" storable.
    const cleared = applyEdit([row(V1, '150')], V1, {
      missionTypeId: null,
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      notes: null,
    });
    expect(cleared[0]?.missionTypeId).toBeNull();
    const rows = changedRows([{ ...row(V1, '150'), missionTypeId: MT }], cleared);
    expect(rows[0]?.missionTypeId).toBeNull();
    expect(SaveFleetFixedRosterSchema.safeParse({ rows }).success).toBe(true);
  });

  it('keeps its interaction out of the row’s drag handling', () => {
    // The row's other cells are drag sources and drop targets. A pointer landing in this select
    // must not reach them — `DataTable` isolates its own selection cell exactly this way.
    expect(MISSION_CELL, 'the click stops here').toContain('e.stopPropagation()');
    expect(MISSION_CELL, 'and so does the press that would begin a drag').toContain('onMouseDown');
    // The cell is not itself draggable, and declares no drop zone.
    expect(MISSION_CELL, 'not a drag source').not.toContain('draggable');
    expect(MISSION_CELL, 'not a drop target').not.toContain('data-drop-zone');
    const table = readFileSync(join(HERE, '../../shared/ui/DataTable.tsx'), 'utf8');
    expect(table, 'the idiom is the table’s own').toContain('onClick={(e) => e.stopPropagation()}');
  });

  it('gives the label room the chevron does not already take', () => {
    // A `<select>` clips its label internally and reports `scrollWidth === clientWidth`, so
    // nothing about the DOM says it is cut — it has to be measured as rendered text against the
    // inner width. At `min-w-[9rem]` the shared `Select`'s `pe-9` chevron gutter (36px) plus the
    // 12px start padding left 94px, and «نقل أموال (يومي)» needs 104px: clipped in the column
    // whose whole job is to show it. 11rem leaves 126px.
    expect(MISSION_CELL, 'wide enough for a real mission name').toContain('min-w-[11rem]');
    expect(MISSION_CELL, 'the too-narrow box is gone').not.toContain('min-w-[9rem]');
    const form = readFileSync(join(HERE, '../../shared/ui/form.tsx'), 'utf8');
    expect(form, 'the chevron gutter this budgets for').toContain('pe-9');
  });

  it('shows a reader who may not plan the NAME, with nothing to change', () => {
    const filled: FleetFixedRosterDto = {
      ...BOARD,
      rows: [{ ...row(V1, '150'), missionTypeId: MT }, row(V2, '151')],
    };
    const body = tbody(render({ permissions: ['fleetRoster.view'], qc: client(filled) }));
    expect(body, 'the value is readable').toContain('نقل نقدية');
    expect(body, 'but not editable').not.toContain('<select');
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

// ── 2f. The driver panel: a chip, a search, and less of the width ───────────
//
// The panel sits beside the board and competes with it for room. These pin the three things that
// keeps it useful while it is narrow: the name is the whole chip (the code moved into the search
// instead of the row), the search reaches every identifier the record carries, and the panel
// takes a quarter of the grid rather than a third.

describe('the driver panel', () => {
  const POOL_LIST = SOURCE.slice(
    SOURCE.indexOf('shownDrivers.map((driver)'),
    SOURCE.indexOf('</ul>'),
  );

  it('shows the driver by NAME, with no code beside it', () => {
    const markup = render();
    expect(markup, 'the name is there').toContain('أحمد محمد');
    // `EmployeeName` prints name + code; the pool uses the chip, which prints the name alone.
    expect(POOL_LIST, 'the pool row is a chip').toContain('<DriverChip');
    expect(POOL_LIST, 'and not the name+code component').not.toContain('<EmployeeName');
    // Comments stripped: the chip's header explains at length WHY the code is not shown, and
    // matching raw source would fail on its own explanation.
    const chip = readFileSync(join(HERE, 'components/DriverChip.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(chip, 'the chip reads only the name half of the hook').toContain('const { name } =');
    expect(chip, 'and never reads the code half').not.toMatch(/\bcode\b/);
  });

  it('uses the same chip on the vehicle row, so a drag does not change what it looks like', () => {
    const slot = SOURCE.slice(
      SOURCE.indexOf('const CrewSlotCell = ('),
      SOURCE.indexOf('export const FixedRosterPage'),
    );
    expect(slot).toContain('<DriverChip');
    expect(slot).not.toContain('<EmployeeName');
    // Both places render the same element, so the markup carries a chip per seated driver too.
    const seated = render({
      qc: client({ ...BOARD, rows: [row(V1, '150', E1), row(V2, '151')] }),
    });
    expect([...seated.matchAll(/data-driver-chip="([^"]*)"/g)].map((m) => m[1])).toContain(E1);
  });

  it('offers a search beside the title, not buried under the list', () => {
    const markup = render();
    expect(markup).toContain(t('fleet.fixedRoster.driversTitle'));
    expect(markup, 'the input is rendered').toContain(
      t('fleet.fixedRoster.driverSearchPlaceholder'),
    );
    // The panel header holds title then search, and the list comes after both.
    const titleAt = SOURCE.indexOf("t('fleet.fixedRoster.driversTitle')");
    const searchAt = SOURCE.indexOf("t('fleet.fixedRoster.driverSearchPlaceholder')");
    const listAt = SOURCE.indexOf('shownDrivers.map((driver)');
    expect(titleAt).toBeLessThan(searchAt);
    expect(searchAt, 'search above the list').toBeLessThan(listAt);
  });

  it('searches every identifier the record already carries — no new endpoint', () => {
    // The fields come from the employee record the cards already load; the hook below reuses
    // those very cache entries rather than asking the server for a driver directory.
    for (const field of ['fullNameAr', 'fullNameEn', 'employee.code', 'employeeNumber']) {
      expect(SOURCE, `${field} is searchable`).toContain(field);
    }
    expect(SOURCE, 'resolved through the shared employee cache').toContain('useEmployeeRecords(');
    const employee = readFileSync(join(HERE, 'components/EmployeeName.tsx'), 'utf8');
    expect(employee, 'same key as the single-employee hook').toContain(
      "detailKey('hr', 'employees', employeeId)",
    );
    // No fleet endpoint was added for this.
    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    expect(api, 'no driver-search endpoint').not.toMatch(/drivers\/search|driver-search/);
  });

  it('says so when a search matches nobody, distinctly from an empty pool', () => {
    // "Nobody matches what you typed" and "every driver is already crewed" are different facts,
    // and a reader who cannot tell them apart will go looking for a bug in the wrong place.
    expect(SOURCE).toContain("t('fleet.fixedRoster.driverSearchEmpty')");
    expect(SOURCE).toContain("t('fleet.roster.availableEmpty')");
    expect(translate('ar', 'fleet.fixedRoster.driverSearchEmpty')).toBe('لا يوجد سائق مطابق للبحث');
    expect(translate('en', 'fleet.fixedRoster.driverSearchEmpty')).not.toBe(
      'fleet.fixedRoster.driverSearchEmpty',
    );
  });

  it('badges only the EXCEPTION, so the row spends its width on the name', () => {
    // Every row in this list is free — that is what being in the pool means. Saying it on each
    // one costs the width the name needs and tells the reader nothing.
    expect(POOL_LIST, 'the out-of-scope case is still flagged').toContain(
      "t('fleet.roster.otherVehicle')",
    );
    expect(POOL_LIST, 'the redundant one is gone').not.toContain(
      "t('fleet.fixedRoster.unassigned')",
    );
  });

  it('gives the board more of the width than it used to — a fifth for the panel now', () => {
    // A quarter became a fifth. The panel was still the widest thing on the page that is not the
    // board, and the column that was actually short of room is «ملاحظات» — so the width moves
    // there rather than being left as slack. `min-w-0` on both halves is what lets the table keep
    // its own overflow rather than pushing the page sideways.
    expect(SOURCE, 'five columns').toContain('xl:grid-cols-5');
    expect(SOURCE, 'four of them are the board').toContain('xl:col-span-4');
    expect(SOURCE, 'so the panel is one').not.toContain('xl:col-span-3');
    expect(SOURCE, 'the panel can shrink too').toContain('min-w-0 space-y-6');
    // The note's ceiling rises with it. Measured in a browser: panel 326px → 256px, notes cell
    // 256px → 384px at 1440px wide.
    expect(SOURCE, 'the note may run wider before it truncates').toContain('max-w-[22rem]');
    expect(SOURCE, 'and the old ceiling is gone').not.toContain('max-w-[14rem]');
    expect(SOURCE, 'it still truncates rather than setting the column width').toContain(
      'truncate text-sm',
    );
  });

  it('keeps the rows readable while compact — the chip IS the row now', () => {
    // The row used to pad a content-width pill; the chip fills the row instead, and the space
    // that padding took is what the reference gives back to the board. A gapped stack replaces
    // the divider rules, so nothing is drawn between two things that are already separated.
    expect(POOL_LIST, 'the chip fills the row').toContain('flex-1');
    expect(POOL_LIST, 'no padding around a pill any more').not.toContain('px-3 py-1.5');
    // Narrow is fine; clipped is not. The chip may use the full row width and truncates when it
    // runs out, rather than being pinned to a fixed width a longer name would spill out of.
    const chip = readFileSync(join(HERE, 'components/DriverChip.tsx'), 'utf8');
    expect(chip, 'grows to the row').toContain('max-w-full');
    expect(chip, 'and truncates instead of overflowing').toContain('truncate');
    expect(chip, 'no fixed width').not.toMatch(/\sw-\[?\d/);
  });

  it('tints the panel with its own surface — a Card would have swallowed the colour', () => {
    // The reference stands the pool on a green field, and the first attempt at it passed that
    // green to `<Card>`. It drew white. `cn` joins class names without resolving Tailwind
    // conflicts (CardBody's own note says so), so the Card's `bg-white` and the incoming
    // `bg-green-50` both landed on the element and the winner was stylesheet order — which emits
    // `white` after `green`. Nothing failed; the tint simply never appeared. This pins the shape
    // that works and refuses the one that looks identical in a diff and loses the colour.
    const PANEL = SOURCE.slice(
      SOURCE.indexOf('min-w-0 space-y-6'),
      SOURCE.indexOf('shownDrivers.map((driver)'),
    );
    expect(PANEL, 'the surface carries the tint itself').toContain('bg-green-50');
    expect(PANEL, 'not handed to a Card that ignores it').not.toContain('<Card');
    expect(SOURCE, 'and the import went with it').not.toContain('shared/ui/Card');
    // The hue is Tailwind `green`, deliberately NOT the `emerald` this project spends on success
    // — see DriverChip's header. A tidy-up that unifies the two changes what the chip means.
    const chip = readFileSync(join(HERE, 'components/DriverChip.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(chip, "the reference's green").toContain('bg-green-700');
    expect(chip, 'never the success emerald').not.toContain('emerald');
  });
});

// ── 2g. Picking a driver up — one gesture, not two ──────────────────────────
//
// A seated driver could not be dragged in a single motion: the reader had to click the chip
// first, and only then would a drag take. That was not a missing handler — the handlers were
// there and fired. It was that `Slot` was declared INSIDE the page component, so every render
// produced a new element type and React unmounted the whole cell instead of updating it.
// `onDragStart` sets the dragging id, that render threw away the very node the browser had just
// picked up, and the browser cancelled the drag. The same remount discarded the DROP TARGET
// between `dragover` and `drop`, so the second half of the gesture was lost too.
//
// The node suite cannot drag. What it CAN pin is the structural cause, which is the thing that
// would quietly come back — the interaction itself is measured in a browser, where a real
// CDP-level drag now reports `dragIntercepted` for a seated chip and did not before.

describe('picking a seated driver up', () => {
  it('declares no component inside another component — the whole bug, in one rule', () => {
    // A capitalised arrow const at an indent is a component being rebuilt on every render of its
    // parent. At column zero it is a module-level component whose element type is stable, which
    // is what lets React keep the DOM node — and a drag in flight belongs to a DOM node.
    const inner = [...RAW.matchAll(/\n[ \t]+const ([A-Z]\w*) = \(/g)].map((m) => m[1]);
    expect(inner, `these are rebuilt every render: ${inner.join(', ')}`).toEqual([]);
    expect(SOURCE, 'the slot cell is one of them').toContain('\nconst CrewSlotCell = (');
    expect(SOURCE, 'and so is the dialog’s driver select').toContain('\nconst DriverSelect = (');
  });

  it('makes the seated chip draggable on exactly the same terms as a pool row', () => {
    // Same contract on both ends of the move, so "drag a driver" is one thing the reader learns
    // once. If the seated chip needed a different gesture, that would be two things.
    const markup = render({ qc: client({ ...BOARD, rows: [row(V1, '150', E1), row(V2, '151')] }) });
    const seated = markup.slice(markup.indexOf('data-drop-zone'), markup.indexOf('</tbody>'));
    expect(seated, 'the seated chip is draggable').toContain('draggable="true"');
    expect(markup, 'and so is the pool row').toContain('data-driver-card');
    const cell = SOURCE.slice(
      SOURCE.indexOf('const CrewSlotCell = ('),
      SOURCE.indexOf('export const FixedRosterPage'),
    );
    expect(cell, 'the seated chip carries the same payload').toContain('setData(DRAG_TYPE');
    expect(cell, 'and the same effect').toContain("effectAllowed = 'move'");
  });

  it('asks for no click, double-click or handle before the drag', () => {
    // The reported workaround was "double-click first". Nothing may make that a prerequisite:
    // no click handler on the chip, no armed/selected state a drag waits for.
    const cell = SOURCE.slice(
      SOURCE.indexOf('const CrewSlotCell = ('),
      SOURCE.indexOf('export const FixedRosterPage'),
    );
    // Anchor the end AFTER the start: the first `</span>` in the cell closes the empty-slot
    // placeholder, which sits above the chip — slicing to it ran backwards and searched ''.
    const from = cell.indexOf('draggable={mayPlan}');
    expect(from, 'the draggable chip is in the cell').toBeGreaterThan(-1);
    const chip = cell.slice(from, cell.indexOf('</span>', from));
    expect(chip.length, 'and the slice actually holds it').toBeGreaterThan(40);
    expect(chip, 'no click to arm the drag').not.toContain('onClick');
    expect(chip, 'and no double-click either').not.toContain('onDoubleClick');
    expect(chip, 'nor a mousedown standing in for one').not.toContain('onMouseDown');
    expect(cell, 'draggable is gated by permission only').toContain('draggable={mayPlan}');
  });

  it('moves a seated driver through the SAME rule the pool drag uses', () => {
    // One `assignDriver` call in the page, reached by every drop — from the pool or from a seat.
    // A second call site would be a second set of rules that could drift from this one.
    expect(SOURCE.match(/assignDriver\(/g) ?? [], 'exactly one call site').toHaveLength(1);
    const drop = SOURCE.slice(SOURCE.indexOf('const drop = ('), SOURCE.indexOf('const commit'));
    expect(drop, 'the drop delegates rather than deciding').toContain('assignDriver(draft');
    expect(drop, 'and knows nothing about where the drag started').not.toContain('pool');
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

  it('carries the chosen mission type through as the catalog ID, and null when cleared', () => {
    // The dialog hands `applyEdit` the id it read off the catalog `<option value={item.id}>`;
    // the row keeps it; `changedRows` sends it; the real schema accepts it. Every link in that
    // chain is here, because a break in any one of them looks the same to the reader: the
    // mission type they picked is simply not there when the screen comes back.
    const saved = [row(V1, '150'), row(V2, '151')];
    const picked = applyEdit(saved, V1, {
      missionTypeId: MT,
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      notes: null,
    });
    expect(picked[0]?.missionTypeId, 'the id, not the name').toBe(MT);
    const rows = changedRows(saved, picked);
    expect(rows[0]?.missionTypeId).toBe(MT);
    expect(SaveFleetFixedRosterSchema.safeParse({ rows }).success, 'the contract takes it').toBe(
      true,
    );

    // …and clearing it is a real value, not a missing key: `null` is how this module spells
    // "no mission type", and the contract accepts that too.
    const cleared = applyEdit(picked, V1, {
      missionTypeId: null,
      driver1EmployeeId: null,
      driver2EmployeeId: null,
      notes: null,
    });
    expect(cleared[0]?.missionTypeId).toBeNull();
    const back = changedRows(picked, cleared);
    expect(back[0]?.missionTypeId).toBeNull();
    expect(SaveFleetFixedRosterSchema.safeParse({ rows: back }).success).toBe(true);
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
    const commit = SOURCE.slice(SOURCE.indexOf('const commit'), SOURCE.indexOf('const dash'));
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
    // The rule now lives in `useDraftBoard`, shared with the daily board. UNCHANGED: keying on
    // identity is still what makes "the server refused, nothing changed" mean "your draft is
    // still here".
    expect(
      readFileSync(join(HERE, 'lib/useDraftBoard.ts'), 'utf8'),
    ).toContain('edit.base === saved ? edit.rows');
    expect(SOURCE, 'and this page uses it').toContain('useDraftBoard(');
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

// ── a second driver needs a first, in the SCREEN ───────────────────────────
//
// The rule itself lives in three places and each is tested where it belongs: the arithmetic in
// `fixed-roster-board.spec.ts`, the boundary in the contracts spec, the stored record in the
// integration suite. What is left is the part a user meets — the slot that will not take a drop
// and the select that will not offer a name — and that is here.

describe('driver 2 depends on driver 1', () => {
  it('makes slot 2 a NON-target while slot 1 is empty', () => {
    const markup = render();
    // Both slots exist for an empty crew; only slot 1 accepts anything.
    const zone = (slot: string): string => {
      const at = markup.indexOf(`data-drop-zone="${V1}:${slot}"`);
      return at === -1 ? '' : markup.slice(at, markup.indexOf('>', at));
    };
    expect(zone('driver1EmployeeId'), 'the first seat is open').not.toContain('data-drop-disabled');
    expect(zone('driver2EmployeeId'), 'the second is not, and says why').toContain(
      'data-drop-disabled="needsFirstDriver"',
    );
  });

  it('refuses the drop in code, not only in the styling', () => {
    // A `data-` attribute is a label. This is the gate: `onDragOver` never prevents the default,
    // so the browser does not treat the slot as a drop target at all.
    expect(SOURCE, 'the gate exists').toContain(
      "const needsFirst = slot === 'driver2EmployeeId' && row.driver1EmployeeId === null",
    );
    expect(SOURCE, 'and both handlers ride it').toContain('const droppable = mayPlan && !needsFirst');
    const cell = SOURCE.slice(SOURCE.indexOf('const CrewSlotCell'), SOURCE.indexOf('export const FixedRosterPage'));
    const overAt = cell.indexOf('onDragOver');
    const dropAt = cell.indexOf('onDrop=');
    expect(cell.slice(overAt, overAt + 120), 'dragover is gated').toContain('if (!droppable) return');
    expect(cell.slice(dropAt, dropAt + 120), 'and so is drop').toContain('if (!droppable) return');
  });

  it('OPENS slot 2 as soon as slot 1 holds somebody', () => {
    const seated = { ...BOARD, rows: [row(V1, '150', E1), row(V2, '151')] };
    const markup = render({ qc: client(seated) });
    const at = markup.indexOf(`data-drop-zone="${V1}:driver2EmployeeId"`);
    expect(at, 'the slot is rendered').toBeGreaterThan(-1);
    expect(markup.slice(at, markup.indexOf('>', at)), 'and it is now a target').not.toContain(
      'data-drop-disabled',
    );
  });

  it('tells the reader what is missing instead of ignoring the gesture', () => {
    const markup = render();
    const at = markup.indexOf(`data-drop-zone="${V1}:driver2EmployeeId"`);
    const cell = markup.slice(at, markup.indexOf('</div>', at));
    expect(cell, 'the empty second slot explains itself').toContain(
      translate('ar', 'fleet.fixedRoster.needsFirstDriver'),
    );
  });

  it('disables the dialog’s second-driver select while the first is empty', () => {
    expect(SOURCE, 'the select is disabled').toContain('disabled={driver1 === null}');
    expect(SOURCE, 'with the reason beside it').toContain(
      "hint={driver1 === null ? t('fleet.fixedRoster.needsFirstDriver') : undefined}",
    );
  });

  it('PROMOTES rather than stranding when the dialog clears driver 1', () => {
    // «بدون سائق» on the first slot of a two-man crew leaves one person on the car, and the seat
    // a lone driver holds is slot 1 — so the dialog shows exactly the crew the save will write.
    const handler = SOURCE.slice(SOURCE.indexOf('onChange={(id) => {'));
    expect(handler.slice(0, 260)).toContain('if (id === null && driver2 !== null)');
    expect(handler.slice(0, 260)).toContain('setDriver1(driver2)');
    expect(handler.slice(0, 260)).toContain('setDriver2(null)');
  });
});

// ── each vehicle wears its own colour ──────────────────────────────────────
//
// A hundred rows of three-digit codes that differ by one glyph are hard to keep your place in.
// The colour is hashed from the vehicle's ID — not its row index — so it survives filtering,
// sorting and new vehicles arriving. The rules themselves are in `vehicle-colour.spec.ts`; these
// assert the BOARD actually wears them.

describe('the vehicle code carries the vehicle’s colour', () => {
  const chipFor = (markup: string, vehicleId: string): string => {
    const at = markup.indexOf(`data-vehicle-colour="${vehicleId}"`);
    return at === -1 ? '' : markup.slice(markup.lastIndexOf('<span', at), markup.indexOf('>', at));
  };

  it('gives each vehicle a palette class', () => {
    const markup = render();
    for (const id of [V1, V2]) {
      const chip = chipFor(markup, id);
      expect(chip, `${id} has no colour chip`).not.toBe('');
      expect(chip, 'and it is a palette entry').toMatch(/bg-[a-z]+-(100|200)/);
    }
  });

  it('gives the two vehicles DIFFERENT colours', () => {
    const markup = render();
    expect(chipFor(markup, V1)).not.toBe(chipFor(markup, V2));
  });

  it('keeps a vehicle’s colour when the board is FILTERED to a different set', () => {
    // The search narrows `rows`, so a colour taken from an array index would repaint the fleet
    // on every keystroke. This is the regression that would catch it.
    const all = render();
    const filtered = render({ route: '/fleet/fixed-roster?q=151' });
    expect(filtered, 'the filter really did narrow the board').not.toContain(
      `data-vehicle-colour="${V1}"`,
    );
    expect(chipFor(filtered, V2), 'and 151 still wears its own colour').toBe(chipFor(all, V2));
  });

  it('keeps each colour when the board arrives in a DIFFERENT ORDER', () => {
    const forward = render();
    const reversed = render({ qc: client({ ...BOARD, rows: [...BOARD.rows].reverse() }) });
    expect(chipFor(reversed, V1)).toBe(chipFor(forward, V1));
    expect(chipFor(reversed, V2)).toBe(chipFor(forward, V2));
  });

  it('does not repaint the existing vehicles when a new one arrives', () => {
    const before = render();
    const withExtra = render({
      qc: client({
        ...BOARD,
        rows: [row('64b1f0abcdefabcdefab7777', '99'), ...BOARD.rows],
      }),
    });
    expect(chipFor(withExtra, V1)).toBe(chipFor(before, V1));
    expect(chipFor(withExtra, V2)).toBe(chipFor(before, V2));
  });

  it('is a label, not a status — the code stays the readable thing', () => {
    const markup = render();
    const chip = chipFor(markup, V1);
    expect(chip, 'dark text on a light fill').toMatch(/text-[a-z]+-800/);
    expect(chip, 'and the inverse in dark mode').toMatch(/dark:text-[a-z]+-(100|200)/);
  });
});

// ── a refused save says WHICH row it refused ───────────────────────────────
//
// The server answers a bad save with code `VALIDATION_FAILED`, a constant top-level message
// (`Validation failed`) and `details: [{ field, code, message }]` naming the row and the rule.
// On a hundred-vehicle board the top-level message is unactionable — it is the same sentence
// whatever went wrong — so this screen reads the detail.
//
// It reads it HERE rather than in `errorMessage`, and that placement is the tested claim: the
// server's detail strings are English-only, so preferring them in the shared helper would put
// English in front of an Arabic reader on all twelve screens that call it.
describe('a refused save names the row it refused', () => {
  const commit = SOURCE.slice(SOURCE.indexOf('const commit'), SOURCE.indexOf('const dash'));

  it('reads the server’s detail instead of the generic message', () => {
    expect(commit, 'the save handler asks for the details').toContain('validationDetails(error)');
    expect(commit, 'and shows the rule the server applied').toContain('detail.message');
  });

  it('names the field alongside the rule', () => {
    expect(commit).toContain('detail.field');
  });

  it('still falls back to the localised copy when there is no detail', () => {
    // A refusal with no details — or any other error code — must keep its Arabic sentence.
    expect(commit, 'the localised path is still there').toContain('errorMessage(error, locale)');
    expect(commit, 'and it is what an empty detail list gets').toMatch(
      /detail === undefined[\s\S]{0,40}errorMessage\(error, locale\)/,
    );
  });

  it('does NOT push the English detail into the shared helper', () => {
    // The guard on the whole app: `errorMessage` stays generic-and-localised. Its own spec
    // asserts the same rule from the other side.
    const shared = readFileSync(join(HERE, '../../shared/lib/errors.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const helper = shared.slice(shared.indexOf('export const errorMessage'));
    expect(helper.slice(0, helper.indexOf('};')), 'errorMessage reads no details').not.toContain(
      'details',
    );
  });
});

// ── the standing board's unsaved work survives a reload ────────────────────
//
// The draft lived in `useState` alone and the query cache is in-memory, so a browser refresh
// took a morning's crew changes with it. Nothing was "cleared" — nothing was ever written down.
describe('the fixed draft is persisted', () => {
  const HOOK = readFileSync(join(HERE, 'lib/useDraftBoard.ts'), 'utf8');

  it('keys the draft with NO DATE — this board is not a day', () => {
    // `fleet_fixed_crews` is one standing row per vehicle, with no date, weekday or effective
    // range anywhere in it. A date key here would split one board's draft across a key per day,
    // so a reader would lose their work by doing nothing but waiting past midnight.
    expect(SOURCE).toContain('useDraftBoard(FIXED_ROSTER_DRAFT_KEY, saved, ROSTER_EDITABLE_FIELDS)');
    const storage = readFileSync(join(HERE, 'lib/draft-storage.ts'), 'utf8');
    expect(storage).toContain("FIXED_ROSTER_DRAFT_KEY = 'ecms.fleet.fixedRoster.draft'");
    expect(storage, 'and the constant carries no date').not.toMatch(
      /FIXED_ROSTER_DRAFT_KEY = [^\n]*\$\{/,
    );
  });

  it('keeps the render-time draft rule intact', () => {
    // Moved, not changed: still derived during render (an effect never runs under
    // `renderToStaticMarkup`, and would flash the board in a browser).
    expect(HOOK).toContain('edit.base === saved ? edit.rows');
    expect(HOOK, 'no effect seeds or persists the draft').not.toContain('useEffect');
  });

  it('writes the draft on every edit, so a reload finds it', () => {
    expect(HOOK).toMatch(/setDraft[\s\S]{0,300}writeDraft\(key, rows\)/);
  });

  it('CANCEL clears storage as well as state', () => {
    // Discarding in memory alone would put the work back on screen at the next reload, which is
    // the opposite of what the button says.
    expect(HOOK).toMatch(/discard[\s\S]{0,200}forget\(\)/);
  });

  it('a successful save drops the draft; a REFUSED save keeps it', () => {
    const commit = SOURCE.slice(SOURCE.indexOf('const commit'), SOURCE.indexOf('const dash'));
    expect(commit).toContain('acceptDraft()');
    expect(
      commit.indexOf('save.mutateAsync'),
      'cleared only after the server accepted it',
    ).toBeLessThan(commit.indexOf('acceptDraft()'));
    expect(
      commit.slice(commit.indexOf('catch')),
      'a refusal is the moment the reader most needs their work',
    ).not.toContain('acceptDraft()');
  });

  it('restores only the fields a reader edits, never facts about the world', () => {
    // A stale `inMaintenance: false` restored over the server's `true` would offer a drop that
    // FR-5 then refuses. The set is now shared by both boards and carries the SHAPE each field's
    // values must have, so a stored value the server would refuse cannot be restored either —
    // `draft-storage.spec.ts` holds that behaviour.
    const storage = readFileSync(join(HERE, 'lib/draft-storage.ts'), 'utf8');
    expect(storage).toContain("missionTypeId: 'id'");
    expect(storage).toContain("driver1EmployeeId: 'id'");
    expect(storage).toContain("driver2EmployeeId: 'id'");
    expect(storage).toContain("notes: 'text'");
    expect(storage, 'the board’s own shape is not editable').not.toContain("inMaintenance: '");
  });

  it('persisting is not saving — nothing here reaches the API', () => {
    const storage = readFileSync(join(HERE, 'lib/draft-storage.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(storage).not.toMatch(/\bfetch\(|saveFixedRoster|planRoster|\bapi\./);
    expect(storage, 'session-scoped: a draft must not outlive the tab').toContain('sessionStorage');
    expect(storage).not.toContain('localStorage');
  });
});
