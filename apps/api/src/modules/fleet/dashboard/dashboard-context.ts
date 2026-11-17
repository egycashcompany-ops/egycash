// «لوحة تحكم الحركة» — what one dashboard read knows about itself (plan §5.2).
//
// ONE clock per request. The controller reads `new Date()` once and hands it in; every "today" the
// sections use is that instant's Cairo calendar day (R-01), so a read that straddles midnight cannot
// answer half its figures for one day and half for the next, and a spec can pin the clock at
// 2026-10-31T23:30Z and get 2026-11-01 everywhere.
//
// Per-request memo only — no server cache (§5.6): the settings, the catalogs and the vehicle set
// are each read at most once per request however many sections ask for them.
//
// WHAT THE FIGURES COVER is ONE answer per request (`branchIds`): the reader's branches under the
// widest grant among the two reads' keys — the whole company (`null`) for an organization or `own`
// grant, else the branches that grant reaches (several = «كل فروعي»), else the home branch. The
// branch switcher only narrows INSIDE that answer, so a stale header (a branch the reader cannot
// see) is ignored instead of widening or moving the figures. Two keys of the R2 union never decide
// it (`UNSCOPED_KEYS`): the custody fund's (its «الآن» is the browser's own read, company-wide; its
// R2 part `custodyStates` follows the receipt's car under the receipts' key) and the licence
// expenses' (a memo has no branch: `licenceSpend` is always the whole company).
import {
  FLEET_DASHBOARD_NOW_KEYS,
  FLEET_DASHBOARD_PERIOD_KEYS,
  cairoYmd,
  fleetDashboardGateKeys,
  type FleetDashboardNamedDto,
  type FleetDashboardSection,
  type LocalizedString,
} from '@ecms/contracts';
import { logger } from '../../../infrastructure/logging/logger';
import { branchRepository } from '../../../platform/organization/branches/branch.repository';
import { settingsService } from '../../../platform/settings';
import {
  hasPermission,
  scopeSelector,
  selectorBranches,
  widestScopeSelector,
  type AuthContext,
  type ScopeSelector,
} from '../../../shared/types';

export interface DashboardContext {
  readonly ctx: AuthContext;
  /** The request's clock — the only instant any section may use. */
  readonly now: Date;
  /** `cairoYmd(now)`: the Cairo calendar day every figure is counted on. */
  readonly today: string;
  /**
   * The switcher's branch (`X-Active-Branch` → `ctx.activeBranchId`), honoured only inside the
   * reader's branches (`branchIds`); NEVER the reader's home branch: «الشركة كلها» with a home
   * branch is the whole company. `branchIds` is what the figures cover.
   */
  readonly branchId: string | null;
  /**
   * What the figures cover: `null` = the whole company; else the reader's branches (one = a
   * branch view, several = «كل فروعي»). `[]` — a branch reach with no branch — narrows to nothing.
   */
  readonly branchIds: readonly string[] | null;
  /** A section is permitted when the reader holds EVERY key of its gate (api ∪ page, R-28). */
  readonly permits: (section: FleetDashboardSection) => boolean;
  /** The reader's data scope for one permission — for the branch-scoped screens only (R-27). */
  readonly scope: (permissionKey: string) => ScopeSelector;
  /** One read per request for each key, however many sections ask. */
  readonly memo: <T>(key: string, load: () => Promise<T>) => Promise<T>;
  /** An organization-level setting, memoised. */
  readonly setting: <T>(key: string) => Promise<T>;
}

/**
 * Keys a section is gated on that never decide what the figures cover: an organization-wide grant
 * of either must not widen a branch reader's figures to the whole company.
 */
const UNSCOPED_KEYS: ReadonlySet<string> = new Set([
  'fleetCustody.view',
  'fleetLicenseExpense.view',
]);

/** The two reads' keys that decide what the dashboard's figures cover (`dashboardBranches`). */
export const DASHBOARD_KEYS: readonly string[] = [
  ...new Set([...FLEET_DASHBOARD_NOW_KEYS, ...FLEET_DASHBOARD_PERIOD_KEYS]),
].filter((key) => !UNSCOPED_KEYS.has(key));

/**
 * The reader's branches under the widest of the dashboard's grants — `null` for the whole company
 * (organization, own) — with the switcher folded in as `scopeSelector` folds it: an organization
 * grant narrows to the chosen branch, a multi-branch reach to the chosen one among its own.
 *
 * KNOWN LIMIT (plan D9): ONE list narrows every company+set section, whichever module owns it. When
 * a reader's grants of the same rank reach different branches per key (`keyReach`), the last such
 * key in the two reads' key order decides (`widestScopeSelector`'s tie), so a figure can cover a
 * branch its own register does not show that reader, or leave one out. Narrowing each section by
 * its own gate key needs an echo per section, which the one «الفرع: …» chip cannot show; it is
 * handed to a later tab PR.
 */
export const dashboardBranches = (ctx: AuthContext): readonly string[] | null => {
  const branches = selectorBranches(widestScopeSelector(ctx, DASHBOARD_KEYS));
  return branches === 'all' ? null : branches;
};

export const dashboardContext = (ctx: AuthContext, now: Date): DashboardContext => {
  const cache = new Map<string, Promise<unknown>>();
  const memo = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit as Promise<T>;
    const pending = load();
    cache.set(key, pending);
    return pending;
  };
  const branchIds = dashboardBranches(ctx);
  const active = ctx.activeBranchId ?? null;
  return {
    ctx,
    now,
    today: cairoYmd(now),
    branchId: active !== null && branchIds !== null && branchIds.includes(active) ? active : null,
    branchIds,
    permits: (section) => fleetDashboardGateKeys(section).every((key) => hasPermission(ctx, key)),
    scope: (permissionKey) => scopeSelector(ctx, permissionKey),
    memo,
    setting: <T>(key: string) =>
      memo(`setting:${key}`, () =>
        settingsService.resolve<T>(key, { userId: null, branchId: null }),
      ),
  };
};

/** The organization's branches, read once per request (the matrix, the roster rows, the echo). */
export const branchList = (d: DashboardContext) =>
  d.memo('branches', () => branchRepository.listAll());

/** A branch the list could not name (deleted since, or the read failed): the id, never a made-up name. */
const UNNAMED: LocalizedString = { ar: '—', en: '—' };

/**
 * `branchIds` by name, in the same order — the echo «الفرع: …» is drawn from (`null` = the whole
 * company, one = that branch, several = «كل فروعي»). EVERY id the figures cover is echoed, so the
 * web's links (`branch=`) and its one-branch layout read exactly what the server counted: an id the
 * live branch list does not hold (a soft-deleted branch still in a reader's reach) keeps its place
 * with «—» for a name, as the roster rows draw it. A failure to read the list costs the names, never
 * the read or the count of branches: every id is echoed with «—».
 */
export const scopeBranchesOf = async (
  d: DashboardContext,
): Promise<FleetDashboardNamedDto[] | null> => {
  if (d.branchIds === null) return null;
  if (d.branchIds.length === 0) return [];
  try {
    const names = new Map(
      (await branchList(d)).map((b) => [String(b._id), b.name as LocalizedString]),
    );
    return d.branchIds.map((id) => ({ id, name: names.get(id) ?? UNNAMED }));
  } catch (err) {
    logger.error({ err }, 'fleet dashboard branch names failed');
    return d.branchIds.map((id) => ({ id, name: UNNAMED }));
  }
};
