// The `$match` fragment a hierarchical data scope implies — for the reads a repository cannot do.
//
// `BaseRepository.scopeFilter` is the authority for every ordinary query. Aggregations and joins
// cannot call it (they name their fields through a `$lookup` prefix, or read a collection the
// repository does not own), and before this file each of them spelled the rule again by hand:
// the fleet dashboard, the gold reports, the attendance export, the roles list joined to its
// holders. Four copies, and when a grant learned to REACH several branches all four kept
// answering with the caller's home branch only. So the rule lives here once, the repository
// delegates to it, and a hand-written match is the same function with a field map.
//
// What it answers, per scope:
//   organization → nothing (no narrowing);
//   branch       → the branches the grant reaches (`branchIds`), else the home branch;
//   department   → the department copies the grant reaches (`departmentIds`), narrowed to the
//                  branches it reaches when both are listed, else the home department;
//   section      → the home section.
// A scope whose unit the caller does not have (placed nowhere) matches NOTHING — the fail-closed
// direction — and a scope over a collection that carries no such field widens, exactly as the
// repository always has. `own` is not answered here: what "mine" means differs per collection.
import { Types } from 'mongoose';
import { type ScopeSelector } from '../types';

/** Which fields of the collection carry the caller's org units. An absent level widens. */
export interface OrgScopeFields {
  branch?: string;
  department?: string;
  section?: string;
}

export interface OrgScopeMatchOptions {
  /**
   * For a collection that carries a branch but not the finer units: a department- or
   * section-scoped caller sees THEIR BRANCH rather than everything. The dashboards want this
   * (a section head sees their site's fleet, not the company's); the gold aggregates keep the
   * repository's widening, because that is what their list screens do.
   */
  finerNarrowsToBranch?: boolean;
}

/** Matches nothing — the answer for a caller placed nowhere at the level they are scoped to. */
export const NEVER_MATCH: Readonly<Record<string, unknown>> = Object.freeze({
  _id: new Types.ObjectId('000000000000000000000000'),
});

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

const one = (field: string, id: string | null): Record<string, unknown> =>
  id === null ? { ...NEVER_MATCH } : { [field]: oid(id) };

/** `$in` over the valid ids — and NEVER on an empty set, so a reach that resolved to nothing cannot widen. */
const many = (field: string, ids: readonly string[]): Record<string, unknown> => {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return { ...NEVER_MATCH };
  return { [field]: { $in: valid.map(oid) } };
};

const listed = (ids: readonly string[] | undefined): ids is readonly string[] =>
  ids !== undefined && ids.length > 0;

/** The branch clause a branch-level narrowing implies: the reach list when there is one, else home. */
const branchClause = (field: string, selector: ScopeSelector): Record<string, unknown> =>
  listed(selector.branchIds) ? many(field, selector.branchIds) : one(field, selector.branchId);

/**
 * The `$match` fragment for a hierarchical scope over `fields`. `{}` for organization scope.
 * Returns `undefined` for `own`, which the caller spells for its own collection.
 */
export const orgScopeMatch = (
  selector: ScopeSelector,
  fields: OrgScopeFields,
  options: OrgScopeMatchOptions = {},
): Record<string, unknown> | undefined => {
  if (selector.scope === 'organization') return {};
  if (selector.scope === 'own') return undefined;

  const fallback = (): Record<string, unknown> =>
    options.finerNarrowsToBranch === true && fields.branch !== undefined
      ? branchClause(fields.branch, selector)
      : {};

  if (selector.scope === 'branch') {
    return fields.branch === undefined ? {} : branchClause(fields.branch, selector);
  }
  if (selector.scope === 'department') {
    if (fields.department === undefined) return fallback();
    if (!listed(selector.departmentIds)) return one(fields.department, selector.departmentId);
    // A department reach is already narrowed to the branches it covers; when the collection also
    // carries the branch, both are asked for, so the two lists can never disagree on a row.
    const byDepartment = many(fields.department, selector.departmentIds);
    if (fields.branch !== undefined && listed(selector.branchIds)) {
      return { $and: [byDepartment, many(fields.branch, selector.branchIds)] };
    }
    return byDepartment;
  }
  // section
  return fields.section === undefined ? fallback() : one(fields.section, selector.sectionId);
};
