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
// with no leader election between them. THE LEASE IS the leader election: `claimGoLiveRun` is one
// upsert against a unique key and succeeds for exactly one caller, whichever process gets there
// first, even when both arrive in the same millisecond. The losing process does nothing.
//
// IT RUNS TO COMPLETION ONCE PER DATABASE — and that is the difference between a seed and this.
// The catalogs beside it are `ensure`d on every boot because re-creating a missing name is
// harmless. A vehicle is not: `applyImport` UPDATES a car it finds by code, so a step that ran on
// every boot would overwrite every correction an admin had made since, and restore every car they
// had deleted, at the next restart. A run that reached `done` is therefore never repeated by a
// restart, a rollback, a scale-up or a redeploy.
//
// «TO COMPLETION» IS THE PART v1 GOT WRONG. It claimed a once-only mark and was cut off in
// production between creating the vehicle types and creating the vehicles — and because the mark
// read «done» from the moment it was claimed, no boot afterwards would touch it, and the owner has
// no shell to finish it from. The claim is a LEASE now (`go-live-run.model.ts`): a run that dies
// leaves a lease that expires, and the next boot after that takes the job over and finishes it.
// The import is re-runnable by construction, so taking it over is safe.
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
import { claimGoLiveRun, finishGoLiveRun } from './go-live-run.model';
import { applyImport, parseCars, planImport } from './vehicles-import';

/**
 * The run key. Versioned, so a correction to the source data — or, as here, a re-import after the
 * go-live reset cleared the catalogs the first run's cars pointed at — is applied by bumping it,
 * which is a deliberate, reviewable act and not something a redeploy does by accident.
 *
 * v1 is the run that was cut off in production; v2 is the one that finishes.
 */
export const VEHICLE_GO_LIVE_MARK = 'go-live:vehicles:v2';

/**
 * How long a claim is honoured before another boot may take the job over. The whole import took
 * nine seconds on a fresh database; thirty minutes is «this process is certainly dead», not
 * «this process is probably slow», so two live processes never both believe they hold it.
 */
export const VEHICLE_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

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
 * EVERY REFUSAL HAPPENS BEFORE THE RUN IS CLAIMED. That ordering is the whole recovery story: a
 * run refused for a missing branch leaves the run unclaimed, so adding the branch and redeploying
 * imports the cars at once, with no lease to wait out. The refusals are exactly the conditions an
 * operator is expected to go and fix.
 */
export const runVehicleGoLive = async (dataDir?: string): Promise<void> => {
  // The override exists for the tests, which drive this against a couple of cars in a temp folder
  // rather than the real 209 — what is under test is the lease, the refusals and their ORDER, and
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
      'fleet go-live: rows that cannot be read — nothing was imported and the run is NOT claimed, so a corrected build will import them',
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
      'fleet go-live: no seeded admin to author the import — run the seed first; nothing was imported and the run is NOT claimed',
    );
    return;
  }

  const plan = await planImport(parsed, photoNames);
  if (plan.missingBranches.length > 0 || plan.identifierClashes.length > 0) {
    logger.error(
      { branches: plan.missingBranches, clashes: plan.identifierClashes },
      'fleet go-live: refused — add the missing branches in /system, or resolve the plate/chassis/motor numbers another vehicle already holds. Nothing was imported and the run is NOT claimed, so the next boot after the fix will import them',
    );
    return;
  }
  if (plan.missingPhotos.length > 0) {
    logger.warn(
      { codes: plan.missingPhotos },
      'fleet go-live: these cars name a licence scan the folder does not have — they import without one',
    );
  }

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(VEHICLE_GO_LIVE_MARK, VEHICLE_GO_LIVE_LEASE_MS))) return;

  logger.info(
    { cars: plan.cars.length, toCreate: plan.toCreate.length, toUpdate: plan.toUpdate.length },
    'fleet go-live: importing the vehicle registry',
  );
  const outcome = await applyImport(plan, photoDir, photoNames, goLiveContext(String(admin._id)));
  const counts = { created: outcome.created, updated: outcome.updated, photos: outcome.photos };
  if (outcome.failures.length > 0) {
    // NOT finished. The lease is left to expire, so the next boot after it takes the job over and
    // — every car already in being an update — completes exactly what this run did not.
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: vehicle import finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    logger.error(counts, 'fleet go-live: partial import');
    return;
  }
  await finishGoLiveRun(VEHICLE_GO_LIVE_MARK, counts);
  logger.info(counts, 'fleet go-live: vehicle registry imported — done, and never again');
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
