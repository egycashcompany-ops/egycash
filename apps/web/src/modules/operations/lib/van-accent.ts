// «توزيع المحصنات» and «تسليم المحصنات» — which colour each van wears, and what its hover card says
// (Round 26), as pure rules.
//
// THE OWNER: «عاوزك تضيف الوان عشان حاسس ان مش اقدر اميز اوى العربيه والمحصنات اللى عليها والاعداد
// وكدا», and «لما اقف على العربية يطلع كارت بقى بالقادة والاخصائيين اللى على العربيه والسواقيين».
//
//   · ONE PALETTE. A van's accent is one of «لوحة التشغيلة»'s twenty colours
//     (`OPERATIONS_SHIFT_TYPE_COLOURS`) — no parallel palette. Which one is the van's PLACE among the
//     day's «محصنة» rows (the read's `crews`, by van code then the rows without a van), walked through
//     `VAN_ACCENT_ORDER` — the palette re-ordered so that two vans side by side, or one above the
//     other in a grid of two, three or four, never share a colour, and alternate dark and light
//     (a reader who cannot tell two hues apart still tells a dark stripe from a light one). Past
//     twenty vans the order starts again. The place is the FULL list's, never the filtered one: a
//     filter hides cards, it does not repaint them — and both screens read the same list, so a van
//     wears the same colour on «توزيع المحصنات» and on «تسليم المحصنات».
//   · R26 critic — A COLOUR THAT STAYS. The «محصنة» rows are listed all day, whatever they carry; a
//     row of another type is listed only while it carries a محصنة (Round 25), so it comes and goes
//     with a save, a hand-over or a poll. Those kept rows take their colours AFTER the «محصنة» rows
//     (`vanAccents`): one leaving the list repaints no other van. Only the board's own «محصنة» rows —
//     a row added, removed, or given another van on «لوحة التشغيلة» — move the places after it, as
//     they move the cards themselves: a colour keyed on the van alone (a hash of its code) would
//     stay, but could put two alike side by side, which is what the colours are for.
//   · THE COUNTS — محصنات, كراتين, حقائب, صناديق — each its own fixed colour and icon
//     (`COUNT_KINDS`; the look is `components/distribution-look.ts`), the same everywhere on both
//     screens.
//   · THE VAN'S CARD on hover: everyone on the van, slot by slot, in the order the board added them
//     (`vanCrewGroups`), each slot saying when it is empty, or that the reader may not see it.
import {
  OPERATIONS_SHIFT_TYPE_COLOURS,
  type OperationsDayBoardDriverDto,
  type OperationsDayBoardPersonDto,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsShiftTypeColour,
} from '@ecms/contracts';

export type VanAccent = OperationsShiftTypeColour;

/**
 * The palette in the order vans take it. Dark and light alternate (`ACCENT_TONE`), and no two
 * neighbours — one apart, or two, three or four apart (the card above, at two, three or four cards
 * to a row: 1024–1280, 1366–1440, 1920 and wider — `VAN_GRID` never lays more than four) — share a
 * hue family, nor LOOK alike: their stripes are 17 or more apart in CIEDE2000, 20 or more over the
 * first twelve (`distribution-colours.spec.ts`). The colours that already MEAN something on these
 * screens come last: amber (a proposal, a kept row), rose (a refusal, «بلا قائد») and emerald (the
 * captain's line) — so a day of up to fifteen vans never wears them. R26 critic: their near twins
 * come after the eighth — brown (drawn in amber-800, a proposal's amber), crimson (red-700, beside
 * a refusal's rose) and slate (grey, which reads as no colour) — and the first van, which every
 * day has, wears no count's colour (محصنات indigo, كراتين amber, حقائب teal, صناديق fuchsia).
 * No order that passes `van-accent.spec.ts` and `distribution-colours.spec.ts` keeps those near
 * twins past the eighth (an exhaustive search); of those that keep them that late, this one also
 * puts the counts' colours and forest (beside the captain's green) latest.
 */
