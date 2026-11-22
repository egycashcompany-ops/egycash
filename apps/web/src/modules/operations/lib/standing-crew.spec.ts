// The standing crew's two adapters, and the one place it deliberately differs from the day.
//
// The interaction itself is NOT retested here — it is the same code as the daily board and is
// covered in `crew-board.spec.ts`. What is tested is exactly what this file owns: the shape going
// in, the shape going out, and `notes` never reaching a `.strict()` schema that has no such field.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../shared/lib/api-client';
import {
  CREW_SLOT_CAPACITY,
  type OperationsCrewMemberDto,
  type OperationsStandingCrewRowDto,
} from '@ecms/contracts';
import { assignToSlot, changedRows, slotOccupants, type BoardRow } from './crew-board';
import {
  discardRow,
  fitsCrewSlot,
  freeMember,
  isRemovableRow,
  listPool,
  patchRow,
  placeMember,
  isCrewClash,
  planRefusal,
  rebaseDraft,
  type CrewRole,
  type CrewSlot,
  type PlanRow,
} from './crew-plan';
import { resolveDrop } from './crew-drag';
import { EMPTY_ROW_FILTER, matchesRowFilter } from './crew-plan-filter';
import {
  rebaseHistory,
  record,
  sameCrewDraft,
  startHistory,
  undo,
  type CrewDraft,
} from './crew-undo';
import {
  isAlreadyRemoved,
  mergeStandingRows,
  newStandingPlanRow,
  newStandingRow,
  placeWithCrew,
  rebaseStandingDraft,
  removedBeforeStop,
  sendStandingSave,
  standingBoardRow,
  standingEditsLost,
  standingPutRows,
  standingCounts,
  standingCrewState,
  standingMember,
  standingSave,
  standingVehicleChoices,
  toStandingPayloadRows,
  toStandingPlanRows,
  toStandingRows,
} from './standing-crew';

