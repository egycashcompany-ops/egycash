// «لوحة التشغيلة» (Round 20) — the plan's moves, asserted as state transitions.
//
// What matters here is that every gesture on the board produces a plan the server will accept —
// nobody on two rows, no slot over its limit — and that the row's own fields (its type from
// «أنواع التشغيل», its colour, the rows without a van) survive the round trip from the read to the
// save body, a body the server's own schema takes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CREW_SLOT_CAPACITY,
  MAX_PAGE_SIZE,
  PlanOperationsCrewSchema,
  type OperationsCrewBoardCrewDto,
  type OperationsCrewBoardDto,
  type OperationsCrewMemberDto,
  type OperationsCrewRequirementsDto,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  CREW_LIMITS,
  PLAN_FLAGS,
  attachVan,
  changeCount,
  clearStandingFromPlan,
  crewRoleOf,
  crewShortfall,
  discardRow,
  flagsOf,
  freeMember,
  isBlankRow,
  isCrewClash,
  listPool,
  loadStandingIntoPlan,
  NO_SHIFT_TYPE,
  SHIFT_TYPE_LIST,
  matchesShiftType,
  outOfRole,
  parseClock,
  patchRow,
  placeMember,
  planChanges,
  planPoolOf,
  planRefusal,
  planRowCard,
  seatOf,
  shiftTypeChoices,
  shiftTypeStrip,
  slotRefusal,
  toPlan,
  toPlanRows,
  vansFree,
  vehiclelessRow,
  type PlanRow,
} from './crew-plan';
import { ApiError } from '../../../shared/lib/api-client';
import { activeAreaNames } from '../api/operations-queries';
import { crewPlanSheet } from './crew-plan-export';
import { REQUIREMENT_FLAGS } from './requirements';

