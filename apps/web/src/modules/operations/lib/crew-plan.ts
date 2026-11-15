// «لوحة التشغيلة» — the day's crew plan as the owner asked for it after the legacy board, as pure
// state transitions (the page only draws them).
//
// «كل عربيه هيبقى عليه من 1 ل 2 قادة و من 2 ل 4 اخصائيين … وعاوز اقدر اضيف صف ميكونش ليه عربيه واضيف كل
// البيانات برضو … وعاوز زرار يبقى فى كذا لون اقدر الون به الصف».
//
// WHAT IS NEW AGAINST `crew-board.ts` (the card-position model the standing crew still uses):
//
//   · A ROW IS NOT A VAN. A row has a key of its own, and its van is optional: «إضافة صف بدون سيارة»
//     adds a crew with every field but the van, and a van can be picked for it later — one of the
//     day's vans nobody has crewed yet, whose row it then becomes.
//   · A SLOT IS ONE DROP TARGET, NOT ONE PER CARD. A slot holds up to CREW_SLOT_CAPACITY people and
//     a drop APPENDS; a full slot REFUSES the drop instead of silently pushing somebody out. So the
//     slots here are compact lists — there is no "which card did you aim at" to remember.
//   · THE ROW CARRIES ITS TYPE (النوع — يومي، احتياطي، …, a type of «أنواع التشغيل») AND ITS COLOUR
//     (the row's tint), the two fields the legacy table had and the crew row never stored.
//
// THE ONE RULE KEPT FROM BEFORE, AND WHY: a drop MOVES a person who is already on the board — off
// whatever row and slot held them — so the plan is always a valid end state (Q11: one person, one
// row per operating day), never one the server would refuse on save.
//
// ── THE CONTRACT (Round 20) ────────────────────────────────────────────────────────────────────────
// The board reads `OperationsCrewBoardDto` as the server sends it: each van's crew with its type
// (`shiftTypeId`) and its colour (`rowColour`), the van's drivers by name, the rows without a van
// (`vehiclelessRows`) and the vans in the workshop (`workshopVehicles`). The save is
// `PlanOperationsCrew`: the changed rows — a saved row without a van named by its
// `crewAssignmentId` — and `removeCrewAssignmentIds` for the saved ones deleted on screen.
//
// THE TYPE IS A CATALOG, NOT A LIST IN THE CODE. The owner approved the sample with one change to it:
// «انا عاوز النوع يكون بيضاف من البيانات المرجعيه» — so «النوع» is «أنواع التشغيل» on the reference
// screen, and a row holds a type's id. What a row may be GIVEN is the ACTIVE types, in the catalog's
// order; a type a row already holds stays on it and is still named after it is archived (the
// server's rule: only a NEWLY chosen type must be active). `shiftTypeChoices` and
// `shiftTypeStrip` are those two rules, for the picker and for the strip of counts.
import {
  CREW_SLOT_CAPACITY,
  MAX_PAGE_SIZE,
  OPERATIONS_CREW_ROW_COLOURS,
  asciiDigits,
  type ApiErrorDetail,
  type OperationsCrewAvailability,
  type OperationsCrewBoardCrewDto,
  type OperationsCrewBoardDto,
  type OperationsCrewMemberDto,
  type OperationsCrewRequirementsDto,
  type OperationsCrewRowColour,
  type OperationsDayBoardDriverDto,
  type OperationsDayBoardPersonDto,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsShiftTypeDto,
  type PlanOperationsCrew,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { foldIncludes } from '../../../shared/lib/fold';
import { CREW_SLOTS, SLOT_POSITIONS, type BoardRow, type CrewSlot } from './crew-board';
import { REQUIREMENT_FLAGS, type RequirementFlag } from './requirements';
import { loadStandingCrew, type StandingCrewSource } from './standing-load';

export { CREW_SLOTS, type CrewSlot };

/**
 * «أنواع التشغيل» as the board and the reference tab both ask for it: the WHOLE catalog on one page,
 * archived types included, in the catalog's own order (no `sortBy` — the server's default IS the
 * dragged order). One params object, so the two screens share one cache entry: a type dragged or
 * recoloured on the tab is what the board shows next.
 */
export const SHIFT_TYPE_LIST = { page: 1, pageSize: MAX_PAGE_SIZE } as const;

/** The row colours «زرار يبقى فى كذا لون» offers — the contract's six, plus none. */
export const CREW_ROW_COLOURS = OPERATIONS_CREW_ROW_COLOURS;
export type CrewRowColour = OperationsCrewRowColour;

/**
 * A colour as the board will draw it, or none. The contract types it already; this guards the
 * class maps (`ROW_TINT`, `SWATCH`) against a colour a NEWER server may add before this screen
 * knows it — read as «no colour», never as a class name built from the wire.
 */
const knownColour = (value: string | null): CrewRowColour | null =>
  value !== null && (CREW_ROW_COLOURS as readonly string[]).includes(value)
    ? (value as CrewRowColour)
    : null;

// ── The rows ───────────────────────────────────────────────────────────────────────────────────────

/** One row of the plan, as the board edits it. */
export interface PlanRow {
  /**
   * The row's own key: `van:<vehicleId>` for a van, `loose:<crew id>` for a saved vehicle-less row,
   * `new:<n>` for one added on screen. Stable across edits — the table keys on it.
   */
  key: string;
  /** Null — «بدون سيارة». */
  vehicleId: string | null;
  vehicleCode: string | null;
  /** The saved crew row's id: null for a van not crewed yet and for a row added on screen. */
  crewId: string | null;
  /** Fleet's two drivers, by name only — Fleet's facts, shown on the van's card, never edited. */
  drivers: OperationsDayBoardDriverDto[];
  /** Each slot's occupants, in the order they were placed — at most CREW_SLOT_CAPACITY. */
  slots: Record<CrewSlot, string[]>;
  direction: string | null;
  plannedTime: string | null;
  /** «النوع» — a type of the catalog, by id; null until somebody picks one («اختر»). */
  shiftTypeId: string | null;
  rowColour: CrewRowColour | null;
  notes: string | null;
}

/** The row's crew limits: 1–2 captains, 2–4 specialists («من 1 ل 2 قادة و من 2 ل 4 اخصائيين»). */
export const CREW_LIMITS = {
  captains: { min: 1, max: CREW_SLOT_CAPACITY },
  specialists: { min: 2, max: CREW_SLOT_CAPACITY * 2 },
} as const;

const capped = (list: readonly string[]): string[] => list.slice(0, CREW_SLOT_CAPACITY);

/** A crew row's own fields, as the page edits them. */
const crewFields = (
  crew: OperationsCrewBoardCrewDto | null,
): Pick<
  PlanRow,
  'slots' | 'direction' | 'plannedTime' | 'shiftTypeId' | 'rowColour' | 'notes'
> => ({
  slots: {
    captain: capped(crew?.captainEmployeeIds ?? []),
    specialist1: capped(crew?.specialist1EmployeeIds ?? []),
    specialist2: capped(crew?.specialist2EmployeeIds ?? []),
  },
  direction: crew?.direction ?? null,
  plannedTime: crew?.plannedTime ?? null,
  shiftTypeId: crew?.shiftTypeId ?? null,
  rowColour: knownColour(crew?.rowColour ?? null),
  notes: crew?.notes ?? null,
});

/**
 * The board as the server answered → the rows the page edits: the vans in the server's order,
 * then the rows without a van in the order they were added. No answer yet → no rows.
 */
export const toPlanRows = (board: OperationsCrewBoardDto | undefined): PlanRow[] =>
  board === undefined
    ? []
    : [
        ...board.rows.map((row): PlanRow => ({
          key: `van:${row.vehicleId}`,
          vehicleId: row.vehicleId,
          vehicleCode: row.vehicleCode,
          crewId: row.crew?.id ?? null,
          drivers: row.drivers,
          ...crewFields(row.crew),
        })),
        ...board.vehiclelessRows.map((crew): PlanRow => ({
          key: `loose:${crew.id}`,
          vehicleId: null,
          vehicleCode: null,
          crewId: crew.id,
          drivers: [],
          ...crewFields(crew),
        })),
      ];

/** Everyone on a row. */
export const rowPeople = (row: PlanRow): string[] => CREW_SLOTS.flatMap((slot) => row.slots[slot]);

/** Where somebody sits on the board, or null — a person is on one row at most (Q11). */
export const seatOf = (
  rows: readonly PlanRow[],
  employeeId: string,
): { key: string; slot: CrewSlot } | null => {
  for (const row of rows) {
    for (const slot of CREW_SLOTS) {
      if (row.slots[slot].includes(employeeId)) return { key: row.key, slot };
    }
  }
  return null;
};

/**
 * Why a slot will not take this person, or null when it will:
 *   · `here` — they already sit in this very slot (nothing to do);
 *   · `full` — the slot already holds CREW_SLOT_CAPACITY people. A drop never displaces anyone: the
 *     operator takes somebody out first, so nobody leaves a van without being moved on purpose.
 */
export const slotRefusal = (
  rows: readonly PlanRow[],
  key: string,
  slot: CrewSlot,
  employeeId: string,
): 'here' | 'full' | null => {
  const row = rows.find((candidate) => candidate.key === key);
  if (row === undefined) return 'full';
  if (row.slots[slot].includes(employeeId)) return 'here';
  return row.slots[slot].length >= CREW_SLOT_CAPACITY ? 'full' : null;
};

const without = (row: PlanRow, employeeId: string): PlanRow => {
  if (!rowPeople(row).includes(employeeId)) return row;
  return {
    ...row,
    slots: {
      captain: row.slots.captain.filter((id) => id !== employeeId),
      specialist1: row.slots.specialist1.filter((id) => id !== employeeId),
      specialist2: row.slots.specialist2.filter((id) => id !== employeeId),
    },
  };
};

/**
 * Put somebody in a slot — the drop, and the click on «ضع هنا». MOVES them: they leave whatever
 * row and slot held them in the same step. A refused slot (`slotRefusal`) returns the rows as they
 * were, the same array, so the caller can tell nothing happened.
 */
export const placeMember = (
  rows: readonly PlanRow[],
  key: string,
  slot: CrewSlot,
  employeeId: string,
): readonly PlanRow[] => {
  if (slotRefusal(rows, key, slot, employeeId) !== null) return rows;
  return rows.map((row) => {
    const next = without(row, employeeId);
    if (row.key !== key) return next;
    return { ...next, slots: { ...next.slots, [slot]: [...next.slots[slot], employeeId] } };
  });
};

/** Take somebody off the board — the chip's ✕, or a chip dragged back to a pool. */
export const freeMember = (rows: readonly PlanRow[], employeeId: string): PlanRow[] =>
  rows.map((row) => without(row, employeeId));

/** The row's own fields — everything but the crew and the van. */
export type PlanRowPatch = Partial<
  Pick<PlanRow, 'direction' | 'plannedTime' | 'shiftTypeId' | 'rowColour' | 'notes'>
>;

/** Change a row's own fields. A blank text is stored as null — «nothing written», not «''». */
export const patchRow = (rows: readonly PlanRow[], key: string, patch: PlanRowPatch): PlanRow[] =>
  rows.map((row) => {
    if (row.key !== key) return row;
    const next = { ...row, ...patch };
    for (const field of ['direction', 'plannedTime', 'notes'] as const) {
      const value = next[field];
      if (typeof value === 'string' && value.trim() === '') next[field] = null;
    }
    return next;
  });

/** A row added on screen: «إضافة صف بدون سيارة». No type until somebody picks one («اختر»). */
export const vehiclelessRow = (sequence: number): PlanRow => ({
  key: `new:${sequence}`,
  vehicleId: null,
  vehicleCode: null,
  crewId: null,
  drivers: [],
  slots: { captain: [], specialist1: [], specialist2: [] },
  direction: null,
  plannedTime: null,
  shiftTypeId: null,
  rowColour: null,
  notes: null,
});

/** Nothing on it yet — no crew, and none of its own fields filled. */
export const isBlankRow = (row: PlanRow): boolean =>
  rowPeople(row).length === 0 &&
  row.direction === null &&
  row.plannedTime === null &&
  row.shiftTypeId === null &&
  row.rowColour === null &&
  row.notes === null;

/**
 * The row's bin. A vehicle-less row goes; a VAN row is emptied instead — the van is Fleet's roster
 * for the day, not something this board can take off it. Either way its crew goes back to the pools.
 */
export const discardRow = (rows: readonly PlanRow[], key: string): PlanRow[] =>
  rows.flatMap((row) => {
    if (row.key !== key) return [row];
    if (row.vehicleId === null) return [];
    return [
      {
        ...row,
        slots: { captain: [], specialist1: [], specialist2: [] },
        direction: null,
        plannedTime: null,
        shiftTypeId: null,
        rowColour: null,
        notes: null,
      },
    ];
  });

/** The vans a vehicle-less row may take: the day's vans nobody has planned anything on. */
export const vansFree = (rows: readonly PlanRow[]): PlanRow[] =>
  rows.filter((row) => row.vehicleId !== null && isBlankRow(row));

/**
 * Give a vehicle-less row a van («optionally pick a van later»). The van's row takes everything
 * the vehicle-less row holds and the vehicle-less row goes — one crew, now on a van. Only a BLANK
 * van (`vansFree`): a van somebody has planned on is not overwritten by a pick from a list.
 */
export const attachVan = (
  rows: readonly PlanRow[],
  key: string,
  vanKey: string,
): readonly PlanRow[] => {
  const loose = rows.find((row) => row.key === key);
  const van = rows.find((row) => row.key === vanKey);
  if (loose === undefined || van === undefined) return rows;
  if (loose.vehicleId !== null || van.vehicleId === null || !isBlankRow(van)) return rows;
  return rows.flatMap((row) => {
    if (row.key === key) return [];
    if (row.key !== vanKey) return [row];
    return [
      {
        ...van,
        slots: loose.slots,
        direction: loose.direction,
        plannedTime: loose.plannedTime,
        shiftTypeId: loose.shiftTypeId,
        rowColour: loose.rowColour,
        notes: loose.notes,
      },
    ];
  });
};

/**
 * What a crewed row is short of — «a van short of 1 captain / 2 specialists shows a quiet
 * warning». Null when it is not short, AND for a row nobody is on yet: an empty van is simply not
 * planned yet, and a warning on every one of them would be noise rather than news.
 */
export const crewShortfall = (row: PlanRow): { captains: number; specialists: number } | null => {
  if (rowPeople(row).length === 0) return null;
  const captains = Math.max(0, CREW_LIMITS.captains.min - row.slots.captain.length);
  const specialists = Math.max(
    0,
    CREW_LIMITS.specialists.min - row.slots.specialist1.length - row.slots.specialist2.length,
  );
  return captains === 0 && specialists === 0 ? null : { captains, specialists };
};

// ── The type: the picker, the counts and the filter ────────────────────────────────────────────────

/**
 * What a row's «النوع» list offers: the catalog's ACTIVE types, in the catalog's order (the server
 * answers in it — `sortOrder`, then the name), plus the type the row already holds when that one
 * has been archived since — still named, and marked, rather than a row that silently reads «اختر».
 * An archived type is never offered to a row that does not hold it: the save would refuse it.
 */
export const shiftTypeChoices = (
  types: readonly OperationsShiftTypeDto[],
  current: string | null,
): OperationsShiftTypeDto[] => types.filter((type) => type.isActive || type.id === current);

/** The type filter: one type (its id), the rows with none yet, or everything (''). */
export type ShiftTypeFilter = string;
export const NO_SHIFT_TYPE = 'none';

export const matchesShiftType = (row: PlanRow, filter: ShiftTypeFilter): boolean =>
  filter === ''
    ? true
    : filter === NO_SHIFT_TYPE
      ? row.shiftTypeId === null
      : row.shiftTypeId === filter;

/** One chip of the strip over the table. */
export interface ShiftTypeChip {
  type: OperationsShiftTypeDto;
  count: number;
}

/**
 * The strip over the table («إجمالي، يومي، احتياطي …» on the legacy board) — FOLLOWING THE CATALOG:
 * a chip per active type in the catalog's order, a zero included (a type nobody is on today is
 * still a type the planner looks for), and an archived type only while some row still holds it.
 * `none` counts the rows with no type yet. A row holding an id the catalog did not answer with
 * (the list not read yet) counts in the total only — never under a name the screen cannot give.
 */
export const shiftTypeStrip = (
  types: readonly OperationsShiftTypeDto[],
  rows: readonly PlanRow[],
): { total: number; none: number; chips: ShiftTypeChip[] } => {
  const counted = new Map<string, number>();
  let none = 0;
  for (const row of rows) {
    if (row.shiftTypeId === null) none += 1;
    else counted.set(row.shiftTypeId, (counted.get(row.shiftTypeId) ?? 0) + 1);
  }
  return {
    total: rows.length,
    none,
    chips: types
      .map((type) => ({ type, count: counted.get(type.id) ?? 0 }))
      .filter((chip) => chip.type.isActive || chip.count > 0),
  };
};

// ── The time ────────────────────────────────────────────────────────────────────────────────────────

/**
 * A typed time → «HH:MM», or null for a blank box, or undefined for something that is not a time.
 * Takes what an operator types in a hurry, in either keyboard's digits: «8», «08», «830», «0830»,
 * «8:30», «8.30», «٨:٣٠».
 */
export const parseClock = (typed: string): string | null | undefined => {
  const raw = asciiDigits(typed).trim();
  if (raw === '') return null;
  const match = /^(\d{1,2})(?:[:.\s]?(\d{2}))?$/.exec(raw);
  if (match === null) return undefined;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

// ── The pools ───────────────────────────────────────────────────────────────────────────────────────

/**
 * What the requirements make somebody on this board — and so their chip's colour:
 *
 *   · `captain`    — «قائد» ticked and «أخصائي» not: green, in القادة;
 *   · `dual`       — BOTH ticked: BLUE, in القادة. «اللى فى خانة القادة بس لونهم ازرق وفى الاخر دول
 *                    اخصائيين … اقدر اوظفهم ك قائد او اخصائى» — a specialist who also leads, and the
 *                    one kind the owner named as fit for either seat;
 *   · `specialist` — everybody else (no «قائد», or no requirements row at all): red, in الأخصائيون —
 *                    the same answer legacy gave an employee nobody had ticked.
 */
export type CrewRole = 'captain' | 'dual' | 'specialist';

export const crewRoleOf = (requirements: OperationsCrewRequirementsDto | null): CrewRole =>
  requirements?.isCaptain === true
    ? requirements.isSpecialist
      ? 'dual'
      : 'captain'
    : 'specialist';

/**
 * Sitting outside one's role: a specialist in the captain's slot, or a captain-only in a
 * specialist's. MARKED, NOT REFUSED — requirements gate nothing (the approved decision every crew
 * screen carries); the chip says so quietly and the planner decides.
 */
export const outOfRole = (role: CrewRole, slot: CrewSlot): boolean =>
  slot === 'captain' ? role === 'specialist' : role === 'captain';

export const PLAN_POOLS = ['captains', 'specialists'] as const;
export type PlanPool = (typeof PLAN_POOLS)[number];

export const planPoolOf = (member: OperationsCrewMemberDto): PlanPool =>
  crewRoleOf(member.requirements) === 'specialist' ? 'specialists' : 'captains';

/**
 * The requirement icons — on every chip, and as each pool's filters: EVERY flag «متطلبات الطاقم»
 * records («على حسب الحاجات اللى انا مسجلها فى متطلبات الطاقم»), in the order that screen lists them,
 * but «قائد» and «أخصائي» — the chip's COLOUR already says those two.
 *
 * Derived from `REQUIREMENT_FLAGS` rather than listed again: a flag added to the requirements screen
 * then fails the type check here (`FLAG_PATH` has no drawing for it) instead of silently never
 * showing on a chip — as «موظف عمليات» once did.
 */
export type PlanFlag = Exclude<RequirementFlag, 'isCaptain' | 'isSpecialist'>;
export const PLAN_FLAGS: readonly PlanFlag[] = REQUIREMENT_FLAGS.filter(
  (flag): flag is PlanFlag => flag !== 'isCaptain' && flag !== 'isSpecialist',
);

export const flagsOf = (member: OperationsCrewMemberDto): PlanFlag[] =>
  PLAN_FLAGS.filter((flag) => member.requirements?.[flag] === true);

/** One pool's narrowing: a search over the name and the code (folded), and icon filters (AND). */
export interface PlanPoolQuery {
  search: string;
  flags: PlanFlag[];
}

export const EMPTY_POOL_QUERY: PlanPoolQuery = { search: '', flags: [] };

/**
 * Away on the board's day, as HR has it (Round 22): 'absent', 'onLeave', or null — at work, a
 * weekend, no record yet, or a server from before the field. AN UNKNOWN IS NOT AN ABSENCE: only the
 * two answers HR gives keep anybody off a row («لو القائد غايب … مقدرش احطه على العربيه»).
 */
export type CrewAway = OperationsCrewAvailability;

export const awayOf = (member: OperationsCrewMemberDto | undefined): CrewAway | null =>
  member?.availability === 'absent' || member?.availability === 'onLeave'
    ? member.availability
    : null;

/** Is this member sent further down his pool's list? `placed`: everybody on a row of the draft. */
type PoolTail = (member: OperationsCrewMemberDto, placed: ReadonlySet<string>) => boolean;

/**
 * What sends a member down his pool, the COARSEST first — each tail sorts INSIDE the one before it,
 * and the server's order is kept inside the last:
 *   1. AWAY that day → after EVERYBODY: «وعاوز لو القائد غايب يظهر تحت الكل بقى فى الاخر يبقى باللون
 *      الباهت … و كذلك الاخصائيين» (Round 22). Still listed — the planner looking for him learns why
 *      he cannot be put on a row instead of thinking he left the roster — faded, and not movable;
 *   2. already on a row → after the free ones. Still listed (dimmed, with where), because «where is
 *      he» is a question the pool answers and because dragging one of them is how he is moved;
 *   3. BLUE → after the green captains: «وعاوز القادة اللى فى نفس الوقت اخصائيين يكونوا فى الاخر». The
 *      planner looks for a captain first; a specialist who also leads is the fallback (Round 22).
 *      Inside each half, so the pool reads free green, free blue, placed green, placed blue, then the
 *      away ones in that same order. Only «القادة» holds blue ones (`planPoolOf`), so «الأخصائيون»
 *      keeps the server's order inside each tail.
 */
const POOL_TAILS: readonly PoolTail[] = [
  (member) => awayOf(member) !== null,
  (member, placed) => placed.has(member.employeeId),
  (member) => crewRoleOf(member.requirements) === 'dual',
];

/** The member's place among the tails, as a number: each tail a binary digit, the first the highest. */
const poolRank = (member: OperationsCrewMemberDto, placed: ReadonlySet<string>): number =>
  POOL_TAILS.reduce((rank, tail) => rank * 2 + (tail(member, placed) ? 1 : 0), 0);

/**
 * One pool as listed: its members that match the search and the icons, in `POOL_TAILS`' order —
 * the server's order inside each tail (the sort is stable). `free` — «متاح N» — counts who can be
 * put on a row now: on none yet, and not away.
 */
export const listPool = (
  members: readonly OperationsCrewMemberDto[],
  pool: PlanPool,
  rows: readonly PlanRow[],
  query: PlanPoolQuery,
): { listed: OperationsCrewMemberDto[]; total: number; free: number } => {
  const placed = new Set(rows.flatMap(rowPeople));
  const mine = members.filter((member) => planPoolOf(member) === pool);
  const matching = mine.filter(
    (member) =>
      (foldIncludes(member.fullNameAr, query.search) || foldIncludes(member.code, query.search)) &&
      query.flags.every((flag) => member.requirements?.[flag] === true),
  );
  const rank = new Map(matching.map((member) => [member, poolRank(member, placed)]));
  return {
    listed: [...matching].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)),
    total: mine.length,
    free: mine.filter((member) => !placed.has(member.employeeId) && awayOf(member) === null).length,
  };
};

