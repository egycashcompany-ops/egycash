// Vendors (design §7): `itVendor.view` to read, `itVendor.manage` to write. The list carries
// `search` from day one — vendors are a growth catalog and pickers search them (ADR-019 rule 5).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateItVendorSchema,
  ListItVendorsQuerySchema,
  UpdateItVendorSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createItVendor,
  getItVendor,
  listItVendors,
  updateItVendor,
} from './vendor.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildItVendorsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itVendor.view'),
    validate({ query: ListItVendorsQuerySchema }),
    asyncHandler(listItVendors),
  );
  // Resolve-by-id, the other half of ADR-019 rule 5: a picker searches to choose, but a form
  // holding a stored `vendorId` has only the id and still has to show a name. Same `itVendor.view`
  // gate as the list — it returns one row of what the list already returns, so it grants nothing
  // new.
  router.get(
    '/:id',
    authenticate,
    authorize('itVendor.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getItVendor),
  );
  router.post(
    '/',
    authenticate,
    authorize('itVendor.manage'),
    validate({ body: CreateItVendorSchema }),
    asyncHandler(createItVendor),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itVendor.manage'),
    validate({ body: UpdateItVendorSchema, params: IdParamSchema }),
    asyncHandler(updateItVendor),
  );
  return router;
};
