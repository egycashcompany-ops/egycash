// Fleet boot seed — create-if-missing, safe on every boot. Seeds the catalog rows the frozen
// design names explicitly: the alarm-counting work type (the legacy alarm counted from
// works="صيانة"), the roster's default mission type, and the violation types the legacy had
// hardcoded in its views (§10-H7). Everything else is admin-entered.
import { type FleetCatalogKind, type FleetViolationSide } from '@ecms/contracts';
import { logger } from '../../infrastructure/logging/logger';
import { fleetCatalogItemService } from './catalogs/catalog-item.service';
import { startGoLiveReset } from './go-live/reset';
import { applyFleetVocabulary, planFleetVocabulary } from './go-live/vocabulary';
import { ensureVehicleDocsCategory } from './vehicles/vehicle-files';
import { ensureDriverDocsCategory } from './driver-profiles/driver-files';
import { runFleetMigrations } from './fleet.migration';

export const seedFleet = async (): Promise<void> => {
  // THE GO-LIVE RESET, FIRST. Once per database it clears the owner's test data off eight Fleet
  // screens — see `go-live/reset.ts` for the list and for the five things it spares. It has to
  // precede every catalog write below, because the vocabulary seeded further down lands in the
  // same collection it clears, and a reset that ran after the seed would wipe what the seed had
  // just written. Awaited, because it is the one go-live step that IS part of the boot: a few
  // `deleteMany` calls, and a precondition of everything after it.
  await startGoLiveReset();

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

  // The DRIVERS registry's three vocabularies (الوظيفة / التخصص / الرخصة). Seeded, unlike the
  // vehicle registry's three below, because these are not a house's own invention to name from
  // scratch: they are the lists the drivers screen was already asked for, and an empty dropdown
  // on day one is what makes an admin type the values into a code file instead. Every one of them
  // is ordinary catalog data — renamable, archivable, and extendable from /fleet/catalogs.
  const driverCatalogs: { kind: FleetCatalogKind; ar: string; en: string }[] = [
    { kind: 'driverJob', ar: 'سائق أ', en: 'Driver A' },
    { kind: 'driverJob', ar: 'سائق ب', en: 'Driver B' },
    { kind: 'driverJob', ar: 'سائق ج', en: 'Driver C' },
    { kind: 'driverJob', ar: 'سائق صراف الى', en: 'ATM teller driver' },
    { kind: 'driverSpecialization', ar: 'نقل اموال', en: 'Cash transport' },
    { kind: 'driverSpecialization', ar: 'ملاكى', en: 'Private car' },
    { kind: 'driverSpecialization', ar: 'ATM', en: 'ATM' },
    { kind: 'driverSpecialization', ar: 'سزوكى', en: 'Suzuki' },
    { kind: 'driverLicenseType', ar: 'اولى', en: 'First class' },
    { kind: 'driverLicenseType', ar: 'تانيه', en: 'Second class' },
  ];
  for (const { kind, ...name } of driverCatalogs) {
    await fleetCatalogItemService.ensure({ kind, name, countsForAlarm: false });
  }

  // The three catalogs added for the vehicle registry (licenseClass, operation, insuranceCompany)
  // are deliberately NOT seeded with values: the admin names them, and guessing a house's
  // operating groups or insurers would put fiction in a dropdown people then pick from. The
  // migration below is the ONLY thing that creates licenseClass items, and only from real data.
  //
  // …EXCEPT the insurers, which the house handed over by name and which therefore are not a guess.
  // They arrive with the 167 names below.

  // THE HOUSE'S OWN VOCABULARY — workshops, work types, spare parts, mission types, insurers.
  //
  // It is applied HERE, and that is the correction: the list shipped in #446 as a library behind
  // `npm run seed:fleet-vocabulary`, so it reached a merged branch and never a screen. There is no
  // difference in kind between these names and the driver catalogs above — both are lists the
  // house named, both are ordinary catalog data an admin can rename or archive afterwards — so
  // there is no reason for one to arrive with a deploy and the other to wait for a command.
  //
  // `by` is null: nobody pressed anything. The plan is computed first so the log says what it did
  // rather than how many rows it looked at, and `create`-if-missing means the hundredth boot is a
  // hundred index hits and no writes.
  const vocabulary = await applyFleetVocabulary(await planFleetVocabulary(), null);
  if (vocabulary.changes.length > 0) {
    logger.info(
      {
        created: vocabulary.changes.filter((c) => c.action === 'create').length,
        flagged: vocabulary.changes.filter((c) => c.action === 'flag').length,
        unchanged: vocabulary.unchanged,
      },
      'fleet: house vocabulary applied',
    );
  }

  await runFleetMigrations();

  // THE VEHICLE REGISTRY IS NOT STARTED HERE, and the reason is worth the paragraph.
  //
  // It was, in the first draft. The seed is where it belongs by symmetry — the names above arrive
  // this way, and the owner asked for the cars to arrive «like the names». But the seed runs
  // inside `bootPlatform`, and TEN short-lived entrypoints call `bootPlatform`: `seed.ts` and nine
  // CLIs. Each ends by calling `disconnectMongo()` and `process.exit()` the moment its own work is
  // done — so each would have started a 209-car import and then pulled the connection and the
  // process out from under it, leaving the mark claimed and the registry half written. Nothing
  // recovers that on its own: the mark says «done» and the next boot honours it.
  //
  // So the import is started by the two processes that STAY ALIVE — `server.ts` and `worker.ts`
  // — through `startVehicleGoLive`, which the module exports for exactly that. The run's lease
  // decides which of the two does it, and hands the job on if that one dies. Nothing about the
  // owner's experience changes: it is still the deploy that carries the cars in, with nobody
  // typing anything.
};