// ── The standing crew (الطاقم الثابت) ──────────────────────────────────────────────────────────────

/**
 * The toggle's load, on this board's rows — by `loadStandingCrew` itself, so its two rules (only an
 * EMPTY van; nobody twice) stay one implementation. A vehicle-less row goes through under its own
 * key, which no standing crew names: it is never filled, but whoever is on it counts as taken.
 */
export const loadStandingIntoPlan = (
  rows: readonly PlanRow[],
  standing: readonly StandingCrewSource[],
): { rows: PlanRow[]; filledKeys: string[]; unavailable: number } => {
  const asBoard = rows.map((row): BoardRow => ({
    vehicleId: row.vehicleId ?? row.key,
    vehicleCode: row.vehicleCode ?? '',
    missionTypeId: null,
    captainEmployeeIds: SLOT_POSITIONS.map((at) => row.slots.captain[at] ?? null),
    specialist1EmployeeIds: SLOT_POSITIONS.map((at) => row.slots.specialist1[at] ?? null),
    specialist2EmployeeIds: SLOT_POSITIONS.map((at) => row.slots.specialist2[at] ?? null),
    direction: row.direction,
    plannedTime: row.plannedTime,
    notes: row.notes,
  }));
  const load = loadStandingCrew(asBoard, standing);
  const filled = new Set(load.filledVehicleIds);
  const loaded = new Map(load.rows.map((row) => [row.vehicleId, row]));
  const compact = (cells: readonly (string | null)[]): string[] =>
    cells.filter((id): id is string => id !== null);
  const next = rows.map((row) => {
    const source = row.vehicleId === null ? undefined : loaded.get(row.vehicleId);
    if (row.vehicleId === null || !filled.has(row.vehicleId) || source === undefined) return row;
    return {
      ...row,
      slots: {
        captain: compact(source.captainEmployeeIds),
        specialist1: compact(source.specialist1EmployeeIds),
        specialist2: compact(source.specialist2EmployeeIds),
      },
    };
  });
  return {
    rows: next,
    filledKeys: rows
      .filter((row) => row.vehicleId !== null && filled.has(row.vehicleId))
      .map((row) => row.key),
    unavailable: load.unavailableVehicleIds.length,
  };
};

