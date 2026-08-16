import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EVENT_CATALOG,
  FLEET_EVENT_PAYLOAD_SCHEMAS,
  HR_EVENT_PAYLOAD_SCHEMAS,
  IT_EVENT_PAYLOAD_SCHEMAS,
  PLATFORM_EVENT_PAYLOAD_SCHEMAS,
} from '../events/catalog.js';
import {
  EXPRESSION_AST_VERSION,
  EXPRESSION_BINARY_OPS,
  EXPRESSION_MAX_DEPTH,
  EXPRESSION_MAX_NODES,
  EXPRESSION_MAX_SIZE_BYTES,
  EXPRESSION_NODE_KINDS,
  EXPRESSION_UNARY_OPS,
  catalogHasField,
  evaluateExpression,
  expressionCatalogFromSchema,
  validateExpression,
  type ExpressionFieldCatalog,
  type ExpressionNode,
} from './index.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const catalog: ExpressionFieldCatalog = {
  sourceId: 'test.row',
  fields: [
    { path: 'earnings', type: 'number', nullable: false },
    { path: 'deductions', type: 'number', nullable: false },
    { path: 'days', type: 'number', nullable: true },
  ],
};

const lit = (value: number): ExpressionNode => ({ kind: 'literal', value });
const field = (path: string): ExpressionNode => ({ kind: 'field', path });
const add = (left: ExpressionNode, right: ExpressionNode): ExpressionNode => ({
  kind: 'binary',
  op: 'add',
  left,
  right,
});
const divide = (left: ExpressionNode, right: ExpressionNode): ExpressionNode => ({
  kind: 'binary',
  op: 'divide',
  left,
  right,
});

/** A chain of `negate` wrappers around a literal — `nest(n)` has depth n and n nodes. */
const nest = (levels: number): ExpressionNode =>
  levels <= 1 ? lit(1) : { kind: 'unary', op: 'negate', operand: nest(levels - 1) };

/** A full binary tree of the given depth: 2^depth − 1 nodes, every leaf a literal. */
const fullTree = (depth: number): ExpressionNode =>
  depth <= 1 ? lit(1) : add(fullTree(depth - 1), fullTree(depth - 1));

const bytesOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

const codes = (input: unknown): string[] =>
  validateExpression(input, catalog).issues.map((issue) => issue.code);

// ── The closed vocabularies ─────────────────────────────────────────────────

describe('the language is exactly this large and no larger', () => {
  it('has four node kinds, four binary operations and one unary operation', () => {
    expect([...EXPRESSION_NODE_KINDS]).toEqual(['literal', 'field', 'unary', 'binary']);
    expect([...EXPRESSION_BINARY_OPS]).toEqual(['add', 'subtract', 'multiply', 'divide']);
    expect([...EXPRESSION_UNARY_OPS]).toEqual(['negate']);
  });

  it('declares the version a stored expression will carry', () => {
    expect(EXPRESSION_AST_VERSION).toBe(1);
  });
});

// ── Shape ───────────────────────────────────────────────────────────────────

