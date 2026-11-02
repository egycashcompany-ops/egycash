// «ربط الكروت بالسيارات» (6b) — the pure half of the links section and of «كروت في الشيت وليست في
// النظام»: how the sheet's links are grouped (on a car in the sheet and none here, on another car, on
// none in the sheet, a code nothing answers to — a swapped pair always together, drawn once in the
// group of the card the sheet lists first), what the chassis in the card's name says, what a ✓ / ✗
// sends, and how a sheet-only row fills «إضافة كارت». Nothing here touches React or the network.
//
// The owner's rule: every change is his, row by row («كل تغيير بموافقتي»). Nothing is applied on
// its own; a pair waiting for the card-number repair (`inRepair`) is shown with its ✓ off.
import {
  ErrorCodes,
  FLEET_FUEL_SHEET_NAME_PREFIX,
  FleetFuelCardNameSchema,
  type DecideFleetFuelLinks,
  type FleetFuelCardCompany,
  type FleetFuelCardDto,
  type FleetFuelLinkKind,
  type FleetFuelLinkPlaceDto,
  type FleetFuelLinkResultDto,
  type FleetFuelReconcileDecision,
  type FleetFuelReconcileLinkDto,
  type FleetFuelReconcileNewCardDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { lastFour, maskedPrefixOf, refusedCardIds } from './fuel-reconcile';

/** The groups, in the order the section draws them. */
export const LINK_GROUPS: readonly FleetFuelLinkKind[] = [
  'attach',
  'move',
  'detach',
  'unknownCode',
];

/** One decision row: a card alone, or a swapped pair (decided together). */
export type LinkUnit = readonly [FleetFuelReconcileLinkDto, ...FleetFuelReconcileLinkDto[]];
export interface LinkGroup {
  kind: FleetFuelLinkKind;
  units: LinkUnit[];
  /** The cards in the group's units. */
  cards: number;
}

const idOf = (link: FleetFuelReconcileLinkDto): string => link.card.id.toLowerCase();

/**
 * The links in decision units: by sheet row, each card once; a card whose `pairWith` names
 * another link takes it into its unit (a swap, or a car's card going to a label while another
 * comes onto the car). A unit sits in the group of its first card.
 */
export const linkUnitsOf = (links: readonly FleetFuelReconcileLinkDto[]): LinkUnit[] => {
  const byId = new Map(links.map((link) => [idOf(link), link]));
  const seen = new Set<string>();
  const units: LinkUnit[] = [];
  for (const link of [...links].sort((a, b) => a.sheetRow - b.sheetRow)) {
    if (seen.has(idOf(link))) continue;
    seen.add(idOf(link));
    const other = link.pairWith === null ? undefined : byId.get(link.pairWith.toLowerCase());
    if (other !== undefined && !seen.has(idOf(other))) {
      seen.add(idOf(other));
      units.push([link, other]);
    } else units.push([link]);
  }
  return units;
};

/** The non-empty groups, in `LINK_GROUPS` order. */
export const linkGroupsOf = (links: readonly FleetFuelReconcileLinkDto[]): LinkGroup[] => {
  const units = linkUnitsOf(links);
  return LINK_GROUPS.map((kind) => {
    const mine = units.filter((unit) => unit[0].kind === kind);
    return { kind, units: mine, cards: mine.reduce((sum, unit) => sum + unit.length, 0) };
  }).filter((group) => group.units.length > 0);
};

/** A unit's ✓ waits for the card-number repair («ضمن تصحيح الأرقام»). */
export const unitInRepair = (unit: LinkUnit): boolean => unit.some((link) => link.inRepair);
/** Two cards that swap cars — both `move`. Any other pair exchanges a car and a label. */
export const isSwap = (unit: LinkUnit): boolean =>
  unit.length > 1 && unit.every((link) => link.kind === 'move');

/** Where a card is now, as a link place. */
export const placeOfCard = (card: FleetFuelCardDto): FleetFuelLinkPlaceDto => ({
  vehicleId: card.vehicleId,
  vehicleCode: card.vehicleCode,
  label: card.label,
});

/**
 * What the chassis in the card's name says about the car the sheet names: it belongs to that car
 * (`agrees`), to the car the system has (`differs`), to a third car (`other`), to no car (`none`);
 * for an unknown code it only points at a car for the pick (`info`), never warns.
 */
export type ChassisTone = 'agrees' | 'differs' | 'other' | 'none' | 'info';
export const chassisToneOf = (link: FleetFuelReconcileLinkDto): ChassisTone =>
  link.chassisCar === null
    ? 'none'
    : link.kind === 'unknownCode'
      ? 'info'
      : link.chassisCar === (link.to?.vehicleCode ?? null)
        ? 'agrees'
        : link.chassisCar === link.card.vehicleCode
          ? 'differs'
          : 'other';
/** The chassis part of a card's name — «EGYCASH-8598-783212» → «783212». */
export const chassisOfName = (name: string): string => name.split('-')[2] ?? '';

/** An unknown code's pick, as the section holds it: the car chosen, and «تذكّر هذا الكود». */
export interface LinkPick {
  vehicleId: string;
  remember: boolean;
}
/**
 * The body of a ✓ / ✗ on one unit: its cards; on ✓, each unknown-code card's pick (a car), and
 * `remember` when any of them asked to remember its code. A ✗ never picks.
 */
export const linkBodyOf = (
  unit: LinkUnit,
  decision: FleetFuelReconcileDecision,
  picks: Readonly<Record<string, LinkPick>>,
): DecideFleetFuelLinks => {
  const unknown = unit.filter((link) => link.kind === 'unknownCode');
  const chosen =
    decision === 'apply' ? unknown.map((link) => ({ link, pick: picks[idOf(link)] })) : [];
  return {
    decision,
    cardIds: unit.map(idOf),
    pick: chosen
      .filter(
        (one): one is { link: FleetFuelReconcileLinkDto; pick: LinkPick } => one.pick !== undefined,
      )
      .map(({ link, pick }) => ({ cardId: idOf(link), vehicleId: pick.vehicleId, label: null })),
    remember: chosen.some(({ pick }) => pick?.remember === true),
  };
};
/** A unit's ✓ needs a car picked for each of its unknown codes. */
export const unitPicked = (unit: LinkUnit, picks: Readonly<Record<string, LinkPick>>): boolean =>
  unit.every((link) => link.kind !== 'unknownCode' || (picks[idOf(link)]?.vehicleId ?? '') !== '');

/** A link's decision: the server's answer on this screen, else what the read said. */
export const linkDecisionOf = (
  link: FleetFuelReconcileLinkDto,
  results: Readonly<Record<string, FleetFuelLinkResultDto>>,
): FleetFuelReconcileDecision | null => results[idOf(link)]?.decision ?? link.decision;

/** The card as it stands after a ✓ on its link — for «سجل الكارت» from the section. */
export const cardAfterLink = (
  link: FleetFuelReconcileLinkDto,
  result: FleetFuelLinkResultDto | undefined,
): FleetFuelCardDto => {
  const to = result?.decision === 'apply' ? result.to : null;
  return to === null
    ? link.card
    : { ...link.card, vehicleId: to.vehicleId, vehicleCode: to.vehicleCode, label: to.label };
};

// ── Refusals of a link decision ─────────────────────────────────────────────────────────────────

export type LinkRefusalKind = 'changed' | 'decided' | 'slotHeld' | 'inRepair' | 'pick';
export interface LinkRefusal {
  kind: LinkRefusalKind;
  cardIds: string[];
}
/** What the server refused a link decision for, with the cards it named; `null` for anything else. */
export const linkRefusalOf = (error: unknown): LinkRefusal | null => {
  const named = (code: string, kind: LinkRefusalKind): LinkRefusal | null => {
    const cardIds = refusedCardIds(error, code);
    return cardIds.length > 0 ? { kind, cardIds } : null;
  };
  const pick =
    error instanceof ApiError && error.code === ErrorCodes.VALIDATION_FAILED
      ? (error.details ?? []).filter((detail) => detail.field === 'body.pick')
      : [];
  return (
    named(ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED, 'changed') ??
    named(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, 'decided') ??
    named(ErrorCodes.FLEET_FUEL_LINK_SLOT_HELD, 'slotHeld') ??
    named(ErrorCodes.FLEET_FUEL_LINK_IN_REPAIR, 'inRepair') ??
    (pick.length > 0
      ? { kind: 'pick', cardIds: pick.map((detail) => detail.message.toLowerCase()) }
      : null)
  );
};
/** The link decision's failures the screen words itself (`toastUnlessSaid`). */
export const isLinkRefusal = (error: unknown): boolean => linkRefusalOf(error) !== null;

// ── «إضافة» a sheet-only card ───────────────────────────────────────────────────────────────────

/** The sheet row «إضافة كارت» is filled from. */
export interface FromSheet {
  /** The stored session — the card is added through it. */
  sessionId: string;
  row: number;
  file: string;
  company: FleetFuelCardCompany;
  name: string;
  /** As the sheet prints it — «548**********7791». */
  number: string;
  /** The sheet prints the full number: the box is filled and needs no typing. */
  numberIsFull: boolean;
  /** A masked number's printed start («548») and its last four («7791»). */
  prefix: string;
  last4: string;
  balance: number;
  /** The car the sheet's code names, when its slot for this company is free. */
  vehicleId: string | null;
  /** What a card on no car is called — the sheet's label, when it names one. */
  label: string | null;
}
export const fromSheetOf = (
  row: FleetFuelReconcileNewCardDto,
  session: { id: string; fileName: string; company: FleetFuelCardCompany },
): FromSheet => ({
  sessionId: session.id,
  row: row.sheetRow,
  file: session.fileName,
  company: session.company,
  name: row.name,
  number: row.number,
  numberIsFull: row.numberIsFull,
  prefix: maskedPrefixOf(row.number),
  last4: lastFour(row.number.replace(/\D/gu, '')),
  balance: row.balance,
  // A car already holding a card of this company cannot take another — offer no car then.
  vehicleId: row.slotHeldBy === null ? (row.to?.vehicleId ?? null) : null,
  label: row.to?.vehicleId == null ? (row.to?.label ?? null) : null,
});
/** The typed number fits the sheet's: its last four, and a masked number's printed start. */
export const numberFitsSheet = (typed: string, from: FromSheet): boolean => {
  const digits = typed.replace(/\D/gu, '');
  return digits.endsWith(from.last4) && digits.startsWith(from.prefix);
};

/** The most a card's name may hold (`FleetFuelCardNameSchema`) — what «إضافة» is held to. */
export const CARD_NAME_MAX = FleetFuelCardNameSchema.maxLength ?? 120;

/** The company a card name's prefix says («EGYCASH-» / «EGYCASHTCS-»), as the server reads it. */
const companyOfName = (name: string): FleetFuelCardCompany | null => {
  const normal = name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toUpperCase();
  const prefixes = (
    Object.entries(FLEET_FUEL_SHEET_NAME_PREFIX) as [FleetFuelCardCompany, string][]
  )
    .map(([company, prefix]) => ({ company, prefix: prefix.toUpperCase() }))
    // The longer first: «EGYCASHTCS-» is not read as «EGYCASH-».
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return (
    prefixes.find(({ prefix }) => normal === prefix.replace(/-$/u, '') || normal.startsWith(prefix))
      ?.company ?? null
  );
};

/**
 * Why a sheet-only row cannot be added from the sheet — as the server would refuse it: its name
 * carries the other company's prefix, or is not a card name (longer than `CARD_NAME_MAX`). `null`
 * when «إضافة» may be offered.
 */
export const addCardBlockOf = (
  row: Pick<FleetFuelReconcileNewCardDto, 'name'>,
  company: FleetFuelCardCompany,
): 'nameOtherCompany' | 'nameTooLong' | null => {
  const own = companyOfName(row.name);
  if (own !== null && own !== company) return 'nameOtherCompany';
  return FleetFuelCardNameSchema.safeParse(row.name).success ? null : 'nameTooLong';
};

export type AddCardRefusal =
  | 'numberRequired'
  | 'numberMismatch'
  | 'added'
  | 'nameOtherCompany'
  | 'nameTooLong'
  | 'wrongCompany';

/**
 * What the server refused «إضافة» for: the number missing or not the sheet's, the row already
 * added, the sheet's name not this company's card name (another company's prefix, too long), or
 * the whole sheet another company's; else `null`.
 */
export const addCardRefusalOf = (error: unknown): AddCardRefusal | null => {
  if (!(error instanceof ApiError)) return null;
  if (error.code === ErrorCodes.FLEET_FUEL_SHEET_CARD_NUMBER) {
    return (error.details ?? []).some((detail) => detail.code === 'REQUIRED')
      ? 'numberRequired'
      : 'numberMismatch';
  }
  if (error.code === ErrorCodes.FLEET_FUEL_SHEET_LAYOUT) {
    const said = (field: string, code: string): boolean =>
      (error.details ?? []).some((detail) => detail.field === field && detail.code === code);
    if (said('name', 'WRONG_COMPANY')) return 'nameOtherCompany';
    if (said('name', 'TOO_LONG')) return 'nameTooLong';
    return said('company', 'WRONG_COMPANY') ? 'wrongCompany' : null;
  }
  return error.code === ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED ? 'added' : null;
};
export const isAddCardRefusal = (error: unknown): boolean => addCardRefusalOf(error) !== null;
