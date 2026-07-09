import { Router } from 'express';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import { SetSettingSchema } from './settings.validation';
import { listDefinitions, listFlags, resolveMySettings, setSetting } from './settings.controller';

export const buildSettingsRouter = (): Router => {
  const router = Router();

  router.get(
    '/definitions',
    authenticate,
    authorize('setting.view'),
    asyncHandler(listDefinitions),
  );
  router.get('/me', authenticate, asyncHandler(resolveMySettings));
  router.patch(
    '/values',
    authenticate,
    authorize('setting.edit'),
    validate({ body: SetSettingSchema }),
    asyncHandler(setSetting),
  );
  return router;
};

export const buildFeatureFlagsRouter = (): Router => {
  const router = Router();
  router.get('/', authenticate, authorize('setting.view'), asyncHandler(listFlags));
  return router;
};
