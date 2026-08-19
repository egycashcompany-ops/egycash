import {
  widerScope,
  type DataScope,
  type ExternalSubjectDto,
  type Locale,
} from '@ecms/contracts';
import { type ActorIdentity } from '../../infrastructure/http/request-context';

export { type ActorIdentity };

/** Re-exported under the name the platform uses for it, so callers need one import, not two. */
export type ExternalSubject = ExternalSubjectDto;

/** The object every authenticated request carries (Platform Core §1, ADR-015 scopes). */
export interface AuthContext {
  userId: string;
  sessionId: string;
  /** The caller's organizational placement — backs the branch/department/section scopes. */
  branchId: string | null;
  departmentId: string | null;
  sectionId: string | null;
  locale: Locale;
  /** Effective permission → widest granted scope. */
  permissions: Record<string, DataScope>;
  permissionVersion: number;
  /** Holds a protected system role or any break-glass permission (Review R13). */
  isPrivileged: boolean;
  /**
   * The caller's display identity, so an audited write can record WHO acted without going back to
   * the database for it. Optional because contexts are also built for system work and seeds.
   */
  identity?: ActorIdentity | null;
  /**
   * The record outside this company that the caller IS, when they are not one of us.
   *
   * Optional rather than nullable so the handful of synthetic contexts the seeds and the PDF
   * renderers build need no edit — every reader tests it explicitly. It answers ONE question,
   * "may this caller reach this route at all"; which customer's data they may see is resolved
   * per request by the module that owns the relationship, never from here.
   */
  external?: ExternalSubject | null;
}

export const hasPermission = (ctx: AuthContext, key: string): boolean =>
  Object.hasOwn(ctx.permissions, key);

export const scopeOf = (ctx: AuthContext, key: string): DataScope | undefined =>
  ctx.permissions[key];

/** Selector the repository layer uses to apply the caller's data scope. */
export interface ScopeSelector {
  scope: DataScope;
  userId: string;
  branchId: string | null;
  departmentId: string | null;
  sectionId: string | null;
}

export const scopeSelector = (ctx: AuthContext, permissionKey: string): ScopeSelector => ({
  scope: ctx.permissions[permissionKey] ?? 'own',
  userId: ctx.userId,
  branchId: ctx.branchId,
  departmentId: ctx.departmentId,
  sectionId: ctx.sectionId,
});

export { widerScope };
