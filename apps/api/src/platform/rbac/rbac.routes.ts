import { Router } from 'express';
import { z } from 'zod';
import { RenameRoleGroupSchema, SetDelegationSchema, objectId } from '@ecms/contracts';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from './rbac.middleware';
import {
  CreateRoleAssignmentSchema,
  CreateRoleSchema,
  ListRoleAssignmentsQuerySchema,
  ListRolesQuerySchema,
  UpdateRoleAssignmentSchema,
  UpdateRoleSchema,
} from './rbac.validation';
import {
  createAssignment,
  createRole,
  deleteRole,
  getRole,
  listAssignments,
  listPermissions,
  listRoleGroups,
  listRoles,
  renameRoleGroup,
  revokeAssignment,
  updateAssignment,
  updateRole,
} from './rbac.controller';
import { myDelegationCatalog, setUserDelegation, userDelegations } from './delegation.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildPermissionsRouter = (): Router => {
  const router = Router();
  router.get('/', authenticate, authorize('permission.view'), asyncHandler(listPermissions));
  return router;
};

export const buildRolesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('role.view'),
    validate({ query: ListRolesQuerySchema }),
    asyncHandler(listRoles),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('role.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getRole),
  );
  router.get('/groups', authenticate, authorize('role.view'), asyncHandler(listRoleGroups));
  // Before `/:id` — «groups» is not an id, and a router that met `/:id` first would answer this
  // with «role not found» for a request that never named a role.
  router.put(
    '/groups',
    authenticate,
    authorize('role.edit'),
    validate({ body: RenameRoleGroupSchema }),
    asyncHandler(renameRoleGroup),
  );
  router.post(
    '/',
    authenticate,
    authorize('role.create'),
    validate({ body: CreateRoleSchema }),
    asyncHandler(createRole),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('role.edit'),
    validate({ body: UpdateRoleSchema, params: IdParamSchema }),
    asyncHandler(updateRole),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('role.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteRole),
  );
  return router;
};

export const buildRoleAssignmentsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('role.view'),
    validate({ query: ListRoleAssignmentsQuerySchema }),
    asyncHandler(listAssignments),
  );
  router.post(
    '/',
    authenticate,
    authorize('role.assign'),
    validate({ body: CreateRoleAssignmentSchema }),
    asyncHandler(createAssignment),
  );
  // Moving a grant's validity window: the same permission as making one, because extending a grant
  // that is about to lapse is the same authority as issuing it. Everything else about an assignment
  // is immutable — changing the role, the user or the scope is a revocation and a new grant.
  router.patch(
    '/:id',
    authenticate,
    authorize('role.assign'),
    validate({ body: UpdateRoleAssignmentSchema, params: IdParamSchema }),
    asyncHandler(updateAssignment),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('role.assign'),
    validate({ params: IdParamSchema }),
    asyncHandler(revokeAssignment),
  );
  return router;
};

/**
 * Delegated grants (ADR-032). One key gates all three: what the caller may hand out, and to whom,
 * is decided in the service from their own grants — the route only asks whether they delegate at all.
 */
export const buildDelegationsRouter = (): Router => {
  const router = Router();
  const UserParamSchema = z.object({ userId: objectId() }).strict();
  router.get('/me', authenticate, authorize('delegation.manage'), asyncHandler(myDelegationCatalog));
  router.get(
    '/users/:userId',
    authenticate,
    authorize('delegation.manage'),
    validate({ params: UserParamSchema }),
    asyncHandler(userDelegations),
  );
  // The unit is in the body, not the path: a whole-branch grant has no department to name.
  router.put(
    '/users/:userId/grants',
    authenticate,
    authorize('delegation.manage'),
    validate({ body: SetDelegationSchema, params: UserParamSchema }),
    asyncHandler(setUserDelegation),
  );
  return router;
};