const stored = (
  over: Partial<OperationsStandingCrewRowDto> = {},
): OperationsStandingCrewRowDto => ({
  id: 'sc1',
  vehicleId: 'v1',
  vehicleCode: 'C-1',
  captainEmployeeIds: [],
  specialist1EmployeeIds: [],
  specialist2EmployeeIds: [],
  direction: null,
  plannedTime: null,
  version: 0,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('toStandingRows', () => {
  it('pads every slot to the full set of cards, so each card is droppable', () => {
    const [row] = toStandingRows([stored({ captainEmployeeIds: ['e1'] })]);
    expect(row?.captainEmployeeIds).toHaveLength(CREW_SLOT_CAPACITY);
    expect(row?.captainEmployeeIds[0]).toBe('e1');
    expect(row?.captainEmployeeIds[1]).toBeNull();
  });

  it('carries a full six-person crew — the same ceiling as a day', () => {
    const [row] = toStandingRows([
      stored({
        captainEmployeeIds: ['e1', 'e2'],
        specialist1EmployeeIds: ['e3', 'e4'],
        specialist2EmployeeIds: ['e5', 'e6'],
      }),
    ]);
    expect(slotOccupants(row as BoardRow, 'captain')).toEqual(['e1', 'e2']);
    expect(slotOccupants(row as BoardRow, 'specialist2')).toEqual(['e5', 'e6']);
  });

  it('always sets notes to null — a standing row has none', () => {
    expect(toStandingRows([stored()])[0]?.notes).toBeNull();
  });

  it('keeps direction and plannedTime, which a standing row does have', () => {
    const [row] = toStandingRows([stored({ direction: 'الجيزة', plannedTime: '07:30' })]);
    expect(row?.direction).toBe('الجيزة');
    expect(row?.plannedTime).toBe('07:30');
  });
});

describe('toStandingPayloadRows', () => {
  it('never sends notes — the standing schema is strict and has no such field', () => {
    const [payload] = toStandingPayloadRows(toStandingRows([stored()]));
    expect(payload).not.toHaveProperty('notes');
    expect(payload).not.toHaveProperty('vehicleCode');
    expect(payload).not.toHaveProperty('date');
  });

  it('compacts the empty cell out of a slot rather than sending a hole', () => {
    const rows = assignToSlot(toStandingRows([stored()]), 'v1', 'captain', 1, 'e1');
    expect(toStandingPayloadRows(rows)[0]?.captainEmployeeIds).toEqual(['e1']);
  });

  it('sends an empty list for a slot nobody is in', () => {
    const [payload] = toStandingPayloadRows(toStandingRows([stored()]));
    expect(payload?.captainEmployeeIds).toEqual([]);
    expect(payload?.specialist1EmployeeIds).toEqual([]);
  });
});

describe('newStandingRow — a vehicle joining the cash-transfer fleet', () => {
  const added = newStandingRow({ vehicleId: 'v9', vehicleCode: 'C-9' });

  it('starts empty, with every card ready to receive a drop', () => {
    expect(slotOccupants(added, 'captain')).toEqual([]);
    expect(added.captainEmployeeIds).toHaveLength(CREW_SLOT_CAPACITY);
  });

  it('counts as CHANGED even while empty — membership is the row', () => {
    // This is the divergence from the daily board that matters most. There, an empty row for a
    // vehicle with no row means nothing happened. Here it means "this vehicle carries cash and has
    // no standing crew yet", which must survive a save.
    expect(changedRows([added], []).map((r) => r.vehicleId)).toEqual(['v9']);
  });

  it('is saveable as an empty payload row rather than being dropped', () => {
    const [payload] = toStandingPayloadRows(changedRows([added], []));
    expect(payload?.vehicleId).toBe('v9');
    expect(payload?.captainEmployeeIds).toEqual([]);
  });
});

describe('mergeStandingRows — a refetch must not destroy the draft', () => {
  const server = (vehicleId: string, direction: string | null = null) =>
    toStandingRows([
      stored({ id: vehicleId, vehicleId, vehicleCode: `C-${vehicleId}`, direction }),
    ])[0] as BoardRow;

  it('keeps the LOCAL row for a vehicle the server also has', () => {
    // The bug this exists for: Remove refetches the list, and a plain setRows(serverRows) threw
    // away every unsaved edit on every OTHER vehicle. The operator's own click destroyed their work.
    const previous = [server('v1')];
    const edited = { ...server('v1'), direction: 'الجيزة' };
    const merged = mergeStandingRows([server('v1')], [edited], previous);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.direction).toBe('الجيزة');
  });

  it('takes a vehicle the server has and the draft does not', () => {
    const merged = mergeStandingRows([server('v1'), server('v2')], [server('v1')], [server('v1')]);
    expect(merged.map((r) => r.vehicleId).sort()).toEqual(['v1', 'v2']);
  });

  it('keeps a vehicle added from the picker and not yet saved', () => {
    const added = newStandingRow({ vehicleId: 'v9', vehicleCode: 'C-9' });
    const merged = mergeStandingRows([server('v1')], [server('v1'), added], [server('v1')]);
    expect(merged.map((r) => r.vehicleId)).toEqual(['v1', 'v9']);
  });

  it('does NOT resurrect a vehicle that was removed on the server', () => {
    // It was on the server last time and is gone now — that is a removal, not a local addition.
    const merged = mergeStandingRows(
      [server('v1')],
      [server('v1'), server('v2')],
      [server('v1'), server('v2')],
    );
    expect(merged.map((r) => r.vehicleId)).toEqual(['v1']);
  });

  it('survives a remove with the rest of the draft intact — the whole point', () => {
    const before = [server('v1'), server('v2'), server('v3')];
    const draft = [{ ...server('v1'), direction: 'بنها' }, server('v2'), server('v3')];
    // v3 is removed on the server; v1's unsaved direction must still be there afterwards.
    const merged = mergeStandingRows([server('v1'), server('v2')], draft, before);
    expect(merged.map((r) => r.vehicleId)).toEqual(['v1', 'v2']);
    expect(merged[0]?.direction).toBe('بنها');
  });

  it('takes the server wholesale on the very first reconcile', () => {
    expect(mergeStandingRows([server('v1')], [], []).map((r) => r.vehicleId)).toEqual(['v1']);
  });
});

// ── Round 27 — «الطاقم الثابت» on the board's own rows ──────────────────────────────────────────────
// «عاوزك تخلى شاشة الطاقم الثابت نفس شكل لوحة التشغيل بقى فاهم»: the screen edits the board's row
// (`PlanRow`) with the board's own steps — the drop's rule, the pick, «تراجع» — and its save is still
// written by `toStandingPayloadRows`, so the wire does not move.

const ROWS_IN: OperationsStandingCrewRowDto[] = [
  stored({
    id: 'sc-213',
    vehicleId: 'v-213',
    vehicleCode: '213',
    captainEmployeeIds: ['cap-a'],
    specialist1EmployeeIds: ['sp-1', 'sp-2'],
    specialist2EmployeeIds: ['sp-3'],
    direction: 'مدينة نصر',
    plannedTime: '07:30',
  }),
  stored({
    id: 'sc-248',
    vehicleId: 'v-248',
    vehicleCode: '248',
    captainEmployeeIds: ['cap-b', 'cap-c'],
    specialist1EmployeeIds: ['sp-4', 'sp-5'],
    specialist2EmployeeIds: ['sp-6'],
  }),
  stored({ id: 'sc-501', vehicleId: 'v-501', vehicleCode: '501' }),
];
const SERVER = toStandingPlanRows(ROWS_IN);
const row = (rows: readonly PlanRow[], key: string): PlanRow =>
  rows.find((candidate) => candidate.key === key) as PlanRow;

describe('Round 27 — the standing rows as the board’s rows', () => {
  it('keys each vehicle as the board keys a van, off any day’s roster, with its stored row’s id', () => {
    expect(SERVER.map((one) => one.key)).toEqual(['van:v-213', 'van:v-248', 'van:v-501']);
    const first = row(SERVER, 'van:v-213');
    expect(first).toMatchObject({
      vehicleId: 'v-213',
      vehicleCode: '213',
      onRoster: false,
      crewId: 'sc-213',
      drivers: [],
      shiftTypeId: null,
      rowColour: null,
      notes: null,
      direction: 'مدينة نصر',
      plannedTime: '07:30',
    });
    expect(first.slots).toEqual({
      captain: ['cap-a'],
      specialist1: ['sp-1', 'sp-2'],
      specialist2: ['sp-3'],
    });
    // Off the roster: the board's bin REMOVES the row — a vehicle leaving the fleet.
    expect(isRemovableRow(first)).toBe(true);
    expect(toStandingPlanRows(undefined)).toEqual([]);
  });

  it('caps a slot at the board’s capacity, whatever the server sent', () => {
    const [only] = toStandingPlanRows([
      stored({ captainEmployeeIds: ['a', 'b', 'c'].slice(0, CREW_SLOT_CAPACITY + 1) }),
    ]);
    expect(only?.slots.captain).toHaveLength(CREW_SLOT_CAPACITY);
  });

  it('writes the payload with `toStandingPayloadRows` — the same body as before, byte for byte', () => {
    const moved = placeMember(SERVER, 'van:v-501', 'captain', 'cap-a');
    const saved = standingSave(moved, SERVER);
    expect(saved.put).toEqual(
      toStandingPayloadRows(
        [row(moved, 'van:v-213'), row(moved, 'van:v-501')].map(standingBoardRow),
      ),
    );
    expect(saved.put).toEqual([
      {
        vehicleId: 'v-213',
        captainEmployeeIds: [],
        specialist1EmployeeIds: ['sp-1', 'sp-2'],
        specialist2EmployeeIds: ['sp-3'],
        direction: 'مدينة نصر',
        plannedTime: '07:30',
      },
      {
        vehicleId: 'v-501',
        captainEmployeeIds: ['cap-a'],
        specialist1EmployeeIds: [],
        specialist2EmployeeIds: [],
        direction: null,
        plannedTime: null,
      },
    ]);
    expect(saved.put[0]).not.toHaveProperty('notes');
    expect(saved.removeVehicleIds).toEqual([]);
    expect(saved.count).toBe(2);
    // Nothing changed — nothing to send.
    expect(standingSave(SERVER, SERVER)).toEqual({ put: [], removeVehicleIds: [], count: 0 });
  });

  it('a row changed and changed back is no change; a direction or a time is', () => {
    const there = placeMember(SERVER, 'van:v-501', 'captain', 'cap-a');
    const back = placeMember(there, 'van:v-213', 'captain', 'cap-a');
    expect(standingSave(back, SERVER).count).toBe(0);
    const timed = patchRow(SERVER, 'van:v-501', { plannedTime: '09:00' });
    expect(standingSave(timed, SERVER).put).toEqual([
      expect.objectContaining({ vehicleId: 'v-501', plannedTime: '09:00' }),
    ]);
  });

  it('a vehicle taken out is a DELETE of its own, and its people go back to the pools', () => {
    const out = discardRow(SERVER, 'van:v-213');
    expect(out.map((one) => one.key)).toEqual(['van:v-248', 'van:v-501']);
    const saved = standingSave(out, SERVER);
    expect(saved.removeVehicleIds).toEqual(['v-213']);
    expect(saved.put).toEqual([]);
    expect(saved.count).toBe(1);
  });

  it('a vehicle added is saved even empty — membership is the row', () => {
    const added = [...SERVER, newStandingPlanRow({ vehicleId: 'v-282', vehicleCode: '282' })];
    expect(row(added, 'van:v-282')).toMatchObject({ crewId: null, onRoster: false });
    const saved = standingSave(added, SERVER);
    expect(saved.put).toEqual([
      {
        vehicleId: 'v-282',
        captainEmployeeIds: [],
        specialist1EmployeeIds: [],
        specialist2EmployeeIds: [],
        direction: null,
        plannedTime: null,
      },
    ]);
  });

  it('taken out and added back before «حفظ»: an edit of its stored row, never a DELETE and a new one', () => {
    const out = discardRow(SERVER, 'van:v-213');
    const back = [...out, newStandingPlanRow({ vehicleId: 'v-213', vehicleCode: '213' }, SERVER)];
    expect(row(back, 'van:v-213').crewId).toBe('sc-213');
    const saved = standingSave(back, SERVER);
    expect(saved.removeVehicleIds).toEqual([]);
    expect(saved.put.map((one) => one.vehicleId)).toEqual(['v-213']);
  });
});

describe('Round 27 — «إضافة سيارة» offers the vehicles that may still join, through the draft', () => {
  const available = [
    { vehicleId: 'v-P10', vehicleCode: 'P10', uncoded: null },
    { vehicleId: 'v-150', vehicleCode: '150', uncoded: null },
    { vehicleId: 'v-9', vehicleCode: '9', uncoded: null },
    { vehicleId: 'v-P9', vehicleCode: 'P9', uncoded: null },
  ];

  it('the server’s list in number order, under the cash-transfer heading when it is narrowed', () => {
    const choices = standingVehicleChoices(SERVER, SERVER, available, true);
    expect(choices.map((one) => one.vehicleCode)).toEqual(['9', '150', 'P9', 'P10']);
    expect(new Set(choices.map((one) => one.group))).toEqual(new Set(['cashTransfer']));
    expect(choices.every((one) => one.pickable && !one.onRoster && one.drivers.length === 0)).toBe(
      true,
    );
    // Not narrowed (no operation configured): «باقي السيارات».
    expect(standingVehicleChoices(SERVER, SERVER, available, false)[0]?.group).toBe('other');
  });

  it('adds back a vehicle taken out here, and leaves out one a row of the draft holds', () => {
    const out = discardRow(SERVER, 'van:v-501');
    const added = [...out, newStandingPlanRow({ vehicleId: 'v-150', vehicleCode: '150' })];
    const codes = standingVehicleChoices(added, SERVER, available, true).map(
      (one) => one.vehicleCode,
    );
    expect(codes).toEqual(['9', '501', 'P9', 'P10']);
  });
});

describe('Round 27 — the roster without the day’s facts', () => {
  const member = (over: Partial<OperationsCrewMemberDto> = {}): OperationsCrewMemberDto => ({
    employeeId: 'e-1',
    code: '1',
    fullNameAr: 'احمد',
    status: 'active',
    jobTitle: null,
    phone: null,
    branchId: null,
    requirements: null,
    assignedVehicleId: 'v-today',
    availability: 'absent',
    ...over,
  });

  it('drops HR’s absence and the day’s van — a dateless list has no day to say them about', () => {
    expect(standingMember(member())).toMatchObject({ availability: null, assignedVehicleId: null });
  });

  it('so the pools list nobody as away, and the drop refuses nobody for it', () => {
    const away = member({
      requirements: {
        id: 'r',
        employeeId: 'e-1',
        isCaptain: true,
        isSpecialist: false,
        hasWeapon: false,
        hasSignature: false,
        hasLicense: false,
        hasTemporaryLicense: false,
        isOpsAdmin: false,
        isNewJoiner: false,
        isAssignedSpecialTask: false,
        isPriority: false,
        notes: null,
        version: 1,
        createdAt: '',
        updatedAt: '',
      },
    });
    const pool = listPool([standingMember(away)], 'captains', SERVER, { search: '', flags: [] });
    expect(pool.free).toBe(1);
    expect(
      resolveDrop(
        SERVER,
        { kind: 'slot', key: 'van:v-501', slot: 'captain' },
        'e-1',
        'captain',
        null,
      ),
    ).toEqual({ kind: 'place', key: 'van:v-501', slot: 'captain' });
  });
});

describe('Round 27 — the counters', () => {
  it('a vehicle’s crew is full, short (the board’s ⚠) or empty', () => {
    expect(standingCrewState(row(SERVER, 'van:v-213'))).toBe('complete');
    expect(standingCrewState(row(SERVER, 'van:v-501'))).toBe('empty');
    const short = freeMember(SERVER, 'sp-3');
    expect(standingCrewState(row(short, 'van:v-213'))).toBe('complete');
    const shorter = freeMember(freeMember(short, 'sp-1'), 'sp-2');
    expect(standingCrewState(row(shorter, 'van:v-213'))).toBe('short');
    expect(standingCounts(shorter)).toEqual({ total: 3, complete: 1, short: 1, empty: 1 });
  });
});

describe('Round 27 — the drop, the pick and the filters are the board’s, on standing rows', () => {
  const roleOf: Record<string, CrewRole> = {
    'cap-a': 'captain',
    'cap-b': 'captain',
    'cap-c': 'captain',
    'sp-new': 'specialist',
    dual: 'dual',
  };
  const role = (id: string): CrewRole => roleOf[id] ?? 'specialist';

  it('a drop on a slot seats him; on the row, the slot his role takes; a full slot refuses', () => {
    const drop = (key: string, slot: CrewSlot | null, id: string) =>
      resolveDrop(
        SERVER,
        slot === null ? { kind: 'row', key } : { kind: 'slot', key, slot },
        id,
        role(id),
        null,
      );
    expect(drop('van:v-501', 'specialist1', 'sp-new')).toEqual({
      kind: 'place',
      key: 'van:v-501',
      slot: 'specialist1',
    });
    expect(drop('van:v-501', null, 'cap-a')).toEqual({
      kind: 'place',
      key: 'van:v-501',
      slot: 'captain',
    });
    // 248's captain slot holds two already.
    expect(drop('van:v-248', 'captain', 'cap-a')).toMatchObject({ kind: 'refuse', reason: 'full' });
    // Round 23 — a captain in a specialist's slot, a specialist in the captain's: refused.
    expect(drop('van:v-501', 'specialist2', 'cap-a')).toMatchObject({
      kind: 'refuse',
      reason: 'notSpecialist',
    });
    expect(drop('van:v-501', 'captain', 'sp-new')).toMatchObject({
      kind: 'refuse',
      reason: 'notCaptain',
    });
    // Back on a pool: off the list.
    expect(resolveDrop(SERVER, { kind: 'pool', pool: 'captains' }, 'cap-a', 'captain')).toEqual({
      kind: 'free',
    });
  });

  it('the filters narrow the table only: the vehicle, a person by name or code', () => {
    const members = new Map([
      ['cap-a', { fullNameAr: 'أحمد سيد', code: '0100007' }],
      ['sp-4', { fullNameAr: 'عمرو سعيد', code: '0300014' }],
    ]);
    const memberOf = (id: string) => members.get(id);
    const shown = (filter: typeof EMPTY_ROW_FILTER) =>
      SERVER.filter((one) => matchesRowFilter(one, filter, { memberOf })).map((one) => one.key);
    expect(shown({ ...EMPTY_ROW_FILTER, vans: ['v-248'] })).toEqual(['van:v-248']);
    expect(shown({ ...EMPTY_ROW_FILTER, person: 'احمد' })).toEqual(['van:v-213']);
    expect(shown({ ...EMPTY_ROW_FILTER, person: '0300014' })).toEqual(['van:v-248']);
  });

  it('«تراجع» takes back one operation: a vehicle added, then a person seated, one press each', () => {
    let history = startHistory<CrewDraft>({ rows: SERVER, standingKeys: null });
    const added = [...SERVER, newStandingPlanRow({ vehicleId: 'v-282', vehicleCode: '282' })];
    history = record(
      history,
      { rows: added, standingKeys: null },
      { kind: 'addVehicle' },
      {
        same: sameCrewDraft,
      },
    );
    const seated = placeMember(added, 'van:v-282', 'captain', 'cap-a');
    history = record(
      history,
      { rows: seated, standingKeys: null },
      { kind: 'place' },
      {
        same: sameCrewDraft,
      },
    );
    expect(history.past.map((step) => step.what.kind)).toEqual(['addVehicle', 'place']);
    history = undo(history);
    expect(row(history.now.rows, 'van:v-282').slots.captain).toEqual([]);
    expect(row(history.now.rows, 'van:v-213').slots.captain).toEqual(['cap-a']);
    history = undo(history);
    expect(history.now.rows.map((one) => one.key)).toEqual(SERVER.map((one) => one.key));
    expect(standingSave(history.now.rows, SERVER).count).toBe(0);
  });

  it('another desk’s save is rebased under the draft, as the board’s — the old merge’s promise kept', () => {
    // The planner changed 213's direction and added 282; another desk took 501 out and added 640.
    const draft = [
      ...patchRow(SERVER, 'van:v-213', { direction: 'بنها' }),
      newStandingPlanRow({ vehicleId: 'v-282', vehicleCode: '282' }),
    ];
    const next = toStandingPlanRows([
      ...ROWS_IN.filter((one) => one.vehicleId !== 'v-501'),
      stored({ id: 'sc-640', vehicleId: 'v-640', vehicleCode: '640' }),
    ]);
    const rebased = rebaseDraft(draft, SERVER, next);
    expect(rebased.map((one) => one.key)).toEqual([
      'van:v-213',
      'van:v-248',
      'van:v-640',
      'van:v-282',
    ]);
    expect(row(rebased, 'van:v-213').direction).toBe('بنها');
  });
});

describe('Round 27 — a captain moves with his crew («يسحب الأخصائيين اللى معاه»)', () => {
  const fitsAll = (): boolean => true;
  const roles: Record<string, CrewRole> = { 'cap-a': 'captain', 'cap-b': 'captain' };
  const fits = (id: string, slot: CrewSlot): boolean =>
    fitsCrewSlot(roles[id] ?? 'specialist', slot);

  it('alone on his vehicle: every specialist of it follows him, each in the same slot', () => {
    const step = placeWithCrew(SERVER, 'van:v-501', 'captain', 'cap-a', fitsAll);
    expect(step.companions).toEqual(['sp-1', 'sp-2', 'sp-3']);
    expect(row(step.rows, 'van:v-501').slots).toEqual({
      captain: ['cap-a'],
      specialist1: ['sp-1', 'sp-2'],
      specialist2: ['sp-3'],
    });
    expect(row(step.rows, 'van:v-213').slots).toEqual({
      captain: [],
      specialist1: [],
      specialist2: [],
    });
  });

  it('one of two captains: only the specialist on his own line of each slot', () => {
    const step = placeWithCrew(SERVER, 'van:v-501', 'captain', 'cap-c', fitsAll);
    // cap-c is 248's second captain: sp-5 is second in «أخصائي 1», and «أخصائي 2» has no second.
    expect(step.companions).toEqual(['sp-5']);
    expect(row(step.rows, 'van:v-248').slots).toEqual({
      captain: ['cap-b'],
      specialist1: ['sp-4'],
      specialist2: ['sp-6'],
    });
  });

  it('a companion the slot no longer fits stays where he sits (Round 23)', () => {
    // A captain-only held in 213's «أخصائي 2» from before the rule.
    const held = placeMember(freeMember(SERVER, 'sp-3'), 'van:v-213', 'specialist2', 'cap-b');
    const step = placeWithCrew(held, 'van:v-501', 'captain', 'cap-a', fits);
    expect(step.companions).toEqual(['sp-1', 'sp-2']);
    expect(row(step.rows, 'van:v-213').slots.specialist2).toEqual(['cap-b']);
  });

  it('from a pool, from a specialist’s slot, or within one vehicle he comes alone', () => {
    const fromPool = placeWithCrew(SERVER, 'van:v-501', 'captain', 'cap-new', fitsAll);
    expect(fromPool.companions).toEqual([]);
    expect(row(fromPool.rows, 'van:v-501').slots.captain).toEqual(['cap-new']);
    const sameRow = placeWithCrew(
      freeMember(SERVER, 'cap-c'),
      'van:v-248',
      'captain',
      'cap-b',
      fitsAll,
    );
    expect(sameRow.companions).toEqual([]);
  });

  it('a slot that refuses him moves nobody; a full slot keeps its companion behind', () => {
    const refused = placeWithCrew(SERVER, 'van:v-248', 'captain', 'cap-a', fitsAll);
    expect(refused.rows).toBe(SERVER);
    expect(refused.companions).toEqual([]);
    // 501 with two specialists in «أخصائي 1» already: sp-1 and sp-2 cannot join them.
    const crowded = placeMember(
      placeMember(SERVER, 'van:v-501', 'specialist1', 'x-1'),
      'van:v-501',
      'specialist1',
      'x-2',
    );
    const step = placeWithCrew(crowded, 'van:v-501', 'captain', 'cap-a', fitsAll);
    expect(step.companions).toEqual(['sp-3']);
    expect(row(step.rows, 'van:v-213').slots.specialist1).toEqual(['sp-1', 'sp-2']);
  });
});

// ── Round 27 verification — «حفظ» when another desk took a vehicle out first ──────────────────────
//
// Found on the real stack: desk B removed vehicle 252 while desk A had also taken it out (and seated a
// captain on 251). A's «حفظ» sent DELETE 252 → 404, stopped there, and every later press did the same:
// the 251 edit could never be saved without a reload that threw the draft away. A 404 is the end state
// A asked for — the server's `remove` says so — so the save goes on.
describe('Round 27 — «حفظ»: the DELETEs, then one PUT; a vehicle already gone is done', () => {
  const NOT_FOUND = new ApiError('NOT_FOUND', 'standing crew not found for this vehicle', 404);
  const CONFLICT = new ApiError('CONFLICT', 'refused', 409);
  const run = (
    plan: { removeVehicleIds: string[]; put: unknown[] },
    answers: { remove?: Record<string, unknown>; put?: unknown } = {},
  ) => {
    const sent: string[] = [];
    const outcome = sendStandingSave(plan, {
      remove: async (vehicleId) => {
        sent.push(`DELETE ${vehicleId}`);
        const answer = answers.remove?.[vehicleId];
        if (answer !== undefined) throw answer;
      },
      put: async () => {
        sent.push('PUT');
        if (answers.put !== undefined) throw answers.put;
      },
    });
    return { sent, outcome };
  };

  it('a 404 is «already removed»; any other refusal, or a non-API error, is not', () => {
    expect(isAlreadyRemoved(NOT_FOUND)).toBe(true);
    expect(isAlreadyRemoved(CONFLICT)).toBe(false);
    expect(isAlreadyRemoved(new Error('network'))).toBe(false);
    expect(isAlreadyRemoved(undefined)).toBe(false);
  });

  it('sends every DELETE first, then ONE PUT', async () => {
    const { sent, outcome } = run({ removeVehicleIds: ['v-1', 'v-2'], put: [{}] });
    expect(await outcome).toEqual({ kind: 'saved', alreadyGone: [] });
    expect(sent).toEqual(['DELETE v-1', 'DELETE v-2', 'PUT']);
  });

  it('a vehicle another desk already took out (404) is done: the rest of the draft is still sent', async () => {
    const { sent, outcome } = run(
      { removeVehicleIds: ['v-1', 'v-2'], put: [{}] },
      { remove: { 'v-1': NOT_FOUND } },
    );
    expect(await outcome).toEqual({ kind: 'saved', alreadyGone: ['v-1'] });
    expect(sent).toEqual(['DELETE v-1', 'DELETE v-2', 'PUT']);
  });

  it('removals only, the vehicle already gone: saved, and said so (the page re-reads the list)', async () => {
    const { sent, outcome } = run(
      { removeVehicleIds: ['v-1'], put: [] },
      { remove: { 'v-1': NOT_FOUND } },
    );
    expect(await outcome).toEqual({ kind: 'saved', alreadyGone: ['v-1'] });
    expect(sent).toEqual(['DELETE v-1']);
  });

  it('any other refused DELETE stops the save there — no PUT behind it', async () => {
    const { sent, outcome } = run(
      { removeVehicleIds: ['v-1', 'v-2'], put: [{}] },
      { remove: { 'v-1': NOT_FOUND, 'v-2': CONFLICT } },
    );
    expect(await outcome).toEqual({
      kind: 'removeFailed',
      vehicleId: 'v-2',
      failure: CONFLICT,
      alreadyGone: ['v-1'],
    });
    expect(sent).toEqual(['DELETE v-1', 'DELETE v-2']);
  });

  it('a refused PUT is reported as the PUT’s; nothing is sent when there is nothing to put', async () => {
    const refused = run({ removeVehicleIds: [], put: [{}] }, { put: CONFLICT });
    expect(await refused.outcome).toEqual({
      kind: 'putFailed',
      failure: CONFLICT,
      alreadyGone: [],
    });
    const nothing = run({ removeVehicleIds: [], put: [] });
    expect(await nothing.outcome).toEqual({ kind: 'saved', alreadyGone: [] });
    expect(nothing.sent).toEqual([]);
  });
});

// ── Round 27 review — the critic's findings on «الطاقم الثابت» ─────────────────────────────────────

// F1 (high): the page reconciles with the board's `rebaseDraft`, which KEEPS a row the planner
// touched after its server row is gone. The standing PUT upserts by vehicle, so the next «حفظ» put a
// vehicle another desk had taken out — and its crew — back in the fleet, without a word.
describe('Round 27 review — a vehicle taken out on the server is not brought back by «حفظ»', () => {
  // The planner took sp-1 off 213 (a touched row); another desk then took 213 and 501 out.
  const draft = freeMember(SERVER, 'sp-1');
  const next = toStandingPlanRows(
    ROWS_IN.filter((one) => one.vehicleId !== 'v-213' && one.vehicleId !== 'v-501'),
  );

  it('the board’s rebase alone keeps the touched row — and the PUT would carry it', () => {
    const kept = rebaseDraft(draft, SERVER, next);
    expect(kept.map((one) => one.key)).toEqual(['van:v-248', 'van:v-213']);
    expect(standingSave(kept, next).put.map((one) => one.vehicleId)).toEqual(['v-213']);
  });

  it('the standing rebase drops it: nothing to PUT, nothing to DELETE', () => {
    const rebased = rebaseStandingDraft(draft, SERVER, next);
    expect(rebased.map((one) => one.key)).toEqual(['van:v-248']);
    expect(standingSave(rebased, next)).toEqual({ put: [], removeVehicleIds: [], count: 0 });
  });

  it('names the touched vehicle whose edit was dropped — not the untouched one that simply left', () => {
    expect(standingEditsLost(draft, SERVER, next).map((one) => one.vehicleCode)).toEqual(['213']);
    expect(standingEditsLost(SERVER, SERVER, next)).toEqual([]);
  });

  it('a vehicle added here and never saved stays; a vehicle re-created on the server keeps the edit', () => {
    const added = [...draft, newStandingPlanRow({ vehicleId: 'v-282', vehicleCode: '282' })];
    const rebased = rebaseStandingDraft(added, SERVER, next);
    expect(rebased.map((one) => one.key)).toEqual(['van:v-248', 'van:v-282']);
    expect(row(rebased, 'van:v-282').crewId).toBeNull();
    // 213 removed and added again at another desk (a new stored row): the planner's edit stands on it.
    const again = toStandingPlanRows([
      ...ROWS_IN.filter((one) => one.vehicleId !== 'v-213'),
      { ...(ROWS_IN[0] as OperationsStandingCrewRowDto), id: 'sc-213b' },
    ]);
    const onNew = rebaseStandingDraft(draft, SERVER, again);
    expect(row(onNew, 'van:v-213').crewId).toBe('sc-213b');
    expect(row(onNew, 'van:v-213').slots.specialist1).toEqual(['sp-2']);
    expect(standingEditsLost(draft, SERVER, again)).toEqual([]);
  });

  it('taken out, then added back here, then taken out at another desk: not brought back either', () => {
    const readded = [
      ...discardRow(SERVER, 'van:v-501'),
      newStandingPlanRow({ vehicleId: 'v-501', vehicleCode: '501' }, SERVER),
    ];
    const without501 = toStandingPlanRows(ROWS_IN.filter((one) => one.vehicleId !== 'v-501'));
    const rebased = rebaseStandingDraft(readded, SERVER, without501);
    expect(rebased.map((one) => one.key)).toEqual(['van:v-213', 'van:v-248']);
  });

  it('through «تراجع» too: no step of the history brings the vehicle back', () => {
    let history = startHistory<CrewDraft>({ rows: SERVER, standingKeys: null });
    history = record(
      history,
      { rows: draft, standingKeys: null },
      { kind: 'free' },
      {
        same: sameCrewDraft,
      },
    );
    const rebased = rebaseHistory(
      history,
      (state) => ({ ...state, rows: rebaseStandingDraft(state.rows, SERVER, next) }),
      sameCrewDraft,
    );
    expect(rebased.now.rows.map((one) => one.key)).toEqual(['van:v-248']);
    // The step that edited 213 undoes nothing any more, and is gone.
    expect(rebased.past).toEqual([]);
    expect(standingSave(undo(rebased).now.rows, next).count).toBe(0);
  });
});

// F2 (medium): the DELETEs commit before the PUT. A PUT refused behind them — or a DELETE refused
// after others went through — still left those vehicles OUT; «تعذّر الحفظ» alone said nothing was.
describe('Round 27 review — the vehicles «حفظ» took out before it stopped', () => {
  const plan = { removeVehicleIds: ['v-1', 'v-2', 'v-3'] };
  const failure = new ApiError('DUPLICATE', 'clash', 409);

  it('a refused PUT: every vehicle taken out is out (a 404 one too)', () => {
    expect(removedBeforeStop(plan, { kind: 'putFailed', failure, alreadyGone: ['v-2'] })).toEqual([
      'v-1',
      'v-2',
      'v-3',
    ]);
  });

  it('a refused DELETE: those before it are out, it and those after are not', () => {
    expect(
      removedBeforeStop(plan, { kind: 'removeFailed', vehicleId: 'v-2', failure, alreadyGone: [] }),
    ).toEqual(['v-1']);
    expect(
      removedBeforeStop(plan, { kind: 'removeFailed', vehicleId: 'v-1', failure, alreadyGone: [] }),
    ).toEqual([]);
  });

  it('saved, or nothing taken out: nothing to say', () => {
    expect(removedBeforeStop(plan, { kind: 'saved', alreadyGone: [] })).toEqual([]);
    expect(
      removedBeforeStop({ removeVehicleIds: [] }, { kind: 'putFailed', failure, alreadyGone: [] }),
    ).toEqual([]);
  });
});

// F4 / F8: a refused PUT is worded by what it IS, and a person the server names is found on his row.
describe('Round 27 review — a refused PUT, read as the board reads its own', () => {
  it('only the end-state clash (409 DUPLICATE) is «one person, two vehicles»', () => {
    // The standing save's clash: `ConflictError` — 409, code DUPLICATE.
    expect(isCrewClash(new ApiError('DUPLICATE', 'employee x already holds a place', 409))).toBe(
      true,
    );
    expect(isCrewClash(new ApiError('INTERNAL', 'boom', 500))).toBe(false);
    expect(isCrewClash(new ApiError('NOT_FOUND', 'gone', 404))).toBe(false);
    expect(isCrewClash(new ApiError('VALIDATION_FAILED', 'vehicle not found', 400))).toBe(false);
    expect(isCrewClash(new ApiError('STALE_DOCUMENT', 'stale', 409))).toBe(false);
    expect(isCrewClash(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('the PUT’s rows in its own order — what `ROW_INDEX` counts', () => {
    const edited = patchRow(placeMember(SERVER, 'van:v-501', 'captain', 'cap-z'), 'van:v-213', {
      plannedTime: '09:00',
    });
    const sent = standingPutRows(edited, SERVER);
    expect(sent.map((one) => one.key)).toEqual(['van:v-213', 'van:v-501']);
    expect(standingSave(edited, SERVER).put.map((one) => one.vehicleId)).toEqual(
      sent.map((one) => one.vehicleId),
    );
  });

  it('a WRONG_SLOT 422 names the person on the row the page rings', () => {
    const edited = patchRow(placeMember(SERVER, 'van:v-501', 'captain', 'cap-z'), 'van:v-213', {
      plannedTime: '09:00',
    });
    const sent = standingPutRows(edited, SERVER);
    const refused = new ApiError('OPERATIONS_CREW_MEMBER_WRONG_SLOT', 'not a captain', 422, [
      { field: 'employeeId', code: 'NOT_A_CAPTAIN', message: 'cap-z' },
      { field: 'rows', code: 'ROW_INDEX', message: '1' },
    ]);
    expect(planRefusal(refused, sent)).toEqual({
      key: 'van:v-501',
      field: 'slot',
      person: { employeeId: 'cap-z', reason: 'notCaptain' },
    });
  });
});
