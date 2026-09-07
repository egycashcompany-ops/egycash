// Fleet data migrations — idempotent, boot-time, non-destructive.
//
// The catalogs slice turned `licenseClass` from a free string into a `licenseClass` catalog
// reference (§13-Q7 answered as data). This converts what is already in the database, under three
// rules that together mean an existing fleet keeps working through the change:
//
//   1. NOTHING IS DELETED. The legacy `licenseClass` column stays exactly as written; only the new
//      `licenseClassId` is filled in. The old value remains the evidence of what was converted.
//   2. NOTHING IS INVENTED. A catalog item is created only for a value a vehicle actually holds,
//      and vehicles with no license class stay null.
//   3. RE-RUNNING CHANGES NOTHING. Only vehicles with a legacy value and no reference yet are
//      touched, and the catalog write is create-if-missing, so a second boot is a no-op.
import { logger } from '../../infrastructure/logging/logger';
import { fleetCatalogItemService } from './catalogs/catalog-item.service';
import { FleetCatalogItemModel } from './catalogs/catalog-item.model';
import { FleetVehicleModel } from './vehicles/vehicle.model';
import { FleetDriverProfileModel } from './driver-profiles/driver-profile.model';
import {
  FIXED_CREW_VEHICLE_INDEX_KEY,
  FIXED_CREW_VEHICLE_INDEX_OPTIONS,
  FleetFixedCrewModel,
} from './fixed-roster/fixed-crew.model';
import { migrateFleetIndexes } from './fleet-indexes';

/**
 * Back-fill `licenseClassId` from the legacy free-text `licenseClass`.
 *
 * Values are grouped by their TRIMMED text, so "ب" and "ب " become one catalog item rather than
 * two — the whitespace was never a distinction anyone meant.
 */
export const migrateVehicleLicenseClasses = async (): Promise<{
  itemsEnsured: number;
  vehiclesUpdated: number;
}> => {
  const pending = await FleetVehicleModel.find(
    {
      isDeleted: false,
      licenseClassId: null,
      licenseClass: { $nin: [null, ''] },
    },
    { _id: 1, licenseClass: 1 },
  )
    .lean<{ _id: unknown; licenseClass: string | null }[]>()
    .exec();
  if (pending.length === 0) return { itemsEnsured: 0, vehiclesUpdated: 0 };

  // One catalog item per distinct value; the map then points every vehicle at the right id.
  const byValue = new Map<string, string[]>();
  for (const row of pending) {
    const value = (row.licenseClass ?? '').trim();
    if (value === '') continue;
    byValue.set(value, [...(byValue.get(value) ?? []), String(row._id)]);
  }

  let vehiclesUpdated = 0;
  for (const [value, vehicleIds] of byValue) {
    // `en` mirrors the original text: the legacy column held ONE string, and inventing an English
    // translation for it would be fabricating data. An admin renames it properly from /fleet/catalogs.
    const item = await fleetCatalogItemService.ensure({
      kind: 'licenseClass',
      name: { ar: value, en: value },
      countsForAlarm: false,
    });
    const result = await FleetVehicleModel.updateMany(
      { _id: { $in: vehicleIds }, licenseClassId: null },
      { $set: { licenseClassId: item._id } },
    ).exec();
    vehiclesUpdated += result.modifiedCount;
  }

  logger.info(
    { itemsEnsured: byValue.size, vehiclesUpdated },
    'fleet: migrated legacy licenseClass strings to catalog references',
  );
  return { itemsEnsured: byValue.size, vehiclesUpdated };
};

/**
 * Vehicles predating the branch requirement.
 *
 * Deliberately REPORTED, not fixed: which branch a historical vehicle belongs to is a fact only an
 * operator knows, and quietly stamping every one of them with the default branch would be
 * inventing placement data that then looks authoritative. The rule binds new vehicles; these rows
 * stay editable, and the form makes an editor name a branch before saving.
 */
export const reportBranchlessVehicles = async (): Promise<number> => {
  const count = await FleetVehicleModel.countDocuments({
    isDeleted: false,
    branchId: null,
  }).exec();
  if (count > 0) {
    logger.warn(
      { count },
      'fleet: vehicles without a branch predate the branch requirement — assign one when editing',
    );
  }
  return count;
};

