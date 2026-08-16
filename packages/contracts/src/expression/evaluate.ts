// Run-time evaluation (P-HR-24 / D-EXPR-5 = B).
//
// ONE RULE GOVERNS THIS FILE: an expression that cannot be computed answers `null`, never `0`.
//
// The system already made this distinction and paid for it. `compensation-rules.ts` emits a line in
// state `pendingQuantity` — shown, and excluded from every total — when an attendance feed has not
// been frozen, because "a total containing a guess is worse than none". A calculated field that
// quietly reported zero for a missing input would be exactly that guess, wearing the costume of a
// figure somebody can act on.
//
// AND IT NEVER THROWS. `filter-eval.ts` reached the same conclusion from the other side: an
// exception on the dispatch path would drop an event for every subscriber, so an incomprehensible
// filter is a no-match rather than a crash. Here the safe answer is `null` rather than `false`, but
// the property is the same one, and it is total — including for a tree that was never validated.
//
// WHAT THIS FILE DOES NOT KNOW. It has no notion of money, of minor units, of a currency, or of
// when to round (D-EXPR-4 = A). It is given numbers and returns a number. Turning a payroll figure
// into an input, and a result back into an amount, belongs to whoever calls it — the same boundary
// `hr-payroll-money.ts` draws when it says it defines what one rounding step does, never when to
// take one.
import { EXPRESSION_MAX_DEPTH, type ExpressionNode } from './ast.js';

/**
 * The values an expression reads: a FLAT record keyed by the catalog's dot paths.
 *
 * Flat rather than nested, deliberately. A nested shape would need a path walk, and a path walk
 * over attacker-influenced strings is how `constructor` or `__proto__` becomes a readable "field".
 * Here a reference either matches a key the caller put there, or it resolves to nothing.
 */
export type ExpressionValues = Readonly<Record<string, unknown>>;

/** A stored value is usable only if it is a real, finite number. No coercion — see `numberAt`. */
const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * The value at a path, or null.
 *
 * NO COERCION, and this is the one place this engine deliberately disagrees with `filter-eval`.
 * That file compares primitives by their string form, because a filter authored in a web form
 * arrives as `'3'` while the payload carries `3`, and a comparison that never matched would be
 * useless. Arithmetic has the opposite failure mode: silently reading `'12'` as twelve is how a
 * report shows a number that is wrong rather than a blank that is honest.
 *
 * Own properties only, so nothing inherited from `Object.prototype` can present itself as a field.
 */
const numberAt = (values: ExpressionValues, path: string): number | null =>
  Object.prototype.hasOwnProperty.call(values, path) ? finiteOrNull(values[path]) : null;

const apply = (op: string, left: number, right: number): number | null => {
  switch (op) {
    case 'add':
      return left + right;
    case 'subtract':
      return left - right;
    case 'multiply':
      return left * right;
    case 'divide':
      // Includes 0/0. Neither Infinity nor NaN is a figure anybody should be shown, and there is no
      // convention that makes one of them the "right" answer to a division nobody could perform.
      return right === 0 ? null : left / right;
    default:
      // Unreachable for a validated tree; an unknown operation is uncomputable, not zero.
      return null;
  }
};

const compute = (node: ExpressionNode, values: ExpressionValues, depth: number): number | null => {
  // A validated expression cannot reach this, but evaluation accepts unvalidated trees and must
  // stay total: the budget is what makes "never throws" true without trusting the caller.
  if (depth > EXPRESSION_MAX_DEPTH) return null;

  switch (node.kind) {
    case 'literal':
      return finiteOrNull(node.value);
    case 'field':
      return numberAt(values, node.path);
    case 'unary': {
      const operand = compute(node.operand, values, depth + 1);
      return operand === null ? null : -operand;
    }
    case 'binary': {
      const left = compute(node.left, values, depth + 1);
      if (left === null) return null;
      const right = compute(node.right, values, depth + 1);
      if (right === null) return null;
      const result = apply(node.op, left, right);
      // Overflow to ±Infinity is not an answer either — a result must be a number that can be
      // written down. Magnitude beyond that is the caller's business (D-EXPR-15 = A).
      return result === null ? null : finiteOrNull(result);
    }
    default:
      return null;
  }
};

/**
 * The value of an expression over one row of values, or `null` when it cannot be computed.
 *
 * `null` PROPAGATES: one unknown input makes the whole result unknown, because there is no
 * fallback operator to recover from it (`coalesce` is a conditional, and conditionals are not in
 * this language). That is the intended behaviour, and it has a consequence worth stating plainly —
 * a single missing field empties the whole calculated field rather than distorting it.
 *
 * The `catch` is the last line of defence, not a routine path: nothing above is expected to throw,
 * and if something does, the answer this engine is allowed to give is still `null`.
 */
export const evaluateExpression = (node: ExpressionNode, values: ExpressionValues): number | null => {
  try {
    return compute(node, values, 1);
  } catch {
    return null;
  }
};
