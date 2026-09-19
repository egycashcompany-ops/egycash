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
  /**
   * Where the caller's grants reach beyond their own placement (ADR-015, multi-branch grants).
   *
   * `branchIds` — every branch a branch- or department-level grant reaches, the home branch
   * included. `departmentIds` — every branch copy of the department(s) a `department` grant names,
   * across those branches. Both empty for a caller whose grants resolve to their home unit only,
   * which is what every context looked like before this field existed; the selector and the
   * repositories fall back to `branchId` / `departmentId` in that case, so nothing that never
   * granted a wider reach behaves any differently.
   */
  reach?: { branchIds: string[]; departmentIds: string[] };
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
  /**
   * The LIST forms of `branchId` / `departmentId`, for a caller whose grants reach more than one
   * unit. When present and non-empty they are what a repository filters on; when absent, the single
   * ids above are, exactly as before.
   */
  branchIds?: readonly string[];
  departmentIds?: readonly string[];
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
  const reach = ctx.reach;
  const reachesBranches = reach !== undefined && reach.branchIds.length > 0;
  if (scope === 'organization' && active !== null) {
    return {
      scope: 'branch',
      userId: ctx.userId,
      branchId: active,
      departmentId: ctx.departmentId,
      sectionId: ctx.sectionId,
    };
  }
  // A multi-branch caller narrowing to ONE of their branches: still a narrowing, so still allowed —
  // and only to a branch the reach already holds. Anything else they send is ignored, as before.
  if (scope === 'branch' && reachesBranches) {
    const chosen = active !== null && reach.branchIds.includes(active) ? [active] : reach.branchIds;
    return {
      scope,
      userId: ctx.userId,
      branchId: ctx.branchId,
      departmentId: ctx.departmentId,
      sectionId: ctx.sectionId,
      branchIds: chosen,
    };
  }
  if (scope === 'department' && reach !== undefined && reach.departmentIds.length > 0) {
    return {
      scope,
      userId: ctx.userId,
      branchId: ctx.branchId,
      departmentId: ctx.departmentId,
      sectionId: ctx.sectionId,
      departmentIds: reach.departmentIds,
      ...(reachesBranches
        ? { branchIds: active !== null && reach.branchIds.includes(active) ? [active] : reach.branchIds }
        : {}),
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

/**
 * The selector for the WIDEST grant among several permissions — for a read that spans what
 * several keys protect at once (every evaluation phase in one aggregation, say).
 *
 * The winning KEY is what the selector is built for, so its reach lists belong to that grant. A
 * selector built for one key and then relabelled with another's scope mixes two grants, and the
 * lists and the scope can disagree — which is the bug this exists to close.
 */
export const widestScopeSelector = (ctx: AuthContext, keys: readonly string[]): ScopeSelector => {
  let winner: string | undefined;
  for (const key of keys) {
    const granted = ctx.permissions[key];
    if (granted === undefined) continue;
    if (winner === undefined || widerScope(ctx.permissions[winner] ?? 'own', granted) === granted) {
      winner = key;
    }
  }
  return winner === undefined
    ? { scope: 'own', userId: ctx.userId, branchId: ctx.branchId, departmentId: ctx.departmentId, sectionId: ctx.sectionId }
    : scopeSelector(ctx, winner);
};

/** Whether `branchId` is one the caller's own placement or grants reach. */
export const reachesBranch = (ctx: AuthContext, branchId: string): boolean =>
  ctx.branchId === branchId || (ctx.reach?.branchIds ?? []).includes(branchId);

/**
 * The branch the caller is acting IN right now — where a new document is filed, which branch's
 * settings apply to them.
 *
 * In order: the switcher's choice when it names a branch the caller's grants reach; the home
 * branch; the switcher's choice for an organization-wide caller (who has no home and may choose
 * anywhere); the only branch a reach names, when it names exactly one. Otherwise null — a
 * multi-branch caller with no home who has not chosen, or an organization-wide caller looking at
 * the whole company — and the caller decides whether that is "ask" or "refuse".
 *
 * The order is what keeps the switcher a narrowing: a caller placed in one branch who sends any
 * other branch in the header is still filed into their own.
 */
export const currentBranchId = (ctx: AuthContext): string | null => {
  const active = ctx.activeBranchId ?? null;
  const reach = ctx.reach?.branchIds ?? [];
  if (active !== null && reach.includes(active)) return active;
  if (ctx.branchId !== null) return ctx.branchId;
  if (active !== null && reach.length === 0) return active;
  if (reach.length === 1) return reach[0] ?? null;
  return null;
};

export { widerScope };
