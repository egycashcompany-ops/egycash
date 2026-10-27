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
import { Types } from 'mongoose';
import { branchRepository } from '../../../platform/organization';
import { NEVER_MATCH, orgScopeMatch } from '../../../shared/base/org-scope-match';
import { ValidationError } from '../../../shared/errors';
import {
  keyReachesBranch,
  scopeSelector,
  type AuthContext,
  type ScopeSelector,
} from '../../../shared/types';
import { registerScopeBranches } from '../register/register.repository';

/** DM-10 / DS-23: the register's rule for every branch-record READ; `own` reads nothing. */
export const branchScopeMatch = (s: ScopeSelector): Record<string, unknown> => {
  if (s.scope === 'own') return { ...NEVER_MATCH };
  const m = orgScopeMatch(s, { branch: 'branchId' }, { finerNarrowsToBranch: true });
  // orgScopeMatch answers `{}` for organization AND for a department reach it cannot place
  // (org-scope-match.ts). Only the first may read everything.
  if (m === undefined || (Object.keys(m).length === 0 && s.scope !== 'organization')) {
    return { ...NEVER_MATCH };
  }
  return m;
};

/**
 * The branches that match covers: 'all' | ids — `registerScopeBranches`, except that `own` covers
 * nothing here, and neither does a non-organization shape the register calls 'all' (the department
 * reach `branchScopeMatch` refuses). The two can therefore never disagree.
 */
export const branchScopeBranches = (s: ScopeSelector): 'all' | string[] => {
  if (s.scope === 'own') return [];
  const branches = registerScopeBranches(s);
  if (branches === 'all' && s.scope !== 'organization') return [];
  return branches;
};

/**
 * DM-11: a browser branch may only narrow. Throws ValidationError OUT_OF_REACH. Returns `{}` when
 * `branchId` is undefined, else `{ branchId }`. `field` names where the branch came from.
 */
export const narrowToBranch = (
  s: ScopeSelector,
  branchId: string | undefined,
  field = 'query.branchId',
): Record<string, unknown> => {
  if (branchId === undefined) return {};
  const reach = branchScopeBranches(s);
  if (reach !== 'all' && !reach.includes(branchId)) {
    throw new ValidationError([
      { field, code: 'OUT_OF_REACH', message: 'the branch is outside your reach' },
    ]);
  }
  return { branchId: new Types.ObjectId(branchId) };
};

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
export const writableBranches = async (
  ctx: AuthContext,
  key: string,
  candidates: 'all' | string[],
): Promise<'all' | string[]> => {
  if (candidates === 'all' && ctx.permissions[key] === 'organization') return 'all';
  const pool = candidates === 'all' ? await activeBranchIds() : candidates;
  return pool.filter((branchId) => keyReachesBranch(ctx, key, branchId));
};

export type WorkBranch =
  | { branchId: string; canWrite: boolean }
  | { branchId: null; blocked: 'chooseBranch' | 'noBranch' };

/**
 * DS-22: the ONE branch a page works in, for THAT page's key pair — the top bar's branch when the
 * view key reads it; else the caller's only readable branch; else nothing, with the reason.
 * Read-only holders get a branch too; `canWrite` says whether the write key reaches it. The branch a
 * page loads is therefore the branch it writes (the map's GM-20 lesson, `resolveZoneEditBranch`).
 */
export const resolveWorkBranch = async (
  ctx: AuthContext,
  viewKey: string,
  writeKey: string,
): Promise<WorkBranch> => {
  const readable = branchScopeBranches(scopeSelector(ctx, viewKey));
  const active = ctx.activeBranchId ?? null;
  if (active !== null && (readable === 'all' || readable.includes(active))) {
    return { branchId: active, canWrite: keyReachesBranch(ctx, writeKey, active) };
  }
  const candidates = readable === 'all' ? await activeBranchIds() : readable;
  const only = candidates[0];
  if (candidates.length === 1 && only !== undefined) {
    return { branchId: only, canWrite: keyReachesBranch(ctx, writeKey, only) };
  }
  return { branchId: null, blocked: candidates.length > 1 ? 'chooseBranch' : 'noBranch' };
};
