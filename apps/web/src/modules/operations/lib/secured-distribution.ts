// «توزيع المحصنات» and «تسليم المحصنات» (Round 12) — the two screens' decisions as pure functions.
//
// The owner: «المحصنة اللى يومها هتخرج هتظهر تلقائى فى شاشة توزيع المحصنات هيكون فيها العربيه اللى
// اتحط عليها القادة والاخصائين والاتجاه هتبقى العربيات على اليمين والمحصنات على الشمال وهشد المحصنة
// احطها على العربيه او المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى ولما يحفظ نفس الشاشة هنعمل
// زيها للخزنة هيكون فوق كل عربيه تسليم وطباعه … بس لما يدوس تسليم المحصنات هتتسلم ساعتها وخلاص مش
// هتبقى ف الخزنة».
//
// WHAT THE SERVER DECIDES, AND WHAT THIS DECIDES. Which shipments and which vans are on the day, where
// each shipment stands now (`placedCrewAssignmentId`) and which vans its area points at
// (`directionCrewAssignmentIds` — `operationsDirectionMatchesArea` in the contracts, the ONE rule the
// server and the screen share) all arrive with the read (`GET /operations/secured/distribution`).
// What is the SCREEN's is the person's work between the read and «حفظ»: a DRAFT of moves made by hand
// or proposed by direction, kept apart from what was read so that
//
//   · «حفظ» sends exactly the shipments whose place differs from the read (`distributionChanges`) —
//     a shipment dragged away and back again is no change, and is not sent;
//   · each change carries the delivery leg's version AS THE PERSON SAW IT when they moved it: a
//     colleague who moved the same shipment since makes the whole save stale (409), rather than the
//     second desk silently undoing the first;
//   · a proposal is visibly a proposal (`proposed`) until it is saved — «تتحط تلقائى» is the screen
//     putting it there, not the person, and the person may still take it off.
//
// The vault's screen reads the same answer and moves nothing: its vans' loads are the SAVED places,
// and «تسليم» sends only the shipments the vault actually holds (`handoverRequest`).
import {
  isYmd,
  type OperationsDayBoardPersonDto,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsSecuredDistributionRowDto,
  type OperationsShipmentDto,
  type SecuredDistributionChange,
} from '@ecms/contracts';
import { boardFigures } from './day-board';

/** The fields of a distribution row these rules read — the specs build rows with no more. */
export type DistributionRowFacts = Pick<
  OperationsSecuredDistributionRowDto,
  | 'id'
  | 'status'
  | 'overdue'
  | 'delivery'
  | 'deliveryLegVersion'
  | 'placedCrewAssignmentId'
  | 'directionCrewAssignmentIds'
>;

/** The fields of a van (a crew row of the day) these rules read. */
export type DistributionVan = Pick<
  OperationsDayBoardVehicleCrewDto,
  'crewAssignmentId' | 'vehicleCode' | 'captains' | 'direction'
>;

/**
 * The day the URL asks for (`?date=`), or null for the server's default — TODAY in Cairo. Null as
 * well for anything that is not a real calendar day, and for a day BEFORE `today`: the server
 * refuses a past day (422 `OPERATIONS_DISTRIBUTION_DAY_IN_PAST` — the boards' «no past day» rule: a
 * past day's vans have left), so a stale bookmark opens on today rather than on a refusal.
 */
export const readDistributionDate = (raw: string | null, today: string): string | null =>
  raw !== null && isYmd(raw) && raw >= today ? raw : null;

/** Where a shipment is: a van of the day and the captain it goes with, or both null — unplaced. */
export interface Placement {
  crewAssignmentId: string | null;
  captainEmployeeId: string | null;
}

export const UNPLACED: Placement = Object.freeze({
  crewAssignmentId: null,
  captainEmployeeId: null,
});

/** One shipment's place in the draft — where the person (or the direction) put it. */
export interface DraftPlacement extends Placement {
  /** The delivery leg's version when it was moved — sent back as the change's `version`. */
  version: number | null;
  /** Put there by direction («توزيع تلقائي»), not by hand — marked on its card until «حفظ». */
  proposed: boolean;
}

