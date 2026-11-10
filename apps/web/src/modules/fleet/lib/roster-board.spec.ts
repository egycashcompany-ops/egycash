// The «تعيين السيارات» board model — the one state both layouts draw (the computer's table and the
// phone / tablet cards).
//
// Two halves. The PURE pieces (the touch re-flagging of edited rows, the undo stacks, the day
// arithmetic, the new words) are asserted directly. The HOOK is rendered once per case with
// `renderToStaticMarkup` over seeded query caches — the web suite has no DOM, and that is the
// point: the draft is derived during render, so a single server render shows the model whole.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FLEET_DRIVER_UNAVAILABLE_REASONS,
  type FleetRosterDayDto,
  type FleetRosterRowDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { offendersIn } from '../../../../../../scripts/check-formal-arabic.mjs';
import { isUnmanned, missionTone } from './roster-view';
import { rosterDraftKey } from './draft-storage';
import {
  KNOWN_REASONS,
  SLOT_WORD,
  UNDO_LIMIT,
  popUndo,
  pushUndo,
  reflagEdited,
  shiftDay,
  useRosterBoard,
  type RosterBoardModel,
  type RosterQuery,
  type UndoStacks,
} from './roster-board';

const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const V3 = '650000000000000000000003';
const V4 = '650000000000000000000004';
const V5 = '650000000000000000000005';
const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';
const E3 = '650000000000000000000013';
const E4 = '650000000000000000000014';
const E5 = '650000000000000000000015';
const E6 = '650000000000000000000016';
const MT = '650000000000000000000021';

/** A day `delta` days from today, on the UTC calendar the plannable floor uses. */
const day = (delta: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const DAY = day(1);

const row = (
  vehicleId: string,
  code: string,
  over: Partial<FleetRosterRowDto> = {},
): FleetRosterRowDto => ({
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

/**
 *   150  on a mission, E1 driving — ready, manned, an operation still only projected
 *   151  in the workshop
 *   152  nobody on it, its fixed driver E2 on leave — unmanned, a crew gap
 *   153  nobody on it — unmanned
 *   154  E5 driving, the car's own licence expired — not ready
 * Available: E1 (seated), E3 (free), E4 (free, licence expired), E5 (seated, licence expired).
 * Unavailable: E2 (leave), E6 (operational).
 */
const BOARD: FleetRosterDayDto = {
  date: `${DAY}T00:00:00.000Z`,
  rows: [
    row(V1, '150', { missionTypeId: MT, driver1EmployeeId: E1, assignable: true, manned: true }),
    row(V2, '151', { inMaintenance: true, assignable: false, manned: false }),
    row(V3, '152', {
      assignable: true,
      manned: false,
      crewGaps: [{ seat: 1, employeeId: E2, reason: 'hrLeave' }],
    }),
    row(V4, '153', { assignable: true, manned: false }),
    row(V5, '154', {
      driver1EmployeeId: E5,
      assignable: false,
      manned: true,
      licenceExpired: true,
      planned: true,
    }),
  ],
  availableDrivers: [
    { employeeId: E1, assignedVehicleId: V1, licence: 'valid' },
    { employeeId: E3, assignedVehicleId: null, licence: 'valid' },
    { employeeId: E4, assignedVehicleId: null, licence: 'expired' },
    { employeeId: E5, assignedVehicleId: V5, licence: 'expired' },
  ],
  unavailableDrivers: [
    { employeeId: E2, reason: 'hrLeave' },
    { employeeId: E6, reason: 'fleetUnavailability' },
  ],
  licenceRule: 'flag',
};

const PEOPLE: readonly (readonly [string, string, string])[] = [
  [E1, 'أحمد محمد', '11001'],
  [E2, 'محمد محمود', '11002'],
  [E3, 'سعيد سعد', '11003'],
  [E4, 'كريم علي', '11004'],
  [E5, 'عمرو حسن', '11005'],
  [E6, 'ياسر فتحي', '11006'],
];

const client = (board: FleetRosterDayDto, cachedFor: string): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['fleet', 'roster', 'day', cachedFor], board);
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

const query = (over: Partial<RosterQuery> = {}): RosterQuery => ({
  date: DAY,
  today: day(0),
  editable: true,
  mayPlan: true,
  search: '',
  missions: [],
  view: null,
  reasons: [],
  patch: () => undefined,
  ...over,
});

let captured: RosterBoardModel | undefined;

const Probe = ({ q, liveFlags }: { q: RosterQuery; liveFlags: boolean }): null => {
  captured = useRosterBoard(q, { liveFlags });
  return null;
};

/** The model as one render of the hook sees it. */
const model = (
  over: Partial<RosterQuery> = {},
  {
    liveFlags = false,
    permissions = PLANNER,
    board = BOARD,
    cachedFor = DAY,
  }: {
    liveFlags?: boolean;
    permissions?: readonly string[];
    board?: FleetRosterDayDto;
    cachedFor?: string;
  } = {},
): RosterBoardModel => {
  captured = undefined;
  renderToStaticMarkup(
    createElement(Provider, {
      store: store(permissions),
      children: createElement(QueryClientProvider, {
        client: client(board, cachedFor),
        children: createElement(Probe, { q: query(over), liveFlags }),
      }),
    }),
  );
  if (captured === undefined) throw new Error('the probe did not render');
  return captured;
};

/** A tab with a stored draft for `date`: what a reload finds in sessionStorage. */
const withDraft = (date: string, rows: readonly FleetRosterRowDto[]): void => {
  const stored = new Map([[rosterDraftKey(date), JSON.stringify(rows)]]);
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
  });
};

