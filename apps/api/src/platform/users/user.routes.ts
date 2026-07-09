import { Router } from 'express';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import {
  AdminResetPasswordSchema,
  ChangeUserStatusSchema,
  CreateUserSchema,
  ListUsersQuerySchema,
  UpdateUserSchema,
  UserIdParamSchema,
} from './user.validation';
import {
  adminResetPassword,
  adminRevokeSessions,
  changeUserStatus,
  createUser,
  deleteUser,
  getUser,
  listUsers,
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
  router.delete(
    '/:id/sessions',
    authenticate,
    authorize('user.manageSessions'),
    validate({ params: UserIdParamSchema }),
    asyncHandler(adminRevokeSessions),
  );
  return router;
};
