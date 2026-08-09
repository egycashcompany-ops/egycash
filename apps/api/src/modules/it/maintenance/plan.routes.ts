// Maintenance plans (design §7, §12).
//
// Reads ride `itMaintenance.view` — the same grant the orders screen uses, because a plan with no
// visible orders is not a screen anyone needs. Writes need `itMaintenancePlan.manage`: a schedule
// is behaviour-carrying data (it generates work orders), which is the `itSlaPolicy.manage`
// precedent applied to the other clock in this module.
//
// No DELETE: a plan deactivates (FR-11). Its generated orders point at it forever.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateItMaintenancePlanSchema,
  ListItMaintenancePlansQuerySchema,
  UpdateItMaintenancePlanSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  activateItMaintenancePlan,
  createItMaintenancePlan,
  deactivateItMaintenancePlan,
  getItMaintenancePlan,
  listItMaintenancePlans,
  updateItMaintenancePlan,
} from './plan.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildItMaintenancePlansRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('itMaintenance.view'),
    validate({ query: ListItMaintenancePlansQuerySchema }),
    asyncHandler(listItMaintenancePlans),
  );
  router.post(
    '/',
    authenticate,
    authorize('itMaintenancePlan.manage'),
    validate({ body: CreateItMaintenancePlanSchema }),
    asyncHandler(createItMaintenancePlan),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itMaintenance.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getItMaintenancePlan),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itMaintenancePlan.manage'),
    validate({ body: UpdateItMaintenancePlanSchema, params: IdParamSchema }),
    asyncHandler(updateItMaintenancePlan),
  );
  router.post(
    '/:id/activate',
    authenticate,
    authorize('itMaintenancePlan.manage'),
    validate({ params: IdParamSchema }),
    asyncHandler(activateItMaintenancePlan),
  );
  router.post(
    '/:id/deactivate',
    authenticate,
    authorize('itMaintenancePlan.manage'),
    validate({ params: IdParamSchema }),
    asyncHandler(deactivateItMaintenancePlan),
  );
  return router;
};
