// «تبقى موجودة بس سجل للكرت وبس» — the charges a company sheet says never arrived.
//
// He tops a card up; the company's sheet, read later, is LOWER than the card by that top-up. A ✓
// on the sheet already sets the balance back; with this, the ✓ may also CANCEL the charge the
// sheet does not show: the line stays in the card's log, struck («أُلغي بشيت الشركة»), and no
// longer colours the row green or counts in «شحن اليوم». Nothing is cancelled unless the reader
// ticks it.
//
// AT THE READ the candidates are found and STORED on the session's line — a decision never takes
// the body's word for which charges were candidates. A candidate is a live, uncancelled `charge`
// of a card the sheet is lower on, written after the card's last sheet JUDGEMENT (that sheet has
// already judged anything earlier) and within the last 31 days, newest first. A judgement is any
// sheet that said something about the card: a ✓ decided on it — its `sheetAdjust` line, or the
// `charge` a «اعتماد طلب الرصيد» wrote (no reconciliation line of its own: the session's decided
// line says it) — a ✗ decided on it, or a read that showed it EQUAL (nothing written then: the
// session's `equalCardIds` say it). A ✗ judges AS OF ITS SHEET'S READ, never its decision: unlike
// a ✓ it is not refused when the card moved since, and a top-up written between the read and a
// late ✗ is one that sheet never showed — so its `sheetReject` line's time is not the start point
// (sessions are never deleted: the session's `readAt` stands for every ✗).
//
// AT THE DECISION each named charge must be one of its card's stored candidates, still live and
// uncancelled, and the charges named for one card may not add up to more than the system holds
// above the sheet — to the piastre. Otherwise 422, and nothing is written.
import { Types, type ClientSession } from 'mongoose';
import { ErrorCodes, type FleetFuelReconcileChargeDto } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { cairoDayOf } from '../../fleet-cairo-day';
import { FleetFuelCardMovementModel, type FleetFuelCardMovementDoc } from '../fuel-card.model';
import { type FleetFuelReconcileCharge, type FleetFuelReconcileLine } from './fuel-reconcile.model';
import { fleetFuelReconciliationRepository } from './fuel-reconcile.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back a charge may be a candidate. */
export const CANDIDATE_WINDOW_DAYS = 31;

const piastres = (egp: number): number => Math.round(egp * 100);

/** A candidate as found at the read, with who made it. */
export interface ChargeCandidate extends FleetFuelReconcileCharge {
  by: Types.ObjectId | null;
}

/**
 * The candidates of each card, newest first — for the cards the sheet is LOWER on. One read of the
 * cards' last sheet lines, one of the sessions that judged them, one of their charges.
 */
export const chargeCandidatesOf = async (
  cardIds: readonly string[],
  now: Date,
): Promise<Map<string, ChargeCandidate[]>> => {
  const out = new Map<string, ChargeCandidate[]>();
  if (cardIds.length === 0) return out;
  const ids = cardIds.map((id) => new Types.ObjectId(id));
  const floor = new Date(now.getTime() - CANDIDATE_WINDOW_DAYS * DAY_MS);
  const [decided, judged] = await Promise.all([
    FleetFuelCardMovementModel.aggregate<{ _id: Types.ObjectId; at: Date }>([
      {
        $match: {
          cardId: { $in: ids },
          // A ✗'s `sheetReject` is its DECISION time — the session's read stands for it instead.
          kind: 'sheetAdjust',
          isDeleted: false,
        },
      },
      { $group: { _id: '$cardId', at: { $max: '$at' } } },
    ]).exec(),
    fleetFuelReconciliationRepository.judgedAt(ids),
  ]);
  const since = new Map<string, Date>();
  const later = (cardId: string, at: Date): void => {
    if (at.getTime() > (since.get(cardId) ?? floor).getTime()) since.set(cardId, at);
  };
  for (const row of decided) later(String(row._id), row.at);
  for (const [cardId, at] of judged) later(cardId, at);
  const charges = await FleetFuelCardMovementModel.find({
    kind: 'charge',
    isDeleted: false,
    cancelledBySheet: null,
    $or: ids.map((cardId) => ({ cardId, at: { $gt: since.get(String(cardId)) ?? floor } })),
  })
    .sort({ at: -1, _id: -1 })
    .select({ cardId: 1, amount: 1, at: 1, createdBy: 1 })
    .lean<Pick<FleetFuelCardMovementDoc, '_id' | 'cardId' | 'amount' | 'at' | 'createdBy'>[]>()
    .exec();
  for (const charge of charges) {
    const key = String(charge.cardId);
    out.set(key, [
      ...(out.get(key) ?? []),
      { movementId: charge._id, amount: charge.amount, at: charge.at, by: charge.createdBy },
    ]);
  }
  return out;
};

/** A charge's Cairo day is later than «تاريخ الشيت» — listed apart, never pre-ticked. */
export const isAfterSheetDate = (at: Date, sheetDate: Date | null): boolean =>
  sheetDate !== null && cairoDayOf(at) > sheetDate.toISOString().slice(0, 10);