/** The toggle back off: empty exactly the rows its load filled (`clearStandingCrew`'s rule). */
export const clearStandingFromPlan = (
  rows: readonly PlanRow[],
  filledKeys: readonly string[],
): PlanRow[] => {
  const filled = new Set(filledKeys);
  return rows.map((row) =>
    filled.has(row.key)
      ? { ...row, slots: { captain: [], specialist1: [], specialist2: [] } }
      : row,
  );
};

// ── The van's card ─────────────────────────────────────────────────────────────────────────────────

/**
 * The row as the round-4 van card reads one (`VehicleCrewCardBody`) — from the DRAFT, so the card
 * says who is on the van now, not who was on it at the last save.
 */
export const planRowCard = (
  row: PlanRow,
  memberOf: (employeeId: string) => OperationsCrewMemberDto | undefined,
): OperationsDayBoardVehicleCrewDto => {
  const person = (employeeId: string): OperationsDayBoardPersonDto => {
    const member = memberOf(employeeId);
    return { employeeId, code: member?.code ?? null, fullNameAr: member?.fullNameAr ?? null };
  };
  return {
    crewAssignmentId: row.crewId ?? row.key,
    vehicleId: row.vehicleId ?? '',
    vehicleCode: row.vehicleCode,
    drivers: row.drivers,
    captains: row.slots.captain.map(person),
    specialist1: row.slots.specialist1.map(person),
    specialist2: row.slots.specialist2.map(person),
    direction: row.direction,
    plannedTime: row.plannedTime,
  };
};

