// The shape a calculated field is allowed to have (P-HR-24 / D-EXPR-3 = A).
//
// WHY THIS IS DATA AND NOT TEXT. ADR-011 refuses arbitrary code in definitions, and the automation
// filter form (`AutomationFilterSchema`) already established the alternative: a condition is a
// DESCRIBED STRUCTURE, never a string somebody executes. This file is the arithmetic counterpart of
// that decision. There is no parser here, and no entry point that turns text into a tree — an
// expression arrives as JSON that was already parsed by the same JSON reader every request uses.
//
// WHY THE OPERATIONS ARE NAMED AND NOT SYMBOLS. `'add'` rather than `'+'`. A symbol alphabet invites
// somebody to write the small tokenizer that reads `a + b`, and the day that exists this stops being
// a restricted form. A name invites nothing, and `z.enum` refuses `'%'` and `'**'` by construction
// rather than by a regular expression somebody has to get right.
//
// WHAT IS DELIBERATELY ABSENT, EACH BY DECISION:
//   • variables, function calls, conditionals, loops, recursion — D-EXPR-3/owner constraint;
//   • `round`, `abs`, `min`, `max` — D-EXPR-12 = A. Rounding in particular belongs to the CALLER:
//     `hr-payroll-money.ts` states that it defines what one rounding step does, never when to take
//     one, and an engine that rounded would be taking that decision for payroll;
//   • comparisons and boolean logic — that is the filter form's job, and D-EXPR-1 = B keeps the two
//     apart rather than merging them;
//   • aggregation (`sum`, `count`) — grouping is a report question, not an expression question.
import { z } from 'zod';

/**
 * The stored shape's version.
 *
 * Phase 3 persists nothing, so nothing reads this yet. It exists because Phase 4 WILL store
 * expressions, and a stored definition without a version is a migration waiting to be written —
 * one exported integer now is cheaper than that later (D-EXPR-13 = A).
 */
export const EXPRESSION_AST_VERSION = 1;

// ── The closed vocabularies ─────────────────────────────────────────────────

export const EXPRESSION_NODE_KINDS = ['literal', 'field', 'unary', 'binary'] as const;
export type ExpressionNodeKind = (typeof EXPRESSION_NODE_KINDS)[number];

export const EXPRESSION_UNARY_OPS = ['negate'] as const;
export type ExpressionUnaryOp = (typeof EXPRESSION_UNARY_OPS)[number];

export const EXPRESSION_BINARY_OPS = ['add', 'subtract', 'multiply', 'divide'] as const;
export type ExpressionBinaryOp = (typeof EXPRESSION_BINARY_OPS)[number];

export const ExpressionUnaryOpSchema = z.enum(EXPRESSION_UNARY_OPS);
export const ExpressionBinaryOpSchema = z.enum(EXPRESSION_BINARY_OPS);

// ── The hard limits (D-EXPR-9 / D-EXPR-14 = A) ──────────────────────────────
//
// Every one of these is a number in the contract rather than a comment about good taste, for the
// same reason `.max(20)` sits on the automation filter list and `.max(50)` on a job's shift ids:
// a limit that is not in the schema is a limit nobody enforces.
//
// RAISING any of them later is safe. LOWERING one invalidates expressions somebody already saved,
// which is why they are set with room rather than tight.

/**
 * Size of the JSON serialization, in UTF-8 bytes.
 *
 * This is the FIRST check and the only one that runs before anything recursive touches the value,
 * which is what makes it the load-bearing one: `ExpressionNodeSchema` is recursive, and a
 * sufficiently deep tree would exhaust the stack DURING parsing, before any depth check could
 * speak. At 4 KB the deepest possible nesting is roughly ninety levels — far inside any engine's
 * stack, and comfortably above the twelve a real calculated field needs.
 */
export const EXPRESSION_MAX_SIZE_BYTES = 4096;

/** Nesting depth. A calculated field written by a person rarely passes four. */
export const EXPRESSION_MAX_DEPTH = 12;

/** Total nodes — the width limit that depth alone does not give. */
export const EXPRESSION_MAX_NODES = 128;

/** Field path length. The same 200 the automation filter uses; a shared number, not a new one. */
export const EXPRESSION_MAX_FIELD_PATH = 200;

// ── The nodes ───────────────────────────────────────────────────────────────

/** A constant. Finite only: `NaN` and `Infinity` are not values anybody meant to write. */
export interface ExpressionLiteralNode {
  kind: 'literal';
  value: number;
}

/**
 * A reference to a declared field.
 *
 * `path` is a dot path into a `ExpressionFieldCatalog`, and validation refuses one the catalog does
 * not list (D-EXPR-6 = A). Free paths are how an expression becomes a way to read what the caller
 * was never granted, so the catalog is not advisory.
 */
export interface ExpressionFieldNode {
  kind: 'field';
  path: string;
}

export interface ExpressionUnaryNode {
  kind: 'unary';
  op: ExpressionUnaryOp;
  operand: ExpressionNode;
}

export interface ExpressionBinaryNode {
  kind: 'binary';
  op: ExpressionBinaryOp;
  left: ExpressionNode;
  right: ExpressionNode;
}

export type ExpressionNode =
  | ExpressionLiteralNode
  | ExpressionFieldNode
  | ExpressionUnaryNode
  | ExpressionBinaryNode;

/**
 * The recursive schema.
 *
 * `z.lazy` is what allows a node to contain a node; the explicit `z.ZodType<ExpressionNode>`
 * annotation is what stops TypeScript trying to infer a type that refers to itself. Every object is
 * `.strict()`, so an unknown key is a rejection rather than a field quietly ignored — a tree with a
 * stray `"fn"` on it must not parse as if it were clean.
 *
 * This schema checks SHAPE ONLY. Depth, node count and whether a field exists are enforced by
 * `validateExpression`, because a Zod schema cannot count what it is in the middle of parsing.
 */
export const ExpressionNodeSchema: z.ZodType<ExpressionNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('literal'),
        value: z.number().finite(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('field'),
        path: z.string().min(1).max(EXPRESSION_MAX_FIELD_PATH),
      })
      .strict(),
    z
      .object({
        kind: z.literal('unary'),
        op: ExpressionUnaryOpSchema,
        operand: ExpressionNodeSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('binary'),
        op: ExpressionBinaryOpSchema,
        left: ExpressionNodeSchema,
        right: ExpressionNodeSchema,
      })
      .strict(),
  ]),
);
