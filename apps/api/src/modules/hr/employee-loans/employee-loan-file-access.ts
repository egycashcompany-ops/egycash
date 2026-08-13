// HR's answer to the Files service's question, for loan documents (ADR-023 — P-HR-05).
//
// The file is owned by the EMPLOYEE, not by the loan: it is uploaded before the request exists, so
// the request's id cannot be its owner. The same reasoning — and the same shape — as the
// personnel-action and payroll-adjustment authorizers already registered.
//
// READ takes `employeeLoan.view`; WRITE takes `employeeLoan.create`, because uploading a document
// here IS proposing that the company lend somebody money. A viewer may read what is filed and may
// file nothing.
import { hasPermission, scopeSelector, type AuthContext } from '../../../shared/types';
import { type FileEntityAuthorizer } from '../../../platform/files';
import { employeeRepository } from '../employee-management/employees';
import { LOAN_ATTACHMENT_ENTITY_TYPE } from './employee-loan.files';

/** Holding the key is not the same as reaching the employee — the scoped lookup decides. */
const canReach = async (ctx: AuthContext, employeeId: string, key: string): Promise<boolean> =>
  hasPermission(ctx, key) &&
  (await employeeRepository.findById(employeeId, scopeSelector(ctx, key))) !== null;

export const hrEmployeeLoanFileAuthorizers: FileEntityAuthorizer[] = [
  {
    entityType: LOAN_ATTACHMENT_ENTITY_TYPE,
    authorize: async ({ ctx, entityId, intent }) =>
      canReach(ctx, entityId, intent === 'read' ? 'employeeLoan.view' : 'employeeLoan.create'),
  },
];
