// Customer delegates. Note these are the CUSTOMER's people; EGYCASH's own vault custodians are HR
// employees and are not administered here (integration 2).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateGoldRepresentativeSchema,
  ListGoldRepresentativesQuerySchema,
  UpdateGoldRepresentativeSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createGoldRepresentative,
  deleteGoldRepresentative,
  getGoldRepresentative,
  listGoldRepresentatives,
  updateGoldRepresentative,
} from './representative.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildGoldRepresentativesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('goldRepresentative.view'),
    validate({ query: ListGoldRepresentativesQuerySchema }),
    asyncHandler(listGoldRepresentatives),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('goldRepresentative.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getGoldRepresentative),
  );
  router.post(
    '/',
    authenticate,
    authorize('goldRepresentative.create'),
    validate({ body: CreateGoldRepresentativeSchema }),
    asyncHandler(createGoldRepresentative),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('goldRepresentative.edit'),
    validate({ body: UpdateGoldRepresentativeSchema, params: IdParamSchema }),
    asyncHandler(updateGoldRepresentative),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('goldRepresentative.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteGoldRepresentative),
  );
  return router;
};
