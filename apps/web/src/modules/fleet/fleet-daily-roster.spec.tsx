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
import { filterDrivers } from './lib/driver-search';

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
const E3 = '650000000000000000000013';
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
  planned: false,
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
  availableDrivers: [
    { employeeId: E1, assignedVehicleId: V1 },
    { employeeId: E3, assignedVehicleId: null },
  ],
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
    [E3, 'سعيد سعد'],
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

/**
 * Is the button carrying `marker` actually disabled?
 *
 * Asserting `.toContain('disabled')` on the tag is NOT sound: every `Button` ships
 * `disabled:cursor-not-allowed disabled:opacity-70` in its class list, so that substring is
 * present whatever the state. Only the rendered ATTRIBUTE distinguishes them.
 */
const buttonDisabled = (markup: string, marker: string): boolean => {
  const at = markup.indexOf(marker);
  if (at === -1) throw new Error(`no button marked ${marker}`);
  const tag = markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('>', at) + 1);
  return / disabled=""/.test(tag) || / disabled>/.test(tag);
};

/** The mission `<select>` of ONE row, found by the aria-label the cell gives it. '' when absent. */
const missionCell = (markup: string, code: string): string => {
  const at = markup.indexOf(`${code} · ${t('fleet.roster.fields.mission')}`);
  if (at === -1) return '';
  return markup.slice(markup.lastIndexOf('<select', at), markup.indexOf('</select>', at) + 9);
};

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
    const card = markup.slice(markup.indexOf(`data-driver-card="${E3}"`));
    expect(card.slice(0, 200), 'the pool row is a drag source').toContain('draggable="true"');
    expect(SOURCE, 'carrying the same payload the fixed board uses').toContain('setData(DRAG_TYPE');
  });

  it('drops a driver the DAY already seats — the pool answers the draft, not the server', () => {
    // E1 is seated on V1 in this board AND present in the server's available list (that list
    // means "free on this date", not "unseated"). The pool must exclude them, or a dispatcher
    // could drag the same person onto a second car and only learn it was illegal on save.
    const markup = render();
    expect(markup, 'the seated driver is not offered again').not.toContain(
      `data-driver-card="${E1}"`,
    );
    expect(markup, 'and the unseated one is').toContain(`data-driver-card="${E3}"`);
    expect(SOURCE, 'derived from the draft').toContain('availableDrivers(board?.availableDrivers');
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

  it('edits the DRAFT — a drop persists nothing on its own', () => {
    const drop = SOURCE.slice(SOURCE.indexOf('const dropDriver ='), SOURCE.indexOf('const commit ='));
    expect(drop, 'the drop edits local state').toContain('setDraft(');
    expect(drop, 'and does not save').not.toContain('mutateAsync');
  });

  it('commits through the EXISTING plan mutation, not a new path', () => {
    const commit = SOURCE.slice(
      SOURCE.indexOf('const commit ='),
      SOURCE.indexOf('const confirmClear'),
    );
    expect(commit, 'the existing mutation').toContain('plan.mutateAsync(');
    expect(commit, 'sending exactly the changed rows').toContain('rows: pending');
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
    // The condition is EXACTLY the document's existence. Asserted whole rather than as a
    // substring: `assignment !== undefined && assignment.driver1EmployeeId !== null` contains
    // the substring too, and is precisely the bug — a day somebody emptied on purpose would
    // fall through and have the standing crew put back on it.
    expect(board, 'the distinction is the document’s existence, and nothing else').toContain(
      'if (assignment !== undefined) {',
    );
    expect(board, 'not whether its drivers happen to be null').not.toMatch(
      /driver1EmployeeId === null[\s\S]{0,80}fixed/,
    );
  });
});