describe('shape', () => {
  it('accepts every node kind', () => {
    expect(validateExpression(lit(5), catalog).valid).toBe(true);
    expect(validateExpression(field('earnings'), catalog).valid).toBe(true);
    expect(validateExpression({ kind: 'unary', op: 'negate', operand: lit(1) }, catalog).valid).toBe(
      true,
    );
    expect(validateExpression(add(field('earnings'), lit(2)), catalog).valid).toBe(true);
  });

  it('returns the parsed node when it is valid, so a caller need not re-parse', () => {
    const result = validateExpression(add(field('earnings'), lit(2)), catalog);
    expect(result.valid).toBe(true);
    expect(result.node).toEqual(add(field('earnings'), lit(2)));
  });

  it('refuses an unknown kind, an unknown operation and a non-finite literal', () => {
    expect(codes({ kind: 'power', left: lit(2), right: lit(3) })).toEqual(['shape']);
    expect(codes({ kind: 'binary', op: 'modulo', left: lit(2), right: lit(3) })).toEqual(['shape']);
    // The size stage serializes these happily (JSON turns them into `null`), and the SHAPE stage
    // then sees the real values on the original object and refuses them — which is the point:
    // validation reads what the caller passed, not a round-trip of it.
    expect(codes({ kind: 'literal', value: Number.POSITIVE_INFINITY })).toEqual(['shape']);
    expect(codes({ kind: 'literal', value: Number.NaN })).toEqual(['shape']);
  });

  it('refuses a stray key rather than ignoring it', () => {
    expect(codes({ kind: 'literal', value: 1, fn: 'require' })).toEqual(['shape']);
    expect(codes({ kind: 'field', path: 'earnings', $function: 'x' })).toEqual(['shape']);
  });

  it('refuses the shapes that are not nodes at all', () => {
    for (const input of [null, undefined, 5, 'earnings', [], {}, { kind: 'literal' }]) {
      expect(validateExpression(input, catalog).valid, JSON.stringify(input) ?? 'undefined').toBe(
        false,
      );
    }
  });

  it('reports every shape problem in one pass', () => {
    // Both operands are wrong; an author should learn about both from one save.
    const result = validateExpression({ kind: 'binary', op: 'add', left: 1, right: 2 }, catalog);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(1);
  });
});

// ── The hard limits ─────────────────────────────────────────────────────────

describe('the hard limits', () => {
  it('accepts an expression exactly at the depth limit and refuses one past it', () => {
    expect(validateExpression(nest(EXPRESSION_MAX_DEPTH), catalog).valid).toBe(true);
    expect(codes(nest(EXPRESSION_MAX_DEPTH + 1))).toEqual(['depth']);
  });

  it('reports the depth once, not once per node below it', () => {
    const issues = validateExpression(nest(EXPRESSION_MAX_DEPTH + 5), catalog).issues;
    expect(issues.filter((issue) => issue.code === 'depth')).toHaveLength(1);
  });

  it('refuses an expression larger than the size limit', () => {
    const big = fullTree(7); // 127 nodes
    expect(bytesOf(big)).toBeGreaterThan(EXPRESSION_MAX_SIZE_BYTES);
    expect(codes(big)).toEqual(['size']);
  });

  it('refuses a value that cannot be serialized at all', () => {
    const circular: Record<string, unknown> = { kind: 'literal', value: 1 };
    circular['self'] = circular;
    expect(codes(circular)).toEqual(['size']);
    expect(codes({ kind: 'literal', value: 1, extra: 1n })).toEqual(['size']);
  });

  it(
    'documents that the SIZE limit binds before the node limit at the current numbers — ' +
      'the node ceiling is defence in depth, and raising the size limit is what makes it live',
    () => {
      // The largest full binary tree that fits inside the size limit, found rather than assumed.
      let depth = 1;
      while (bytesOf(fullTree(depth + 1)) <= EXPRESSION_MAX_SIZE_BYTES) depth += 1;
      const largestFitting = 2 ** depth - 1;
      expect(largestFitting).toBeLessThan(EXPRESSION_MAX_NODES);
      expect(validateExpression(fullTree(depth), catalog).valid).toBe(true);
    },
  );
});

// ── The catalog is the only thing an expression may name ────────────────────

describe('field references', () => {
  it('accepts a declared field', () => {
    expect(validateExpression(field('earnings'), catalog).valid).toBe(true);
    expect(catalogHasField(catalog, 'earnings')).toBe(true);
  });

  it('refuses an undeclared field', () => {
    expect(codes(field('secret'))).toEqual(['unknownField']);
    expect(catalogHasField(catalog, 'secret')).toBe(false);
  });

  it('refuses every undeclared field in one pass, not just the first', () => {
    const result = validateExpression(add(field('secret'), field('other')), catalog);
    expect(result.issues.map((issue) => issue.code)).toEqual(['unknownField', 'unknownField']);
    expect(result.issues.map((issue) => issue.path).sort()).toEqual(['left', 'right']);
  });

  it('refuses the paths that would reach outside the row entirely', () => {
    for (const path of ['__proto__', 'constructor', 'toString', 'earnings.constructor']) {
      expect(codes(field(path)), path).toEqual(['unknownField']);
    }
  });
});

