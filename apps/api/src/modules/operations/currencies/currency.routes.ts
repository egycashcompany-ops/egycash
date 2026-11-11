// Reads ride `operationsShipment.view`; mutations are `operationsCatalog.manage` (fleet-catalog
// precedent — see banks/bank.routes.ts). The LIST also answers `operationsVault.view`, for the
// same reason as the banks': the vault's receive queue is the operations board, and it names each
// row's money and figures by the catalog's currency names — for a treasurer who may hold the
// vault's grant alone.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateOperationsCurrencySchema,
  ListOperationsReferenceQuerySchema,
  OrderOperationsCurrenciesSchema,
  UpdateOperationsCurrencySchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createCurrency,
  listCurrencies,
  orderCurrencies,
  updateCurrency,
} from './currency.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsCurrenciesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny('operationsShipment.view', 'operationsVault.view'),
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
  // «اعملى فى شاشة البيانات المرجعية ان اقدر اعدل زى شاشة الحركة بالظبط» — the catalog's dragged
  // order, on the catalog grant like every other write here. Static, before `/:id`.
  router.put(
    '/order',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: OrderOperationsCurrenciesSchema }),
    asyncHandler(orderCurrencies),
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
