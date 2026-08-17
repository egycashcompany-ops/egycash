// Fleet boot seed — create-if-missing, safe on every boot. Seeds the catalog rows the frozen
// design names explicitly: the alarm-counting work type (the legacy alarm counted from
// works="صيانة"), the roster's default mission type, and the violation types the legacy had
// hardcoded in its views (§10-H7). Everything else is admin-entered.
import { fleetCatalogItemService } from './catalogs/catalog-item.service';
import { ensureVehicleDocsCategory } from './vehicles/vehicle-files';
import { runFleetMigrations } from './fleet.migration';

export const seedFleet = async (): Promise<void> => {
  // The Files category the vehicle license image writes into — before any upload can ask for it.
  await ensureVehicleDocsCategory();

  await fleetCatalogItemService.ensure({
    kind: 'workType',
    name: { ar: 'صيانة', en: 'Periodic maintenance' },
    countsForAlarm: true,
  });
  await fleetCatalogItemService.ensure({
    kind: 'missionType',
    name: { ar: 'نقل أموال (يومي)', en: 'Cash transport (daily)' },
    countsForAlarm: false,
  });

  const vehicleViolationTypes: { ar: string; en: string }[] = [
    { ar: 'الانتظار في الممنوع', en: 'Illegal parking' },
    { ar: 'تعمد تعطيل المرور', en: 'Deliberate traffic obstruction' },
    { ar: 'عدم اتباع تعليمات المرور', en: 'Disobeying traffic instructions' },
    { ar: 'رسوم قضائية', en: 'Court fees' },
    { ar: 'رسوم خدمة', en: 'Service fees' },
    // Driver-level types (legacy `ح`/`ت` codes, written out — codes were a UI shorthand).
    { ar: 'حزام', en: 'Seatbelt' },
    { ar: 'تليفون', en: 'Phone while driving' },
  ];
  for (const name of vehicleViolationTypes) {
    await fleetCatalogItemService.ensure({ kind: 'violationType', name, countsForAlarm: false });
  }

  // The three catalogs added for the vehicle registry (licenseClass, operation, insuranceCompany)
  // are deliberately NOT seeded with values: the admin names them, and guessing a house's
  // operating groups or insurers would put fiction in a dropdown people then pick from. The
  // migration below is the ONLY thing that creates licenseClass items, and only from real data.
  await runFleetMigrations();
};