// ── The save ───────────────────────────────────────────────────────────────────────────────────────

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

const sameRow = (a: PlanRow, b: PlanRow): boolean =>
  a.vehicleId === b.vehicleId &&
  CREW_SLOTS.every((slot) => sameList(a.slots[slot], b.slots[slot])) &&
  a.direction === b.direction &&
  a.plannedTime === b.plannedTime &&
  a.shiftTypeId === b.shiftTypeId &&
  a.rowColour === b.rowColour &&
  a.notes === b.notes;

/**
 * What «حفظ» sends: the rows that differ from the server's, and the SAVED vehicle-less rows no
 * longer on screen (deleted, or given a van). A new vehicle-less row left blank is nothing to save.
 */
export const planChanges = (
  next: readonly PlanRow[],
  original: readonly PlanRow[],
): { changed: PlanRow[]; removedCrewIds: string[] } => {
  const before = new Map(original.map((row) => [row.key, row]));
  const kept = new Set(next.map((row) => row.key));
  return {
    changed: next.filter((row) => {
      const was = before.get(row.key);
      return was === undefined ? !isBlankRow(row) : !sameRow(row, was);
    }),
    removedCrewIds: original
      .filter((row) => row.vehicleId === null && row.crewId !== null && !kept.has(row.key))
      .map((row) => row.crewId as string),
  };
};

