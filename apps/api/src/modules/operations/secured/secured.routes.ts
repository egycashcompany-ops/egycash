// The secured (محصنة) surface, split by the legacy screens' real owners: Operations plans and
// assigns (`operationsShipment.*`), the treasury receives and releases (`operationsVault.*`).
// That split is the whole point of the boundary in ../treasury-boundary.ts.
import { Router } from 'express';
import { z } from 'zod';
import {
  AssignSecuredDeliveryLegSchema,
  DispatchSecuredShipmentsSchema,
  ListSecuredBacklogQuerySchema,
  ListSecuredDueQuerySchema,
  ListVaultInventoryQuerySchema,
  OperationsSecuredBoardQuerySchema,
  OperationsVaultQueueQuerySchema,
  ReceiveIntoVaultSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  assignDeliveryLeg,
  dispatchSecured,
  getSecuredBoard,
  getVaultQueue,
  listBacklog,
  listDue,
  listVaultInventory,
  receiveIntoVault,
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
  // /tash4ela_mohasana + /deliver_mohsana — what is due for delivery on a date.
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
  // /receive_mohsana — treasury takes custody.
  router.post(
    '/:id/receive',
    authenticate,
    authorize('operationsVault.receive'),
    validate({ body: ReceiveIntoVaultSchema, params: IdParamSchema }),
    asyncHandler(receiveIntoVault),
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
