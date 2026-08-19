// المفاتيح. Handing a key out and taking it back are SEPARATE grants — the gold catalog had
// `keys:create` and `keys:return` as distinct actions, and they are distinct decisions: one puts a
// customer inside the vault, the other closes that out.
import { Router } from 'express';
import { z } from 'zod';
import { CreateGoldKeyHandoverSchema, ListGoldKeysQuerySchema, objectId } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createGoldKey,
  deleteGoldKey,
  getGoldKey,
  goldKeysOverview,
  listGoldKeys,
  returnGoldKey,
} from './key-handover.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildGoldKeysRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('goldKey.view'),
    validate({ query: ListGoldKeysQuerySchema }),
    asyncHandler(listGoldKeys),
  );
  // Literal before '/:id'.
  router.get('/overview', authenticate, authorize('goldKey.view'), asyncHandler(goldKeysOverview));
  router.get(
    '/:id',
    authenticate,
    authorize('goldKey.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getGoldKey),
  );
  router.post(
    '/',
    authenticate,
    authorize('goldKey.create'),
    validate({ body: CreateGoldKeyHandoverSchema }),
    asyncHandler(createGoldKey),
  );
  router.patch(
    '/:id/return',
    authenticate,
    authorize('goldKey.return'),
    validate({ params: IdParamSchema }),
    asyncHandler(returnGoldKey),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('goldKey.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteGoldKey),
  );
  return router;
};
