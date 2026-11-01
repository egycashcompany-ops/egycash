// The machine map's ONE scope rule, and the one branch zones are edited in
// (docs/12-planning/atm-map-zones.md §6.2, DM-10, DM-11, DM-12).
//
// «لا تعتمد على إدخال branchId من الـfrontend كحقيقة أمنية». Every read is scoped here, on the
// server; a branch sent by the browser can only NARROW inside the caller's reach, and one outside it
// is a 400, never a silent widening and never an empty map. Every write asks that the key reach the
// record's branch (`keyReachesBranch`), which `own`, `section` and a home-only `department` grant
// never do: those scopes read, and never write — the register's rule (DEC-29).
//
// READS use the register's match, not the machine repository's default: over a collection that
// carries a branch but no department, the repository WIDENS a department- or section-scoped grant to
// the whole company; this narrows it to the branch (`finerNarrowsToBranch`). A department copy
// granted by delegation (ADR-032) narrows to the branch that copy sits in, so it reads the WHOLE of
// that branch. `own` reads nothing: map rows are machines, created by whoever ran the coupling, and
// "own = createdBy" would show an arbitrary subset (DM-10, GM-16).
//
// Every read filter is an `$and` of these clauses, never an object spread: with a spread, a
// narrowing that also sets `branchId` would overwrite the scope clause.
import { keyReachesBranch, scopeSelector, type AuthContext } from '../../../shared/types';
import {
  activeBranchIds,
  branchScopeBranches,
  branchScopeMatch,
  narrowToBranch,
  writableBranches,
} from '../shared/branch-scope';

// The rule itself moved to `shared/branch-scope.ts` (docs/12-planning/atm-settlements-phase1.md
// §6.2), so the settlements pages run the same one; the map keeps its own names.
/** DM-10: the register's rule for every map READ; `own` reads nothing. */
export const mapScopeMatch = branchScopeMatch;
/** The branches `mapScopeMatch` covers: 'all' | ids. */
export const mapScopeBranches = branchScopeBranches;
export { activeBranchIds, narrowToBranch, writableBranches };

export type ZoneEditBranch =
  { branchId: string } | { branchId: null; blocked: 'chooseBranch' | 'branchNotEditable' };

/**
 * D-M6 / DM-12: the ONE branch zones are edited and saved in — the top bar's, when the caller can
 * both read and edit it; else the caller's only editable branch; else nothing, with the reason.
 * `GET /context` and the save both ask this, so the branch the editor loads is the branch the save
 * is filed under. Not `resolveAtmBranchId`: its `currentBranchId` put the home branch before an
 * organization-wide caller's top-bar choice, while reads narrow to that choice (GM-20 — since fixed
 * there too), and the editor must also be able to READ the branch it edits.
 */
export const resolveZoneEditBranch = async (ctx: AuthContext): Promise<ZoneEditBranch> => {
  const readable = mapScopeBranches(scopeSelector(ctx, 'atmMap.view'));
  const editable = (branchId: string): boolean =>
    keyReachesBranch(ctx, 'atmZone.manage', branchId) &&
    (readable === 'all' || readable.includes(branchId));
  const active = ctx.activeBranchId ?? null;
  if (active !== null && editable(active)) return { branchId: active };
  const candidates = (readable === 'all' ? await activeBranchIds() : readable).filter(editable);
  const only = candidates[0];
  if (candidates.length === 1 && only !== undefined) return { branchId: only };
  return {
    branchId: null,
    blocked: candidates.length > 1 ? 'chooseBranch' : 'branchNotEditable',
  };
};