/** shipment id → its place in the draft. Only shipments the person (or a proposal) moved are in it. */
export type DistributionDraft = ReadonlyMap<string, DraftPlacement>;

export const EMPTY_DRAFT: DistributionDraft = new Map();

/**
 * Where the READ says the shipment is: the van of THIS day it rides (`placedCrewAssignmentId`) with
 * its leg's captain — or unplaced. A leg on another day's van (an overdue shipment, still on the van
 * of the day it was due) is unplaced HERE: it is not on any of this day's vans.
 */
export const savedPlacement = (
  row: Pick<DistributionRowFacts, 'placedCrewAssignmentId' | 'delivery'>,
): Placement =>
  row.placedCrewAssignmentId === null
    ? UNPLACED
    : {
        crewAssignmentId: row.placedCrewAssignmentId,
        captainEmployeeId: row.delivery?.captainEmployeeId ?? null,
      };

/** The same place — the same van, and (on a van) the same captain. */
export const samePlacement = (left: Placement, right: Placement): boolean =>
  left.crewAssignmentId === right.crewAssignmentId &&
  (left.crewAssignmentId === null || left.captainEmployeeId === right.captainEmployeeId);

/**
 * Has the captain started this delivery in the app? Then the leg is his: the save refuses to move
 * or clear it (409 `OPERATIONS_DISTRIBUTION_LEG_STARTED`), so the screen holds the card where it is
 * — no drag, no «نقل إلى…» — and says why.
 */
export const isStartedLeg = (row: Pick<DistributionRowFacts, 'delivery'>): boolean =>
  row.delivery !== null && row.delivery.executionStatus !== 'pending';

/**
 * Can this van take a shipment? Only one with a captain: a shipment goes WITH a captain (the save
 * refuses a van without one — `OPERATIONS_CREW_CAPTAIN_MISMATCH`). It is still listed, said empty.
 */
export const takesShipments = (van: Pick<DistributionVan, 'captains'>): boolean =>
  van.captains.length > 0;

/** Where the shipment is on the screen now: the draft's place, else the read's. */
export const placementOf = (
  row: Pick<DistributionRowFacts, 'id' | 'placedCrewAssignmentId' | 'delivery'>,
  draft: DistributionDraft,
): Placement => {
  const entry = draft.get(row.id);
  return entry === undefined
    ? savedPlacement(row)
    : { crewAssignmentId: entry.crewAssignmentId, captainEmployeeId: entry.captainEmployeeId };
};

/** A proposal not yet saved — the card says so («مقترحة»). */
export const isProposed = (
  row: Pick<DistributionRowFacts, 'id'>,
  draft: DistributionDraft,
): boolean => draft.get(row.id)?.proposed === true;

/**
 * The draft with one shipment put somewhere — a van and its captain, or `UNPLACED` («إزالة», or
 * dragged back to the left). Moved back to where the read has it, it leaves the draft: nothing to
 * save for it. A started leg does not move (`isStartedLeg`): the draft comes back as it was.
 */
export const placeShipment = <R extends DistributionRowFacts>(
  draft: DistributionDraft,
  row: R,
  placement: Placement,
): DistributionDraft => {
  if (isStartedLeg(row)) return draft;
  // Both or neither — the save's own rule (`SecuredDistributionChangeSchema`).
  const target =
    placement.crewAssignmentId === null || placement.captainEmployeeId === null
      ? UNPLACED
      : placement;
  const next = new Map(draft);
  if (samePlacement(target, savedPlacement(row))) next.delete(row.id);
  else
    next.set(row.id, {
      crewAssignmentId: target.crewAssignmentId,
      captainEmployeeId: target.captainEmployeeId,
      // The leg as the person sees it NOW — the read they decided on.
      version: row.deliveryLegVersion,
      proposed: false,
    });
  return next;
};

/**
 * The captain a shipment goes with when it lands on a van: the one it already has there (dropped
 * again on its own van, it keeps him), else the van's FIRST captain — «the shipment goes with the
 * van's first captain, switchable on the van card». Null for a van with no captain.
 */
