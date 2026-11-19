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
  addDaysYmd,
  daysBetweenYmd,
  isYmd,
  type OperationsDayBoardPersonDto,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsSecuredDistributionPackagesDto,
  type OperationsSecuredDistributionRowDto,
  type OperationsShipmentDto,
  type SecuredDistributionChange,
} from '@ecms/contracts';
import { record, startHistory, type UndoHistory } from './crew-undo';
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

/**
 * The fields of a van (a crew row of the day) these rules read. `securedType` (Round 25): false for
 * a row of another type kept on the screen for what it already carries — it takes no new shipment.
 * Left out, a van takes shipments (the vault's screen moves nothing).
 */
export type DistributionVan = Pick<
  OperationsDayBoardVehicleCrewDto,
  'crewAssignmentId' | 'vehicleCode' | 'captains' | 'direction'
> & { securedType?: boolean };

/**
 * «تسليم المحصنات»'s day from the URL (`?date=`), or null for the server's default — TODAY in Cairo.
 * Null as well for anything that is not a real calendar day, and for a day BEFORE `today`: the
 * vault hands over today's vans only and reads the days to come as the plan — a past day's vans have
 * left, so a stale bookmark opens on today. (Round 30: «توزيع المحصنات» opens a past day as its
 * record — `readDistributionDay`; the vault's screen keeps this rule.)
 */
export const readDistributionDate = (raw: string | null, today: string): string | null =>
  raw !== null && isYmd(raw) && raw >= today ? raw : null;

/**
 * Round 30 — «عاوز هنا يقدر يجيب اليوم اللى قبله ك رؤيى بس ميقدرش يعدل عليه او يعمل حاجه ك سجل يعنى»:
 * «توزيع المحصنات»'s day from the URL — ANY real calendar day, a past one too (it opens as that day's
 * record, `isRecordDay`); null for the server's default, today in Cairo, and for anything that is
 * not a real day.
 */
export const readDistributionDay = (raw: string | null): string | null =>
  raw !== null && isYmd(raw) ? raw : null;

/**
 * Round 30 — is the screen's day a RECORD: before today? Then it is read only — no drag, no «نقل
 * إلى…», no «توزيع تلقائي», no «تراجع», no «حفظ», no proposal — and the server refuses its save (422
 * `OPERATIONS_DISTRIBUTION_DAY_IN_PAST`) whatever is sent. Judged against EVERY today given.
 * Days are 'YYYY-MM-DD' (they order as text); an empty today is no day and judges nothing. R30
 * critic: the screen asks `isRecordScreen`, which asks this one only before its read is in — once
 * the read is in, the server's `past` decides, never the PC's clock against the read's `today`.
 */
export const isRecordDay = (day: string, ...todays: readonly string[]): boolean =>
  todays.some((today) => today !== '' && day < today);

/** What the screen knows of its read when it judges the day (`isRecordScreen`). */
export interface RecordRead {
  /** The read's `today` ('YYYY-MM-DD') — the SERVER's Cairo day when it answered. */
  today: string;
  /** The read's `past` — the server's word that the day is a record. */
  past: boolean;
  /** The Cairo day on THIS screen's clock when the read arrived ('YYYY-MM-DD'). */
  readOn: string;
}

/**
 * R30 critic — is the SCREEN a record? Once the read is in, the SERVER decides: `past`, and nothing
 * the desk PC's clock says overrides a `past: false` — a clock a day (or a few minutes before
 * midnight) ahead turned today's screen into a record and stopped the desk distributing. The one
 * thing the screen adds is MIDNIGHT PASSING while it stays open: the days its own clock has seen go
 * by since the read arrived (`readOn` to `liveToday`, both on that clock, so a clock set wrong
 * moves both ends alike) move the server's today on by as many — a read of today turns into its
 * record, a read of a day to come does not. Before the read is in, the URL's day against the live
 * Cairo day (`isRecordDay`) — nothing is drawn to move yet.
 */
export const isRecordScreen = (
  day: string,
  liveToday: string,
  read: RecordRead | null,
): boolean => {
  if (read === null) return isRecordDay(day, liveToday);
  if (read.past) return true;
  if (!isYmd(read.readOn) || !isYmd(liveToday) || !isYmd(read.today)) return false;
  const passed = daysBetweenYmd(read.readOn, liveToday);
  return passed > 0 && day < addDaysYmd(read.today, passed);
};

/**
 * R30 critic — «يوم التسليم» changed to `value`: the `?date=` to set (null — none: the server's
 * default, today), and whether the read must be ASKED AGAIN because the URL does not change. A
 * screen opened with no `?date=` and left open past midnight is yesterday's record under the URL
 * of "today": picking today there leaves the URL — and the read's key — as they are, so nothing
 * would be read; it is read again instead (as «العودة إلى اليوم» does).
 */
