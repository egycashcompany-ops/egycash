// Router: authenticate → authorize → validate → controller. The catalog is READ by anyone
// holding leave.view (self-service users see types in the request wizard); administration
// requires leave.manageTypes. Types deactivate — never delete (history references them).
import { Router } from 'express';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { createLeaveType, listLeaveTypes, updateLeaveType } from './leave-type.controller';
import {
  CreateLeaveTypeSchema,
  LeaveTypeIdParamSchema,
  UpdateLeaveTypeSchema,
} from './leave-type.validation';

export const buildLeaveTypesRouter = (): Router => {
  const router = Router();

  router.get('/', authenticate, authorize('leave.view'), asyncHandler(listLeaveTypes));
  router.post(
    '/',
    authenticate,
    authorize('leave.manageTypes'),
    validate({ body: CreateLeaveTypeSchema }),
    asyncHandler(createLeaveType),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('leave.manageTypes'),
    validate({ body: UpdateLeaveTypeSchema, params: LeaveTypeIdParamSchema }),
    asyncHandler(updateLeaveType),
  );

  return router;
};
