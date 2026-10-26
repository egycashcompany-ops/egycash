// The custody receipt's own number — «EGYCASH-IT-F-14-0001», one more on every print («ابدأ بـ 0001
// وكل طباعة زود رقم»).
//
// The counter is the module's shared allocator (`it_sequences`, one atomic `$inc`), so two people
// printing at once never get the same number. A print BEFORE a hand-over takes a fresh number
// every time — the paper the employee signs carries it, and the hand-over then records that one.
// Numbers a print took and no hand-over recorded are simply skipped: a gap is a paper that was
// printed and not used, which is the truth.
//
// ONE series for two kinds of paper: a device's acknowledgment and a mobile line's (FR-19) are the
// same department form, so they share this counter. They are kept in two collections, though, and
// a unique index holds only within its own — so each hand-over also refuses a printed number the
// OTHER kind of paper already records, and, inside its transaction, CLAIMS the number it records
// (`claimReceiptNumber`): two hand-overs racing on one number cannot both commit, whichever kind
// of paper each is. Within one kind, that collection's `ux_form_number` holds as well.
import { type ClientSession } from 'mongoose';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { claimSequenceValue, currentSequenceValue, nextSequenceValue } from '../shared/sequence';
import { itMobileLineReceiptRepository } from '../mobile-lines/line-receipt.repository';
import { itCustodyReceiptRepository } from './receipt.repository';

export const RECEIPT_SEQUENCE_KEY = 'custodyReceipt:global';

export const nextReceiptNumber = async (): Promise<number> =>
  nextSequenceValue(RECEIPT_SEQUENCE_KEY);

/**
 * A number above the counter was never printed — accepting it would let a caller take a number
 * the counter will hand to somebody else's paper later.
 */
const refuseUnprinted = async (printed: number): Promise<void> => {
  if (printed > (await currentSequenceValue(RECEIPT_SEQUENCE_KEY))) {
    throw new BusinessRuleError(
      `receipt number ${printed} was never printed; print the receipt before recording the hand-over`,
    );
  }
};

/**
 * The number a DEVICE hand-over says its paper carries: one a print actually handed out, or a
 * fresh one when it names none — and not one a mobile line's acknowledgment already records.
 */
export const receiptNumberFor = async (printed: number | undefined): Promise<number> => {
  if (printed === undefined) return nextReceiptNumber();
  await refuseUnprinted(printed);
  if (await itMobileLineReceiptRepository.holdsFormNumber(printed)) {
    throw new BusinessRuleError(
      `receipt number ${printed} is already on a mobile line acknowledgment; print a new receipt for this hand-over`,
    );
  }
  return printed;
};

/**
 * The same judgement for a MOBILE LINE hand-over: a number a print handed out, or the next one —
 * and not one a device receipt already records.
 */
export const mobileLineReceiptNumberFor = async (printed: number | undefined): Promise<number> => {
  if (printed === undefined) return nextReceiptNumber();
  await refuseUnprinted(printed);
  if (await itCustodyReceiptRepository.exists({ formNumber: printed })) {
    throw new BusinessRuleError(
      `receipt number ${printed} is already on a device receipt; print a new acknowledgment for this hand-over`,
    );
  }
  if (await itMobileLineReceiptRepository.holdsFormNumber(printed)) {
    throw new BusinessRuleError(
      `receipt number ${printed} is already on another mobile line acknowledgment; print a new one for this hand-over`,
    );
  }
  return printed;
};

/**
 * Record, inside the hand-over's transaction, that its paper's number is now on a paper — the one
 * place both kinds of paper meet, so a number cannot be recorded twice even by two hand-overs at
 * the same moment. The checks above give the readable refusal first; this is what holds. A 409,
 * as the receipts' own unique index answers a number recorded twice on one kind of paper.
 */
export const claimReceiptNumber = async (
  formNumber: number,
  session: ClientSession,
): Promise<void> => {
  if (!(await claimSequenceValue(RECEIPT_SEQUENCE_KEY, formNumber, session))) {
    throw new ConflictError(
      `receipt number ${formNumber} is already on another paper; print a new receipt for this hand-over`,
    );
  }
};
