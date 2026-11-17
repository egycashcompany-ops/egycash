// «أنواع التشغيل» (Round 20). The LIST answers whoever reads the crew board — the board names each
// row's «النوع» and offers the types in its picker, so `operationsCrew.view` must be enough — and
// the catalog's own managers, who keep it on the reference-data screen. Every write is
// `operationsCatalog.manage`, the one grant of the reference surface (banks/bank.routes.ts).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateOperationsShiftTypeSchema,
  ListOperationsReferenceQuerySchema,
  OrderOperationsShiftTypesSchema,
  UpdateOperationsShiftTypeSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createShiftType,
  listShiftTypes,
  orderShiftTypes,
  updateShiftType,
} from './shift-type.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsShiftTypesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny('operationsCrew.view', 'operationsCatalog.manage'),
    validate({ query: ListOperationsReferenceQuerySchema }),
    asyncHandler(listShiftTypes),
  );
  router.post(
    '/',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: CreateOperationsShiftTypeSchema }),
    asyncHandler(createShiftType),
  );
  // The dragged order — static, before `/:id`.
  router.put(
    '/order',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: OrderOperationsShiftTypesSchema }),
    asyncHandler(orderShiftTypes),
  );
  // No DELETE, as every catalog here: a crew row may point at the type, and `isActive: false` is
  // the honest "no longer offered" that leaves those rows reading their type.
  router.patch(
    '/:id',
    authenticate,
    authorize('operationsCatalog.manage'),
    validate({ body: UpdateOperationsShiftTypeSchema, params: IdParamSchema }),
    asyncHandler(updateShiftType),
  );
  return router;
};
