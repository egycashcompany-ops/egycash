// A warehouse's pure rules (design §2.3.5, §5.3, §5.15, §7.8): which keeper a write may name, and
// what keeps a warehouse from retiring. No database and no clock: the service reads the facts —
// the keeper as the directory answers, the holds the §3.6 checkers report — and these decide.
//
// The type list is the contract's closed enum (OD-10 A), and the branch is fixed by the contract
// too: the update schema has no `branchId`, so neither rule ever sees a move.
import {
  ADMINISTRATION_DEACTIVATION_PROBLEMS,
  ErrorCodes,
  type AdministrationDeactivationProblem,
  type AdministrationPersonStatus,
} from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';

/**
 * The 422 for a keeper HR answers as having left, or null (§7.8; OD-44's recommended default, IT's
 * `refuseLeaver`). It refuses on a POSITIVE answer only: an id the directory cannot read — a
 * deployment with no HR source, a person it does not know — passes, so the rule adds the one fact
 * HR can state rather than a dependency on HR answering at all. On leave and suspended still work
 * here, and may keep a store. Asked only of a keeper a write names anew: a warehouse whose keeper
 * left later keeps them until somebody names another, and the screen flags them meanwhile.
 */
export const keeperRefusal = (
  keeper: { status: AdministrationPersonStatus } | null,
): AppError | null => {
  if (keeper?.status !== 'exited') return null;
  const message = 'a warehouse keeper must be a current employee';
  return new AppError(ErrorCodes.ADMINISTRATION_EMPLOYEE_EXITED, 422, message, {
    details: [{ field: 'responsibleEmployeeId', code: 'exited', message }],
  });
};

/** Is this edit a retirement — the one act OD-70's rule judges? A reactivation never is. */
export const isRetirement = (
  before: { isActive: boolean },
  isActive: boolean | undefined,
): boolean => before.isActive && isActive === false;

/**
 * Why this warehouse may not retire now (OD-70 B, §5.3): the 422 with one detail per hold the
 * checkers reported — stock on hand or in transit, a document not yet ended that names it — or
 * null when nothing holds it. In Phase 1 nothing can: no checker is registered before the stock
 * ledger (P5) and the documents that name a warehouse, so a warehouse retires freely.
 */
export const deactivationProblem = (
  holds: readonly AdministrationDeactivationProblem[],
): AppError | null => {
  const problems = ADMINISTRATION_DEACTIVATION_PROBLEMS.filter((hold) => holds.includes(hold));
  if (problems.length === 0) return null;
  const message = 'a warehouse that holds stock or is named by an open document cannot retire';
  return new AppError(ErrorCodes.ADMINISTRATION_DEACTIVATION_BLOCKED, 422, message, {
    details: problems.map((code) => ({ field: 'isActive', code, message })),
  });
};
