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
/**
 * The units a grant (or a permission key) covers beyond the holder's own placement — as TWO lists,
 * because they mean different things (ADR-032, Gap 1):
 *
 *   • `branchIds` — WHOLE branches: every department in each of them;
 *   • `departments` — department COPIES, each in exactly one branch: that department there and
 *     nothing else in that branch.
 *
 * A branch on its own never implies its departments' grants, and a department never implies its
 * branch's. Both lists empty means "the home unit only", which the selector answers from the
 * single ids as it always did.
 */
export interface UnitReach {
  branchIds: string[];
  departments: { id: string; branchId: string }[];
  /**
   * Company-wide departments (ADR-031) held in EVERY branch, by catalog id.
   *
   * `departments` above already lists the copies, so nothing READS through this to find data — the
   * copies are what a query filters on. It is here for the one question the resolved copies cannot
   * answer: is this «الحركة everywhere», or «الحركة in the five branches that happen to exist»?
   * The two look identical today and differ the morning somebody opens a sixth. Only the first may
   * be handed to a deputy as «كل الفروع», so the ceiling has to be able to tell them apart.
   */
  everywhere?: string[];
}

/** Every branch a reach touches at all — wholly, or through one of its departments. */
export const touchedBranches = (reach: UnitReach | undefined): string[] =>
  reach === undefined
    ? []
    : [...new Set([...reach.branchIds, ...reach.departments.map((d) => d.branchId)])];

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
  reach?: UnitReach;
  /**
   * The same, PER PERMISSION KEY — because each site's table is its own (ADR-032). A person may
   * hold «الموظفين» in two sites and «الحضور» in one, and a single union would let the narrower key
   * ride the wider one's reach. A key with no entry reaches the home unit only. Absent altogether
   * on a synthetic context (seeds, PDF renderers), in which case the union above answers.
   */
  keyReach?: Record<string, UnitReach>;
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
  /**
   * The full selection, when the caller has narrowed to SEVERAL branches at once.
   *
   * The screens are the same at every site and only the rows differ, so somebody who looks after
   * three branches is comparing them — and one-at-a-time makes him do the comparing in his head.
   * `activeBranchId` stays the single answer to «where does a NEW document belong», and is null
   * whenever this names more than one: that question has one answer or none.
   */
  activeBranchIds?: readonly string[];
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
  /**
   * The branches the listed department copies sit in. For a collection that carries a branch but
   * no department, a department-level authority narrows to THESE rather than widening: «الحركة في
   * أكتوبر» over the gold vault is «أكتوبر», not the company.
   */
  departmentBranchIds?: readonly string[];
}

/**
 * The selector a repository applies for one permission — with the command bar's branch narrowing
 * folded in.
 *
 * Only an `organization` grant narrows. Everything else is already at or below branch level: a
 * branch-placed caller sees their own branch whatever the switcher says, and department/section
 * grants are finer still, so widening them to a branch would be the one thing this must never do.
 */
const NO_REACH: UnitReach = { branchIds: [], departments: [] };

/**
 * Where ONE permission key reaches: its own entry when the snapshot records reach per key, else the
 * union across grants (a synthetic context), else nothing beyond home.
 */
export const reachOfKey = (ctx: AuthContext, permissionKey: string): UnitReach =>
  ctx.keyReach === undefined ? (ctx.reach ?? NO_REACH) : (ctx.keyReach[permissionKey] ?? NO_REACH);

/**
 * Whether the caller holds `permissionKey` over a UNIT: a whole branch (`departmentId: null`), or
 * one department in a branch.
 *
 * Organization-wide covers everything. Otherwise the key's coverage is read as units: whole
 * branches cover any department in them; a department copy covers exactly itself. When the key
 * reaches nowhere beyond home, home is the one unit — the home branch for a `branch` grant, the
 * home department for a `department` grant. `own` and `section` cover no unit at all.
 */
export const keyCoversUnit = (
  ctx: AuthContext,
  permissionKey: string,
  branchId: string,
  departmentId: string | null,
): boolean => {
  const held = ctx.permissions[permissionKey];
  if (held === undefined || held === 'own' || held === 'section') return false;
  if (held === 'organization') return true;
  const reach = reachOfKey(ctx, permissionKey);
  const beyondHome = reach.branchIds.length > 0 || reach.departments.length > 0;
  const wholeBranches = beyondHome
    ? reach.branchIds
    : held === 'branch' && ctx.branchId !== null
      ? [ctx.branchId]
      : [];
  if (wholeBranches.includes(branchId)) return true;
  if (departmentId === null) return false;
  const copies = beyondHome
    ? reach.departments.map((d) => d.id)
    : held === 'department' && ctx.departmentId !== null
      ? [ctx.departmentId]
      : [];
  return copies.includes(departmentId);
};

