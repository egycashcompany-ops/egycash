// Router: authenticate → authorize → validate → controller (v1.1 §5).
//
// THE DEVICE KEYS, not the import key, and the split is the same one the device registry uses:
// reading the quarantine and the unmatched-id report is reading device health
// (`attendanceDevice.view`), while retrying and discarding change what the machines' rows become
// (`attendanceDevice.manage`). The person who links an enrolment already holds both, which is the
// point — the report and the fix sit on one screen.
import { Router } from 'express';
import {
  DiscardAttendanceQuarantineSchema,
  ListAttendanceQuarantineQuerySchema,
  RetryAttendanceQuarantineSchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  discardQuarantine,
  listQuarantine,
  listUnmatchedIds,
  retryQuarantine,
} from './attendance-quarantine.controller';

export const buildAttendanceQuarantineRouter = (): Router => {
  const router = Router();

  // Before `/`, so the longer literal path is not swallowed by it.
  router.get(
    '/unmatched',
    authenticate,
    authorize('attendanceDevice.view'),
    asyncHandler(listUnmatchedIds),
  );
  router.get(
    '/',
    authenticate,
    authorize('attendanceDevice.view'),
    validate({ query: ListAttendanceQuarantineQuerySchema }),
    asyncHandler(listQuarantine),
  );
  router.post(
    '/retry',
    authenticate,
    authorize('attendanceDevice.manage'),
    validate({ body: RetryAttendanceQuarantineSchema }),
    asyncHandler(retryQuarantine),
  );
  router.post(
    '/discard',
    authenticate,
    authorize('attendanceDevice.manage'),
    validate({ body: DiscardAttendanceQuarantineSchema }),
    asyncHandler(discardQuarantine),
  );

  return router;
};