// ── Deriving a catalog from Zod ─────────────────────────────────────────────

describe('catalog derivation', () => {
  const schema = z.object({
    gross: z.number(),
    net: z.number().nullable(),
    optionalCount: z.number().optional(),
    withDefault: z.number().default(0),
    label: z.string(),
    when: z.date(),
    flag: z.boolean(),
    totals: z.object({ minor: z.number(), currency: z.string() }),
    lines: z.array(z.object({ amount: z.number() })),
  });

  const derived = expressionCatalogFromSchema('test', schema);

  it('offers every numeric leaf, nested ones by dot path', () => {
    expect(derived.fields.map((f) => f.path)).toEqual([
      'gross',
      'net',
      'optionalCount',
      'totals.minor',
      'withDefault',
    ]);
  });

  it('offers nothing that arithmetic cannot use', () => {
    const paths = derived.fields.map((f) => f.path);
    for (const absent of ['label', 'when', 'flag', 'totals.currency']) {
      expect(paths, absent).not.toContain(absent);
    }
  });

  it('never offers a path inside an array — there is no index and no aggregate to reach one', () => {
    expect(derived.fields.every((f) => !f.path.includes('['))).toBe(true);
    expect(derived.fields.map((f) => f.path)).not.toContain('lines.amount');
  });

  it('records nullability as the schema states it', () => {
    expect(derived.fields.find((f) => f.path === 'net')?.nullable).toBe(true);
    expect(derived.fields.find((f) => f.path === 'gross')?.nullable).toBe(false);
  });

  it('is sorted, so two builds of one schema are identical', () => {
    const again = expressionCatalogFromSchema('test', schema);
    expect(again).toEqual(derived);
    expect([...derived.fields].sort((a, b) => a.path.localeCompare(b.path))).toEqual(derived.fields);
  });

  it('terminates on a recursive schema instead of descending forever', () => {
    const node: z.ZodTypeAny = z.lazy(() => z.object({ value: z.number(), next: node }));
    expect(() => expressionCatalogFromSchema('recursive', node)).not.toThrow();
  });
});

// ── The drift test: this derivation and the event catalogue's must agree ────

describe('the two Zod derivations agree (D-EXPR-11 = C)', () => {
  const schemasByName: Record<string, z.ZodTypeAny | null> = {
    ...PLATFORM_EVENT_PAYLOAD_SCHEMAS,
    ...HR_EVENT_PAYLOAD_SCHEMAS,
    ...FLEET_EVENT_PAYLOAD_SCHEMAS,
    ...IT_EVENT_PAYLOAD_SCHEMAS,
  };

  it('produces exactly the numeric fields `describeField` reports, over the whole real catalogue', () => {
    let compared = 0;

    for (const entry of EVENT_CATALOG) {
      const schema = schemasByName[entry.name];
      if (schema === null || schema === undefined) continue;

      // Array element paths are excluded on BOTH sides: the event catalogue offers `items[].n` for
      // filtering, and this engine deliberately does not offer it at all (see `field-catalog.ts`).
      const expected = entry.fields
        .filter((f) => f.type === 'number' && !f.path.includes('['))
        .map((f) => ({ path: f.path, nullable: f.nullable }))
        .sort((a, b) => a.path.localeCompare(b.path));

      const actual = expressionCatalogFromSchema(entry.name, schema).fields.map((f) => ({
        path: f.path,
        nullable: f.nullable,
      }));

      expect(actual, entry.name).toEqual(expected);
      compared += expected.length;
    }

    // Not a vacuous pass: the catalogue really does carry numeric fields, and this asserts it.
    expect(compared).toBeGreaterThan(50);
  });
});

// ── Evaluation ──────────────────────────────────────────────────────────────

