// بوابة العملاء — the customer-facing read surface.
//
// Every route here is a GET, and that is not a coincidence anyone has to maintain: the platform's
// confinement gate refuses any other method for an external account before this router is reached.
// The belt beside that brace is this file having no write route to refuse in the first place, and a
// spec asserts it stays that way.
//
// Three guards, in this order: the caller is authenticated, holds the portal grant, and is a live
// customer whose company we then scope every read to.
import { Router } from 'express';
import {
  GoldPortalBarsQuerySchema,
  GoldPortalClosingQuerySchema,
  GoldPortalListQuerySchema,
  GoldPortalMovementQuerySchema,
} from '@ecms/contracts';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { validate } from '../../../infrastructure/http/validate';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  goldPortalBars,
  goldPortalClosing,
  goldPortalDelivery,
  goldPortalDrawers,
  goldPortalKeys,
  goldPortalMe,
  goldPortalMovement,
  goldPortalOverview,
  goldPortalReceiving,
  goldPortalRepresentatives,
  goldPortalTransfers,
} from './portal.controller';
import { requireGoldPortal } from './portal-scope';

export const buildGoldPortalRouter = (): Router => {
  const router = Router();
  router.use(authenticate, authorize('goldPortal.view'), requireGoldPortal);

  router.get('/me', asyncHandler(goldPortalMe));
  router.get('/overview', asyncHandler(goldPortalOverview));
  router.get('/bars', validate({ query: GoldPortalBarsQuerySchema }), asyncHandler(goldPortalBars));
  router.get('/drawers', asyncHandler(goldPortalDrawers));
  router.get(
    '/receiving',
    validate({ query: GoldPortalListQuerySchema }),
    asyncHandler(goldPortalReceiving),
  );
  router.get(
    '/delivery',
    validate({ query: GoldPortalListQuerySchema }),
    asyncHandler(goldPortalDelivery),
  );
  router.get(
    '/transfers',
    validate({ query: GoldPortalListQuerySchema }),
    asyncHandler(goldPortalTransfers),
  );
  router.get('/keys', validate({ query: GoldPortalListQuerySchema }), asyncHandler(goldPortalKeys));
  router.get(
    '/representatives',
    validate({ query: GoldPortalListQuerySchema }),
    asyncHandler(goldPortalRepresentatives),
  );
  router.get(
    '/reports/movement',
    validate({ query: GoldPortalMovementQuerySchema }),
    asyncHandler(goldPortalMovement),
  );
  router.get(
    '/reports/closing',
    validate({ query: GoldPortalClosingQuerySchema }),
    asyncHandler(goldPortalClosing),
  );
  return router;
};