/** A candidate as the screen reads it. */
export const chargeDto = (
  charge: ChargeCandidate,
  sheetDate: Date | null,
  names: ReadonlyMap<string, string>,
): FleetFuelReconcileChargeDto => ({
  id: String(charge.movementId),
  amount: charge.amount,
  at: charge.at.toISOString(),
  byName: charge.by == null ? null : (names.get(String(charge.by)) ?? null),
  afterSheetDate: isAfterSheetDate(charge.at, sheetDate),
});

type CancelCode = 'NOT_A_CANDIDATE' | 'CANCELLED' | 'EXCEEDS_DIFFERENCE';

const refused = (code: CancelCode, messages: readonly string[]): AppError =>
  new AppError(
    ErrorCodes.FLEET_FUEL_RECONCILE_CANCEL_REFUSED,
    422,
    code === 'EXCEEDS_DIFFERENCE'
      ? 'the charges named for a card add up to more than the sheet takes off it — nothing was written'
      : code === 'CANCELLED'
        ? 'a charge named is already cancelled — nothing was written'
        : 'a charge named is not one this sheet may cancel — nothing was written',
    {
      details: messages.map((message) => ({ field: 'cancelCharges', code, message })),
    },
  );

/**
 * The charges each card's ✓ cancels, from the STORED candidates: every id must be a candidate of
 * a card this decision names, and one card's charges may not exceed what the system holds above
 * the sheet. Throws 422 (`NOT_A_CANDIDATE` / `EXCEEDS_DIFFERENCE`) before anything is written.
 */
export const cancelPlanOf = (
  lines: ReadonlyMap<string, FleetFuelReconcileLine>,
  cardIds: readonly string[],
  cancelIds: readonly string[],
): Map<string, FleetFuelReconcileCharge[]> => {
  const plan = new Map<string, FleetFuelReconcileCharge[]>();
  if (cancelIds.length === 0) return plan;
  const owner = new Map<string, { cardId: string; charge: FleetFuelReconcileCharge }>();
  for (const cardId of cardIds) {
    for (const charge of lines.get(cardId)?.charges ?? []) {
      owner.set(String(charge.movementId), { cardId, charge });
    }
  }
  const strangers = cancelIds.filter((id) => !owner.has(id));
  if (strangers.length > 0) throw refused('NOT_A_CANDIDATE', strangers);
  for (const id of cancelIds) {
    const { cardId, charge } = owner.get(id) as {
      cardId: string;
      charge: FleetFuelReconcileCharge;
    };
    plan.set(cardId, [...(plan.get(cardId) ?? []), charge]);
  }
  const exceeding = [...plan].flatMap(([cardId, charges]) => {
    const line = lines.get(cardId) as FleetFuelReconcileLine;
    const room = piastres(line.systemBalance) - piastres(line.sheetBalance);
    const named = charges.reduce((sum, charge) => sum + piastres(charge.amount), 0);
    return named > room ? [cardId] : [];
  });
  if (exceeding.length > 0) throw refused('EXCEEDS_DIFFERENCE', exceeding);
  return plan;
};

/**
 * The named charges as they are NOW, inside the decision's transaction: each live and not
 * cancelled. Throws 422 (`CANCELLED` / `NOT_A_CANDIDATE`) otherwise.
 */
export const cancellableCharges = async (
  cancelIds: readonly string[],
  session: ClientSession,
): Promise<Map<string, FleetFuelCardMovementDoc>> => {
  if (cancelIds.length === 0) return new Map();
  const docs = await FleetFuelCardMovementModel.find({
    _id: { $in: cancelIds.map((id) => new Types.ObjectId(id)) },
  })
    .session(session)
    .lean<FleetFuelCardMovementDoc[]>()
    .exec();
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  const cancelled = cancelIds.filter((id) => byId.get(id)?.cancelledBySheet != null);
  if (cancelled.length > 0) throw refused('CANCELLED', cancelled);
  const gone = cancelIds.filter((id) => {
    const doc = byId.get(id);
    return doc === undefined || doc.isDeleted || doc.kind !== 'charge';
  });
  if (gone.length > 0) throw refused('NOT_A_CANDIDATE', gone);
  return byId;
};

/** The card's latest live, uncancelled charge other than `excluding` — the green row follows it. */
export const latestLiveChargeAt = async (
  cardId: Types.ObjectId,
  excluding: readonly Types.ObjectId[],
  session: ClientSession,
): Promise<Date | null> => {
  const latest = await FleetFuelCardMovementModel.findOne({
    cardId,
    kind: 'charge',
    isDeleted: false,
    cancelledBySheet: null,
    _id: { $nin: [...excluding] },
  })
    .sort({ at: -1 })
    .select({ at: 1 })
    .session(session)
    .lean<Pick<FleetFuelCardMovementDoc, 'at'>>()
    .exec();
  return latest?.at ?? null;
};
