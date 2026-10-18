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
//   - NOTHING IS DROPPED OR CHANGED — an index on the server the schemas do not declare is
//     somebody's decision, and one whose definition differs from its declaration (drift) is
//     reported, never rebuilt here.
//
// TWO MODES. `report` (the default) builds nothing: it lists what is missing, which unique indexes
// existing rows would violate, and how many documents a new TTL index would remove the moment it
// exists — so the first run against a live database is a read an operator can review. `apply`
// builds what the report listed. It does not scan for duplicates first: a healthy deploy would pay
// a collection scan per unique index for nothing. It builds, and scans only when the build is
// refused for a duplicate key, to name the rows.
//
// An index that cannot be built as declared is reported, not attempted: one whose keys are already
// indexed under another name in a form the server treats as the same index (it refuses a second
// one with IndexOptionsConflict, on every deploy), and one whose name exists with another
// definition.
//
// THE REPORT CARRIES NO FIELD VALUES. It is written to the deploy log, and the duplicate key of a
// unique index on `users.email` or `hr_employees.personal.nationalId` is personal data. It names
// collections, indexes, counts and document ids — enough to find the rows, nothing more. A server
// error is never recorded as it came: a duplicate-key error quotes the key (`dup key: { … }`).
import mongoose, { type Model } from 'mongoose';
import { keyShape, stable } from './index-drift';
import {
  indexBuildPlan,
  indexNameOf,
  storedKeyPattern,
  textFieldsOf,
  type IndexPlanEntry,
} from './index-plan';

export type IndexSyncMode = 'report' | 'apply';

/** `--apply` on the command line, or `INDEX_SYNC_MODE=apply`; anything else only reports. */
export const indexSyncModeFrom = (argv: readonly string[], configured: string): IndexSyncMode =>
  argv.includes('--apply') || configured === 'apply' ? 'apply' : 'report';

/**
 * The longest any one operation of a duplicate scan (its aggregate, or one of its follow-up finds),
 * or a TTL count, may run. Atlas Free and Flex ignore `allowDiskUse`,
 * so a scan of a large collection can also fail on memory; either way the index is recorded as
 * failed and the sync moves on.
 */
export const SCAN_TIME_LIMIT_MS = 60_000;

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

/** A declared index whose keys the server already indexes under another name. */
export interface ConflictingIndex {
  collection: string;
  index: string;
  conflictsWith: string;
}

/** The properties compared between a declaration and the live index of the same name. */
export type IndexProperty =
  'key' | 'unique' | 'partialFilterExpression' | 'sparse' | 'expireAfterSeconds';

/** A declared index present under its name with another definition. Which properties, not how. */
export interface DriftedIndex {
  collection: string;
  index: string;
  differs: IndexProperty[];
}

