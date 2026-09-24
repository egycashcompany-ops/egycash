// «اختار عربيه و جمبها مبلغ ... ينقص من متبقى العربيه و يمنعنى اخد اكتر من المبلغ اللى موجود على
// العربيه» — the arithmetic of moving remaining from one car's files onto another file.
//
// Pure, so every rule here is tested without a database. The service reads the source car's
// files INSIDE its transaction, asks this module what to draw from where, and writes the answer
// in the same transaction.
//
// PIASTRES, NOT POUNDS. Every sum here is done in integers: the lines drawn from the source files
// must add up to exactly the amount the clerk typed, and binary floating point cannot promise
// that of 0.1 + 0.2.
import { fleetAccidentRemaining } from '@ecms/contracts';
import { type Types } from 'mongoose';
import { type FleetAccidentDoc, type FleetAccidentTransfer } from './accident.model';

/** Whole piastres. */
export const toPiastres = (egp: number): number => Math.round(egp * 100);
export const toPounds = (piastres: number): number => piastres / 100;

/** A file's «المتبقي», transfers included — the very figure its row prints. */
export const fileRemaining = (
  doc: Pick<
    FleetAccidentDoc,
    'amountCollected' | 'companyCost' | 'paidAmount' | 'transferredIn' | 'transferredOut'
  >,
): number =>
  fleetAccidentRemaining({
    amountCollected: doc.amountCollected,
    companyCost: doc.companyCost,
    paidAmount: doc.paidAmount,
    transferredIn: doc.transferredIn ?? 0,
    transferredOut: doc.transferredOut ?? 0,
  });

/**
 * A car's «إجمالي المتبقي»: the sum over every one of its live files, open and closed.
 *
 * NET, not the sum of the positive ones: a file paid beyond what it owed lowers the car's total,
 * exactly as it lowers the strip when the table is filtered to that car. That net figure is what
 * the clerk is shown and what a transfer is capped by — the same number in both places.
 */
export const carRemaining = (files: readonly Parameters<typeof fileRemaining>[0][]): number =>
  toPounds(files.reduce((sum, file) => sum + toPiastres(fileRemaining(file)), 0));

/** Oldest first: the day of the accident, then when it was recorded, then its id. */
const olderFirst = (
  a: Pick<FleetAccidentDoc, '_id' | 'occurredAt' | 'createdAt'>,
  b: Pick<FleetAccidentDoc, '_id' | 'occurredAt' | 'createdAt'>,
): number => {
  // A file from the old book that recorded no date is older than any dated one.
  const day = (doc: typeof a): number =>
    doc.occurredAt == null ? -Infinity : doc.occurredAt.getTime();
  const byDay = day(a) - day(b);
  if (byDay !== 0 && !Number.isNaN(byDay)) return byDay;
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return String(a._id).localeCompare(String(b._id));
};

export type TransferSource = Pick<
  FleetAccidentDoc,
  | '_id'
  | 'occurredAt'
  | 'createdAt'
  | 'amountCollected'
  | 'companyCost'
  | 'paidAmount'
  | 'transferredIn'
  | 'transferredOut'
>;

export type Allocation =
  | { ok: true; lines: { accidentId: Types.ObjectId; amount: number }[] }
  | { ok: false; available: number };

/**
 * What to draw from which of the source car's files — «أقدم حادث عليه متبقي الأول».
 *
 * Refused when the amount is more than the car has: `available` is the car's net remaining,
 * floored at zero. Otherwise the files are walked oldest first and each gives what it still owes,
 * until the amount is met. That always completes: the net total never exceeds the sum of the
 * files that still owe something, so an amount within the one is within the other.
 */
export const allocateTransfer = (files: readonly TransferSource[], amount: number): Allocation => {
  const wanted = toPiastres(amount);
  const available = Math.max(0, toPiastres(carRemaining(files)));
  if (wanted <= 0 || wanted > available) return { ok: false, available: toPounds(available) };
  const lines: { accidentId: Types.ObjectId; amount: number }[] = [];
  let left = wanted;
  for (const file of [...files].sort(olderFirst)) {
    if (left === 0) break;
    const owes = toPiastres(fileRemaining(file));
    if (owes <= 0) continue;
    const take = Math.min(owes, left);
    lines.push({ accidentId: file._id, amount: toPounds(take) });
    left -= take;
  }
  return { ok: true, lines };
};

/** The transfers on a file that still count. */
export const liveTransfers = (
  doc: Pick<FleetAccidentDoc, 'transfersIn'>,
): FleetAccidentTransfer[] =>
  (doc.transfersIn ?? []).filter((transfer) => transfer.voidedAt == null);

/** Σ of the live transfers' amounts, rounded to the piastre — what `transferredIn` must hold. */
export const sumLive = (transfers: readonly Pick<FleetAccidentTransfer, 'amount'>[]): number =>
  toPounds(transfers.reduce((sum, transfer) => sum + toPiastres(transfer.amount), 0));

/** `a + b`, to the piastre — for moving a cached figure by a line without float residue. */
export const addMoney = (a: number, b: number): number => toPounds(toPiastres(a) + toPiastres(b));
