// Day reads ride `operationsCrew.view` (the board is where the day lives); create/open/close are
// the management surface, `operationsDay.manage` — one grant, the fleet-roster one-surface
// precedent.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateOperationsDaySchema,
  GetOperationsDayQuerySchema,
  TransitionOperationsDaySchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { closeDay, createDay, getDayByDate, openDay } from './day.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsDaysRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('operationsCrew.view'),
    validate({ query: GetOperationsDayQuerySchema }),
    asyncHandler(getDayByDate),
  );
  router.post(
    '/',
    authenticate,
    authorize('operationsDay.manage'),
    validate({ body: CreateOperationsDaySchema }),
    asyncHandler(createDay),
  );
  router.post(
    '/:id/open',
    authenticate,
    authorize('operationsDay.manage'),
    validate({ body: TransitionOperationsDaySchema, params: IdParamSchema }),
    asyncHandler(openDay),
  );
  router.post(
    '/:id/close',
    authenticate,
    authorize('operationsDay.manage'),
    validate({ body: TransitionOperationsDaySchema, params: IdParamSchema }),
    asyncHandler(closeDay),
  );
  return router;
};
