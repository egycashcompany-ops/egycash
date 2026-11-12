// Reads ride `operationsShipment.view` — the branch form needs the suggestions, and anyone who
// can see a shipment can see them. Mutations are `operationsCatalog.manage`, the one grant that
// covers the whole reference surface (banks/bank.routes.ts precedent).
//
// Round 12 — the list also answers `operationsVault.view`, with the branches': the vault's receive
// screen opens the secured screen's shipment form («اضافة ل محصنة زى شاشة الشحنات المحصنة
// بالظبط»), whose area box reads it (bank-branches/bank-branch.routes.ts). Names only.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateOperationsAreaSchema,
  ListOperationsReferenceQuerySchema,
  UpdateOperationsAreaSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { createArea, listAreas, updateArea } from './area.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsAreasRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny('operationsShipment.view', 'operationsVault.view'),
    validate({ query: ListOperationsReferenceQuerySchema }),
    asyncHandler(listAreas),
  );
  router.post(
    '/',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: CreateOperationsAreaSchema }),
    asyncHandler(createArea),
  );
  // No DELETE, exactly as the other catalogs: legacy's delete was soft with no referential check
  // (:2192), and `isActive: false` is that behaviour with a name that says what it does.
  router.patch(
    '/:id',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: UpdateOperationsAreaSchema, params: IdParamSchema }),
    asyncHandler(updateArea),
  );
  return router;
};
