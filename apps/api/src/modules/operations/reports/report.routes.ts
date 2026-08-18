// The two Operations reports.
//
// Both ride `operationsShipment.view`: a report is a READ of the shipments the caller can already
// see, not a separate decision. Legacy had no working authorization on either — `/ops_report`'s
// check was commented out entirely (discovery Q36) — so this is a gap being closed, not parity.
import { Router } from 'express';
import { z } from 'zod';
import { OperationsReportQuerySchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getBankReport, getCaptainReport, getVaultReport } from './report.controller';

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
  // The vault roll-up rides `operationsVault.view`, NOT the shipment grant: it reports on what
  // the treasury holds, and the legacy screen sat behind the vault screens for the same reason.
  //
  // The query schema is EMPTY AND STRICT, so a caller passing `?from=…&to=…` gets a 400 rather
  // than a report that quietly ignores it. That is precisely the legacy defect (Q32): the screen
  // had a date picker whose filters were commented out, so it answered a question nobody asked
  // and looked like it had answered theirs. Refusing is the honest version of "no date filter".
  router.get(
    '/vault',
    authenticate,
    authorize('operationsVault.view'),
    validate({ query: z.object({}).strict() }),
    asyncHandler(getVaultReport),
  );

  return router;
};
