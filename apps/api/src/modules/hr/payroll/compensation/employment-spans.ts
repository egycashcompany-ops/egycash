// One reading of "when was this person employed?", shared by the rule that REFUSES an assignment
// outside employment and the calculation that CLIPS at its edges (D3 and D2).
//
// Both have to agree, or the system would accept a row it then declines to price.
//
// `employmentPeriods[]` is the authoritative index — plural, because a rehire opens a new span and
// leaves a gap of unemployment behind it. It is a DERIVED index, though, rebuilt from hire/rehire/
// exit actions, so an employee migrated before it existed can carry an empty array while still
// having a perfectly well-known employment: `hiredAt` is required on every document and `exit`
// holds the leaving date. Falling back to those two is not a guess — it is the same fact, read
// from the fields that are always populated.
import { type EmployeeDoc } from '../../employee-management/employees';
import { type DateSpan } from './compensation-rules';

export const employmentSpansOf = (employee: EmployeeDoc): DateSpan[] => {
  const periods = employee.employmentPeriods ?? [];
  if (periods.length > 0) {
    return periods.map((period) => ({ from: period.hiredAt, to: period.exitedAt }));
  }
  return [{ from: employee.hiredAt, to: employee.exit?.effectiveDate ?? null }];
};

/** Whether a closed span contains a date; an open span contains everything from its start. */
const covers = (span: DateSpan, date: Date): boolean =>
  span.from.getTime() <= date.getTime() && (span.to === null || span.to.getTime() >= date.getTime());

/**
 * The single span that contains the whole interval, or null.
 *
 * BOTH ends must sit in the SAME span, which is what stops an assignment from stepping over the
 * gap between an exit and a rehire — an interval whose ends land in different spans covers a
 * stretch when the person did not work here.
 *
 * An open-ended assignment needs an open span: if employment is known to end, compensation that
 * never ends is a contradiction, and accepting it would leave the calculation to quietly fix.
 */
export const spanContaining = (
  spans: readonly DateSpan[],
  from: Date,
  to: Date | null,
): DateSpan | null =>
  spans.find(
    (span) => covers(span, from) && (to === null ? span.to === null : covers(span, to)),
  ) ?? null;
