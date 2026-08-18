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
import { FleetVehicleModel } from './vehicles/vehicle.model';

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

export const runFleetMigrations = async (): Promise<void> => {
  await migrateVehicleLicenseClasses();
  await reportBranchlessVehicles();
};
