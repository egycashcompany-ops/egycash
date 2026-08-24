// Floors ride the vault grants: a floor is part of how the vaults are laid out, not a thing anyone
// administers separately. This is the gold wiring (floors were behind `manage_vaults`) expressed
// in the ECMS vocabulary.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateGoldFloorSchema,
  ReorderGoldItemsSchema,
  UpdateGoldFloorSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createGoldFloor,
  deleteGoldFloor,
  listGoldFloors,
  reorderGoldFloors,
  updateGoldFloor,
} from './floor.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildGoldFloorsRouter = (): Router => {
  const router = Router();
  router.get('/', authenticate, authorize('goldVault.view'), asyncHandler(listGoldFloors));
  router.post(
    '/',
    authenticate,
    authorize('goldVault.create'),
    validate({ body: CreateGoldFloorSchema }),
    asyncHandler(createGoldFloor),
  );
  // Before '/:id' so the literal segment is not swallowed by the id matcher.
  router.patch(
    '/reorder',
    authenticate,
    authorize('goldVault.edit'),
    validate({ body: ReorderGoldItemsSchema }),
    asyncHandler(reorderGoldFloors),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('goldVault.edit'),
    validate({ body: UpdateGoldFloorSchema, params: IdParamSchema }),
    asyncHandler(updateGoldFloor),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('goldVault.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteGoldFloor),
  );
  return router;
};
