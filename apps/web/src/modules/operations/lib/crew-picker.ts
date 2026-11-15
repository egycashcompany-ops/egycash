// «لوحة التشغيلة» — the list a slot opens when it is pressed (Round 22 E).
//
// THE OWNER: «وعاوز مكان عند العربيه زى الحركة كدا لما ادوس عليه يجيب قايمة الناس اللى اختار منهم». On
// Fleet's «الحركة» board an empty seat says «+ اختيار سائق», and pressing it opens the day's drivers to
// pick from (`DriverSlotPicker`). Here every slot with room does the same, so seating somebody never
// depends on a drag — the drag the owner's PC refused («بسحب الاسم بالماوس وبيرجع تانى»).
//
// ONE RULE, TWO GESTURES — as Fleet's picker: this decides nothing of its own. Whether a person may
// be put in the slot is `resolveDrop`'s answer for a drop aimed at that slot, and the pick then runs
// the same `placeMember` the drop runs; so a full slot, somebody away that day, a move off another
// row, are the drop's rules exactly.
//
// WHAT IT LISTS (Round 23) — ONLY WHO FITS THE SLOT: «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى
// حالة انه قائد اخصائى». «قائد الطاقم» lists the captains, then the captain-specialists; «أخصائي 1» and
// «أخصائي 2» list the specialists, then the captain-specialists — «يكونوا فى الاخر». A captain-only is
// never offered for a specialist's slot, nor a specialist for the captain's.
//
// THE CAPTAIN-SPECIALISTS ARE FOLDED IN, NOT A TAB OF THEIR OWN: they close each part of the list,
// as they close «القادة» (`inListOrder` — the pools' own tails). A tab hides the fallback behind a
// press the planner may never make; a part of its own after «في التشغيلة» would put a FREE
// captain-specialist below specialists seated on other vans, whom picking would MOVE off them — the
// free fallback must come before anybody who has to be taken from somewhere. Each is drawn blue.
//
// In that order, cut into three:
//   · FREE — on no row yet;
//   · ON THE BOARD — on another row, or another slot of this one, with where: picking him MOVES him,
//     as the drop does (a person is on one row a day, Q11);
//   · AWAY that day — absent or on leave — listed LAST and closed, with the reason, rather than left
//     out: the planner looking for that name learns why he cannot have him, instead of wondering
//     whether he left the roster. Fleet's touch picker keeps its «غير المتاحين» in view the same way.
// Whoever already sits in this very slot is not offered: there is nothing to do with him here.
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { resolveDrop } from './crew-drag';
import {
  EMPTY_POOL_QUERY,
  awayOf,
  countFree,
  crewRoleOf,
  fitsCrewSlot,
  inListOrder,
  matchesPoolQuery,
  seatOf,
  slotRefusal,
  type CrewAway,
  type CrewRole,
  type CrewSlot,
  type PlanPool,
  type PlanRow,
} from './crew-plan';

/** The pool a slot belongs to — its list's first role, and what an empty list says. */
export const slotPool = (slot: CrewSlot): PlanPool =>
  slot === 'captain' ? 'captains' : 'specialists';

/** The roles a slot's list offers, in the order it lists them: its own, then the blue ones. */
export const slotRoles = (slot: CrewSlot): readonly CrewRole[] =>
  slot === 'captain' ? ['captain', 'dual'] : ['specialist', 'dual'];

/** The three parts of the list, in the order they are shown. */
export const PICK_SECTIONS = ['free', 'seated', 'away'] as const;
export type PickSection = (typeof PICK_SECTIONS)[number];

export interface PickOption {
  member: OperationsCrewMemberDto;
  section: PickSection;
  /** Where he sits now — picking him moves him from there — or null. */
  seat: { key: string; slot: CrewSlot } | null;
  away: CrewAway | null;
  /** May he be put in this slot: exactly what a drop aimed at it would answer. */
  pickable: boolean;
}

/**
 * The list one slot opens — the people who FIT it (`fitsCrewSlot`), the captain-specialists last in
 * each part — narrowed by a search (name or code, folded: the pools' own). `free` counts the ones
 * who can be put on a row now («متاح N»), whatever the search.
 */
export const slotPickList = (
  members: readonly OperationsCrewMemberDto[],
  rows: readonly PlanRow[],
  target: { key: string; slot: CrewSlot },
  search: string,
): { options: PickOption[]; free: number } => {
  const fitting = members.filter((member) =>
    fitsCrewSlot(crewRoleOf(member.requirements), target.slot),
  );
  const options = inListOrder(
    fitting.filter((member) => matchesPoolQuery(member, { ...EMPTY_POOL_QUERY, search })),
    rows,
  )
    .filter((member) => slotRefusal(rows, target.key, target.slot, member.employeeId) !== 'here')
    .map((member): PickOption => {
      const away = awayOf(member);
      const seat = seatOf(rows, member.employeeId);
      const decision = resolveDrop(
        rows,
        { kind: 'slot', key: target.key, slot: target.slot },
        member.employeeId,
        crewRoleOf(member.requirements),
        away,
      );
      return {
        member,
        section: away !== null ? 'away' : seat !== null ? 'seated' : 'free',
        seat,
        away,
        pickable: decision.kind === 'place',
      };
    });
  return { options, free: countFree(fitting, rows) };
};

/**
 * The option the arrow keys go to next from `at` (`step` +1 down, −1 up), skipping the closed ones
 * and wrapping round; -1 when nothing in the list can be picked.
 */
export const nextPickable = (
  options: readonly Pick<PickOption, 'pickable'>[],
  at: number,
  step: 1 | -1,
): number => {
  const count = options.length;
  // Nothing active yet: down starts at the top, up at the bottom.
  const from = at < 0 || at >= count ? (step === 1 ? -1 : count) : at;
  for (let moved = 1; moved <= count; moved += 1) {
    const index = (((from + step * moved) % count) + count) % count;
    if (options[index]?.pickable === true) return index;
  }
  return -1;
};
