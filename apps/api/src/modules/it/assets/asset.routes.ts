// Asset register routes (design §12). Labels ride `itAsset.view` — a label shows nothing the
// viewer cannot already see (design §4.2); delete is the FR-5 registered-in-error window only.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateItAssetSchema,
  ItAssetLabelsSchema,
  ListItAssetsQuerySchema,
  UpdateItAssetSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createItAsset,
  deleteItAsset,
  getItAsset,
  getItAssetByCode,
  listItAssets,
  renderItAssetLabels,
  updateItAsset,
} from './asset.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();
const CodeParamSchema = z.object({ code: z.string().trim().min(1).max(30) }).strict();

export const buildItAssetsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ListItAssetsQuerySchema }),
    asyncHandler(listItAssets),
  );
  // Before '/:id' so the literal segment is not swallowed by the id matcher.
  router.get(
    '/by-code/:code',
    authenticate,
    authorize('itAsset.view'),
    validate({ params: CodeParamSchema }),
    asyncHandler(getItAssetByCode),
  );
  router.post(
    '/labels',
    authenticate,
    authorize('itAsset.view'),
    validate({ body: ItAssetLabelsSchema }),
    asyncHandler(renderItAssetLabels),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itAsset.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getItAsset),
  );
  router.post(
    '/',
    authenticate,
    authorize('itAsset.create'),
    validate({ body: CreateItAssetSchema }),
    asyncHandler(createItAsset),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itAsset.edit'),
    validate({ body: UpdateItAssetSchema, params: IdParamSchema }),
    asyncHandler(updateItAsset),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('itAsset.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteItAsset),
  );
  return router;
};
