import { Router } from 'express';
import { UpdateOrganizationSchema } from '@ecms/contracts';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import { getOrganization, updateOrganization } from './organization.controller';

export const buildOrganizationRouter = (): Router => {
  const router = Router();

  router.get('/', authenticate, authorize('organization.view'), asyncHandler(getOrganization));
  router.patch(
    '/',
    authenticate,
    authorize('organization.edit'),
    validate({ body: UpdateOrganizationSchema }),
    asyncHandler(updateOrganization),
  );
  return router;
};
