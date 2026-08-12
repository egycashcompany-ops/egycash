// Router: authenticate → authorize → validate → controller (v1.1 §5).
import { Router } from 'express';
import {
  ImportPunchesSchema,
  ListPunchesQuerySchema,
  RecordPunchSchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { importPunches, listPunches, recordPunch } from './punch.controller';

export const buildAttendancePunchesRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('attendance.view'),
    validate({ query: ListPunchesQuerySchema }),
    asyncHandler(listPunches),
  );
  router.post(
    '/',
    authenticate,
    authorize('attendance.recordPunch'),
    validate({ body: RecordPunchSchema }),
    asyncHandler(recordPunch),
  );
  router.post(
    '/import',
    authenticate,
    authorize('attendance.importPunches'),
    validate({ body: ImportPunchesSchema }),
    asyncHandler(importPunches),
  );

  return router;
};
