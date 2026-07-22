import { Router } from 'express';
import { z } from 'zod';
import { AssignApplicationSchema, objectId } from '@ecms/contracts';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import {
  assignDepartmentApplication,
  listDepartmentApplications,
  removeDepartmentApplication,
} from './department-application.controller';

// Mounted at `/platform/departments/:departmentId/applications` (mergeParams pulls departmentId in).
// Assignments are a department-configuration action, so they reuse the department.* permissions.
const DeptParamSchema = z.object({ departmentId: objectId() }).strict();
const DeptAppParamSchema = z.object({ departmentId: objectId(), applicationId: objectId() }).strict();

export const buildDepartmentApplicationsRouter = (): Router => {
  const router = Router({ mergeParams: true });

  router.get(
    '/',
    authenticate,
    authorize('department.view'),
    validate({ params: DeptParamSchema }),
    asyncHandler(listDepartmentApplications),
  );
  router.post(
    '/',
    authenticate,
    authorize('department.edit'),
    validate({ params: DeptParamSchema, body: AssignApplicationSchema }),
    asyncHandler(assignDepartmentApplication),
  );
  router.delete(
    '/:applicationId',
    authenticate,
    authorize('department.edit'),
    validate({ params: DeptAppParamSchema }),
    asyncHandler(removeDepartmentApplication),
  );
  return router;
};
