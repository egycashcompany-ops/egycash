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

/** DM-10: the register's rule for every map READ; `own` reads nothing. */
export const mapScopeMatch = (s: ScopeSelector): Record<string, unknown> => {
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
 * reach `mapScopeMatch` refuses). The two can therefore never disagree.
 */
export const mapScopeBranches = (s: ScopeSelector): 'all' | string[] => {
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
  const reach = mapScopeBranches(s);
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

export type ZoneEditBranch =
  { branchId: string } | { branchId: null; blocked: 'chooseBranch' | 'branchNotEditable' };

/**
 * D-M6 / DM-12: the ONE branch zones are edited and saved in — the top bar's, when the caller can
 * both read and edit it; else the caller's only editable branch; else nothing, with the reason.
 * `GET /context` and the save both ask this, so the branch the editor loads is the branch the save
 * is filed under. Not `resolveAtmBranchId`: its `currentBranchId` puts the home branch before an
 * organization-wide caller's top-bar choice, while reads narrow to that choice (GM-20).
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
