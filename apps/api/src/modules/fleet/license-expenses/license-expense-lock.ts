// «مصروفات التراخيص» that «تسوية عهدة» took off the fund can no longer be edited or deleted.
//
// The lock is the RECORD's: one memo of it settled locks both — the settled memo is what the
// letter printed, and its sibling shares the record's date and signatures. It rides every write
// through the repository (`writeConditions`), so a settlement landing between a read and an edit
// is never overtaken; the rules below are the pure half of it, here so they are spelled once.
import { FLEET_LICENSE_EXPENSE_KINDS, type FleetLicenseExpenseKind } from '@ecms/contracts';
import {
  type FleetLicenseExpenseDoc,
  type FleetLicenseExpenseSettlementDoc,
} from './license-expense.model';

type Settled = Pick<FleetLicenseExpenseDoc, 'renewalSettlement' | 'extensionSettlement'>;

/** The field that holds a memo's settlement. */
export const settlementField = (
  part: FleetLicenseExpenseKind,
): 'renewalSettlement' | 'extensionSettlement' =>
  part === 'renewal' ? 'renewalSettlement' : 'extensionSettlement';

/** A memo's settlement — `null` while it waits («لم تُسوَّ بعد»), and on a record from before. */
export const settlementOf = (
  doc: Settled,
  part: FleetLicenseExpenseKind,
): FleetLicenseExpenseSettlementDoc | null => doc[settlementField(part)] ?? null;

/** The day a record was first settled, YYYY-MM-DD — `null` when no memo of it is. */
export const settledDayOf = (doc: Settled): string | null => {
  const days = FLEET_LICENSE_EXPENSE_KINDS.flatMap((part) => {
    const settlement = settlementOf(doc, part);
    return settlement === null ? [] : [settlement.settledAt.toISOString().slice(0, 10)];
  }).sort();
  return days[0] ?? null;
};

/** Any memo settled locks the whole record. */
export const isLicenseExpenseLocked = (doc: Settled): boolean => settledDayOf(doc) !== null;

/**
 * The condition every write must meet, inside the write itself: neither memo settled. A missing
 * field matches `null`, so a record from before settlements existed stays writable.
 */
export const LICENSE_EXPENSE_WRITABLE = Object.freeze({
  renewalSettlement: null,
  extensionSettlement: null,
});

/** Why a write was refused — in English, as every API error is. */
export const licenseExpenseLockedMessage = (id: string, day: string): string =>
  `licence expense ${id} was settled on ${day} — it can no longer be changed or deleted`;