describe('evaluation', () => {
  const values = { earnings: 1000, deductions: 250, days: 30 };

  it('computes the four operations', () => {
    expect(evaluateExpression(add(field('earnings'), lit(5)), values)).toBe(1005);
    expect(
      evaluateExpression({ kind: 'binary', op: 'subtract', left: field('earnings'), right: field('deductions') }, values),
    ).toBe(750);
    expect(
      evaluateExpression({ kind: 'binary', op: 'multiply', left: field('days'), right: lit(2) }, values),
    ).toBe(60);
    expect(evaluateExpression(divide(field('earnings'), field('days')), values)).toBeCloseTo(33.333, 3);
  });

  it('negates', () => {
    expect(evaluateExpression({ kind: 'unary', op: 'negate', operand: field('earnings') }, values)).toBe(
      -1000,
    );
  });

  it('answers null for an absent field, and never zero', () => {
    expect(evaluateExpression(field('missing'), values)).toBeNull();
    expect(evaluateExpression(add(field('missing'), lit(5)), values)).toBeNull();
  });

  it('answers null for a value that is not a finite number, without coercing it', () => {
    for (const bad of ['12', true, null, undefined, {}, [], Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(evaluateExpression(field('x'), { x: bad }), String(bad)).toBeNull();
    }
  });

  it('answers null for division by zero, including 0 / 0', () => {
    expect(evaluateExpression(divide(lit(1), lit(0)), values)).toBeNull();
    expect(evaluateExpression(divide(lit(0), lit(0)), values)).toBeNull();
    expect(evaluateExpression(divide(field('earnings'), field('zero')), { ...values, zero: 0 })).toBeNull();
  });

  it('answers null when the result overflows to infinity', () => {
    expect(
      evaluateExpression({ kind: 'binary', op: 'multiply', left: lit(1e308), right: lit(10) }, values),
    ).toBeNull();
  });

  it('propagates null through every position', () => {
    expect(evaluateExpression(add(lit(1), field('missing')), values)).toBeNull();
    expect(evaluateExpression(add(field('missing'), lit(1)), values)).toBeNull();
    expect(
      evaluateExpression({ kind: 'unary', op: 'negate', operand: field('missing') }, values),
    ).toBeNull();
    expect(evaluateExpression(add(add(field('missing'), lit(1)), lit(2)), values)).toBeNull();
  });

  it('reads own properties only, so nothing inherited presents itself as a field', () => {
    expect(evaluateExpression(field('toString'), values)).toBeNull();
    expect(evaluateExpression(field('constructor'), values)).toBeNull();
  });

  it('is deterministic', () => {
    const expression = divide(add(field('earnings'), field('deductions')), field('days'));
    const first = evaluateExpression(expression, values);
    for (let i = 0; i < 50; i += 1) expect(evaluateExpression(expression, values)).toBe(first);
  });

  it('never throws, whatever it is handed', () => {
    const hostile: unknown[] = [
      null,
      undefined,
      5,
      'x',
      {},
      { kind: 'literal' },
      { kind: 'binary', op: 'add' },
      { kind: 'binary', op: 'unknownOp', left: lit(1), right: lit(1) },
      { kind: 'unary', op: 'negate' },
      nest(EXPRESSION_MAX_DEPTH + 40),
    ];
    for (const input of hostile) {
      expect(() => evaluateExpression(input as ExpressionNode, values)).not.toThrow();
      expect(evaluateExpression(input as ExpressionNode, values)).toBeNull();
    }
  });

  it('stops at the depth budget rather than the stack, on a tree nobody validated', () => {
    // `nest(n)` wraps `1` in n−1 negations, so an odd count of wrappers gives −1 and an even one 1.
    expect(evaluateExpression(nest(2), {})).toBe(-1);
    expect(evaluateExpression(nest(3), {})).toBe(1);
    expect(evaluateExpression(nest(EXPRESSION_MAX_DEPTH), {})).not.toBeNull();
    expect(evaluateExpression(nest(EXPRESSION_MAX_DEPTH + 1), {})).toBeNull();
  });
});
