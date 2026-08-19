// The caller's data scope, as a raw `$match` clause.
//
// Most reads go through a repository, which applies the scope for them. The dashboard and the
// reports do not: they aggregate across collections with `$lookup`, which means talking to the
// driver directly — so the same rule is spelled out once here rather than improvised twice.
//
// It mirrors what `BaseRepository` does for the gold collections, which declare only `branchId`:
// organization-, department- and section-scoped callers see everything the module holds (no field
// is configured for the finer two, so the scope widens), a branch-scoped caller sees their branch,
// and an own-scoped caller sees what they created.
import { Types } from 'mongoose';
import { type ScopeSelector } from '../../../shared/types';

/** Matches nothing — a branch-scoped caller with no branch placement sees no gold data. */
const NEVER = { _id: new Types.ObjectId('000000000000000000000000') };

export const scopeClause = (scope: ScopeSelector): Record<string, unknown> => {
  if (scope.scope === 'branch') {
    return scope.branchId === null ? NEVER : { branchId: new Types.ObjectId(scope.branchId) };
  }
  if (scope.scope === 'own') return { createdBy: new Types.ObjectId(scope.userId) };
  return {};
};