export const changeCount = (changes: ReturnType<typeof planChanges>): number =>
  changes.changed.length + changes.removedCrewIds.length;

/**
 * A NEW answer from the server under an unsaved draft — another desk saved a row of the same day,
 * the realtime topic or a reconnect refetched — WITHOUT losing what the planner did here. Round 20
 * replaced the draft with the answer: a name just dropped went back to its pool on its own, «بيرجع
 * تانى اكنى متحطش» in the owner's words, with «حفظ» greyed out (Round 22).
 *
 * Row by row, against the answer the draft was made from (`base`):
 *   · a row the planner did not touch takes the new answer — the other desk's change shows;
 *   · a row he changed keeps his version, with the server's facts about it refreshed (the van's
 *     code, its drivers, its saved crew's id);
 *   · a row he took off (a row without a van deleted, or given a van) stays off;
 *   · a row new on the server (another desk's row without a van, a van Fleet added) is added;
 *   · his own rows not on the server — a row added here, a changed row the server no longer has —
 *     stay, at the end: the save then says what became of them.
 * Untouched everywhere → the answer itself, so nothing reads as changed. Somebody both desks seated
 * on two rows is left for the save to refuse (Q11), never resolved here by editing a row the planner
 * did not touch.
 */
export const rebaseDraft = (
  draft: readonly PlanRow[],
  base: readonly PlanRow[],
  next: readonly PlanRow[],
): readonly PlanRow[] => {
  const before = new Map(base.map((row) => [row.key, row]));
  const mine = new Map(draft.map((row) => [row.key, row]));
  const touched = (row: PlanRow): boolean => {
    const was = before.get(row.key);
    return was === undefined || !sameRow(row, was);
  };
  if (!draft.some(touched) && base.every((row) => mine.has(row.key))) return next;
  const out: PlanRow[] = [];
  for (const row of next) {
    const local = mine.get(row.key);
    if (local === undefined) {
      if (!before.has(row.key)) out.push(row);
      continue;
    }
    out.push(
      touched(local)
        ? { ...local, vehicleCode: row.vehicleCode, drivers: row.drivers, crewId: row.crewId }
        : row,
    );
  }
  const answered = new Set(next.map((row) => row.key));
  return [...out, ...draft.filter((row) => !answered.has(row.key) && touched(row))];
};

