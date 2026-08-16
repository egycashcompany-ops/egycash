// What an expression is allowed to name (P-HR-24 / D-EXPR-6 = A).
//
// An expression that could reference any dot path would be a way to read whatever the process can
// reach, and it would look like a reporting feature rather than like the access-control hole it is.
// So a reference is legal only when a DECLARED catalog lists it, and the catalog is derived from
// the same Zod schema the data already validates against — a hand-written field list would drift
// from the shape on the first rename, silently.
//
// WHY THIS DERIVATION IS SEPARATE FROM THE EVENT CATALOG'S (D-EXPR-11 = C). `events/catalog.ts`
// contains `describeField()`, which does the same walk for a different consumer — but it is not
// exported, it produces nine field types this engine has no use for, and the event catalogue serves
// a live ETag (`event-catalog.routes.ts`). Reaching into it would mean editing a file on a
// published surface to serve a phase that ships no surface at all. So the walk is written here,
// narrowly, and `expression-guards.spec.ts` holds the two derivations to the SAME ANSWER over the
// entire real event catalogue — 69 numeric fields across 155 declared events. Drift is not
// prevented by discipline here; it is prevented by a test that reads both.
//
// NUMBERS ONLY, IN THIS PHASE. `EXPRESSION_FIELD_TYPES` has one member. Arithmetic over a string or
// a date is not an operation this engine has, so offering such a field would be offering something
// that can only ever evaluate to null.
import type { z } from 'zod';
import { EXPRESSION_MAX_DEPTH } from './ast.js';

export const EXPRESSION_FIELD_TYPES = ['number'] as const;
export type ExpressionFieldType = (typeof EXPRESSION_FIELD_TYPES)[number];

export interface ExpressionField {
  /** Dot path from the root of the source shape, e.g. `totals.netMinor`. */
  path: string;
  type: ExpressionFieldType;
  /**
   * The schema allows null here.
   *
   * Advisory, not a restriction: evaluation answers `null` for an absent or non-numeric value
   * regardless. It exists so an authoring screen can warn that a formula WILL come out empty
   * whenever this field is null, before somebody saves it and wonders.
   */
  nullable: boolean;
}

export interface ExpressionFieldCatalog {
  /** Names the shape these fields belong to. Opaque to the engine. */
  sourceId: string;
  fields: readonly ExpressionField[];
}

// ── Zod introspection ───────────────────────────────────────────────────────
//
// Zod does not publish a reflection API, so this reads `_def` exactly as the event catalogue does.
// The wrappers peeled below are the SAME six that `describeField()` peels — matching it is the
// whole point, and the guard spec proves the match rather than trusting this comment.

interface ZodDefLike {
  typeName?: string;
  innerType?: z.ZodTypeAny;
  schema?: z.ZodTypeAny;
  type?: z.ZodTypeAny;
}

const defOf = (schema: z.ZodTypeAny): ZodDefLike => schema._def as unknown as ZodDefLike;

/** Peel the wrappers that carry no shape of their own, remembering only what this engine uses. */
const unwrap = (schema: z.ZodTypeAny): { inner: z.ZodTypeAny; nullable: boolean } => {
  let inner = schema;
  let nullable = false;

  // A bounded loop rather than `while (true)`: a malformed or exotic schema must not spin here.
  for (let guard = 0; guard < 20; guard += 1) {
    const def = defOf(inner);
    switch (def.typeName) {
      case 'ZodOptional':
      case 'ZodDefault':
      case 'ZodCatch':
      case 'ZodReadonly':
        if (def.innerType === undefined) return { inner, nullable };
        inner = def.innerType;
        break;
      case 'ZodNullable':
        nullable = true;
        if (def.innerType === undefined) return { inner, nullable };
        inner = def.innerType;
        break;
      case 'ZodEffects':
        if (def.schema === undefined) return { inner, nullable };
        inner = def.schema;
        break;
      default:
        return { inner, nullable };
    }
  }
  return { inner, nullable };
};

const shapeOf = (schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> =>
  (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;

/**
 * Every numeric leaf, as a dot path.
 *
 * THREE THINGS ARE SKIPPED, EACH ON PURPOSE:
 *   • arrays — addressing an element needs an index or an aggregate, and this engine has neither.
 *     A numeric field inside an array is therefore not offered rather than offered and unusable;
 *   • `z.lazy` — a recursive schema has no finite field list, and descending into one is how a
 *     catalog build hangs;
 *   • everything that is not a number — see the header.
 *
 * `ZodBigInt` is NOT treated as numeric even though the event catalogue reports it as `number`:
 * a bigint is not a JavaScript number, so it could only ever evaluate to null. No contract uses one
 * today (verified: zero occurrences), so the two derivations still agree on every real field.
 */
const numericLeaves = (
  schema: z.ZodTypeAny,
  path: string,
  depth: number,
  out: ExpressionField[],
): void => {
  if (depth > EXPRESSION_MAX_DEPTH) return;
  const { inner, nullable } = unwrap(schema);
  const typeName = defOf(inner).typeName;

  if (typeName === 'ZodNumber') {
    if (path !== '') out.push({ path, type: 'number', nullable });
    return;
  }

  if (typeName === 'ZodObject') {
    for (const [key, child] of Object.entries(shapeOf(inner))) {
      numericLeaves(child, path === '' ? key : `${path}.${key}`, depth + 1, out);
    }
  }
};

/**
 * The catalog for one shape.
 *
 * Sorted by path so two builds of the same schema are byte-identical — a catalog that reordered
 * itself between runs would make every snapshot of it a false change.
 */
export const expressionCatalogFromSchema = (
  sourceId: string,
  schema: z.ZodTypeAny,
): ExpressionFieldCatalog => {
  const fields: ExpressionField[] = [];
  numericLeaves(schema, '', 0, fields);
  fields.sort((a, b) => a.path.localeCompare(b.path));
  return { sourceId, fields };
};

/** Whether a path may be referenced. The only question `validateExpression` asks the catalog. */
export const catalogHasField = (catalog: ExpressionFieldCatalog, path: string): boolean =>
  catalog.fields.some((field) => field.path === path);
