// Assignment + ordering. Assigning a leg is a shipment edit (`operationsShipment.edit`, the grant
// OP-4 already used for the delivery leg); reordering a captain's day is a planning act on the
// crew board, so it rides `operationsCrew.reorder` — the design's own split (§16.2).
import { Router } from 'express';
import { z } from 'zod';
import {
  AssignShipmentPickupLegSchema,
  OperationsCaptainRouteQuerySchema,
  ReorderCaptainShipmentsSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  assignPickupLeg,
  getCaptainRoute,
  reorderCaptainShipments,
} from './assignment.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsAssignmentsRouter = (): Router => {
  const router = Router();
  // The captain's ordered day — what the mobile slice will read.
  router.get(
    '/route',
    authenticate,
    authorize('operationsCrew.view'),
    validate({ query: OperationsCaptainRouteQuerySchema }),
    asyncHandler(getCaptainRoute),
  );
  router.post(
    '/shipments/:id/assign-pickup',
    authenticate,
    authorize('operationsShipment.edit'),
    validate({ body: AssignShipmentPickupLegSchema, params: IdParamSchema }),
    asyncHandler(assignPickupLeg),
  );
  router.put(
    '/order',
    authenticate,
    authorize('operationsCrew.reorder'),
    validate({ body: ReorderCaptainShipmentsSchema }),
    asyncHandler(reorderCaptainShipments),
  );
  return router;
};
