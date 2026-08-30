import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetAccidentSchema,
  FleetAccidentSummaryQuerySchema,
  ListFleetAccidentsQuerySchema,
  SetFleetAccidentStatusSchema,
  UpdateFleetAccidentSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  accidentSummary,
  createAccident,
  deleteAccident,
  listAccidents,
  setAccidentStatus,
  updateAccident,
} from './accident.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetAccidentsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetAccident.view'),
    validate({ query: ListFleetAccidentsQuerySchema }),
    asyncHandler(listAccidents),
  );
  // The figures under the list. Same filters, same grant, deliberately no pagination — see
  // `FleetAccidentSummaryQuerySchema`. Declared before nothing dynamic, so no route shadows it.
  router.get(
    '/summary',
    authenticate,
    authorize('fleetAccident.view'),
    validate({ query: FleetAccidentSummaryQuerySchema }),
    asyncHandler(accidentSummary),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetAccident.create'),
    validate({ body: CreateFleetAccidentSchema }),
    asyncHandler(createAccident),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetAccident.edit'),
    validate({ body: UpdateFleetAccidentSchema, params: IdParamSchema }),
    asyncHandler(updateAccident),
  );
  // FR-10 — one grant covers BOTH directions: whoever may close may reopen.
  router.post(
    '/:id/status',
    authenticate,
    authorize('fleetAccident.close'),
    validate({ body: SetFleetAccidentStatusSchema, params: IdParamSchema }),
    asyncHandler(setAccidentStatus),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetAccident.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteAccident),
  );
  return router;
};
