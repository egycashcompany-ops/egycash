import { type Request, type Response } from 'express';
import {
  type ChangeUserStatus,
  type CreateUser,
  type InvitedUserDto,
  type ListUsersQuery,
  type UpdateUser,
  type AdminResetPassword,
  type TotpRequire,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { scopeSelector } from '../../shared/types';
import { authContext, authService } from '../auth';
import { rbacService } from '../rbac';
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

/**
 * Clear the automatic lockout. Scoped like every other write on this account, so an administrator
 * who cannot see it cannot unlock it.
 */
export const unlockUser = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await userService.unlock(params.id, ctx.userId, scopeSelector(ctx, 'user.edit'));
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
  const { params } = validated<AdminResetPassword, never, IdParam>(req);
  // §14.4: lock out (hash cleared, sessions revoked) + deliver a fresh one-time setup link.
  const delivery = await userService.resetViaSetupLink(params.id);
  await authService.revokeAllSessionsForUser(params.id, 'admin-password-reset');
  ok(res, { delivery });
};

export const adminResendCredentials = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  // §14.3: new token replaces (and invalidates) the pending link — no other side effects.
  const delivery = await userService.resendSetupLink(params.id);
  ok(res, { delivery });
};

/**
 * P9-A — mint a setup link and return it for manual delivery. Nothing is sent.
 *
 * Sessions are NOT revoked here, unlike the reset path: this only reaches accounts that have no
 * password yet, so there is no session to end and nothing to lock anybody out of.
 */
export const adminIssueSetupLink = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const link = await userService.issueSetupLinkForCopy(params.id);
  ok(res, { url: link.url, expiresAt: link.expiresAt.toISOString() });
};

export const adminResetTotp = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await userService.resetTotp(params.id);
  await authService.revokeAllSessionsForUser(params.id, 'admin-totp-reset');
  noContent(res);
};

export const adminRequireTotp = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<TotpRequire, never, IdParam>(req);
  await userService.setTotpRequired(params.id, body.required);
  if (body.required) await authService.revokeAllSessionsForUser(params.id, 'admin-totp-required');
  noContent(res);
};

export const adminRevokeSessions = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await authService.revokeAllSessionsForUser(params.id, 'admin-force-logout');
  noContent(res);
};

/**
 * SA-4 — the account's effective permissions, with their sources (read-only).
 *
 * The route requires `user.view` AND `role.view`; the SCOPE comes from `user.view`, because the
 * subject here is the account. An account outside that scope answers 404 from the service's own
 * read — this handler never learns whether it exists.
 */
export const getUserEffectivePermissions = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, await rbacService.explainEffectivePermissions(params.id, scopeSelector(ctx, 'user.view')));
};
