// «توزيع المحصنات» and «تسليم المحصنات» — what a van card counts, and what the van's hover card says
// (Round 26), as pure rules.
//
// THE OWNER: «لما اقف على العربية يطلع كارت بقى بالقادة والاخصائيين اللى على العربيه والسواقيين».
//
// Round 26b — «لا استنى الالوان مش عجبانى بتاعت العربيه», then «لون واحد لكل العربيات»: the per-van
// colour of Round 26 (a palette colour by the van's place in the day's list) is gone — every van card
// wears the same calm look (`components/distribution-look.ts`, `VAN_LOOK`). What stays here:
//   · THE COUNTS — محصنات, كراتين, حقائب, صناديق — the kinds a van card counts, in the order every
//     screen writes them; each kind's colour and icon is `COUNT_LOOK` (the look file);
//   · THE VAN'S CARD on hover: everyone on the van, slot by slot, in the order the board added them
//     (`vanCrewGroups`), each slot saying when it is empty, or that the reader may not see it; and
//     when resting on (or tapping) the van opens it (`vanHoverAllowed`, `vanTapAllowed`).
import {
  type OperationsDayBoardDriverDto,
  type OperationsDayBoardPersonDto,
  type OperationsDayBoardVehicleCrewDto,
} from '@ecms/contracts';

// ── The counts ──────────────────────────────────────────────────────────────────────────────────

/** What a van carries, in the order every screen writes it: the محصنات, then the vault's packages. */
export const COUNT_KINDS = ['shipments', 'cartons', 'bags', 'boxes'] as const;
export type CountKind = (typeof COUNT_KINDS)[number];

/** The packages, in the owner's order («الكراتين و الحقائب و الصناديق»). */
export const PACKAGE_KINDS = ['cartons', 'bags', 'boxes'] as const satisfies readonly CountKind[];

// ── The van's hover card ────────────────────────────────────────────────────────────────────────

/** One person on the van's card — a captain, a specialist, or a driver (by name only). */
export interface VanCardPerson {
  employeeId: string;
  /** Null where the directory cannot name him — the card says «…», never an id. */
  name: string | null;
  /** The employee code; never a driver's (Fleet keeps a driver's details). */
  code: string | null;
  /** The captain the van card shows — the FIRST put on the row (Round 25). */
  shown: boolean;
}

/** One slot of the van's card. */
export interface VanCardGroup {
  slot: 'captains' | 'specialist1' | 'specialist2' | 'drivers';
  /**
   * `people` — who is in it; `empty` — nobody («لا يوجد»); `hidden` — the reader may not see it
   * (without `operationsCrew.view` the read sends the specialists and the drivers empty: an empty
   * slot is then NOT «nobody»); `noVan` — the drivers of a crew with no van: there is no van to
   * drive.
   */
  state: 'people' | 'empty' | 'hidden' | 'noVan';
  people: VanCardPerson[];
}

const person = (one: OperationsDayBoardPersonDto, shown = false): VanCardPerson => ({
  employeeId: one.employeeId,
  name: one.fullNameAr,
  code: one.code,
  shown,
});

const driver = (one: OperationsDayBoardDriverDto): VanCardPerson => ({
  employeeId: one.employeeId,
  name: one.fullNameAr,
  code: null,
  shown: false,
});

/**
 * What the van's hover card lists — «بالقادة والاخصائيين اللى على العربيه والسواقيين»: the captains
 * (EVERY one, in the order put on the row, the first marked as the one the card shows), «أخصائي 1»
 * and «أخصائي 2» (everyone in each), and the drivers by name (Fleet's duty row for the van and day).
 * `crewPlanVisible` false: the read withheld the specialists and the drivers — said, not «nobody».
 */
export const vanCrewGroups = (
  van: Pick<
    OperationsDayBoardVehicleCrewDto,
    'vehicleId' | 'captains' | 'specialist1' | 'specialist2' | 'drivers'
  >,
  crewPlanVisible: boolean,
): VanCardGroup[] => {
  const of = (
    slot: VanCardGroup['slot'],
    people: VanCardPerson[],
    withheld: boolean,
  ): VanCardGroup => ({
    slot,
    state: people.length > 0 ? 'people' : withheld ? 'hidden' : 'empty',
    people,
  });
  const drivers: VanCardGroup =
    van.vehicleId === null && van.drivers.length === 0
      ? { slot: 'drivers', state: 'noVan', people: [] }
      : of('drivers', van.drivers.map(driver), !crewPlanVisible);
  return [
    of(
      'captains',
      van.captains.map((one, index) => person(one, index === 0)),
      false,
    ),
    of(
      'specialist1',
      van.specialist1.map((one) => person(one)),
      !crewPlanVisible,
    ),
    of(
      'specialist2',
      van.specialist2.map((one) => person(one)),
      !crewPlanVisible,
    ),
    drivers,
  ];
};

/**
 * Does a pointer resting on the van open its card now? Not while a drag is on (Round 25's drop is
 * the screen's, and a card must never float over the vans the hand is aiming at), not while a
 * «نقل إلى…» menu is open (Round 25's F2 rule: no card over the menu's vans), and not on a captain's
 * name — that opens his own person card («لوحة التشغيلة»'s), as a name does on every board.
 */
export const vanHoverAllowed = (state: {
  dragging: boolean;
  menuOpen: boolean;
  onPerson: boolean;
}): boolean => !state.dragging && !state.menuOpen && !state.onPerson;

/**
 * Does a tap on the van open (or close) its card? A phone has no hover: a TOUCH on the head or the
 * captain's line does — but not on the captain's own name, which is his (R26 critic: the pointer
 * path skipped the name, the tap path did not). A mouse click is the hover's business.
 */
export const vanTapAllowed = (state: { touch: boolean; onPerson: boolean }): boolean =>
  state.touch && !state.onPerson;