export const landingCaptain = (
  van: Pick<DistributionVan, 'crewAssignmentId' | 'captains'>,
  current: Placement,
): string | null => {
  if (
    current.crewAssignmentId === van.crewAssignmentId &&
    current.captainEmployeeId !== null &&
    van.captains.some((captain) => captain.employeeId === current.captainEmployeeId)
  ) {
    return current.captainEmployeeId;
  }
  return van.captains[0]?.employeeId ?? null;
};

/**
 * The draft with a shipment dropped on a van — the drag's drop and «نقل إلى…»'s choice.
 *
 * Dropped back on the van the READ has it on, it goes back to the captain the read has too — not
 * the van's first: on a two-captain van, a shipment saved with the second captain, dragged away and
 * back, is where it was (no change to save), as the header of this file promises.
 */
export const moveToVan = <R extends DistributionRowFacts>(
  draft: DistributionDraft,
  row: R,
  van: Pick<DistributionVan, 'crewAssignmentId' | 'captains'>,
): DistributionDraft => {
  const current = placementOf(row, draft);
  const captain = landingCaptain(
    van,
    current.crewAssignmentId === van.crewAssignmentId ? current : savedPlacement(row),
  );
  if (captain === null) return draft;
  return placeShipment(draft, row, {
    crewAssignmentId: van.crewAssignmentId,
    captainEmployeeId: captain,
  });
};

/**
 * The van's NEXT captain after this one, in the van's order — what the captain chip on a card of a
 * two-captain van switches to. The van's only captain (or none) answers null: nothing to switch.
 */
export const nextCaptain = (
  van: Pick<DistributionVan, 'captains'>,
  current: string | null,
): OperationsDayBoardPersonDto | null => {
  if (van.captains.length < 2) return null;
  const at = van.captains.findIndex((captain) => captain.employeeId === current);
  return van.captains[(at + 1) % van.captains.length] ?? null;
};

/**
 * AUTO BY DIRECTION — «المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى». Every shipment UNPLACED
 * on the screen (by the read or by the draft), whose leg has not started and whose area points at
 * EXACTLY ONE of the day's vans that can take it, is proposed onto that van, with its first captain.
 * None or several → left for the person: two vans of one direction is a choice the screen does not
 * make for them. A shipment already on a van is never moved by a proposal.
 *
 * Run on the day's first read and again on «توزيع تلقائي». The van ids are the server's
 * (`directionCrewAssignmentIds`), kept to the vans listed now.
 */
export const proposeByDirection = <R extends DistributionRowFacts>(
  rows: readonly R[],
  vans: readonly Pick<DistributionVan, 'crewAssignmentId' | 'captains'>[],
  draft: DistributionDraft,
): DistributionDraft => {
  const taking = new Map(
    vans.filter(takesShipments).map((van) => [van.crewAssignmentId, van] as const),
  );
  const next = new Map(draft);
  for (const row of rows) {
    if (isStartedLeg(row)) continue;
    if (placementOf(row, next).crewAssignmentId !== null) continue;
    const matches = [...new Set(row.directionCrewAssignmentIds)].filter((id) => taking.has(id));
    if (matches.length !== 1) continue;
    const van = taking.get(matches[0] as string);
    const captain = van?.captains[0]?.employeeId;
    if (van === undefined || captain === undefined) continue;
    next.set(row.id, {
      crewAssignmentId: van.crewAssignmentId,
      captainEmployeeId: captain,
      version: row.deliveryLegVersion,
      proposed: true,
    });
  }
  return next;
};

/**
 * «حفظ»'s changes — one per shipment whose place on the screen differs from the read, in the read's
 * order; the change carries the version the draft took when it was moved. Left out: a shipment
 * moved back to where it was, one whose leg has started since (the save would refuse it), and one no
 * longer on the screen (dispatched or deleted since — the read no longer lists it). An unplaced
 * shipment left unplaced is no change, even when its leg rides another day's van.
 */
