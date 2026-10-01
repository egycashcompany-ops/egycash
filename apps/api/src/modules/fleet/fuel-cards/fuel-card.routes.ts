import { Router } from 'express';
import { z } from 'zod';
import {
  ApproveFleetFuelChargeSchema,
  CreateFleetFuelCardSchema,
  FleetFuelCardSummaryQuerySchema,
  ListFleetFuelCardMovementsQuerySchema,
  ListFleetFuelCardsQuerySchema,
  RequestFleetFuelChargeSchema,
  TransferFleetFuelBalanceSchema,
  UpdateFleetFuelCardSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  approveFuelCharge,
  createFuelCard,
  deleteFuelCard,
  fuelCardSummary,
  getFuelCard,
  listFuelCardMovements,
  listFuelCards,
  requestFuelCharge,
  revealFuelCardPassword,
  transferFuelBalance,
  updateFuelCard,
} from './fuel-card.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetFuelCardsRouter = (): Router => {
  const router = Router();
  // The registry of cards — the cards screen's grants.
  router.get(
    '/',
    authenticate,
    authorize('fleetFuelCard.view'),
    validate({ query: ListFleetFuelCardsQuerySchema }),
    asyncHandler(listFuelCards),
  );
  router.get(
    '/summary',
    authenticate,
    authorize('fleetFuelCard.view'),
    validate({ query: FleetFuelCardSummaryQuerySchema }),
    asyncHandler(fuelCardSummary),
  );
  router.get(
    '/movements',
    authenticate,
    authorize('fleetFuelCard.view'),
    validate({ query: ListFleetFuelCardMovementsQuerySchema }),
    asyncHandler(listFuelCardMovements),
  );
  // Balances move under the CHARGING screen's grants — reading a card is not moving its money.
  router.post(
    '/transfer',
    authenticate,
    authorize('fleetFuelCharge.transfer'),
    validate({ body: TransferFleetFuelBalanceSchema }),
    asyncHandler(transferFuelBalance),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('fleetFuelCard.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getFuelCard),
  );
  // The password — its own grant, and never in the list.
  router.get(
    '/:id/password',
    authenticate,
    authorize('fleetFuelCard.reveal'),
    validate({ params: IdParamSchema }),
    asyncHandler(revealFuelCardPassword),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetFuelCard.create'),
    validate({ body: CreateFleetFuelCardSchema }),
    asyncHandler(createFuelCard),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetFuelCard.edit'),
    validate({ body: UpdateFleetFuelCardSchema, params: IdParamSchema }),
    asyncHandler(updateFuelCard),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetFuelCard.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteFuelCard),
  );
  router.patch(
    '/:id/request',
    authenticate,
    authorize('fleetFuelCharge.request'),
    validate({ body: RequestFleetFuelChargeSchema, params: IdParamSchema }),
    asyncHandler(requestFuelCharge),
  );
  router.post(
    '/:id/approve',
    authenticate,
    authorize('fleetFuelCharge.approve'),
    validate({ body: ApproveFleetFuelChargeSchema, params: IdParamSchema }),
    asyncHandler(approveFuelCharge),
  );
  return router;
};
