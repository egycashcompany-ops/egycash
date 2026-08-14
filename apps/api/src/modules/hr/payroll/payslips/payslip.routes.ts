// Router: authenticate → authorize → validate → controller.
//
// TWO EXISTING KEYS, AND NO NEW ONE. The split falls out of what each act is:
//
//   • ISSUING is a period-level act over the whole organization, exactly like freezing — so it is
//     `payrollRun.manage`, the key that already means "may act on a run".
//   • READING a payslip is reading somebody's pay, which the registry already has a key for:
//     `employee.viewCompensation`, with the scope and the redaction that come with it. A separate
//     `payslip.view` would be a second answer to a question already answered, and the two would
//     drift the first time somebody was granted one and not the other.
import { Router } from 'express';
import { z } from 'zod';
import { objectId, GeneratePayslipsSchema, ListPayslipsQuerySchema } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  generatePayslips,
  getMyPayslip,
  getPayslip,
  listEmployeePayslips,
  listMyPayslips,
  listRunPayslips,
} from './payslip.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

/** Mounted UNDER the runs router: a payslip has no existence apart from the run that issued it. */
export const buildRunPayslipsRouter = (): Router => {
  const router = Router({ mergeParams: true });
  router.get(
    '/:id/payslips',
    authenticate,
    authorize('employee.viewCompensation'),
    validate({ query: ListPayslipsQuerySchema, params: IdParamSchema }),
    asyncHandler(listRunPayslips),
  );
  router.post(
    '/:id/payslips',
    authenticate,
    authorize('payrollRun.manage'),
    validate({ body: GeneratePayslipsSchema, params: IdParamSchema }),
    asyncHandler(generatePayslips),
  );
  return router;
};

/**
 * One payslip by id — the document itself, wherever it is linked from.
 *
 * `/me` and `/me/:id` carry NO permission on purpose (PY-11): they are own-scope BY CONSTRUCTION —
 * the employee is resolved from the caller's own login link and nothing the caller sends can widen
 * that — the posture `/days/me` and My Leave already have. They are declared FIRST so `me` is
 * never parsed as an object id.
 */
export const buildPayslipsRouter = (): Router => {
  const router = Router();
  router.get(
    '/me',
    authenticate,
    validate({ query: ListPayslipsQuerySchema }),
    asyncHandler(listMyPayslips),
  );
  router.get(
    '/me/:id',
    authenticate,
    validate({ params: IdParamSchema }),
    asyncHandler(getMyPayslip),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('employee.viewCompensation'),
    validate({ params: IdParamSchema }),
    asyncHandler(getPayslip),
  );
  return router;
};

/**
 * One employee's payslip history (P-HR-20) — mounted under `/hr/employees`.
 *
 * Behind `employee.viewCompensation`, the key that already governs the single-payslip read and the
 * run's list. It adds no permission: reading what somebody was paid is reading their pay,
 * whichever direction the question comes from.
 */
export const buildEmployeePayslipsRouter = (): Router => {
  const router = Router();
  router.get(
    '/:id/payslips',
    authenticate,
    authorize('employee.viewCompensation'),
    validate({ query: ListPayslipsQuerySchema, params: IdParamSchema }),
    asyncHandler(listEmployeePayslips),
  );
  return router;
};
