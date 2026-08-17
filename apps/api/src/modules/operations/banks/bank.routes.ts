// Reference reads ride `operationsShipment.view` because every operations form needs these
// pickers; mutations are the settings surface, `operationsCatalog.manage` (the fleet-catalog
// precedent, catalog-item.routes.ts:1-3).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateOperationsBankSchema,
  ListOperationsReferenceQuerySchema,
  UpdateOperationsBankSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { createBank, listBanks, updateBank } from './bank.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsBanksRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('operationsShipment.view'),
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
