// The ATM module's branch-record scope rule, and the ONE branch a page works in
// (docs/12-planning/atm-settlements-phase1.md §6.2, DS-22, DS-23; first written for the map,
// docs/12-planning/atm-map-zones.md §6.2, DM-10, DM-11).
//
// «لا تعتمد على إدخال branchId من الـfrontend كحقيقة أمنية». Every read is scoped here, on the
// server; a branch sent by the browser can only NARROW inside the caller's reach, and one outside it
// is a 400, never a silent widening and never an empty page. Every write asks that the key reach the
// record's branch (`keyReachesBranch`), which `own`, `section` and a home-only `department` grant
// never do: those scopes read, and never write — the register's rule (DEC-29).
//
// READS use the register's match, not the machine repository's default: over a collection that
// carries a branch but no department, the repository WIDENS a department- or section-scoped grant to
// the whole company; this narrows it to the branch (`finerNarrowsToBranch`). A department copy
// granted by delegation (ADR-032) narrows to the branch that copy sits in, so it reads the WHOLE of
// that branch. `own` reads nothing: plans, layouts and routes are branch records created by whoever
// ran an action, and "own = createdBy" would show an arbitrary subset (DM-10, DS-23).
//
// Every read filter is an `$and` of these clauses, never an object spread: with a spread, a
// narrowing that also sets `branchId` would overwrite the scope clause.
//
// The map's `map/map-scope.ts` re-exports these under its own names, so the map and the
// settlements pages run one rule.
import { branchRepository } from '../../../platform/organization';
import * as shared from '../../../shared/base/branch-scope';
import { type AuthContext } from '../../../shared/types';

// The rule itself lives in `shared/base/branch-scope.ts` (written once, so any module with branch
// records reads the same answer). ATM keeps its names and its one data read, the active branches.
export {
  branchScopeBranches,
  branchScopeMatch,
  narrowToBranch,
  type WorkBranch,
} from '../../../shared/base/branch-scope';

/** The company's active branches — the list the top-bar validation reads (active-branch.ts). */
export const activeBranchIds = async (): Promise<string[]> => {
  const page = await branchRepository.list({ page: 1, pageSize: 200 });
  return page.items.filter((branch) => branch.status === 'active').map((b) => String(b._id));
};

/**
 * Writes: the branches among `candidates` this key reaches. 'all' ONLY when
 * ctx.permissions[key] === 'organization' AND candidates === 'all'; otherwise an explicit list,
 * enumerated through keyReachesBranch over the candidates (or over the company's active branches
 * when candidates === 'all').
 */
export const writableBranches = (
  ctx: AuthContext,
  key: string,
  candidates: 'all' | string[],
): Promise<'all' | string[]> => shared.writableBranches(ctx, key, candidates, activeBranchIds);

/**
 * DS-22: the ONE branch a page works in, for THAT page's key pair — the top bar's branch when the
 * view key reads it; else the caller's only readable branch; else nothing, with the reason.
 * Read-only holders get a branch too; `canWrite` says whether the write key reaches it. The branch a
 * page loads is therefore the branch it writes (the map's GM-20 lesson, `resolveZoneEditBranch`).
 */
export const resolveWorkBranch = (
  ctx: AuthContext,
  viewKey: string,
  writeKey: string,
): Promise<shared.WorkBranch> => shared.resolveWorkBranch(ctx, viewKey, writeKey, activeBranchIds);
