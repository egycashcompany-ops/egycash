// Router: authenticate → authorize → validate → controller (v1.1 §5).
//
// `/days/me` carries no permission on purpose: it is own-scope BY CONSTRUCTION — the rows are
// resolved from the caller's own login link and nothing the caller sends can widen that — the
// same posture My Leave has always had for an authenticated employee login.
import { Router } from 'express';
import {
  ExportAttendanceQuerySchema,
  ListAttendanceDaysQuerySchema,
  RecomputeAttendanceDaysSchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  exportAttendance,
  listAttendanceDays,
  listMyAttendanceDays,
  recomputeAttendanceDays,
} from './day-record.controller';

export const buildAttendanceDaysRouter = (): Router => {
  const router = Router();

  router.get(
    '/me',
    authenticate,
    validate({ query: ListAttendanceDaysQuerySchema }),
    asyncHandler(listMyAttendanceDays),
  );
  router.get(
    '/',
    authenticate,
    authorize('attendance.view'),
    validate({ query: ListAttendanceDaysQuerySchema }),
    asyncHandler(listAttendanceDays),
  );
  router.post(
    '/recompute',
    authenticate,
    authorize('attendance.recompute'),
    validate({ body: RecomputeAttendanceDaysSchema }),
    asyncHandler(recomputeAttendanceDays),
  );

  return router;
};

/** Mounted at `/hr/attendance/export` — its own key, its own audit row (AT-6). */
export const buildAttendanceExportRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('attendance.export'),
    validate({ query: ExportAttendanceQuerySchema }),
    asyncHandler(exportAttendance),
  );
  return router;
};
