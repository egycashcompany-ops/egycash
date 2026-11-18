// «الطقم الثابت» — the board model both layouts draw (the computer's table, the phone / tablet cards).
//
// Two halves, as the daily model's spec. The PURE pieces (the undo steps, the edit step, the
// counters, the filters, the touch cars, the seat / card rows) are asserted directly. The HOOK is
// rendered once per case with `renderToStaticMarkup` over seeded query caches — the web suite has
// no DOM, and the draft is derived during render. An action called after the render writes the
// DRAFT through to (stubbed) storage, exactly as it does in a tab, and the next render restores
// it: that is how an edit is seen here, and how a reload is.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SaveFleetFixedRosterSchema,
  type FleetFixedCrewRowDto,
  type FleetFixedRosterDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import { fixedSource } from '../fixed-roster-spec-sources';
import { FIXED_ROSTER_DRAFT_KEY } from './draft-storage';
import { applyEdit, assignDriver, changedRows, swapDrivers } from './fixed-roster-board';
import { COUNTER_TONES, missionTone } from './roster-view';
import { UNDO_LIMIT } from './roster-board';
import {
  NO_FIXED_UNDO,
  fixedCounters,
  fixedEditStep,
  fixedFiltersHiding,
  fixedTouchCars,
  fixedUndoSteps,
  popFixedUndo,
  pushFixedUndo,
  toCardRow,
  toSeatRow,
  useFixedRosterBoard,
  type FixedRosterBoardModel,
  type FixedRosterQuery,
} from './fixed-roster-model';

// ── the mocks: the file, the toasts, the save ───────────────────────────────────────────────────
const { saveSheet, toastSuccess, toastError, saveFixedRoster } = vi.hoisted(() => ({
  saveSheet: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  saveFixedRoster: vi.fn(),
}));
vi.mock('./fleet-sheet', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  saveSheet,
}));
vi.mock('../../../shared/ui/toast/toast-store', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { success: toastSuccess, error: toastError, info: vi.fn(), warning: vi.fn() },
}));
vi.mock('../api/fleet-api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  saveFixedRoster,
}));

const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const V3 = '650000000000000000000003';
const V4 = '650000000000000000000004';
/** A car NOT on this board — another branch's, or one out of service. */
const V_OFF = '650000000000000000000039';
const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';
const E3 = '650000000000000000000013';
const E4 = '650000000000000000000014';
const E5 = '650000000000000000000015';
const E6 = '650000000000000000000016';
const MT = '650000000000000000000021';
const MT_OLD = '650000000000000000000022';

const row = (
  vehicleId: string,
  code: string,
  over: Partial<FleetFixedCrewRowDto> = {},
): FleetFixedCrewRowDto => ({
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

/**
 *   152  E3 alone                       (listed first: the server's order is not trusted)
 *   150  E1 + E2, on mission MT, a note
 *   153  nobody
 *   151  in the workshop, nobody
 * Drivers: E1, E2 (150), E3 (152), E4 free, E5 held on a car OFF this board, E6 free.
 */
const BOARD: FleetFixedRosterDto = {
  rows: [
    row(V3, '152', { driver1EmployeeId: E3 }),
    row(V1, '150', {
      missionTypeId: MT,
      driver1EmployeeId: E1,
      driver2EmployeeId: E2,
      notes: 'الوردية الصباحية',
    }),
    row(V4, '153'),
    row(V2, '151', { inMaintenance: true }),
  ],
  drivers: [
    { employeeId: E1, assignedVehicleId: V1 },
    { employeeId: E2, assignedVehicleId: V1 },
    { employeeId: E3, assignedVehicleId: V3 },
    { employeeId: E4, assignedVehicleId: null },
    { employeeId: E5, assignedVehicleId: V_OFF },
    { employeeId: E6, assignedVehicleId: null },
  ],
};

const PEOPLE: readonly (readonly [string, string, string])[] = [
  [E1, 'أحمد محمد', '11001'],
  [E2, 'محمد محمود', '11002'],
  [E3, 'سعيد سعد', '11003'],
  [E4, 'كريم علي', '11004'],
  [E5, 'عمرو حسن', '11005'],
  [E6, 'ياسر فتحي', '11006'],
];

const client = (board: FleetFixedRosterDto = BOARD): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'fixed-roster'], board);
  qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'missionType' }], {
    items: [
      { id: MT, kind: 'missionType', name: { ar: 'نقل نقدية', en: 'Cash run' }, isActive: true },
      { id: MT_OLD, kind: 'missionType', name: { ar: 'قديمة', en: 'Old' }, isActive: false },
    ],
    meta: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
  });
  qc.setQueryData(
    ['fleet', 'people'],
    PEOPLE.map(([employeeId, fullNameAr, code]) => ({
      employeeId,
      code,
      fullNameAr,
      status: 'active' as const,
      branchId: null,
      address: null,
      governorate: null,
      phone: null,
      hiredAt: null,
    })),
  );
  return qc;
};

const PLANNER = ['fleetRoster.view', 'fleetRoster.plan', 'fleetDriver.view'];
const VIEWER = ['fleetRoster.view', 'fleetDriver.view'];

