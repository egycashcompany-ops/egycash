// Router: authenticate → authorize → validate → controller.
//
// THE PERMISSION SPLIT IS THE POINT (D1). `payrollAdjustment.create` records and cancels;
// `payrollAdjustment.approve` decides. Two keys, because one key held by one person is not a
// two-person rule — and the service additionally refuses a decision by the submitter, since a
// permission says what you MAY do, not who you are.
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { AppError } from '../../../../shared/errors';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  attachAdjustmentDocument,
  cancelAdjustment,
  createAdjustment,
  decideAdjustment,
  listAdjustments,
  listEmployeeAdjustments,
  submitAdjustment,
  updateAdjustment,
} from './payroll-adjustment.controller';
import {
  AdjustmentIdParamSchema,
  CancelPayrollAdjustmentSchema,
  CreatePayrollAdjustmentSchema,
  DecidePayrollAdjustmentSchema,
  ListPayrollAdjustmentsQuerySchema,
  SubmitPayrollAdjustmentSchema,
  UpdatePayrollAdjustmentSchema,
} from './payroll-adjustment.validation';
import { EmployeeIdParamSchema } from '../../employee-management/employees/employee.validation';

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

/** Mounted under `/hr/employees` — paths are relative to `/:id/adjustments`. */
export const buildEmployeeAdjustmentsRouter = (): Router => {
  const router = Router({ mergeParams: true });

  router.get(
    '/:id/adjustments',
    authenticate,
    authorize('payrollAdjustment.view'),
    validate({ query: ListPayrollAdjustmentsQuerySchema, params: EmployeeIdParamSchema }),
    asyncHandler(listEmployeeAdjustments),
  );
  // First, because the entry that names a document cannot be created before the document exists.
  router.post(
    '/:id/adjustments/attachment',
    authenticate,
    authorize('payrollAdjustment.create'),
    multipartSingle(),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(attachAdjustmentDocument),
  );
  router.post(
    '/:id/adjustments',
    authenticate,
    authorize('payrollAdjustment.create'),
    validate({ body: CreatePayrollAdjustmentSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createAdjustment),
  );
  router.patch(
    '/:id/adjustments/:adjustmentId',
    authenticate,
    authorize('payrollAdjustment.create'),
    validate({ body: UpdatePayrollAdjustmentSchema, params: AdjustmentIdParamSchema }),
    asyncHandler(updateAdjustment),
  );
  router.post(
    '/:id/adjustments/:adjustmentId/submit',
    authenticate,
    authorize('payrollAdjustment.create'),
    validate({ body: SubmitPayrollAdjustmentSchema, params: AdjustmentIdParamSchema }),
    asyncHandler(submitAdjustment),
  );
  router.post(
    '/:id/adjustments/:adjustmentId/decide',
    authenticate,
    authorize('payrollAdjustment.approve'),
    validate({ body: DecidePayrollAdjustmentSchema, params: AdjustmentIdParamSchema }),
    asyncHandler(decideAdjustment),
  );
  router.post(
    '/:id/adjustments/:adjustmentId/cancel',
    authenticate,
    authorize('payrollAdjustment.create'),
    validate({ body: CancelPayrollAdjustmentSchema, params: AdjustmentIdParamSchema }),
    asyncHandler(cancelAdjustment),
  );

  return router;
};

/** The organization-wide list — the approval queue reads it filtered by `status`. */
export const buildPayrollAdjustmentsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('payrollAdjustment.view'),
    validate({ query: ListPayrollAdjustmentsQuerySchema }),
    asyncHandler(listAdjustments),
  );
  return router;
};
