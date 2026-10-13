// Building the indexes the ATM schemas declare — the deploy step ADR-005 promises (DEC-26), copied
// from the Fleet pattern (modules/fleet/fleet-indexes.ts) rather than imported: ATM imports no
// other module.
//
// `autoIndex` is off outside development (infrastructure/database/mongo.ts), so without this step
// none of these would exist in production — above all `ux_open_period_per_code`, the race-proof half
// of D6 ("one open period per machine code, company-wide"), `ux_import_row`, the import's
// idempotency, and `ux_one_running`, one import at a time. Building them at boot also brings each
// collection into being BEFORE its first insert, which otherwise happens inside a transaction.
//
// THE DEFINITIONS ARE READ FROM THE SCHEMAS (`schema.indexes()`), never restated here. ONE INDEX AT
// A TIME, so a duplicate costs exactly its own index. DUPLICATES ARE REPORTED, NEVER RESOLVED — a
// legacy `atm_machines` loaded by `npm run atm:import` may violate `ux_branch_code` (risk R-9); the
// index is then logged and skipped, and the services' own checks keep holding. NOTHING HERE WRITES
// A DOCUMENT.
import { type Model } from 'mongoose';
import { logger } from '../../infrastructure/logging/logger';
import { AtmMachineModel } from './machines/machine.model';
import { AtmRefLabelModel } from './catalogs/ref-label.model';
import { AtmRegisterEntryModel } from './register/register.model';
import { AtmRegisterImportRunModel } from './register/import/register-import-run.model';

/** The collections whose indexes this step owns — listed, never discovered. */
export const atmIndexedModels = (): { collection: string; model: Model<never> }[] =>
  (
    [
      AtmMachineModel,
      AtmRefLabelModel,
      AtmRegisterEntryModel,
      AtmRegisterImportRunModel,
    ] as unknown as Model<never>[]
  ).map((model) => ({ collection: model.collection.name, model }));

/** Server-side options only — a rebuild stays byte-identical to the first build. */
const FORWARDED = ['name', 'unique', 'partialFilterExpression', 'sparse'] as const;

export interface AtmIndexPlanEntry {
  keys: Record<string, unknown>;
  options: Record<string, unknown>;
  unique: boolean;
}

/** Pure: what will actually be sent to `createIndex`, for one schema's declarations. */
export const atmIndexBuildPlan = (
  declared: readonly (readonly [Record<string, unknown>, Record<string, unknown> | undefined])[],
): AtmIndexPlanEntry[] =>
  declared.map(([keys, raw]) => {
    const options: Record<string, unknown> = {};
    for (const key of FORWARDED) {
      if (raw !== undefined && raw[key] !== undefined) options[key] = raw[key];
    }
    return { keys, options, unique: options['unique'] === true };
  });

/** Rows that would violate a unique index, asked with the index's OWN partial filter. Capped. */
const duplicateGroups = async (
  model: Model<never>,
  keys: Record<string, unknown>,
  partialFilter: unknown,
): Promise<{ key: unknown; rows: number; docIds: string[] }[]> => {
  const groupId: Record<string, string> = {};
  for (const field of Object.keys(keys)) groupId[field.replace(/\./g, '_')] = `$${field}`;
  const rows = await model.collection
    .aggregate<{ _id: unknown; rows: number; docIds: unknown[] }>([
      { $match: (partialFilter as Record<string, unknown> | undefined) ?? {} },
      { $group: { _id: groupId, rows: { $sum: 1 }, docIds: { $push: '$_id' } } },
      { $match: { rows: { $gt: 1 } } },
      { $limit: 5 },
    ])
    .toArray();
  return rows.map((row) => ({
    key: row._id,
    rows: row.rows,
    docIds: row.docIds.map((id) => String(id)),
  }));
};

export interface AtmIndexMigrationResult {
  built: number;
  alreadyPresent: number;
  skippedDuplicates: { collection: string; index: string; groups: number }[];
  failed: { collection: string; index: string; reason: string }[];
}

/** Build every index the ATM schemas declare. Idempotent, non-destructive, never stops a boot. */
export const migrateAtmIndexes = async (): Promise<AtmIndexMigrationResult> => {
  const result: AtmIndexMigrationResult = {
    built: 0,
    alreadyPresent: 0,
    skippedDuplicates: [],
    failed: [],
  };

  for (const { collection, model } of atmIndexedModels()) {
    const existing = await model.collection
      .listIndexes()
      .toArray()
      .catch(() => [] as { name?: string }[]);
    const present = new Set(existing.map((index) => String(index.name)));

    for (const entry of atmIndexBuildPlan(model.schema.indexes())) {
      const name = String(entry.options['name'] ?? Object.keys(entry.keys).join('_'));
      if (present.has(name)) {
        result.alreadyPresent += 1;
        continue;
      }
      try {
        if (entry.unique) {
          const groups = await duplicateGroups(
            model,
            entry.keys,
            entry.options['partialFilterExpression'],
          );
          if (groups.length > 0) {
            // Ids and counts only — the grouped key of a register index is a machine code or an
            // Excel row number, never a K/S value.
            logger.error(
              { collection, index: name, groups },
              'atm: unique index NOT built — existing rows violate it; resolve them, then redeploy',
            );
            result.skippedDuplicates.push({ collection, index: name, groups: groups.length });
            continue;
          }
        }
        await model.collection.createIndex(entry.keys as never, entry.options as never);
        result.built += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn({ collection, index: name, err: error }, 'atm: index not built');
        result.failed.push({ collection, index: name, reason });
      }
    }
  }

  logger.info(
    {
      built: result.built,
      alreadyPresent: result.alreadyPresent,
      skipped: result.skippedDuplicates.length,
      failed: result.failed.length,
    },
    'atm: index sync complete',
  );
  return result;
};