const store = (permissions: readonly string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((key) => [key, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const query = (over: Partial<FixedRosterQuery> = {}): FixedRosterQuery => ({
  mayPlan: true,
  search: '',
  missions: [],
  view: null,
  patch: () => undefined,
  ...over,
});

let captured: FixedRosterBoardModel | undefined;
const Probe = ({ q }: { q: FixedRosterQuery }): null => {
  captured = useFixedRosterBoard(q);
  return null;
};

/** The model as one render of the hook sees it. */
const model = (
  over: Partial<FixedRosterQuery> = {},
  {
    permissions = PLANNER,
    qc = client(),
  }: { permissions?: readonly string[]; qc?: QueryClient } = {},
): FixedRosterBoardModel => {
  captured = undefined;
  renderToStaticMarkup(
    createElement(Provider, {
      store: store(permissions),
      children: createElement(QueryClientProvider, {
        client: qc,
        children: createElement(Probe, { q: query(over) }),
      }),
    }),
  );
  if (captured === undefined) throw new Error('the probe did not render');
  return captured;
};

/** The tab's sessionStorage — what a reload finds. */
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
    setTimeout: () => 0,
  });
  saveSheet.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  saveFixedRoster.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const withDraft = (rows: readonly FleetFixedCrewRowDto[]): void => {
  stored.set(FIXED_ROSTER_DRAFT_KEY, JSON.stringify(rows));
};
/** The draft a reload would find, as rows. */
const storedDraft = (): FleetFixedCrewRowDto[] | null => {
  const raw = stored.get(FIXED_ROSTER_DRAFT_KEY);
  return raw === undefined ? null : (JSON.parse(raw) as FleetFixedCrewRowDto[]);
};
const crewOf = (rows: readonly FleetFixedCrewRowDto[] | null, vehicleId: string): string => {
  const found = rows?.find((r) => r.vehicleId === vehicleId);
  return `${found?.driver1EmployeeId ?? '-'}/${found?.driver2EmployeeId ?? '-'}`;
};

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

const MODEL = fixedSource(['model']);

// ── 1. no day ────────────────────────────────────────────────────────────────────────────────────

describe('no day — the standing crew is a fact about a car', () => {
  it('keeps ONE draft under one key, with no date in it', () => {
    expect(FIXED_ROSTER_DRAFT_KEY).toBe('ecms.fleet.fixedRoster.draft');
    expect(FIXED_ROSTER_DRAFT_KEY).not.toMatch(/\d/u);
    expect(MODEL, 'the REAL draft hook, on that key').toContain(
      'useDraftBoard(FIXED_ROSTER_DRAFT_KEY, saved, ROSTER_EDITABLE_FIELDS)',
    );
    expect(MODEL, 'no dated key').not.toContain('rosterDraftKey');
    expect(MODEL).not.toMatch(/\bdate\b/iu);
    expect(MODEL).not.toContain('toISOString');
    for (const dayThing of ['useRosterDay', 'shiftDay', 'weekdayOf', 'slashDate', 'PastDayBanner'])
      expect(MODEL, dayThing).not.toContain(dayThing);
  });

  it('sends the four facts of each changed car and nothing else — no date travels', () => {
    withDraft(BOARD.rows.map((r) => (r.vehicleId === V4 ? { ...r, driver1EmployeeId: E4 } : r)));
    const m = model();
    expect(m.changed).toEqual([
      {
        vehicleId: V4,
        missionTypeId: null,
        driver1EmployeeId: E4,
        driver2EmployeeId: null,
        notes: null,
      },
    ]);
    expect(SaveFleetFixedRosterSchema.safeParse({ rows: m.changed }).success).toBe(true);
  });

  it('reaches the server through the board’s two functions and the mission catalog only', () => {
    const imports = /import \{([^}]*)\} from '\.\.\/api\/fleet-queries';/u.exec(MODEL)?.[1] ?? '';
    expect(
      imports
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '')
        .sort(),
    ).toEqual(['useFixedRoster', 'useFleetCatalog', 'useSaveFixedRoster']);
    expect(MODEL, 'the mission vocabulary').toContain("useFleetCatalog('missionType')");
    expect(MODEL, 'never the workshop’s').not.toContain('workType');
    expect(MODEL, 'no second api module').not.toMatch(/from '\.\.\/api\/fleet-api'/u);
  });
});

// ── 2. answer 1 (ب): no flag for a standing member ─────────────────────────────────────────────

describe('answer 1 (ب) — the model reads no availability, licence or reason', () => {
  it('has no such field in its code', () => {
    expect(MODEL).not.toMatch(/unavailable|reason/iu);
    expect(MODEL).not.toMatch(/\.licence\b|expiredLicence|licenceRule|\.licenceExpired/u);
    // The one mention: the shared list's field, always false here.
    const mentions = MODEL.match(/licence/giu)?.length ?? 0;
    expect(mentions).toBe(MODEL.match(/licenceExpired: false/gu)?.length ?? -1);
  });

  it('offers no flagged list and no licence flag on any driver', () => {
    const m = model();
    for (const target of [null, { vehicleId: V4, slot: 'driver1EmployeeId' as const }]) {
      const options = m.availableFor('', target);
      expect(options.flagged).toEqual([]);
      expect(options.elsewhere).toEqual([]);
      for (const option of [...options.free, ...options.seated])
        expect(option.licenceExpired).toBe(false);
    }
  });
});

