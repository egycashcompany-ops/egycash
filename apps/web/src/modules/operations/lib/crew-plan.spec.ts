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
  CREW_SLOTS,
  PLAN_FLAGS,
  attachVan,
  awayOf,
  changeCount,
  clearStandingFromPlan,
  crewRoleOf,
  crewShortfall,
  fitsCrewSlot,
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
  parseClock,
  patchRow,
  placeMember,
  planChanges,
  planPoolOf,
  planRefusal,
  planRowCard,
  rowMisfits,
  seatOf,
  shiftTypeChoices,
  shiftTypeStrip,
  slotRefusal,
  standingForDay,
  toPlan,
  toPlanRows,
  vansFree,
  vehiclelessRow,
  wrongSlotOf,
  type PlanRow,
} from './crew-plan';
import * as contracts from '@ecms/contracts';
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

  it('puts the blue in القادة — only there — and the red, and nobody ticked, in الأخصائيون', () => {
    expect(planPoolOf(member('1', { isCaptain: true, isSpecialist: true }))).toBe('captains');
    expect(planPoolOf(member('2', { isSpecialist: true }))).toBe('specialists');
    expect(planPoolOf(member('3', {}))).toBe('specialists');
    expect(planPoolOf(member('4', null))).toBe('specialists');
  });

  // Round 23 — «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى».
  it('is the contracts’ own role, so the board and the save cannot disagree', () => {
    expect(crewRoleOf).toBe(contracts.crewRoleOf);
    expect(fitsCrewSlot).toBe(contracts.fitsCrewSlot);
    expect([...CREW_SLOTS]).toEqual([...contracts.OPERATIONS_CREW_SLOTS]);
  });

  it('says why a slot will not take a role — a refusal now, in the save’s own two words', () => {
    expect(wrongSlotOf('specialist', 'captain')).toBe('notCaptain');
    expect(wrongSlotOf('captain', 'specialist1')).toBe('notSpecialist');
    expect(wrongSlotOf('captain', 'specialist2')).toBe('notSpecialist');
    expect(wrongSlotOf('captain', 'captain')).toBeNull();
    expect(wrongSlotOf('specialist', 'specialist2')).toBeNull();
    for (const slot of CREW_SLOTS) expect(wrongSlotOf('dual', slot)).toBeNull();
  });

  it('finds the seats held outside their role on a row — by who, where and why', () => {
    const roles: Record<string, 'captain' | 'dual' | 'specialist'> = {
      c: 'captain',
      d: 'dual',
      s: 'specialist',
    };
    const row = van('1', { slots: slots(['c', 's'], ['d', 'c2'], ['s2']) });
    expect(rowMisfits(row, (employeeId) => roles[employeeId.slice(0, 1)] ?? 'specialist')).toEqual([
      { employeeId: 's', slot: 'captain', why: 'notCaptain' },
      { employeeId: 'c2', slot: 'specialist1', why: 'notSpecialist' },
    ]);
    expect(
      rowMisfits(
        van('2', { slots: slots(['c'], ['d'], ['s']) }),
        (id) => roles[id] ?? 'specialist',
      ),
    ).toEqual([]);
    // Somebody whose role the board cannot read (off the roster) is not judged: the save is.
    expect(rowMisfits(van('3', { slots: slots(['gone']) }), () => null)).toEqual([]);
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

describe('listPool — free first, the placed after them, the BLUE after the green, search folded, icons AND', () => {
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
    // «3» green and free, «2» BLUE and free, «1» on van 1.
    expect(pool.listed.map((m) => m.employeeId)).toEqual(['3', '2', '1']);
    expect(pool).toMatchObject({ total: 3, free: 2 });
  });

  // Round 22 — «وعاوز القادة اللى فى نفس الوقت اخصائيين يكونوا فى الاخر».
  it('puts the BLUE captains after the green — among the free, and again among the placed', () => {
    const green = (id: string) => member(id, { isCaptain: true });
    const blue = (id: string) => member(id, { isCaptain: true, isSpecialist: true });
    // The server's order, blue and green mixed, two of each kind already on a row.
    const roster = [blue('b1'), green('g1'), blue('b2'), green('g2'), blue('b3'), green('g3')];
    roster.push(green('g4'), blue('b4'));
    const onRows = [van('9', { slots: slots(['b2', 'g3'], ['b4'], ['g1']) })];
    const pool = listPool(roster, 'captains', onRows, { search: '', flags: [] });
    const free = ['g2', 'g4', 'b1', 'b3']; // free green, then free blue — the server's order in each
    const placed = ['g1', 'g3', 'b2', 'b4']; // placed green, then placed blue
    expect(pool.listed.map((m) => m.employeeId)).toEqual([...free, ...placed]);
    expect(pool).toMatchObject({ total: 8, free: 4 });
    // The colours the chips are drawn in follow the same order.
    expect(pool.listed.map((m) => crewRoleOf(m.requirements)).join(' ')).toBe(
      'captain captain dual dual captain captain dual dual',
    );
  });

  // Round 23 — «لو قائد واخصائى يبقى فى القايمة بتاعت القائد بس يكونوا فى الاخر».
  it('lists a captain-specialist in «القادة» ONLY, at its end — and never among «الأخصائيون»', () => {
    const blue = (id: string) => member(id, { isCaptain: true, isSpecialist: true });
    const roster = [
      blue('b1'),
      member('s1', { isSpecialist: true }),
      member('g1', { isCaptain: true }),
      blue('b2'),
      member('s2', null),
      member('g2', { isCaptain: true }),
    ];
    expect(
      listPool(roster, 'captains', [], { search: '', flags: [] }).listed.map((m) => m.employeeId),
    ).toEqual(['g1', 'g2', 'b1', 'b2']);
    const specialists = listPool(roster, 'specialists', [], { search: '', flags: [] });
    expect(specialists.listed.map((m) => m.employeeId)).toEqual(['s1', 's2']);
    expect(specialists.total).toBe(2);
    expect(specialists.listed.some((m) => crewRoleOf(m.requirements) === 'dual')).toBe(false);
  });

  it('keeps the order a search or an icon leaves, and leaves «الأخصائيون» in the server’s order', () => {
    const roster = [
      member('b1', { isCaptain: true, isSpecialist: true, hasWeapon: true }, 'محمد طارق'),
      member('g1', { isCaptain: true, hasWeapon: true }, 'محمد سيد'),
      member('s2', { isSpecialist: true }, 'محمد علي'),
      member('s1', { isSpecialist: true, hasWeapon: true }, 'محمد ذكي'),
      member('s3', null, 'محمد عبده'),
    ];
    expect(
      listPool(roster, 'captains', [], { search: 'محمد', flags: ['hasWeapon'] }).listed.map(
        (m) => m.employeeId,
      ),
    ).toEqual(['g1', 'b1']);
    expect(
      listPool(roster, 'specialists', [van('1', { slots: slots([], ['s2']) })], {
        search: '',
        flags: [],
      }).listed.map((m) => m.employeeId),
    ).toEqual(['s1', 's3', 's2']);
  });

  // Round 22 F — «وعاوز لو القائد غايب يظهر تحت الكل بقى فى الاخر يبقى باللون الباهت … و كذلك الاخصائيين».
  it('sends somebody AWAY that day to the very end — after the placed ones — and out of «متاح»', () => {
    const away = (m: OperationsCrewMemberDto, availability: 'absent' | 'onLeave') =>
      ({ ...m, availability }) as OperationsCrewMemberDto;
    const green = (id: string) => member(id, { isCaptain: true });
    const blue = (id: string) => member(id, { isCaptain: true, isSpecialist: true });
    // The server's order, mixed: away ones first in it, one of them already on a row.
    const roster = [
      away(green('ga'), 'absent'),
      blue('b1'),
      away(blue('ba'), 'onLeave'),
      green('g1'),
      away(green('gp'), 'onLeave'),
      green('g2'),
      blue('b2'),
    ];
    const onRows = [van('7', { slots: slots(['gp', 'g2'], ['b2']) })];
    const pool = listPool(roster, 'captains', onRows, { search: '', flags: [] });
    // Free green, free blue | placed green, placed blue | away: free green, free blue, placed green.
    expect(pool.listed.map((m) => m.employeeId)).toEqual([
      'g1',
      'b1',
      'g2',
      'b2',
      'ga',
      'ba',
      'gp',
    ]);
    // «متاح N» is who can be put on a row now: none of the placed, none of the away.
    expect(pool).toMatchObject({ total: 7, free: 2 });
    // «و كذلك الاخصائيين» — the same tail in «الأخصائيون», the server's order kept inside it.
    const reds = [
      away(member('s1', { isSpecialist: true }), 'absent'),
      member('s2', { isSpecialist: true }),
      member('s3', null),
    ];
    expect(
      listPool(reds, 'specialists', [], { search: '', flags: [] }).listed.map((m) => m.employeeId),
    ).toEqual(['s2', 's3', 's1']);
  });

  it('reads away only from HR’s two answers — an unknown, or a server without the field, is not away', () => {
    const base = member('1', { isCaptain: true });
    expect(awayOf({ ...base, availability: 'absent' })).toBe('absent');
    expect(awayOf({ ...base, availability: 'onLeave' })).toBe('onLeave');
    expect(awayOf({ ...base, availability: null })).toBeNull();
    expect(awayOf(base)).toBeNull();
    expect(awayOf(undefined)).toBeNull();
    // A word a newer server may add is not read as «away» before this screen knows it.
    expect(awayOf({ ...base, availability: 'sick' as never })).toBeNull();
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

  // Round 22 F and Round 23 — what the day may take of the standing crew, before it is loaded.
  it('leaves off somebody away that day, and somebody whose standing seat is not his role’s — named, not loaded', () => {
    const away = (m: OperationsCrewMemberDto) =>
      ({ ...m, availability: 'absent' }) as OperationsCrewMemberDto;
    const roster = new Map(
      [
        member('cap', { isCaptain: true }),
        member('blue', { isCaptain: true, isSpecialist: true }),
        member('red', { isSpecialist: true }),
        member('capInSpec', { isCaptain: true }),
        member('redInCap', { isSpecialist: true }),
        away(member('gone', { isCaptain: true })),
      ].map((m) => [m.employeeId, m]),
    );
    const day = standingForDay(
      [
        {
          vehicleId: 'v-1',
          captainEmployeeIds: ['cap', 'redInCap'],
          specialist1EmployeeIds: ['blue', 'capInSpec'],
          specialist2EmployeeIds: ['red'],
        },
        {
          vehicleId: 'v-2',
          captainEmployeeIds: ['gone', 'nobody'],
          specialist1EmployeeIds: ['nobody2'],
          specialist2EmployeeIds: [],
        },
      ],
      (employeeId) => roster.get(employeeId),
    );
    expect(day.sources).toEqual([
      {
        vehicleId: 'v-1',
        captainEmployeeIds: ['cap'],
        specialist1EmployeeIds: ['blue'],
        specialist2EmployeeIds: ['red'],
      },
      // Somebody the roster no longer names: his requirements cannot be read here, so he is not
      // judged here — loaded as before, and the save (which reads them) decides.
      {
        vehicleId: 'v-2',
        captainEmployeeIds: ['nobody'],
        specialist1EmployeeIds: ['nobody2'],
        specialist2EmployeeIds: [],
      },
    ]);
    expect(day.away).toEqual(['gone']);
    expect(day.wrongSlot).toEqual([
      { employeeId: 'redInCap', slot: 'captain' },
      { employeeId: 'capInSpec', slot: 'specialist1' },
    ]);
    // Loaded, the van gets exactly what is left — nobody the save would refuse.
    const load = loadStandingIntoPlan([van('1'), van('2')], day.sources);
    expect(load.rows[0]?.slots).toEqual(slots(['cap'], ['blue'], ['red']));
    for (const row of load.rows) {
      expect(
        rowMisfits(row, (id) => {
          const known = roster.get(id);
          return known === undefined ? null : crewRoleOf(known.requirements);
        }),
      ).toEqual([]);
    }
  });

  it('the page loads through it, and says each kind left off in its own notice', () => {
    const page = readFileSync(
      fileURLToPath(new URL('../pages/CrewBoardPage.tsx', import.meta.url)),
      'utf8',
    );
    const toggle = page.slice(
      page.indexOf('const toggleStanding ='),
      page.indexOf('const giveVan ='),
    );
    expect(toggle).toContain('standingForDay(standingSources, memberOf)');
    expect(toggle).toContain('loadStandingIntoPlan(rows, day.sources)');
    expect(toggle).toContain("t('operations.crewPlan.standingAway')");
    expect(toggle).toContain("t('operations.crewPlan.standingWrongSlot')");
    expect(translate('ar', 'operations.crewPlan.standingWrongSlot')).toContain('الطاقم الثابت');
    // A row holding such a seat is given no van: on the van's row it would be a new seat.
    const giveVan = page.slice(
      page.indexOf('const giveVan ='),
      page.indexOf('const exportExcel ='),
    );
    expect(giveVan).toContain('rowMisfits(row, (employeeId) =>');
    expect(giveVan).toContain('byId.has(employeeId) ? roleOf(employeeId) : null');
    expect(giveVan).toContain("t('operations.crewPlan.vanWrongSlot')");
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

  // Round 22 F — `OPERATIONS_CREW_MEMBER_ABSENT`: the server names the person and the row.
  it('places somebody away that day on his row, by name and why — absent, or on leave', () => {
    const rows = [van('1'), van('2', { slots: slots(['e-9'], ['e-7']) })];
    const refused = (code: string, employeeId: string, index: string) =>
      planRefusal(
        {
          code: 'OPERATIONS_CREW_MEMBER_ABSENT',
          details: [
            { field: 'employeeId', code, message: employeeId },
            { field: 'rows', code: 'ROW_INDEX', message: index },
          ],
        },
        rows,
      );
    expect(refused('ABSENT', 'e-7', '1')).toEqual({
      key: 'van:v-2',
      field: 'crew',
      parts: [],
      person: { employeeId: 'e-7', reason: 'absent' },
    });
    expect(refused('ON_LEAVE', 'e-9', '1')?.person).toEqual({
      employeeId: 'e-9',
      reason: 'onLeave',
    });
    // A person the row does not hold, or a reason this screen does not know: the row, unnamed.
    expect(refused('ABSENT', 'e-1', '1')).toEqual({ key: 'van:v-2', field: 'crew', parts: [] });
    expect(refused('SICK', 'e-7', '1')).toEqual({ key: 'van:v-2', field: 'crew', parts: [] });
    expect(refused('ABSENT', 'e-7', '5')).toBeNull();
  });

  // Round 23 — `OPERATIONS_CREW_MEMBER_WRONG_SLOT`: the same shape — who, and which way.
  it('places somebody in a slot not his role’s on his row — not a captain, or a captain only', () => {
    const rows = [van('1'), van('2', { slots: slots(['e-9'], ['e-7']) })];
    const refused = (code: string, employeeId: string, index: string) =>
      planRefusal(
        {
          code: 'OPERATIONS_CREW_MEMBER_WRONG_SLOT',
          details: [
            { field: 'employeeId', code, message: employeeId },
            { field: 'rows', code: 'ROW_INDEX', message: index },
          ],
        },
        rows,
      );
    expect(refused('NOT_A_CAPTAIN', 'e-9', '1')).toEqual({
      key: 'van:v-2',
      field: 'slot',
      parts: [],
      person: { employeeId: 'e-9', reason: 'notCaptain' },
    });
    expect(refused('NOT_A_SPECIALIST', 'e-7', '1')?.person).toEqual({
      employeeId: 'e-7',
      reason: 'notSpecialist',
    });
    // The away codes are not this refusal's, nor somebody the row does not hold: the row, unnamed.
    expect(refused('ABSENT', 'e-7', '1')).toEqual({ key: 'van:v-2', field: 'slot', parts: [] });
    expect(refused('NOT_A_CAPTAIN', 'e-1', '1')).toEqual({
      key: 'van:v-2',
      field: 'slot',
      parts: [],
    });
    expect(refused('NOT_A_CAPTAIN', 'e-9', '4')).toBeNull();
    // Said by name, in both languages; the server's code has words of its own.
    for (const locale of ['ar', 'en'] as const) {
      for (const why of ['notCaptain', 'notSpecialist']) {
        expect(translate(locale, `operations.crewPlan.refused.${why}`, { name: 'N' })).toContain(
          'N',
        );
      }
      expect(translate(locale, 'operations.crewPlan.refused.slot')).not.toContain('operations.');
    }
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
