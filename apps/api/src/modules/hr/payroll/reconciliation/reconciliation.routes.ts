// Router: authenticate → authorize → validate → controller.
//
// NO PERMISSION OF ITS OWN. Every figure this answers with is somebody's pay in aggregate, and
// `employee.viewCompensation` already governs reading the run's payslips one by one — a separate
// key would mean somebody could be refused the sum while allowed every term in it.
//
// Mounted under `/hr/payroll/runs`, beside the payslips router, for the same reason that one is: a
// reconciliation has no existence apart from the run it reconciles.
import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { getRunReconciliation } from './reconciliation.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildReconciliationRouter = (): Router => {
  const router = Router();
  router.get(
    '/:id/reconciliation',
    authenticate,
    authorize('employee.viewCompensation'),
    validate({ params: IdParamSchema }),
    asyncHandler(getRunReconciliation),
  );
  return router;
};