export interface IndexSyncReport {
  mode: IndexSyncMode;
  collections: number;
  declared: number;
  /** Present under the declared name, with the declared definition. */
  alreadyPresent: number;
  /** Absent and buildable: in apply mode, each one was built, blocked or failed. */
  missing: MissingIndex[];
  /** `collection.index`, in apply mode only. */
  built: string[];
  conflicts: ConflictingIndex[];
  drifted: DriftedIndex[];
  /** Without `index`, the collection's indexes could not be read and its declarations were skipped. */
  failed: { collection: string; index?: string; reason: string }[];
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

/** What a refused unique build is recorded as. The server's own message quotes the key. */
export const DUPLICATE_KEY_REASON = 'existing rows violate the unique index';

interface ServerErrorFields {
  code?: unknown;
  codeName?: unknown;
  message?: unknown;
}

export const isDuplicateKeyError = (error: unknown): boolean => {
  const e = (typeof error === 'object' && error !== null ? error : {}) as ServerErrorFields;
  return (
    e.code === 11000 ||
    e.codeName === 'DuplicateKey' ||
    (typeof e.message === 'string' && e.message.includes('E11000'))
  );
};

/**
 * A server error as it may be written to the deploy log: the error's code and name, and its
 * message with anything from `dup key:` on cut off, since that part quotes the key's values.
 */
export const failureReason = (error: unknown): string => {
  if (isDuplicateKeyError(error)) return DUPLICATE_KEY_REASON;
  const e = (typeof error === 'object' && error !== null ? error : {}) as ServerErrorFields;
  const message = (typeof e.message === 'string' ? e.message : String(error)).replace(
    /dup key\s*:[\s\S]*$/i,
    'dup key: { … }',
  );
  const name =
    typeof e.codeName === 'string' ? e.codeName : error instanceof Error ? error.name : 'Error';
  const code = typeof e.code === 'number' || typeof e.code === 'string' ? ` (${e.code})` : '';
  return `${name}${code}: ${message}`;
};

/** An index as `listIndexes` returns it — the parts the sync compares. */
export interface LiveIndex {
  name: string;
  key: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: unknown;
  expireAfterSeconds?: number;
  weights?: Record<string, unknown>;
  collation?: unknown;
}

const sameKeyPattern = (entry: IndexPlanEntry, live: LiveIndex): boolean =>
  keyShape(storedKeyPattern(entry.keys)) === keyShape(live.key);

/** The ways the live index of the declared name differs from the declaration; empty when none. */
export const differences = (entry: IndexPlanEntry, live: LiveIndex): IndexProperty[] => {
  const declared = entry.options;
  const sameValue = (a: unknown, b: unknown): boolean => stable(a ?? null) === stable(b ?? null);
  const same: Record<IndexProperty, boolean> = {
    // A text index's fields are in `weights`, not in its key pattern.
    key:
      sameKeyPattern(entry, live) &&
      sameValue(textFieldsOf(entry.keys), Object.keys(live.weights ?? {}).sort()),
    unique: (declared['unique'] === true) === (live.unique === true),
    partialFilterExpression: sameValue(
      declared['partialFilterExpression'],
      live.partialFilterExpression,
    ),
    sparse: (declared['sparse'] === true) === (live.sparse === true),
    expireAfterSeconds: sameValue(declared['expireAfterSeconds'], live.expireAfterSeconds),
  };
  return (Object.keys(same) as IndexProperty[]).filter((property) => !same[property]);
};

/** What lets two indexes on the same keys coexist; anything else differing still conflicts. */
const DISTINGUISHING: readonly IndexProperty[] = ['unique', 'partialFilterExpression', 'sparse'];

/**
 * A live index under another name that the server counts as the same index as the declaration:
 * the same keys in the same order, partial filter, uniqueness and sparseness. `createIndex` is
 * refused for it with IndexOptionsConflict, whatever else the two differ in (a TTL, say). The same
 * keys with a different filter or uniqueness can coexist, and are built, and so can one with a
 * collation: no declaration carries one, so a live index that has it is a different index.
 */
export const sameIndexUnderAnotherName = (
  entry: IndexPlanEntry,
  live: readonly LiveIndex[],
): LiveIndex | undefined =>
  live.find(
    (index) =>
      index.name !== '_id_' &&
      index.name !== indexNameOf(entry) &&
      index.collation === undefined &&
      sameKeyPattern(entry, index) &&
      !differences(entry, index).some((property) => DISTINGUISHING.includes(property)),
  );

/**
 * Up to five groups of rows that share a key the unique index would refuse, each as up to five
 * ids. The group counts rows only — collecting every id per group needs disk use on a large
 * collection, which Atlas Free and Flex do not allow — and the ids are fetched for the few
 * offending keys afterwards. The key values stay in this function; they are never returned.
 */
const duplicateGroups = async (
  model: Model<never>,
  keys: Record<string, unknown>,
  partialFilter: unknown,
  sparse: boolean,
): Promise<string[][]> => {
  const fields = Object.keys(keys);
  const filter = (partialFilter as Record<string, unknown> | undefined) ?? {};
  // A sparse index leaves out a row that has none of its keys, so such rows cannot collide.
  const scope = sparse
    ? { $and: [filter, { $or: fields.map((field) => ({ [field]: { $exists: true } })) }] }
    : filter;
  // A missing field and a null one are the same key to a unique index. In a compound group key a
  // missing field is left out of the key object instead, so `$ifNull` makes both null. The
  // positional names also keep a dotted path (`personal.nationalId`) out of the key.
  const groupKey = Object.fromEntries(
    fields.map((field, i) => [`k${i}`, { $ifNull: [`$${field}`, null] }]),
  );
  const groups = await model.collection
    .aggregate<{ _id: Record<string, unknown> }>(
      [
        { $match: scope },
        { $group: { _id: groupKey, rows: { $sum: 1 } } },
        { $match: { rows: { $gt: 1 } } },
        { $limit: 5 },
      ],
      { allowDiskUse: true, maxTimeMS: SCAN_TIME_LIMIT_MS },
    )
    .toArray();
  const ids: string[][] = [];
  for (const group of groups) {
    // `$eq: null` matches a null field and a missing one, as the index does.
    const sameKey = fields.map((field, i) => ({ [field]: { $eq: group._id[`k${i}`] ?? null } }));
    const rows = await model.collection
      .find(
        { $and: [scope, ...sameKey] },
        { projection: { _id: 1 }, limit: 5, maxTimeMS: SCAN_TIME_LIMIT_MS },
      )
      .toArray();
    ids.push(rows.map((row) => String(row['_id'])));
  }
  return ids;
};

/** Names the rows that break a unique index on the entry; false when the scan finds none. */
const recordDuplicates = async (
  model: Model<never>,
  entry: IndexPlanEntry,
  missing: MissingIndex,
): Promise<boolean> => {
  const groups = await duplicateGroups(
    model,
    entry.keys,
    entry.options['partialFilterExpression'],
    entry.options['sparse'] === true,
  );
  if (groups.length === 0) return false;
  missing.duplicateGroups = groups.length;
  missing.duplicateExampleIds = groups;
  return true;
};

/** How many documents a TTL index on a single date field would remove as soon as it is built. */
const expiredNow = async (model: Model<never>, entry: IndexPlanEntry): Promise<number | null> => {
  const fields = Object.keys(entry.keys);
  const seconds = entry.options['expireAfterSeconds'];
  if (fields.length !== 1 || typeof seconds !== 'number') return null;
  const field = fields[0] as string;
  const cutoff = new Date(Date.now() - seconds * 1000);
  return model.collection.countDocuments(
    { [field]: { $lt: cutoff } },
    { maxTimeMS: SCAN_TIME_LIMIT_MS },
  );
};

const NAMESPACE_NOT_FOUND = 26;

/** The collection's indexes. One that does not exist yet has none; any other failure throws. */
const liveIndexes = async (model: Model<never>): Promise<LiveIndex[]> => {
  try {
    return (await model.collection.listIndexes().toArray()) as unknown as LiveIndex[];
  } catch (error) {
    if ((error as ServerErrorFields | null)?.code === NAMESPACE_NOT_FOUND) return [];
    throw error;
  }
};

/** What a built index reads back as, so a later model on the collection compares against it. */
const asLive = (index: string, entry: IndexPlanEntry): LiveIndex => {
  const textFields = textFieldsOf(entry.keys);
  return {
    ...(entry.options as Omit<LiveIndex, 'name' | 'key'>),
    name: index,
    key: storedKeyPattern(entry.keys),
    ...(textFields.length > 0 && { weights: Object.fromEntries(textFields.map((f) => [f, 1])) }),
  };
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
    conflicts: [],
    drifted: [],
    failed: [],
  };

