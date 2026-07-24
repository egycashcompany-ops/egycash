// Routers: authenticate → authorize → validate → controller. DOCUMENTED DEVIATION from the
// route-authorize idiom (frozen design R9): decide/cancel/return/attach/pending-approvals
// authenticate only — the primary actor is the employee's CURRENT MANAGER, matched by
// relationship, not permission; the service authorizes (relationship OR scoped leave.approve)
// and denials are audited. Literal paths are declared before `/:id`.
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize, authorizeAny } from '../../../../platform/rbac';
import {
  approveLeaveRequest,
  attachToLeaveRequest,
  cancelLeaveRequest,
  getLeaveRequest,
  leaveCalendar,
  listLeaveRequests,
  pendingLeaveApprovals,
  rejectLeaveRequest,
  returnLeaveRequest,
  submitLeaveRequest,
} from './leave-request.controller';
import {
  CancelLeaveRequestSchema,
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
  LeaveCalendarQuerySchema,
  LeaveRequestIdParamSchema,
  ListLeaveRequestsQuerySchema,
  ReturnLeaveRequestSchema,
} from './leave-request.validation';

/** Outer multipart cap (first-line defence); the file category's `maxSizeMb` is authoritative. */
const ATTACHMENT_MAX_MB = 15;

const multipartSingle = (): RequestHandler => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ATTACHMENT_MAX_MB * 1024 * 1024, files: 1 },
  }).single('file');
  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, (error: unknown) => {
      if (error === undefined || error === null) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(ErrorCodes.FILE_TOO_LARGE, 422, `File exceeds the ${ATTACHMENT_MAX_MB} MB cap`));
        return;
      }
      next(error);
    });
  };
};

export const buildLeaveRequestsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('leave.view'),
    validate({ query: ListLeaveRequestsQuerySchema }),
    asyncHandler(listLeaveRequests),
  );
  router.post(
    '/',
    authenticate,
    authorizeAny('leave.request', 'leave.requestForOthers'),
    validate({ body: CreateLeaveRequestSchema }),
    asyncHandler(submitLeaveRequest),
  );
  // The approvals inbox unions the relationship-based manager queue and the HR queue (R9).
  router.get('/pending-approvals', authenticate, asyncHandler(pendingLeaveApprovals));
  router.get(
    '/:id',
    authenticate,
    validate({ params: LeaveRequestIdParamSchema }),
    asyncHandler(getLeaveRequest),
  );
  router.post(
    '/:id/approve',
    authenticate,
    validate({ body: DecideLeaveRequestSchema, params: LeaveRequestIdParamSchema }),
    asyncHandler(approveLeaveRequest),
  );
  router.post(
    '/:id/reject',
    authenticate,
    validate({ body: DecideLeaveRequestSchema, params: LeaveRequestIdParamSchema }),
    asyncHandler(rejectLeaveRequest),
  );
  router.post(
    '/:id/cancel',
    authenticate,
    validate({ body: CancelLeaveRequestSchema, params: LeaveRequestIdParamSchema }),
    asyncHandler(cancelLeaveRequest),
  );
  router.post(
    '/:id/return',
    authenticate,
    validate({ body: ReturnLeaveRequestSchema, params: LeaveRequestIdParamSchema }),
    asyncHandler(returnLeaveRequest),
  );
  router.post(
    '/:id/attachments',
    authenticate,
    multipartSingle(),
    validate({ params: LeaveRequestIdParamSchema }),
    asyncHandler(attachToLeaveRequest),
  );

  return router;
};

export const buildLeaveCalendarRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('leave.view'),
    validate({ query: LeaveCalendarQuerySchema }),
    asyncHandler(leaveCalendar),
  );
  return router;
};
