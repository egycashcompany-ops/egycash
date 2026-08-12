// Router: authenticate → authorize → validate → controller. The whole catalog surface sits
// behind attendance.manageShifts (v1.1 §5); shifts DEACTIVATE rather than delete — assignments
// and day records reference them forever, so DELETE is a status flip, not a removal.
import { Router } from 'express';
import { z } from 'zod';
import { objectId, CreateShiftSchema, UpdateShiftSchema } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { createShift, deactivateShift, listShifts, updateShift } from './shift.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();
const VersionBodySchema = z.object({ version: z.number().int().min(0) }).strict();

export const buildAttendanceShiftsRouter = (): Router => {
  const router = Router();

  router.get('/', authenticate, authorize('attendance.manageShifts'), asyncHandler(listShifts));
  router.post(
    '/',
    authenticate,
    authorize('attendance.manageShifts'),
    validate({ body: CreateShiftSchema }),
    asyncHandler(createShift),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('attendance.manageShifts'),
    validate({ body: UpdateShiftSchema, params: IdParamSchema }),
    asyncHandler(updateShift),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('attendance.manageShifts'),
    validate({ body: VersionBodySchema, params: IdParamSchema }),
    asyncHandler(deactivateShift),
  );

  return router;
};
