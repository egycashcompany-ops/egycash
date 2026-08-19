// Reads ride `operationsShipment.view`; mutations are `operationsCatalog.manage` (fleet-catalog
// precedent — see banks/bank.routes.ts).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateOperationsCurrencySchema,
  ListOperationsReferenceQuerySchema,
  UpdateOperationsCurrencySchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { createCurrency, listCurrencies, updateCurrency } from './currency.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsCurrenciesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: ListOperationsReferenceQuerySchema }),
    asyncHandler(listCurrencies),
  );
  router.post(
    '/',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: CreateOperationsCurrencySchema }),
    asyncHandler(createCurrency),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: UpdateOperationsCurrencySchema, params: IdParamSchema }),
    asyncHandler(updateCurrency),
  );
  return router;
};