const requirements = (
  over: Partial<OperationsCrewRequirementsDto>,
): OperationsCrewRequirementsDto => ({
  id: 'r',
  employeeId: 'e',
  isCaptain: false,
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
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const member = (
  id: string,
  req: Partial<OperationsCrewRequirementsDto> | null,
  name = `موظف ${id}`,
): OperationsCrewMemberDto =>
  ({
    employeeId: id,
    code: `0${id}`,
    fullNameAr: name,
    status: 'active',
    requirements: req === null ? null : requirements(req),
    assignedVehicleId: null,
  }) as OperationsCrewMemberDto;

const van = (code: string, over: Partial<PlanRow> = {}): PlanRow => ({
  key: `van:v-${code}`,
  vehicleId: `v-${code}`,
  vehicleCode: code,
  crewId: null,
  drivers: [],
  slots: { captain: [], specialist1: [], specialist2: [] },
  direction: null,
  plannedTime: null,
  shiftTypeId: null,
  rowColour: null,
  notes: null,
  ...over,
});

const slots = (captain: string[], specialist1: string[] = [], specialist2: string[] = []) => ({
  captain,
  specialist1,
  specialist2,
});

/** A type of «أنواع التشغيل», as `GET /operations/shift-types` answers it. */
const shiftType = (
  id: string,
  name: string,
  over: Partial<OperationsShiftTypeDto> = {},
): OperationsShiftTypeDto => ({
  id,
  name,
  nameEn: null,
  colour: 'rose',
  sortOrder: null,
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

/** The catalog as the server lists it — its order — one type archived since. */
const CATALOG = [
  shiftType('t-daily', 'يومي', { sortOrder: 0 }),
  shiftType('t-reserve', 'احتياطي', { sortOrder: 1, colour: 'teal' }),
  shiftType('t-aswan', 'أسوان', { sortOrder: 2, colour: 'indigo', isActive: false }),
  shiftType('t-secured', 'محصنة', { sortOrder: 3, colour: 'slate' }),
];

const crew = (over: Partial<OperationsCrewBoardCrewDto> = {}): OperationsCrewBoardCrewDto => ({
  id: 'c',
  captainEmployeeIds: [],
  specialist1EmployeeIds: [],
  specialist2EmployeeIds: [],
  direction: null,
  plannedTime: null,
  notes: null,
  shiftTypeId: null,
  rowColour: null,
  ...over,
});

// ── The read ────────────────────────────────────────────────────────────────────────────────────

describe('toPlanRows — the board as the server sends it', () => {
  const board: OperationsCrewBoardDto = {
    date: '2026-11-16T00:00:00.000Z',
    day: null,
    rows: [
      {
        vehicleId: 'v-213',
        vehicleCode: '213',
        fleetDutyAssignmentId: 'fd',
        driver1EmployeeId: 'd1',
        driver2EmployeeId: null,
        drivers: [{ employeeId: 'd1', fullNameAr: 'سائق' }],
        missionTypeId: null,
        crew: crew({
          id: 'c-213',
          captainEmployeeIds: ['a'],
          specialist1EmployeeIds: ['b'],
          direction: 'مدينة نصر',
          plannedTime: '07:30',
          shiftTypeId: 't-secured',
          rowColour: 'yellow',
        }),
      },
      {
        vehicleId: 'v-248',
        vehicleCode: '248',
        fleetDutyAssignmentId: 'fd2',
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        drivers: [],
        missionTypeId: null,
        crew: null,
      },
    ],
    vehiclelessRows: [
      crew({ id: 'c-loose', captainEmployeeIds: ['x'], notes: 'انتظار', shiftTypeId: 't-reserve' }),
      crew({ id: 'c-loose2', specialist1EmployeeIds: ['y'] }),
    ],
    workshopVehicles: [{ vehicleId: 'v-310', vehicleCode: '310' }],
  };

  it('reads the type, the colour, the drivers, then the rows without a van in their order', () => {
    const rows = toPlanRows(board);
    expect(rows.map((row) => row.key)).toEqual([
      'van:v-213',
      'van:v-248',
      'loose:c-loose',
      'loose:c-loose2',
    ]);
    expect(rows[0]).toMatchObject({
      crewId: 'c-213',
      shiftTypeId: 't-secured',
      rowColour: 'yellow',
      drivers: [{ employeeId: 'd1', fullNameAr: 'سائق' }],
      slots: slots(['a'], ['b'], []),
    });
    expect(rows[1]).toMatchObject({ crewId: null, shiftTypeId: null, drivers: [] });
    expect(rows[2]).toMatchObject({
      vehicleId: null,
      vehicleCode: null,
      crewId: 'c-loose',
      shiftTypeId: 't-reserve',
      notes: 'انتظار',
    });
  });

  it('no answer yet is no rows; a colour this screen does not know reads as none', () => {
    expect(toPlanRows(undefined)).toEqual([]);
    // A newer server's colour is never turned into a class name: the row is simply untinted.
    const newer = {
      ...board,
      rows: [{ ...board.rows[0], crew: { ...board.rows[0]?.crew, rowColour: 'pink' } }],
    } as unknown as OperationsCrewBoardDto;
    expect(toPlanRows(newer)[0]).toMatchObject({ rowColour: null, shiftTypeId: 't-secured' });
  });
});

// ── The blue rule ───────────────────────────────────────────────────────────────────────────────

describe('crewRoleOf — green, BLUE, red', () => {
  it('«قائد» alone is a captain; «قائد» + «أخصائي» is BLUE; anything else a specialist', () => {
    expect(crewRoleOf(requirements({ isCaptain: true }))).toBe('captain');
    expect(crewRoleOf(requirements({ isCaptain: true, isSpecialist: true }))).toBe('dual');
    expect(crewRoleOf(requirements({ isSpecialist: true }))).toBe('specialist');
    expect(crewRoleOf(requirements({}))).toBe('specialist');
    expect(crewRoleOf(null)).toBe('specialist');
  });

  it('puts the blue in القادة, and marks — never refuses — a seat outside the role', () => {
    expect(planPoolOf(member('1', { isCaptain: true, isSpecialist: true }))).toBe('captains');
    expect(planPoolOf(member('2', { isSpecialist: true }))).toBe('specialists');
    expect(outOfRole('specialist', 'captain')).toBe(true);
    expect(outOfRole('captain', 'specialist1')).toBe(true);
    expect(outOfRole('dual', 'captain')).toBe(false);
    expect(outOfRole('dual', 'specialist2')).toBe(false);
  });

  it('lists the requirement icons in the requirements screen order', () => {
    expect(
      flagsOf(
        member('1', {
          isPriority: true,
          hasWeapon: true,
          hasTemporaryLicense: true,
          isCaptain: true,
        }),
      ),
    ).toEqual(['hasWeapon', 'hasTemporaryLicense', 'isPriority']);
  });

  it('shows EVERY recorded requirement but the two the colour says — «موظف عمليات» included', () => {
    expect(PLAN_FLAGS).toEqual(
      REQUIREMENT_FLAGS.filter((flag) => flag !== 'isCaptain' && flag !== 'isSpecialist'),
    );
    expect(flagsOf(member('1', { isSpecialist: true, isOpsAdmin: true }))).toEqual(['isOpsAdmin']);
  });
});

// ── Moving people ───────────────────────────────────────────────────────────────────────────────

describe('placeMember — drop on a slot', () => {
  it('MOVES a person already on the board: off the old row and slot in the same step', () => {
    const rows = [van('213', { slots: slots(['a'], ['b']) }), van('248')];
    const next = placeMember(rows, 'van:v-248', 'captain', 'b');
    expect(next[0]?.slots).toEqual(slots(['a'], [], []));
    expect(next[1]?.slots).toEqual(slots(['b']));
    expect(seatOf(next, 'b')).toEqual({ key: 'van:v-248', slot: 'captain' });
  });

  it('REFUSES a full slot — nobody is pushed out — and returns the same rows', () => {
    const full = Array.from({ length: CREW_SLOT_CAPACITY }, (_, i) => `c${i}`);
    const rows = [van('213', { slots: slots(full) })];
    expect(slotRefusal(rows, 'van:v-213', 'captain', 'z')).toBe('full');
    expect(placeMember(rows, 'van:v-213', 'captain', 'z')).toBe(rows);
  });

  it('a drop on the slot one already sits in is nothing to do', () => {
    const rows = [van('213', { slots: slots(['a']) })];
    expect(slotRefusal(rows, 'van:v-213', 'captain', 'a')).toBe('here');
    expect(placeMember(rows, 'van:v-213', 'captain', 'a')).toBe(rows);
  });

  it('moves within a row, from a specialist slot to the captain slot', () => {
    const rows = [van('213', { slots: slots([], ['a']) })];
    expect(placeMember(rows, 'van:v-213', 'captain', 'a')[0]?.slots).toEqual(slots(['a'], [], []));
  });

  it('freeMember takes them off the board entirely', () => {
    const rows = [van('213', { slots: slots(['a'], ['b']) })];
    expect(freeMember(rows, 'a')[0]?.slots).toEqual(slots([], ['b'], []));
  });
});

describe('the limits — 1–2 captains, 2–4 specialists', () => {
  it('says the limits the owner gave', () => {
    expect(CREW_LIMITS).toEqual({ captains: { min: 1, max: 2 }, specialists: { min: 2, max: 4 } });
  });

  it('warns only on a crewed row that is short', () => {
    expect(crewShortfall(van('1'))).toBeNull();
    expect(crewShortfall(van('1', { slots: slots(['a'], ['b'], ['c']) }))).toBeNull();
    expect(crewShortfall(van('1', { slots: slots(['a'], ['b', 'c']) }))).toBeNull();
    expect(crewShortfall(van('1', { slots: slots([], ['b'], ['c']) }))).toEqual({
      captains: 1,
      specialists: 0,
    });
    expect(crewShortfall(van('1', { slots: slots(['a'], ['b']) }))).toEqual({
      captains: 0,
      specialists: 1,
    });
    expect(crewShortfall(van('1', { slots: slots(['a']) }))).toEqual({
      captains: 0,
      specialists: 2,
    });
  });
});

// ── The row ─────────────────────────────────────────────────────────────────────────────────────

describe('the row: its fields, its bin, a row without a van', () => {
  it('stores a blank text as null', () => {
    const next = patchRow([van('1', { notes: 'x' })], 'van:v-1', {
      notes: '   ',
      shiftTypeId: 't-daily',
      rowColour: 'red',
    });
    expect(next[0]).toMatchObject({ notes: null, shiftTypeId: 't-daily', rowColour: 'red' });
  });

  it('the bin deletes a vehicle-less row but only EMPTIES a van row', () => {
    const rows = [
      van('1', { slots: slots(['a']), direction: 'x', rowColour: 'red' }),
      vehiclelessRow(1),
    ];
    const emptied = discardRow(rows, 'van:v-1');
    expect(emptied).toHaveLength(2);
    expect(isBlankRow(emptied[0] as PlanRow)).toBe(true);
    expect(discardRow(rows, 'new:1').map((row) => row.key)).toEqual(['van:v-1']);
  });

  it('a vehicle-less row takes a BLANK van later — the van row takes everything, the row goes', () => {
    const loose = {
      ...vehiclelessRow(1),
      slots: slots(['a'], ['b']),
      shiftTypeId: 't-reserve',
      notes: 'n',
    };
    const rows = [van('1', { slots: slots(['z']) }), van('2'), loose];
    expect(vansFree(rows).map((row) => row.key)).toEqual(['van:v-2']);
    const next = attachVan(rows, 'new:1', 'van:v-2');
    expect(next.map((row) => row.key)).toEqual(['van:v-1', 'van:v-2']);
    expect(next[1]).toMatchObject({
      vehicleId: 'v-2',
      slots: slots(['a'], ['b']),
      shiftTypeId: 't-reserve',
      notes: 'n',
    });
    // A van somebody planned on is not overwritten by a pick.
    expect(attachVan(rows, 'new:1', 'van:v-1')).toBe(rows);
  });
});

describe('the type: the strip and the filter follow «أنواع التشغيل»', () => {
  const rows = [
    van('1', { shiftTypeId: 't-daily' }),
    van('2', { shiftTypeId: 't-daily' }),
    van('3', { shiftTypeId: 't-secured' }),
    van('4'),
    van('5', { shiftTypeId: 't-aswan' }),
    van('6', { shiftTypeId: 't-not-listed' }),
  ];
  it('a chip per ACTIVE type in the catalog order, a zero kept; an archived type only while held', () => {
    const strip = shiftTypeStrip(CATALOG, rows);
    expect(strip.total).toBe(6);
    expect(strip.none).toBe(1);
    expect(strip.chips.map((chip) => [chip.type.id, chip.count])).toEqual([
      ['t-daily', 2],
      ['t-reserve', 0],
      ['t-aswan', 1],
      ['t-secured', 1],
    ]);
    // Nobody on «أسوان» any more: an archived type drops off the strip.
    const released = shiftTypeStrip(CATALOG, rows.slice(0, 4));
    expect(released.chips.map((chip) => chip.type.id)).toEqual([
      't-daily',
      't-reserve',
      't-secured',
    ]);
    // The catalog not read yet: the total alone, never a chip the screen cannot name.
    expect(shiftTypeStrip([], rows)).toEqual({ total: 6, none: 1, chips: [] });
  });
  it('filters by one type, by none yet, or not at all', () => {
    expect(rows.filter((row) => matchesShiftType(row, 't-daily'))).toHaveLength(2);
    expect(rows.filter((row) => matchesShiftType(row, NO_SHIFT_TYPE))).toHaveLength(1);
    expect(rows.filter((row) => matchesShiftType(row, ''))).toHaveLength(6);
  });
  it('a row is offered the active types in order, plus the archived one it already holds', () => {
    expect(shiftTypeChoices(CATALOG, null).map((type) => type.id)).toEqual([
      't-daily',
      't-reserve',
      't-secured',
    ]);
    // Held since before it was archived: still named, in its place — the save keeps it.
    expect(shiftTypeChoices(CATALOG, 't-aswan').map((type) => type.id)).toEqual([
      't-daily',
      't-reserve',
      't-aswan',
      't-secured',
    ]);
  });
  it('asks for the whole catalog, archived included, in its own order — the tab’s cache entry', () => {
    // No `sortBy` (the server's default IS the dragged order) and no `isActive` (a row's archived
    // type must still be named).
    expect(SHIFT_TYPE_LIST).toEqual({ page: 1, pageSize: MAX_PAGE_SIZE });
  });
});

describe('parseClock — what an operator types', () => {
  it.each([
    ['8', '08:00'],
    ['08', '08:00'],
    ['830', '08:30'],
    ['0830', '08:30'],
    ['8:30', '08:30'],
    ['8.30', '08:30'],
    ['٨:٣٠', '08:30'],
    ['23:59', '23:59'],
  ])('%s → %s', (typed, time) => expect(parseClock(typed)).toBe(time));
  it('a blank box is no time; nonsense is not a time', () => {
    expect(parseClock('  ')).toBeNull();
    expect(parseClock('24:00')).toBeUndefined();
    expect(parseClock('8:75')).toBeUndefined();
    expect(parseClock('صباحًا')).toBeUndefined();
  });
});

// ── The pools ───────────────────────────────────────────────────────────────────────────────────

describe('listPool — free first, the placed after them, search folded, icons AND', () => {
  const members = [
    member('1', { isCaptain: true, hasWeapon: true }, 'أحمد سيد'),
    member(
      '2',
      { isCaptain: true, isSpecialist: true, hasWeapon: true, hasLicense: true },
      'محمد طارق',
    ),
    member('3', { isCaptain: true }, 'وليد عادل'),
    member('4', { isSpecialist: true }, 'اسلام مسعد'),
  ];
  const rows = [van('1', { slots: slots(['1']) })];

  it('lists the captains pool with the placed one last, and counts the free', () => {
    const pool = listPool(members, 'captains', rows, { search: '', flags: [] });
    expect(pool.listed.map((m) => m.employeeId)).toEqual(['2', '3', '1']);
    expect(pool).toMatchObject({ total: 3, free: 2 });
  });

  it('finds «أحمد» by «احمد», a code by its digits, and narrows by every icon ticked', () => {
    expect(
      listPool(members, 'captains', [], { search: 'احمد', flags: [] }).listed.map(
        (m) => m.employeeId,
      ),
    ).toEqual(['1']);
    expect(listPool(members, 'specialists', [], { search: '04', flags: [] }).listed).toHaveLength(
      1,
    );
    expect(
      listPool(members, 'captains', [], {
        search: '',
        flags: ['hasWeapon', 'hasLicense'],
      }).listed.map((m) => m.employeeId),
    ).toEqual(['2']);
  });
});

// ── The standing crew ───────────────────────────────────────────────────────────────────────────

describe('the standing crew on this board', () => {
  it('fills a blank van only, never twice, and off again empties exactly those', () => {
    const rows = [
      van('1'),
      van('2', { slots: slots(['x']) }),
      { ...vehiclelessRow(1), slots: slots(['b']) },
    ];
    const load = loadStandingIntoPlan(rows, [
      {
        vehicleId: 'v-1',
        captainEmployeeIds: ['a'],
        specialist1EmployeeIds: ['b'],
        specialist2EmployeeIds: ['c'],
      },
      {
        vehicleId: 'v-2',
        captainEmployeeIds: ['d'],
        specialist1EmployeeIds: [],
        specialist2EmployeeIds: [],
      },
      {
        vehicleId: 'v-9',
        captainEmployeeIds: ['e'],
        specialist1EmployeeIds: [],
        specialist2EmployeeIds: [],
      },
    ]);
    // «b» already sits on the vehicle-less row: not copied onto van 1.
    expect(load.rows[0]?.slots).toEqual(slots(['a'], [], ['c']));
    expect(load.rows[1]?.slots).toEqual(slots(['x']));
    expect(load.filledKeys).toEqual(['van:v-1']);
    expect(load.unavailable).toBe(1);
    expect(clearStandingFromPlan(load.rows, load.filledKeys)[0]?.slots).toEqual(slots([]));
  });
});

// ── The save ────────────────────────────────────────────────────────────────────────────────────

describe('planChanges + toPlan — the save body', () => {
  const original = [
    van('1', { crewId: 'c1', slots: slots(['a']), shiftTypeId: 't-daily' }),
    van('2'),
    { ...vehiclelessRow(0), key: 'loose:c-l', crewId: 'c-l', slots: slots(['b']) },
  ];

  it('sends only what changed, a new vehicle-less row only once it holds something', () => {
    expect(changeCount(planChanges(original, original))).toBe(0);
    const blankAdded = [...original, vehiclelessRow(1)];
    expect(changeCount(planChanges(blankAdded, original))).toBe(0);
    const coloured = patchRow(original, 'van:v-1', { rowColour: 'green' });
    expect(planChanges(coloured, original).changed.map((row) => row.key)).toEqual(['van:v-1']);
  });

  it('carries the type, the colour and the vehicle-less rows — and the saved one deleted', () => {
    let next = patchRow(original, 'van:v-1', { rowColour: 'blue' });
    next = discardRow(next, 'loose:c-l');
    next = [...next, { ...vehiclelessRow(2), slots: slots(['z']), shiftTypeId: 't-secured' }];
    const body = toPlan('2026-11-16', planChanges(next, original));
    expect(body.date.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(body.removeCrewAssignmentIds).toEqual(['c-l']);
    expect(body.rows).toEqual([
      expect.objectContaining({
        vehicleId: 'v-1',
        captainEmployeeIds: ['a'],
        shiftTypeId: 't-daily',
        rowColour: 'blue',
      }),
      expect.objectContaining({
        vehicleId: null,
        captainEmployeeIds: ['z'],
        shiftTypeId: 't-secured',
      }),
    ]);
    expect(body.rows[1]).not.toHaveProperty('crewAssignmentId');
  });

  it('addresses an edited SAVED vehicle-less row by its id', () => {
    const next = patchRow(original, 'loose:c-l', { notes: 'x' });
    expect(toPlan('2026-11-16', planChanges(next, original)).rows[0]).toMatchObject({
      vehicleId: null,
      crewAssignmentId: 'c-l',
      notes: 'x',
    });
  });
});

// ── The real save ──────────────────────────────────────────────────────────────────────────────

describe('toPlan — a body `PlanOperationsCrewSchema` itself takes', () => {
  // Real ids, as the wire carries them: the schema checks every id is an ObjectId.
  const id = (n: number): string => n.toString(16).padStart(24, 'a');
  const [vanA, vanB, loose, captain, specialist, other, type] = [1, 2, 3, 4, 5, 6, 7].map(id);
  const original: PlanRow[] = [
    {
      ...van('A'),
      key: `van:${vanA}`,
      vehicleId: vanA ?? null,
      crewId: id(10),
      slots: slots([other as string]),
      direction: 'الجيزة',
    },
    { ...van('B'), key: `van:${vanB}`, vehicleId: vanB ?? null },
    {
      ...vehiclelessRow(0),
      key: `loose:${loose}`,
      crewId: loose ?? null,
      slots: slots([captain as string], [specialist as string]),
      direction: 'المعادي',
      shiftTypeId: type ?? null,
      rowColour: 'green',
    },
  ];

  it('gives a saved row without a van a van: the van’s row, and the old row removed — one save', () => {
    const next = attachVan(original, `loose:${loose}`, `van:${vanB}`);
    const body = toPlan('2026-11-16', planChanges(next, original));
    expect(body.removeCrewAssignmentIds).toEqual([loose]);
    expect(body.rows).toEqual([
      {
        vehicleId: vanB,
        captainEmployeeIds: [captain],
        specialist1EmployeeIds: [specialist],
        specialist2EmployeeIds: [],
        direction: 'المعادي',
        plannedTime: null,
        notes: null,
        shiftTypeId: type,
        rowColour: 'green',
      },
    ]);
    const parsed = PlanOperationsCrewSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('an emptied van, an edited saved row and a new one — whole rows, no removal key when none', () => {
    // The van's captain is freed by the bin and taken by the new row: one end state, judged as one.
    let next = patchRow(original, `loose:${loose}`, { notes: 'بانتظار السيارة' });
    next = discardRow(next, `van:${vanA}`);
    next = [...next, { ...vehiclelessRow(1), slots: slots([other as string]) }];
    const body = toPlan('2026-11-16', planChanges(next, original));
    expect(body).not.toHaveProperty('removeCrewAssignmentIds');
    expect(body.rows.map((row) => [row.vehicleId, row.crewAssignmentId])).toEqual([
      [vanA, undefined],
      [null, loose],
      [null, undefined],
    ]);
    // A van's row never carries a crew id — the schema refuses a second address for it.
    expect(body.rows[0]).not.toHaveProperty('crewAssignmentId');
    const parsed = PlanOperationsCrewSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('deleting the saved row alone is a save of its own — a removal and no rows', () => {
    const body = toPlan(
      '2026-11-16',
      planChanges(discardRow(original, `loose:${loose}`), original),
    );
    expect(body).toMatchObject({ rows: [], removeCrewAssignmentIds: [loose] });
    expect(PlanOperationsCrewSchema.safeParse(body).success).toBe(true);
  });
});

describe('planRefusal — the refused save, on the row it names', () => {
  const sent = [van('1'), { ...vehiclelessRow(3), direction: 'مكان ما' }];

  it('places a direction that is not an area on its row, with the parts refused', () => {
    expect(
      planRefusal(
        {
          code: 'OPERATIONS_DIRECTION_NOT_AN_AREA',
          details: [
            { field: 'direction', code: 'NOT_AN_AREA', message: 'مكان ما' },
            { field: 'rows', code: 'ROW_INDEX', message: '1' },
          ],
        },
        sent,
      ),
    ).toEqual({ key: 'new:3', field: 'direction', parts: ['مكان ما'] });
  });

  it('places an archived type on its row', () => {
    expect(
      planRefusal(
        {
          code: 'OPERATIONS_UNKNOWN_SHIFT_TYPE',
          details: [
            { field: 'shiftTypeId', code: 'SHIFT_TYPE', message: 't-aswan' },
            { field: 'rows', code: 'ROW_INDEX', message: '0' },
          ],
        },
        sent,
      ),
    ).toEqual({ key: 'van:v-1', field: 'type', parts: [] });
  });

  it('places nothing it cannot name — another refusal, or an index off the save', () => {
    expect(planRefusal({ code: 'CONFLICT', details: [] }, sent)).toBeNull();
    expect(
      planRefusal(
        {
          code: 'OPERATIONS_UNKNOWN_SHIFT_TYPE',
          details: [{ field: 'rows', code: 'ROW_INDEX', message: '7' }],
        },
        sent,
      ),
    ).toBeNull();
    expect(planRefusal(undefined, sent)).toBeNull();
  });
});

// The board owns its save's errors (`usePlanOperationsCrew`'s `onError`), so the global notifier is
// quiet and the page's toast is the ONLY message. «Someone may already be assigned elsewhere» is
// true of a Q11 clash alone; a dropped network or a van Fleet took off the day's roster said that
// way would send the planner hunting for a double booking that is not there.
describe('isCrewClash — which refusal the plan’s own sentence is true of', () => {
  it('a Q11 clash (409 DUPLICATE) — and nothing else', () => {
    expect(isCrewClash(new ApiError('DUPLICATE', 'employee x already holds … (Q11)', 409))).toBe(
      true,
    );
    for (const other of [
      new ApiError('STALE_DOCUMENT', 'modified', 409),
      new ApiError('NOT_FOUND', 'crew row is not a live row of this day', 404),
      new ApiError('OPERATIONS_FLEET_DUTY_REQUIRED', 'not on the Fleet roster', 422),
      new ApiError('FORBIDDEN', 'no', 403),
      new TypeError('Failed to fetch'),
      undefined,
    ]) {
      expect(isCrewClash(other), String(other)).toBe(false);
    }
  });
});

// «لازم اختار من الاتجاهات اللى موجوده» — the save holds a new direction to EVERY active area, so the
// picker must know every one: a list cut at the server's page cap left an area past the hundredth
// impossible to pick, and marked a direction naming it «not an area».
describe('activeAreaNames — the direction list is the whole catalog, not one page', () => {
  it('reads every page of the active areas, by name', async () => {
    const areas = Array.from({ length: 230 }, (_, at) => ({
      id: `a-${at}`,
      name: `منطقة ${at}`,
      nameEn: null,
      governorate: null,
      isActive: at !== 7,
      version: 0,
      createdAt: '',
      updatedAt: '',
    }));
    const asked: Record<string, unknown>[] = [];
    const names = await activeAreaNames(async (params) => {
      asked.push(params);
      const page = Number(params.page);
      const pageSize = Number(params.pageSize);
      return {
        items: areas.slice((page - 1) * pageSize, page * pageSize),
        meta: { page, pageSize, totalItems: areas.length, totalPages: Math.ceil(230 / pageSize) },
      };
    });
    expect(asked).toHaveLength(3);
    expect(asked.every((params) => params.isActive === true)).toBe(true);
    expect(names).toHaveLength(229);
    expect(names).toContain('منطقة 229');
    expect(names).not.toContain('منطقة 7');
  });

  it('is what the board reads its directions from', () => {
    const page = readFileSync(
      fileURLToPath(new URL('../pages/CrewBoardPage.tsx', import.meta.url)),
      'utf8',
    );
    expect(page).toContain('useActiveOperationsAreaNames()');
    expect(page).not.toContain('useOperationsAreas(');
  });
});

// ── The van card and the file ───────────────────────────────────────────────────────────────────

describe('the van card and the Excel sheet read the DRAFT', () => {
  const members = new Map([['a', member('a', { isCaptain: true }, 'أحمد')]]);
  const row = van('213', {
    crewId: 'c1',
    drivers: [{ employeeId: 'd', fullNameAr: 'سائق' }],
    slots: slots(['a'], ['gone']),
    direction: 'المعادي',
    plannedTime: '08:00',
    shiftTypeId: 't-daily',
  });

  it('builds the round-4 card from the row as it stands now', () => {
    const card = planRowCard(row, (id) => members.get(id));
    expect(card).toMatchObject({
      crewAssignmentId: 'c1',
      vehicleCode: '213',
      drivers: [{ employeeId: 'd', fullNameAr: 'سائق' }],
      captains: [{ employeeId: 'a', code: '0a', fullNameAr: 'أحمد' }],
      specialist1: [{ employeeId: 'gone', code: null, fullNameAr: null }],
      direction: 'المعادي',
      plannedTime: '08:00',
    });
  });

  it('writes the table on screen, in Arabic, a person no longer on the roster as «—»', () => {
    const t = (key: string, params?: Record<string, string | number>): string =>
      translate('ar', key, params);
    const sheet = crewPlanSheet(
      t,
      [row, vehiclelessRow(1)],
      (id) => members.get(id),
      (id) => CATALOG.find((type) => type.id === id)?.name ?? '—',
    );
    expect(sheet.header).toEqual([
      'السيارة',
      'قائد الطاقم',
      'أخصائي 1',
      'أخصائي 2',
      'الاتجاه',
      'التوقيت',
      'النوع',
      'ملاحظات',
    ]);
    expect(sheet.rows[0]).toEqual(['213', 'أحمد', '—', '', 'المعادي', '08:00', 'يومي', '']);
    expect(sheet.rows[1]?.[0]).toBe('بدون سيارة');
  });
});
