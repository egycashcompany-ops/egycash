// Router: authenticate → authorize → validate → controller (v1.1 §5).
import { Router } from 'express';
import { z } from 'zod';
import { objectId, ApproveOvertimeSchema } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { approveOvertime } from './overtime.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAttendanceOvertimeRouter = (): Router => {
  const router = Router();

  router.post(
    '/:id/approve',
    authenticate,
    authorize('attendance.approveOvertime'),
    validate({ body: ApproveOvertimeSchema, params: IdParamSchema }),
    asyncHandler(approveOvertime),
  );

  return router;
};
