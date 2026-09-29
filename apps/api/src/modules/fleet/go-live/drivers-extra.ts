// The drivers' facts and licence scans that the first two steps could not place — added anyway.
//
// «ضيف عادى». The facts step (`driver-details.ts`) and the scans step (`driver-photos.ts`) write
// only onto people HR has in a DRIVING SEAT — the registry is the org chart. Their reports named
// the rest: three employees with a licence in the old register whose job title HR does not flag
// as a driving seat, five licence scans of such employees, eleven rows of the old drivers book
// that matched nobody in a driving seat (one of them fitting two people). The owner's answer is to
// add them all the same.
//
// So this step asks HR about EVERYBODY, not only the driving seats:
//   · a register row whose code is any employee of the company gets its facts, on a profile opened
//     for that employee;
//   · a drivers-book row is looked for among everyone whose name starts like it, by phone and
//     then by name, exactly as the facts step matches it; one that still fits two people is given
//     to the one in a driving seat, when exactly one of them is;
//   · a scan whose code is any employee is attached to that employee's profile.
// Everything is written the way the two steps write it — empty fields only, scans only where the
// profile has none — so it cannot undo what they, or a person, already put there.
//
// A PROFILE IS NOT A SEAT. The drivers screen lists the driving seats, so these people appear on
// it once HR flags their job title «تتطلب اختبار قيادة»; until then their facts are on file and
// nothing else changes. What is still nobody's — a book row that matches no employee at all — is
// the one thing that cannot be added: a profile belongs to an employee.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import {
  getDirectoryEmployeeByCode,
  searchDirectoryEmployees,
  type DirectoryEmployee,
} from '../../../platform/directory';
import { userService } from '../../../platform/users';
import { drivingSeatRoster } from '../driver-profiles/driving-seat-roster';
import {
  applyDriverDetails,
  DRIVER_DETAILS_FILE,
  LEGACY_DRIVERS_FILE,
  matchLegacyRow,
  parseDriverDetails,
  parseLegacyDrivers,
  phoneKey,
  planDriverDetails,
} from './driver-details-import';
import { DRIVER_DETAILS_GO_LIVE_MARK } from './driver-details';
import {
  applyDriverPhotos,
  DRIVER_PHOTOS_DIR,
  DRIVER_PHOTOS_GO_LIVE_MARK,
  goLiveContext,
  planDriverPhotos,
} from './driver-photos';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  recordGoLiveFailure,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';
import { resolveGoLiveDataDir } from './vehicles';

export const DRIVERS_EXTRA_GO_LIVE_MARK = 'go-live:drivers-extra:v1';
export const DRIVERS_EXTRA_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** Everyone HR has whose name begins with the row's first two words — any seat, any status. */
const peopleNamed = async (name: string): Promise<DirectoryEmployee[]> => {
  const words = name.split(' ').filter((word) => word !== '');
  const found = await searchDirectoryEmployees({
    search: words.slice(0, 2).join(' '),
    status: 'all',
    page: 1,
    pageSize: 100,
  });
  return found.items;
};

