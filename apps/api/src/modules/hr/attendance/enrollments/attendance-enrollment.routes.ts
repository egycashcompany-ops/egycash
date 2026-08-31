// Router: authenticate → authorize → validate → controller (design §5).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAttendanceEnrollmentSchema,
  ListAttendanceEnrollmentsQuerySchema,
  objectId,
  UpdateAttendanceEnrollmentSchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  createAttendanceEnrollment,
  deleteAttendanceEnrollment,
  getAttendanceEnrollment,
  listAttendanceEnrollments,
  updateAttendanceEnrollment,
} from './attendance-enrollment.controller';

/**
 * THIS ONE HAS A DELETE, unlike the device beside it, and the difference is not an inconsistency.
 *
 * A device is referenced by every punch it produced, so retiring it must keep the code resolvable.
 * A mapping is referenced by NOTHING — the punch stores the employee it resolved to, not the
 * enrolment it came through — so unmapping breaks no history. It is a soft delete, which frees the
 * `{deviceId, enrollmentNo}` key for the next person enrolled under that id while leaving the row
 * readable as the reason a month of punches went where it did.
 *
 * The keys are the device registry's: mapping an enrolment IS administering the device, and
 * inventing a second pair for the same desk would put one job behind two doors.
 */
const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAttendanceEnrollmentsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('attendanceDevice.view'),
    validate({ query: ListAttendanceEnrollmentsQuerySchema }),
    asyncHandler(listAttendanceEnrollments),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('attendanceDevice.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getAttendanceEnrollment),
  );
  router.post(
    '/',
    authenticate,
    authorize('attendanceDevice.manage'),
    validate({ body: CreateAttendanceEnrollmentSchema }),
    asyncHandler(createAttendanceEnrollment),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('attendanceDevice.manage'),
    validate({ body: UpdateAttendanceEnrollmentSchema, params: IdParamSchema }),
    asyncHandler(updateAttendanceEnrollment),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('attendanceDevice.manage'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteAttendanceEnrollment),
  );

  return router;
};
