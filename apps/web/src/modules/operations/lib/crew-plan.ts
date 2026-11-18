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
  canonicalCrewRowColour,
  crewRoleOf,
  fitsCrewSlot,
  type ApiErrorDetail,
  type OperationsCrewAvailability,
  type OperationsCrewBoardCrewDto,
  type OperationsCrewBoardDto,
  type OperationsCrewMemberDto,
  type OperationsCrewRole,
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

/**
 * The colours a row may be given by hand — Round 24b: the TYPES' palette, one palette for both
 * (`lib/type-colours.ts` says which of it is shown). Null is «لون النوع»: the row wears its type's.
 */
export const CREW_ROW_COLOURS = OPERATIONS_CREW_ROW_COLOURS;
export type CrewRowColour = OperationsCrewRowColour;

/**
 * A colour as the board will draw it, or none (`canonicalCrewRowColour`): a palette name as it is,
 * Round 20's six mapped (an older server, a row not migrated yet), and anything else — a colour a
 * NEWER server may add before this screen knows it — «no colour», never a class name built from
 * the wire.
 */
const knownColour = (value: string | null): CrewRowColour | null => canonicalCrewRowColour(value);

// ── The rows ───────────────────────────────────────────────────────────────────────────────────────

/** One row of the plan, as the board edits it. */
export interface PlanRow {
  /**
   * The row's own key: `van:<vehicleId>` for a van as the server listed it, `loose:<crew id>` for a
   * saved vehicle-less row, `new:<n>` for one added on screen. Stable across edits — the table keys
   * on it — so a row given a van that is not a blank row of the board (Round 24) keeps its key.
   */
  key: string;
  /** Null — «بدون سيارة». */
  vehicleId: string | null;
  vehicleCode: string | null;
  /**
   * Round 24 — the van is on the Fleet roster of the day («تعيين السيارات»), so its row is only ever
   * EMPTIED here (the roster is Fleet's). False for a van the roster does not have that day — given
   * on this board from `freeVehicles` — whose row is REMOVED like a row without a van, freeing the
   * van; and false for a row without a van.
   */
  onRoster: boolean;
  /**
   * The SAVED crew row this row is: null for a van not crewed yet and for a row added on screen.
   * Round 24: a saved row without a van given a blank roster van keeps its own id here (the van's
   * row it merges into takes it) — the save then says «row X takes van V», and its محصنات follow.
   */
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
          onRoster: row.fleetDutyAssignmentId !== null,
          crewId: row.crew?.id ?? null,
          drivers: row.drivers,
          ...crewFields(row.crew),
        })),
        ...board.vehiclelessRows.map((crew): PlanRow => ({
          key: `loose:${crew.id}`,
          vehicleId: null,
          vehicleCode: null,
          onRoster: false,
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
  onRoster: false,
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
 * May the row's bin DELETE it (rather than empty it)? A row without a van, and (Round 24) a row
 * whose van is NOT on the Fleet roster that day — the van is then the row's own, and deleting the
 * row frees it. A roster van's row is Fleet's for the day: emptied, never deleted.
 */
export const isRemovableRow = (row: Pick<PlanRow, 'vehicleId' | 'onRoster'>): boolean =>
  row.vehicleId === null || !row.onRoster;

/**
 * The row's bin. A removable row goes (`isRemovableRow`); a ROSTER van's row is emptied instead —
 * the van is Fleet's roster for the day, not something this board can take off it. Either way its
 * crew goes back to the pools.
 */
export const discardRow = (rows: readonly PlanRow[], key: string): PlanRow[] =>
  rows.flatMap((row) => {
    if (row.key !== key) return [row];
    if (isRemovableRow(row)) return [];
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

/** The ROSTER vans a vehicle-less row may merge into: the day's roster vans nobody planned on. */
export const vansFree = (rows: readonly PlanRow[]): PlanRow[] =>
  rows.filter((row) => row.vehicleId !== null && row.onRoster && isBlankRow(row));

/**
 * Give a vehicle-less row a ROSTER van that is a blank row of the board («optionally pick a van
 * later»). The van's row takes everything the vehicle-less row holds and the vehicle-less row goes —
 * one crew, now on a van, in the van's place. Only a BLANK van: a van somebody has planned on is not
 * overwritten by a pick from a list.
 *
 * Round 24 — a SAVED row without a van keeps its id (`crewId`) on the van's row: the save sends «row
 * X takes van V» (`toPlan`), so X keeps its محصنات — the Round-20 way (X deleted, the van's row
 * written) is refused for a row that holds some, and would have stranded them. A row added on screen
 * has no id: the van's row keeps its own, as before.
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
        crewId: loose.crewId ?? van.crewId,
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

/** A vehicle as a row takes it (`OperationsCrewBoardFreeVehicleDto`'s facts the row keeps). */
export interface TakenVehicle {
  vehicleId: string;
  vehicleCode: string;
  onRoster: boolean;
  drivers: OperationsDayBoardDriverDto[];
}

/**
 * Round 24 — «مكان بدون سيارة دا لما ادوس عليه يجيب كل السيارات اللى مش عليها طاقم واقدر اختار منهم»:
 * a vehicle-less row takes a vehicle that is NOT a row of the board (one the Fleet roster does not
 * have that day, from `freeVehicles`). The row stays where it is, under its own key, and becomes
 * that van's row: a row added on screen is saved as a new van row, a saved one as «row X takes van
 * V» (its محصنات follow). Refused — the rows as they were, the same array — when the row has a van
 * already, or another row of the draft holds the vehicle.
 */
export const takeVehicle = (
  rows: readonly PlanRow[],
  key: string,
  vehicle: TakenVehicle,
): readonly PlanRow[] => {
  const row = rows.find((candidate) => candidate.key === key);
  if (row === undefined || row.vehicleId !== null) return rows;
  if (rows.some((other) => other.vehicleId === vehicle.vehicleId)) return rows;
  return rows.map((candidate) =>
    candidate.key === key
      ? {
          ...candidate,
          vehicleId: vehicle.vehicleId,
          vehicleCode: vehicle.vehicleCode,
          onRoster: vehicle.onRoster,
          drivers: vehicle.drivers,
        }
      : candidate,
  );
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

// ── The roles, and the slots they take ─────────────────────────────────────────────────────────────

/**
 * What the requirements make somebody on this board — and so their chip's colour, their pool, and
 * (Round 23) the slots they may take. ONE definition, the contracts' (`crewRoleOf`), so the board
 * and the save cannot disagree:
 *
 *   · `captain`    — «قائد» ticked and «أخصائي» not: green, in القادة, the captain's slot only;
 *   · `dual`       — BOTH ticked: BLUE, in القادة (at its end) and never in الأخصائيون. «اللى فى خانة
 *                    القادة بس لونهم ازرق وفى الاخر دول اخصائيين … اقدر اوظفهم ك قائد او اخصائى» — the one
 *                    kind fit for every slot;
 *   · `specialist` — everybody else (no «قائد», or no requirements row at all): red, in الأخصائيون,
 *                    the specialists' slots only — the answer legacy gave an employee nobody ticked.
 */
export type CrewRole = OperationsCrewRole;
export { crewRoleOf, fitsCrewSlot };

/**
 * Why a slot will not take somebody of this role, in the save's own two words (its `NOT_A_CAPTAIN`
 * and `NOT_A_SPECIALIST`), or null when it fits. Round 23 — the owner: «ممنوع ان اعين قائد مكان
 * اخصائى والعكس الا فى حالة انه قائد اخصائى». A REFUSAL, every way a person is put in a slot (the
 * drop, the slot's list, «اختر ثم ضع هنا», the standing crew's load): the Round-20 board only marked
 * such a seat, and the owner never asked for that.
 *
 * Somebody already sitting in such a seat — put there before the rule, or before his flags changed
 * on «متطلبات الطاقم» — keeps it, marked, until the planner takes him out: the server lets a held
 * seat stay, as it does an archived type or a person marked absent after he was planned.
 */
export type WrongSlot = 'notCaptain' | 'notSpecialist';

export const wrongSlotOf = (role: CrewRole, slot: CrewSlot): WrongSlot | null =>
  fitsCrewSlot(role, slot) ? null : slot === 'captain' ? 'notCaptain' : 'notSpecialist';

/**
 * The people on a row who sit in a slot their role does not fit — held seats, by who and where.
 * `roleOf` answers null for somebody whose role the board cannot read (the roster no longer names
 * him): he is not judged here — the save, which reads his requirements, is.
 */
export const rowMisfits = (
  row: PlanRow,
  roleOf: (employeeId: string) => CrewRole | null,
): { employeeId: string; slot: CrewSlot; why: WrongSlot }[] =>
  CREW_SLOTS.flatMap((slot) =>
    row.slots[slot].flatMap((employeeId) => {
      const role = roleOf(employeeId);
      const why = role === null ? null : wrongSlotOf(role, slot);
      return why === null ? [] : [{ employeeId, slot, why }];
    }),
  );

// ── The pools ───────────────────────────────────────────────────────────────────────────────────────

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
 * People in the board's listing order (`POOL_TAILS`), the server's order kept inside each tail (the
 * sort is stable) — the pools' order, and the slot list's (Round 23: a specialist's slot lists the
 * specialists, then the captain-specialists at the end, by the same tails).
 */
export const inListOrder = (
  members: readonly OperationsCrewMemberDto[],
  rows: readonly PlanRow[],
): OperationsCrewMemberDto[] => {
  const placed = new Set(rows.flatMap(rowPeople));
  const rank = new Map(members.map((member) => [member, poolRank(member, placed)]));
  return [...members].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
};

/** Who can be put on a row now — on none yet, and not away: «متاح N». */
export const countFree = (
  members: readonly OperationsCrewMemberDto[],
  rows: readonly PlanRow[],
): number => {
  const placed = new Set(rows.flatMap(rowPeople));
  return members.filter((member) => !placed.has(member.employeeId) && awayOf(member) === null)
    .length;
};

/** The pools' search: the name or the code (folded), and the icons (AND). */
export const matchesPoolQuery = (member: OperationsCrewMemberDto, query: PlanPoolQuery): boolean =>
  (foldIncludes(member.fullNameAr, query.search) || foldIncludes(member.code, query.search)) &&
  query.flags.every((flag) => member.requirements?.[flag] === true);

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
  const mine = members.filter((member) => planPoolOf(member) === pool);
  return {
    listed: inListOrder(
      mine.filter((member) => matchesPoolQuery(member, query)),
      rows,
    ),
    total: mine.length,
    free: countFree(mine, rows),
  };
};

// ── The standing crew (الطاقم الثابت) ──────────────────────────────────────────────────────────────

/**
 * The standing crew AS THIS DAY MAY TAKE IT, before it is loaded: each van's people less two kinds,
 * named so the load notice can say whom it left off —
 *   · `away` — HR has him absent or on leave that day (Round 22): no row takes him;
 *   · `wrongSlot` — his slot of the standing crew is one his role does not fit (Round 23 — «ممنوع
 *     ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى»): written there before the rule, or
 *     before his flags changed. Loaded, he would take a new seat the save refuses.
 * Each is counted as not loaded, like an absent one; the seat stays empty for the planner to fill.
 */
export const standingForDay = (
  standing: readonly StandingCrewSource[],
  memberOf: (employeeId: string) => OperationsCrewMemberDto | undefined,
): {
  sources: StandingCrewSource[];
  away: string[];
  wrongSlot: { employeeId: string; slot: CrewSlot }[];
} => {
  const away = new Set<string>();
  const wrongSlot: { employeeId: string; slot: CrewSlot }[] = [];
  const field = {
    captain: 'captainEmployeeIds',
    specialist1: 'specialist1EmployeeIds',
    specialist2: 'specialist2EmployeeIds',
  } as const;
  const sources = standing.map((source) => {
    const keep = (slot: CrewSlot): string[] =>
      source[field[slot]].filter((employeeId) => {
        const member = memberOf(employeeId);
        if (awayOf(member) !== null) {
          away.add(employeeId);
          return false;
        }
        // Somebody the roster no longer names: his requirements cannot be read here, so he is not
        // judged here either — loaded as before, and the save (which reads them) decides.
        if (member !== undefined && !fitsCrewSlot(crewRoleOf(member.requirements), slot)) {
          wrongSlot.push({ employeeId, slot });
          return false;
        }
        return true;
      });
    return {
      vehicleId: source.vehicleId,
      captainEmployeeIds: keep('captain'),
      specialist1EmployeeIds: keep('specialist1'),
      specialist2EmployeeIds: keep('specialist2'),
    };
  });
  return { sources, away: [...away], wrongSlot };
};

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
    vehicleId: row.vehicleId,
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

/** The same row as the save sees it — its van, its saved row, its crew and its own fields. */
export const sameRow = (a: PlanRow, b: PlanRow): boolean =>
  a.vehicleId === b.vehicleId &&
  a.crewId === b.crewId &&
  CREW_SLOTS.every((slot) => sameList(a.slots[slot], b.slots[slot])) &&
  a.direction === b.direction &&
  a.plannedTime === b.plannedTime &&
  a.shiftTypeId === b.shiftTypeId &&
  a.rowColour === b.rowColour &&
  a.notes === b.notes;

/**
 * What «حفظ» sends: the rows that differ from the server's, and the SAVED removable rows (a row
 * without a van; since Round 24 a van the roster does not have) whose crew row no row on screen is
 * any more — deleted, or (Round 20, a row added on screen) merged into a van's row. A new row left
 * blank is nothing to save — unless it holds a van (Round 24): a van off the roster is its content.
 *
 * By the saved crew row's id, not by the key: a saved row without a van given a roster van moves
 * onto the van's row with its id (`attachVan`) — still on screen, so not deleted. A ROSTER van's
 * crew row is never sent here (the server refuses it): one whose van another row took is released
 * by the server in the same save.
 */
export const planChanges = (
  next: readonly PlanRow[],
  original: readonly PlanRow[],
): { changed: PlanRow[]; removedCrewIds: string[] } => {
  const before = new Map(original.map((row) => [row.key, row]));
  const held = new Set(next.flatMap((row) => (row.crewId === null ? [] : [row.crewId])));
  return {
    changed: next.filter((row) => {
      const was = before.get(row.key);
      return was === undefined ? !isBlankRow(row) || row.vehicleId !== null : !sameRow(row, was);
    }),
    removedCrewIds: original
      .filter((row) => isRemovableRow(row) && row.crewId !== null && !held.has(row.crewId))
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
    out.push(touched(local) ? refreshFacts(local, before.get(local.key), row) : row);
  }
  const answered = new Set(next.map((row) => row.key));
  return [...out, ...draft.filter((row) => !answered.has(row.key) && touched(row))];
};

/**
 * A row the planner changed, under a new answer: the server's facts about it refreshed — the van's
 * code, its drivers, whether the roster has it, its saved crew's id — but only facts about what the
 * row still IS. A row given another van here keeps that van's facts (Round 24: the answer still
 * lists it without one); a row that took another saved crew row's id (`attachVan`) keeps that id.
 */
const refreshFacts = (local: PlanRow, was: PlanRow | undefined, answer: PlanRow): PlanRow => {
  const sameVan = local.vehicleId === answer.vehicleId;
  const ownCrew = was === undefined || local.crewId === was.crewId;
  return {
    ...local,
    ...(sameVan
      ? { vehicleCode: answer.vehicleCode, drivers: answer.drivers, onRoster: answer.onRoster }
      : {}),
    crewId: ownCrew ? answer.crewId : local.crewId,
  };
};

/**
 * What «حفظ» sends (`PlanOperationsCrewSchema`). Whole rows, as the server takes them: a field
 * left null is cleared. A SAVED row is named by its `crewAssignmentId` — with its van, or without
 * one — and a new one by nothing but its place (`vehicleId`, or null). Round 24: a saved row with a
 * van it did not hold is «row X takes van V» (its محصنات follow it); one that holds it, a plain
 * edit — the server takes both, so a saved row is always named («always sending it is safe»).
 */
export const toPlan = (
  day: string,
  changes: ReturnType<typeof planChanges>,
): PlanOperationsCrew => ({
  date: new Date(`${day}T00:00:00.000Z`),
  rows: changes.changed.map((row) => ({
    vehicleId: row.vehicleId,
    ...(row.crewId !== null ? { crewAssignmentId: row.crewId } : {}),
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
 * The refusals a save can name a row in, and what on it each one is about: its type box, or one
 * PERSON on it — `crew` (Round 22, somebody away that day newly put on it) or `slot` (Round 23,
 * somebody newly put in a slot his role does not fit) — or (Round 24) its VAN (`vehicle`: not in
 * service, in the workshop, or another row's) or its REMOVAL (`remove`: a deleted row that holds
 * محصنات — the page puts it back, marked).
 *
 * Round 28 — no longer its DIRECTION: «عاوز الاتجاه اقدر اكتبه بايدى لو مش موجود فى الليست», and the
 * save takes a direction typed by hand, so `OPERATIONS_DIRECTION_NOT_AN_AREA` is sent no more. Were
 * an older server to send it, it is said in its own words (`errors.ts`), placed on no row.
 */
export type PlanRefusalField = 'type' | 'crew' | 'slot' | 'vehicle' | 'remove';

/** Why the save refused the van a row was given (Round 24). */
export type VehicleRefusal = 'notActive' | 'inWorkshop' | 'taken';

/** Why the save refused a person: away that day (`crew`), or in a slot not his (`slot`). */
export type PersonRefusal = CrewAway | WrongSlot;

export interface PlanRefusal {
  /** The row's key on screen. */
  key: string;
  field: PlanRefusalField;
  /** `crew` / `slot`: who, and why he may not go there. */
  person?: { employeeId: string; reason: PersonRefusal };
  /** `vehicle`: which van, and why the row may not take it. */
  vehicle?: { vehicleId: string; reason: VehicleRefusal };
  /** `remove`: the deleted row's saved id, and how many محصنات it holds. */
  removed?: { crewId: string; shipments: number };
}

/** The server's three refusals of a van given to a row — `ErrorCodes`' Round-24 codes. */
const VEHICLE_CODE: Record<string, VehicleRefusal> = {
  OPERATIONS_CREW_VEHICLE_NOT_ACTIVE: 'notActive',
  OPERATIONS_CREW_VEHICLE_IN_WORKSHOP: 'inWorkshop',
  OPERATIONS_CREW_VEHICLE_TAKEN: 'taken',
};

/**
 * The server's words for why somebody may not go there — `OPERATIONS_CREW_MEMBER_ABSENT`'s detail
 * codes, and `OPERATIONS_CREW_MEMBER_WRONG_SLOT`'s.
 */
const PERSON_CODE: Record<PlanRefusalField, Record<string, PersonRefusal>> = {
  type: {},
  crew: { ABSENT: 'absent', ON_LEAVE: 'onLeave' },
  slot: { NOT_A_CAPTAIN: 'notCaptain', NOT_A_SPECIALIST: 'notSpecialist' },
  vehicle: {},
  remove: {},
};

/**
 * A refused save → the row it names, so the board marks THAT row's cell rather than leaving the
 * planner to find it among fifty. The server names the row by its place in the save's `rows`
 * (`ROW_INDEX`) — the order `toPlan` sent `changed` in. Null for any other refusal (a Q11 clash, a
 * row deleted on another desk): those are said, not placed.
 *
 * Round 22 — `OPERATIONS_CREW_MEMBER_ABSENT`: somebody away that day put on a row on another desk's
 * screen, or before HR recorded it here. The detail names him (`employeeId`, 'ABSENT'/'ON_LEAVE'):
 * the board rings his chip on that row and says his name.
 *
 * Round 23 — `OPERATIONS_CREW_MEMBER_WRONG_SLOT` the same way ('NOT_A_CAPTAIN'/'NOT_A_SPECIALIST'):
 * somebody whose flags another desk changed on «متطلبات الطاقم» after this board read them, newly
 * put in a slot that no longer fits him.
 *
 * Round 24 — a van given from «بدون سيارة» refused (`…_VEHICLE_NOT_ACTIVE`, `…_IN_WORKSHOP`,
 * `…_TAKEN`: Fleet took it out of service, sent it to the workshop, or another desk crewed it since
 * the board was read) is marked on the row's van; and `OPERATIONS_CREW_ROW_HAS_SHIPMENTS` — a
 * deleted row that holds محصنات — names the row by its saved id (`removed`), not by an index.
 */
export const planRefusal = (
  failure:
    | { code?: string | undefined; details?: readonly ApiErrorDetail[] | undefined }
    | null
    | undefined,
  sent: readonly PlanRow[],
): PlanRefusal | null => {
  const details = failure?.details ?? [];
  // Round 24 — a removal refused: the row is not on screen (it was deleted there), so it is named
  // by its saved id; the page puts it back and marks it.
  if (failure?.code === 'OPERATIONS_CREW_ROW_HAS_SHIPMENTS') {
    const crewId = details.find((detail) => detail.code === 'CREW_ROW')?.message;
    if (crewId === undefined) return null;
    const count = Number(details.find((detail) => detail.code === 'COUNT')?.message ?? 0);
    return {
      key: '',
      field: 'remove',
      removed: { crewId, shipments: Number.isFinite(count) ? count : 0 },
    };
  }
  const vehicleReason = failure?.code === undefined ? undefined : VEHICLE_CODE[failure.code];
  const field: PlanRefusalField | null =
    vehicleReason !== undefined
      ? 'vehicle'
      : failure?.code === 'OPERATIONS_UNKNOWN_SHIFT_TYPE'
        ? 'type'
        : failure?.code === 'OPERATIONS_CREW_MEMBER_ABSENT'
          ? 'crew'
          : failure?.code === 'OPERATIONS_CREW_MEMBER_WRONG_SLOT'
            ? 'slot'
            : null;
  if (field === null) return null;
  const index = details.find((detail) => detail.code === 'ROW_INDEX')?.message;
  const row = index === undefined ? undefined : sent[Number(index)];
  if (row === undefined) return null;
  if (field === 'vehicle' && vehicleReason !== undefined) {
    const named = details.find((detail) => detail.field === 'vehicleId')?.message;
    return {
      key: row.key,
      field,
      vehicle: { vehicleId: named ?? row.vehicleId ?? '', reason: vehicleReason },
    };
  }
  if (field === 'crew' || field === 'slot') {
    const named = details.find((detail) => detail.field === 'employeeId');
    const reason = named === undefined ? undefined : PERSON_CODE[field][named.code];
    // Somebody the server names who is not on the row it names: placed on the row, said, unringed.
    if (named === undefined || reason === undefined || !rowPeople(row).includes(named.message)) {
      return { key: row.key, field };
    }
    return { key: row.key, field, person: { employeeId: named.message, reason } };
  }
  return { key: row.key, field };
};

/**
 * A row without a van's number on the board — «بدون سيارة (n)»: its place among the rows without
 * one, from 1 — or null when it is not one of them. Counted on the rows it is NAMED among: a row the
 * save put back (`restoreRemovedRow`) is named by its place once it is back, not by the draft it was
 * missing from (where it has no place, and read «بدون سيارة (0)»).
 */
export const looseRowNumber = (rows: readonly PlanRow[], key: string): number | null => {
  const at = rows.filter((row) => row.vehicleId === null).findIndex((row) => row.key === key);
  return at === -1 ? null : at + 1;
};

/**
 * Round 24 — a deleted row the save refused to delete (it holds محصنات): back on screen where it
 * was, as the server last listed it, so the rest of the save can go and the planner sees which row
 * it was. Before the first row of the answer after it that is still on screen; at the end else.
 * Already on screen (or not in the answer) → the rows as they were.
 *
 * WITHOUT the people the draft has seated elsewhere since: deleting the row freed them, and moving
 * one onto another row before «حفظ» is the ordinary flow. Put back with him, he would sit on two
 * rows (Q11) — and the next save, sending only the row that took him, would be refused for a clash
 * on a row it never touched. He stays where the planner put him; the row comes back without him
 * (so it, too, is sent — emptied of him, which the server allows for a row holding محصنات).
 */
export const restoreRemovedRow = (
  rows: readonly PlanRow[],
  original: readonly PlanRow[],
  crewId: string,
): readonly PlanRow[] => {
  const at = original.findIndex((row) => row.crewId === crewId);
  const saved = original[at];
  if (saved === undefined || rows.some((one) => one.key === saved.key || one.crewId === crewId)) {
    return rows;
  }
  const seatedNow = new Set(rows.flatMap(rowPeople));
  const row = rowPeople(saved)
    .filter((employeeId) => seatedNow.has(employeeId))
    .reduce(without, saved);
  return insertInPlace(rows, original, row);
};

/**
 * A row of the server's answer that is not on screen, put back where the answer had it: before the
 * first row after it in the answer that is still on screen; at the end else.
 */
const insertInPlace = (
  rows: readonly PlanRow[],
  original: readonly PlanRow[],
  row: PlanRow,
): readonly PlanRow[] => {
  const at = original.findIndex((one) => one.key === row.key);
  const onScreen = new Set(rows.map((one) => one.key));
  const next = original.slice(at + 1).find((one) => onScreen.has(one.key));
  const index = next === undefined ? rows.length : rows.findIndex((one) => one.key === next.key);
  return [...rows.slice(0, index), row, ...rows.slice(index)];
};

/**
 * Round 24 — a van GIVEN on this screen taken off its row again: the row back to «بدون سيارة» with
 * everything else it holds now, so another car can be picked from its cell. For the van a save
 * refused (out of service, in the workshop, another desk's since the read): «تراجع» takes back only
 * the LAST operation, which is no longer the van once the planner did anything after giving it.
 *
 *   · a row that took a car where it stands (`takeVehicle` — its key is not the van's): the same
 *     row, in place, without the car;
 *   · a SAVED row without a van merged into a blank roster van (`attachVan`, «X takes V»): X back as
 *     its own row, where the answer had it, with what the van's row holds now — and the van's row
 *     blank again, with the facts the answer gave it.
 *
 * Anything else — a van the row already held at the read, or a row added here and merged into a
 * roster van (saved by the van alone, never refused for it) — the rows as they were, the same array.
 */
export const releaseVan = (
  rows: readonly PlanRow[],
  original: readonly PlanRow[],
  key: string,
): readonly PlanRow[] => {
  const row = rows.find((candidate) => candidate.key === key);
  if (row === undefined || row.vehicleId === null) return rows;
  const vanKey = `van:${row.vehicleId}`;
  if (row.key !== vanKey) {
    return rows.map((candidate) =>
      candidate.key === key
        ? { ...candidate, vehicleId: null, vehicleCode: null, onRoster: false, drivers: [] }
        : candidate,
    );
  }
  const looseKey = row.crewId === null ? null : `loose:${row.crewId}`;
  const van = original.find((candidate) => candidate.key === vanKey);
  const loose = original.find((candidate) => candidate.key === looseKey);
  if (van === undefined || loose === undefined || rows.some((one) => one.key === looseKey)) {
    return rows;
  }
  const content = crewContent(row);
  const emptied = rows.map((candidate) =>
    candidate.key === vanKey ? { ...van, ...crewContent(null) } : candidate,
  );
  return insertInPlace(emptied, original, { ...loose, ...content });
};

/** A row's crew and own fields — what moves with the crew when its van changes. */
const crewContent = (
  row: PlanRow | null,
): Pick<PlanRow, 'slots' | 'direction' | 'plannedTime' | 'shiftTypeId' | 'rowColour' | 'notes'> =>
  row === null
    ? {
        slots: { captain: [], specialist1: [], specialist2: [] },
        direction: null,
        plannedTime: null,
        shiftTypeId: null,
        rowColour: null,
        notes: null,
      }
    : {
        slots: row.slots,
        direction: row.direction,
        plannedTime: row.plannedTime,
        shiftTypeId: row.shiftTypeId,
        rowColour: row.rowColour,
        notes: row.notes,
      };
