import { Router } from 'express';
import { z } from 'zod';
import {
  AddFleetFuelSheetCardSchema,
  ApproveFleetFuelChargeSchema,
  CreateFleetFuelCardSchema,
  DecideFleetFuelLinksSchema,
  DecideFleetFuelReconcileSchema,
  FleetFuelCardSummaryQuerySchema,
  ListFleetFuelCardMovementsQuerySchema,
  ListFleetFuelCardsQuerySchema,
  RequestFleetFuelChargeSchema,
  TransferFleetFuelBalanceSchema,
  TransferFleetFuelBatchSchema,
  UpdateFleetFuelCardMovementSchema,
  UpdateFleetFuelCardSchema,
  UploadFleetFuelSheetSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { multipartImageAndThumb, multipartThumb } from './fuel-card-upload';
import {
  approveFuelCharge,
  createFuelCard,
  deleteFuelCard,
  deleteFuelCardImage,
  fuelCardSummary,
  getFuelCard,
  getFuelCardImage,
  getFuelCardImageThumb,
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
  uploadFuelCardThumb,
} from './fuel-card.controller';
import {
  addFuelReconcileCard,
  decideFuelReconcile,
  decideFuelReconcileLinks,
  uploadFuelSheet,
} from './reconcile/fuel-reconcile.controller';
import { fuelSheetUpload, noStore } from './reconcile/fuel-sheet-upload';
import { buildFleetFuelNumberRepairRouter } from './number-repair/number-repair.routes';

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
  // «تصحيح أرقام الكروت» (6d) — its own router, BEFORE the `/:id` group like `reconcile` below.
  router.use('/number-repair', buildFleetFuelNumberRepairRouter());
  // «مطابقة أرصدة الكروت» — BEFORE the `/:id` group, so `reconcile` is never read as a card id.
  // Reading the company's sheet writes no balance: the charging screen's view grant. Deciding on
  // it sets balances: the grant that approves a charge.
  router.post(
    '/reconcile',
    authenticate,
    authorize('fleetFuelCharge.view'),
    noStore,
    fuelSheetUpload(),
    validate({ body: UploadFleetFuelSheetSchema }),
    asyncHandler(uploadFuelSheet),
  );
  router.post(
    '/reconcile/:id/decisions',
    authenticate,
    authorize('fleetFuelCharge.approve'),
    noStore,
    validate({ body: DecideFleetFuelReconcileSchema, params: IdParamSchema }),
    asyncHandler(decideFuelReconcile),
  );
  // «ربط الكروت بالسيارات» moves a card between cars — the grant that moves one on «بطاقات الوقود».
  router.post(
    '/reconcile/:id/links',
    authenticate,
    authorize('fleetFuelCard.edit'),
    noStore,
    validate({ body: DecideFleetFuelLinksSchema, params: IdParamSchema }),
    asyncHandler(decideFuelReconcileLinks),
  );
  // «إضافة» a sheet-only card — the grant that adds a card there, AND the one that puts money on a
  // card: the new card opens at the sheet's balance (its opening `sheetAdjust`), as the balance ✓
  // on the same sheet does — the person who keeps the card list is not always the one who releases
  // money onto it.
  router.post(
    '/reconcile/:id/cards',
    authenticate,
    authorize('fleetFuelCard.create'),
    authorize('fleetFuelCharge.approve'),
    noStore,
    validate({ body: AddFleetFuelSheetCardSchema, params: IdParamSchema }),
    asyncHandler(addFuelReconcileCard),
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
  // The photo of the card — whoever may edit the card may manage it. 6d: the photo shows the PIN on
  // its sticker, so the FULL photo is the PIN's own grant (`reveal`, as `/:id/password`); every
  // reader of the cards sees its thumbnail. A thumbnail for a photo uploaded before 6d is made by the
  // screen of an editor who may see the photo — so its route asks both.
  router.get(
    '/:id/image',
    authenticate,
    authorize('fleetFuelCard.reveal'),
    validate({ params: IdParamSchema }),
    asyncHandler(getFuelCardImage),
  );
  router.get(
    '/:id/image/thumb',
    authenticate,
    authorize('fleetFuelCard.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getFuelCardImageThumb),
  );
  router.post(
    '/:id/image',
    authenticate,
    authorize('fleetFuelCard.edit'),
    multipartImageAndThumb(),
    validate({ params: IdParamSchema }),
    asyncHandler(uploadFuelCardImage),
  );
  router.post(
    '/:id/image/thumb',
    authenticate,
    authorize('fleetFuelCard.edit'),
    authorize('fleetFuelCard.reveal'),
    multipartThumb(),
    validate({ params: IdParamSchema }),
    asyncHandler(uploadFuelCardThumb),
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
