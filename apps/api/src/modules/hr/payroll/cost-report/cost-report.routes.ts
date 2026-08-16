// Router: authenticate → authorize → validate → controller.
//
// WHY POST CARRIES A READ. A calculated column is an expression tree, and P-HR-24 allows one of up
// to 4096 bytes; several of them do not survive a query string that every proxy and browser between
// here and the caller must carry intact. `POST /hr/contracts/preview` already established the shape
// in this codebase: a request that computes and returns, and writes nothing. The guard spec asserts
// the "writes nothing" half rather than leaving it to this comment.
//
// NO PERMISSION OF ITS OWN, for the reason the cost breakdown gives beside it (D-REPORT-4 = A):
// `employee.viewCompensation` already governs reading this run's payslips one by one, and a
// separate key would let somebody be refused the sum while allowed every term in it.
//
// Mounted under `/hr/payroll/runs` — a run's cost has no existence apart from the run.
import { Router } from 'express';
import { z } from 'zod';
import { PayrollRunCostReportRequestSchema, objectId } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { postRunCostReport } from './cost-report.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildCostReportRouter = (): Router => {
  const router = Router();
  router.post(
    '/:id/cost-report',
    authenticate,
    authorize('employee.viewCompensation'),
    validate({ body: PayrollRunCostReportRequestSchema, params: IdParamSchema }),
    asyncHandler(postRunCostReport),
  );
  return router;
};
