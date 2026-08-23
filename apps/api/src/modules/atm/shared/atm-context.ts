// The two request-derived facts every ATM write needs: WHERE it is filed and WHO did it.
//
// Branch: the legacy had no branch field anywhere — a branch WAS a separate deployment
// (contad_app.js:221-224, one server+DB per branch). In one central database the branch is
// explicit and is resolved from the CALLER, never accepted from a form (the owner's rule:
// "لا تعتمد على إدخال branchId من الـfrontend كحقيقة أمنية"). The resolution is gold's
// `resolveCreateBranchId` verbatim — placement first, then the command bar's narrowing choice
// (ADR-028), then the single-branch fallback, otherwise an explicit refusal naming the control.
//
// Actor: the legacy read the acting user's name from a HIDDEN FORM INPUT and trusted the body
// (atm_replenishment.ejs:559, contad_app.js:689 — port doc conflict T2). Here the name is
// snapshotted from the authenticated identity, which is the same visible outcome ("Added By" /
// "Closed By" columns) minus the spoofability.
import { type AuthContext } from '../../../shared/types';
import { BusinessRuleError } from '../../../shared/errors';
import { branchRepository } from '../../../platform/organization';

export const resolveAtmBranchId = async (ctx: AuthContext): Promise<string> => {
  if (ctx.branchId !== null) return ctx.branchId;
  const active = ctx.activeBranchId ?? null;
  if (active !== null) return active;
  const page = await branchRepository.list({ page: 1, pageSize: 2 });
  const only = page.items[0];
  if (page.meta.totalItems === 1 && only !== undefined) return String(only._id);
  throw new BusinessRuleError(
    ctx.isPrivileged
      ? 'اختر فرعًا محددًا من القائمة العلوية قبل الإضافة.'
      : 'حسابك غير مرتبط بفرع. تواصل مع مدير النظام.',
  );
};

/** The display-name snapshot a row stores for "Added By"/"Closed By"/"Action By". */
export const actorName = (ctx: AuthContext): string | null =>
  ctx.identity?.displayName.ar ?? ctx.identity?.displayName.en ?? null;
