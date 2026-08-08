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
import { createItVendor, listItVendors, updateItVendor } from './vendor.controller';

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