  // Read once per collection, then kept current as indexes are built, so a second model on the
  // same collection sees what the first one built. `null` is a collection whose indexes could not
  // be read: guessing that they are missing would build, or report, the wrong thing.
  const liveByCollection = new Map<string, LiveIndex[] | null>();
  const considered = new Set<string>();

  for (const model of models) {
    const collection = model.collection.collectionName;
    let live = liveByCollection.get(collection);
    if (live === undefined) {
      try {
        live = await liveIndexes(model);
      } catch (error) {
        live = null;
        report.failed.push({ collection, reason: failureReason(error) });
      }
      liveByCollection.set(collection, live);
    }

    for (const entry of indexBuildPlan(model.schema.indexes())) {
      const index = indexNameOf(entry);
      const key = `${collection}.${index}`;
      // The same declaration reached through a second model on the collection (a discriminator
      // inherits its base's indexes) is one index, counted once.
      if (considered.has(key)) continue;
      considered.add(key);
      report.declared += 1;
      if (live === null) continue;

      const named = live.find((candidate) => candidate.name === index);
      if (named !== undefined) {
        const differs = differences(entry, named);
        if (differs.length === 0) report.alreadyPresent += 1;
        else report.drifted.push({ collection, index, differs });
        continue;
      }
      const twin = sameIndexUnderAnotherName(entry, live);
      if (twin !== undefined) {
        report.conflicts.push({ collection, index, conflictsWith: twin.name });
        continue;
      }

      const missing: MissingIndex = { collection, index, unique: entry.unique };
      report.missing.push(missing);
      try {
        if (typeof entry.options['expireAfterSeconds'] === 'number') {
          missing.ttl = {
            seconds: entry.options['expireAfterSeconds'],
            wouldRemoveNow: await expiredNow(model, entry),
          };
        }
        if (mode === 'report') {
          // The report predicts what apply will meet, so here the scan always runs.
          if (entry.unique) await recordDuplicates(model, entry, missing);
          continue;
        }
        const refusal = await model.collection
          .createIndex(entry.keys as never, entry.options as never)
          .then(
            () => null,
            (error: unknown) => ({ error }),
          );
        if (refusal === null) {
          live.push(asLive(index, entry));
          report.built.push(key);
          continue;
        }
        if (!entry.unique || !isDuplicateKeyError(refusal.error)) throw refusal.error;
        // The build found duplicates; only now is the scan worth its cost, to name the rows.
        let found: boolean;
        try {
          found = await recordDuplicates(model, entry, missing);
        } catch (scanError) {
          const scan = failureReason(scanError);
          report.failed.push({
            collection,
            index,
            reason: `${DUPLICATE_KEY_REASON}; the scan for the rows failed: ${scan}`,
          });
          continue;
        }
        // A key the scan cannot see — one element of an array field, say — still refused it.
        if (!found) report.failed.push({ collection, index, reason: DUPLICATE_KEY_REASON });
      } catch (error) {
        report.failed.push({ collection, index, reason: failureReason(error) });
      }
    }
  }
  report.collections = liveByCollection.size;
  return report;
};

