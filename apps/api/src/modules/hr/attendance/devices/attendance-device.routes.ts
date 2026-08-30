// Router: authenticate → authorize → validate → controller (design §5).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAttendanceDeviceSchema,
  ListAttendanceDevicesQuerySchema,
  objectId,
  UpdateAttendanceDeviceSchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  createAttendanceDevice,
  getAttendanceDevice,
  listAttendanceDevices,
  updateAttendanceDevice,
} from './attendance-device.controller';

/**
 * NO DELETE, and that is the same reason the punch has none: a device is referenced by every row
 * it ever produced. Retiring one is `isActive: false` — the history stays readable and the code
 * stays resolvable, so a punch imported last year still names something.
 */
const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAttendanceDevicesRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('attendanceDevice.view'),
    validate({ query: ListAttendanceDevicesQuerySchema }),
    asyncHandler(listAttendanceDevices),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('attendanceDevice.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getAttendanceDevice),
  );
  router.post(
    '/',
    authenticate,
    authorize('attendanceDevice.manage'),
    validate({ body: CreateAttendanceDeviceSchema }),
    asyncHandler(createAttendanceDevice),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('attendanceDevice.manage'),
    validate({ body: UpdateAttendanceDeviceSchema, params: IdParamSchema }),
    asyncHandler(updateAttendanceDevice),
  );

  return router;
};
