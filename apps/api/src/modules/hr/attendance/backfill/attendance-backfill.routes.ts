// Router: authenticate → authorize → validate → controller (v1.1 §5).
//
// Every route carries `attendance.recompute` — the key the branch integration already holds —
// because that is exactly what this is: the same recompute, over a window no request can hold.
// Reading progress sits behind the same key rather than `attendance.view`: it says nothing about
// anybody's attendance, only about how far a piece of operational work has got.
import { Router } from 'express';
import { z } from 'zod';
import {
  ListAttendanceBackfillsQuerySchema,
  objectId,
  StartAttendanceBackfillSchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  cancelAttendanceBackfill,
  listAttendanceBackfills,
  readAttendanceBackfill,
  resumeAttendanceBackfill,
  startAttendanceBackfill,
} from './attendance-backfill.controller';

/** The run id, validated like every other path parameter — the controller reads it as given. */
const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAttendanceBackfillsRouter = (): Router => {
  const router = Router();

  router.post(
    '/',
    authenticate,
    authorize('attendance.recompute'),
    validate({ body: StartAttendanceBackfillSchema }),
    asyncHandler(startAttendanceBackfill),
  );
  router.get(
    '/',
    authenticate,
    authorize('attendance.recompute'),
    validate({ query: ListAttendanceBackfillsQuerySchema }),
    asyncHandler(listAttendanceBackfills),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('attendance.recompute'),
    validate({ params: IdParamSchema }),
    asyncHandler(readAttendanceBackfill),
  );
  router.post(
    '/:id/cancel',
    authenticate,
    authorize('attendance.recompute'),
    validate({ params: IdParamSchema }),
    asyncHandler(cancelAttendanceBackfill),
  );
  router.post(
    '/:id/resume',
    authenticate,
    authorize('attendance.recompute'),
    validate({ params: IdParamSchema }),
    asyncHandler(resumeAttendanceBackfill),
  );

  return router;
};
