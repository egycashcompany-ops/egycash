// Does this rule fire for this event, and what does its message say? PURE — no database, no bus,
// no notification. The decisions a rule engine gets wrong are all in here, and none of them needs
// I/O to be asked.
//
// Three of them carry real consequences:
//
//   • WHETHER IT FIRES AT ALL. A disabled rule, or one whose conditions do not hold, must produce
//     nothing. The condition form is the automation trigger's, reused rather than reinvented —
//     one parser, one evaluator, one security review, and a filter still cannot become execution.
//
//   • WHAT THE MESSAGE SAYS. Placeholders are resolved from the event's own payload. An unknown
//     one is left as literal text rather than blanked, which is what makes a mistyped field name
//     visible in the notification instead of silently producing "عقد  انتهى".
//
//   • WHO IT NAMES. `subject` reads a person out of the payload, and the path can be wrong, absent
//     or hold something that is not an id. Every one of those has to mean "this rule tells nobody
//     this time" rather than an exception that stops the event reaching its other consumers.
import { type AutomationFilter, type RuleAudience } from '@ecms/contracts';
import { matchesFilters } from '../../automation/triggers/filter-eval';

/** The shape a rule needs to be evaluated — the stored document, minus everything else. */
export interface EvaluableRule {
  enabled: boolean;
  event: string;
  filters: AutomationFilter[];
}

/**
 * Whether a rule answers this event.
 *
 * `enabled` is checked first because it is the cheapest of the three and settles most events on a
 * busy bus — not because the order is load-bearing. It is not: `matchesFilters` is total (every
 * branch of `evalOne` returns a boolean, and a comparison it cannot make is a no-match rather than
 * a throw), so no ordering here can turn a disabled rule back on.
 */
export const ruleFires = (rule: EvaluableRule, eventName: string, payload: unknown): boolean => {
  if (!rule.enabled) return false;
  if (rule.event !== eventName) return false;
  return matchesFilters(rule.filters, payload);
};

/** Resolve a dot path against a payload. `undefined` = absent, at any depth. */
export const valueAt = (payload: unknown, path: string): unknown => {
  let node: unknown = payload;
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
};

/**
 * The payload, flattened to the dot paths a message may name.
 *
 * `{entityRef: {entityId: 'x'}}` becomes `entityRef.entityId`, which is what the event catalogue
 * calls that field — so the placeholder somebody types is the field name the picker showed them.
 * Only scalars become placeholders: an object has no sensible rendering in a sentence, and
 * `[object Object]` in a notification is worse than the placeholder left standing.
 */
export const flattenPayload = (payload: unknown, prefix = ''): Record<string, string> => {
  if (payload === null || typeof payload !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      if (Array.isArray(value)) continue;
      Object.assign(out, flattenPayload(value, path));
      continue;
    }
    out[path] = String(value);
  }
  return out;
};

/** `{{name}}` — the same placeholder form the platform's own renderer uses. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;

/**
 * Fill a rule's text from the payload.
 *
 * An unmatched placeholder is LEFT AS IT IS. Blanking it would turn a typo into a sentence with a
 * hole in it that nobody can trace back; leaving `{{employeeNam}}` in the message names the
 * mistake in the one place somebody will actually look.
 */
export const renderRuleText = (text: string, values: Record<string, string>): string =>
  text.replace(PLACEHOLDER, (match, name: string) => values[name] ?? match);

/**
 * The employee ids a `subject` audience names for this payload.
 *
 * Returns an EMPTY list for every way the path can disappoint — absent, null, an object, a number,
 * a string that is not an id. A rule pointed at the wrong field tells nobody, which is the quiet
 * failure; throwing here would be the loud one, and it would travel up into an event the rest of
 * the platform is still trying to deliver.
 */
export const subjectEmployeeIds = (payload: unknown, path: string): string[] => {
  const value = valueAt(payload, path);
  const candidates = Array.isArray(value) ? value : [value];
  return candidates
    .filter((entry): entry is string => typeof entry === 'string')
    .filter((entry) => /^[0-9a-fA-F]{24}$/.test(entry));
};

/** Whether an audience needs the employee registry read at all — the rest resolve without it. */
export const needsEmployeeLookup = (audience: RuleAudience): boolean =>
  audience.kind === 'subject' || audience.kind === 'everyone' || audience.kind === 'audience';
