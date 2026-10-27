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
// The two operation logs joined the list with the owner's rule (2026-10-13, port doc OD-1): their
// `ux_open_replenishment_per_code_day` / `ux_open_maintenance_per_code_day` are the race-proof
// half of "a machine is never open twice on one day" (per day since 2026-10-27). Legacy data may
// already hold two open rows for one code and day (the legacy had no guard), so these are the
// likeliest to be reported and skipped — and their report names the collection and the counts
// ONLY (`rowsInLog: false`): an operation row is somebody's work record, and nothing of it belongs
// in a boot log.
//
// RETIRED INDEXES ARE DROPPED — the one thing this step removes, and only by name from the list
// below. The rule's first form was any-day (`ux_open_*_per_code`); a database that built it would
// go on refusing a machine left open yesterday, which is exactly what the owner withdrew. Dropping
// an index removes no document.
//
// The machine map's three collections joined the first group (docs/12-planning/atm-map-zones.md
// §3.4): their keys are ids, never a K or S value, and building them here also brings each one into
// being before its first insert, which otherwise happens inside the zone save's transaction.
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
import { AtmReplenishmentModel } from './replenishments/replenishment.model';
import { AtmMaintenanceModel } from './maintenances/maintenance.model';
import { AtmMapZoneModel } from './map/zone.model';
import { AtmMapZoneSetModel } from './map/zone-set.model';
import { AtmMachineLocationModel } from './map/machine-location.model';
import { RETIRED_OPEN_OPERATION_INDEX_NAMES } from './shared/open-operation';

export interface AtmIndexedModel {
  collection: string;
  model: Model<never>;
  /** Indexes this collection must NOT carry any more — dropped by name when present. */
  retired?: readonly string[];
  /**
   * May a duplicate report carry the offending groups' keys and ids? Yes for the master and the
   * register (a machine code or an Excel row number, never a K/S value); NO for the operation
   * logs, whose report is the collection, the index and the counts.
   */
  rowsInLog: boolean;
}

/** The collections whose indexes this step owns — listed, never discovered. */
export const atmIndexedModels = (): AtmIndexedModel[] => [
  ...(
    [
      AtmMachineModel,
      AtmRefLabelModel,
      AtmRegisterEntryModel,
      AtmRegisterImportRunModel,
      AtmMapZoneModel,
      AtmMapZoneSetModel,
      AtmMachineLocationModel,
    ] as unknown as Model<never>[]
  ).map((model) => ({ collection: model.collection.name, model, rowsInLog: true })),
  {
    collection: AtmReplenishmentModel.collection.name,
    model: AtmReplenishmentModel as unknown as Model<never>,
    rowsInLog: false,
    retired: [RETIRED_OPEN_OPERATION_INDEX_NAMES.replenishment],
  },
  {
    collection: AtmMaintenanceModel.collection.name,
    model: AtmMaintenanceModel as unknown as Model<never>,
    rowsInLog: false,
    retired: [RETIRED_OPEN_OPERATION_INDEX_NAMES.maintenance],
  },
];

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

/**
 * Pure: a duplicate report reduced to what may be logged for a collection whose rows stay out of
 * the log — how many groups (capped at the five `duplicateGroups` reads) and rows they hold.
 */
export const duplicateCounts = (
  groups: readonly { rows: number }[],
): { groups: number; rows: number } => ({
  groups: groups.length,
  rows: groups.reduce((sum, group) => sum + group.rows, 0),
});

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Pure: an error reduced to its name and server code — nothing a message could quote. */
export const redactedErrorText = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  const name = error instanceof Error ? error.name : 'Error';
  return typeof code === 'number' || typeof code === 'string' ? `${name} ${String(code)}` : name;
};

export interface AtmIndexMigrationResult {
  built: number;
  alreadyPresent: number;
  /** Retired indexes found and dropped, by collection. */
  dropped: { collection: string; index: string }[];
  skippedDuplicates: { collection: string; index: string; groups: number }[];
  failed: { collection: string; index: string; reason: string }[];
}

/** Build every index the ATM schemas declare. Idempotent, non-destructive, never stops a boot. */
export const migrateAtmIndexes = async (): Promise<AtmIndexMigrationResult> => {
  const result: AtmIndexMigrationResult = {
    built: 0,
    alreadyPresent: 0,
    dropped: [],
    skippedDuplicates: [],
    failed: [],
  };

  for (const { collection, model, rowsInLog, retired = [] } of atmIndexedModels()) {
    const existing = await model.collection
      .listIndexes()
      .toArray()
      .catch(() => [] as { name?: string }[]);
    const present = new Set(existing.map((index) => String(index.name)));

    for (const name of retired) {
      if (!present.has(name)) continue;
      try {
        await model.collection.dropIndex(name);
        present.delete(name);
        result.dropped.push({ collection, index: name });
        logger.info({ collection, index: name }, 'atm: retired index dropped');
      } catch (error) {
        logger.warn(
          { collection, index: name, reason: redactedErrorText(error) },
          'atm: retired index not dropped',
        );
        result.failed.push({ collection, index: name, reason: redactedErrorText(error) });
      }
    }

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
            // Excel row number, never a K/S value. An operation log reports counts and nothing
            // of its rows (`rowsInLog: false`).
            logger.error(
              rowsInLog
                ? { collection, index: name, groups }
                : { collection, index: name, ...duplicateCounts(groups) },
              'atm: unique index NOT built — existing rows violate it; resolve them, then redeploy',
            );
            result.skippedDuplicates.push({ collection, index: name, groups: groups.length });
            continue;
          }
        }
        await model.collection.createIndex(entry.keys as never, entry.options as never);
        result.built += 1;
      } catch (error) {
        // A server message can quote a row (`E11000 … dup key: { machineCode: … }` when a write
        // slips in between the check above and the build), so a rows-out collection keeps only
        // the error's name and code.
        const reason = rowsInLog ? errorText(error) : redactedErrorText(error);
        logger.warn(
          rowsInLog ? { collection, index: name, err: error } : { collection, index: name, reason },
          'atm: index not built',
        );
        result.failed.push({ collection, index: name, reason });
      }
    }
  }

  logger.info(
    {
      built: result.built,
      alreadyPresent: result.alreadyPresent,
      dropped: result.dropped.length,
      skipped: result.skippedDuplicates.length,
      failed: result.failed.length,
    },
    'atm: index sync complete',
  );
  return result;
};