/**
 * What «حفظ» sends (`PlanOperationsCrewSchema`). Whole rows, as the server takes them: a field
 * left null is cleared. A saved row without a van is named by its `crewAssignmentId`; a new one,
 * and a van's row, by nothing but their place (`vehicleId`, or null).
 */
export const toPlan = (
  day: string,
  changes: ReturnType<typeof planChanges>,
): PlanOperationsCrew => ({
  date: new Date(`${day}T00:00:00.000Z`),
  rows: changes.changed.map((row) => ({
    vehicleId: row.vehicleId,
    ...(row.vehicleId === null && row.crewId !== null ? { crewAssignmentId: row.crewId } : {}),
    captainEmployeeIds: row.slots.captain,
    specialist1EmployeeIds: row.slots.specialist1,
    specialist2EmployeeIds: row.slots.specialist2,
    direction: row.direction,
    plannedTime: row.plannedTime,
    notes: row.notes,
    shiftTypeId: row.shiftTypeId,
    rowColour: row.rowColour,
  })),
  ...(changes.removedCrewIds.length === 0
    ? {}
    : { removeCrewAssignmentIds: changes.removedCrewIds }),
});

// ── A refused save, on its row ──────────────────────────────────────────────────────────────────────

/**
 * A refused save the plan's own sentence is true of — «قد يكون أحد الأفراد معيَّنًا على مركبة أخرى»:
 * Q11 (somebody already holds a row of the day) and an employee who has exited, both a 409
 * `DUPLICATE`. The board owns its errors, so its toast is the only one: anything else — the network,
 * a van Fleet took off the day's roster, a row deleted on another desk — is said in its own words,
 * never as a double booking it is not.
 */