/** The day with 152 and 153 manned in the draft — E3 on 152, E4 (licence flagged) on 153. */
const EDITED = BOARD.rows.map((r) =>
  r.vehicleId === V3
    ? { ...r, driver1EmployeeId: E3 }
    : r.vehicleId === V4
      ? { ...r, driver1EmployeeId: E4 }
      : r,
);

const counter = (m: RosterBoardModel, key: string): number => {
  const found = m.counters.find((c) => c.key === key);
  if (found === undefined) throw new Error(`no counter ${key}`);
  return found.value;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

// ── 1. the pure pieces ───────────────────────────────────────────────────────────────────────────

describe('reflagEdited — the touch rule: edited rows follow the draft', () => {
  const available = new Set([E1, E3, E4, E5]);
  const unavailable = new Set([E2, E6]);

  it('re-derives manned, the crew gap and the stale plan for an EDITED row', () => {
    const edited = {
      ...row(V3, '152', {
        manned: false,
        crewGaps: [{ seat: 1 as const, employeeId: E2, reason: 'hrLeave' }],
        stalePlan: true,
      }),
      driver1EmployeeId: E3,
    };
    const [after] = reflagEdited([edited], new Set([V3]), available, unavailable);
    expect(after?.manned, 'an available driver mans it').toBe(true);
    expect(after?.crewGaps, 'the gap closes once its seat holds an available driver').toEqual([]);
    expect(after?.stalePlan, 'no seat names an unavailable driver any more').toBe(false);
  });

  it('keeps a gap whose seat is still empty, and a stale plan whose seat still names one out', () => {
    const edited = row(V3, '152', {
      driver1EmployeeId: E2,
      manned: true,
      crewGaps: [{ seat: 2, employeeId: E6, reason: 'fleetUnavailability' }],
      stalePlan: true,
    });
    const [after] = reflagEdited([edited], new Set([V3]), available, unavailable);
    expect(after?.manned, 'an unavailable driver mans nothing').toBe(false);
    expect(after?.crewGaps).toEqual([{ seat: 2, employeeId: E6, reason: 'fleetUnavailability' }]);
    expect(after?.stalePlan).toBe(true);
  });

  it('leaves every row the reader did not edit exactly as the server sent it', () => {
    const untouched = row(V4, '153', { manned: false, stalePlan: true });
    const [after] = reflagEdited([untouched], new Set([V3]), available, unavailable);
    expect(after, 'the same object, the server’s flags').toBe(untouched);
  });

  it('moves «بلا سائق» with the picks — three cars unmanned, two of them filled, one left', () => {
    const before = [
      row(V3, '152', { assignable: true, manned: false }),
      row(V4, '153', { assignable: true, manned: false }),
      row(V5, '154', { assignable: true, manned: false }),
    ];
    expect(before.filter(isUnmanned)).toHaveLength(3);
    const draft = before.map((r) =>
      r.vehicleId === V5 ? r : { ...r, driver1EmployeeId: r.vehicleId === V3 ? E3 : E4 },
    );
    const after = reflagEdited(draft, new Set([V3, V4]), available, unavailable);
    expect(after.filter(isUnmanned).map((r) => r.code)).toEqual(['154']);
  });
});

describe('the undo stacks — one per day, newest last', () => {
  const snapshot = (code: string): FleetRosterRowDto[] => [row(V1, code)];

  it('takes back the LAST edit only — last in, first out', () => {
    let stacks: UndoStacks = {};
    stacks = pushUndo(stacks, DAY, snapshot('a'));
    stacks = pushUndo(stacks, DAY, snapshot('b'));
    const first = popUndo(stacks, DAY);
    expect(first.previous?.[0]?.code).toBe('b');
    const second = popUndo(first.stacks, DAY);
    expect(second.previous?.[0]?.code).toBe('a');
    const none = popUndo(second.stacks, DAY);
    expect(none.previous, 'nothing left to undo').toBeUndefined();
    expect(none.stacks, 'and nothing changes').toBe(second.stacks);
  });

  it(`keeps at most ${String(UNDO_LIMIT)} steps, dropping the oldest`, () => {
    let stacks: UndoStacks = {};
    for (let i = 0; i < UNDO_LIMIT + 10; i += 1) stacks = pushUndo(stacks, DAY, snapshot(`${i}`));
    expect(stacks[DAY]).toHaveLength(UNDO_LIMIT);
    expect(stacks[DAY]?.[0]?.[0]?.code, 'the ten oldest are gone').toBe('10');
    expect(popUndo(stacks, DAY).previous?.[0]?.code).toBe(String(UNDO_LIMIT + 9));
  });

  it('keeps each day’s history to itself', () => {
    let stacks: UndoStacks = {};
    stacks = pushUndo(stacks, DAY, snapshot('today'));
    stacks = pushUndo(stacks, day(2), snapshot('later'));
    const popped = popUndo(stacks, DAY);
    expect(popped.previous?.[0]?.code).toBe('today');
    expect(popped.stacks[day(2)], 'the other day is untouched').toEqual([snapshot('later')]);
    expect(stacks[DAY], 'and nothing is mutated in place').toHaveLength(1);
  });
});

describe('the day arithmetic and the fixed vocabularies', () => {
  it('steps the calendar across a month, a year and a leap day', () => {
    expect(shiftDay('2026-11-09', 1)).toBe('2026-11-10');
    expect(shiftDay('2026-11-09', -9)).toBe('2026-10-31');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('knows exactly the seam’s six reasons — anything newer shows as sent', () => {
    expect([...KNOWN_REASONS].sort()).toEqual([...FLEET_DRIVER_UNAVAILABLE_REASONS].sort());
    for (const reason of KNOWN_REASONS) {
      expect(t(`fleet.roster.reason.${reason}`)).not.toBe(`fleet.roster.reason.${reason}`);
    }
  });

  it('names both seats with words the dictionary has', () => {
    expect(t(SLOT_WORD.driver1EmployeeId)).toBe(t('fleet.odometer.fields.driver1'));
    expect(t(SLOT_WORD.driver2EmployeeId)).toBe(t('fleet.odometer.fields.driver2'));
    expect(t(SLOT_WORD.driver1EmployeeId)).not.toBe(SLOT_WORD.driver1EmployeeId);
  });
});

describe('the new words — in both languages, formal Arabic, the same placeholders', () => {
  const KEYS = {
    filters: [],
    targetNow: ['code', 'slot'],
    driverNow: ['name'],
    poolHint: [],
    pickSlotHint: [],
    onOtherVehicles: [],
    showResults: ['count'],
    editedCars: [],
    undo: [],
    discardAll: [],
    discardBody: [],
  } as const;
  const placeholders = (text: string): string[] =>
    [...text.matchAll(/\{\{(\w+)\}\}/gu)].map((m) => m[1] as string).sort();

  it.each(Object.entries(KEYS))('fleet.roster.%s', (name, expected) => {
    const key = `fleet.roster.${name}`;
    const ar = translate('ar', key);
    const en = translate('en', key);
    expect(ar, 'Arabic exists').not.toBe(key);
    expect(en, 'English exists').not.toBe(key);
    expect(ar, 'and is Arabic').toMatch(/[؀-ۿ]/u);
    expect(offendersIn(ar), 'formal Arabic').toEqual([]);
    expect(placeholders(ar)).toEqual([...expected].sort());
    expect(placeholders(en)).toEqual([...expected].sort());
  });

  it('fills the assigning line with the car and the seat', () => {
    expect(t('fleet.roster.targetNow', { code: '150', slot: t(SLOT_WORD.driver1EmployeeId) })).toBe(
      `يُعيَّن الآن: السيارة 150 · ${t('fleet.odometer.fields.driver1')}`,
    );
  });
});

// ── 2. the hook ──────────────────────────────────────────────────────────────────────────────────

describe('useRosterBoard — this day’s board, and only this day’s', () => {
  it('reads the day it was asked for', () => {
    const m = model();
    expect(m.board?.date).toBe(BOARD.date);
    expect(m.shown.map((r) => r.code)).toEqual(['150', '151', '152', '153', '154']);
    expect(m.status.loading).toBe(false);
    expect(m.status.error).toBeUndefined();
  });

  it('ignores an answer that describes ANOTHER day — loading, and nothing of that crew', () => {
    const m = model({}, { board: { ...BOARD, date: `${day(5)}T00:00:00.000Z` } });
    expect(m.board).toBeUndefined();
    expect(m.status.loading, 'still waiting for this day').toBe(true);
    expect(m.shown).toEqual([]);
    expect(m.pool).toEqual([]);
    expect(m.pending, 'and nothing to save').toEqual([]);
  });
});

describe('useRosterBoard — the counters count the whole day', () => {
  it('counts every state chip and one chip per active mission', () => {
    const m = model();
    expect(m.counters.map((c) => [c.key, c.value])).toEqual([
      ['total', 5],
      ['workshop', 1],
      ['assigned', 2],
      ['ready', 3],
      ['unmanned', 2],
      ['crewGap', 1],
      [MT, 1],
    ]);
    expect(m.counters[6]?.label).toBe('نقل أموال (يومي)');
    expect(m.counters[6]?.tone).toBe(missionTone(MT));
  });

  it('applies through the URL keys — «إجمالي» clears, a mission chip toggles', () => {
    const plain = model();
    expect(plain.counters[0]?.apply).toEqual({ mission: null, view: null });
    expect(plain.counters[0]?.active).toBe(true);
    expect(plain.counters.find((c) => c.key === 'unmanned')?.apply).toEqual({ view: 'unmanned' });
    expect(plain.counters[6]?.apply).toEqual({ mission: MT });
    const narrowed = model({ missions: [MT], view: 'unmanned' });
    expect(narrowed.counters[0]?.active).toBe(false);
    expect(narrowed.counters.find((c) => c.key === 'unmanned')?.active).toBe(true);
    expect(narrowed.counters[6]?.active).toBe(true);
    expect(narrowed.counters[6]?.apply, 'pressed again, it comes off').toEqual({ mission: null });
  });

  it('narrows `visible` and nothing else — the counters still count the day', () => {
    const m = model({ search: '150, 152,', view: null });
    expect(m.codes).toEqual(['150', '152']);
    expect(m.visible.map((r) => r.code)).toEqual(['150', '152']);
    expect(m.filtered).toBe(true);
    expect(counter(m, 'total')).toBe(5);
    expect(m.codeOptions.map((o) => o.value)).toEqual(['150', '151', '152', '153', '154']);
    expect(m.missionOptions).toEqual([
      { id: MT, label: 'نقل أموال (يومي)', tone: missionTone(MT), count: 1 },
    ]);
  });
});

describe('useRosterBoard — the draft', () => {
  it('is saveable on an untouched day that still carries a projected operation', () => {
    const m = model();
    expect(m.dirty, '150 is only projected — saving makes it real').toBe(true);
    expect(m.pending.map((r) => r.vehicleId)).toEqual([V1]);
    expect(m.edited, 'but the reader edited nothing').toBe(false);
    expect(m.changed).toEqual([]);
    expect(m.unsavedIds.size).toBe(0);
    expect(m.undoDepth).toBe(0);
  });

  it('restores a stored draft, and tints only what the reader changed', () => {
    withDraft(DAY, EDITED);
    const m = model();
    expect([...m.unsavedIds].sort()).toEqual([V3, V4]);
    expect(m.edited).toBe(true);
    expect(m.shown.find((r) => r.vehicleId === V3)?.driver1EmployeeId).toBe(E3);
    expect(
      m.pool.map((d) => d.employeeId),
      'the seated leave the pool',
    ).toEqual([]);
  });

  it('keeps the server’s flags on a computer until «حفظ», and follows the draft on touch', () => {
    withDraft(DAY, EDITED);
    const desk = model({}, { liveFlags: false });
    expect(counter(desk, 'unmanned'), 'the computer: the server’s last answer').toBe(2);
    expect(counter(desk, 'crewGap')).toBe(1);
    const touch = model({}, { liveFlags: true });
    expect(counter(touch, 'unmanned'), 'touch: both picks count at once').toBe(0);
    expect(counter(touch, 'crewGap'), '152’s gap is covered').toBe(0);
  });

  it('shows a past day as the server has it, never a draft that outlived midnight', () => {
    const past = day(-3);
    withDraft(past, EDITED);
    const m = model(
      { date: past, editable: false, mayPlan: false },
      { board: { ...BOARD, date: `${past}T00:00:00.000Z` }, cachedFor: past },
    );
    expect(m.shown.find((r) => r.vehicleId === V3)?.driver1EmployeeId).toBeNull();
    expect(m.transferFrom(E1, V3), 'a past day promises no move').toBeNull();
  });

  it('never posts for a reader who may not plan, nor when nothing is pending', async () => {
    const viewer = model({ mayPlan: false }, { permissions: ['fleetRoster.view'] });
    expect(viewer.dirty).toBe(true);
    await expect(viewer.actions.save()).resolves.toBe(false);
    const stored = model(
      {},
      { board: { ...BOARD, rows: BOARD.rows.map((r) => ({ ...r, planned: true })) } },
    );
    expect(stored.dirty).toBe(false);
    await expect(stored.actions.save()).resolves.toBe(false);
  });
});

describe('useRosterBoard — the drivers', () => {
  it('splits the pool by the licence flag, and lists every flagged driver of the day', () => {
    const m = model();
    expect(m.pool.map((d) => d.employeeId)).toEqual([E3, E4]);
    expect(m.poolLicensed.map((d) => d.employeeId)).toEqual([E3]);
    expect(m.flagged.map((d) => d.employeeId)).toEqual([E4, E5]);
    expect(m.expiredVehicles.map((r) => r.code)).toEqual(['154']);
    expect(m.seatedOn.get(E5)).toBe('154');
    expect(m.dayHasDrivers).toBe(true);
  });

  it('offers the licence block with each check behind its own screen’s guard', () => {
    expect(model().licence).toEqual({
      count: 2,
      links: { drivers: `/fleet/drivers?licExpBefore=${DAY}`, vehicles: null, vehiclesCount: 1 },
    });
    const both = model({}, { permissions: [...PLANNER, 'fleetVehicle.view'] });
    expect(both.licence?.links.vehicles).toBe(`/fleet/vehicles?status=active&licExpBefore=${DAY}`);
    expect(model({}, { board: { ...BOARD, licenceRule: 'refuse' } }).licence).toBeNull();
  });

  it('lists a pick: free, flagged, and — for a seat — the drivers on OTHER cars', () => {
    const m = model();
    const idle = m.availableFor('', null);
    expect(idle.free.map((o) => o.employeeId)).toEqual([E3]);
    expect(idle.flagged.map((o) => [o.employeeId, o.state, o.seatedCode])).toEqual([
      [E4, 'free', null],
      [E5, 'seated', '154'],
    ]);
    expect(idle.seated, 'no seat, no move offered').toEqual([]);
    const forSeat = m.availableFor('', { vehicleId: V3, slot: 'driver1EmployeeId' });
    expect(forSeat.seated.map((o) => [o.employeeId, o.seatedCode, o.onTarget])).toEqual([
      [E1, '150', false],
    ]);
    const ownCar = m.availableFor('', { vehicleId: V1, slot: 'driver2EmployeeId' });
    expect(ownCar.seated, 'the car’s own crew is the swap button, not a pick').toEqual([]);
  });

  it('searches by name or code, each list by its own term', () => {
    const m = model();
    expect(m.availableFor('سعيد', null).free.map((o) => o.employeeId)).toEqual([E3]);
    expect(m.availableFor('11004', null).flagged.map((o) => o.employeeId)).toEqual([E4]);
    expect(m.unavailableFor('', []).map((d) => d.employeeId)).toEqual([E2, E6]);
    expect(m.unavailableFor('', ['hrLeave']).map((d) => d.employeeId)).toEqual([E2]);
    expect(m.unavailableFor('ياسر', []).map((d) => d.employeeId)).toEqual([E6]);
  });

  it('says why a driver is out, and keeps a pressed chip for a reason nobody has today', () => {
    const m = model({ reasons: ['licenceExpired'] });
    expect(m.unavailableReason.get(E2)).toBe('hrLeave');
    expect(m.subtotals).toEqual([
      { reason: 'fleetUnavailability', count: 1 },
      { reason: 'hrLeave', count: 1 },
    ]);
    expect(m.chips.at(-1)).toEqual({ reason: 'licenceExpired', count: 0 });
    expect(m.reasonLabel('hrLeave')).toBe(t('fleet.roster.reason.hrLeave'));
    expect(m.reasonLabel('somethingNewer'), 'shown as sent').toBe('somethingNewer');
  });

  it('names a driver, or his id’s tail when the name is out of reach', () => {
    const m = model();
    expect(m.driverName(E1)).toBe('أحمد محمد');
    expect(m.driverName(null)).toBe('');
    expect(m.person(E3)?.code).toBe('11003');
    expect(m.codeOf(V5)).toBe('154');
    const stranger = '650000000000000000000099';
    expect(m.driverName(stranger), 'not one of Fleet’s people: the id’s tail').toBe('00000099');
    expect(m.person(stranger)).toBeUndefined();
  });

  it('promises a move only where the SERVER has him on another car', () => {
    const m = model();
    expect(m.transferFrom(E1, V3)).toBe('150');
    expect(m.transferFrom(E1, V1)).toBeNull();
    expect(m.transferFrom(E3, V3)).toBeNull();
  });
});
