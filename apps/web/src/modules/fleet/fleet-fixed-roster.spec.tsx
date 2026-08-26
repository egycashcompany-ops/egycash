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
const WT = '650000000000000000000021';

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
  workTypeId: null,
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
  // The REAL `workType` catalog key, in the shape `useFleetCatalog('workType')` reads.
  qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'workType' }], {
    items: [
      { id: WT, kind: 'workType', name: { ar: 'نقل نقدية', en: 'Cash run' }, isActive: true },
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

  it('names each vehicle by code and plate, as the daily board does', () => {
    const body = tbody(render());
    expect(body).toContain('150');
    expect(body).toContain('س ص 150');
  });

  it('shows the work type and the note as REAL values, dashed only when empty', () => {
    // These were permanent placeholders until the crew gained the two fields. The dash is now
    // what "this row holds nothing" looks like, not what the column always looks like — so a
    // populated row must actually print its values.
    const filled: FleetFixedRosterDto = {
      ...BOARD,
      rows: [{ ...row(V1, '150'), workTypeId: WT, notes: 'يبدأ من المخزن' }, row(V2, '151')],
    };
    const body = tbody(render({ qc: client(filled) }));
    expect(body, 'the catalog item name, not its id').toContain('نقل نقدية');
    expect(body).not.toContain(WT);
    expect(body).toContain('يبدأ من المخزن');
    // …and the untouched row still reads as empty.
    expect(body).toContain('—');
  });

  it('renders the work type by NAME, resolved from the catalog, never the raw id', () => {
    // Persisting the id and displaying the label is the project's catalog convention; printing
    // the ObjectId would be unreadable and would leak a key the reader cannot act on.
    expect(SOURCE, 'the id is resolved through the catalog').toContain(
      'workTypeName(row.workTypeId)',
    );
    expect(SOURCE).toContain("useFleetCatalog('workType')");
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
  const DIALOG = SOURCE.slice(
    SOURCE.indexOf('const EditCrewDialog'),
    SOURCE.indexOf('export const FixedRosterPage'),
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
      'useState<string | null>(row.workTypeId)',
      'useState<string | null>(row.driver1EmployeeId)',
      'useState<string | null>(row.driver2EmployeeId)',
      "useState<string>(row.notes ?? '')",
    ]) {
      expect(DIALOG, seed).toContain(seed);
    }
  });

  it('fills the work-type select from the REAL catalog, never a hardcoded list', () => {
    expect(SOURCE).toContain("useFleetCatalog('workType')");
    expect(DIALOG, 'options come from the query').toContain('workTypes.data?.items ?? []');
    expect(DIALOG, 'and the id is what is stored').toContain('value={item.id}');
    expect(DIALOG, 'the label is the localized catalog name').toContain(
      'localized(item.name, locale)',
    );
  });

  it('is a SINGLE select — one work type per vehicle', () => {
    expect(DIALOG, 'a <select>, not a multi-select').toContain('<Select');
    expect(DIALOG).not.toContain('MultiSelect');
    expect(DIALOG, 'no multiple attribute').not.toMatch(/\bmultiple\b/);
  });

  it('handles the catalog’s loading, empty and failed states', () => {
    expect(DIALOG, 'loading').toContain('workTypes.isPending');
    expect(DIALOG, 'error').toContain('workTypes.isError');
    expect(DIALOG, 'empty').toContain('noWorkTypesYet');
  });

  it('lets a vehicle have NO work type, and no driver', () => {
    expect(DIALOG).toContain("t('fleet.fixedRoster.noWorkType')");
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
    // The only path that reaches the board is the save handler.
    expect(SOURCE.match(/applyEdit\(/g) ?? [], 'exactly one commit point').toHaveLength(1);
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
    const slot = SOURCE.slice(SOURCE.indexOf('const Slot = ('), SOURCE.indexOf('const columns'));
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

  it('gives the board more of the width than it used to', () => {
    // A quarter for the panel instead of a third. `min-w-0` on both halves is what lets the
    // table keep its own overflow rather than pushing the page sideways.
    expect(SOURCE).toContain('xl:grid-cols-4');
    expect(SOURCE).toContain('xl:col-span-3');
    expect(SOURCE, 'the panel can shrink too').toContain('min-w-0 space-y-6');
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