/**
 * Backfill the side of violation types that predate the column.
 *
 * The split between "the company pays this" and "the driver pays this" always existed — it was
 * written as a comment beside the seed and enforced nowhere, so both entry forms offered every
 * type. Giving it a column leaves the rows already in the database with no side, and a type with
 * no side is offered by NEITHER form: invisible, not merely unclassified.
 *
 * Classification is BY NAME, and only here. That is not the rule the running code uses — the
 * screens read the stored side — it is the one-time reading of what the seed's own comment said
 * these rows were. The four driver types are the ones the legacy wrote as `ح`/`ت` shorthand plus
 * the two the drivers' bar has always counted; everything else a house has added since is the
 * company's, which is the safer default: a company type shown to the company is a wrong list, a
 * driver fine filed against the company is a wrong ledger.
 *
 * Idempotent: only rows with no side are touched, so a second boot is a no-op.
 */
const DRIVER_TYPE_NAMES = ['سرعة', 'عكس', 'تليفون', 'حزام'];

export const migrateViolationTypeSides = async (): Promise<{
  driver: number;
  company: number;
}> => {
  const pending = await FleetCatalogItemModel.find(
    { kind: 'violationType', violationSide: null },
    { _id: 1, name: 1 },
  )
    .lean<{ _id: unknown; name: { ar: string } }[]>()
    .exec();
  if (pending.length === 0) return { driver: 0, company: 0 };

  const driverIds = pending.filter((i) => DRIVER_TYPE_NAMES.includes(i.name.ar)).map((i) => i._id);
  const companyIds = pending
    .filter((i) => !DRIVER_TYPE_NAMES.includes(i.name.ar))
    .map((i) => i._id);

  if (driverIds.length > 0) {
    await FleetCatalogItemModel.updateMany(
      { _id: { $in: driverIds } },
      { $set: { violationSide: 'driver' } },
    );
  }
  if (companyIds.length > 0) {
    await FleetCatalogItemModel.updateMany(
      { _id: { $in: companyIds } },
      { $set: { violationSide: 'company' } },
    );
  }
  logger.info(
    { driver: driverIds.length, company: companyIds.length },
    'fleet: violation type sides backfilled',
  );
  return { driver: driverIds.length, company: companyIds.length };
};

/**
 * Point existing driver profiles at the new «التخصص» catalog, from the enum they already carry.
 *
 * The three-value enum became a `driverSpecialization` catalog because three values could not
 * express the four the house actually runs. Two of them have an exact successor and are converted;
 * the third does not, and that is stated rather than guessed:
 *
 *   cashTransport → «نقل اموال»
 *   atm           → «ATM»
 *   both          → NOTHING. The new vocabulary has no "both", and picking one of the two — or
 *                   inventing a fifth item — would put a classification in a person's file that
 *                   nobody made. Those profiles keep their enum, read as unclassified by the new
 *                   filters, and are counted in the log so an admin knows exactly how many to set.
 *
 * Non-destructive and idempotent like its neighbours: the legacy column is never cleared, only a
 * profile with no reference yet is touched, and the catalog is READ rather than seeded — if the
 * boot seed has not created «نقل اموال» there is nothing to point at, and nothing is invented.
 */
const SPECIALIZATION_SUCCESSOR: Record<string, string> = {
  cashTransport: 'نقل اموال',
  atm: 'ATM',
};

export const migrateDriverSpecializations = async (): Promise<{
  converted: number;
  unmapped: number;
}> => {
  const pending = await FleetDriverProfileModel.find(
    { isDeleted: false, specializationId: null, specialization: { $nin: [null, ''] } },
    { _id: 1, specialization: 1 },
  )
    .lean<{ _id: unknown; specialization: string | null }[]>()
    .exec();
  if (pending.length === 0) return { converted: 0, unmapped: 0 };

  const items = await FleetCatalogItemModel.find(
    { kind: 'driverSpecialization', isDeleted: false },
    { _id: 1, name: 1 },
  )
    .lean<{ _id: unknown; name: { ar: string } }[]>()
    .exec();
  const byName = new Map(items.map((item) => [item.name.ar, item._id]));

  let converted = 0;
  let unmapped = 0;
  for (const row of pending) {
    const successor = SPECIALIZATION_SUCCESSOR[row.specialization ?? ''];
    const id = successor === undefined ? undefined : byName.get(successor);
    if (id === undefined) {
      unmapped += 1;
      continue;
    }
    await FleetDriverProfileModel.updateOne({ _id: row._id }, { $set: { specializationId: id } });
    converted += 1;
  }
  logger.info(
    { converted, unmapped },
    'fleet: driver specializations backfilled from the legacy enum — unmapped profiles keep it and read as unclassified until an admin chooses',
  );
  return { converted, unmapped };
};

