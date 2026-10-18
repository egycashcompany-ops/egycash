// Building every index the schemas declare — the deploy step ADR-005 ("indexes are code") and the
// database design §1 promise, for the whole platform at once.
//
// `autoIndex` is off in production (infrastructure/database/mongo.ts), so production gets only the
// indexes some explicit builder creates: Fleet's, ATM's, the org catalog's, delegations', and the
// drift repairs for users, job offers and employees. Everything else — HR, platform, gold, IT,
// operations, automation — was never built. A production-mode boot on an empty database builds 264
// of the 642 indexes a development boot builds; `sessions` gets neither its lookups nor its TTL, so
// expired sessions are never removed; `users` and `hr_employees` get none of their uniques; and
// 168 of 169 collections sort their default list with no index behind it.
//
// SAME DISCIPLINE AS fleet-indexes.ts, which this generalises:
//   - definitions are READ FROM THE SCHEMAS (`indexBuildPlan`), never restated;
//   - ONE INDEX AT A TIME, so a violation in one unique index costs exactly that index;
//   - duplicates are REPORTED, NEVER RESOLVED, and the unique index is simply not built;
//   - NOTHING IS DROPPED — an index on the server the schemas do not declare is somebody's decision.
//
// TWO MODES. `report` (the default) builds nothing: it lists what is missing, which unique indexes
// existing rows would violate, and how many documents a new TTL index would remove the moment it
// exists — so the first run against a live database is a read an operator can review. `apply`
// builds what the report listed.
//
// THE REPORT CARRIES NO FIELD VALUES. It is written to the deploy log, and the duplicate key of a
// unique index on `users.email` or `hr_employees.personal.nationalId` is personal data. It names
// collections, indexes, counts and document ids — enough to find the rows, nothing more.
import mongoose, { type Model } from 'mongoose';
import { indexBuildPlan, indexNameOf, type IndexPlanEntry } from './index-plan';

export type IndexSyncMode = 'report' | 'apply';

/** `--apply` on the command line, or `INDEX_SYNC_MODE=apply`; anything else only reports. */
export const indexSyncModeFrom = (argv: readonly string[], configured: string): IndexSyncMode =>
  argv.includes('--apply') || configured === 'apply' ? 'apply' : 'report';

export interface MissingIndex {
  collection: string;
  index: string;
  unique: boolean;
  /** Set for a TTL index: its expiry, and how many documents would go the moment it exists. */
  ttl?: { seconds: number; wouldRemoveNow: number | null };
  /** Set for a unique index existing rows violate: the number of duplicate groups seen (≤ 5). */
  duplicateGroups?: number;
  /** Up to 5 ids per duplicate group, so an operator can open the rows. Never the key values. */
  duplicateExampleIds?: string[][];
}

export interface IndexSyncReport {
  mode: IndexSyncMode;
  collections: number;
  declared: number;
  alreadyPresent: number;
  missing: MissingIndex[];
  /** `collection.index`, in apply mode only. */
  built: string[];
  failed: { collection: string; index: string; reason: string }[];
}

/**
 * Every registered model. Several can share a collection — `notification_preferences` holds both
 * the per-category preferences and the quiet hours, and each declares its own index — so this is
 * NOT one per collection: the sync walks them all and dedupes by (collection, index name).
 */
export const registeredModels = (): Model<never>[] =>
  mongoose
    .modelNames()
    .sort()
    .map((name) => mongoose.model(name) as unknown as Model<never>);

const duplicateGroups = async (
  model: Model<never>,
  keys: Record<string, unknown>,
  partialFilter: unknown,
): Promise<string[][]> => {
  const groupId: Record<string, string> = {};
  for (const field of Object.keys(keys)) groupId[field.replace(/\./g, '_')] = `$${field}`;
  const rows = await model.collection
    .aggregate<{ ids: unknown[] }>([
      { $match: (partialFilter as Record<string, unknown> | undefined) ?? {} },
      { $group: { _id: groupId, rows: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { rows: { $gt: 1 } } },
      { $limit: 5 },
      // The group key IS the duplicated value — dropped here, before anything leaves the server.
      { $project: { _id: 0, ids: { $slice: ['$ids', 5] } } },
    ])
    .toArray();
  return rows.map((row) => row.ids.map((id) => String(id)));
};

/** How many documents a TTL index on a single date field would remove as soon as it is built. */
const expiredNow = async (model: Model<never>, entry: IndexPlanEntry): Promise<number | null> => {
  const fields = Object.keys(entry.keys);
  const seconds = entry.options['expireAfterSeconds'];
  if (fields.length !== 1 || typeof seconds !== 'number') return null;
  const field = fields[0] as string;
  const cutoff = new Date(Date.now() - seconds * 1000);
  return model.collection.countDocuments({ [field]: { $lt: cutoff } });
};

const existingIndexNames = async (model: Model<never>): Promise<Set<string>> => {
  try {
    const indexes = await model.collection.listIndexes().toArray();
    return new Set(indexes.map((index) => String(index['name'])));
  } catch {
    // A collection that does not exist yet has no indexes — every declaration is missing.
    return new Set();
  }
};

/**
 * Compare every registered model's declared indexes with the server's, and in `apply` mode build
 * the missing ones. Idempotent and non-destructive in both modes; a failure on one index is
 * recorded and the sync moves on.
 */
export const syncDeclaredIndexes = async (
  mode: IndexSyncMode,
  models: Model<never>[] = registeredModels(),
): Promise<IndexSyncReport> => {
  const report: IndexSyncReport = {
    mode,
    collections: 0,
    declared: 0,
    alreadyPresent: 0,
    missing: [],
    built: [],
    failed: [],
  };

  // Read once per collection, then kept current as indexes are built, so a second model on the
  // same collection sees what the first one built.
  const presentByCollection = new Map<string, Set<string>>();
  const considered = new Set<string>();

  for (const model of models) {
    const collection = model.collection.collectionName;
    let present = presentByCollection.get(collection);
    if (present === undefined) {
      present = await existingIndexNames(model);
      presentByCollection.set(collection, present);
    }

    for (const entry of indexBuildPlan(model.schema.indexes())) {
      const index = indexNameOf(entry);
      const key = `${collection}.${index}`;
      // The same declaration reached through a second model on the collection (a discriminator
      // inherits its base's indexes) is one index, counted once.
      if (considered.has(key)) continue;
      considered.add(key);
      report.declared += 1;
      if (present.has(index)) {
        report.alreadyPresent += 1;
        continue;
      }
      const missing: MissingIndex = { collection, index, unique: entry.unique };
      try {
        if (typeof entry.options['expireAfterSeconds'] === 'number') {
          missing.ttl = {
            seconds: entry.options['expireAfterSeconds'],
            wouldRemoveNow: await expiredNow(model, entry),
          };
        }
        if (entry.unique) {
          const groups = await duplicateGroups(
            model,
            entry.keys,
            entry.options['partialFilterExpression'],
          );
          if (groups.length > 0) {
            missing.duplicateGroups = groups.length;
            missing.duplicateExampleIds = groups;
          }
        }
        report.missing.push(missing);
        if (mode === 'apply' && missing.duplicateGroups === undefined) {
          await model.collection.createIndex(entry.keys as never, entry.options as never);
          present.add(index);
          report.built.push(key);
        }
      } catch (error) {
        report.failed.push({
          collection,
          index,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  report.collections = presentByCollection.size;
  return report;
};
