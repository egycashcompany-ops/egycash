import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@ecms/contracts';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { validate } from '../../../infrastructure/http/validate';
import { authenticate } from '../../auth';
import { authorize } from '../../rbac';
import {
  CreateCostCenterSchema,
  ListOrgUnitsQuerySchema,
  UpdateCostCenterSchema,
} from './cost-center.validation';
import {
  createCostCenter,
  deleteCostCenter,
  getCostCenter,
  listCostCenters,
  updateCostCenter,
} from './cost-center.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildCostCentersRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('costCenter.view'),
    validate({ query: ListOrgUnitsQuerySchema }),
    asyncHandler(listCostCenters),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('costCenter.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getCostCenter),
  );
  router.post(
    '/',
    authenticate,
    authorize('costCenter.create'),
    validate({ body: CreateCostCenterSchema }),
    asyncHandler(createCostCenter),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('costCenter.edit'),
    validate({ params: IdParamSchema, body: UpdateCostCenterSchema }),
    asyncHandler(updateCostCenter),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('costCenter.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteCostCenter),
  );

  return router;
};
