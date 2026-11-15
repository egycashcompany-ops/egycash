// The requirement flags as data, plus the decisions «كشف طاقم العمليات» makes: what a row shows,
// which ticks are waiting to be saved, what a save sends, who the filters leave, what the figures
// count.
//
// Round 19 — «عاوز احسن الui بتاع الشاشة دى دا كان القديم برضو القى نظره»: the owner put the legacy
// screen beside this one. What it had that this did not, and what is decided here:
//
//   · a BATCH save. Legacy ticked boxes and pressed «حفظ» once; this screen saved every tick on the
//     spot, so a slip of the finger was already written. The ticks now wait (`PendingFlags`) until
//     «حفظ (n)» sends them, or «تراجع» throws them away;
//   · filters by code, by name, by job title («اختر الوظيفة») — and by what a member holds;
//   · «الوظيفة» on the row, which the roster now carries (`OperationsCrewMemberDto.jobTitle`).
//
// Round 19b — «والغى السيرش بالكود خليه مكان واحد للاسم والكود سوا»: the code search and the name
// search are ONE box, «الاسم أو الكود», that finds a member by either (`matchesNameOrCode`) — the
// table shows the two together now, the name with its code small beside it.
//
// The order below is the order the legacy screen showed its flags (requirement.ejs:393-417) with
// the two that say what a member IS — «قائد», «أخصائي» — moved to the front: they are what the crew
// board's two pools are split by, and the first thing a planner reads on a row.
import {
  type OperationsCrewMemberDto,
  type OperationsCrewRequirementsDto,
  type SetOperationsCrewRequirements,
} from '@ecms/contracts';
import { foldIncludes } from '../../../shared/lib/fold';

export const REQUIREMENT_FLAGS = [
  'isCaptain',
  'isSpecialist',
  'hasWeapon',
  'hasSignature',
  'hasLicense',
  'hasTemporaryLicense',
  'isOpsAdmin',
  'isNewJoiner',
  'isAssignedSpecialTask',
  'isPriority',
] as const;
export type RequirementFlag = (typeof REQUIREMENT_FLAGS)[number];

export const isRequirementFlag = (value: string): value is RequirementFlag =>
  (REQUIREMENT_FLAGS as readonly string[]).includes(value);

/** A row's flags, partly — the ticks one member has waiting. */
export type FlagChanges = Partial<Record<RequirementFlag, boolean>>;

/**
 * The ticks waiting to be saved, by employee: only the cells the reader changed, each with the
 * value it is to be saved as. A cell ticked back to what the server says is not waiting for
 * anything, so it is dropped rather than kept as a change of nothing (`togglePending`).
 */
export type PendingFlags = Readonly<Record<string, FlagChanges>>;

export const NO_PENDING: PendingFlags = {};

/** What the server has for this cell. A member with no row yet carries nothing recorded. */
export const savedFlag = (member: OperationsCrewMemberDto, flag: RequirementFlag): boolean =>
  member.requirements?.[flag] === true;

/** What the cell SHOWS: the reader's waiting tick, or else what is saved. */
export const shownFlag = (
  member: OperationsCrewMemberDto,
  pending: PendingFlags,
  flag: RequirementFlag,
): boolean => pending[member.employeeId]?.[flag] ?? savedFlag(member, flag);

/** This cell differs from what is saved — it is drawn marked, and «حفظ (n)» counts it. */
export const isPendingCell = (
  member: OperationsCrewMemberDto,
  pending: PendingFlags,
  flag: RequirementFlag,
): boolean => {
  const waiting = pending[member.employeeId]?.[flag];
  return waiting !== undefined && waiting !== savedFlag(member, flag);
};

/**
 * One press on a cell's toggle. Pressing a changed cell again puts it back to what is saved, and
 * that is no change at all — the cell leaves the pending set, and the row too once nothing of it
 * is left, so «حفظ (n)» counts only what a save would actually change.
 */
export const togglePending = (
  pending: PendingFlags,
  member: OperationsCrewMemberDto,
  flag: RequirementFlag,
): PendingFlags => {
  const next = !shownFlag(member, pending, flag);
  const row: FlagChanges = { ...(pending[member.employeeId] ?? {}) };
  if (next === savedFlag(member, flag)) delete row[flag];
  else row[flag] = next;
  const out: Record<string, FlagChanges> = { ...pending };
  if (Object.keys(row).length === 0) delete out[member.employeeId];
  else out[member.employeeId] = row;
  return out;
};

/** One member's ticks that still change something, for a member still on the roster. */
export interface PendingRow {
  member: OperationsCrewMemberDto;
  flags: FlagChanges;
}

