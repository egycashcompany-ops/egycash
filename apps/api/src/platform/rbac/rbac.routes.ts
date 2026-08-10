import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@ecms/contracts';
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
  listRoles,
  revokeAssignment,
  updateAssignment,
  updateRole,
} from './rbac.controller';

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