export const VAN_ACCENT_ORDER: readonly VanAccent[] = [
  'navy',
  'orange',
  'olive',
  'sky',
  'fuchsia',
  'teal',
  'indigo',
  'gold',
  'brown',
  'pink',
  'forest',
  'cyan',
  'violet',
  'lime',
  'crimson',
  'emerald',
  'slate',
  'amber',
  'plum',
  'rose',
];

/** Whether a colour's stripe is a dark or a light one — what alternates down the list. */
export const ACCENT_TONE: Readonly<Record<VanAccent, 'dark' | 'light'>> = {
  indigo: 'dark',
  orange: 'light',
  forest: 'dark',
  sky: 'light',
  crimson: 'dark',
  gold: 'light',
  violet: 'dark',
  teal: 'light',
  brown: 'dark',
  pink: 'light',
  navy: 'dark',
  lime: 'light',
  fuchsia: 'dark',
  cyan: 'light',
  plum: 'dark',
  amber: 'light',
  olive: 'dark',
  emerald: 'light',
  slate: 'dark',
  rose: 'dark',
};

/** The hue family a colour belongs to — two of one family are never neighbours. */
export const ACCENT_FAMILY: Readonly<Record<VanAccent, string>> = {
  indigo: 'blue',
  orange: 'orange',
  forest: 'green',
  sky: 'cyan',
  crimson: 'red',
  gold: 'yellow',
  violet: 'purple',
  teal: 'teal',
  brown: 'orange',
  pink: 'pink',
  navy: 'blue',
  lime: 'yellow-green',
  fuchsia: 'magenta',
  cyan: 'cyan',
  plum: 'purple',
  amber: 'yellow',
  olive: 'yellow-green',
  emerald: 'green',
  slate: 'grey',
  rose: 'red',
};

/** The accent of the van at `index` (0-based) in the day's list — past twenty, the order again. */
export const vanAccentAt = (index: number): VanAccent => {
  const at = Math.max(0, Math.floor(index)) % VAN_ACCENT_ORDER.length;
  return VAN_ACCENT_ORDER[at] as VanAccent;
};

/** The colours a kept row never wears — drawn in yellow or amber, as its own «kept» marks are. */
const KEPT_SKIPS: ReadonlySet<VanAccent> = new Set<VanAccent>(['gold', 'amber', 'brown']);

/**
 * Every van of the day's list → its accent (the read's `crews`, all of them — never a filtered view
 * of it). R26 critic: the «محصنة» rows (`securedType` not false — listed all day) take the order's
 * places among THEMSELVES, in the list's order; a row of another type, listed only while it carries
 * (Round 25), takes a colour after them — never gold, amber or brown (amber-800), which its own
 * dashed amber edge and its amber «ليس من نوع محصنة» notice already wear. So a kept row leaving the
 * list after a save or a hand-over repaints no other van. A crew row listed twice keeps its first
 * place.
 */
export const vanAccents = (
  vans: readonly (Pick<OperationsDayBoardVehicleCrewDto, 'crewAssignmentId'> & {
    securedType?: boolean;
  })[],
): Map<string, VanAccent> => {
  const accents = new Map<string, VanAccent>();
  let place = 0;
  for (const van of vans) {
    if (van.securedType === false || accents.has(van.crewAssignmentId)) continue;
    accents.set(van.crewAssignmentId, vanAccentAt(place));
    place += 1;
  }
  for (const van of vans) {
    if (van.securedType !== false || accents.has(van.crewAssignmentId)) continue;
    while (KEPT_SKIPS.has(vanAccentAt(place))) place += 1;
    accents.set(van.crewAssignmentId, vanAccentAt(place));
    place += 1;
  }
  return accents;
};

/** The palette is whole in the order — every colour once, nothing else. */
export const accentOrderIsThePalette = (): boolean =>
  VAN_ACCENT_ORDER.length === OPERATIONS_SHIFT_TYPE_COLOURS.length &&
  new Set(VAN_ACCENT_ORDER).size === VAN_ACCENT_ORDER.length &&
  VAN_ACCENT_ORDER.every((colour) => OPERATIONS_SHIFT_TYPE_COLOURS.includes(colour));

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
