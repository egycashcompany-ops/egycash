// The go-live DRIVER LICENCE SCANS, as a boot step — one photo per driver, named for the driver's
// employee code, attached to that driver's profile by the deploy.
//
// «ضيف صور السائقين كل سواق بالكود الصوره بتاعت الرخصه اسمها زى اسم الكود بتاعه نفس موضوع
// العربيات». The vehicle step's shape, on the drivers registry: the same lease, the same
// refusals-before-the-claim, the same «not on the boot's critical path», the same «nothing here
// can fail a boot». `vehicles.ts` explains each of those at length; this file explains only what
// is different about a person.
//
// THE CODE IS THE JOIN. A scan is `0100026.jpg` because the company's employee codes are
// `0100026` — branch `010` and number `0026`, `employee-number.ts` — and the registry answers «who
// is a driver» from the org chart (`drivingSeatRoster`): everyone in a seat whose job title
// requires a driving test. Each file is matched to a driving-seat employee by its stem and by
// nothing else: not a name, not a guess. A stem that is nobody's code is REPORTED and skipped,
// because the employee is an HR fact this step may not invent — and a run that waited for HR
// would retry on every boot for as long as one scan had nobody to belong to.
//
// A PROFILE IS OPENED WHERE NONE EXISTS. `fleet_driver_profiles` is what Fleet has recorded about
// a driver, and a licence scan is such a record — a driver nobody has yet enrolled is enrolled
// here with nothing filled in but the scan, exactly as the registry's own «record the licence»
// action enrols one.
//
// IT IS IDEMPOTENT PER FILE, which is what makes the lease's take-over safe HERE. The vehicles
// could rely on «update by code»; a licence image cannot, because `setLicenseImage` REPLACES, and
// a retry that re-uploaded would stack a new version on every driver each time a lease lapsed. So
// a profile whose current scan is already this file is left alone and counted as kept.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, parse } from 'node:path';
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { getDirectoryEmployeeByCode, type DirectoryEmployee } from '../../../platform/directory';
import { userService } from '../../../platform/users';
import { type AuthContext } from '../../../shared/types';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { fleetDriverProfileService } from '../driver-profiles/driver-profile.service';
import { drivingSeatRoster } from '../driver-profiles/driving-seat-roster';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  recordGoLiveFailure,
  recordGoLiveRefusal,
} from './go-live-run.model';
import { resolveGoLiveDataDir } from './vehicles';
import { MIME } from './vehicles-import';

/** The run key — versioned like the vehicles', and for the same reason. */
/**
 * v1 attached 36 of 41 and could only say «no driving-seat employee has this code» about the
 * other five. v2 says WHICH of two things that means — no such employee at all, or an employee
 * whose job title does not require a driving test — and re-runs so the answer is on the screen.
 * Every scan already attached is kept, not re-uploaded.
 */
export const DRIVER_PHOTOS_GO_LIVE_MARK = 'go-live:driver-photos:v2';

/** The vehicles' lease. Forty-one scans take seconds; thirty minutes is «certainly dead». */
export const DRIVER_PHOTOS_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** The folder beside `cars.json` — one file per driver, named `<employee code>.<jpg|jpeg|png|webp>`. */
export const DRIVER_PHOTOS_DIR = 'driver-license-photos';

export interface DriverPhotoPlan {
  /** Files with a driving-seat employee to belong to, in name order. */
  matched: { file: string; code: string; employee: DirectoryEmployee }[];
  /** Files whose stem is nobody's code on the registry. Reported, not imported. */
  unmatched: string[];
  /** Files whose employee has left the company — a profile cannot be opened for them. */
  exited: string[];
  /** Files that are not an image the registry takes. A refusal: the build is wrong. */
  notImages: string[];
  /** Codes that appear under two extensions. A refusal: one driver has one current scan. */
  duplicates: string[];
}

/**
 * Match the folder to the registry. Pure, so the rule can be tested without a database: a stem
 * is a code, a code is one employee, and every file lands in exactly one of the five lists.
 */
export const planDriverPhotos = (
  files: readonly string[],
  roster: readonly DirectoryEmployee[],
): DriverPhotoPlan => {
  const byCode = new Map(roster.map((employee) => [employee.code, employee]));
  const plan: DriverPhotoPlan = { matched: [], unmatched: [], exited: [], notImages: [], duplicates: [] };
  const seen = new Set<string>();
  for (const file of [...files].sort()) {
    if (MIME[extname(file).toLowerCase()] === undefined) {
      plan.notImages.push(file);
      continue;
    }
    const code = parse(file).name;
    if (seen.has(code)) {
      plan.duplicates.push(code);
      continue;
    }
    seen.add(code);
    const employee = byCode.get(code);
    if (employee === undefined) {
      plan.unmatched.push(file);
      continue;
    }
    if (employee.status === 'exited') {
      plan.exited.push(file);
      continue;
    }
    plan.matched.push({ file, code, employee });
  }
  return plan;
};

export interface DriverPhotoOutcome {
  /** Scans uploaded by this run. */
  attached: number;
  /** Profiles that already carried exactly this file — a take-over found them done. */
  kept: number;
  /** Profiles this run opened, because the driver had none. */
  enrolled: number;
  failures: { file: string; code: string; error: string }[];
}

/**
 * The two reasons a scan can be nobody's, told apart — «add the employee» and «flag their job
 * title as a driving seat» are different people's jobs. Asked of the directory by code, one file
 * at a time; there are five of them, not five thousand.
 */
