// Router: authenticate → authorize → validate → controller.
import { Router } from 'express';
import { z } from 'zod';
import {
  objectId,
  CreatePayItemSchema,
  ListPayItemsQuerySchema,
  UpdatePayItemSchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  createPayItem,
  deletePayItem,
  getPayItem,
  listPayItems,
  updatePayItem,
} from './pay-item.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildPayItemsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('payItem.view'),
    validate({ query: ListPayItemsQuerySchema }),
    asyncHandler(listPayItems),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('payItem.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getPayItem),
  );
  router.post(
    '/',
    authenticate,
    authorize('payItem.create'),
    validate({ body: CreatePayItemSchema }),
    asyncHandler(createPayItem),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('payItem.edit'),
    validate({ body: UpdatePayItemSchema, params: IdParamSchema }),
    asyncHandler(updatePayItem),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('payItem.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deletePayItem),
  );
  return router;
};
