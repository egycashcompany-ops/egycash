// The two Operations reports.
//
// Both ride `operationsShipment.view`: a report is a READ of the shipments the caller can already
// see, not a separate decision. Legacy had no working authorization on either — `/ops_report`'s
// check was commented out entirely (discovery Q36) — so this is a gap being closed, not parity.
import { Router } from 'express';
import { OperationsReportQuerySchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getBankReport, getCaptainReport } from './report.controller';

export const buildOperationsReportsRouter = (): Router => {
  const router = Router();
  router.get(
    '/captains',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: OperationsReportQuerySchema }),
    asyncHandler(getCaptainReport),
  );
  router.get(
    '/banks',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: OperationsReportQuerySchema }),
    asyncHandler(getBankReport),
  );
  return router;
};