// ── 3. undo ──────────────────────────────────────────────────────────────────────────────────────

describe('«تراجع» — the steps', () => {
  const base = BOARD.rows;
  it('an edit that changes no fact is no step', () => {
    expect(
      fixedEditStep(base, (rows) => assignDriver(rows, V1, 'driver1EmployeeId', E1)),
      'a drop on the seat already held',
    ).toBeNull();
    expect(
      fixedEditStep(base, (rows) => swapDrivers(rows, V3)),
      'a swap with one seat',
    ).toBeNull();
    expect(
      fixedEditStep(base, (rows) =>
        applyEdit(rows, V1, {
          missionTypeId: MT,
          driver1EmployeeId: E1,
          driver2EmployeeId: E2,
          notes: 'الوردية الصباحية',
        }),
      ),
      'a dialog saved as it was',
    ).toBeNull();
    const step = fixedEditStep(base, (rows) => assignDriver(rows, V4, 'driver1EmployeeId', E4));
    expect(crewOf(step, V4)).toBe(`${E4}/-`);
  });

  it('pushes newest last and pops it back', () => {
    const a = assignDriver(base, V4, 'driver1EmployeeId', E4);
    const b = assignDriver(a, V4, 'driver2EmployeeId', E6);
    let undo = pushFixedUndo(NO_FIXED_UNDO, base, [...base]);
    undo = pushFixedUndo(undo, base, a);
    expect(fixedUndoSteps(undo, base)).toHaveLength(2);
    const first = popFixedUndo(undo, base);
    expect(first.previous).toBe(a);
    const second = popFixedUndo(first.undo, base);
    expect(crewOf(second.previous ?? null, V4)).toBe('-/-');
    const none = popFixedUndo(second.undo, base);
    expect(none.previous).toBeUndefined();
    expect(none.undo).toBe(second.undo);
    expect(b).not.toBe(a);
  });

  it('keeps the newest fifty', () => {
    let undo = NO_FIXED_UNDO;
    const drafts = Array.from({ length: UNDO_LIMIT + 10 }, (_, i) =>
      base.map((r) => (r.vehicleId === V4 ? { ...r, notes: `ملاحظة ${String(i)}` } : r)),
    );
    for (const draft of drafts) undo = pushFixedUndo(undo, base, draft);
    expect(UNDO_LIMIT).toBe(50);
    const steps = fixedUndoSteps(undo, base);
    expect(steps).toHaveLength(50);
    expect(steps[0]).toBe(drafts[10]);
    expect(steps[49]).toBe(drafts[UNDO_LIMIT + 9]);
  });

  it('lapses once the server answers with another board — the steps were taken over the old one', () => {
    const undo = pushFixedUndo(NO_FIXED_UNDO, base, [...base]);
    const newBoard = [...base];
    expect(fixedUndoSteps(undo, newBoard)).toEqual([]);
    expect(popFixedUndo(undo, newBoard).previous).toBeUndefined();
    expect(pushFixedUndo(undo, newBoard, [...base]).steps, 'a new history').toHaveLength(1);
  });

  it('a reload restores the draft, and the steps start again', () => {
    withDraft(BOARD.rows.map((r) => (r.vehicleId === V4 ? { ...r, driver1EmployeeId: E4 } : r)));
    const m = model();
    expect(crewOf(m.draft, V4)).toBe(`${E4}/-`);
    expect(m.undoDepth).toBe(0);
    expect(m.dirty).toBe(true);
  });

  it('the pen dialog is ONE edit — one step', () => {
    const apply = MODEL.slice(MODEL.indexOf('apply: (vehicleId, values)'));
    const body = apply.slice(0, apply.indexOf('undo: ()'));
    expect(body.match(/\bedit\(/gu)?.length).toBe(1);
    expect(body).toContain('applyEdit(rows, vehicleId');
  });
});

// ── 4. the save bar's inputs ─────────────────────────────────────────────────────────────────────

describe('the unsaved bar reads exactly what «حفظ» sends', () => {
  it('an untouched board has nothing to save, nothing tinted, nothing to undo', () => {
    const m = model();
    expect(m.changed).toEqual([]);
    expect(m.dirty).toBe(false);
    expect(m.unsavedIds.size).toBe(0);
    expect(m.undoDepth).toBe(0);
    expect(stored.size, 'and nothing written').toBe(0);
  });

  it('a move changes both cars, tints both, and sends both', () => {
    withDraft(assignDriver(BOARD.rows, V4, 'driver1EmployeeId', E3));
    const m = model();
    expect([...m.unsavedIds].sort()).toEqual([V3, V4]);
    expect(m.changed.map((r) => r.vehicleId).sort()).toEqual([V3, V4]);
    expect(m.changed).toEqual(changedRows(m.saved, m.draft));
    expect(SaveFleetFixedRosterSchema.safeParse({ rows: m.changed }).success).toBe(true);
  });
});

// ── 5. the edits, through the hook ───────────────────────────────────────────────────────────────

describe('the edits land on the draft (and so survive a reload)', () => {
  it('assign: a free driver onto an empty seat', () => {
    model().actions.assign({ vehicleId: V4, slot: 'driver1EmployeeId' }, E4);
    expect(crewOf(storedDraft(), V4)).toBe(`${E4}/-`);
    expect(crewOf(model().draft, V4), 'the next render restores it').toBe(`${E4}/-`);
  });

  it('two edits in one tap fold over each other', () => {
    const m = model();
    m.actions.assign({ vehicleId: V4, slot: 'driver1EmployeeId' }, E4);
    m.actions.assign({ vehicleId: V4, slot: 'driver2EmployeeId' }, E6);
    expect(crewOf(storedDraft(), V4)).toBe(`${E4}/${E6}`);
  });

  it('a drop on the seat already held writes nothing', () => {
    model().actions.assign({ vehicleId: V1, slot: 'driver1EmployeeId' }, E1);
    expect(storedDraft()).toBeNull();
  });

  it('swap trades the two seats; one seat filled — nothing', () => {
    const m = model();
    m.actions.swap(V3);
    expect(storedDraft(), 'one seat: no step').toBeNull();
    m.actions.swap(V1);
    expect(crewOf(storedDraft(), V1)).toBe(`${E2}/${E1}`);
  });

  it('«إفراغ الطقم» empties both seats in one write and keeps the mission and the note', () => {
    model().actions.clearCrew(V1);
    const after = storedDraft()?.find((r) => r.vehicleId === V1);
    expect(crewOf(storedDraft(), V1)).toBe('-/-');
    expect(after?.missionTypeId).toBe(MT);
    expect(after?.notes).toBe('الوردية الصباحية');
  });

  it('one seat cleared: seat 1 promotes seat 2', () => {
    model().actions.clear(V1, 'driver1EmployeeId');
    expect(crewOf(storedDraft(), V1)).toBe(`${E2}/-`);
  });

  it('the workshop car stays editable — its mission and its seats', () => {
    const m = model();
    m.actions.mission(V2, MT);
    m.actions.assign({ vehicleId: V2, slot: 'driver1EmployeeId' }, E6);
    const workshop = storedDraft()?.find((r) => r.vehicleId === V2);
    expect(workshop?.missionTypeId).toBe(MT);
    expect(workshop?.driver1EmployeeId).toBe(E6);
    expect(workshop?.inMaintenance, 'still in the workshop').toBe(true);
  });

  it('the note alone: trimmed, and an empty one is nothing', () => {
    const m = model();
    m.actions.notes(V4, '  تحتاج مراجعة  ');
    expect(storedDraft()?.find((r) => r.vehicleId === V4)?.notes).toBe('تحتاج مراجعة');
    const again = model();
    again.actions.notes(V1, '   ');
    expect(storedDraft()?.find((r) => r.vehicleId === V1)?.notes).toBeNull();
  });

  it('the pen dialog: four facts, the move it implies, an empty note as null', () => {
    model().actions.apply(V4, {
      missionTypeId: MT,
      driver1EmployeeId: E3,
      driver2EmployeeId: E4,
      notes: ' ',
    });
    const draft = storedDraft();
    expect(crewOf(draft, V4)).toBe(`${E3}/${E4}`);
    expect(crewOf(draft, V3), 'E3’s old car releases him').toBe('-/-');
    expect(draft?.find((r) => r.vehicleId === V4)?.notes).toBeNull();
    expect(draft?.find((r) => r.vehicleId === V4)?.missionTypeId).toBe(MT);
  });

  it('«إلغاء» drops the draft, in storage too', () => {
    withDraft(assignDriver(BOARD.rows, V4, 'driver1EmployeeId', E4));
    model().actions.discard();
    expect(storedDraft()).toBeNull();
    expect(model().dirty).toBe(false);
  });

  it('«تراجع» with nothing to take back changes nothing', () => {
    withDraft(assignDriver(BOARD.rows, V4, 'driver1EmployeeId', E4));
    const before = stored.get(FIXED_ROSTER_DRAFT_KEY);
    model().actions.undo();
    expect(stored.get(FIXED_ROSTER_DRAFT_KEY)).toBe(before);
  });
});

describe('a reader who may not plan changes nothing', () => {
  it('every action is a no-op, «حفظ» posts nothing', async () => {
    withDraft(assignDriver(BOARD.rows, V4, 'driver1EmployeeId', E4));
    const before = stored.get(FIXED_ROSTER_DRAFT_KEY);
    const m = model({ mayPlan: false }, { permissions: VIEWER });
    expect(m.dirty, 'the restored draft is drawn').toBe(true);
    expect(m.undoDepth).toBe(0);
    m.actions.assign({ vehicleId: V4, slot: 'driver2EmployeeId' }, E6);
    m.actions.clear(V1, 'driver1EmployeeId');
    m.actions.swap(V1);
    m.actions.clearCrew(V1);
    m.actions.mission(V4, MT);
    m.actions.notes(V4, 'ملاحظة');
    m.actions.apply(V4, {
      missionTypeId: MT,
      driver1EmployeeId: E6,
      driver2EmployeeId: null,
      notes: null,
    });
    m.actions.undo();
    m.actions.discard();
    expect(stored.get(FIXED_ROSTER_DRAFT_KEY)).toBe(before);
    await expect(m.actions.save()).resolves.toBe(false);
    expect(saveFixedRoster).not.toHaveBeenCalled();
  });

  it('…but may still take the board as a file', () => {
    model({ mayPlan: false }, { permissions: VIEWER }).actions.exportSheet(BOARD.rows);
    expect(saveSheet).toHaveBeenCalledTimes(1);
  });
});

// ── 6. the move promised ─────────────────────────────────────────────────────────────────────────

describe('«سيُنقل من السيارة … عند الحفظ» — where the SERVER has him', () => {
  it('names the saved car he would leave, and nothing otherwise', () => {
    withDraft(assignDriver(BOARD.rows, V4, 'driver1EmployeeId', E3));
    const m = model();
    expect(m.transferFrom(E3, V4)).toBe('152');
    expect(m.transferFrom(E3, V3), 'his own saved car').toBeNull();
    expect(m.transferFrom(E4, V4), 'never seated').toBeNull();
    expect(m.transferFrom(E5, V4), 'held off this board — no car here to name').toBeNull();
  });
});

// ── 7. the counters, the filters ─────────────────────────────────────────────────────────────────

describe('the counters count the whole draft', () => {
  const missions = [{ id: MT, label: 'نقل نقدية' }];
  const value = (counters: ReturnType<typeof fixedCounters>, key: string): number | undefined =>
    counters.find((c) => c.key === key)?.value;

  it('«إجمالي» · «صيانة» · «بطقم» · «بلا طقم» · one per active mission', () => {
    const counters = fixedCounters(BOARD.rows, missions, { missions: [], view: null }, t);
    expect(counters.map((c) => c.key)).toEqual(['total', 'workshop', 'crewed', 'uncrewed', MT]);
    expect(value(counters, 'total')).toBe(4);
    expect(value(counters, 'workshop')).toBe(1);
    expect(value(counters, 'crewed')).toBe(2);
    expect(value(counters, 'uncrewed')).toBe(2);
    expect(value(counters, MT)).toBe(1);
    expect(counters.map((c) => c.label)).toEqual([
      t('fleet.roster.counter.total'),
      t('fleet.roster.counter.workshop'),
      t('fleet.fixedRoster.counter.crewed'),
      t('fleet.fixedRoster.counter.uncrewed'),
      'نقل نقدية',
    ]);
  });

  it('«بلا طقم» is the daily «بلا سائق» yellow — rose is the workshop’s alone', () => {
    const counters = fixedCounters(BOARD.rows, missions, { missions: [], view: null }, t);
    const tone = (key: string): string | undefined => counters.find((c) => c.key === key)?.tone;
    expect(tone('uncrewed')).toBe(COUNTER_TONES.unmanned);
    expect(tone('workshop')).toBe(COUNTER_TONES.workshop);
    expect(tone('crewed')).toBe(COUNTER_TONES.assigned);
    expect(tone('total')).toBe(COUNTER_TONES.total);
    expect(tone(MT)).toBe(missionTone(MT));
    expect(counters.filter((c) => c.tone === COUNTER_TONES.workshop)).toHaveLength(1);
  });

  it('applies and lights as the daily chips do; a mission chip toggles', () => {
    const plain = fixedCounters(BOARD.rows, missions, { missions: [], view: null }, t);
    const chip = (list: typeof plain, key: string) => list.find((c) => c.key === key);
    expect(chip(plain, 'total')?.active).toBe(true);
    expect(chip(plain, 'total')?.apply).toEqual({ mission: null, view: null });
    expect(chip(plain, 'workshop')?.apply).toEqual({ view: 'workshop' });
    expect(chip(plain, 'crewed')?.apply).toEqual({ view: 'crewed' });
    expect(chip(plain, 'uncrewed')?.apply).toEqual({ view: 'uncrewed' });
    expect(chip(plain, MT)?.apply).toEqual({ mission: MT });
    const narrowed = fixedCounters(BOARD.rows, missions, { missions: [MT], view: 'uncrewed' }, t);
    expect(chip(narrowed, 'total')?.active).toBe(false);
    expect(chip(narrowed, 'uncrewed')?.active).toBe(true);
    expect(chip(narrowed, MT)?.active).toBe(true);
    expect(chip(narrowed, MT)?.apply, 'a second tap lets it go').toEqual({ mission: null });
  });

  it('counts the draft, not the narrowed rows — through the hook', () => {
    const m = model({ view: 'crewed' });
    expect(m.visible.map((r) => r.code)).toEqual(['150', '152']);
    expect(m.counters.find((c) => c.key === 'total')?.value).toBe(4);
    expect(
      m.counters.map((c) => c.key),
      'an archived mission has no chip',
    ).not.toContain(MT_OLD);
    expect(m.missionOptions).toEqual([
      { id: MT, label: 'نقل نقدية', tone: missionTone(MT), count: 1 },
    ]);
  });
});

describe('what the board shows', () => {
  it('in CODE ORDER, whatever order the server sent', () => {
    const m = model();
    expect(m.visible.map((r) => r.code)).toEqual(['150', '151', '152', '153']);
    expect(m.codeOptions.map((o) => o.value)).toEqual(['150', '151', '152', '153']);
    expect(m.filtered).toBe(false);
  });

  it('narrows by the picked codes AND the missions AND the view', () => {
    expect(model({ search: '150,153' }).visible.map((r) => r.code)).toEqual(['150', '153']);
    expect(model({ search: '150,153' }).codes).toEqual(['150', '153']);
    expect(model({ missions: [MT] }).visible.map((r) => r.code)).toEqual(['150']);
    expect(model({ view: 'workshop' }).visible.map((r) => r.code)).toEqual(['151']);
    expect(model({ view: 'uncrewed' }).visible.map((r) => r.code)).toEqual(['151', '153']);
    expect(model({ search: '150,153', view: 'uncrewed' }).visible.map((r) => r.code)).toEqual([
      '153',
    ]);
    expect(model({ search: '15', view: null }).visible, 'a picked code is a WHOLE code').toEqual(
      [],
    );
    expect(model({ view: 'workshop' }).filtered).toBe(true);
  });

  it('lifts only the filters that hide an edited car', () => {
    const car = BOARD.rows.find((r) => r.vehicleId === V4) as FleetFixedCrewRowDto;
    expect(fixedFiltersHiding(car, { search: '', missions: [], view: null })).toEqual({});
    expect(fixedFiltersHiding(car, { search: '150', missions: [], view: null })).toEqual({
      q: null,
    });
    expect(fixedFiltersHiding(car, { search: '153', missions: [MT], view: 'crewed' })).toEqual({
      mission: null,
      view: null,
    });
    expect(fixedFiltersHiding(car, { search: '', missions: [], view: 'uncrewed' })).toEqual({});
  });

  it('the touch cards: a typed part of a code, in code order, the workshop car in its place', () => {
    const m = model();
    const all = fixedTouchCars(m.visible, m.draft, '');
    expect(all.searching).toBe(false);
    expect(
      all.drawn.map((r) => r.code),
      'no workshop group',
    ).toEqual(['150', '151', '152', '153']);
    expect(all.termFinds).toBe(true);
    const typed = fixedTouchCars(m.visible, m.draft, '52');
    expect(typed.searching).toBe(true);
    expect(typed.drawn.map((r) => r.code)).toEqual(['152']);
    const none = fixedTouchCars(m.visible, m.draft, '999');
    expect(none.drawn).toEqual([]);
    expect(none.termFinds).toBe(false);
    const narrowed = fixedTouchCars(model({ view: 'workshop' }).visible, m.draft, '150');
    expect(narrowed.drawn, 'ANDed with the view').toEqual([]);
    expect(narrowed.termFinds, 'though the term finds a car').toBe(true);
  });
});

// ── 8. the seat and the card ─────────────────────────────────────────────────────────────────────

describe('a standing row as the daily pieces read it', () => {
  const workshop = BOARD.rows.find((r) => r.vehicleId === V2) as FleetFixedCrewRowDto;
  it('the seat is told the car is on the road — no workshop lock on a standing crew', () => {
    expect(toSeatRow(workshop)).toMatchObject({ inMaintenance: false, planned: true, code: '151' });
  });
  it('the card keeps the real row (its badge and tint read it)', () => {
    expect(toCardRow(workshop)).toMatchObject({ inMaintenance: true, planned: true, code: '151' });
  });
  it('tolerates a row with no workshop field at all', () => {
    const bare = { ...workshop } as Partial<FleetFixedCrewRowDto>;
    delete bare.inMaintenance;
    expect(toSeatRow(bare as FleetFixedCrewRowDto).inMaintenance).toBe(false);
  });
});

// ── 9. the drivers ───────────────────────────────────────────────────────────────────────────────

describe('the drivers', () => {
  it('the pool is the FREE drivers: seated nowhere, held on no car off this board', () => {
    const m = model();
    expect(m.pool.map((d) => d.employeeId)).toEqual([E4, E6]);
    expect(m.heldOff.map((d) => d.employeeId)).toEqual([E5]);
  });

  it('follows the draft at once — a cleared seat puts its driver back', () => {
    withDraft(BOARD.rows.map((r) => (r.vehicleId === V3 ? { ...r, driver1EmployeeId: null } : r)));
    expect(model().pool.map((d) => d.employeeId)).toEqual([E3, E4, E6]);
  });

  it('lists with no seat to fill: the free, then the held-off as «سيارة أخرى» (no code)', () => {
    const options = model().availableFor('', null);
    expect(options.free.map((o) => [o.employeeId, o.state])).toEqual([
      [E4, 'free'],
      [E6, 'free'],
    ]);
    expect(options.seated).toEqual([
      { employeeId: E5, state: 'seated', seatedCode: null, onTarget: false, licenceExpired: false },
    ]);
  });

  it('lists with a seat to fill: drivers on OTHER cars with that car’s code, not the target’s own crew', () => {
    const forEmpty = model().availableFor('', { vehicleId: V4, slot: 'driver1EmployeeId' });
    expect(forEmpty.seated.map((o) => [o.employeeId, o.seatedCode])).toEqual([
      [E1, '150'],
      [E2, '150'],
      [E3, '152'],
    ]);
    const forOwn = model().availableFor('', { vehicleId: V1, slot: 'driver2EmployeeId' });
    expect(forOwn.seated.map((o) => o.employeeId)).toEqual([E3]);
  });

  it('never offers a seat the driver held on a car off this board — the daily rule (review F1)', () => {
    // No edit here can release him (his car is not a row this board can send), so a seat that
    // took him could only be refused at «حفظ»: he is listed where no seat is being filled, and
    // nowhere a pick is made — the touch picker, the landscape target, the pen dialog.
    const m = model();
    const target = { vehicleId: V4, slot: 'driver1EmployeeId' } as const;
    const offered = m.availableFor('', target);
    const ids = [...offered.free, ...offered.seated, ...offered.elsewhere].map((o) => o.employeeId);
    expect(ids).not.toContain(E5);
    expect(m.availableFor('11005', target).seated, 'not by a search either').toEqual([]);
    expect(
      m.availableFor('', null).seated.map((o) => o.employeeId),
      'still listed',
    ).toEqual([E5]);
    for (const vehicleId of [V1, V2, V3, V4]) {
      expect(m.dialogCandidates(vehicleId), vehicleId).not.toContain(E5);
    }
  });

  it('searches by name or code', () => {
    const m = model();
    expect(m.availableFor('كريم', null).free.map((o) => o.employeeId)).toEqual([E4]);
    expect(m.availableFor('11005', null).seated.map((o) => o.employeeId)).toEqual([E5]);
    expect(m.availableFor('لا أحد', null).free).toEqual([]);
  });

  it('a held-off driver the draft has seated is listed where the draft has him', () => {
    withDraft(assignDriver(BOARD.rows, V4, 'driver1EmployeeId', E5));
    const m = model();
    expect(m.availableFor('', null).seated, 'not listed twice').toEqual([]);
    expect(
      m
        .availableFor('', { vehicleId: V3, slot: 'driver2EmployeeId' })
        .seated.map((o) => [o.employeeId, o.seatedCode]),
    ).toContainEqual([E5, '153']);
  });

  it('the pen dialog offers the free drivers, then the car’s own crew', () => {
    const m = model();
    expect(m.dialogCandidates(V1)).toEqual([E4, E6, E1, E2]);
    expect(m.dialogCandidates(V4)).toEqual([E4, E6]);
  });

  it('names every driver from the one people list, the id’s tail where it has none', () => {
    const m = model();
    expect(m.person(E1)?.fullNameAr).toBe('أحمد محمد');
    expect(m.driverName(E1)).toBe('أحمد محمد');
    expect(m.driverName(null)).toBe('');
    expect(m.driverName('650000000000000000000099')).toBe('00000099');
    expect(m.searchIndex.get(E5)?.code).toBe('11005');
    expect(m.codeOf(V1)).toBe('150');
    expect(m.codeOf(V_OFF)).toBe('');
  });
});

// ── 10. the mission names ────────────────────────────────────────────────────────────────────────

describe('the mission vocabulary', () => {
  it('names by the catalog, and a dash for none or for an id it does not name', () => {
    const m = model();
    expect(m.missionName(MT)).toBe('نقل نقدية');
    expect(m.missionName(null)).toBe('—');
    expect(m.missionName('650000000000000000000029')).toBe('—');
    expect(m.missionCatalog).toEqual({ loading: false, failed: false, empty: false });
  });

  it('says when the catalog is empty', () => {
    const qc = client();
    qc.setQueryData(['fleet', 'catalogs', 'list', { kind: 'missionType' }], {
      items: [],
      meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    });
    expect(model({}, { qc }).missionCatalog).toEqual({
      loading: false,
      failed: false,
      empty: true,
    });
  });
});

// ── 11. Excel ────────────────────────────────────────────────────────────────────────────────────

describe('the file — the rows on screen, eight columns', () => {
  it('writes today’s columns and values, in the order given', () => {
    const m = model();
    m.actions.exportSheet(m.visible);
    expect(saveSheet).toHaveBeenCalledTimes(1);
    const [sheet, day] = saveSheet.mock.calls[0] as [
      { name: string; serialHeader: string; header: string[]; rows: string[][] },
      unknown,
    ];
    expect(day, 'named after today, as it always was').toBeUndefined();
    expect(sheet.name).toBe(t('fleet.nav.fixedRoster'));
    expect(sheet.serialHeader).toBe(t('fleet.violations.report.serial'));
    expect(sheet.header).toEqual([
      t('fleet.odometer.columns.vehicle'),
      t('fleet.vehicles.inWorkshop'),
      t('fleet.vehicles.columns.status'),
      t('fleet.roster.fields.mission'),
      t('fleet.odometer.fields.driver1'),
      t('fleet.odometer.fields.driver2'),
      t('fleet.attendance.fields.notes'),
    ]);
    expect(sheet.rows.map((r) => r[0])).toEqual(['150', '151', '152', '153']);
    expect(sheet.rows[0]).toEqual([
      '150',
      t('common.no'),
      t('fleet.roster.assigned'),
      'نقل نقدية',
      'أحمد محمد',
      'محمد محمود',
      'الوردية الصباحية',
    ]);
    expect(sheet.rows[1]).toEqual([
      '151',
      t('common.yes'),
      t('fleet.fixedRoster.unassigned'),
      '',
      '',
      '',
      '',
    ]);
  });

  it('writes the DRAFT — an unsaved edit is in the file', () => {
    withDraft(assignDriver(BOARD.rows, V4, 'driver1EmployeeId', E4));
    const m = model();
    m.actions.exportSheet(m.visible);
    const [sheet] = saveSheet.mock.calls[0] as [{ rows: string[][] }];
    expect(sheet.rows[3]?.[4]).toBe('كريم علي');
  });
});

// ── 12. «حفظ» ────────────────────────────────────────────────────────────────────────────────────

describe('«حفظ»', () => {
  const edited = assignDriver(BOARD.rows, V4, 'driver1EmployeeId', E4);

  it('sends the changed cars, drops the draft and says so', async () => {
    withDraft(edited);
    saveFixedRoster.mockResolvedValue({ rows: edited, drivers: BOARD.drivers, changedCount: 1 });
    const m = model();
    await expect(m.actions.save()).resolves.toBe(true);
    expect(saveFixedRoster).toHaveBeenCalledWith({ rows: m.changed });
    expect(storedDraft(), 'no longer a draft').toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith(t('fleet.fixedRoster.saved'));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a refusal keeps the draft and says why in Arabic — the driver and the holding car', async () => {
    withDraft(edited);
    saveFixedRoster.mockRejectedValue(
      new ApiError(
        'DUPLICATE',
        `driver ${E4} already belongs to the fixed crew of vehicle 214`,
        409,
        [
          { field: 'driverEmployeeId', code: 'FIXED_CREW_DRIVER_HELD', message: E4 },
          { field: 'vehicleCode', code: 'FIXED_CREW_HOLDER', message: '214' },
        ],
      ),
    );
    const before = stored.get(FIXED_ROSTER_DRAFT_KEY);
    const m = model();
    await expect(m.actions.save()).resolves.toBe(false);
    expect(stored.get(FIXED_ROSTER_DRAFT_KEY), 'the draft stays').toBe(before);
    // The title is the toast's one uncut line; the reason is its description, which wraps whole
    // (review L1: the holding car's code was cut off the end of a one-line title).
    expect(toastError).toHaveBeenCalledWith(
      t('fleet.fixedRoster.refusal.title'),
      t('fleet.fixedRoster.refusal.held', { name: 'كريم علي', code: '214' }),
    );
    for (const said of toastError.mock.calls[0] as string[]) {
      expect(said).not.toContain(E4);
      expect(said).not.toContain('already belongs');
    }
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('posts nothing when nothing is changed', async () => {
    await expect(model().actions.save()).resolves.toBe(false);
    expect(saveFixedRoster).not.toHaveBeenCalled();
  });

  it('keeps the undo steps on a refusal — only a stored save or «إلغاء» forgets them', () => {
    const commit = MODEL.slice(MODEL.indexOf('const commit = async'));
    const refused = commit.slice(
      commit.indexOf('} catch (error) {'),
      commit.indexOf('return false;\n    }'),
    );
    expect(refused).toContain('fixedSaveRefusal(');
    expect(refused).not.toContain('forgetSteps');
    expect(refused).not.toContain('discard');
    const success = commit.slice(0, commit.indexOf('} catch (error) {'));
    expect(success).toContain('acceptDraft();');
    expect(success).toContain('forgetSteps();');
  });
});

// ── 13. the shell ────────────────────────────────────────────────────────────────────────────────

describe('the shell (answer 2 ج)', () => {
  const SHELL = fixedSource(['shell']);
  it('draws the page header at every width, with no actions, and no Excel of its own', () => {
    expect(SHELL).toContain('<PageContainer fullHeight>');
    expect(SHELL).toContain("title={t('fleet.nav.fixedRoster')}");
    expect(SHELL).toContain("{ label: t('fleet.module.title'), to: '/fleet' }");
    expect(SHELL).not.toContain('actions=');
    expect(SHELL).not.toContain('ExportSheetButton');
    expect(SHELL.indexOf('<PageHeader'), 'above both boards').toBeLessThan(
      SHELL.indexOf("layout === 'desktop'"),
    );
  });

  it('keeps the URL keys, the remembered set and the default order', () => {
    expect(SHELL).toContain(
      "const REMEMBERED_FILTERS = ['mission', 'q', 'sort', 'view'] as const;",
    );
    expect(SHELL).toContain("const DEFAULT_SORT = 'code:asc';");
    expect(SHELL).toContain("const sortParam = sp.get('sort');");
    expect(SHELL).toContain('patch({ q: null, mission: null, view: null })');
    expect(SHELL).toContain("const mayPlan = can('fleetRoster.plan');");
    expect(SHELL).not.toMatch(/\bdate\b/iu);
  });
});
