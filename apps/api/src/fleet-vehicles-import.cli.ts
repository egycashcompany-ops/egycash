// Go-live vehicle import — the operator-invoked entrypoint.
//
//   npm run import:vehicles -- --file ./cars.json --photos ./cars_license_photos
//   npm run import:vehicles -- --file ./cars.json --photos ./cars_license_photos --write
//
// DRY RUN IS THE DEFAULT, so the harmless invocation is also the shortest to type — the same
// bargain `import:workforce` makes. Without `--write` it reads both inputs, resolves every name
// against the live system, prints exactly what it would do, and writes nothing at all.
//
// IT IS RE-RUNNABLE. A car already in the registry is UPDATED rather than duplicated, matched on
// its code, so a run that fails halfway is finished by running it again — not unpicked by hand.
//
// IT REFUSES RATHER THAN GUESSES in exactly two places, and both are reported before any write:
//
//   • a BRANCH the data names that the organisation does not have. A branch is not a Fleet fact —
//     HR, Gold and every user's data scope point at the same registry — and creating one needs a
//     company code only the company can decide. Add them in /system first.
//   • a row that cannot be READ: a missing code, plate, chassis, motor, branch or date, or a code
//     that appears twice among the live rows. The registry's unique index would catch the
//     duplicate halfway through; catching it here means nothing is written at all.
//
// A CLI AND NOT A BOOT STEP, deliberately: `server.ts` and `worker.ts` both boot the platform with
// no leader election between them, so a boot-time import would race itself.
import { readFile, readdir } from 'node:fs/promises';
import { logger } from './infrastructure/logging/logger';
import { disconnectMongo } from './infrastructure/database/mongo';
import { closeCache } from './infrastructure/redis/cache';
import { closeQueues } from './infrastructure/queue/jobs';
import { bootPlatform } from './platform/kernel/bootstrap';
import { moduleManifests } from './modules';
import { env } from './infrastructure/config/env';
import { userService } from './platform/users';
import { type AuthContext } from './shared/types';
import { assertLoginProvisioningDisabled } from './workforce-boot-guard';
import { applyImport, parseCars, planImport, type ImportPlan } from './fleet-vehicles-import';

const flag = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
};

/**
 * The privileged context the import acts as. Every row is audited under the seeding admin, so an
 * imported car is attributable exactly like one somebody typed.
 */
const importContext = (adminId: string): AuthContext => ({
  userId: adminId,
  sessionId: 'import-vehicles',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  // THE GRANTS THE ENDPOINTS THEMSELVES ASK FOR, named one by one rather than guessed at.
  //
  // `fleetVehicle.edit` is the one that is easy to miss and impossible to notice: the licence scan
  // goes through the Files service, whose ADR-023 authorizer re-asks Fleet «may this caller edit
  // THIS vehicle?» — and answers no for a context that can create a car but not edit one. The
  // first run of this import wrote all 209 cars and zero photos because of exactly that.
  permissions: {
    'fleetVehicle.view': 'organization',
    'fleetVehicle.create': 'organization',
    'fleetVehicle.edit': 'organization',
    'fleetCatalog.manage': 'organization',
    'file.view': 'organization',
    'file.download': 'organization',
  },
  permissionVersion: 0,
  isPrivileged: true,
});

const report = (plan: ImportPlan, skippedDeleted: number): void => {
  logger.info(
    {
      cars: plan.cars.length,
      create: plan.toCreate.length,
      update: plan.toUpdate.length,
      withPhoto: plan.withPhoto.length,
      skippedDeleted,
    },
    'vehicles read',
  );
  if (plan.newTypes.length > 0) {
    // Loud: every one of these is created with NO service distance, so the maintenance alarm
    // cannot fire for any car of that type until somebody fills the number in.
    logger.warn(
      { count: plan.newTypes.length, names: plan.newTypes },
      'vehicle types that will be created with maintenanceIntervalKm = 0 — the alarm stays off for them until it is set on /fleet/settings',
    );
  }
  for (const kind of ['licenseClass', 'operation', 'insuranceCompany'] as const) {
    const names = plan.newCatalog.filter((entry) => entry.kind === kind).map((e) => e.name);
    if (names.length > 0) logger.info({ kind, names }, 'catalog entries that will be created');
  }
  for (const near of plan.nearMatches) {
    logger.warn(
      { kind: near.kind, incoming: near.incoming, existing: near.existing },
      'about to create a name one hamza from one already there — decide which spelling the house uses before writing',
    );
  }
  if (plan.missingPhotos.length > 0) {
    logger.warn(
      { codes: plan.missingPhotos },
      'these cars name a licence scan the photo folder does not have — they import without one',
    );
  }
};

