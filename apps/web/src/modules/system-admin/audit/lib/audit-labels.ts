// What to call an audited act, in the reader's language.
//
// The labels already exist under `systemAdmin.users.audit.*`, written for the account Activity tab.
// P11 reuses that namespace rather than moving it: the keys are correct, another screen already
// depends on them, and a rename across two screens buys nothing. What P11 adds is the REST of them
// — that tab deliberately labelled only the acts an account receives, so a platform-wide log would
// otherwise show most of its rows as raw codes.
import { AUDIT_ACTIONS, type AuditAction } from '@ecms/contracts';

/** The one place the shared namespace is spelled, so reusing it is a decision and not a habit. */
export const auditActionLabelKey = (action: AuditAction | string): string =>
  `systemAdmin.users.audit.${action}`;

/** Every action, for the filter control — ordered as the contract declares them. */
export const auditActions: readonly AuditAction[] = AUDIT_ACTIONS;
