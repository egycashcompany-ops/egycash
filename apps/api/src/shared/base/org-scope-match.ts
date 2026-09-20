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
//   branch / department with a reach → the OR of the units the key covers: whole branches
//                  (`branchIds`) and department copies (`departmentIds`) — see ADR-032;
//   branch       → else the home branch;
//   department   → else the home department;
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

/**
 * The `$match` fragment for a hierarchical scope over `fields`. `{}` for organization scope.
 * Returns `undefined` for `own`, which the caller spells for its own collection.
 *
 * With a reach (either list present) the answer is the OR of the units it names — whole branches
 * on the branch field, department copies on the department field. Over a collection that carries
 * a branch but no department, a department copy narrows to ITS branch rather than widening: that is
 * as close as the data lets «this department in this site» get, and it never reaches past the site.
 * Without a reach, the single home id answers, exactly as it always has.
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
      ? one(fields.branch, selector.branchId)
      : {};

  if (selector.scope === 'section') {
    return fields.section === undefined ? fallback() : one(fields.section, selector.sectionId);
  }

  const branchIds = listed(selector.branchIds) ? selector.branchIds : undefined;
  const departmentIds = listed(selector.departmentIds) ? selector.departmentIds : undefined;
  if (branchIds !== undefined || departmentIds !== undefined) {
    const clauses: Record<string, unknown>[] = [];
    if (branchIds !== undefined && fields.branch !== undefined) clauses.push(many(fields.branch, branchIds));
    if (departmentIds !== undefined) {
      if (fields.department !== undefined) {
        clauses.push(many(fields.department, departmentIds));
      } else if (fields.branch !== undefined && listed(selector.departmentBranchIds)) {
        clauses.push(many(fields.branch, selector.departmentBranchIds));
      } else {
        // Neither field: the collection is not placed at all, so the scope cannot narrow it.
        return {};
      }
    }
    if (clauses.length === 0) return {};
    return clauses.length === 1 ? (clauses[0] as Record<string, unknown>) : { $or: clauses };
  }

  if (selector.scope === 'branch') {
    return fields.branch === undefined ? {} : one(fields.branch, selector.branchId);
  }
  // department, home only
  return fields.department === undefined ? fallback() : one(fields.department, selector.departmentId);
};