/**
 * Whether the caller holds `permissionKey` over one company-wide department IN EVERY BRANCH.
 *
 * The ceiling for the widest thing a manager may hand down: his own reach, «الحركة في كل الفروع».
 * Deliberately NOT satisfied by holding that department in every branch that exists right now —
 * that is a coincidence of today's org chart, and a deputy granted «كل الفروع» on the strength of
 * it would outreach his granter the morning a new branch opens.
 *
 * An organization-wide holder passes: every department everywhere is inside «everything».
 */
export const keyCoversDepartmentEverywhere = (
  ctx: AuthContext,
  permissionKey: string,
  departmentCatalogId: string,
): boolean => {
  const held = ctx.permissions[permissionKey];
  if (held === undefined || held === 'own' || held === 'section') return false;
  if (held === 'organization') return true;
  return (reachOfKey(ctx, permissionKey).everywhere ?? []).includes(departmentCatalogId);
};

/** Whether the caller holds `permissionKey` over the WHOLE of `branchId`. */
export const keyReachesBranch = (ctx: AuthContext, permissionKey: string, branchId: string): boolean =>
  keyCoversUnit(ctx, permissionKey, branchId, null);

/**
 * The selector a repository applies for one permission — with the command bar's branch narrowing
 * folded in.
 *
 * Only an `organization` grant narrows to any branch. Everything else is already at or below
 * branch level: a caller whose key reaches several units may narrow to the units inside ONE of
 * those branches, and never to anything else — the reach is the ceiling.
 */
export const scopeSelector = (ctx: AuthContext, permissionKey: string): ScopeSelector => {
  const scope = ctx.permissions[permissionKey] ?? 'own';
  // The switcher's choice, as a SET. One branch is a set of one, which is why nothing below needs
  // a second code path for the single case — and `branchIds` on the selector is already what the
  // repository layer filters on, so several narrows exactly as one does.
  const chosen = ctx.activeBranchIds ?? (ctx.activeBranchId === null || ctx.activeBranchId === undefined ? [] : [ctx.activeBranchId]);
  const home = {
    userId: ctx.userId,
    branchId: ctx.branchId,
    departmentId: ctx.departmentId,
    sectionId: ctx.sectionId,
  };
  if (scope === 'organization' && chosen.length > 0) {
    return chosen.length === 1
      ? { scope: 'branch', ...home, branchId: chosen[0] ?? null }
      : { scope: 'branch', ...home, branchIds: [...chosen] };
  }
  const reach = reachOfKey(ctx, permissionKey);
  const beyondHome = reach.branchIds.length > 0 || reach.departments.length > 0;
  if ((scope === 'branch' || scope === 'department') && beyondHome) {
    // Narrowing to the chosen branches keeps only the units inside them. A choice that names
    // nothing this key reaches is ignored, as before: the caller then sees everything it covers.
    const within = new Set(chosen.filter((id) => touchedBranches(reach).includes(id)));
    const narrow = within.size > 0;
    const branchIds = narrow ? reach.branchIds.filter((id) => within.has(id)) : reach.branchIds;
    const departments = narrow ? reach.departments.filter((d) => within.has(d.branchId)) : reach.departments;
    return {
      scope,
      ...home,
      ...(branchIds.length > 0 ? { branchIds } : {}),
      ...(departments.length > 0
        ? {
            departmentIds: departments.map((d) => d.id),
            departmentBranchIds: [...new Set(departments.map((d) => d.branchId))],
          }
        : {}),
    };
  }
  return { scope, ...home };
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
  ctx.branchId === branchId || touchedBranches(ctx.reach).includes(branchId);

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
  // The SINGLE form deliberately. A caller comparing three sites has not said which one a new
  // document belongs to, and the middleware leaves `activeBranchId` null for exactly that case —
  // so he falls through to his placement, as a caller who chose nothing already does.
  const active = ctx.activeBranchId ?? null;
  const reach = touchedBranches(ctx.reach);
  if (active !== null && reach.includes(active)) return active;
  if (ctx.branchId !== null) return ctx.branchId;
  if (active !== null && reach.length === 0) return active;
  if (reach.length === 1) return reach[0] ?? null;
  return null;
};

export { widerScope };
