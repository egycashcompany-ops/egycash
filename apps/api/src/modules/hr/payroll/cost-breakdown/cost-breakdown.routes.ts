// Router: authenticate → authorize → validate → controller.
//
// NO PERMISSION OF ITS OWN, for the reason P-HR-15-A's reconciliation gives beside it: every figure
// here is somebody's pay in aggregate, and `employee.viewCompensation` already governs reading the
// run's payslips one by one. A separate key would let somebody be refused the sum while allowed
// every term in it.
//
// Mounted under `/hr/payroll/runs` — a run's cost has no existence apart from the run.
import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { getRunCostBreakdown } from './cost-breakdown.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildCostBreakdownRouter = (): Router => {
  const router = Router();
  router.get(
    '/:id/cost-breakdown',
    authenticate,
    authorize('employee.viewCompensation'),
    validate({ params: IdParamSchema }),
    asyncHandler(getRunCostBreakdown),
  );
  return router;
};
