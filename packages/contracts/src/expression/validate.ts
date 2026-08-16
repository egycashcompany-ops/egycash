// Save-time validation (P-HR-24).
//
// The system already separates these two questions, and this file is the first half: `filter-eval`
// distinguishes save-time validation ("the shape a human typed") from run-time evaluation ("the
// data that arrived"), and A-3 refuses a filter on an undeclared field before it is ever stored.
// The same split applies here — `validateExpression` decides whether an expression may EXIST, and
// `evaluateExpression` never re-asks any of it.
//
// THE ORDER OF THE THREE STAGES IS A SAFETY PROPERTY, NOT A STYLE:
//
//   1. SIZE, measured on the serialization, before anything recursive touches the value. This is
//      the only check that can run first, and it is what makes the next stage safe: the schema is
//      recursive, so a deep enough tree would exhaust the stack inside `safeParse` — before any
//      depth limit could be consulted. Bounding the bytes bounds the nesting.
//   2. SHAPE, via the schema. Nothing can be walked until it is known to be a tree of nodes.
//   3. THE WALK — depth, node count, and every field reference against the catalog.
//
// Stages 1 and 2 stop on failure because continuing would mean walking something whose shape is
// unknown. WITHIN stage 3, every problem is collected: an author fixing one undeclared field at a
// time, learning of the next only after saving, is the experience `pages.spec.ts` refuses for the
// page registry, and it is refused here for the same reason.
import {
  EXPRESSION_MAX_DEPTH,
  EXPRESSION_MAX_NODES,
  EXPRESSION_MAX_SIZE_BYTES,
  ExpressionNodeSchema,
  type ExpressionNode,
} from './ast.js';
import { catalogHasField, type ExpressionFieldCatalog } from './field-catalog.js';

export const EXPRESSION_ISSUE_CODES = [
  'size',
  'shape',
  'depth',
  'nodeCount',
  'unknownField',
] as const;
export type ExpressionIssueCode = (typeof EXPRESSION_ISSUE_CODES)[number];

export interface ExpressionIssue {
  code: ExpressionIssueCode;
  /** Dot path INSIDE the expression tree (`binary.left.operand`); empty string is the root. */
  path: string;
  message: string;
}

export type ExpressionValidation =
  | { valid: true; node: ExpressionNode; issues: readonly ExpressionIssue[] }
  | { valid: false; node: null; issues: readonly ExpressionIssue[] };

const failure = (issues: ExpressionIssue[]): ExpressionValidation => ({
  valid: false,
  node: null,
  issues,
});

/**
 * UTF-8 byte length.
 *
 * The character count is compared first because UTF-8 never encodes a string in fewer bytes than
 * it has UTF-16 code units — so an over-long string is rejected without allocating an encoding of
 * it, and a hostile megabyte never becomes a megabyte of `Uint8Array`.
 */
const withinByteLimit = (text: string): boolean =>
  text.length <= EXPRESSION_MAX_SIZE_BYTES &&
  new TextEncoder().encode(text).length <= EXPRESSION_MAX_SIZE_BYTES;

/**
 * Whether the serialized form is small enough.
 *
 * `JSON.stringify` is the first thing to touch an untrusted value, so it is the first thing that
 * can throw: a circular reference, a `BigInt`, or a structure deep enough to exhaust the stack all
 * fail here. Each of those is a size-class refusal, and none of them is a crash.
 */
const serializedWithinLimit = (input: unknown): boolean => {
  try {
    const text = JSON.stringify(input);
    return text !== undefined && withinByteLimit(text);
  } catch {
    return false;
  }
};

interface Frame {
  node: ExpressionNode;
  depth: number;
  path: string;
}

const child = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`);

/**
 * Depth, node count and field references, in one iterative pass.
 *
 * ITERATIVE, with an explicit stack, rather than recursive: the input has been shape-checked but it
 * is still a stranger's data, and a validator that could overflow the stack while enforcing a depth
 * limit would be defeating itself.
 */
const walk = (node: ExpressionNode, catalog: ExpressionFieldCatalog): ExpressionIssue[] => {
  const issues: ExpressionIssue[] = [];
  const stack: Frame[] = [{ node, depth: 1, path: '' }];
  let nodes = 0;
  let depthReported = false;

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    nodes += 1;

    if (frame.depth > EXPRESSION_MAX_DEPTH) {
      // Reported once, and this branch is not descended into: the depth is already established, and
      // every node below it would repeat the same finding.
      if (!depthReported) {
        depthReported = true;
        issues.push({
          code: 'depth',
          path: frame.path,
          message: `expression nests deeper than ${String(EXPRESSION_MAX_DEPTH)} levels`,
        });
      }
      continue;
    }

    switch (frame.node.kind) {
      case 'field':
        if (!catalogHasField(catalog, frame.node.path)) {
          issues.push({
            code: 'unknownField',
            path: frame.path,
            message: `"${frame.node.path}" is not a field of ${catalog.sourceId}`,
          });
        }
        break;
      case 'unary':
        stack.push({
          node: frame.node.operand,
          depth: frame.depth + 1,
          path: child(frame.path, 'operand'),
        });
        break;
      case 'binary':
        stack.push({
          node: frame.node.left,
          depth: frame.depth + 1,
          path: child(frame.path, 'left'),
        });
        stack.push({
          node: frame.node.right,
          depth: frame.depth + 1,
          path: child(frame.path, 'right'),
        });
        break;
      default:
        // A literal carries nothing to check beyond the shape the schema already enforced.
        break;
    }
  }

  if (nodes > EXPRESSION_MAX_NODES) {
    issues.push({
      code: 'nodeCount',
      path: '',
      message: `expression has ${String(nodes)} nodes, more than the ${String(EXPRESSION_MAX_NODES)} allowed`,
    });
  }

  return issues;
};

/**
 * May this expression exist, against this catalog?
 *
 * Takes `unknown` because the caller's value came off a wire and has been through nothing but a
 * JSON reader. There is no string overload and no text form: an expression is authored as a
 * structure (D-EXPR-3 = A), and no entry point here turns text into a tree.
 */
export const validateExpression = (
  input: unknown,
  catalog: ExpressionFieldCatalog,
): ExpressionValidation => {
  if (!serializedWithinLimit(input)) {
    return failure([
      {
        code: 'size',
        path: '',
        message: `expression exceeds ${String(EXPRESSION_MAX_SIZE_BYTES)} bytes, or cannot be serialized`,
      },
    ]);
  }

  const parsed = ExpressionNodeSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      parsed.error.issues.map((issue) => ({
        code: 'shape' as const,
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  const issues = walk(parsed.data, catalog);
  return issues.length === 0
    ? { valid: true, node: parsed.data, issues: [] }
    : failure(issues);
};