export const distributionDayChange = (
  current: string | null,
  value: string,
  liveToday: string,
): { date: string | null; reread: boolean } => {
  const date = value === '' || value === liveToday ? null : value;
  return { date, reread: date === current };
};

/**
 * R30 critic — the work on screen a RECORD no longer draws: the changes still in the draft when the
 * day turned into one (the screen left open past midnight with moves not saved — the server refuses
 * a past day's save, so they can never be saved). 0 on a day that can be distributed.
 */
export const unsavedOnRecord = (
  isRecord: boolean,
  rows: readonly DistributionRowFacts[],
  draft: DistributionDraft,
): number => (isRecord ? distributionChanges(rows, draft).length : 0);

/** R30 critic — may «تراجع» take a step back: on a screen that may distribute (never a record), with one to take. */
export const mayUndo = (canEdit: boolean, lastMove: unknown): boolean =>
  canEdit && lastMove !== null && lastMove !== undefined;

/** The fields of a key press the screen's Ctrl+Z reads — a `KeyboardEvent`'s own. */
export type UndoKeyPress = Pick<
  KeyboardEvent,
  'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'code' | 'key' | 'target' | 'preventDefault'
>;

/**
 * R30 critic — Ctrl+Z (⌘Z), as the page registers it on the document. Outside a text box the key
 * is the screen's: it takes back one step when `allowed()` (`mayUndo`) says so, and is swallowed
 * otherwise. In a text box, with Shift or Alt, or any other key: the browser's. On a RECORD
 * `allowed()` is false — the key changes nothing, not even the history kept behind the record.
 */
export const distributionUndoKey =
  (step: {
    allowed: () => boolean;
    undo: () => void;
    inTextBox: (target: EventTarget | null) => boolean;
  }) =>
  (event: UndoKeyPress): void => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
    if (event.code !== 'KeyZ' && event.key.toLowerCase() !== 'z') return;
    if (step.inTextBox(event.target)) return;
    event.preventDefault();
    if (step.allowed()) step.undo();
  };

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
 * Round 25 — and only a row of the «محصنة» type: a row of another type is listed only for what it
 * already carries (the save refuses it — `OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED`), and takes back
 * only a shipment whose SAVED leg is on it (`savedAt` — its `placedCrewAssignmentId`; the save's
 * keep rule), moved off it in the draft.
 */
export const takesShipments = (
  van: Pick<DistributionVan, 'crewAssignmentId' | 'captains' | 'securedType'>,
  savedAt: string | null = null,
): boolean =>
  van.captains.length > 0 && (van.securedType !== false || van.crewAssignmentId === savedAt);

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
 * The same draft — the same shipments, each in the same place, with the same captain, version and
 * mark. What «تراجع» (Round 24, one step back) compares, so a move that changed nothing (a shipment
 * dropped back where it is) is no operation to take back.
 */
