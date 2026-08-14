// Router: authenticate → authorize → validate → controller.
//
// Two keys, and the split is a separation of duty rather than a habit: seeing whether a month is
// frozen is an everyday question, and freezing one is irreversible and organization-wide. No
// existing key fits — the registry has nothing at PERIOD level, and authorizing this with
// `employee.manageCompensation` would let anyone who can edit one employee's allowance freeze the
// whole company's month.
import { Router } from 'express';
import { z } from 'zod';
import {
  objectId,
  ApprovePayrollRunSchema,
  CancelPayrollRunSchema,
  ClosePayrollRunSchema,
  PayPayrollRunSchema,
  CreatePayrollRunSchema,
  FreezePayrollRunSchema,
  ListPayrollRunsQuerySchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  approvePayrollRun,
  cancelPayrollRun,
  closePayrollRun,
  payPayrollRun,
  createPayrollRun,
  freezePayrollRun,
  getPayrollRun,
  getPayrollRunLeave,
  listPayrollRuns,
} from './payroll-run.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildPayrollRunsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('payrollRun.view'),
    validate({ query: ListPayrollRunsQuerySchema }),
    asyncHandler(listPayrollRuns),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('payrollRun.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getPayrollRun),
  );
  router.get(
    '/:id/leave',
    authenticate,
    authorize('payrollRun.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getPayrollRunLeave),
  );
  router.post(
    '/',
    authenticate,
    authorize('payrollRun.manage'),
    validate({ body: CreatePayrollRunSchema }),
    asyncHandler(createPayrollRun),
  );
  router.post(
    '/:id/freeze',
    authenticate,
    authorize('payrollRun.manage'),
    validate({ body: FreezePayrollRunSchema, params: IdParamSchema }),
    asyncHandler(freezePayrollRun),
  );
  /**
   * P-HR-10 — one key per transition, because "a permission per transition" cannot be met by one.
   *
   * `approve` and `pay` get their own: agreeing that a whole company's figures are right, and
   * saying the money went out, are heavier acts than freezing a period and are not the same act as
   * each other. `close` stays on `manage` — it moves nothing and asserts nothing new.
   */
  router.post(
    '/:id/approve',
    authenticate,
    authorize('payrollRun.approve'),
    validate({ body: ApprovePayrollRunSchema, params: IdParamSchema }),
    asyncHandler(approvePayrollRun),
  );
  router.post(
    '/:id/pay',
    authenticate,
    authorize('payrollRun.pay'),
    validate({ body: PayPayrollRunSchema, params: IdParamSchema }),
    asyncHandler(payPayrollRun),
  );
  router.post(
    '/:id/close',
    authenticate,
    authorize('payrollRun.manage'),
    validate({ body: ClosePayrollRunSchema, params: IdParamSchema }),
    asyncHandler(closePayrollRun),
  );
  router.post(
    '/:id/cancel',
    authenticate,
    authorize('payrollRun.manage'),
    validate({ body: CancelPayrollRunSchema, params: IdParamSchema }),
    asyncHandler(cancelPayrollRun),
  );
  return router;
};
