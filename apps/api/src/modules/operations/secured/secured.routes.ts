// The secured (محصنة) surface, split by the legacy screens' real owners: Operations plans and
// assigns (`operationsShipment.*`), the treasury receives and releases (`operationsVault.*`).
// That split is the whole point of the boundary in ../treasury-boundary.ts.
import { Router } from 'express';
import { z } from 'zod';
import {
  AssignSecuredDeliveryLegSchema,
  CancelVaultReceiptSchema,
  ConfirmSecuredPickupSchema,
  DispatchSecuredShipmentsSchema,
  ListSecuredBacklogQuerySchema,
  ListSecuredDueQuerySchema,
  ListVaultInventoryQuerySchema,
  OperationsSecuredBoardQuerySchema,
  OperationsSecuredDispatchBoardQuerySchema,
  OperationsSecuredDistributionQuerySchema,
  SaveSecuredDistributionSchema,
  OperationsVaultQueueQuerySchema,
  ReceiveIntoVaultSchema,
  UndoSecuredPickupSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  assignDeliveryLeg,
  cancelVaultReceipt,
  confirmSecuredPickup,
  dispatchSecured,
  getSecuredBoard,
  getSecuredDispatchBoard,
  getVaultQueue,
  listBacklog,
  listDue,
  listVaultInventory,
  receiveIntoVault,
  saveSecuredDistribution,
  getSecuredDistribution,
  undoSecuredPickup,
} from './secured.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsSecuredRouter = (): Router => {
  const router = Router();
  // /mohsana — the open secured backlog.
  router.get(
    '/backlog',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: ListSecuredBacklogQuerySchema }),
    asyncHandler(listBacklog),
  );
  // The secured screen (Round 8): the same backlog as board rows, coloured by stage. The backlog's
  // own grant — it is the same set, looked at the day board's way.
  router.get(
    '/board',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: OperationsSecuredBoardQuerySchema }),
    asyncHandler(getSecuredBoard),
  );
  // «شاشة استلام الخزينه» (Round 8): what the treasury receives — the vault screens' grant, like the
  // inventory below. Receiving itself stays `POST /:id/receive` on `operationsVault.receive`.
  router.get(
    '/vault-queue',
    authenticate,
    authorize('operationsVault.view'),
    validate({ query: OperationsVaultQueueQuerySchema }),
    asyncHandler(getVaultQueue),
  );
  // «صرف الخزينة» (Round 10) — EVERY shipment in the vault as board rows, one delivery day an
  // optional filter. The grant the `/operations/vault/dispatch` page itself rides — the vault
  // screens' — rather than `/due`'s `operationsShipment.view`: the page and its list now ask for the
  // same key, so nobody can open the screen and be refused its own list.
  router.get(
    '/dispatch-board',
    authenticate,
    authorize('operationsVault.view'),
    validate({ query: OperationsSecuredDispatchBoardQuerySchema }),
    asyncHandler(getSecuredDispatchBoard),
  );
  // «توزيع المحصنات» and «تسليم المحصنات» (Round 12) — ONE read for both screens: Operations
  // distributes from it (`operationsShipment.view`, the secured screen's grant) and the vault hands
  // each van over from it (`operationsVault.view`, the vault screens'). Either grant opens it; the
  // acts stay apart — placing is `operationsShipment.edit` (below, assign-delivery's grant), handing
  // over is the dispatch's `operationsVault.dispatch`.
  router.get(
    '/distribution',
    authenticate,
    authorizeAny('operationsShipment.view', 'operationsVault.view'),
    validate({ query: OperationsSecuredDistributionQuerySchema }),
    asyncHandler(getSecuredDistribution),
  );
  // «ولما يحفظ» — every placement of the screen in one transaction, on the grant that already
  // places a delivery leg (`/:id/assign-delivery`): distributing is that act, for many at once.
  router.post(
    '/distribution',
    authenticate,
    authorize('operationsShipment.edit'),
    validate({ body: SaveSecuredDistributionSchema }),
    asyncHandler(saveSecuredDistribution),
  );
  // /tash4ela_mohasana + /deliver_mohsana — what is due for delivery on a date (legacy parity; the
  // dispatch screen reads `/dispatch-board` since Round 10).
  router.get(
    '/due',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: ListSecuredDueQuerySchema }),
    asyncHandler(listDue),
  );
  // /vault1 — what the treasury is holding right now.
  router.get(
    '/vault',
    authenticate,
    authorize('operationsVault.view'),
    validate({ query: ListVaultInventoryQuerySchema }),
    asyncHandler(listVaultInventory),
  );
  // The desk's pickup ✓ «تم الاستلام من العمليات» and its undo — of the captain's ✓ too — (Round 10):
  // the desk's ✓ grant, one grant both directions, exactly as `complete` / `reopen` share it.
  router.post(
    '/:id/pickup',
    authenticate,
    authorize('operationsShipment.complete'),
    validate({ body: ConfirmSecuredPickupSchema, params: IdParamSchema }),
    asyncHandler(confirmSecuredPickup),
  );
  router.delete(
    '/:id/pickup',
    authenticate,
    authorize('operationsShipment.complete'),
    validate({ body: UndoSecuredPickupSchema, params: IdParamSchema }),
    asyncHandler(undoSecuredPickup),
  );
  // /receive_mohsana — treasury takes custody.
  router.post(
    '/:id/receive',
    authenticate,
    authorize('operationsVault.receive'),
    validate({ body: ReceiveIntoVaultSchema, params: IdParamSchema }),
    asyncHandler(receiveIntoVault),
  );
  // Cancel the vault's receipt (Round 10) — «صلاحية خاصة تقدر تلغى استلام الخزينة»: a grant of its
  // own, held by no role by default, so neither receiving nor dispatching implies it.
  router.post(
    '/:id/cancel-receipt',
    authenticate,
    authorize('operationsVault.cancelReceipt'),
    validate({ body: CancelVaultReceiptSchema, params: IdParamSchema }),
    asyncHandler(cancelVaultReceipt),
  );
  // /tash4ela_mohasana — Operations assigns the delivery leg (leader2 + car_num2).
  router.post(
    '/:id/assign-delivery',
    authenticate,
    authorize('operationsShipment.edit'),
    validate({ body: AssignSecuredDeliveryLegSchema, params: IdParamSchema }),
    asyncHandler(assignDeliveryLeg),
  );
  // /deliver_mohsana — treasury releases custody, shipments go out.
  router.post(
    '/dispatch',
    authenticate,
    authorize('operationsVault.dispatch'),
    validate({ body: DispatchSecuredShipmentsSchema }),
    asyncHandler(dispatchSecured),
  );
  return router;
};