/**
 * The ticks a save would send, read against the roster AS IT IS NOW: a tick the server has since
 * come to agree with (another planner saved the same) is no change any more, and a member who has
 * left the roster is not written for. Roster order, so a save runs down the table as it reads.
 */
export const pendingRows = (
  members: readonly OperationsCrewMemberDto[],
  pending: PendingFlags,
): PendingRow[] =>
  members.flatMap((member) => {
    const flags: FlagChanges = {};
    for (const flag of REQUIREMENT_FLAGS) {
      const waiting = pending[member.employeeId]?.[flag];
      if (waiting !== undefined && waiting !== savedFlag(member, flag)) flags[flag] = waiting;
    }
    return Object.keys(flags).length === 0 ? [] : [{ member, flags }];
  });

/** How many cells are waiting — «حفظ (n)». */
export const pendingCellCount = (rows: readonly PendingRow[]): number =>
  rows.reduce((sum, row) => sum + Object.keys(row.flags).length, 0);

/**
 * The endpoint upserts the WHOLE row — the legacy screen saved a checkbox line, not a single box —
 * so a save sends every flag: the ones ticked, over what is saved for the rest.
 *
 * A member who has no row yet starts from all-false, which is what an unticked line means. Notes
 * are carried through untouched: this screen does not edit them, and dropping them on a save
 * would silently discard someone else's text.
 */
export const toRowPayload = (
  current: OperationsCrewRequirementsDto | null,
  changes: FlagChanges,
): SetOperationsCrewRequirements => {
  const flag = (name: RequirementFlag): boolean => changes[name] ?? current?.[name] ?? false;
  return {
    isCaptain: flag('isCaptain'),
    isSpecialist: flag('isSpecialist'),
    hasWeapon: flag('hasWeapon'),
    hasSignature: flag('hasSignature'),
    hasLicense: flag('hasLicense'),
    hasTemporaryLicense: flag('hasTemporaryLicense'),
    isOpsAdmin: flag('isOpsAdmin'),
    isNewJoiner: flag('isNewJoiner'),
    isAssignedSpecialTask: flag('isAssignedSpecialTask'),
    isPriority: flag('isPriority'),
    notes: current?.notes ?? null,
  };
};

/** One flag set on a saved row — the single-tick case of `toRowPayload`. */
export const toFlagPayload = (
  current: OperationsCrewRequirementsDto | null,
  flag: RequirementFlag,
  value: boolean,
): SetOperationsCrewRequirements => toRowPayload(current, { [flag]: value });

/** What «حفظ (n)» sends: one whole row per member with a tick waiting, built at the moment of saving. */
export const toSaveRequests = (
  rows: readonly PendingRow[],
): { employeeId: string; body: SetOperationsCrewRequirements }[] =>
  rows.map(({ member, flags }) => ({
    employeeId: member.employeeId,
    body: toRowPayload(member.requirements, flags),
  }));

/**
 * After a save: the ticks of the rows that were NOT saved stay waiting — marked in the table, for
 * another «حفظ» — and the saved rows' ticks go, since the server now says the same.
 */
export const keepUnsaved = (pending: PendingFlags, failed: ReadonlySet<string>): PendingFlags =>
  Object.fromEntries(Object.entries(pending).filter(([employeeId]) => failed.has(employeeId)));

// ── The filters ─────────────────────────────────────────────────────────────────────────────────

/** «الوظيفة»'s answer for a member HR has no seat on file for. */
export const NO_JOB_TITLE = 'none';

export interface RosterFilters {
  /** «الاسم أو الكود» — part of the name OR of the HR code (`matchesNameOrCode`). */
  search: string;
  /** «الوظيفة» — job title ids (or `NO_JOB_TITLE`), any of them. */
  jobs: readonly string[];
  /** «يحمل» — every one of these flags. */
  flags: readonly RequirementFlag[];
}

export const hasRosterFilter = (filters: RosterFilters): boolean =>
  filters.search.trim() !== '' || filters.jobs.length > 0 || filters.flags.length > 0;

/**
 * «الاسم أو الكود»: the typed text is in the name OR in the code — folded as every board folds a
 * search (hamza forms, ى/ي, ة/ه, diacritics, and either keyboard's digits: «٠٠٣٥» finds «0100035»).
 * One box for the two because the table now prints them as one thing, the person; a reader who
 * knows the code types digits, and no member's name has any.
 */
export const matchesNameOrCode = (member: OperationsCrewMemberDto, search: string): boolean =>
  foldIncludes(member.fullNameAr, search) || foldIncludes(member.code, search);

