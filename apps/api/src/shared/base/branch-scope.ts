// The fail-closed scope rule for records that carry a branch, and the ONE branch a page works in —
// written once here so every module that keeps branch records reads the same answer.
//
// «لا تعتمد على إدخال branchId من الـfrontend كحقيقة أمنية». Every read is scoped on the server; a
// branch sent by the browser can only NARROW inside the caller's reach, and one outside it is a 400,
// never a silent widening and never an empty page. Every write asks that the key reach the record's
// branch (`keyReachesBranch`), which `own`, `section` and a home-only `department` grant never do:
// those scopes read, and never write.
//
// READS narrow a department- or section-scoped grant to its branch (`finerNarrowsToBranch`) instead
// of the repository default, which over a collection with a branch but no department widens it to
// the whole company. A department copy granted by delegation (ADR-032) narrows to the branch that
// copy sits in, so it reads the WHOLE of that branch. `own` reads nothing: a branch record is not
// its author's, and "own = createdBy" would show an arbitrary subset.
//
// Every read filter is an `$and` of these clauses, never an object spread: with a spread, a
// narrowing that also sets `branchId` would overwrite the scope clause.
//
// First written for ATM (its map, then its settlements: `modules/atm/shared/branch-scope.ts`, which
// now re-exports these under the same names). Pure: the one data read, the company's active branch
// ids, stays with each caller and is passed in as a loader, because `shared/` may import only
// `shared/` (eslint.config.js) and the branch list lives in `platform/organization`.
import { Types } from 'mongoose';
import { ValidationError } from '../errors';
import {
  keyReachesBranch,
  scopeSelector,
  selectorBranches,
  type AuthContext,
  type ScopeSelector,
} from '../types';
import { NEVER_MATCH, orgScopeMatch } from './org-scope-match';

/** The company's active branch ids, read only when a rule needs the whole list. */
export type ActiveBranchIds = () => Promise<readonly string[]>;

/** The rule for every branch-record READ; `own` reads nothing. */
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
 * The branches that match covers: 'all' | ids — `selectorBranches`, except that `own` covers
 * nothing here, and neither does a non-organization shape `selectorBranches` calls 'all' (the
 * department reach `branchScopeMatch` refuses). The two can therefore never disagree.
 */
export const branchScopeBranches = (s: ScopeSelector): 'all' | string[] => {
  if (s.scope === 'own') return [];
  const branches = selectorBranches(s);
  if (branches === 'all' && s.scope !== 'organization') return [];
  return branches;
};

/**
 * A browser branch may only narrow. Throws ValidationError OUT_OF_REACH. Returns `{}` when
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
  activeBranchIds: ActiveBranchIds,
): Promise<'all' | string[]> => {
  if (candidates === 'all' && ctx.permissions[key] === 'organization') return 'all';
  const pool = candidates === 'all' ? await activeBranchIds() : candidates;
  return pool.filter((branchId) => keyReachesBranch(ctx, key, branchId));
};

export type WorkBranch =
  | { branchId: string; canWrite: boolean }
  | { branchId: null; blocked: 'chooseBranch' | 'noBranch' };

/**
 * The ONE branch a page works in, for THAT page's key pair — the top bar's branch when the view
 * key reads it; else the caller's only readable branch; else nothing, with the reason. Read-only
 * holders get a branch too; `canWrite` says whether the write key reaches it. The branch a page
 * loads is therefore the branch it writes.
 */
export const resolveWorkBranch = async (
  ctx: AuthContext,
  viewKey: string,
  writeKey: string,
  activeBranchIds: ActiveBranchIds,
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