export const explainUnmatched = async (
  unmatched: readonly string[],
): Promise<{ unknownCodes: string[]; notDrivers: string[] }> => {
  const unknownCodes: string[] = [];
  const notDrivers: string[] = [];
  for (const file of unmatched) {
    const code = parse(file).name;
    const employee = await getDirectoryEmployeeByCode(code);
    if (employee === null) unknownCodes.push(file);
    else notDrivers.push(`${file} — ${employee.fullNameAr}`);
  }
  return { unknownCodes, notDrivers };
};

/**
 * The privileged context the step acts as. `fleetDriver.manage` is the one the Files service asks
 * Fleet about (ADR-023) before it will plant a scan on a profile — the driver twin of the
 * `fleetVehicle.edit` the vehicle step learned the hard way.
 */
const goLiveContext = (adminId: string): AuthContext => ({
  userId: adminId,
  sessionId: 'go-live:driver-photos',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: {
    'fleetDriver.view': 'organization',
    'fleetDriver.manage': 'organization',
    'file.view': 'organization',
    'file.download': 'organization',
  },
  permissionVersion: 0,
  isPrivileged: true,
});

/**
 * Attach every matched scan. One failure does not stop the next driver — the run reports them
 * all and is left unfinished, and the take-over that follows skips what did land.
 */
export const applyDriverPhotos = async (
  plan: DriverPhotoPlan,
  photoDir: string,
  ctx: AuthContext,
): Promise<DriverPhotoOutcome> => {
  const outcome: DriverPhotoOutcome = { attached: 0, kept: 0, enrolled: 0, failures: [] };
  for (const { file, code, employee } of plan.matched) {
    try {
      const existing = await fleetDriverProfileRepository.findDriverByEmployeeId(employee.employeeId);
      if (existing === null) outcome.enrolled += 1;
      const profile =
        existing ??
        (await fleetDriverProfileService.create({ employeeId: employee.employeeId }, ctx.userId));
      if (profile.licenseImage?.fileName === file) {
        outcome.kept += 1;
        continue;
      }
      const buffer = await readFile(join(photoDir, file));
      const mime = MIME[extname(file).toLowerCase()] as string;
      await fleetDriverProfileService.setLicenseImage(ctx, String(profile._id), {
        originalName: file,
        mime,
        size: buffer.byteLength,
        buffer,
      });
      outcome.attached += 1;
    } catch (error) {
      outcome.failures.push({
        file,
        code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcome;
};

/**
 * Run the step, once, and report. Exported so a test can await it; the boot uses
 * `startDriverPhotosGoLive` below, which is this without the waiting.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE RUN IS CLAIMED, for the vehicles' reason: a refusal is the
 * condition somebody fixes and redeploys, and it must not leave a lease to wait out.
 */
export const runDriverPhotosGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so no driver scan was attached',
    );
    return;
  }
  const photoDir = join(dir, DRIVER_PHOTOS_DIR);
  if (!existsSync(photoDir)) {
    logger.error(
      { dir: photoDir },
      'fleet go-live: the driver licence scans are not in this build — the folder is missing, so none was attached and the run is NOT claimed',
    );
    return;
  }
  const files = await readdir(photoDir);

  // The seeding admin authors every profile and every upload, exactly as the vehicles are
  // authored. Looked up BEFORE the claim, so an unseeded deployment can try again once seeded.
  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the driver scans — run the seed first; nothing was attached and the run is NOT claimed',
    );
    await recordGoLiveRefusal(DRIVER_PHOTOS_GO_LIVE_MARK, { reason: 'no-admin', email: env.SEED_ADMIN_EMAIL });
    return;
  }

  const plan = planDriverPhotos(files, await drivingSeatRoster());
  if (plan.notImages.length > 0 || plan.duplicates.length > 0) {
    logger.error(
      { notImages: plan.notImages, duplicates: plan.duplicates },
      'fleet go-live: refused — the driver scan folder holds a file that is not an image, or one code under two names. Nothing was attached and the run is NOT claimed, so a corrected build will attach them',
    );
    await recordGoLiveRefusal(DRIVER_PHOTOS_GO_LIVE_MARK, {
      reason: 'plan',
      notImages: plan.notImages,
      duplicates: plan.duplicates,
    });
    return;
  }
  const explained = await explainUnmatched(plan.unmatched);
  if (plan.unmatched.length > 0 || plan.exited.length > 0) {
    logger.warn(
      { ...explained, exited: plan.exited },
      'fleet go-live: these scans name no current driving-seat employee — they are skipped, and listed on the run',
    );
  }

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(DRIVER_PHOTOS_GO_LIVE_MARK, DRIVER_PHOTOS_GO_LIVE_LEASE_MS))) return;

  logger.info(
    { scans: plan.matched.length, unmatched: plan.unmatched.length, exited: plan.exited.length },
    'fleet go-live: attaching the driver licence scans',
  );
  const outcome = await applyDriverPhotos(plan, photoDir, goLiveContext(String(admin._id)));
  const counts = {
    attached: outcome.attached,
    kept: outcome.kept,
    enrolled: outcome.enrolled,
    unknownCodes: explained.unknownCodes,
    notDrivers: explained.notDrivers,
    exited: plan.exited,
  };
  if (outcome.failures.length > 0) {
    // NOT finished — the lease is left to expire and the next boot after it takes the job over,
    // skipping every scan that already landed. The reasons go on the row as well as the log.
    await recordGoLiveFailure(DRIVER_PHOTOS_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, 25),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: driver scans finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    logger.error(counts, 'fleet go-live: partial driver scans');
    return;
  }
  await finishGoLiveRun(DRIVER_PHOTOS_GO_LIVE_MARK, counts);
  logger.info(counts, 'fleet go-live: driver licence scans attached — done, and never again');
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startDriverPhotosGoLive = (): void => {
  if (isTest) return;
  void runDriverPhotosGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: driver scans failed — no boot was harmed');
  });
};
