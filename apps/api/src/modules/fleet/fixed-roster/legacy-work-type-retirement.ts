// Retiring the fixed crew's legacy `workTypeId` field.
//
// The column now labelled «نوع المهمة» stores `missionTypeId` and is validated against the
// `missionType` catalog (أنواع المهمات). For one release it stored `workTypeId` and was validated
// against `workType` (أنواع الأعمال) — the WORKSHOP's vocabulary, which carries `countsForAlarm`
// and names maintenance jobs. A crew is not sent on a maintenance job, so those stored ids are
// not missions that happen to be filed wrongly; they are the wrong noun.
//
// WHY NOTHING IS REMAPPED. There is no authoritative correspondence between the two catalogs
// anywhere in this repository, and inventing one would silently assert a fact nobody checked —
// a car would come back from the migration claiming a standing mission that no human chose.
// Clearing is the honest outcome: the field reads as "no mission type", which is exactly what is
// true, and the reader sets the real one from a list that now contains the right words.
//
// NOTHING IS LOST. `$unset` removes the field from the crew row only. Every value it ever held is
// still in the audit trail under its original key — `platform_audit` records what was true at the
// time, and this deliberately does not touch those records: rewriting history to match a later
// decision is the one thing an audit log must never do.
//
// Read and write are separate on purpose: `inspect` is what `--dry-run` runs and touches nothing.
import { Types } from 'mongoose';
import { FleetFixedCrewModel } from './fixed-crew.model';
import { FleetCatalogItemModel } from '../catalogs/catalog-item.model';

/** One legacy value, with whatever the catalog says it actually is. */
export interface LegacyWorkTypeUsage {
  workTypeId: string;
  rows: number;
  /** The catalog item, when the id still resolves — `null` for a dangling reference. */
  catalog: { nameAr: string; nameEn: string; kind: string; isActive: boolean } | null;
}

export interface LegacyWorkTypeReport {
  /** Live crew rows still carrying the retired field with a value. */
  rowsWithLegacyValue: number;
  /** Live crew rows in total — the denominator, so a count can be read in proportion. */
  liveRows: number;
  distinct: LegacyWorkTypeUsage[];
  /** The vocabulary a reader will choose from AFTER the migration. */
  activeMissionTypes: { id: string; nameAr: string; nameEn: string }[];
}

/**
 * What is there — READ ONLY.
 *
 * `workTypeId` is no longer in the schema, so it is queried through the raw collection: a strict
 * Mongoose model would neither project nor match a path it does not declare.
 */
export const inspectLegacyWorkTypes = async (): Promise<LegacyWorkTypeReport> => {
  const crews = FleetFixedCrewModel.collection;
  const liveRows = await crews.countDocuments({ isDeleted: false });
  const grouped = await crews
    .aggregate<{ _id: unknown; rows: number }>([
      { $match: { isDeleted: false, workTypeId: { $ne: null, $exists: true } } },
      { $group: { _id: '$workTypeId', rows: { $sum: 1 } } },
      { $sort: { rows: -1 } },
    ])
    .toArray();

  const distinct: LegacyWorkTypeUsage[] = [];
  for (const group of grouped) {
    const id = String(group._id);
    const item = Types.ObjectId.isValid(id)
      ? await FleetCatalogItemModel.findById(id).lean().exec()
      : null;
    distinct.push({
      workTypeId: id,
      rows: group.rows,
      catalog:
        item === null
          ? null
          : {
              nameAr: item.name.ar,
              nameEn: item.name.en,
              kind: item.kind,
              isActive: item.isActive,
            },
    });
  }

  const missions = await FleetCatalogItemModel.find({ kind: 'missionType', isActive: true })
    .lean()
    .exec();

  return {
    rowsWithLegacyValue: distinct.reduce((sum, entry) => sum + entry.rows, 0),
    liveRows,
    distinct,
    activeMissionTypes: missions.map((item) => ({
      id: String(item._id),
      nameAr: item.name.ar,
      nameEn: item.name.en,
    })),
  };
};

/**
 * Remove the retired field. Nothing else is written — no value is translated into a mission.
 *
 * Soft-deleted rows are included deliberately: the field is retired from the COLLECTION, and
 * leaving it on rows that could later be restored would just defer the same cleanup.
 */
export const retireLegacyWorkTypes = async (): Promise<{ matched: number; modified: number }> => {
  const result = await FleetFixedCrewModel.collection.updateMany(
    { workTypeId: { $exists: true } },
    { $unset: { workTypeId: '' } },
  );
  return { matched: result.matchedCount, modified: result.modifiedCount };
};
