// What Employee Self-Service may do with loans: ASK for one.
//
// An employee applying for a loan is the ordinary case, not the exception — it is the employee's
// own request about their own pay. Until now the only key on this feature that a person could hold
// was `employeeLoan.approve`, which is the DECIDER's key, so the request itself had nowhere to come
// from: the "my loans" screen could show an employee their loans and offer no way to ask for one.
//
// `employeeLoan.create` and nothing else. Not `approve`, not `disburse`, not `settle` — an employee
// does not decide their own request, and the separation between asking and granting is the whole
// control on this feature. The ESS assignment is `own`-scoped (Leave L7), and the service loads the
// subject employee through that scope, so the key can only ever reach the caller's own file.
//
// Declared HERE, by the module that owns the permission, the way attendance declares its own ESS
// keys. The seed is where the modules meet — payroll may not name a role collection, and RBAC may
// not name a loan.
import { rbacService } from '../../../platform/rbac/rbac.service';
import { logger } from '../../../infrastructure/logging/logger';

/** The loan keys Employee Self-Service carries. Asking, never deciding. */
export const ESS_LOAN_GRANTS = ['employeeLoan.create'];

/**
 * Widen the ESS role with the loan keys, on every boot.
 *
 * `addSystemRoleGrants` rather than `ensureSystemRole`: the role already exists on every installed
 * system, and `ensureSystemRole` returns an existing role untouched — it would create the role with
 * these keys on a fresh install and silently do nothing everywhere else. Widening also never
 * reverts an administrator's edit: it adds what is missing and leaves the rest alone.
 */
export const grantEssLoanAccess = async (): Promise<void> => {
  const added = await rbacService.addSystemRoleGrants('employee-self-service', ESS_LOAN_GRANTS);
  if (added > 0) {
    logger.info({ added }, 'loans: employee-self-service widened with the ESS loan keys');
  }
};
