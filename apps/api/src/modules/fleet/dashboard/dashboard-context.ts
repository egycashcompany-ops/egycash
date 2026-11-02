// «لوحة تحكم الحركة» — what one dashboard read knows about itself (plan §5.2).
//
// ONE clock per request. The controller reads `new Date()` once and hands it in; every "today" the
// sections use is that instant's Cairo calendar day (R-01), so a read that straddles midnight cannot
// answer half its figures for one day and half for the next, and a spec can pin the clock at
// 2026-10-31T23:30Z and get 2026-11-01 everywhere.
//
// Per-request memo only — no server cache (§5.6): the settings, the catalogs and the vehicle set
// are each read at most once per request however many sections ask for them.
import { cairoYmd, fleetDashboardGateKeys, type FleetDashboardSection } from '@ecms/contracts';
import { settingsService } from '../../../platform/settings';
import {
  hasPermission,
  scopeSelector,
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
   * The switcher's branch (`X-Active-Branch` → `ctx.activeBranchId`), NEVER the reader's home
   * branch: «الشركة كلها» with a home branch is the whole company.
   */
  readonly branchId: string | null;
  /** A section is permitted when the reader holds EVERY key of its gate (api ∪ page, R-28). */
  readonly permits: (section: FleetDashboardSection) => boolean;
  /** The reader's data scope for one permission — for the branch-scoped screens only (R-27). */
  readonly scope: (permissionKey: string) => ScopeSelector;
  /** One read per request for each key, however many sections ask. */
  readonly memo: <T>(key: string, load: () => Promise<T>) => Promise<T>;
  /** An organization-level setting, memoised. */
  readonly setting: <T>(key: string) => Promise<T>;
}

export const dashboardContext = (ctx: AuthContext, now: Date): DashboardContext => {
  const cache = new Map<string, Promise<unknown>>();
  const memo = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit as Promise<T>;
    const pending = load();
    cache.set(key, pending);
    return pending;
  };
  return {
    ctx,
    now,
    today: cairoYmd(now),
    branchId: ctx.activeBranchId ?? null,
    permits: (section) => fleetDashboardGateKeys(section).every((key) => hasPermission(ctx, key)),
    scope: (permissionKey) => scopeSelector(ctx, permissionKey),
    memo,
    setting: <T>(key: string) =>
      memo(`setting:${key}`, () =>
        settingsService.resolve<T>(key, { userId: null, branchId: null }),
      ),
  };
};
