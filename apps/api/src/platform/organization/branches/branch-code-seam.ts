// The seam a branch-code change reaches its dependents through (HR3-A).
//
// WHY A SEAM AND NOT A CALL. The Employee Code is DERIVED — `<BranchCode><GlobalEmployeeNumber>`
// (ADR-017) — and stored, so changing a branch's code silently invalidates the stored code of
// every employee in it. Fixing that means writing to HR, and the platform may not import a
// business module. So HR registers what it needs done at module load, exactly as the employee
// directory and the identity lookups already do.
//
// WHAT A HANDLER IS FOR, AND WHAT IT IS NOT. It repairs a DERIVED CURRENT value. It is not a
// personnel action and must never rewrite an issued record: a contract, a hiring document, a
// payslip and a leave request each keep the code as it stood when they were made, and that is
// what makes them readable years later.
import { logger } from '../../../infrastructure/logging/logger';

/** What a dependent does when a branch's code changes. Returns how many rows it repaired. */
export type BranchCodeChangeHandler = (change: {
  branchId: string;
  oldCode: string;
  newCode: string;
  by: string;
}) => Promise<number>;

const handlers: BranchCodeChangeHandler[] = [];

export const registerBranchCodeChangeHandler = (handler: BranchCodeChangeHandler): void => {
  handlers.push(handler);
};

/** Test seam — the registry is module state, and a suite that registers must be able to reset. */
export const clearBranchCodeChangeHandlers = (): void => {
  handlers.length = 0;
};

/**
 * Run every handler, and let none of them take the others down.
 *
 * The branch code is ALREADY changed by the time this runs — the write and its audit entry
 * succeeded. A handler that throws has failed to repair its own dependents, which is worth an
 * error in the log and a look from a human; it is not a reason to report the branch change as
 * failed when it plainly happened.
 */
export const runBranchCodeChangeHandlers = async (change: {
  branchId: string;
  oldCode: string;
  newCode: string;
  by: string;
}): Promise<number> => {
  let repaired = 0;
  for (const handler of handlers) {
    try {
      repaired += await handler(change);
    } catch (error) {
      logger.error({ err: error, ...change }, 'branch-code change handler failed');
    }
  }
  return repaired;
};
