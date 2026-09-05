// Index drift: a schema declares an index one way, the database still holds it another.
//
// Mongoose creates an index that is missing and leaves alone one that exists under the same name —
// it never REWRITES one. So every time a declaration changes after it has shipped (a `unique`
// added or removed, a `partialFilterExpression` added), every database built before the change
// keeps enforcing the old shape, silently, forever. Three go-live outages came from exactly this:
// `hr_job_offers.ux_code`, then `hr_employees.ux_offer`, each a unique index that the schema had
// since made partial and the database had not.
//
// The cure each time was a hand-written migration that looked for one index by one name. That is
// the wrong altitude: the property that matters is "the live index has the options the schema
// declares", and it can be checked for every declared index at once.
//
// WHAT THIS DOES NOT DO. It never drops an index the schema does not declare — a hand-built index
// on a production database is somebody's decision, not drift. And it only compares the options
// that change enforcement (`unique`, `partialFilterExpression`); a differing `background` flag or
// collation is not a reason to rebuild a large index on a live system.
//
// The decision is a pure function so it can be tested without a database; the I/O half is small.
import { type Model } from 'mongoose';
import { logger } from '../../infrastructure/logging/logger';

/** The subset of an index descriptor this comparison reads, live or declared. */
export interface IndexShape {
  name?: string | undefined;
  key: Record<string, unknown>;
  unique?: boolean | undefined;
  partialFilterExpression?: unknown;
}

export interface Drift {
  /** The LIVE index to drop — by its live name, which may differ from the declared one. */
  drop: string;
  /** The declared name it will be rebuilt as. */
  declared: string;
  why: string;
}

/** JSON with object keys sorted at every level, so two equal filters stringify identically. */
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

/** Key order is significant for a compound index, so this is NOT sorted. */
const keyShape = (key: Record<string, unknown>): string => JSON.stringify(key);

const enforcement = (ix: IndexShape): string =>
  `unique=${ix.unique === true}|partial=${stable(ix.partialFilterExpression ?? null)}`;

/**
 * Which live indexes must be dropped so the declared shape can be rebuilt.
 *
 * A declared index is matched to a live one by NAME first and by KEY SHAPE second. The second
 * match is what catches a rename: an index built before the schema named it carries Mongo's
 * default (`jobOfferId_1`), and matching by name alone walks straight past it — which is how the
 * `employeeNumber` migration missed its own target.
 */
export const findDrift = (declared: readonly IndexShape[], live: readonly IndexShape[]): Drift[] => {
  const drifts: Drift[] = [];
  for (const want of declared) {
    if (want.name === undefined) continue; // an unnamed declaration cannot be reasoned about safely
    const have =
      live.find((ix) => ix.name === want.name) ??
      live.find((ix) => ix.name !== '_id_' && keyShape(ix.key) === keyShape(want.key));
    if (have === undefined || have.name === undefined) continue; // missing: createIndexes builds it
    if (enforcement(have) === enforcement(want)) continue;
    drifts.push({
      drop: have.name,
      declared: want.name,
      why:
        `live ${have.name} is ${enforcement(have)}; the schema declares ${want.name} as ` +
        enforcement(want),
    });
  }
  return drifts;
};

/** What the schema declares, in the shape `findDrift` compares. */
const declaredIndexes = (model: Model<unknown>): IndexShape[] =>
  model.schema.indexes().map(([key, options]) => {
    const o = options as { name?: string; unique?: boolean; partialFilterExpression?: unknown };
    return {
      name: o.name,
      key: key as Record<string, unknown>,
      unique: o.unique,
      partialFilterExpression: o.partialFilterExpression,
    };
  });

/**
 * Bring a collection's indexes back to what its schema declares. Idempotent: the second run finds
 * no drift and touches nothing.
 *
 * Every drift seen so far LOOSENS a constraint (plain unique → partial unique), so the rebuild
 * cannot fail on existing data. A drift that tightens one could, and then the collection would be
 * left without that index — so a failed rebuild is logged as an error, never swallowed.
 */
export const reconcileDeclaredIndexes = async (model: Model<unknown>): Promise<Drift[]> => {
  const collection = model.collection.collectionName;
  try {
    const live = (await model.collection.indexes()) as unknown as IndexShape[];
    const drifts = findDrift(declaredIndexes(model), live);
    if (drifts.length === 0) return [];
    for (const d of drifts) {
      await model.collection.dropIndex(d.drop);
      logger.info({ collection, ...d }, 'index drift: live index dropped for rebuild');
    }
    await model.createIndexes();
    logger.info({ collection, rebuilt: drifts.map((d) => d.declared) }, 'index drift: rebuilt');
    return drifts;
  } catch (error) {
    logger.error({ err: error, collection }, 'index drift: reconciliation failed — check the indexes');
    return [];
  }
};
