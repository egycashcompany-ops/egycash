// The module's branch scope (design §3.5, §7.2): the one data read the shared fail-closed rule
// leaves to its callers.
//
// The rule itself — `branchScopeMatch`, `branchScopeBranches`, `narrowToBranch`,
// `writableBranches`, `resolveWorkBranch` — is imported from the shared
// `apps/api/src/shared/base/branch-scope.ts` (PC-12), never copied, so a warehouse is read as ATM
// reads its branch records. `shared/` may import only `shared/`, so the list of the company's
// branches, which lives in `platform/organization`, is read here and handed to it. The module's
// own two-branch helpers (`branchScopeMatchOn`, `twoBranchScopeMatch` and the `isNeverMatch` they
// use) join this file with the documents that need them, P5 and P7.
import { branchService } from '../../../platform/organization';
import { type ActiveBranchIds } from '../../../shared/base/branch-scope';

/**
 * The company's active branches, in the order the top bar's branch switcher lists them — its own
 * `/platform/branches/options` read, by code, every page of it. The candidates a write may name
 * (a warehouse is created only in one of them) and the branch-options list.
 */
export const activeBranchIds: ActiveBranchIds = async () =>
  (await branchService.options()).map((branch) => branch.id);
