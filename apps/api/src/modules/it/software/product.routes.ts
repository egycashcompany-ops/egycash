// The software catalogue (design §7, §12).
//
// Reads take EITHER software grant OR the licence one: a licence form's product dropdown must
// populate for whoever manages licences, and the catalogue screen is `itSoftware.view`. Same shape,
// and same reason, as the catalog and priority read gates.
//
// No DELETE: products archive (FR-11) — installations and licences point at them forever.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateItSoftwareProductSchema,
  ListItSoftwareProductsQuerySchema,
  UpdateItSoftwareProductSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createItSoftwareProduct,
  getItSoftwareProduct,
  listItSoftwareProducts,
  updateItSoftwareProduct,
} from './product.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildItSoftwareProductsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny('itSoftware.view', 'itLicense.view'),
    validate({ query: ListItSoftwareProductsQuerySchema }),
    asyncHandler(listItSoftwareProducts),
  );
  router.post(
    '/',
    authenticate,
    authorize('itSoftware.manage'),
    validate({ body: CreateItSoftwareProductSchema }),
    asyncHandler(createItSoftwareProduct),
  );
  router.get(
    '/:id',
    authenticate,
    authorizeAny('itSoftware.view', 'itLicense.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getItSoftwareProduct),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itSoftware.manage'),
    validate({ body: UpdateItSoftwareProductSchema, params: IdParamSchema }),
    asyncHandler(updateItSoftwareProduct),
  );
  return router;
};
