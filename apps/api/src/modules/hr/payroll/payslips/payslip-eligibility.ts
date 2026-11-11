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
//      And everyone the company actually PAYS: an external person is in the registry but not on
//      the payroll — see `onThePayroll`.
//
//   2. WHY SOMEBODY GOT NO PAYSLIP. Each answer is a state the calculation can legitimately be
//      in, so the batch records it and carries on. What none of them is, is a payslip: an issued
//      document with a blank where a figure belongs would be worse than an absent one, and
//      "worse than absent" is the whole test being applied here.
import {
  type CompensationEffectsDto,
  type EmployeeOrigin,
  type PayslipSkipReason,
} from '@ecms/contracts';
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
 * Somebody the company PAYS.
 *
 * An external person (تعيين خارجى) is in the registry for one reason: the company hands them
 * things, and everything that hands somebody something — IT custody above all — names an employee.
 * They carry a branch, a department, a job title and an employment period like anybody else, so
 * every other test in this file passes for them, and the title they hold may even have a salary
 * attached. Nothing about the shape of the record says "do not pay this person".
 *
 * So `origin` is what says it, and it is asked FIRST, before any question about dates: a batch that
 * reached the arithmetic for an external person and then declined to issue would be reporting them
 * as a skipped payslip, which is a different and wrong statement.
 */
export const onThePayroll = (employee: { origin: EmployeeOrigin }): boolean =>
  employee.origin !== 'external';

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
