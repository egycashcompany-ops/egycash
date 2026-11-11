// Reference reads ride `operationsShipment.view` because every operations form needs these
// pickers; mutations are the settings surface, `operationsCatalog.manage` (the fleet-catalog
// precedent, catalog-item.routes.ts:1-3).
//
// The LIST also answers `operationsVault.view`: «شاشة الاستلام من الخزنة خليها زى شاشة التشغيل
// اليومى» — the vault's receive queue is the operations board, which prints each row's bank by
// its catalog name, and a treasurer may hold the vault's grant without the shipment one. Without
// this his «اسم البنك» column was blank. Any-of, as the Fleet catalogs widened their read for the
// screens that point at them (catalog-read-permission.spec.ts). Reading names only — every write
// stays the catalog grant's.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateOperationsBankSchema,
  ListOperationsReferenceQuerySchema,
  UpdateOperationsBankSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { createBank, listBanks, updateBank } from './bank.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsBanksRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny('operationsShipment.view', 'operationsVault.view'),
    validate({ query: ListOperationsReferenceQuerySchema }),
    asyncHandler(listBanks),
  );
  router.post(
    '/',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: CreateOperationsBankSchema }),
    asyncHandler(createBank),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: UpdateOperationsBankSchema, params: IdParamSchema }),
    asyncHandler(updateBank),
  );
  return router;
};
