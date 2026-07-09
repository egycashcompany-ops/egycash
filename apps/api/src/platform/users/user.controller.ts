import { type Request, type Response } from 'express';
import {
  type ChangeUserStatus,
  type CreateUser,
  type InvitedUserDto,
  type ListUsersQuery,
  type UpdateUser,
  type AdminResetPassword,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { scopeSelector } from '../../shared/types';
import { authContext, authService } from '../auth';
import { userService } from './user.service';

type IdParam = { id: string };

export const listUsers = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListUsersQuery>(req);
  const page = await userService.list(query, scopeSelector(ctx, 'user.view'));
  okPage(res, page, (doc) => userService.toDto(doc));
};

export const getUser = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await userService.getById(params.id, scopeSelector(ctx, 'user.view'));
  ok(res, userService.toDto(doc));
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateUser>(req);
  const { user, activationToken } = await userService.create(body, ctx.userId);
  const dto: InvitedUserDto = { ...userService.toDto(user), activationToken };
  created(res, dto, `/api/v1/platform/users/${dto.id}`);
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateUser, never, IdParam>(req);
  const doc = await userService.update(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'user.edit'),
  );
  ok(res, userService.toDto(doc));
};

export const changeUserStatus = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ChangeUserStatus, never, IdParam>(req);
  const doc = await userService.changeStatus(params.id, body, ctx.userId);
  ok(res, userService.toDto(doc));
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await userService.softDelete(params.id, ctx.userId, scopeSelector(ctx, 'user.delete'));
  noContent(res);
};

export const adminResetPassword = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<AdminResetPassword, never, IdParam>(req);
  await userService.setPassword(params.id, body.newPassword, 'passwordReset');
  await authService.revokeAllSessionsForUser(params.id, 'admin-password-reset');
  noContent(res);
};

export const adminRevokeSessions = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await authService.revokeAllSessionsForUser(params.id, 'admin-force-logout');
  noContent(res);
};
