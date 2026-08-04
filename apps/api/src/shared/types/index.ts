import { widerScope, type DataScope, type Locale } from '@ecms/contracts';
import { type ActorIdentity } from '../../infrastructure/http/request-context';

export { type ActorIdentity };

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