const main = async (): Promise<void> => {
  // BEFORE ANYTHING, because `bootPlatform` below runs HR's login backfill: a login for every
  // employed employee that has none, and a WhatsApp message and an email to each carrying a setup
  // link. That happens before this command reads a row, so the DRY RUN would send them too, and
  // nothing recalls a delivered message. See `workforce-boot-guard.ts` — the two workforce tools
  // already guard on it, and anything else that boots the platform from a shell has to as well.
  assertLoginProvisioningDisabled('import:vehicles');

  const file = flag('file');
  const photos = flag('photos');
  const write = process.argv.includes('--write');
  if (file === null || file === '' || photos === null || photos === '') {
    throw new Error('usage: --file <cars.json> --photos <folder> [--write]');
  }

  let failed = 0;
  const parsed = parseCars(JSON.parse(await readFile(file, 'utf8')));
  const photoNames = new Set(await readdir(photos));

  await bootPlatform({ modules: moduleManifests });
  const plan = await planImport(parsed, photoNames);
  report(plan, parsed.skippedDeleted);

  // BOTH REFUSALS ARE CHECKED BEFORE THE WRITE, and they stop the dry run too — a plan that could
  // not be applied is not a plan worth reading as if it could.
  if (parsed.rejected.length > 0) {
    logger.error({ rows: parsed.rejected }, 'rows that cannot be read — nothing was imported');
  }
  if (plan.identifierClashes.length > 0) {
    logger.error(
      { clashes: plan.identifierClashes },
      'these plate / chassis / motor numbers are already held by another vehicle — the database would reject them mid-run; fix the source rows first. Nothing was imported',
    );
  }
  if (plan.missingBranches.length > 0) {
    logger.error(
      { branches: plan.missingBranches },
      'these branches are not in the organisation — add them in /system first; nothing was imported',
    );
  }
  // A NEAR-MATCH STOPS A WRITE, and warning was not enough. Catalogs have no delete route, so the
  // duplicate «نقل اموال» beside «نقل أموال» is permanent the moment it is written, and it splits
  // every filter that uses either. The dry run still shows it — this only refuses to make the
  // decision on the operator's behalf. `--allow-near-duplicates` is how they say they have decided.
  const acknowledged = process.argv.includes('--allow-near-duplicates');
  const nearBlocks = write && plan.nearMatches.length > 0 && !acknowledged;
  if (nearBlocks) {
    logger.error(
      { pairs: plan.nearMatches },
      'refusing to write while a name is one character from one already in the catalog — fix the spelling in the source file, or pass --allow-near-duplicates if both really are separate things',
    );
  }
  const blocked =
    parsed.rejected.length > 0 ||
    plan.missingBranches.length > 0 ||
    plan.identifierClashes.length > 0 ||
    nearBlocks;

  if (blocked) {
    logger.error('import refused');
  } else if (!write) {
    logger.info('dry run — no vehicle, catalog or file was written. Re-run with --write to apply');
  } else {
    const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
    if (admin === null) {
      throw new Error(`seed admin ${env.SEED_ADMIN_EMAIL} not found — run \`npm run seed\` first`);
    }
    const outcome = await applyImport(plan, photos, photoNames, importContext(String(admin._id)));
    failed = outcome.failures.length;
    const counts = { created: outcome.created, updated: outcome.updated, photos: outcome.photos };
    if (failed > 0) {
      logger.error(
        { count: failed, failures: outcome.failures },
        'cars that did not import — re-running finishes them, since an existing car is an update',
      );
      // NOT "complete". A run in which every car failed used to end on the same cheerful line as
      // one that worked, and exit 0 with it — the single outcome where the operator is told the
      // opposite of what happened.
      logger.error(counts, 'vehicle import finished WITH FAILURES — see the list above');
    } else {
      logger.info(counts, 'vehicle import complete');
    }
  }

  await Promise.allSettled([disconnectMongo(), closeCache(), closeQueues()]);
  // Non-zero for a refusal AND for a run that lost cars: an exit code is what a shell script, a
  // scheduler or a person scrolling past the logs actually reads.
  process.exit(blocked || failed > 0 ? 1 : 0);
};

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'vehicle import failed');
  process.exit(1);
});
