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
  ListItAssetNamesQuerySchema,
  ListItAssetsQuerySchema,
  ListItAssignmentsQuerySchema,
  MoveItAssetsToBranchSchema,
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
  getItAssetCounterReadings,
  listItAssetNames,
  listItAssets,
  renderItAssetLabels,
  updateItAsset,
} from './asset.controller';
import {
  assetWorkbookUpload,
  importItAssets,
  listItAssetImportBranches,
} from './asset-import.controller';
import {
  assignItAsset,
  disposeItAsset,
  listItAssetAssignments,
  listItAssetHistory,
  listItMoveTargets,
  moveItAssetsToBranch,
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
  // The name filter's options (`?name=` above) — under the read grant and its scope, so a reader is
  // offered only the names of assets they can see; `?categoryId=a,b` narrows them to the chosen
  // categories. Before '/:id', like every literal segment here.
  router.get(
    '/names',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ListItAssetNamesQuerySchema }),
    asyncHandler(listItAssetNames),
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
  // «نقل إلى فرع» — several assets to one branch at once, a held one with its custody. The custody
  // grant: it moves an asset in stock and transfers a held one, and needs nothing beyond what
  // transfer already does (design §7 — no new key).
  router.post(
    '/move-branch',
    authenticate,
    authorize('itAsset.assign'),
    validate({ body: MoveItAssetsToBranchSchema }),
    asyncHandler(moveItAssetsToBranch),
  );
  // Where that move may go: the branches `itAsset.assign` reaches as the server judges it, not the
  // account's reach over all its grants (the consumables' transfer asks its own grant, at
  // `/it/consumables/transfer-targets`). Before '/:id' like every literal segment here.
  router.get(
    '/move-targets',
    authenticate,
    authorize('itAsset.assign'),
    asyncHandler(listItMoveTargets),
  );
  // «رفع جماعي» — «عايز زرار Bulk Upload للأصول بنفس شكل عهدة الأفرع ويكون فى Preview الأول»: the
  // branches' custody sheet, previewed (200) and then applied (201), under the registration grant.
  // A line that fills or moves a device the register holds needs `itAsset.edit` / `itAsset.assign`
  // over it as well — the service reports it out of reach otherwise. The workbook is held in
  // memory. Before '/:id' like every literal segment here.
  router.post(
    '/import',
    authenticate,
    authorize('itAsset.create'),
    assetWorkbookUpload(),
    asyncHandler(importItAssets),
  );
  // Where that upload may register — the active branches `itAsset.create` reaches as the server
  // judges it (the move-targets' answer, asked of the registration grant), so the screen's branch
  // picker offers nothing the upload would refuse. Before '/:id' like every literal segment here.
  router.get(
    '/import/branches',
    authenticate,
    authorize('itAsset.create'),
    asyncHandler(listItAssetImportBranches),
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
  // «عداد الطابعة» (2026-11-19) — the printer's counter readings, each with the toner it was taken
  // with and the cartridge of the same item it replaced. A fact of the printer: on the register's
  // read grant (naming a printer at «صرف» needs it already), and read across every store's toners.
  // On this router, not the consumables': no consumables route authorizes on `itAsset`.
  router.get(
    '/:id/counter-readings',
    authenticate,
    authorize('itAsset.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getItAssetCounterReadings),
  );
  return router;
};
