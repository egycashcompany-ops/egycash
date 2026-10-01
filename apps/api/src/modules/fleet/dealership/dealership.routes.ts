import { Router } from 'express';
import { z } from 'zod';
import {
  FleetDealershipSummaryQuerySchema,
  ListFleetDealershipInvoicesQuerySchema,
  UpdateFleetDealershipInvoiceSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { multipartSingle } from '../license-image-upload';
import {
  dealershipSummary,
  deleteDealershipImage,
  deleteDealershipInvoice,
  getDealershipImage,
  getDealershipInvoice,
  listDealershipInvoices,
  updateDealershipInvoice,
  uploadDealershipImage,
} from './dealership.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetDealershipRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetDealership.view'),
    validate({ query: ListFleetDealershipInvoicesQuerySchema }),
    asyncHandler(listDealershipInvoices),
  );
  // The figures between the filters and the table — over the whole filtered set, never a page.
  router.get(
    '/summary',
    authenticate,
    authorize('fleetDealership.view'),
    validate({ query: FleetDealershipSummaryQuerySchema }),
    asyncHandler(dealershipSummary),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('fleetDealership.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getDealershipInvoice),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetDealership.edit'),
    validate({ body: UpdateFleetDealershipInvoiceSchema, params: IdParamSchema }),
    asyncHandler(updateDealershipInvoice),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetDealership.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteDealershipInvoice),
  );
  // The scan of the bill — whoever may edit the row may manage it, whoever may view may see it.
  router.get(
    '/:id/image',
    authenticate,
    authorize('fleetDealership.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getDealershipImage),
  );
  router.post(
    '/:id/image',
    authenticate,
    authorize('fleetDealership.edit'),
    multipartSingle(),
    validate({ params: IdParamSchema }),
    asyncHandler(uploadDealershipImage),
  );
  router.delete(
    '/:id/image',
    authenticate,
    authorize('fleetDealership.edit'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteDealershipImage),
  );
  return router;
};
