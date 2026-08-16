// Which cost centre was in force on a given day (P-HR-23, D-CC-7). PURE.
//
// Separated from the service so the rule can be exercised without a database — the same reason
// `pickAssignmentForDate` sits outside the shift-assignment service. Every edge that matters here
// is a boundary condition, and boundary conditions deserve tests that run in milliseconds.

/** The shape this rule needs, and nothing more — so a test can hand it two dates. */
export interface DatedMembership {
  costCenterId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** Inclusive at both ends; an open interval never ends. */
const covers = (row: DatedMembership, on: Date): boolean =>
  row.effectiveFrom.getTime() <= on.getTime() &&
  (row.effectiveTo === null || row.effectiveTo.getTime() >= on.getTime());

/**
 * The centre in force on `on`, or null when the employee held none.
 *
 * Null is an ordinary answer, not a failure (D-CC-5): an employee nobody has placed yet still gets
 * paid, and their payslip simply carries no centre.
 *
 * Overlap is refused at write time, so at most one row can cover a day. The `reduce` is a belt to
 * that brace: if two ever did — a row written before this rule existed, a repair gone wrong — the
 * LATEST anchor wins, deterministically, rather than whichever the database happened to return
 * first. A stable wrong answer can be found and fixed; an unstable one cannot.
 */
export const costCentreOn = (
  rows: readonly DatedMembership[],
  on: Date,
): string | null => {
  const covering = rows.filter((row) => covers(row, on));
  if (covering.length === 0) return null;
  const winner = covering.reduce((best, row) =>
    row.effectiveFrom.getTime() > best.effectiveFrom.getTime() ? row : best,
  );
  return winner.costCenterId;
};