export const isCrewClash = (failure: unknown): boolean =>
  failure instanceof ApiError && failure.status === 409 && failure.code === 'DUPLICATE';

/**
 * The refusals a save can name a row in, and what on it each one is about: its type box, its
 * direction box, or one PERSON on it (`crew` — Round 22, somebody away that day newly put on it).
 */
export type PlanRefusalField = 'type' | 'direction' | 'crew';

export interface PlanRefusal {
  /** The row's key on screen. */
  key: string;
  field: PlanRefusalField;
  /** The direction's parts no area answers, as they were typed — [] for anything else. */
  parts: string[];
  /** `crew`: who, and why he may not go on it — HR has him absent, or on leave, that day. */
  person?: { employeeId: string; away: CrewAway };
}

/** The server's word for why somebody is away (`OPERATIONS_CREW_MEMBER_ABSENT`'s detail code). */
const AWAY_CODE: Record<string, CrewAway> = { ABSENT: 'absent', ON_LEAVE: 'onLeave' };

/**
 * A refused save → the row it names, so the board marks THAT row's cell rather than leaving the
 * planner to find it among fifty. The server names the row by its place in the save's `rows`
 * (`ROW_INDEX`) — the order `toPlan` sent `changed` in. Null for any other refusal (a Q11 clash, a
 * row deleted on another desk): those are said, not placed.
 *
 * Round 22 — `OPERATIONS_CREW_MEMBER_ABSENT`: somebody away that day put on a row on another desk's
 * screen, or before HR recorded it here. The detail names him (`employeeId`, 'ABSENT'/'ON_LEAVE'):
 * the board rings his chip on that row and says his name.
 */
