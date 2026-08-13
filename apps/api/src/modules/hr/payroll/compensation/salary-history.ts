// What the basic salary WAS on a given date (PY-8). PURE.
//
// THE PROBLEM. `employment.salary` is a single current value: a salary change overwrites it, and
// no dated copy of the old one is kept on the employee. So asking "what did March come to?" after
// a June raise used to answer with June's salary — a completed month quietly restating itself, and
// every `percentOfBase` line and every leave shortfall in it changing with a figure recorded
// months later.
//
// THE ANSWER, AND WHY IT NEEDS NO MIGRATION. A dated history already exists: the personnel-action
// log records every salary change with the date it took effect and the value it replaced, and the
// action engine is the ONLY thing that writes `employment.salary` after hire. So the value on any
// past date is recoverable by walking backwards from today's — undoing each change that took
// effect after that date. Nothing has to be written, nothing has to be back-filled, and no date
// has to be invented for an employee whose history predates the log.
//
// WHAT THIS IS NOT. Not a new pay rule. The figure it returns is the same figure the system would
// have shown had it been asked while the month was current; PY-8 only stops that answer from
// drifting afterwards. How the salary is USED — percentages, proration, the leave shortfall — is
// untouched.

/** The same shape the employee document and the calculation both already speak. */
export interface Money {
  amount: number;
  currency: string;
}

/** One applied salary change, as the action log recorded it. */
export interface SalaryChange {
  effectiveDate: Date;
  /** The value this change REPLACED — captured when the action was applied. */
  from: Money | null;
  /** The value it installed. Carried for the reconciliation test, not for the walk. */
  to: Money | null;
}

/** A raw log row, before it is known to carry a well-formed money value. */
export interface RawSalaryChange {
  effectiveDate: Date;
  from: unknown;
  to: unknown;
}

const isMoney = (value: unknown): value is Money =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Money).amount === 'number' &&
  typeof (value as Money).currency === 'string';

/**
 * The log rows this walk can actually use.
 *
 * A row whose `from` is neither money nor an explicit null is not a fact about a salary — it is a
 * shape nobody wrote on purpose — and stepping through it would replace a real figure with a
 * guess. Such rows are DROPPED, which leaves the walk on the last value it could vouch for.
 */
export const readableChanges = (rows: readonly RawSalaryChange[]): SalaryChange[] => {
  const out: SalaryChange[] = [];
  for (const row of rows) {
    if (row.from !== null && !isMoney(row.from)) continue;
    out.push({
      effectiveDate: row.effectiveDate,
      from: row.from === null ? null : row.from,
      to: row.to === null || !isMoney(row.to) ? null : row.to,
    });
  }
  return out;
};

/**
 * The basic salary in force on `at`, reconstructed from today's value.
 *
 * Walks the changes newest first and undoes every one that took effect AFTER the date asked
 * about. A change effective ON that date has already happened, so it stays.
 *
 * With no changes recorded the answer is today's value for every date — which is not a fallback
 * but the truth: a salary nobody ever changed has always been what it is.
 */
export const salaryAsOf = (
  current: Money | null,
  changes: readonly SalaryChange[],
  at: Date,
): Money | null => {
  let value = current;
  const newestFirst = [...changes].sort(
    (a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime(),
  );
  for (const change of newestFirst) {
    if (change.effectiveDate.getTime() <= at.getTime()) break;
    value = change.from;
  }
  return value;
};
