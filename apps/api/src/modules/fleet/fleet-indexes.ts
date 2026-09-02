// Building the indexes the Fleet schemas declare — the deploy step ADR-005 promises.
//
// `autoIndex` is off outside development (infrastructure/database/mongo.ts), and ADR-005 §
// "Indexes are code" plus the database design §1 both say index sync is a deploy step. There was
// no such step: a repo-wide search finds exactly two index builders, the users module's and the
// fixed-crew one next door. Everything else the Fleet schemas declare — nine unique indexes and
// fourteen ordinary ones — simply did not exist in production.
//
// WHAT THAT COST. The uniques are the ones the code calls invariants: FR-1's four identifiers,
// FR-4's one open visit per vehicle ("a database invariant, not a convention"), FR-7's one
// assignment per vehicle-day, one open odometer period. Without them each degrades to the
// service's own pre-check, which is a read followed by a write and therefore racy. Worse is
// `fleet_sweep_marks.ux_key`: `markOnce` reports "already announced" ONLY by catching a duplicate
// key, so with no unique index it always returns true and both daily sweeps re-announce every
// licence expiry and every alarm crossing, every run, forever.
//
// THE DEFINITIONS ARE READ FROM THE SCHEMAS, never restated here. A second hand-written copy is
// the exact failure the fixed-crew index went out of its way to avoid — mongo answers a mismatched
// rebuild with `IndexOptionsConflict` rather than a fix, so two copies that drift are worse than
// none. `schema.indexes()` is the same list mongoose itself would build with `autoIndex` on.
//
// ONE INDEX AT A TIME, not `createIndexes()`. That call is a batch: a single duplicate anywhere in
// `fleet_vehicles` would abort all eight of its indexes, including the ordinary ones that have
// nothing to do with the violation. Built one by one, a violation costs exactly its own index.
//
// DUPLICATES ARE REPORTED, NEVER RESOLVED — the discipline `migrateFixedCrewIndex` established.
// Building a unique index over violating data fails anyway; looking first is about saying WHICH
// rows, in a log line an operator can act on. Merging or deleting one of them would invent an
// answer the data does not contain, so the index is simply not built until a person has resolved
// it, and the service's own checks keep holding meanwhile.
//
// NOTHING HERE WRITES A DOCUMENT. No field is added, changed or removed, and no row is deleted;
// the only effect is that constraints the schemas already declare start being enforced.
import { type Model } from 'mongoose';
import { logger } from '../../infrastructure/logging/logger';
import { FleetVehicleModel } from './vehicles/vehicle.model';
import { FleetVehicleTypeModel } from './vehicle-types/vehicle-type.model';
import { FleetCatalogItemModel } from './catalogs/catalog-item.model';
import { FleetDriverProfileModel } from './driver-profiles/driver-profile.model';
import { FleetUnavailabilityModel } from './availability/unavailability.model';
import { FleetDutyAssignmentModel } from './roster/duty-assignment.model';
import { FleetFixedCrewModel } from './fixed-roster/fixed-crew.model';
import { FleetMaintenanceVisitModel } from './maintenance/maintenance.model';
import { FleetOdometerLogModel } from './odometer/odometer.model';
import { FleetAccidentModel } from './accidents/accident.model';
import { FleetViolationModel, FleetGrievanceModel } from './violations/violation.model';
import { FleetSweepMarkModel } from './sweeps/sweep-mark.model';

/**
 * Every Fleet collection, listed once.
 *
 * Explicit rather than discovered from the mongoose registry: that registry holds every model the
 * process has loaded, so a discovered list would quietly start building other modules' indexes
 * the day someone imports one. This module owns Fleet's, and only Fleet's.
 */
export const fleetIndexedModels = (): { collection: string; model: Model<never> }[] =>
  (
    [
      FleetVehicleModel,
      FleetVehicleTypeModel,
      FleetCatalogItemModel,
      FleetDriverProfileModel,
      FleetUnavailabilityModel,
      FleetDutyAssignmentModel,
      FleetFixedCrewModel,
      FleetMaintenanceVisitModel,
      FleetOdometerLogModel,
      FleetAccidentModel,
      FleetViolationModel,
      FleetGrievanceModel,
      FleetSweepMarkModel,
    ] as unknown as Model<never>[]
  ).map((model) => ({ collection: model.collection.name, model }));

