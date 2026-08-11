import { Router } from 'express';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import {
  AdminResetPasswordSchema,
  TotpRequireSchema,
  ChangeUserStatusSchema,
  CreateUserSchema,
  ListUsersQuerySchema,
  UpdateUserSchema,
  UserIdParamSchema,
} from './user.validation';
import {
  adminRequireTotp,
  adminIssueSetupLink,
  adminResendCredentials,
  adminResetPassword,
  adminResetTotp,
  adminRevokeSessions,
  changeUserStatus,
  createUser,
  deleteUser,
  getUser,
  getUserEffectivePermissions,
  listUsers,
  unlockUser,
  updateUser,
} from './user.controller';

export const buildUsersRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('user.view'),
    validate({ query: ListUsersQuerySchema }),
    asyncHandler(listUsers),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('user.view'),
    validate({ params: UserIdParamSchema }),
    asyncHandler(getUser),
  );
  router.post(
    '/',
    authenticate,
    authorize('user.create'),
    validate({ body: CreateUserSchema }),
    asyncHandler(createUser),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('user.edit'),
    validate({ body: UpdateUserSchema, params: UserIdParamSchema }),
    asyncHandler(updateUser),
  );
  router.post(
    '/:id/status',
    authenticate,
    authorize('user.edit'),
    validate({ body: ChangeUserStatusSchema, params: UserIdParamSchema }),
    asyncHandler(changeUserStatus),
  );
  // Clearing an automatic lockout is an edit to the account, not a credential operation: it hands
  // out nothing and reveals nothing, so it sits with `user.edit` rather than `user.resetPassword`.
  router.post(
    '/:id/unlock',
    authenticate,
    authorize('user.edit'),
    validate({ params: UserIdParamSchema }),
    asyncHandler(unlockUser),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('user.delete'),
    validate({ params: UserIdParamSchema }),
    asyncHandler(deleteUser),
  );
  router.post(
    '/:id/reset-password',
    authenticate,
    authorize('user.resetPassword'),
    validate({ body: AdminResetPasswordSchema, params: UserIdParamSchema }),
    asyncHandler(adminResetPassword),
  );
  router.post(
    '/:id/credentials/resend',
    authenticate,
    authorize('user.resetPassword'),
    validate({ params: UserIdParamSchema }),
    asyncHandler(adminResendCredentials),
  );
  // P9-A. Its own key, not `user.resetPassword`: resetting delivers a link the actor never sees,
  // while this one hands it to them — which is the difference between resetting an account and
  // being able to take it over. Break-glass, so holders carry mandatory 2FA (Review R13).
  router.post(
    '/:id/setup-link',
    authenticate,
    authorize('user.setupLink'),
    validate({ params: UserIdParamSchema }),
    asyncHandler(adminIssueSetupLink),
  );
  router.delete(
    '/:id/sessions',
    authenticate,
    authorize('user.manageSessions'),
    validate({ params: UserIdParamSchema }),
    asyncHandler(adminRevokeSessions),
  );
  router.post(
    '/:id/totp/reset',
    authenticate,
    authorize('user.resetPassword'),
    validate({ params: UserIdParamSchema }),
    asyncHandler(adminResetTotp),
  );
  router.post(
    '/:id/totp/require',
    authenticate,
    authorize('user.resetPassword'),
    validate({ body: TotpRequireSchema, params: UserIdParamSchema }),
    asyncHandler(adminRequireTotp),
  );
  /**
   * SA-4 — what this account may actually do, and why (read-only).
   *
   * BOTH grants are required, chained. `user.view` because this is a fact about an account and
   * someone who may not open the record may not read its authority either; `role.view` because the
   * answer is made of roles and assignments, which is what that permission governs. Neither implies
   * the other, and `authorizeAny` would accept either — the opposite of what is meant here.
   *
   * The target is then read through the caller's `user.view` scope inside the service, so an
   * account they cannot see answers 404 rather than confirming it exists.
   */
  router.get(
    '/:id/effective-permissions',
    authenticate,
    authorize('user.view'),
    authorize('role.view'),
    validate({ params: UserIdParamSchema }),
    asyncHandler(getUserEffectivePermissions),
  );
  return router;
};