export interface ReportLine {
  level: 'info' | 'warn';
  msg: string;
  fields: object;
}

export const BLOCKED_BY_DUPLICATES =
  'index sync: unique index NOT built — existing rows violate it';

/** The deploy log, one line per index that needs a word: what was built, and what was not. */
export const reportLines = (report: IndexSyncReport): ReportLine[] => {
  const failed = new Set(report.failed.map((failure) => `${failure.collection}.${failure.index}`));
  const built = new Set(report.built);
  const lines: ReportLine[] = [];
  for (const missing of report.missing) {
    const key = `${missing.collection}.${missing.index}`;
    // A failed one gets its own line below, with the reason.
    if (failed.has(key)) continue;
    if (missing.duplicateGroups !== undefined) {
      lines.push({ level: 'warn', msg: BLOCKED_BY_DUPLICATES, fields: missing });
    } else if (built.has(key)) {
      lines.push({ level: 'info', msg: 'index sync: built', fields: missing });
    } else {
      lines.push({ level: 'info', msg: 'index sync: would build', fields: missing });
    }
  }
  for (const conflict of report.conflicts) {
    lines.push({
      level: 'warn',
      msg: 'index sync: index NOT built — its keys are indexed under another name',
      fields: conflict,
    });
  }
  for (const drift of report.drifted) {
    lines.push({
      level: 'warn',
      msg: 'index sync: index differs from its declaration — left as it is',
      fields: drift,
    });
  }
  for (const failure of report.failed) {
    lines.push({
      level: 'warn',
      msg:
        failure.index === undefined
          ? 'index sync: indexes not read — the collection was skipped'
          : 'index sync: index not built',
      fields: failure,
    });
  }
  return lines;
};

/** The run's last line: the counts, and in report mode, how to switch building on. */
export const reportSummary = (report: IndexSyncReport): ReportLine => ({
  level: 'info',
  msg:
    report.mode === 'apply'
      ? 'index sync: done'
      : 'index sync: REPORT ONLY — nothing was built; set INDEX_SYNC_MODE=apply to build',
  fields: {
    mode: report.mode,
    collections: report.collections,
    declared: report.declared,
    alreadyPresent: report.alreadyPresent,
    missing: report.missing.length,
    built: report.built.length,
    blockedByDuplicates: report.missing.filter((m) => m.duplicateGroups !== undefined).length,
    conflicts: report.conflicts.length,
    drifted: report.drifted.length,
    failed: report.failed.length,
  },
});
