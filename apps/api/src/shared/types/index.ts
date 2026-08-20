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
  /**
   * The branch the caller has NARROWED themselves to, from the switcher in the command bar.
   *
   * Optional, and it can only ever narrow: the caller's granted scope is the ceiling, so this
   * turns an organization-wide grant into a branch-wide one and does nothing at all to anybody
   * already placed in a branch. Nobody can widen their reach by sending it, which is why it needs
   * no permission of its own.
   *
   * The gold system had exactly this control and read it from an `x-branch-id` header; the port
   * carried the rule and lost the control, which is what left an organization-wide account unable
   * to say which branch a new document belonged to.
   */
  activeBranchId?: string | null;
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

/**
 * The selector a repository applies for one permission — with the command bar's branch narrowing
 * folded in.
 *
 * Only an `organization` grant narrows. Everything else is already at or below branch level: a
 * branch-placed caller sees their own branch whatever the switcher says, and department/section
 * grants are finer still, so widening them to a branch would be the one thing this must never do.
 */
export const scopeSelector = (ctx: AuthContext, permissionKey: string): ScopeSelector => {
  const scope = ctx.permissions[permissionKey] ?? 'own';
  const active = ctx.activeBranchId ?? null;
  if (scope === 'organization' && active !== null) {
    return {
      scope: 'branch',
      userId: ctx.userId,
      branchId: active,
      departmentId: ctx.departmentId,
      sectionId: ctx.sectionId,
    };
  }
  return {
    scope,
    userId: ctx.userId,
    branchId: ctx.branchId,
    departmentId: ctx.departmentId,
    sectionId: ctx.sectionId,
  };
};

export { widerScope };