export const runDriversExtraGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) return;
  const detailsFile = join(dir, DRIVER_DETAILS_FILE);
  const legacyFile = join(dir, LEGACY_DRIVERS_FILE);
  if (!existsSync(detailsFile) || !existsSync(legacyFile)) return;

  if (!(await waitForGoLiveRuns([DRIVER_DETAILS_GO_LIVE_MARK, DRIVER_PHOTOS_GO_LIVE_MARK]))) {
    await recordGoLiveRefusal(DRIVERS_EXTRA_GO_LIVE_MARK, { reason: 'drivers-not-done' });
    return;
  }
  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    await recordGoLiveRefusal(DRIVERS_EXTRA_GO_LIVE_MARK, {
      reason: 'no-admin',
      email: env.SEED_ADMIN_EMAIL,
    });
    return;
  }
  if (!(await claimGoLiveRun(DRIVERS_EXTRA_GO_LIVE_MARK, DRIVERS_EXTRA_GO_LIVE_LEASE_MS))) return;

  try {
    const details = parseDriverDetails(JSON.parse(await readFile(detailsFile, 'utf8')));
    const legacy = parseLegacyDrivers(JSON.parse(await readFile(legacyFile, 'utf8')));
    const seats = await drivingSeatRoster({ includeExited: true });
    const people = new Map(seats.map((employee) => [employee.code, employee]));

    // The register's codes HR has in another seat.
    for (const row of details.rows) {
      if (people.has(row.code)) continue;
      const employee = await getDirectoryEmployeeByCode(row.code);
      if (employee !== null) people.set(employee.code, employee);
    }
    // The drivers book's people, looked for among everyone.
    const candidatesOf = (): { code: string; name: string; phones: string[] }[] =>
      [...people.values()].map((employee) => ({
        code: employee.code,
        name: employee.fullNameAr,
        phones: [phoneKey(employee.phone)].filter((phone): phone is string => phone !== null),
      }));
    for (const row of legacy.rows) {
      if (row.deleted || matchLegacyRow(row, candidatesOf()).kind === 'matched') continue;
      for (const employee of await peopleNamed(row.name)) {
        if (!people.has(employee.code)) people.set(employee.code, employee);
      }
    }

    const everyone = [...people.values()];
    const plan = planDriverDetails(
      details.rows,
      legacy.rows,
      everyone,
      new Set(seats.map((employee) => employee.code)),
    );
    const facts = await applyDriverDetails(plan, everyone, String(admin._id));

    // The scans of employees in another seat.
    const photoDir = join(dir, DRIVER_PHOTOS_DIR);
    let photos = {
      attached: 0,
      kept: 0,
      enrolled: 0,
      failures: [] as { file: string; code: string; error: string }[],
    };
    let photosNotEmployees: string[] = [];
    if (existsSync(photoDir)) {
      const files = await readdir(photoDir);
      const owners: DirectoryEmployee[] = [];
      for (const file of files) {
        const employee =
          people.get(parse(file).name) ?? (await getDirectoryEmployeeByCode(parse(file).name));
        if (employee !== null) owners.push(employee);
      }
      const photoPlan = planDriverPhotos(files, owners);
      photosNotEmployees = photoPlan.unmatched;
      photos = await applyDriverPhotos(photoPlan, photoDir, goLiveContext(String(admin._id)));
    }

    const counts = {
      enrolled: facts.enrolled,
      filled: facts.filled,
      alreadyThere: facts.alreadyThere,
      keptOnScreen: facts.keptOnScreen,
      photosAttached: photos.attached,
      photosKept: photos.kept,
      unmatchedLegacy: plan.unmatchedLegacy,
      ambiguousLegacy: plan.ambiguousLegacy,
      notInHr: facts.notOnRegistry,
      photosNotEmployees,
    };
    const failures = [
      ...facts.failures.map((failure) => `${failure.code}: ${failure.error}`),
      ...photos.failures.map((failure) => `${failure.file}: ${failure.error}`),
    ];
    if (failures.length > 0) {
      await recordGoLiveFailure(DRIVERS_EXTRA_GO_LIVE_MARK, {
        ...counts,
        failed: failures.length,
        failures: failures.slice(0, 25),
      });
      return;
    }
    await finishGoLiveRun(DRIVERS_EXTRA_GO_LIVE_MARK, counts);
    logger.info(
      counts,
      "fleet go-live: the drivers' remaining facts and scans added — done, and never again",
    );
  } catch (error) {
    await recordGoLiveFailure(DRIVERS_EXTRA_GO_LIVE_MARK, {
      stage: 'extra',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/** What the long-running processes call. Not awaited, cannot reject, skipped under test. */
export const startDriversExtraGoLive = (): void => {
  if (isTest) return;
  void runDriversExtraGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      "fleet go-live: the drivers' remaining facts failed — no boot was harmed",
    );
  });
};
