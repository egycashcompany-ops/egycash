// The cross-asset custody register (design §12): "what is out, and who has it".
//
// Mounted at `/it/assignments` rather than under an asset because its question spans assets — the
// asset-scoped list stays at `/it/assets/:id/assignments`. Read-only by construction: intervals
// are opened and closed by the custody actions and are never edited directly, so there is no
// PATCH here at all. The one POST issues the custody receipt (FR-18) for an interval handed over
// before receipts existed — it writes the paper, not the interval's facts.
import { Router } from 'express';
import { ItCustodyReceiptIdParamSchema, ListItAssignmentsQuerySchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { listItAssignments } from './custody.controller';
import { issueItAssignmentReceipt } from './receipt.controller';

export const buildItAssignmentsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ListItAssignmentsQuerySchema }),
    asyncHandler(listItAssignments),
  );
  router.post(
    '/:id/receipt',
    authenticate,
    authorize('itAsset.assign'),
    validate({ params: ItCustodyReceiptIdParamSchema }),
    asyncHandler(issueItAssignmentReceipt),
  );
  return router;
};
