// The custody receipt's own number — «EGYCASH-IT-F-14-0001», one more on every print («ابدأ بـ 0001
// وكل طباعة زود رقم»).
//
// The counter is the module's shared allocator (`it_sequences`, one atomic `$inc`), so two people
// printing at once never get the same number. A print BEFORE a hand-over takes a fresh number
// every time — the paper the employee signs carries it, and the hand-over then records that one.
// Numbers a print took and no hand-over recorded are simply skipped: a gap is a paper that was
// printed and not used, which is the truth.
import { BusinessRuleError } from '../../../shared/errors';
import { currentSequenceValue, nextSequenceValue } from '../shared/sequence';

export const RECEIPT_SEQUENCE_KEY = 'custodyReceipt:global';

export const nextReceiptNumber = async (): Promise<number> =>
  nextSequenceValue(RECEIPT_SEQUENCE_KEY);

/**
 * The number a hand-over says its paper carries: one a print actually handed out, or a fresh one
 * when it names none. A number above the counter was never printed — accepting it would let a
 * caller take a number the counter will hand to somebody else's paper later. That it is not
 * already on another receipt is the receipts' unique index's to hold.
 */
export const receiptNumberFor = async (printed: number | undefined): Promise<number> => {
  if (printed === undefined) return nextReceiptNumber();
  if (printed > (await currentSequenceValue(RECEIPT_SEQUENCE_KEY))) {
    throw new BusinessRuleError(
      `receipt number ${printed} was never printed; print the receipt before recording the hand-over`,
    );
  }
  return printed;
};