/**
 * What a remembered view (or an old link) from before Round 19b typed in the two boxes, put in the
 * one: the code when one was typed — it narrows to a person, which is what both boxes together
 * could at most leave — else the name, else nothing.
 */
export const searchFromOldBoxes = (code: string | null, name: string | null): string => {
  const typedCode = code?.trim() ?? '';
  return typedCode !== '' ? typedCode : (name?.trim() ?? '');
};

/** Codes in their number order: «0100007» before «0100016», and a short code before a long one. */
const byCode = (a: OperationsCrewMemberDto, b: OperationsCrewMemberDto): number =>
  a.code.localeCompare(b.code, 'en', { numeric: true });

/**
 * The rows the table shows, by code as the legacy roster ran («ID» first): the name or the code
 * matched as the boards match a typed name (`matchesNameOrCode`), any of the chosen job titles,
 * and EVERY chosen flag, as the crew board's pool buttons narrow (cumulative).
 *
 * «يحمل» reads what is SAVED, not the ticks waiting: a member must not vanish from under the
 * reader's pointer the moment a box is unticked under a «قائد» filter, leaving no row to tick back.
 */
export const rosterRows = (
  members: readonly OperationsCrewMemberDto[],
  filters: RosterFilters,
): OperationsCrewMemberDto[] =>
  members
    .filter(
      (member) =>
        matchesNameOrCode(member, filters.search) &&
        (filters.jobs.length === 0 ||
          filters.jobs.includes(member.jobTitle?.id ?? NO_JOB_TITLE)) &&
        filters.flags.every((flag) => savedFlag(member, flag)),
    )
    .sort(byCode);

/**
 * What a member's card says they hold — the flags SAVED for them, in the table's order. What is on
 * file, as «يحمل» reads it: a tick still waiting for «حفظ» is on the row, ringed, and is not
 * something the member holds yet. A member with no row holds nothing recorded.
 */
export const heldFlags = (member: OperationsCrewMemberDto): RequirementFlag[] =>
  REQUIREMENT_FLAGS.filter((flag) => savedFlag(member, flag));

/** «الوظيفة»'s list: the titles on the roster, each once, by name — and whether any member has none. */
export const jobTitleChoices = (
  members: readonly OperationsCrewMemberDto[],
  locale: 'ar' | 'en',
): { titles: { id: string; label: string }[]; anyWithout: boolean } => {
  const titles = new Map<string, string>();
  let anyWithout = false;
  for (const member of members) {
    if (member.jobTitle === null) anyWithout = true;
    else titles.set(member.jobTitle.id, member.jobTitle.name[locale] || member.jobTitle.name.ar);
  }
  return {
    titles: [...titles]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, locale)),
    anyWithout,
  };
};

/**
 * The toolbar's figures, over the rows SHOWN (the filters applied, every page of them): how many,
 * and how many of them are captains and specialists as the table shows them — a tick waiting
 * counts, so the figure moves under the reader's hand as the cell does.
 */
export const rosterFigures = (
  rows: readonly OperationsCrewMemberDto[],
  pending: PendingFlags,
): { members: number; captains: number; specialists: number } => ({
  members: rows.length,
  captains: rows.filter((member) => shownFlag(member, pending, 'isCaptain')).length,
  specialists: rows.filter((member) => shownFlag(member, pending, 'isSpecialist')).length,
});

// ── The save ────────────────────────────────────────────────────────────────────────────────────

/** What a batch save of the roster's ticks came to: who was saved, and who was not, and why. */
export interface RosterSaveResult {
  saved: string[];
  failed: { employeeId: string; error: unknown }[];
}

/**
 * «حفظ (n)»: each waiting row through `put` — the roster's whole-row upsert — ONE AFTER THE OTHER,
 * never two in flight: a planner's save is a handful of rows, and the server is spared a burst.
 *
 * A refused row does not stop the rest and is not thrown: it is reported in `failed` with the
 * server's reason, so the page can mark that row, keep its ticks, and say it once — rather than a
 * toast per row from the global error handler.
 */
export const saveRowsInTurn = async (
  requests: readonly { employeeId: string; body: SetOperationsCrewRequirements }[],
  put: (employeeId: string, body: SetOperationsCrewRequirements) => Promise<unknown>,
): Promise<RosterSaveResult> => {
  const result: RosterSaveResult = { saved: [], failed: [] };
  for (const { employeeId, body } of requests) {
    try {
      await put(employeeId, body);
      result.saved.push(employeeId);
    } catch (error) {
      result.failed.push({ employeeId, error });
    }
  }
  return result;
};
