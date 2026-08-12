// Router: authenticate → authorize → validate → controller. The whole assignment surface sits
// behind attendance.assign (v1.1 §5).
import { Router } from 'express';
import { z } from 'zod';
import {
  objectId,
  CreateShiftAssignmentSchema,
  ListShiftAssignmentsQuerySchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  createShiftAssignment,
  listShiftAssignments,
  removeShiftAssignment,
} from './shift-assignment.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAttendanceAssignmentsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('attendance.assign'),
    validate({ query: ListShiftAssignmentsQuerySchema }),
    asyncHandler(listShiftAssignments),
  );
  router.post(
    '/',
    authenticate,
    authorize('attendance.assign'),
    validate({ body: CreateShiftAssignmentSchema }),
    asyncHandler(createShiftAssignment),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('attendance.assign'),
    validate({ params: IdParamSchema }),
    asyncHandler(removeShiftAssignment),
  );

  return router;
};
