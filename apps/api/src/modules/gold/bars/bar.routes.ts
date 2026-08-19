// The bar register. Only `view` and `edit` exist as grants, and that is on purpose: bars are BORN
// from a confirmed receiving receipt and LEAVE through a delivery, so creating or deleting one by
// hand is not an authority the gold system ever granted separately — both write endpoints below
// ride `goldBar.edit`.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateGoldBarSchema,
  ListGoldBarsQuerySchema,
  UpdateGoldBarSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createGoldBar,
  deleteGoldBar,
  getGoldBar,
  getGoldBarHistory,
  goldBarFacets,
  listGoldBars,
  updateGoldBar,
} from './bar.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildGoldBarsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('goldBar.view'),
    validate({ query: ListGoldBarsQuerySchema }),
    asyncHandler(listGoldBars),
  );
  // Literal before '/:id'.
  router.get('/facets', authenticate, authorize('goldBar.view'), asyncHandler(goldBarFacets));
  router.get(
    '/:id',
    authenticate,
    authorize('goldBar.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getGoldBar),
  );
  router.get(
    '/:id/history',
    authenticate,
    authorize('goldBar.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getGoldBarHistory),
  );
  router.post(
    '/',
    authenticate,
    authorize('goldBar.edit'),
    validate({ body: CreateGoldBarSchema }),
    asyncHandler(createGoldBar),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('goldBar.edit'),
    validate({ body: UpdateGoldBarSchema, params: IdParamSchema }),
    asyncHandler(updateGoldBar),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('goldBar.edit'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteGoldBar),
  );
  return router;
};
