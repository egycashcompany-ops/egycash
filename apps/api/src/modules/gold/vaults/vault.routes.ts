// Vaults, their layouts and their drawers. `goldVault.view` reads; the layout operations are
// `goldVault.edit`, because a layout change is an edit to the vault whatever it does to the
// drawers underneath — the gold system gated all of them on the same `manage_vaults`.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateGoldVaultSchema,
  GenerateGoldLayoutSchema,
  ListGoldVaultsQuerySchema,
  PreviewGoldLayoutSchema,
  ReorderGoldItemsSchema,
  UpdateGoldVaultSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createGoldVault,
  deleteGoldVault,
  generateGoldLayout,
  getGoldDrawer,
  getGoldVault,
  listGoldVaultDrawers,
  listGoldVaults,
  previewGoldLayout,
  reorderGoldVaults,
  reshapeGoldLayout,
  updateGoldVault,
} from './vault.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildGoldVaultsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('goldVault.view'),
    validate({ query: ListGoldVaultsQuerySchema }),
    asyncHandler(listGoldVaults),
  );
  // The two literal segments come before '/:id' so the id matcher cannot swallow them.
  router.patch(
    '/reorder',
    authenticate,
    authorize('goldVault.edit'),
    validate({ body: ReorderGoldItemsSchema }),
    asyncHandler(reorderGoldVaults),
  );
  router.post(
    '/preview-layout',
    authenticate,
    authorize('goldVault.edit'),
    validate({ body: PreviewGoldLayoutSchema }),
    asyncHandler(previewGoldLayout),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('goldVault.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getGoldVault),
  );
  router.post(
    '/',
    authenticate,
    authorize('goldVault.create'),
    validate({ body: CreateGoldVaultSchema }),
    asyncHandler(createGoldVault),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('goldVault.edit'),
    validate({ body: UpdateGoldVaultSchema, params: IdParamSchema }),
    asyncHandler(updateGoldVault),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('goldVault.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteGoldVault),
  );
  router.post(
    '/:id/generate-layout',
    authenticate,
    authorize('goldVault.edit'),
    validate({ body: GenerateGoldLayoutSchema, params: IdParamSchema }),
    asyncHandler(generateGoldLayout),
  );
  router.post(
    '/:id/reshape-layout',
    authenticate,
    authorize('goldVault.edit'),
    validate({ body: GenerateGoldLayoutSchema, params: IdParamSchema }),
    asyncHandler(reshapeGoldLayout),
  );
  router.get(
    '/:id/drawers',
    authenticate,
    authorize('goldVault.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(listGoldVaultDrawers),
  );
  return router;
};

/** One drawer with its contents — its own prefix because it is not nested under a vault id. */
export const buildGoldDrawersRouter = (): Router => {
  const router = Router();
  router.get(
    '/:id',
    authenticate,
    authorize('goldVault.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getGoldDrawer),
  );
  return router;
};
