// Routes authenticate; the SERVICE authorizes (the Leave R9 shape): the manager step by
// relationship, the HR step by `attendance.decideRegularization`, self-filing by
// `attendance.requestRegularization` — the controller computes the caller's flags from the
// session's effective permissions and passes them down.
import { Router } from 'express';
import { z } from 'zod';
import {
  objectId,
  CancelAttendanceRegularizationSchema,
  CreateAttendanceRegularizationSchema,
  DecideAttendanceRegularizationSchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import {
  cancelRegularization,
  createRegularization,
  decideRegularization,
} from './regularization.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAttendanceRegularizationsRouter = (): Router => {
  const router = Router();

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
