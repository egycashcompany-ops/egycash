// Organization-scope authority: a fact that is one fact about the whole company (a bank, a
// mailbox, the branch links, a master-data catalog) may be written only by a key held at
// ORGANIZATION scope. A branch-scoped holder editing it would be editing it for everybody.
//
// Written once here; ATM's settings and bank rules call it with their own reason, and a module
// wraps it with its own keys.
import { ForbiddenError } from '../errors';
import { scopeOf, type AuthContext } from '../types';

/** 403 unless the caller holds `key` at organization scope. `reason` ends the message. */
export const assertOrganizationScope = (ctx: AuthContext, key: string, reason: string): void => {
  if (scopeOf(ctx, key) !== 'organization') {
    throw new ForbiddenError(`${key} must be held at organization scope — ${reason}`);
  }
};
