// Boot migration for legacy-imported master rows (DEC-23; precedent
// modules/hr/recruitment/recruitment.migration.ts — automatic, idempotent, safe on every boot).
//
// `npm run atm:import` writes `atm_machines` and `atm_ref_labels` through the raw driver
// (migration/legacy-import.ts, `replaceOne … upsert`), so Mongoose never stamped them: no `__v`, no
// `createdAt`/`updatedAt`. A row without `__v` misses every versioned write (`__v: <version>` in
// the filter matches nothing → 409 on every edit, archive, area move and register coupling), and the
// mappers read `createdAt`. Backfilled here with the raw driver again — Mongoose would add its own
// timestamps — `__v` to 0, `createdAt` to the instant inside the row's own ObjectId, `updatedAt` to
// itself or the same instant. Guarded by `$exists: false`, so a second run matches nothing.
//
// The coupling path and the two mappers tolerate the gap meanwhile (`ensureMachineVersioned`,
// `atm.mappers.ts`), so a request that arrives before this ran still works.
import { AtmMachineModel } from './machine.model';
import { AtmRefLabelModel } from '../catalogs/ref-label.model';

export interface AtmLegacyTimestampsResult {
  versioned: number;
  timestamped: number;
}

export const migrateAtmLegacyTimestamps = async (): Promise<AtmLegacyTimestampsResult> => {
  let versioned = 0;
  let timestamped = 0;
  for (const model of [AtmMachineModel, AtmRefLabelModel] as const) {
    const collection = model.collection;
    const v = await collection.updateMany({ __v: { $exists: false } }, { $set: { __v: 0 } });
    versioned += v.modifiedCount;
    const t = await collection.updateMany({ createdAt: { $exists: false } }, [
      {
        $set: {
          createdAt: { $toDate: '$_id' },
          updatedAt: { $ifNull: ['$updatedAt', { $toDate: '$_id' }] },
        },
      },
    ]);
    timestamped += t.modifiedCount;
  }
  return { versioned, timestamped };
};
