// The caller's data scope, as a raw `$match` clause.
//
// Most reads go through a repository, which applies the scope for them. The dashboard and the
// reports do not: they aggregate across collections with `$lookup`, which means talking to the
// driver directly — so the same rule is spelled out once here rather than improvised twice.
//
// It is what `BaseRepository` does for the gold collections, which declare only `branchId`:
// organization-, department- and section-scoped callers see everything the module holds (no field
// is configured for the finer two, so the scope widens), a branch-scoped caller sees the branches
// their grant reaches, and an own-scoped caller sees what they created.
import { Types } from 'mongoose';
import { orgScopeMatch } from '../../../shared/base/org-scope-match';
import { type ScopeSelector } from '../../../shared/types';

export const scopeClause = (scope: ScopeSelector): Record<string, unknown> =>
  orgScopeMatch(scope, { branch: 'branchId' }) ?? { createdBy: new Types.ObjectId(scope.userId) };
