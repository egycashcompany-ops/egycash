// System Administration → Users: the api/ surface (ADR-013). Every call targets an endpoint the
// platform ALREADY serves — this slice adds no backend, so a path here that the API does not
// declare is a bug the contract spec beside this folder catches at build time.
//
// Why this client lives in the module rather than in `platform/`: `platform/settings/settings-api.ts`
// sits there because any module's settings screen reads it. Administering user accounts has exactly
// one consumer — this module — so it stays local, the way every other feature's api/ folder does.
//
// The HR employee profile calls four of these same endpoints from its own api/ file. That
// duplication is deliberate for now: the alternative is either a cross-module import (forbidden —
// modules never import each other) or moving HR's calls out, which is a refactor of HR that this
// slice is not allowed to make.
import {
  type AdminResetPasswordResultDto,
  type ChangeUserStatus,
  type Paginated,
  type TimelineDto,
  type UserDto,
} from '@ecms/contracts';
import { buildQuery, del, get, getPage, post, type QueryParams } from '../../../../shared/lib/api-client';

export type SystemUserListParams = QueryParams;

/** `GET /platform/users` — branch/department/section-scoped server-side by `user.view`. */
export const listUsers = (params: SystemUserListParams): Promise<Paginated<UserDto>> =>
  getPage<UserDto>(`/platform/users${buildQuery(params)}`);

export const getUser = (id: string): Promise<UserDto> => get<UserDto>(`/platform/users/${id}`);

/**
 * Lifecycle transition. `version` rides along, so a concurrent edit answers 409 rather than
 * silently overwriting a status somebody else just changed.
 */
export const changeUserStatus = (id: string, body: ChangeUserStatus): Promise<UserDto> =>
  post<UserDto>(`/platform/users/${id}/status`, body);

/**
 * Admin reset (§14.4): the password hash is cleared and a fresh one-time setup link is delivered.
 * No password is supplied by — or returned to — the administrator; the result carries delivery
 * OUTCOMES only.
 */
export const resetUserPassword = (id: string): Promise<AdminResetPasswordResultDto> =>
  post<AdminResetPasswordResultDto>(`/platform/users/${id}/reset-password`, {});

/** Re-deliver a PENDING setup link (§14.3). The API refuses when none is outstanding. */
export const resendUserCredentials = (id: string): Promise<AdminResetPasswordResultDto> =>
  post<AdminResetPasswordResultDto>(`/platform/users/${id}/credentials/resend`, {});

/** Wipe TOTP enrollment; the `required` flag is left exactly as it was. */
export const resetUserTotp = (id: string): Promise<void> =>
  post<void>(`/platform/users/${id}/totp/reset`, {});

/** D6 force on/off. Forcing ON clears any enrolled secret — the user re-enrolls at next login. */
export const setUserTotpRequired = (id: string, required: boolean): Promise<void> =>
  post<void>(`/platform/users/${id}/totp/require`, { required });

/** Break-glass: ends every session the account holds. */
export const revokeUserSessions = (id: string): Promise<void> =>
  del<void>(`/platform/users/${id}/sessions`);

/**
 * The account's history, merged from the audit and activity streams (BD-007). The endpoint carries
 * no `authorize()` on purpose: it degrades to whichever of `auditLog.view` / `activityLog.view` the
 * caller holds, and refuses only when they hold neither. `included` reports which streams answered,
 * so the screen can say what it is showing instead of implying it is everything.
 */
export const getUserTimeline = (id: string, pageSize: number): Promise<TimelineDto> =>
  get<TimelineDto>(
    `/platform/timeline${buildQuery({ entityType: 'user', entityId: id, pageSize })}`,
  );
