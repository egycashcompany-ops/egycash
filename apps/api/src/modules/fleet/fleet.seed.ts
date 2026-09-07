// Fleet boot seed — create-if-missing, safe on every boot. Seeds the catalog rows the frozen
// design names explicitly: the alarm-counting work type (the legacy alarm counted from
// works="صيانة"), the roster's default mission type, and the violation types the legacy had
// hardcoded in its views (§10-H7). Everything else is admin-entered.
import { type FleetViolationSide } from '@ecms/contracts';
import { fleetCatalogItemService } from './catalogs/catalog-item.service';
import { ensureVehicleDocsCategory } from './vehicles/vehicle-files';
import { ensureDriverDocsCategory } from './driver-profiles/driver-files';
import { runFleetMigrations } from './fleet.migration';

export const seedFleet = async (): Promise<void> => {
  // The Files categories the licence images write into — before any upload can ask for one.
  await ensureVehicleDocsCategory();
  await ensureDriverDocsCategory();

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

  // WHICH HALF FILES IT is now data, not a comment. The violations screen is two ledgers — what
  // the company pays and what a driver pays — and each form offers only its own side's types.
  const violationTypes: { ar: string; en: string; side: FleetViolationSide }[] = [
    { ar: 'الانتظار في الممنوع', en: 'Illegal parking', side: 'company' },
    { ar: 'تعمد تعطيل المرور', en: 'Deliberate traffic obstruction', side: 'company' },
    { ar: 'عدم اتباع تعليمات المرور', en: 'Disobeying traffic instructions', side: 'company' },
    { ar: 'رسوم قضائية', en: 'Court fees', side: 'company' },
    { ar: 'رسوم خدمة', en: 'Service fees', side: 'company' },
    // Driver-level types (legacy `ح`/`ت` codes, written out — codes were a UI shorthand).
    { ar: 'سرعة', en: 'Speeding', side: 'driver' },
    { ar: 'عكس', en: 'Wrong way', side: 'driver' },
    { ar: 'تليفون', en: 'Phone while driving', side: 'driver' },
    { ar: 'حزام', en: 'Seatbelt', side: 'driver' },
  ];
  for (const { side, ...name } of violationTypes) {
    await fleetCatalogItemService.ensure({
      kind: 'violationType',
      name,
      countsForAlarm: false,
      violationSide: side,
    });
  }

  // The three catalogs added for the vehicle registry (licenseClass, operation, insuranceCompany)
  // are deliberately NOT seeded with values: the admin names them, and guessing a house's
  // operating groups or insurers would put fiction in a dropdown people then pick from. The
  // migration below is the ONLY thing that creates licenseClass items, and only from real data.
  await runFleetMigrations();
};
