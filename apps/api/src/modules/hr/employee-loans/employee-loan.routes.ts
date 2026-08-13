// Router: authenticate → authorize → validate → controller.
//
// THE PERMISSION SPLIT IS THE POINT (D2). `employeeLoan.create` proposes, edits a draft and
// withdraws it; `employeeLoan.approve` decides, hands the money over, reschedules and closes the
// balance. Two keys, because one key held by one person is not a two-person rule — and the service
// additionally refuses a decision by the submitter, since a permission says what you MAY do, not
// who you are.
//
// Disbursement, rescheduling and settlement sit on `approve` rather than on `create` deliberately:
// each of them moves or moves-back real money, which is the same seniority of act as agreeing to
// lend it in the first place. Recording a request is not.
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { ErrorCodes } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../platform/web';
import { AppError } from '../../../shared/errors';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  accelerateLoan,
  attachLoanDocument,
  cancelLoan,
  createLoan,
  decideLoan,
  disburseLoan,
  getLoan,
  listEmployeeLoans,
  listLoans,
  rescheduleLoan,
  settleLoanExternally,
  submitLoan,
  updateLoan,
} from './employee-loan.controller';
import {
  AccelerateEmployeeLoanSchema,
  CancelEmployeeLoanSchema,
  CreateEmployeeLoanSchema,
  DecideEmployeeLoanSchema,
  DisburseEmployeeLoanSchema,
  ListEmployeeLoansQuerySchema,
  LoanIdParamSchema,
  RescheduleEmployeeLoanSchema,
  SettleEmployeeLoanExternallySchema,
  SubmitEmployeeLoanSchema,
  UpdateEmployeeLoanSchema,
} from './employee-loan.validation';
import { EmployeeIdParamSchema } from '../employee-management/employees/employee.validation';

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

/** Mounted under `/hr/employees` — paths are relative to `/:id/loans`. */
export const buildEmployeeLoansRouter = (): Router => {
  const router = Router({ mergeParams: true });

  router.get(
    '/:id/loans',
    authenticate,
    authorize('employeeLoan.view'),
    validate({ query: ListEmployeeLoansQuerySchema, params: EmployeeIdParamSchema }),
    asyncHandler(listEmployeeLoans),
  );
  // First, because the request that names a document cannot be created before the document exists.
  router.post(
    '/:id/loans/attachment',
    authenticate,
    authorize('employeeLoan.create'),
    multipartSingle(),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(attachLoanDocument),
  );
  router.post(
    '/:id/loans',
    authenticate,
    authorize('employeeLoan.create'),
    validate({ body: CreateEmployeeLoanSchema, params: EmployeeIdParamSchema }),
    asyncHandler(createLoan),
  );
  router.get(
    '/:id/loans/:loanId',
    authenticate,
    authorize('employeeLoan.view'),
    validate({ params: LoanIdParamSchema }),
    asyncHandler(getLoan),
  );
  router.patch(
    '/:id/loans/:loanId',
    authenticate,
    authorize('employeeLoan.create'),
    validate({ body: UpdateEmployeeLoanSchema, params: LoanIdParamSchema }),
    asyncHandler(updateLoan),
  );
  router.post(
    '/:id/loans/:loanId/submit',
    authenticate,
    authorize('employeeLoan.create'),
    validate({ body: SubmitEmployeeLoanSchema, params: LoanIdParamSchema }),
    asyncHandler(submitLoan),
  );
  router.post(
    '/:id/loans/:loanId/decide',
    authenticate,
    authorize('employeeLoan.approve'),
    validate({ body: DecideEmployeeLoanSchema, params: LoanIdParamSchema }),
    asyncHandler(decideLoan),
  );
  router.post(
    '/:id/loans/:loanId/disburse',
    authenticate,
    authorize('employeeLoan.approve'),
    validate({ body: DisburseEmployeeLoanSchema, params: LoanIdParamSchema }),
    asyncHandler(disburseLoan),
  );
  router.post(
    '/:id/loans/:loanId/reschedule',
    authenticate,
    authorize('employeeLoan.approve'),
    validate({ body: RescheduleEmployeeLoanSchema, params: LoanIdParamSchema }),
    asyncHandler(rescheduleLoan),
  );
  // D7-2 — the payroll path: an extra amount taken in a named month, so the loan finishes earlier.
  router.post(
    '/:id/loans/:loanId/accelerate',
    authenticate,
    authorize('employeeLoan.approve'),
    validate({ body: AccelerateEmployeeLoanSchema, params: LoanIdParamSchema }),
    asyncHandler(accelerateLoan),
  );
  router.post(
    '/:id/loans/:loanId/settle-external',
    authenticate,
    authorize('employeeLoan.approve'),
    validate({ body: SettleEmployeeLoanExternallySchema, params: LoanIdParamSchema }),
    asyncHandler(settleLoanExternally),
  );
  router.post(
    '/:id/loans/:loanId/cancel',
    authenticate,
    authorize('employeeLoan.create'),
    validate({ body: CancelEmployeeLoanSchema, params: LoanIdParamSchema }),
    asyncHandler(cancelLoan),
  );

  return router;
};

/** The organization-wide list — the approval queue reads it filtered by `status`. */
export const buildEmployeeLoansAdminRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('employeeLoan.view'),
    validate({ query: ListEmployeeLoansQuerySchema }),
    asyncHandler(listLoans),
  );
  return router;
};
