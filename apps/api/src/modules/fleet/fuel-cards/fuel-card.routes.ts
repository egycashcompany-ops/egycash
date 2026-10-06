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
  TransferFleetFuelBatchSchema,
  UpdateFleetFuelCardMovementSchema,
  UpdateFleetFuelCardSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { multipartSingle } from '../license-image-upload';
import {
  approveFuelCharge,
  createFuelCard,
  deleteFuelCard,
  deleteFuelCardImage,
  fuelCardSummary,
  getFuelCard,
  getFuelCardImage,
  listFuelCardMovements,
  listFuelCards,
  requestFuelCharge,
  revealFuelCardPassword,
  transferFuelBalance,
  transferFuelBatch,
  updateFuelCardMovement,
  deleteFuelCardMovement,
  updateFuelCard,
  uploadFuelCardImage,
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
  // A line of the log takes a new amount or is removed — under the grant of the kind of line it
  // is (a charge: approve; a transfer: transfer), which the service resolves from the line.
  router.patch(
    '/movements/:id',
    authenticate,
    authorizeAny('fleetFuelCharge.approve', 'fleetFuelCharge.transfer'),
    validate({ body: UpdateFleetFuelCardMovementSchema, params: IdParamSchema }),
    asyncHandler(updateFuelCardMovement),
  );
  router.delete(
    '/movements/:id',
    authenticate,
    authorizeAny('fleetFuelCharge.approve', 'fleetFuelCharge.transfer'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteFuelCardMovement),
  );
  router.post(
    '/transfer',
    authenticate,
    authorize('fleetFuelCharge.transfer'),
    validate({ body: TransferFleetFuelBalanceSchema }),
    asyncHandler(transferFuelBalance),
  );
  // Several transfers in one press — each one card to one card or more.
  router.post(
    '/transfers',
    authenticate,
    authorize('fleetFuelCharge.transfer'),
    validate({ body: TransferFleetFuelBatchSchema }),
    asyncHandler(transferFuelBatch),
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
  // The photo of the card — whoever may edit the card may manage it, whoever may view may see it.
  router.get(
    '/:id/image',
    authenticate,
    authorize('fleetFuelCard.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getFuelCardImage),
  );
  router.post(
    '/:id/image',
    authenticate,
    authorize('fleetFuelCard.edit'),
    multipartSingle(),
    validate({ params: IdParamSchema }),
    asyncHandler(uploadFuelCardImage),
  );
  router.delete(
    '/:id/image',
    authenticate,
    authorize('fleetFuelCard.edit'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteFuelCardImage),
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