export const sameDistributionDraft = (a: DistributionDraft, b: DistributionDraft): boolean =>
  a === b ||
  (a.size === b.size &&
    [...a].every(([id, one]) => {
      const other = b.get(id);
      return (
        other !== undefined &&
        other.crewAssignmentId === one.crewAssignmentId &&
        other.captainEmployeeId === one.captainEmployeeId &&
        other.version === one.version &&
        other.proposed === one.proposed
      );
    }));

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
  vans: readonly Pick<DistributionVan, 'crewAssignmentId' | 'captains' | 'securedType'>[],
  draft: DistributionDraft,
): DistributionDraft => {
  const taking = new Map(
    vans.filter((van) => takesShipments(van)).map((van) => [van.crewAssignmentId, van] as const),
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
 * Round 24 — the history a day's FIRST read starts «تراجع» with. The proposals by direction are the
 * screen's own «توزيع تلقائي», done for the person: ONE operation, the first one — so the last press
 * of «تراجع» takes them back too, as the old «التراجع عن التغييرات» did, and leaves on the cards only
 * what the server holds. Nothing proposed (or nobody who may save) → nothing to take back.
 */
export const openingDistributionHistory = <R extends DistributionRowFacts>(
  rows: readonly R[],
  vans: readonly Pick<DistributionVan, 'crewAssignmentId' | 'captains' | 'securedType'>[],
  canEdit: boolean,
): UndoHistory<DistributionDraft> => {
  const start = startHistory(EMPTY_DRAFT);
  if (!canEdit) return start;
  return record(
    start,
    proposeByDirection(rows, vans, EMPTY_DRAFT),
    { kind: 'auto' },
    {
      same: sameDistributionDraft,
    },
  );
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

/**
 * Why a van's «تسليم» is off — or null when it is on.
 *
 *   · `notToday` — the screen is on another day than TODAY in Cairo. The vault hands a van its load
 *     on the day the van goes out, and on no other: a future day is the PLAN, there to read (and to
 *     print, so a sheet can be ready ahead), but a shipment handed over for tomorrow's van would
 *     leave the vault a day early, with nobody to carry it. This comes first: on a day that is not
 *     today, what the van carries does not matter. It also covers a screen left open past midnight
 *     on yesterday's read — those vans have left.
 *   · `nothing` — on today, nothing on the van is in the vault to hand over (`handoverShipments`).
 *
 * `day` is the day the screen SHOWS (the read's), `today` Cairo's today, both 'YYYY-MM-DD'.
 */
export type HandoverBlock = 'notToday' | 'nothing';

export const handoverBlock = (day: string, today: string, ready: number): HandoverBlock | null =>
  day !== today ? 'notToday' : ready === 0 ? 'nothing' : null;

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

/**
 * Round 25 — «اللى يظهر عدد الكراتين و الحقائب و الصناديق حتى لو ب 0 يتكتب»: the packages a van carries,
 * EVERY kind, summed over its load from the vault's counts (`packagingOf` — the custody's, at its
 * receipt): 0 where the vault counted none of a kind, or holds none of the load yet. Unlike
 * `loadFigures().packages`, never null — the card writes the three counts whatever they are.
 */
export const loadPackages = (
  rows: readonly Pick<DistributionRowFacts, 'id'>[],
  packagingOf: (shipmentId: string) => Packaging | undefined,
): Packaging => {
  const total: Packaging = { bags: 0, cartons: 0, boxes: 0 };
  for (const row of rows) {
    const counted = packagingOf(row.id);
    if (counted === undefined) continue;
    total.bags += counted.bags;
    total.cartons += counted.cartons;
    total.boxes += counted.boxes;
  }
  return total;
};

/**
 * Where the vault's packaging read stands for this reader: 'ready' (its counts are in, so a 0 is a
 * real 0), 'pending' (still on its way), 'failed' (it did not answer, nothing to show) or
 * 'forbidden' (the reader may not read the vault). A refetch that fails after a good read keeps
 * the good read's counts: 'ready'.
 */
export type PackagingRead = 'ready' | 'pending' | 'failed' | 'forbidden';

/**
 * Round 30 — a RECORD's packages (`recordPackages` on the read of a past day): shipment id → its
 * counts at the vault's receipt, held now or SINCE HANDED OVER — the vault's holdings no longer carry
 * what left on the day's vans, so a record read from them would call a van that went out «0». Null
 * when the read carries none (today and every later day, or a reader without the vault's grant):
 * the screen then reads the vault's holdings, as before.
 */
export const recordPackaging = (
  counted: readonly OperationsSecuredDistributionPackagesDto[] | null | undefined,
): ReadonlyMap<string, Packaging> | null =>
  counted === null || counted === undefined
    ? null
    : new Map(
        counted.map(({ shipmentId, bags, cartons, boxes }) => [
          shipmentId,
          { bags, cartons, boxes },
        ]),
      );

export const packagingRead = (
  readable: boolean,
  query: { data: unknown; isError: boolean },
): PackagingRead =>
  !readable
    ? 'forbidden'
    : query.data !== undefined
      ? 'ready'
      : query.isError
        ? 'failed'
        : 'pending';

/**
 * What a van card writes for its packages (Round 25 critic): the load's sum once the vault's
 * counts are in; otherwise why not — null to a reader who cannot read the vault, 'pending' or
 * 'failed' while the read is out or has failed. Never a 0 the screen has not read: the owner
 * asked for the 0 to be written («حتى لو ب 0 يتكتب»), so a guessed 0 would look exactly like a real one.
 */
export const vanPackages = (
  read: PackagingRead,
  rows: readonly Pick<DistributionRowFacts, 'id'>[],
  packagingOf: (shipmentId: string) => Packaging | undefined,
): Packaging | null | 'pending' | 'failed' =>
  read === 'ready' ? loadPackages(rows, packagingOf) : read === 'forbidden' ? null : read;

/**
 * Round 25 — «العربيه لو عليها اتنين قادة انا عاوز اللى يظهر اللى انا ضيفته ف الاول»: the captain a
 * van card shows — the FIRST put on the row (the board's stored order, `captainEmployeeIds[0]`), or
 * null on a row with none.
 */
export const shownCaptain = (
  van: Pick<DistributionVan, 'captains'>,
): OperationsDayBoardPersonDto | null => van.captains[0] ?? null;
