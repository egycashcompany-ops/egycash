// Who gets a payslip, and who is reported instead (PY-7). PURE.
//
// Two questions, both answered here so both can be argued with without a database:
//
//   1. WHO IS IN THE BATCH. Everyone employed for any part of the period — which is NOT the same
//      as everyone employed today. Somebody who left on the 10th worked ten days and is owed for
//      them, and somebody hired on the 25th is owed for six. The employment spans are read with
//      the same `employmentSpansOf` the calculation itself clips by, so the batch and the
//      arithmetic can never disagree about who was employed when.
//
//   2. WHY SOMEBODY GOT NO PAYSLIP. Each answer is a state the calculation can legitimately be
//      in, so the batch records it and carries on. What none of them is, is a payslip: an issued
//      document with a blank where a figure belongs would be worse than an absent one, and
//      "worse than absent" is the whole test being applied here.
import { type CompensationEffectsDto, type PayslipSkipReason } from '@ecms/contracts';
import { type DateSpan } from '../compensation/compensation-rules';

/** Employed for at least one day of the window — both ends inclusive, open spans run on. */
export const employedDuring = (
  spans: readonly DateSpan[],
  window: { from: Date; to: Date },
): boolean =>
  spans.some(
    (span) =>
      span.from.getTime() <= window.to.getTime() &&
      (span.to === null || span.to.getTime() >= window.from.getTime()),
  );

/**
 * Why this calculation cannot become a payslip, or null when it can.
 *
 * The order matters only for the message a reader gets: a calculation with both an unpriced line
 * and no lines at all reports the unpriced one, because that is the condition somebody can act
 * on. `noBasicSalary` and `mixedCurrency` never reach here — PY-3 refuses those before a result
 * exists — and the caller maps its refusal onto the same vocabulary.
 */
export const skipReasonFor = (effects: CompensationEffectsDto): PayslipSkipReason | null => {
  if (effects.deferred.length > 0) return 'pendingLine';
  if (effects.earnings.length === 0 && effects.deductions.length === 0) return 'noLines';
  return null;
};
