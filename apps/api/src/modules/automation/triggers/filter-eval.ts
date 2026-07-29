// Trigger filter evaluation (A-5) — PURE, so the decision "does this event fire this workflow?" is
// testable without a database, a queue or a provider.
//
// This is the SAME restricted expression form ADR-011 mandates for workflow guards: field
// comparisons over the payload, never arbitrary code. Reusing the form (rather than inventing a
// second one) means one parser, one test suite, one security review — a filter can do nothing an
// attacker could turn into execution.
//
// A-3 already refused, at save time, a filter on a field the event does not declare. This is the
// RUN-time half: given a real payload, decide match. The two are deliberately separate — save-time
// validation is about the shape a human typed; run-time evaluation is about the data that arrived.
import { type AutomationFilter } from '@ecms/contracts';

/** Resolve a dot path (`entityRef.moduleId`) against a payload. `undefined` = absent. */
const resolvePath = (payload: unknown, path: string): unknown => {
  let node: unknown = payload;
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
};

/**
 * Scalar equality that tolerates the wire. Payloads and filter values both travel as JSON, and a
 * filter authored in a form arrives as a string (`'3'`) while the payload carries a number (`3`);
 * comparing with `===` would silently never match. So primitives compare by their string form,
 * which is the least-surprising rule for a field filter.
 */
const scalarEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'object' || typeof b === 'object') return false;
  return String(a) === String(b);
};

/** Numeric comparison for gt/gte/lt/lte, with a date fallback so `runAt gt <iso>` works. */
const asComparable = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber) && value.trim() !== '') return asNumber;
    const asDate = Date.parse(value);
    return Number.isNaN(asDate) ? null : asDate;
  }
  if (value instanceof Date) return value.getTime();
  return null;
};

const evalOne = (filter: AutomationFilter, payload: unknown): boolean => {
  const actual = resolvePath(payload, filter.field);

  switch (filter.op) {
    case 'exists':
      return actual !== undefined;
    case 'eq':
      return scalarEqual(actual, filter.value);
    case 'ne':
      return !scalarEqual(actual, filter.value);
    case 'in':
      return Array.isArray(filter.value) && filter.value.some((v) => scalarEqual(actual, v));
    case 'nin':
      return Array.isArray(filter.value) && !filter.value.some((v) => scalarEqual(actual, v));
    case 'contains':
      if (typeof actual === 'string') return actual.includes(String(filter.value));
      if (Array.isArray(actual)) return actual.some((v) => scalarEqual(v, filter.value));
      return false;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = asComparable(actual);
      const right = asComparable(filter.value);
      // A comparison against something non-numeric is a no-match, not a crash: the alternative is
      // an exception on the dispatch path, which would drop the event for every workflow.
      if (left === null || right === null) return false;
      if (filter.op === 'gt') return left > right;
      if (filter.op === 'gte') return left >= right;
      if (filter.op === 'lt') return left < right;
      return left <= right;
    }
    default:
      // An unknown op is a no-match, deliberately. A filter that cannot be understood must not
      // fire a workflow — silence is the safe failure here.
      return false;
  }
};

/**
 * All filters must pass (AND). An empty filter list matches everything — a trigger with no
 * condition fires on every occurrence of its event, which is the natural reading of "no filter".
 */
export const matchesFilters = (
  filters: readonly AutomationFilter[],
  payload: unknown,
): boolean => filters.every((filter) => evalOne(filter, payload));
