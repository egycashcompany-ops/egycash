// Routes authenticate; the SERVICE authorizes (the Leave R9 shape): the manager step by
// relationship, the HR step by `attendance.decideRegularization`, self-filing by
// `attendance.requestRegularization` — the controller computes the caller's flags from the
// session's effective permissions and passes them down.
//
// The two AT-6 reads follow the same split as Leave: `/me` and `/pending-decisions` authenticate
// only (both are resolved from who the caller IS), while the administrative list is gated on
// `attendance.decideRegularization` and scoped by its data scope.
import { Router } from 'express';
import { z } from 'zod';
import {
  objectId,
  CancelAttendanceRegularizationSchema,
  CreateAttendanceRegularizationSchema,
  DecideAttendanceRegularizationSchema,
  ListAttendanceRegularizationsQuerySchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  cancelRegularization,
  createRegularization,
  decideRegularization,
  listMyRegularizations,
  listRegularizations,
  pendingRegularizationDecisions,
} from './regularization.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAttendanceRegularizationsRouter = (): Router => {
  const router = Router();

  router.get(
    '/me',
    authenticate,
    validate({ query: ListAttendanceRegularizationsQuerySchema }),
    asyncHandler(listMyRegularizations),
  );
  router.get('/pending-decisions', authenticate, asyncHandler(pendingRegularizationDecisions));
  router.get(
    '/',
    authenticate,
    authorize('attendance.decideRegularization'),
    validate({ query: ListAttendanceRegularizationsQuerySchema }),
    asyncHandler(listRegularizations),
  );
  router.post(
    '/',
    authenticate,
    validate({ body: CreateAttendanceRegularizationSchema }),
    asyncHandler(createRegularization),
  );
  router.post(
    '/:id/decide',
    authenticate,
    validate({ body: DecideAttendanceRegularizationSchema, params: IdParamSchema }),
    asyncHandler(decideRegularization),
  );
  router.post(
    '/:id/cancel',
    authenticate,
    validate({ body: CancelAttendanceRegularizationSchema, params: IdParamSchema }),
    asyncHandler(cancelRegularization),
  );

  return router;
};