export const planRefusal = (
  failure:
    | { code?: string | undefined; details?: readonly ApiErrorDetail[] | undefined }
    | null
    | undefined,
  sent: readonly PlanRow[],
): PlanRefusal | null => {
  const field: PlanRefusalField | null =
    failure?.code === 'OPERATIONS_UNKNOWN_SHIFT_TYPE'
      ? 'type'
      : failure?.code === 'OPERATIONS_DIRECTION_NOT_AN_AREA'
        ? 'direction'
        : failure?.code === 'OPERATIONS_CREW_MEMBER_ABSENT'
          ? 'crew'
          : null;
  if (field === null) return null;
  const details = failure?.details ?? [];
  const index = details.find((detail) => detail.code === 'ROW_INDEX')?.message;
  const row = index === undefined ? undefined : sent[Number(index)];
  if (row === undefined) return null;
  if (field === 'crew') {
    const named = details.find((detail) => detail.field === 'employeeId');
    const away = named === undefined ? undefined : AWAY_CODE[named.code];
    // Somebody the server names who is not on the row it names: placed on the row, said, unringed.
    if (named === undefined || away === undefined || !rowPeople(row).includes(named.message)) {
      return { key: row.key, field, parts: [] };
    }
    return { key: row.key, field, parts: [], person: { employeeId: named.message, away } };
  }
  return {
    key: row.key,
    field,
    parts:
      field === 'direction'
        ? details.filter((detail) => detail.code === 'NOT_AN_AREA').map((detail) => detail.message)
        : [],
  };
};
