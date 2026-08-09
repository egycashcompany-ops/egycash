// Installations (design §7, §12).
//
// One grant covers products AND installations (§7: "`itSoftware.manage` (products +
// installations)"). It does NOT widen which assets a caller can reach: the service loads the asset
// through the software grant's scope, so a branch-scoped installer gets the same refusal for
// another branch's machine as for one that does not exist.
//
// No DELETE: an installation is a business record. It ends by being REMOVED, which stamps
// `removedAt` and keeps the row — a named action, because uninstalling is a distinct act and a
// URL that performs it must not be reloadable into a second one.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateItSoftwareInstallationSchema,
  ListItSoftwareInstallationsQuerySchema,
  RemoveItSoftwareInstallationSchema,
  UpdateItSoftwareInstallationSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createItSoftwareInstallation,
  getItSoftwareInstallation,
  listItSoftwareInstallations,
  removeItSoftwareInstallation,
  updateItSoftwareInstallation,
} from './installation.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildItSoftwareInstallationsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itSoftware.view'),
    validate({ query: ListItSoftwareInstallationsQuerySchema }),
    asyncHandler(listItSoftwareInstallations),
  );
  router.post(
    '/',
    authenticate,
    authorize('itSoftware.manage'),
    validate({ body: CreateItSoftwareInstallationSchema }),
    asyncHandler(createItSoftwareInstallation),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itSoftware.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getItSoftwareInstallation),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itSoftware.manage'),
    validate({ body: UpdateItSoftwareInstallationSchema, params: IdParamSchema }),
    asyncHandler(updateItSoftwareInstallation),
  );
  router.post(
    '/:id/remove',
    authenticate,
    authorize('itSoftware.manage'),
    validate({ body: RemoveItSoftwareInstallationSchema, params: IdParamSchema }),
    asyncHandler(removeItSoftwareInstallation),
  );
  return router;
};
