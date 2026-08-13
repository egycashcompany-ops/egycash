// HR's answer to the Files service's question, for adjustment documents (ADR-023 — P-HR-04).
//
// The file is owned by the EMPLOYEE, not by the adjustment: it is uploaded before the entry
// exists, so the entry's id cannot be its owner. The same reasoning — and the same shape — as the
// personnel-action attachment authorizer HR3-C registered.
//
// READ takes `payrollAdjustment.view`; WRITE takes `payrollAdjustment.create`, because uploading a
// document here IS proposing a payment. A viewer may read what is filed and may file nothing.
import { hasPermission, scopeSelector, type AuthContext } from '../../../../shared/types';
import { type FileEntityAuthorizer } from '../../../../platform/files';
import { employeeRepository } from '../../employee-management/employees';
import { ADJUSTMENT_ATTACHMENT_ENTITY_TYPE } from './payroll-adjustment.files';

/** Holding the key is not the same as reaching the employee — the scoped lookup decides. */
const canReach = async (ctx: AuthContext, employeeId: string, key: string): Promise<boolean> =>
  hasPermission(ctx, key) &&
  (await employeeRepository.findById(employeeId, scopeSelector(ctx, key))) !== null;

export const hrAdjustmentFileAuthorizers: FileEntityAuthorizer[] = [
  {
    entityType: ADJUSTMENT_ATTACHMENT_ENTITY_TYPE,
    authorize: async ({ ctx, entityId, intent }) =>
      canReach(
        ctx,
        entityId,
        intent === 'read' ? 'payrollAdjustment.view' : 'payrollAdjustment.create',
      ),
  },
];
