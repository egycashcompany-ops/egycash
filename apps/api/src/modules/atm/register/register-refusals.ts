// How a refusal names ANOTHER branch (review finding F-9): only when the caller's key reaches that
// branch — never a branch the caller cannot see. One rule for every write that refuses over a code
// held elsewhere: the register's own writes name it under `atmRegister.view`; a write made under
// another page's key (the data-edit add, DEC-36) passes the key that reads THAT page, so nobody
// learns more through the refusal than the page shows.
//
// The branch is named as the top bar names it — its ECMS name, in the caller's language (the owner,
// 2026-10-28: «أنا عايزك تعتمد التسمية اللى بالعربي والإنجليزي») — not by a workbook code: a branch
// in reach that no code resolves to is named too. Reach is asked of the branch ATM files it as
// (`resolveBranch`): a row still filed under a linked source is its target's people's, who are
// answered as the target (link-context.ts) and would otherwise never be told where it is.
import { type Types } from 'mongoose';
import { branchRepository } from '../../../platform/organization';
import { keyReachesBranch, type AuthContext } from '../../../shared/types';
import { type RegisterSettings } from './register-settings';

export const describeBranch = async (
  ctx: AuthContext,
  branchId: Types.ObjectId | string | null | undefined,
  settings: Pick<RegisterSettings, 'resolveBranch'>,
  namingKey = 'atmRegister.view',
): Promise<string> => {
  if (branchId === null || branchId === undefined) return 'an entry with no branch';
  const id = String(branchId);
  if (!keyReachesBranch(ctx, namingKey, settings.resolveBranch(id))) return 'another branch';
  const [branch] = await branchRepository.findByIdsSystem([id]);
  return branch === undefined ? 'another branch' : branch.name[ctx.locale];
};
