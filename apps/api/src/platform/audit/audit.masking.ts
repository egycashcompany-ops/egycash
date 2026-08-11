// What an audit row may show, decided once — G-1.
//
// The rule used to live inside `audit.export.ts`, which made it the CSV's rule rather than the audit
// stream's. `toAuditDto` never applied it, so the list endpoint returned raw change values while the
// export masked them: **two readers of the same rows, two different answers about what may be
// shown.** That was invisible while nothing read the list; P11 puts a screen on it, and the screen
// would have been the weaker of the two.
//
// Moved here, both readers import the same function and cannot drift again.
//
// **Field-name-based, and deliberately not a general PII scanner** — the audit-service design says
// so in as many words ("documented as the current scope, not a promise of completeness"). It covers
// the one field the plan names. A new sensitive field is masked by adding it here, which is one
// edit rather than two.
import { maskNationalId, type AuditChange } from '@ecms/contracts';

/** Change fields whose value is masked before it leaves the server, by either reader. */
export const MASKED_FIELDS: ReadonlySet<string> = new Set(['nationalId']);

/**
 * Exact field name, unchanged from the export's original rule.
 *
 * It does NOT match a dotted path: a change recorded as `personal.nationalId` is not masked by
 * this. That is worth knowing and was deliberately left alone — P11's scope is to stop the list and
 * the export disagreeing, not to widen what either masks, and widening it silently would change
 * the CSV's output as a side effect of a screen. In practice the one service that writes that path
 * (`employee.service`) already stores `'[masked]'` at write time, so no raw value sits behind it.
 * A future decision to match by leaf segment belongs to whoever takes it, not here.
 */
export const maskChangeValue = (field: string, value: unknown): unknown =>
  MASKED_FIELDS.has(field) && typeof value === 'string' ? maskNationalId(value) : value;

/** A whole change list, masked. The one call both the list DTO and the CSV row make. */
export const maskChanges = (changes: AuditChange[]): AuditChange[] =>
  changes.map((change) => ({
    field: change.field,
    old: maskChangeValue(change.field, change.old),
    new: maskChangeValue(change.field, change.new),
  }));
