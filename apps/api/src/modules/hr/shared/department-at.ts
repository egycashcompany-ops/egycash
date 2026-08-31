// Which department was an employee in on a given date? (P-SCOPE-1, D-DEPT-3)
//
// IT LIVES IN `shared/` FOR THE REASON `employee-labels.ts` DOES. The backfill needs this rule in
// four collections across three features, and payroll may not name a loan collection while the
// adjustments model is reachable from three files only — so one migration importing them all is
// architecturally impossible here, and correctly so. What every feature CAN share is the rule
// itself, which touches no collection at all.
//
// Pure, and deliberately so: this is the one piece of the backfill that can be wrong in a way no
// integration test would notice — a payslip silently attributed to the department the employee
// moved to a year LATER. The rule is small enough to state completely and to test exhaustively,
// so it lives here with no database in sight and the migration becomes a loop around it.
//
// THE RULE. A transfer records `{ field: 'departmentId', from, to }` with an `effectiveDate`
// (`employee-action.service.ts:593`). So for a date D:
//
//   · the LATEST move whose effectiveDate <= D  → its `to`     — the department D fell inside
//   · else the EARLIEST recorded move           → its `from`   — where they were before any move
//   · else                                      → the current  — no move was ever recorded
//
// The middle case is the one worth naming: an employee transferred in 2026 has moves on file, and
// a 2025 payslip predates all of them. Falling back to the CURRENT department there would be
// exactly the error this function exists to prevent — the answer is the `from` of the first move,
// which is a recorded fact rather than today's state.

import { toDateOnly } from './business-date';

/** One recorded department move, as the action log stores it. */
export interface DepartmentMove {
  from: string | null;
  to: string | null;
  effectiveDate: Date;
}

/**
 * The department in force at `at`, or null when nothing can be established.
 *
 * `moves` need not be sorted — the caller reads them however the query returned them, and the
 * ordering that matters is applied here rather than being a precondition somebody must remember.
 */
export const departmentAt = (
  moves: readonly DepartmentMove[],
  at: Date,
  current: string | null,
): string | null => {
  if (moves.length === 0) return current;

  // Both sides are normalized to a business date before anything is compared. The action log
  // stores `effectiveDate` as `new Date()` for a move taking effect today, so it carries a TIME,
  // while `at` is a date-only boundary — a payslip's period end. Compared raw, a transfer recorded
  // on the LAST DAY of a month sorted after that month's end and the walk treated it as not yet in
  // force, attributing the month to the department the employee had just left. On every other day
  // the time-of-day fell below the boundary and the same code was right, which is how a rule this
  // small stayed wrong: it only ever failed one day in thirty.
  const ordered = [...moves].sort(
    (a, b) => toDateOnly(a.effectiveDate).getTime() - toDateOnly(b.effectiveDate).getTime(),
  );

  // The last move that had already taken effect by `at`.
  const on = toDateOnly(at).getTime();
  let inForce: DepartmentMove | undefined;
  for (const move of ordered) {
    if (toDateOnly(move.effectiveDate).getTime() <= on) inForce = move;
    else break;
  }

  // Before every recorded move: where the first one says they came FROM.
  if (inForce === undefined) return ordered[0]?.from ?? current;

  // `to` is null only if a move recorded no destination, which the action schema does not produce;
  // treating it as "unknown" rather than "cleared" keeps the fail-closed posture of D-DEPT-4.
  return inForce.to ?? current;
};