export const distributionChanges = <R extends DistributionRowFacts>(
  rows: readonly R[],
  draft: DistributionDraft,
): SecuredDistributionChange[] =>
  rows.flatMap((row) => {
    const entry = draft.get(row.id);
    if (entry === undefined || isStartedLeg(row)) return [];
    if (samePlacement(entry, savedPlacement(row))) return [];
    return [
      {
        shipmentId: row.id,
        crewAssignmentId: entry.crewAssignmentId,
        captainEmployeeId: entry.captainEmployeeId,
        version: entry.version,
      },
    ];
  });

/** The body of `POST /operations/secured/distribution` — the day, and every change in ONE request. */
export interface SecuredDistributionSaveBody {
  /** 'YYYY-MM-DD' — the day distributed. */
  date: string;
  changes: SecuredDistributionChange[];
}

/** «حفظ»: the request, or null when there is nothing to save (the button is off then). */
export const distributionSaveBody = <R extends DistributionRowFacts>(
  date: string,
  rows: readonly R[],
  draft: DistributionDraft,
): SecuredDistributionSaveBody | null => {
  const changes = distributionChanges(rows, draft);
  return changes.length === 0 ? null : { date, changes };
};

/** One van and the shipments on it (in the read's order). */
export interface VanLoad<V, R> {
  van: V;
  rows: R[];
}

/**
 * The two columns: each van with its load (the vans in the read's order — by van code), and the
 * shipments on no van of the day (the left column). A place naming a van the read no longer lists
 * (re-planned meanwhile) counts as unplaced, so no shipment ever disappears from the screen.
 */
export const distributionColumns = <
  V extends Pick<DistributionVan, 'crewAssignmentId'>,
  R extends DistributionRowFacts,
>(
  rows: readonly R[],
  vans: readonly V[],
  draft: DistributionDraft,
): { vans: VanLoad<V, R>[]; unplaced: R[] } => {
  const loads = vans.map((van) => ({ van, rows: [] as R[] }));
  const byId = new Map(loads.map((load) => [load.van.crewAssignmentId, load]));
  const unplaced: R[] = [];
  for (const row of rows) {
    const at = placementOf(row, draft).crewAssignmentId;
    const load = at === null ? undefined : byId.get(at);
    if (load === undefined) unplaced.push(row);
    else load.rows.push(row);
  }
  return { vans: loads, unplaced };
};

/**
 * Will saving move this shipment's DELIVERY DAY? An overdue shipment («متأخرة» — in the vault, its
 * delivery day already past: before TODAY, the server's `overdue`, not merely before the screen's
 * day) placed on a van of the day is re-dated to the day by the save — the one
 * change a received محصنة takes, because it is a flow act: it goes out later than planned.
 */
export const reschedulesOnSave = (
  row: Pick<DistributionRowFacts, 'id' | 'overdue' | 'placedCrewAssignmentId' | 'delivery'>,
  draft: DistributionDraft,
): boolean => row.overdue && placementOf(row, draft).crewAssignmentId !== null;

// ── «تسليم المحصنات» — the vault hands each van its load ─────────────────────────────────────────

/**
 * What «تسليم» hands over for a van: the shipments SAVED on it (`placedCrewAssignmentId`) that the
 * vault HOLDS (`inVault`). They leave the vault on the click — «هتتسلم ساعتها وخلاص مش هتبقى ف
 * الخزنة».
 */
export const handoverShipments = <
  R extends Pick<DistributionRowFacts, 'status' | 'placedCrewAssignmentId'>,
>(
  rows: readonly R[],
  crewAssignmentId: string,
): R[] =>
  rows.filter((row) => row.placedCrewAssignmentId === crewAssignmentId && row.status === 'inVault');

/**
 * The shipments on the van that the vault does NOT hold yet — booked, with the captain, or with
 * Operations (`draft`). Listed under the van, never sent: the dispatch refuses a shipment the vault
 * has not received (422 `OPERATIONS_INVALID_SHIPMENT_TRANSITION`) — it cannot hand over what it
 * does not hold.
 */
export const notYetInVault = <
  R extends Pick<DistributionRowFacts, 'status' | 'placedCrewAssignmentId'>,
>(
  rows: readonly R[],
  crewAssignmentId: string,
): R[] =>
  rows.filter((row) => row.placedCrewAssignmentId === crewAssignmentId && row.status !== 'inVault');

