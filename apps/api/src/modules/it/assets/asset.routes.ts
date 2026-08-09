// Asset register routes (design §12). Labels ride `itAsset.view` — a label shows nothing the
// viewer cannot already see (design §4.2); delete is the FR-5 registered-in-error window only.
// The custody block at the bottom is IT-2: four named actions plus the two read surfaces.
import { Router } from 'express';
import { z } from 'zod';
import {
  AssignItAssetSchema,
  CreateItAssetSchema,
  DisposeItAssetSchema,
  ItAssetLabelsSchema,
  ListItAssetHistoryQuerySchema,
  ListItAssetsQuerySchema,
  ListItAssignmentsQuerySchema,
  ReturnItAssetSchema,
  TransferItAssetSchema,
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
import {
  assignItAsset,
  disposeItAsset,
  listItAssetAssignments,
  listItAssetHistory,
  returnItAsset,
  transferItAsset,
} from './custody.controller';

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

  // ── Custody (IT-2, design §4.3) ───────────────────────────────────────────
  // Named actions, never a generic PATCH: each is a distinct business act with its own guard,
  // event and audit action. `assign` covers assign + return + transfer — one custody grant for one
  // operational surface (design §7, the roster precedent) — while `dispose` is its own grant
  // because writing an asset off is a different decision from moving it between hands.
  router.post(
    '/:id/assign',
    authenticate,
    authorize('itAsset.assign'),
    validate({ body: AssignItAssetSchema, params: IdParamSchema }),
    asyncHandler(assignItAsset),
  );
  router.post(
    '/:id/return',
    authenticate,
    authorize('itAsset.assign'),
    validate({ body: ReturnItAssetSchema, params: IdParamSchema }),
    asyncHandler(returnItAsset),
  );
  router.post(
    '/:id/transfer',
    authenticate,
    authorize('itAsset.assign'),
    validate({ body: TransferItAssetSchema, params: IdParamSchema }),
    asyncHandler(transferItAsset),
  );
  router.post(
    '/:id/dispose',
    authenticate,
    authorize('itAsset.dispose'),
    validate({ body: DisposeItAssetSchema, params: IdParamSchema }),
    asyncHandler(disposeItAsset),
  );
  // Reads ride `itAsset.view`: the history and the custody list show nothing the asset itself
  // does not already reveal to a viewer.
  router.get(
    '/:id/history',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ListItAssetHistoryQuerySchema, params: IdParamSchema }),
    asyncHandler(listItAssetHistory),
  );
  router.get(
    '/:id/assignments',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ListItAssignmentsQuerySchema, params: IdParamSchema }),
    asyncHandler(listItAssetAssignments),
  );
  return router;
};
