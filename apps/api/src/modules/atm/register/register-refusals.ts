// How a refusal names ANOTHER branch (review finding F-9): by its EGYCASH code only when the
// caller's key reaches that branch — never a branch the caller cannot see. One rule for every
// write that refuses over a code held elsewhere: the register's own writes name it under
// `atmRegister.view`; a write made under another page's key (the data-edit add, DEC-36) passes
// the key that reads THAT page, so nobody learns more through the refusal than the page shows.
import { type Types } from 'mongoose';
import { keyReachesBranch, type AuthContext } from '../../../shared/types';
import { type RegisterSettings } from './register-settings';

export const describeBranch = (
  ctx: AuthContext,
  branchId: Types.ObjectId | string | null | undefined,
  settings: Pick<RegisterSettings, 'codeByBranchId'>,
  namingKey = 'atmRegister.view',
): string => {
  if (branchId === null || branchId === undefined) return 'an entry with no branch';
  const code = settings.codeByBranchId.get(String(branchId));
  return code !== undefined && keyReachesBranch(ctx, namingKey, String(branchId))
    ? code
    : 'another branch';
};
