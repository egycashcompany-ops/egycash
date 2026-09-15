// The go-live vehicle import, as a BOOT STEP — 209 cars and their licence scans, applied by the
// deploy rather than by a person at a shell.
//
// WHY THIS EXISTS AT ALL. The import shipped as a CLI (#447) and nothing ran it, so the merge
// landed and the registry stayed empty. That is not a deployment fault: the pull request contained
// a library and a command and no line of code that ever executes itself. Everything else the Fleet
// module needs on a fresh database — the violation types, the driver catalogs, the file categories
// — is seeded on boot, and the cars are now seeded the same way, so «merge, wait, refresh» is the
// whole procedure.
//
// THE RACE THE CLI WAS AVOIDING IS SOLVED, NOT IGNORED. `fleet-vehicles-import.cli.ts` said a
// boot-time import "would race itself", because `server.ts` and `worker.ts` both boot the platform
// with no leader election between them. `markOnce` IS the leader election: it inserts against a
// unique index and returns true to exactly one caller, whichever process gets there first, even
// when both arrive in the same millisecond. The losing process does nothing.
//
// IT RUNS ONCE PER DATABASE, FOREVER — and that is the difference between a seed and this. The
// catalogs beside it are `ensure`d on every boot because re-creating a missing name is harmless.
// A vehicle is not: `applyImport` UPDATES a car it finds by code, so a step that ran on every boot
// would overwrite every correction an admin had made since, and restore every car they had
// deleted, at the next restart. The mark makes the import a one-time event that a restart, a
// rollback, a scale-up or a redeploy cannot repeat.
//
// IT IS NOT ON THE BOOT'S CRITICAL PATH. `server.ts` calls `app.listen()` only after
// `bootPlatform()` returns, and `railway.json` fails the deploy if `/health/ready` has not
// answered within 300s, then retries up to 10 times. 209 cars and 23MB of scans through the Files
// pipeline is not obviously under that budget on a database nobody here can measure — and the
// failure mode is the worst one available: the healthcheck kills a deploy that is halfway through
// writing, the mark is already claimed, and the retry imports nothing. So the boot starts this and
// does not wait for it. The port opens on time whatever the import is doing.
//
// NOTHING IT DOES CAN FAIL A BOOT. Every path returns or logs; none throws. A module seed that
// throws fails the boot loudly and correctly — for a broken module. An import of business data is
// not that: cars that did not arrive are a thing to read in a log and fix, never a reason for the
// platform to refuse to start.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { userService } from '../../../platform/users';
import { type AuthContext } from '../../../shared/types';
import { markOnce } from '../sweeps/sweep-mark.model';
import { applyImport, parseCars, planImport } from './vehicles-import';

/**
 * The idempotency key. Versioned, so a future correction to the source data can be applied by
 * bumping it — which is a deliberate, reviewable act, not something a redeploy does by accident.
 */
export const VEHICLE_GO_LIVE_MARK = 'go-live:vehicles:v1';

/**
 * Where the committed data sits at run time.
 *
 * Two places, because there are two ways this module runs. Under `tsx` the source tree is live and
 * the folder is four levels up at `apps/api/assets`; in the deployed image everything is one
 * bundled `dist/server.js`, and `tsup`'s `publicDir` has copied the same folder in beside it.
 * Neither path is guessed at — each is checked for `cars.json` before it is used, and a build that
 * somehow shipped without the assets reports that instead of importing nothing in silence.
 */
const DATA_DIR_CANDIDATES = ['fleet-go-live', '../../../../assets/fleet-go-live'];

export const resolveGoLiveDataDir = (): string | null => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of DATA_DIR_CANDIDATES) {
    const dir = join(here, candidate);
    if (existsSync(join(dir, 'cars.json'))) return dir;
  }
  return null;
};

/**
 * The privileged context the import acts as — the same grants the CLI names, for the same reason.
 *
 * `fleetVehicle.edit` is the one that is easy to miss and impossible to notice: the licence scan
 * goes through the Files service, whose ADR-023 authorizer re-asks Fleet «may this caller edit
 * THIS vehicle?» and answers no for a context that can create a car but not edit one. The first
 * run of the CLI wrote all 209 cars and zero photos because of exactly that.
 */
