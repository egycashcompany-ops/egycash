// The two request-derived facts every ATM write needs: WHERE it is filed and WHO did it.
//
// Branch: the legacy had no branch field anywhere — a branch WAS a separate deployment
// (contad_app.js:221-224, one server+DB per branch). In one central database the branch is
// explicit and is resolved from the CALLER, never accepted from a form (the owner's rule:
// "لا تعتمد على إدخال branchId من الـfrontend كحقيقة أمنية"). The resolution is gold's
// `resolveCreateBranchId` verbatim — the branch the caller is acting in (`currentBranchId`:
// placement, or the command bar's choice within their reach — ADR-028), then the single-branch
// fallback, otherwise an explicit refusal naming the control.
//
// Actor: the legacy read the acting user's name from a HIDDEN FORM INPUT and trusted the body
// (atm_replenishment.ejs:559, contad_app.js:689 — port doc conflict T2). Here the name is
// snapshotted from the authenticated identity, which is the same visible outcome ("Added By" /
// "Closed By" columns) minus the spoofability.
import {
  currentBranchId,
  keyReachesBranch,
  reachOfKey,
  type AuthContext,
} from '../../../shared/types';
import { BusinessRuleError } from '../../../shared/errors';
import { branchRepository } from '../../../platform/organization';

export const resolveAtmBranchId = async (ctx: AuthContext): Promise<string> => {
  const current = currentBranchId(ctx);
  if (current !== null) return current;
  const page = await branchRepository.list({ page: 1, pageSize: 2 });
  const only = page.items[0];
  if (page.meta.totalItems === 1 && only !== undefined) return String(only._id);
  throw new BusinessRuleError(
    ctx.isPrivileged
      ? 'اختر فرعًا محددًا من القائمة العلوية قبل الإضافة.'
      : 'حسابك غير مرتبط بفرع. تواصل مع مدير النظام.',
  );
};

/**
 * Whether `atmMachine.manage` lets the caller write Operations data in `branchId`: the key reaches
 * that whole branch, or — the "manage at home" rule — it is held at a scope that reaches no whole
 * branch (department, section or own), lists no units elsewhere, and `branchId` is the branch the
 * caller is PLACED in. Before the reach checks every `manage` holder could add in the branch they
 * act in; a finer-scoped one reaches no whole branch, so the reach check alone took that away, and
 * the placement is the one branch no other key can stretch (review finding F1). A `branch` grant
 * (a delegated deputy's, say) answers through `keyReachesBranch` alone, so a deputy reaching
 * Alexandria cannot write into the Tanta branch they happen to be placed in.
 *
 * Shared by the label add (`ref-label.service.ts`) and the machine add, which since DEC-36 also
 * writes the company-wide register — so it must not land in a branch only an unrelated key reaches.
 */
export const manageActsInBranch = (ctx: AuthContext, branchId: string): boolean => {
  if (keyReachesBranch(ctx, 'atmMachine.manage', branchId)) return true;
  const scope = ctx.permissions['atmMachine.manage'];
  const reach = reachOfKey(ctx, 'atmMachine.manage');
  return (
    (scope === 'department' || scope === 'section' || scope === 'own') &&
    reach.branchIds.length === 0 &&
    reach.departments.length === 0 &&
    ctx.branchId !== null &&
    branchId === ctx.branchId
  );
};

/** The display-name snapshot a row stores for "Added By"/"Closed By"/"Action By". */
export const actorName = (ctx: AuthContext): string | null =>
  ctx.identity?.displayName.ar ?? ctx.identity?.displayName.en ?? null;
