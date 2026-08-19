// Companies and funds. Reads open to anyone holding `goldCompany.view`; writes need their own
// grant, which is how the gold system had it (read for every authenticated user, write behind
// `manage_companies`) expressed in the ECMS permission vocabulary.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateGoldCompanySchema,
  ListGoldCompaniesQuerySchema,
  UpdateGoldCompanySchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createGoldCompany,
  deleteGoldCompany,
  getGoldCompany,
  listGoldCompanies,
  updateGoldCompany,
} from './company.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildGoldCompaniesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('goldCompany.view'),
    validate({ query: ListGoldCompaniesQuerySchema }),
    asyncHandler(listGoldCompanies),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('goldCompany.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getGoldCompany),
  );
  router.post(
    '/',
    authenticate,
    authorize('goldCompany.create'),
    validate({ body: CreateGoldCompanySchema }),
    asyncHandler(createGoldCompany),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('goldCompany.edit'),
    validate({ body: UpdateGoldCompanySchema, params: IdParamSchema }),
    asyncHandler(updateGoldCompany),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('goldCompany.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteGoldCompany),
  );
  return router;
};