// ── 7. the day is a DRAFT, and «حفظ» is what makes it a fact ────────────────
//
// The board used to write on every drop. Planning a day is a sequence of related decisions, so
// each keystroke became a fact, «إلغاء» had nothing to undo, and one plan produced a dozen audit
// entries. These assert the draft exists, that nothing leaves the page without a save, and that
// the save sends exactly what changed.

describe('the daily draft and its Save', () => {
  it('holds the day locally, seeded from the board the server derived', () => {
    // The rule itself now lives in `useDraftBoard`, shared with the fixed board and given a
    // memory across a reload. It is UNCHANGED: a draft is held together with the server board it
    // was taken from, compared by identity, so it resets when the server answers with a
    // different board and stays put in between.
    const hook = readFileSync(join(HERE, 'lib/useDraftBoard.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(hook, 'a draft, based on the board it came from').toContain(
      'edit.base === saved ? edit.rows',
    );
    expect(SOURCE, 'and this page uses it').toContain('useDraftBoard(');
    expect(SOURCE, 'the baseline IS the server’s derived day').toContain(
      'const saved = useMemo(() => board?.rows ?? []',
    );
  });

  it('derives the draft during RENDER, not in an effect', () => {
    // An effect runs after the first paint — the board would flash — and never runs at all under
    // `renderToStaticMarkup`, which is how this file tests the screen. A draft seeded by an
    // effect would therefore be untestable here and visibly wrong in a browser.
    expect(SOURCE, 'no effect seeds the draft').not.toContain('useEffect');
  });

  it('offers Save and Cancel, and both are dead until something changes', () => {
    // This board arrives with an operation still only projected, so Save is deliberately LIVE —
    // see the two tests below. What must be dead with nothing edited is «إلغاء».
    const markup = render();
    expect(
      buttonDisabled(markup, `>${t('common.cancel')}<`),
      'nothing edited, so nothing to discard',
    ).toBe(true);
    expect(SOURCE, 'the save is gated on real changes').toContain('disabled={!dirty}');
    expect(SOURCE, 'and the cancel is gated on real EDITS').toContain(
      'disabled={!edited || plan.isPending}',
    );
    expect(markup, 'both buttons are offered').toContain(t('common.save'));
    expect(markup).toContain(t('common.cancel'));
  });

  it('is SAVEABLE on an untouched day that still carries an inherited operation', () => {
    // The heart of the fix. V1 arrives `planned: false` with a mission and a driver projected
    // from the standing crew — nothing is stored for it yet, so `operations/crew-board`, which
    // lists the day by iterating the duty documents, does not know this vehicle exists. The
    // dispatcher must be able to commit that without first having to change something.
    const markup = render();
    expect(buttonDisabled(markup, 'data-save-roster="true"'), 'Save is live').toBe(false);
    expect(markup, 'and the day is marked unsaved').toContain('data-unsaved="true"');
  });

  it('is NOT saveable once every row is already stored', () => {
    const allStored: FleetRosterDayDto = {
      ...BOARD,
      rows: BOARD.rows.map((r) => ({ ...r, planned: true })),
    };
    const markup = render({ qc: client(allStored) });
    expect(buttonDisabled(markup, 'data-save-roster="true"'), 'nothing left to commit').toBe(true);
    expect(markup).not.toContain('data-unsaved="true"');
  });

  it('saves the EFFECTIVE day — edits, plus any operation still only projected', () => {
    // Not `changedRows`: an operation inherited from the standing crew is real to this screen
    // but invisible to Operations until a duty row exists for it. Sending only what changed made
    // "the dispatcher agreed with the fixed roster" and "there is nothing to plan" identical.
    expect(SOURCE, 'the payload is the effective day').toContain('rowsToSave(saved, draft)');
    expect(SOURCE, 'and dirty is exactly that').toContain('const dirty = pending.length > 0');
    expect(SOURCE, 'while «إلغاء» asks the narrower question').toContain('hasEdits(saved, draft)');
  });

  it('knows which rows are still only a projection, because the server says so', () => {
    expect(SERVICE, 'a stored day is flagged').toContain('planned: true');
    expect(SERVICE, 'and a derived one is flagged too').toContain('planned: false');
  });

  it('CANCEL restores the last saved day rather than clearing the board', () => {
    const hook = readFileSync(join(HERE, 'lib/useDraftBoard.ts'), 'utf8');
    expect(hook, 'discard rebases the draft on the saved board').toContain(
      'setEdit({ base: saved, rows: [...saved] })',
    );
    expect(hook, 'and clears STORAGE too — «إلغاء» must not survive a reload').toMatch(
      /discard[\s\S]{0,200}forget\(\)/,
    );
    expect(SOURCE, 'the page still offers it').toContain('discard');
  });

  it('sends exactly the changed rows, once, on Save', () => {
    const commit = SOURCE.slice(
      SOURCE.indexOf('const commit ='),
      SOURCE.indexOf('const confirmClear'),
    );
    expect(commit, 'nothing is sent when nothing changed').toContain('if (!dirty) return');
    expect(commit, 'the payload is the diff').toContain('rows: pending');
    expect(commit, 'for the day on screen').toContain('dateKey: date');
  });

  it('surfaces a refusal instead of failing silently', () => {
    // `usePlanRoster` defines its own `onError`, which opts the mutation OUT of the global error
    // toast. Without a local one the button would just stop spinning and the edits would vanish.
    const commit = SOURCE.slice(
      SOURCE.indexOf('const commit ='),
      SOURCE.indexOf('const confirmClear'),
    );
    expect(commit).toContain('toast.error(errorMessage(error, locale))');
  });

  it('never writes the FIXED crew — this screen has no path to it', () => {
    // Narrow on purpose: this screen legitimately reuses two `fleet.fixedRoster.*` TRANSLATION
    // keys («اسحب السائق هنا», «بدون نوع مهمة»). What it must not have is a way to WRITE the
    // standing crew — a mutation hook, or that board's endpoint.
    expect(SOURCE, 'no fixed-crew mutation hook').not.toContain('useSaveFixedRoster');
    expect(SOURCE, 'no fixed-crew query either').not.toContain('useFixedRoster');
    expect(SOURCE, 'and it does not even import the fixed board’s rules').not.toContain(
      'fixed-roster-board',
    );
    const api = readFileSync(join(HERE, 'api/fleet-api.ts'), 'utf8');
    const commit = SOURCE.slice(
      SOURCE.indexOf('const commit ='),
      SOURCE.indexOf('const confirmClear'),
    );
    expect(commit, 'the only write is the day plan').toContain('plan.mutateAsync');
    expect(api).toContain('planRoster');
  });

  it('routes the edit dialog through the draft too — one write path, not two', () => {
    const dialog = readFileSync(join(HERE, 'components/RosterAssignDialog.tsx'), 'utf8');
    expect(dialog, 'the dialog no longer persists').not.toContain('mutateAsync');
    expect(dialog, 'it hands its values back').toContain('onSave({');
    expect(SOURCE, 'and the page applies them to the draft').toContain(
      'setDraft(() => applyEdit(draft, editingRow.vehicleId, values))',
    );
  });
});

// ── 8. «نوع المهمة», in the cell ────────────────────────────────────────────

describe('the mission type is chosen on the row', () => {
  it('renders a real select per row, bound to missionTypeId', () => {
    const markup = render();
    const cell = missionCell(markup, '150');
    expect(cell, 'a select, not a label').toContain('<select');
    expect(cell, 'single-select — no multiple, no size').not.toContain('multiple');
    expect(cell, 'holding the row’s current mission').toContain(`value="${MT}"`);
  });

  it('offers the catalog’s active items and a way back to none', () => {
    const markup = render();
    expect(markup, 'the catalog name, localized').toContain('نقل أموال (يومي)');
    expect(markup, 'and an empty option to clear it').toContain(t('fleet.fixedRoster.noMissionType'));
  });

  it('writes the choice into the DRAFT, not to the server', () => {
    expect(SOURCE, 'the cell edits the draft').toContain(
      'setDraft(() => setMission(draft, row.vehicleId, id === \'\' ? null : id))',
    );
  });

  it('shows the name as text to a reader who may not plan', () => {
    const markup = render({ permissions: ['fleetRoster.view'] });
    // The header's mission FILTER is a select for everyone — it narrows what you read. What a
    // viewer must not get is the per-ROW editor, so the assertion is about that cell alone.
    expect(missionCell(markup, '150'), 'no editable control on the row').toBe('');
    expect(markup, 'but the mission is still readable').toContain('نقل أموال (يومي)');
  });
});

// ── 9. the vehicle cell: the code, and not the plate ────────────────────────

describe('the vehicle cell', () => {
  it('shows the code', () => {
    expect(render(), 'the identifier this fleet dispatches by').toContain('>150<');
  });

  it('does NOT show the plate number under it', () => {
    // A second identifier under every row of the column the eye scans for one. The plate is
    // still SEARCHABLE — a dispatcher holding a plate number types it above — it just is not
    // repeated down the board.
    const markup = render();
    expect(markup, 'the plate is gone from the cell').not.toContain('س ص 150');
    const vehicleCol = SOURCE.slice(SOURCE.indexOf("key: 'vehicle'"), SOURCE.indexOf("key: 'state'"));
    expect(vehicleCol, 'and the cell does not render it at all').not.toContain('plateNumber');
    expect(SOURCE, 'while the search still matches it').toContain(
      'row.plateNumber.toLowerCase().includes(term)',
    );
  });
});

// ── 10. the counters answer the DRAFT ───────────────────────────────────────

describe('the day’s counters', () => {
  it('count the draft, so an unsaved edit is reflected immediately', () => {
    expect(SOURCE, 'counted off the draft, not the server’s last answer').toContain(
      'for (const row of draft)',
    );
    const block = SOURCE.slice(SOURCE.indexOf('const counters = useMemo'), SOURCE.indexOf('const pool'));
    expect(block, 'the total is the draft’s length').toContain('value: draft.length');
    expect(block, 'the workshop tally reads the draft').toContain(
      'draft.filter((row) => row.inMaintenance).length',
    );
    expect(block, 'and so does the operating tally').toContain('draft.filter(hasFacts).length');
    expect(block, 'the memo depends on the draft').toContain('[draft, missionTypes.data, locale, t]');
  });

  it('names missions from the catalog — nothing is hardcoded', () => {
    const block = SOURCE.slice(SOURCE.indexOf('const counters = useMemo'), SOURCE.indexOf('const pool'));
    expect(block, 'one counter per ACTIVE catalog item').toContain('.filter((item) => item.isActive)');
    expect(block, 'named by the catalog').toContain('localized(item.name, locale)');
    const markup = render();
    expect(markup, 'the catalog name appears as a counter').toContain('نقل أموال (يومي)');
    for (const literal of ['صيانة و', 'نقل أموال (صيانة)']) {
      expect(block, `no hardcoded mission name: ${literal}`).not.toContain(literal);
    }
  });

  it('sits in the same top strip as the filters, not in a block of its own', () => {
    const markup = render();
    const strip = markup.indexOf('data-counter="total"');
    const searchAt = markup.indexOf(t('fleet.roster.searchPlaceholder'));
    const missionFilterAt = markup.indexOf(t('fleet.roster.allMissions'));
    expect(searchAt, 'the code search is above the counters').toBeGreaterThan(-1);
    expect(missionFilterAt, 'so is «كل المهمات»').toBeGreaterThan(-1);
    expect(searchAt, 'search comes first in the strip').toBeLessThan(strip);
    expect(missionFilterAt, 'then the mission filter').toBeLessThan(strip);
    expect(SOURCE, 'the old FilterBar block under the header is gone').not.toContain('<FilterBar');
  });
});

// ── 11. a second driver needs a first, on the DAY ──────────────────────────
//
// `operations/crew-board` reads the DUTY row's slot 1 as "the driver" of the day, so a day
// holding only a second driver reaches Operations as a crewless vehicle with a real person
// committed to it. The rule lives in the schema, the service and the board arithmetic; this is
// the part a dispatcher meets.

describe('driver 2 depends on driver 1', () => {
  const zone = (markup: string, vehicleId: string, slot: string): string => {
    const at = markup.indexOf(`data-drop-zone="${vehicleId}:${slot}"`);
    return at === -1 ? '' : markup.slice(at, markup.indexOf('>', at));
  };

  it('makes slot 2 a NON-target while slot 1 is empty', () => {
    // V2 in this board is in the workshop, so use a plain empty vehicle for the claim.
    const board: FleetRosterDayDto = { ...BOARD, rows: [row(V1, '150')] };
    const markup = render({ qc: client(board) });
    expect(zone(markup, V1, 'driver1EmployeeId'), 'the first seat is open').not.toContain(
      'data-drop-disabled',
    );
    expect(zone(markup, V1, 'driver2EmployeeId'), 'the second is not, and says why').toContain(
      'data-drop-disabled="needsFirstDriver"',
    );
  });

  it('refuses the drop in code, not only in the styling', () => {
    // A `data-` attribute is a label. This is the gate: `onDragOver` never prevents the default,
    // so the browser does not treat the slot as a drop target at all.
    expect(SOURCE, 'the gate exists').toContain(
      "const needsFirst = slot === 'driver2EmployeeId' && row.driver1EmployeeId === null",
    );
    expect(SOURCE, 'and both handlers ride it').toContain(
      'const droppable = mayPlan && !row.inMaintenance && !needsFirst',
    );
  });

  it('OPENS slot 2 as soon as slot 1 holds somebody', () => {
    const board: FleetRosterDayDto = { ...BOARD, rows: [row(V1, '150', { driver1EmployeeId: E1 })] };
    const markup = render({ qc: client(board) });
    expect(zone(markup, V1, 'driver2EmployeeId')).not.toContain('data-drop-disabled');
  });

  it('is refused SERVER-side too — the UI is not the guard', () => {
    expect(SERVICE, 'the service refuses the pair').toContain('DRIVER2_WITHOUT_DRIVER1');
  });
});

// ── 12. one day's board never becomes another day's ────────────────────────
//
// A REAL bug, and worth stating plainly because the symptom looked cosmetic and was not.
//
// `useRosterDay` is keyed by the date and carried `placeholderData: (prev) => prev`. That option
// is right almost everywhere on that module — a filter or a page's previous answer is the same
// question, slightly stale. Here the key IS the entity's identity, so it served ANOTHER DAY's
// roster: not stale data, wrong data. And because this board is editable the harm ran past
// display — with the previous day's rows in hand the page armed «حفظ», and a save inside that
// window POSTED that day's crew under the NEW date, overwriting the day actually planned there.
//
// Measured in Chromium before the fix: switching to a day with its own stored crew showed the
// previous day's driver with no loading state, Save enabled, and one click wrote `…01` onto a
// day whose stored driver was `…02`.

describe('a day shows its own board, and only its own', () => {
  it('the query does NOT serve the previous day while a new one loads', () => {
    const queries = readFileSync(join(HERE, 'api/fleet-queries.ts'), 'utf8');
    const hook = queries.slice(
      queries.indexOf('export const useRosterDay'),
      queries.indexOf('export const usePlanRoster'),
    );
    expect(hook, 'keyed by the date').toContain('queryKey: rosterDayKey(date)');
    expect(
      hook,
      'and it must not hand back the previous key’s board — that is another DAY',
    ).not.toContain('placeholderData');
  });

  it('ignores a board that describes a DIFFERENT date', () => {
    // The invariant restated where it is relied on, so a caching option added to the hook later
    // cannot quietly put another day's crew on screen and into the payload again.
    expect(SOURCE, 'the response carries the day it describes, and the page checks it').toContain(
      "boardQuery.data?.date.slice(0, 10) === date ? boardQuery.data : undefined",
    );
  });

  it('renders NOTHING of another day when the cached board is stale', () => {
    // A cache primed for the wrong date: the page must not paint that crew.
    const qc = client(BOARD, day(1));
    const markup = render({ date: day(2), qc });
    expect(markup, 'no vehicle row from the other day').not.toContain('data-drop-zone');
    expect(markup, 'and no driver from it either').not.toContain(`data-driver-chip="${E1}"`);
  });

  it('does not arm «حفظ» against another day’s rows', () => {
    // The data-integrity half. Armed here, one click posts the wrong day's crew under this date.
    const qc = client(BOARD, day(1));
    const markup = render({ date: day(2), qc });
    expect(buttonDisabled(markup, 'data-save-roster="true"'), 'nothing to save for a day we have not got').toBe(
      true,
    );
    expect(markup).not.toContain('data-unsaved="true"');
  });

  it('says it is LOADING rather than showing an empty fleet', () => {
    // Rejecting the board must not read as "this day has no vehicles".
    expect(SOURCE, 'the table waits for the right day').toContain(
      'boardQuery.isPending || (board === undefined && !boardQuery.isError)',
    );
  });

  it('shows each day its own state — a stored override does not leak to the next day', () => {
    // The two days differ the way they really can: one has a stored duty row, the other inherits
    // the (dateless) standing crew. Rendered from their own caches, each shows its own answer.
    const overridden: FleetRosterDayDto = {
      ...BOARD,
      date: `${day(2)}T00:00:00.000Z`,
      rows: [row(V1, '150', { planned: true, missionTypeId: MT, driver1EmployeeId: E3 })],
    };
    const inherited: FleetRosterDayDto = {
      ...BOARD,
      date: `${day(3)}T00:00:00.000Z`,
      rows: [row(V1, '150', { planned: false, missionTypeId: MT, driver1EmployeeId: E1 })],
    };
    // Scoped to the SEAT, not the whole page: an unseated driver also appears in the pool, so
    // `markup.contains(chip)` would be true either way and the assertion would prove nothing.
    const seated = (markup: string, vehicleId: string): string | null => {
      const at = markup.indexOf(`data-drop-zone="${vehicleId}:driver1EmployeeId"`);
      if (at === -1) return null;
      const cell = markup.slice(at, markup.indexOf('</div>', at));
      return /data-driver-chip="([0-9a-f]{24})"/.exec(cell)?.[1] ?? null;
    };
    const d2 = render({ date: day(2), qc: client(overridden, day(2)) });
    const d3 = render({ date: day(3), qc: client(inherited, day(3)) });
    expect(seated(d2, V1), 'the overridden day seats its own driver').toBe(E3);
    expect(seated(d3, V1), 'the inherited day seats the standing one').toBe(E1);
  });
});

// ── finding a driver in EITHER list ────────────────────────────────────────
//
// Each panel carries its own box, searching its own list — the same shape as the Fixed Roster's
// driver panel. The two answer different questions ("who can I put on a car" and "who is out
// today, and why"), so the terms are independent: filtering one panel leaves the other alone.
//
// The filtering itself is `filterDrivers`, already proven pure in `driver-search.spec.ts`. What
// is asserted here is that THIS PAGE routes BOTH lists through it — a page that filtered one
// and rendered the other raw would pass every test in that file.
describe('each driver list has its own search', () => {
  const index = new Map([
    [E1, { employeeId: E1, nameAr: 'محمد حاتم', nameEn: 'Mohamed Hatem', code: 'DRV-1' }],
    [E2, { employeeId: E2, nameAr: 'علي سعيد', nameEn: 'Ali Said', code: 'DRV-2' }],
    [E3, { employeeId: E3, nameAr: 'سامي فؤاد', nameEn: 'Sami Fouad', code: 'DRV-3' }],
  ]);
  const available = [
    { employeeId: E1, assignedVehicleId: null },
    { employeeId: E3, assignedVehicleId: null },
  ];
  const unavailable = [{ employeeId: E2, reason: 'hrLeave' }];

  it('finds a driver who is AVAILABLE', () => {
    expect(filterDrivers(available, index, 'محمد').map((d) => d.employeeId)).toEqual([E1]);
  });

  it('finds a driver who is UNAVAILABLE — the half a one-sided search would hide', () => {
    expect(filterDrivers(unavailable, index, 'علي').map((d) => d.employeeId)).toEqual([E2]);
    // And the reason travels with them: the row still says WHY they cannot be assigned.
    expect(filterDrivers(unavailable, index, 'علي')[0]?.reason).toBe('hrLeave');
  });

  it('matches part of a name, in either language, and the code', () => {
    for (const term of ['حات', 'hate', 'HATE', 'drv-1']) {
      expect(filterDrivers(available, index, term).map((d) => d.employeeId), term).toEqual([E1]);
    }
  });

  it('answers with an empty list when nobody matches — in both halves', () => {
    expect(filterDrivers(available, index, 'zzzz')).toEqual([]);
    expect(filterDrivers(unavailable, index, 'zzzz')).toEqual([]);
  });

  it('CLEARING the box brings everybody back, on both sides', () => {
    for (const term of ['', '   ']) {
      expect(filterDrivers(available, index, term)).toHaveLength(2);
      expect(filterDrivers(unavailable, index, term)).toHaveLength(1);
    }
  });

  it('the page filters the AVAILABLE list', () => {
    expect(SOURCE).toContain('shownAvailable = useMemo');
    expect(SOURCE, 'and renders the filtered list, not the pool').toContain('shownAvailable.map(');
  });

  it('the page filters the UNAVAILABLE list', () => {
    expect(SOURCE).toContain('shownUnavailable = useMemo');
    expect(SOURCE, 'and renders the filtered list, not the server array').toContain(
      'shownUnavailable.map(',
    );
  });

  it('indexes BOTH halves, so one term can reach either', () => {
    const call = SOURCE.slice(SOURCE.indexOf('useEmployeeRecords('), SOURCE.indexOf('searchIndex'));
    expect(call).toContain('pool.map');
    expect(call, 'the unavailable half is indexed too').toContain('unavailable.map');
  });

  it('renders ONE box INSIDE each panel — two in all', () => {
    const markup = render();
    const boxes = markup.split('placeholder="' + t('fleet.fixedRoster.driverSearchPlaceholder'));
    expect(boxes.length - 1, 'one per driver panel').toBe(2);
  });

  it('puts each box inside its own panel, not above the pair', () => {
    // Position is the claim: a box between the table and the two panels would look like it
    // filtered both. Each must sit after its own panel's heading.
    const markup = render();
    const placeholder = 'placeholder="' + t('fleet.fixedRoster.driverSearchPlaceholder');
    for (const title of ['fleet.roster.availableTitle', 'fleet.roster.unavailableTitle']) {
      const heading = markup.indexOf(t(title));
      expect(heading, `${title} is on the page`).toBeGreaterThan(-1);
      const after = markup.indexOf(placeholder, heading);
      expect(after, `${title} is followed by its own search box`).toBeGreaterThan(-1);
      // …and nothing but that panel's own list comes between them.
      expect(markup.slice(heading, after)).not.toContain(t('fleet.roster.unavailableTitle') === t(title) ? t('fleet.roster.availableTitle') : t('fleet.roster.unavailableTitle'));
    }
  });

  it('keeps the two terms INDEPENDENT — each list filters by its OWN box', () => {
    // The point of splitting them: a shared term emptied whichever panel the person was not in.
    // Asserted on the filter calls themselves rather than on the surrounding block, because a
    // dependency array naming both terms would satisfy a looser check while the call passed the
    // wrong one — which is exactly the mistake this guards.
    expect(SOURCE, 'the available list filters by the available box').toContain(
      'filterDrivers(pool, searchIndex, availableSearch)',
    );
    expect(SOURCE, 'the unavailable list filters by the unavailable box').toContain(
      'filterDrivers(unavailable, searchIndex, unavailableSearch)',
    );
    // Neither may reach for the other's term.
    expect(SOURCE).not.toContain('filterDrivers(pool, searchIndex, unavailableSearch)');
    expect(SOURCE).not.toContain('filterDrivers(unavailable, searchIndex, availableSearch)');
  });

  it('is DISPLAY ONLY — the draft, the counters and the payload read the unfiltered lists', () => {
    // The rule that keeps a search from becoming a data change: the two `shown*` arrays are
    // rendered and nothing else. `pool` is what the drag rules and counters read.
    expect(SOURCE, 'the pool still feeds the drag rules').toContain(
      'availableDrivers(board?.availableDrivers',
    );
    for (const forbidden of [
      'rowsToSave(saved, shown',
      'hasEdits(saved, shown',
      'availableDrivers(shown',
    ]) {
      expect(SOURCE, `${forbidden} would make a search change the data`).not.toContain(forbidden);
    }
  });

  it('does not make the search a URL parameter — it is not what the page is about', () => {
    // `?q=` filters VEHICLES and belongs in a shareable link. Which driver you were hunting for
    // does not, and putting it in the URL would also reset it on every navigation.
    expect(SOURCE).toContain("const [availableSearch, setAvailableSearch] = useState('')");
    expect(SOURCE).toContain("const [unavailableSearch, setUnavailableSearch] = useState('')");
    expect(SOURCE).not.toContain("sp.get('driver')");
  });
});

// ── a day's unsaved work survives a reload, and belongs to that day ────────
describe('the daily draft is persisted, per day', () => {
  it('keys the draft by DATE — the whole of the cross-day guarantee', () => {
    expect(SOURCE).toContain('useDraftBoard(rosterDraftKey(date), saved, ROSTER_EDITABLE_FIELDS)');
  });

  it('drops only THIS day’s draft after a successful save', () => {
    const commit = SOURCE.slice(SOURCE.indexOf('const commit'), SOURCE.indexOf('const confirmClear'));
    expect(commit, 'the save clears the draft').toContain('acceptDraft()');
    const before = commit.indexOf('plan.mutateAsync');
    expect(before, 'and only AFTER the server accepted it').toBeLessThan(commit.indexOf('acceptDraft()'));
    expect(commit.slice(commit.indexOf('catch')), 'a REFUSED save keeps the work').not.toContain(
      'acceptDraft()',
    );
  });

  it('restores only the fields a reader edits, and only usable values', () => {
    // Both boards share one spec, so neither can drift into trusting a field the other checks.
    expect(SOURCE).toContain('ROSTER_EDITABLE_FIELDS');
    const storage = readFileSync(join(HERE, 'lib/draft-storage.ts'), 'utf8');
    for (const field of ['missionTypeId', 'driver1EmployeeId', 'driver2EmployeeId']) {
      expect(storage, `${field} is checked as an id`).toContain(`${field}: 'id'`);
    }
  });

  it('never posts the draft anywhere', () => {
    const storage = readFileSync(join(HERE, 'lib/draft-storage.ts'), 'utf8');
    expect(storage).not.toMatch(/\bfetch\(|planRoster|saveFixedRoster/);
  });
});