/**
 * Build `ux_fixed_vehicle`, the index that makes "one vehicle, one fixed crew" a database fact.
 *
 * The schema declares it, but `autoIndex` is off outside development
 * (infrastructure/database/mongo.ts), so a schema-declared index does not appear on its own in
 * production — this is the deploy step that builds it, the same way the users module builds its
 * external-subject index. Idempotent: `createIndex` with a definition that already exists is a
 * no-op, so every boot after the first one costs a round trip and nothing else.
 *
 * DUPLICATES ARE CHECKED FIRST, and a duplicate is REPORTED, never resolved. Building a unique
 * index over data that violates it fails anyway (`E11000`), but the reason for looking first is
 * not to avoid the error — it is to say WHICH vehicles are affected, in a log line an operator
 * can act on. Merging two crews would have to guess which drivers to keep, and deleting one would
 * destroy an assignment somebody made: both invent an answer the data does not contain. So the
 * index is simply not built until a person has resolved them, and the service's own end-state
 * checks keep holding in the meantime.
 *
 * The only writer of this collection is the fixed-crew repository, and the only shape it writes
 * is one row per vehicle — so on a database that has only ever run this code, there is nothing
 * to find. The check is for the ones that have not.
 */
export const migrateFixedCrewIndex = async (): Promise<{
  created: boolean;
  duplicateVehicles: number;
}> => {
  try {
    // Grouped under the SAME filter the index is partial on, or the count would answer a
    // different question from the one the index asks.
    const duplicates = await FleetFixedCrewModel.collection
      .aggregate<{ _id: unknown; rows: number; docIds: unknown[] }>([
        { $match: { isDeleted: false } },
        { $group: { _id: '$vehicleId', rows: { $sum: 1 }, docIds: { $push: '$_id' } } },
        { $match: { rows: { $gt: 1 } } },
      ])
      .toArray();

    if (duplicates.length > 0) {
      logger.error(
        {
          vehicles: duplicates.map((d) => ({
            vehicleId: String(d._id),
            rows: d.rows,
            docIds: d.docIds.map(String),
          })),
        },
        'fleet: fixed crews hold more than one row for a vehicle — ux_fixed_vehicle NOT built; resolve these rows by hand, nothing has been deleted or merged',
      );
      return { created: false, duplicateVehicles: duplicates.length };
    }

    await FleetFixedCrewModel.collection.createIndex(
      FIXED_CREW_VEHICLE_INDEX_KEY,
      FIXED_CREW_VEHICLE_INDEX_OPTIONS,
    );
    return { created: true, duplicateVehicles: 0 };
  } catch (error) {
    // A boot must not fail because an index could not be built; the log is the signal.
    logger.warn({ err: error }, 'fleet: fixed-crew index migration skipped');
    return { created: false, duplicateVehicles: 0 };
  }
};

export const runFleetMigrations = async (): Promise<void> => {
  await migrateVehicleLicenseClasses();
  await migrateViolationTypeSides();
  // After the seed above has created «نقل اموال» and «ATM» — it reads the catalog, never writes it.
  await migrateDriverSpecializations();
  await reportBranchlessVehicles();
  await migrateFixedCrewIndex();
  // Every OTHER index the Fleet schemas declare — the deploy step ADR-005 promises and the
  // repository did not have. `migrateFixedCrewIndex` above stays as it is: it is referenced by
  // name in its own tests and carries the duplicate-reporting rationale this step generalises.
  // It runs first, so the index it owns is simply already present by the time this arrives.
  await migrateFleetIndexes();
};
