// Customer logins, administered by staff.
//
// Creating one creates a PLATFORM account, so the route demands both grants: authority over portal
// accounts AND authority to create a user. Chained, never `authorizeAny` — this is not "either
// will do", it is "you need both", because a `goldPortalAccount.create` holder who could mint
// platform users without `user.create` would be a way around user administration.
import { Router } from 'express';
import { z } from 'zod';
import {
  ChangeGoldPortalAccountStatusSchema,
  CreateGoldPortalAccountSchema,
  ListGoldPortalAccountsQuerySchema,
  UpdateGoldPortalAccountSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  changeGoldPortalAccountStatus,
  createGoldPortalAccount,
  deleteGoldPortalAccount,
  getGoldPortalAccount,
  listGoldPortalAccounts,
  resendGoldPortalSetupLink,
  updateGoldPortalAccount,
} from './portal-account.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildGoldPortalAccountsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('goldPortalAccount.view'),
    validate({ query: ListGoldPortalAccountsQuerySchema }),
    asyncHandler(listGoldPortalAccounts),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('goldPortalAccount.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getGoldPortalAccount),
  );
  router.post(
    '/',
    authenticate,
    authorize('goldPortalAccount.create'),
    authorize('user.create'),
    validate({ body: CreateGoldPortalAccountSchema }),
    asyncHandler(createGoldPortalAccount),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('goldPortalAccount.edit'),
    validate({ params: IdParamSchema, body: UpdateGoldPortalAccountSchema }),
    asyncHandler(updateGoldPortalAccount),
  );
  router.post(
    '/:id/status',
    authenticate,
    authorize('goldPortalAccount.edit'),
    validate({ params: IdParamSchema, body: ChangeGoldPortalAccountStatusSchema }),
    asyncHandler(changeGoldPortalAccountStatus),
  );
  router.post(
    '/:id/setup-link',
    authenticate,
    authorize('goldPortalAccount.edit'),
    validate({ params: IdParamSchema }),
    asyncHandler(resendGoldPortalSetupLink),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('goldPortalAccount.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteGoldPortalAccount),
  );
  return router;
};
