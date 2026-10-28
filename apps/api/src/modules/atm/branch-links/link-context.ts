// The ATM branch links on a request (setting `atm.branchLinks`, contracts atm-settings.ts).
//
// The owner (2026-10-28), for ATM only: «فرع أكتوبر شغال هو والمهندسين مع بعض بكل بياناتهم
// والبيانات دي متسجله إنها المهندسين — يعني أكتوبر هيشوف شغل المهندسين ويشتغل معاهم عادى
// والمهندسين شايف أكتوبر إنه شغال معاه بردو». The data already IS Mohandessin's, so nothing is
// copied or re-filed: on an ATM request a caller placed in October is answered as if placed in
// Mohandessin. Every ATM read is scoped from the caller's branch and every ATM write is filed under
// it (`resolveAtmBranchId`), so moving the caller is the whole rule — October reads and writes
// Mohandessin's rows, and Mohandessin's people see October's work because it is filed on theirs.
//
// Registered for the module's route prefix only (atm.module.ts) through the platform's refiner seam
// (platform/auth/context-refiners.ts): on every other route the same person is still in October.
import { AtmSettingKeys, type AtmBranchLinksSetting } from '@ecms/contracts';
import { settingsService } from '../../../platform/settings';
import { type AuthContext, type UnitReach } from '../../../shared/types';

/** Organization scope: which branch works as which is one fact about the company. */
const ORG_SUBJECT = { userId: null, branchId: null };

/**
 * Pure: the context with every linked SOURCE branch replaced by its target — the placement, the
 * switcher's choice, and every branch the grants reach (wholly, or through a department copy), in
 * the union and per key alike, deduplicated. A department copy is moved with its branch because an
 * ATM row carries a branch and no department: a department grant reads the branch its copy sits in,
 * and without the move a department-scoped October employee would read October, not Mohandessin.
 *
 * Returns a NEW object and never edits the one given: a context's reach comes from the permission
 * cache, and an edit there would follow the caller onto every route of the application.
 */
export const actAsLinkedBranch = (
  ctx: AuthContext,
  links: ReadonlyMap<string, string>,
): AuthContext => {
  if (links.size === 0) return ctx;
  const swap = (branchId: string): string => links.get(branchId) ?? branchId;
  const swapReach = (reach: UnitReach): UnitReach => ({
    ...reach,
    branchIds: [...new Set(reach.branchIds.map(swap))],
    departments: reach.departments.map((copy) => ({ ...copy, branchId: swap(copy.branchId) })),
  });
  const refined: AuthContext = {
    ...ctx,
    branchId: ctx.branchId === null ? null : swap(ctx.branchId),
  };
  if (ctx.activeBranchId !== undefined) {
    refined.activeBranchId = ctx.activeBranchId === null ? null : swap(ctx.activeBranchId);
  }
  if (ctx.reach !== undefined) refined.reach = swapReach(ctx.reach);
  if (ctx.keyReach !== undefined) {
    refined.keyReach = Object.fromEntries(
      Object.entries(ctx.keyReach).map(([key, reach]) => [key, swapReach(reach)]),
    );
  }
  return refined;
};

/** The refiner ATM registers for its routes: the stored links (a cached settings read) applied. */
export const refineAtmAuthContext = async (ctx: AuthContext): Promise<AuthContext> => {
  const links = await settingsService.resolve<AtmBranchLinksSetting>(
    AtmSettingKeys.BranchLinks,
    ORG_SUBJECT,
  );
  return actAsLinkedBranch(ctx, new Map(links.map((link) => [link.branchId, link.actsAsBranchId])));
};
