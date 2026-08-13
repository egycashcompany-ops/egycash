// HR's answer to the Files service's question, for personnel-action documents (ADR-023 — HR3-C).
//
// The file is owned by the EMPLOYEE, not by the action: it is uploaded before the action exists,
// so the action's id cannot be its owner. That makes the rule the same one the action history
// already obeys — an action inherits its visibility from the employee, and so does its document.
//
// TWO INTENTS, TWO ANSWERS, and they are not the same question:
//
//   * READ  — can this caller see the employee? Resolved through the same
//     `scopeSelector(ctx, 'employee.view')` the history endpoint uses, so branch/department
//     scoping reaches the bytes with no second rule to keep in step.
//   * WRITE — uploading a document IS proposing a personnel action, so it takes one of the four
//     group permissions that create one. A holder of `employee.view` alone may read what is
//     already filed and may not file anything.
//
// No permission is minted here. The authorizer only asks questions the module could already
// answer; what changes is that the FILES service now asks them too.
import { EMPLOYEE_ACTION_ATTACHMENT_ENTITY_TYPE } from '@ecms/contracts';
import { hasPermission, scopeSelector, type AuthContext } from '../../../../shared/types';
import { type FileEntityAuthorizer } from '../../../../platform/files';
import { employeeRepository } from '../employees';
import { ACTION_GROUP_PERMISSIONS } from './employee-action.service';

/**
 * Can this caller reach the employee at all, under the given key?
 *
 * `findById` applies the scope, so an out-of-scope employee comes back null and the answer is no —
 * the same reason `GET /hr/employees/:id` answers 404 for somebody else's branch.
 */
const canReach = async (ctx: AuthContext, employeeId: string, key: string): Promise<boolean> =>
  hasPermission(ctx, key) &&
  (await employeeRepository.findById(employeeId, scopeSelector(ctx, key))) !== null;

const attachmentAuthorizer: FileEntityAuthorizer = {
  entityType: EMPLOYEE_ACTION_ATTACHMENT_ENTITY_TYPE,
  authorize: async ({ ctx, entityId, intent }) => {
    if (intent === 'read') return canReach(ctx, entityId, 'employee.view');
    // Any ONE of the four is enough — which action the document will support is not known yet,
    // and the create endpoint re-checks the specific group when the action is actually made.
    for (const key of ACTION_GROUP_PERMISSIONS) {
      if (await canReach(ctx, entityId, key)) return true;
    }
    return false;
  },
};

export const hrFileEntityAuthorizers: FileEntityAuthorizer[] = [attachmentAuthorizer];