/** The dispatch a van's «تسليم» sends — `POST /operations/secured/dispatch` — or null with nothing to hand over. */
export const handoverRequest = <
  R extends Pick<DistributionRowFacts, 'id' | 'status' | 'placedCrewAssignmentId'>,
>(
  rows: readonly R[],
  crewAssignmentId: string,
): { crewAssignmentId: string; shipmentIds: string[] } | null => {
  const ids = handoverShipments(rows, crewAssignmentId).map((row) => row.id);
  return ids.length === 0 ? null : { crewAssignmentId, shipmentIds: ids };
};

/** A person's name as the cards print it — «…» where the directory could not name them. */
export const personName = (person: Pick<OperationsDayBoardPersonDto, 'fullNameAr'>): string =>
  person.fullNameAr ?? '…';

/** The captain a placement goes with, among the van's captains — null when not one of them. */
export const captainOn = (
  van: Pick<DistributionVan, 'captains'>,
  employeeId: string | null,
): OperationsDayBoardPersonDto | null =>
  van.captains.find((captain) => captain.employeeId === employeeId) ?? null;

// ── Each van's load, in figures ──────────────────────────────────────────────────────────────────

/** The packages the vault counted on receipt (custody) — what a van carries out, bag by bag. */
export interface Packaging {
  bags: number;
  cartons: number;
  boxes: number;
}

/** What a van carries — «counts and totals per van»: the figures the boards print, over its load. */
export interface LoadFigures {
  count: number;
  egp: number;
  usd: number;
  /** «عملات أخرى» — every currency but the pound and the dollar, summed (the boards' third pill). */
  othersSum: number;
  /**
   * The packages, summed over the shipments the vault has counted — null when none of the load has
   * a count to read (nothing received yet, or a reader who may not read the vault's custody).
   */
  packages: Packaging | null;
}

/**
 * The load's figures: how many, the pound, the dollar and «عملات أخرى» by the boards' own rule
 * (`boardFigures` — the currency told apart by code, name or legacy alias), and the packages where
 * the vault counted them (`packagingOf`, the custody's counts; undefined for one it has not).
 */
export const loadFigures = (
  rows: readonly OperationsShipmentDto[],
  currencyOf: Parameters<typeof boardFigures>[1],
  packagingOf: (shipmentId: string) => Packaging | undefined = () => undefined,
): LoadFigures => {
  const { egp, usd, othersSum } = boardFigures(rows, currencyOf);
  let packages: Packaging | null = null;
  for (const row of rows) {
    const counted = packagingOf(row.id);
    if (counted === undefined) continue;
    packages ??= { bags: 0, cartons: 0, boxes: 0 };
    packages.bags += counted.bags;
    packages.cartons += counted.cartons;
    packages.boxes += counted.boxes;
  }
  return { count: rows.length, egp, usd, othersSum, packages };
};

// ── A refused save ──────────────────────────────────────────────────────────────────────────────

/**
 * The shipment a refused save names. Every refusal of the save but the past day's carries it
 * (`details: [{ field: 'shipmentId', code: 'SHIPMENT', message: <id> }]`), so the screen can mark
 * that card; null when the refusal names none.
 */
export const refusedShipmentId = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null || !('details' in error)) return null;
  const details = (error as { details?: unknown }).details;
  if (!Array.isArray(details)) return null;
  for (const detail of details as { field?: unknown; message?: unknown }[]) {
    if (detail.field === 'shipmentId' && typeof detail.message === 'string') return detail.message;
  }
  return null;
};

/**
 * The draft without one shipment's move — after a refusal that names it. Nothing was written (the
 * save is all or nothing), and the screen has been read again, so its card goes back to where the
 * server says it is NOW — a colleague's move, a hand-over, a captain's start — and the person's
 * other moves stay, to be saved without it.
 */
export const withoutShipment = (
  draft: DistributionDraft,
  shipmentId: string,
): DistributionDraft => {
  if (!draft.has(shipmentId)) return draft;
  const next = new Map(draft);
  next.delete(shipmentId);
  return next;
};