/**
 * The options that describe an index to the SERVER, filtered out of what mongoose hands back.
 *
 * `schema.indexes()` carries driver-side hints too — `background` above all, which modern mongo
 * ignores and which would otherwise be stored as part of the definition a later rebuild is
 * compared against. Forwarding a fixed, known set keeps a rebuild byte-identical to the first
 * build, which is what makes the whole step idempotent rather than conflict-prone.
 */
const FORWARDED = [
  'name',
  'unique',
  'partialFilterExpression',
  'sparse',
  'expireAfterSeconds',
] as const;

export interface IndexPlanEntry {
  keys: Record<string, unknown>;
  options: Record<string, unknown>;
  /** A unique index needs a duplicate check before it can be built. */
  unique: boolean;
}

/** Pure: what will actually be sent to `createIndex`, for one schema's declarations. */
export const indexBuildPlan = (
  declared: readonly (readonly [Record<string, unknown>, Record<string, unknown> | undefined])[],
): IndexPlanEntry[] =>
  declared.map(([keys, raw]) => {
    const options: Record<string, unknown> = {};
    for (const key of FORWARDED) {
      if (raw !== undefined && raw[key] !== undefined) options[key] = raw[key];
    }
    return { keys, options, unique: options['unique'] === true };
  });

/**
 * Rows that would violate a unique index, asked with the index's OWN partial filter.
 *
 * Asking any other question would answer about a different set of rows than the one the index
 * covers — a soft-deleted duplicate is not a duplicate to an index partial on `isDeleted: false`.
 * Capped: the point is to name examples an operator can open, not to enumerate a broken database.
 */
const duplicateGroups = async (
  model: Model<never>,
  keys: Record<string, unknown>,
  partialFilter: unknown,
): Promise<{ key: unknown; rows: number; docIds: string[] }[]> => {
  const groupId: Record<string, string> = {};
  for (const field of Object.keys(keys)) groupId[field.replace(/\./g, '_')] = `$${field}`;
  const rows = await model.collection
    .aggregate<{ _id: unknown; rows: number; docIds: unknown[] }>([
      { $match: (partialFilter as Record<string, unknown>) ?? {} },
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

export interface FleetIndexMigrationResult {
  built: number;
  alreadyPresent: number;
  skippedDuplicates: { collection: string; index: string; groups: number }[];
  failed: { collection: string; index: string; reason: string }[];
}

/**
 * Build every index the Fleet schemas declare. Idempotent, non-destructive, boot-safe.
 *
 * A failure never stops a boot: an index that cannot be built is a logged problem, not a reason to
 * take the API down — the code paths that would have relied on it all still work, just without the
 * database enforcing them, which is exactly the state this whole step is fixing.
 */
export const migrateFleetIndexes = async (): Promise<FleetIndexMigrationResult> => {
  const result: FleetIndexMigrationResult = {
    built: 0,
    alreadyPresent: 0,
    skippedDuplicates: [],
    failed: [],
  };

  for (const { collection, model } of fleetIndexedModels()) {
    const existing = await model.collection
      .listIndexes()
      .toArray()
      .catch(() => [] as { name?: string }[]);
    const present = new Set(existing.map((index) => String(index.name)));

    for (const entry of indexBuildPlan(model.schema.indexes())) {
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
            logger.error(
              { collection, index: name, groups },
              'fleet: unique index NOT built — existing rows violate it; resolve them, then redeploy',
            );
            result.skippedDuplicates.push({ collection, index: name, groups: groups.length });
            continue;
          }
        }
        await model.collection.createIndex(entry.keys as never, entry.options as never);
        result.built += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn({ collection, index: name, err: error }, 'fleet: index not built');
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
    'fleet: index sync complete',
  );
  return result;
};
