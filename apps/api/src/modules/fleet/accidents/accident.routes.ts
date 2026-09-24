import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetAccidentSchema,
  FleetAccidentSummaryQuerySchema,
  FleetAccidentTransfersQuerySchema,
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
  carTransfers,
  createAccident,
  deleteAccident,
  voidTransfer,
  listAccidents,
  setAccidentStatus,
  updateAccident,
} from './accident.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();
const TransferParamSchema = z.object({ id: objectId(), transferId: objectId() }).strict();

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
  // «خدت من مين او ادت ل مين» — one car's transfers and what it has left. Static, so it is
  // declared before `/:id` could read `transfers` as an id.
  router.get(
    '/transfers',
    authenticate,
    authorize('fleetAccident.view'),
    validate({ query: FleetAccidentTransfersQuerySchema }),
    asyncHandler(carTransfers),
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
  // Removing a transfer puts the amount back where it came from — an edit to the file holding it.
  router.delete(
    '/:id/transfers/:transferId',
    authenticate,
    authorize('fleetAccident.edit'),
    validate({ params: TransferParamSchema }),
    asyncHandler(voidTransfer),
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
