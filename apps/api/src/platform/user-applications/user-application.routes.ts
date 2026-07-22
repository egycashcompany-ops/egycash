import { Router } from 'express';
import { z } from 'zod';
import { AssignApplicationSchema, objectId } from '@ecms/contracts';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import {
  assignUserApplication,
  listUserApplications,
  removeUserApplication,
} from './user-application.controller';

// Mounted at `/platform/users/:userId/applications` (mergeParams pulls userId in). Direct grants are
// a user-administration action, so they reuse the user.* permissions.
const UserParamSchema = z.object({ userId: objectId() }).strict();
const UserAppParamSchema = z.object({ userId: objectId(), applicationId: objectId() }).strict();

export const buildUserApplicationsRouter = (): Router => {
  const router = Router({ mergeParams: true });

  router.get(
    '/',
    authenticate,
    authorize('user.view'),
    validate({ params: UserParamSchema }),
    asyncHandler(listUserApplications),
  );
  router.post(
    '/',
    authenticate,
    authorize('user.edit'),
    validate({ params: UserParamSchema, body: AssignApplicationSchema }),
    asyncHandler(assignUserApplication),
  );
  router.delete(
    '/:applicationId',
    authenticate,
    authorize('user.edit'),
    validate({ params: UserAppParamSchema }),
    asyncHandler(removeUserApplication),
  );
  return router;
};
