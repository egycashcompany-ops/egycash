// How far `approval.override` reaches, read against the rung it would decide — pure, like the
// chain's other rules (OD-69 (i), R4; ADR-041 decision 6).
//
// An override replaces a rung's holder, so it must reach as far as that rung asks: a rung for the
// whole company is not decided by an override held over one branch, however senior its holder. The
// test is therefore by the RUNG'S LEVEL, not by whether the override touches the request somewhere.
// Read by the request's Unit alone, an override over one branch would decide an organization rung.
//
// The coordinates are checked before the shared reach helpers are asked, and that order is the
// rule, not a tidy-up: `keyCoversUnit` reads a missing department copy as a question about the
// whole branch, so a branch-wide override would otherwise pass a `unit` rung on a request with no
// department. A rung whose Unit lacks what its level needs fails closed, unless the override is
// held at organization scope, which reaches every rung whatever the Unit has.
import { type ApprovalLevel } from '@ecms/contracts';
import {
  keyCoversDepartmentEverywhere,
  keyCoversUnit,
  keyReachesBranch,
  scopeOf,
  type AuthContext,
} from '../../shared/types';
import { type Unit } from './approver-level';

export const APPROVAL_OVERRIDE_KEY = 'approval.override';

/**
 * Whether the actor's `approval.override` reaches a rung of `level` over `unit`.
 *
 * Read from the actor's context, which holds grants in force only, so an override that has expired
 * or not yet started reaches nothing. `own` and `section` reach no Unit, so they pass no rung.
 */
export const overrideReaches = (actor: AuthContext, level: ApprovalLevel, unit: Unit): boolean => {
  if (scopeOf(actor, APPROVAL_OVERRIDE_KEY) === 'organization') return true;
  switch (level) {
    case 'organization':
      return false;
    case 'department':
      return (
        unit.departmentCatalogId !== null &&
        keyCoversDepartmentEverywhere(actor, APPROVAL_OVERRIDE_KEY, unit.departmentCatalogId)
      );
    case 'branch':
      return (
        unit.branchId !== null && keyReachesBranch(actor, APPROVAL_OVERRIDE_KEY, unit.branchId)
      );
    case 'unit':
      return (
        unit.branchId !== null &&
        unit.departmentId !== null &&
        keyCoversUnit(actor, APPROVAL_OVERRIDE_KEY, unit.branchId, unit.departmentId)
      );
  }
};