const goLiveContext = (adminId: string): AuthContext => ({
  userId: adminId,
  sessionId: 'go-live:vehicles',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
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

/**
 * Run the import, once, and report.
 *
 * Exported so a test can await the whole thing; the boot uses `startVehicleGoLive` below, which is
 * this without the waiting.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE MARK IS CLAIMED. That ordering is the whole recovery story: a
 * run refused for a missing branch leaves the mark unclaimed, so adding the branch and redeploying
 * imports the cars. A run refused AFTER claiming would have locked the data out permanently, and
 * the refusals are exactly the conditions an operator is expected to go and fix.
 */
export const runVehicleGoLive = async (dataDir?: string): Promise<void> => {
  // The override exists for the tests, which drive this against a couple of cars in a temp folder
  // rather than the real 209 — what is under test is the mark, the refusals and their ORDER, and
  // none of that is demonstrated better by a slower fixture.
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the vehicle data is not in this build — apps/api/assets/fleet-go-live is missing, so no car was imported',
    );
    return;
  }

  const parsed = parseCars(JSON.parse(await readFile(join(dir, 'cars.json'), 'utf8')));
  const photoDir = join(dir, 'license-photos');
  const photoNames = new Set(existsSync(photoDir) ? await readdir(photoDir) : []);

  if (parsed.rejected.length > 0) {
    logger.error(
      { rows: parsed.rejected },
      'fleet go-live: rows that cannot be read — nothing was imported, and the mark is NOT set, so a corrected build will import them',
    );
    return;
  }

  // The seeding admin authors every row, so an imported car is attributable exactly like one
  // somebody typed. Looked up BEFORE the mark for the same reason the refusals are: a deployment
  // that has not been seeded yet must be able to try again after it has.
  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the import — run the seed first; nothing was imported and the mark is NOT set',
    );
    return;
  }

  const plan = await planImport(parsed, photoNames);
  if (plan.missingBranches.length > 0 || plan.identifierClashes.length > 0) {
    logger.error(
      { branches: plan.missingBranches, clashes: plan.identifierClashes },
      'fleet go-live: refused — add the missing branches in /system, or resolve the plate/chassis/motor numbers another vehicle already holds. Nothing was imported and the mark is NOT set, so the next boot after the fix will import them',
    );
    return;
  }
  if (plan.missingPhotos.length > 0) {
    logger.warn(
      { codes: plan.missingPhotos },
      'fleet go-live: these cars name a licence scan the folder does not have — they import without one',
    );
  }

  // THE POINT OF NO RETURN. From here the data is going in, and no later boot will do this again.
  if (!(await markOnce(VEHICLE_GO_LIVE_MARK))) return;

  logger.info(
    { cars: plan.cars.length, toCreate: plan.toCreate.length, toUpdate: plan.toUpdate.length },
    'fleet go-live: importing the vehicle registry — this runs once and never again',
  );
  const outcome = await applyImport(plan, photoDir, photoNames, goLiveContext(String(admin._id)));
  const counts = { created: outcome.created, updated: outcome.updated, photos: outcome.photos };
  if (outcome.failures.length > 0) {
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: vehicle import finished WITH FAILURES — the mark is set, so these cars will NOT be retried by a later boot; finish them with `node apps/api/dist/fleet-vehicles-import.cli.js --write`',
    );
    logger.error(counts, 'fleet go-live: partial import');
    return;
  }
  logger.info(counts, 'fleet go-live: vehicle registry imported');
};

/**
 * What the boot seed calls: start the import and carry on.
 *
 * DELIBERATELY NOT AWAITED — see the header. The promise cannot reject: `runVehicleGoLive` returns
 * on every refusal and this catches anything left, so `void` here is a statement that there is
 * nothing to wait for, not a dropped error.
 *
 * SKIPPED UNDER TEST, like the queue and the cache before it. Every integration suite boots the
 * platform against its own fresh database, where the mark is unclaimed — without this, all 209
 * cars would be imported into every one of them, ahead of the fixtures the suite then builds.
 */
export const startVehicleGoLive = (): void => {
  if (isTest) return;
  void runVehicleGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: vehicle import failed — no boot was harmed');
  });
};
