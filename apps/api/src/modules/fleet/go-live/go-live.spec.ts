// The go-live data reaches the company by DEPLOYING, or it does not reach the company.
//
// These are mostly source-level and file-level, and that is the point rather than a shortcut. What
// went wrong with #446 and #447 was not a function returning the wrong value — both libraries were
// correct and both were tested. What was missing was a CALLER: 167 names and 209 cars sat behind
// commands nobody ran, so the merge landed and the screens stayed empty for two days. The thing to
// guard is therefore the wiring and the payload — that the seed still calls them, that the build
// still carries the data, and that the data is still all of it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLEET_VOCABULARY, COUNTING_WORK_TYPES } from './vocabulary';
import { resolveGoLiveDataDir, VEHICLE_GO_LIVE_MARK } from './vehicles';
import { failureReason, fold, MIME, parseCars } from './vehicles-import';
import { DRIVER_PHOTOS_DIR, DRIVER_PHOTOS_GO_LIVE_MARK, planDriverPhotos } from './driver-photos';
import { CARS_LOG_FILE, ODOMETER_GO_LIVE_MARK } from './odometer';
import { parseCarsLog, planOdometerImport } from './odometer-import';
import { CAR_MAINTENANCE_FILE, MAINTENANCE_GO_LIVE_MARK } from './maintenance';
import { parseVisits } from './maintenance-import';
import { CAR_VIOLATIONS_FILE, VIOLATIONS_GO_LIVE_MARK } from './violations';
import { parseViolations } from './violations-import';
import { ACCIDENTS_GO_LIVE_MARK, FLEET_ACCIDENT_FILE } from './accidents';
import { parseAccidents } from './accidents-import';
import { ValidationError } from '../../../shared/errors';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', '..', '..');
const read = (path: string): string => readFileSync(join(API_ROOT, path), 'utf8');

/**
 * The source with its comments removed.
 *
 * Not fussiness: commenting a call out is the most likely way it dies, and `toContain` cannot tell
 * `startVehicleGoLive()` from `// startVehicleGoLive()`. A sabotage run proved it — the seed was
 * commented out and all fourteen cases still passed. These files also explain themselves at
 * length, and naming a call in order to describe it must not be what keeps the guard green.
 */
const code = (path: string): string =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the boot seed is what applies the house vocabulary', () => {
  it('fleet.seed.ts applies it — not a CLI somebody has to remember', () => {
    const seed = code('src/modules/fleet/fleet.seed.ts');
    // `plan` then `apply`: the seed reports what it changed, which on the hundredth boot is
    // nothing at all.
    expect(seed).toContain('planFleetVocabulary()');
    expect(seed).toContain('applyFleetVocabulary(');
  });

  it('it is applied with no author, because nobody pressed anything', () => {
    // `null` is the honest record for a boot write. An invented author on 167 rows would be a
    // person's name against work they did not do.
    expect(code('src/modules/fleet/fleet.seed.ts')).toContain(
      'applyFleetVocabulary(await planFleetVocabulary(), null)',
    );
  });

  it('carries all five lists and 167 names', () => {
    const kinds = FLEET_VOCABULARY.map((v) => v.kind);
    expect(kinds).toEqual([
      'workshop',
      'workType',
      'sparePart',
      'missionType',
      'insuranceCompany',
    ]);
    const total = FLEET_VOCABULARY.reduce((sum, v) => sum + v.names.length, 0);
    expect(total).toBe(167);
  });

  it('flags exactly the two work types that reset the maintenance counter', () => {
    // The flag that cost hours on vehicle 150, where «تقطيع» was not counted and nothing said so.
    expect([...COUNTING_WORK_TYPES]).toEqual(['صيانة', 'صيانة + إصلاح']);
  });
});

describe('the long-running processes are what import the vehicle registry', () => {
  const LONG_RUNNING = ['src/server.ts', 'src/worker.ts'];
  /** Every go-live step: the cars, the drivers' licence scans, the odometer book — on the same terms. */
  const STARTERS = [
    'startVehicleGoLive',
    'startDriverPhotosGoLive',
    'startOdometerGoLive',
    'startMaintenanceGoLive',
    'startViolationsGoLive',
    'startAccidentsGoLive',
  ];
  const cases = LONG_RUNNING.flatMap((path) => STARTERS.map((starter) => [path, starter]));

  it.each(cases)('%s starts %s after booting', (path, starter) => {
    const source = code(path);
    const boot = source.indexOf('bootPlatform(');
    const goLive = source.indexOf(`${starter}()`);
    expect(goLive, `${path} starts ${starter}`).toBeGreaterThan(-1);
    // After the boot, because the mark's whole guarantee is the `ux_key` unique index and
    // `migrateFleetIndexes` — inside the Fleet seed, inside `bootPlatform` — is what builds it.
    // `autoIndex` is off in production, so claiming the mark first lets both processes insert it,
    // which is precisely the race this is guarded against.
    expect(goLive, `${path} starts it after the boot`).toBeGreaterThan(boot);
  });

  it.each(cases)('%s does not await %s', (path, starter) => {
    // `server.ts` listens only after everything above `listen()` has resolved, and railway.json
    // fails the deploy if /health/ready has not answered in 300s, then retries ten times. An
    // import held in front of the port would take the platform down with it.
    expect(code(path)).not.toContain(`await ${starter}()`);
  });

  it('NO short-lived entrypoint starts it — it would exit out from underneath the import', () => {
    // THE BUG THIS EXISTS FOR. The import began in `fleet.seed.ts`, which is the natural home for
    // it by symmetry with the names — and is wrong: the seed runs inside `bootPlatform`, and
    // `seed.ts` plus nine CLIs call `bootPlatform` and then immediately `disconnectMongo()` and
    // `process.exit()`. Any of them would have torn the connection and the process out from under
    // a running import, leaving the mark claimed and the registry half written, which no later
    // boot recovers. A background import belongs only in a process that stays alive.
    const shortLived = readdirSync(join(API_ROOT, 'src'))
      .filter((name) => name.endsWith('.cli.ts') || name === 'seed.ts')
      .filter((name) => code(join('src', name)).includes('bootPlatform('));
    expect(shortLived.length, 'the short-lived boot entrypoints are still there').toBeGreaterThan(0);
    for (const name of shortLived) {
      for (const starter of STARTERS) {
        expect(code(join('src', name)), `${name} must not start ${starter}`).not.toContain(starter);
      }
    }
  });

  it('the module seed does not start either of them', () => {
    const seed = code('src/modules/fleet/fleet.seed.ts');
    for (const starter of STARTERS) expect(seed).not.toContain(`${starter}(`);
  });

  it('every refusal is checked BEFORE the run is claimed, so a fix can be redeployed', () => {
    const source = code('src/modules/fleet/go-live/vehicles.ts');
    const claim = source.indexOf('claimGoLiveRun(VEHICLE_GO_LIVE_MARK');
    expect(claim).toBeGreaterThan(-1);
    // A refusal after the claim leaves a lease to wait out before the fix can take effect, and a
    // refusal is exactly the condition an operator goes and fixes. Each of these must sit above
    // the claim.
    for (const refusal of [
      'parsed.rejected.length > 0',
      'plan.missingBranches.length > 0',
      'plan.inactiveBranches.length > 0',
      'admin === null',
      "dir === null",
    ]) {
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeGreaterThan(-1);
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeLessThan(claim);
    }
  });

  it('the driver scans refuse before their claim too, on their own conditions', () => {
    const source = code('src/modules/fleet/go-live/driver-photos.ts');
    const claim = source.indexOf('claimGoLiveRun(DRIVER_PHOTOS_GO_LIVE_MARK');
    expect(claim).toBeGreaterThan(-1);
    for (const refusal of [
      'dir === null',
      '!existsSync(photoDir)',
      'admin === null',
      'plan.notImages.length > 0 || plan.duplicates.length > 0',
    ]) {
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeGreaterThan(-1);
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeLessThan(claim);
    }
  });

  it('the odometer book refuses before its claim too — and waits for the cars', () => {
    const source = code('src/modules/fleet/go-live/odometer.ts');
    const claim = source.indexOf('claimGoLiveRun(ODOMETER_GO_LIVE_MARK');
    expect(claim).toBeGreaterThan(-1);
    for (const refusal of ['dir === null', '!existsSync(file)', 'waitForGoLiveRuns(', 'admin === null']) {
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeGreaterThan(-1);
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeLessThan(claim);
    }
    // Every row names a car by code; a registry still being written would make the book «unknown
    // cars» and the run would finish, correctly and forever. It WAITS for them rather than
    // refusing on the instant — see `waitForGoLiveRuns`.
    expect(source).toContain('waitForGoLiveRuns([VEHICLE_GO_LIVE_MARK])');
  });

  it('the workshop book refuses before its claim too — and waits for the cars AND the readings', () => {
    const source = code('src/modules/fleet/go-live/maintenance.ts');
    const claim = source.indexOf('claimGoLiveRun(MAINTENANCE_GO_LIVE_MARK');
    expect(claim).toBeGreaterThan(-1);
    for (const refusal of ['dir === null', '!existsSync(file)', 'waitForGoLiveRuns(', 'admin === null']) {
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeGreaterThan(-1);
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeLessThan(claim);
    }
    // A third of the visits take their counter from the odometer book, so both go first — and it
    // WAITS for them. Checking once cost the workshop book a whole deploy: every step is started
    // in the same breath, so a second into the boot the odometer book is always «not done yet».
    expect(source).toContain('waitForGoLiveRuns([VEHICLE_GO_LIVE_MARK, ODOMETER_GO_LIVE_MARK])');
  });

  it.each([
    ['violations', 'VIOLATIONS_GO_LIVE_MARK'],
    ['accidents', 'ACCIDENTS_GO_LIVE_MARK'],
  ])('the %s book refuses before its claim too, and waits for the cars', (step, mark) => {
    const source = code(`src/modules/fleet/go-live/${step}.ts`);
    const claim = source.indexOf(`claimGoLiveRun(${mark}`);
    expect(claim).toBeGreaterThan(-1);
    for (const refusal of ['dir === null', '!existsSync(file)', 'waitForGoLiveRuns(', 'admin === null']) {
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeGreaterThan(-1);
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeLessThan(claim);
    }
    expect(source).toContain('waitForGoLiveRuns([VEHICLE_GO_LIVE_MARK])');
  });

  it('every refusal is WRITTEN, not only logged — the owner cannot read the log', () => {
    // A refusal that lived only in the server log was, for two deploys, indistinguishable from
    // an import that never ran. Each refusal now records itself on the run row, with a lease that
    // has already lapsed, so the next boot after the fix still claims at once. The two «data not
    // in this build» refusals are the exception: the build is the problem there, not the data.
    const records = (source: string, mark: string, reason: string): boolean =>
      new RegExp(`recordGoLiveRefusal\\(${mark},\\s*\\{\\s*reason: '${reason}'`).test(source);
    const vehicles = code('src/modules/fleet/go-live/vehicles.ts');
    for (const reason of ['rejected-rows', 'no-admin', 'plan']) {
      expect(records(vehicles, 'VEHICLE_GO_LIVE_MARK', reason), `vehicles: ${reason}`).toBe(true);
    }
    const photos = code('src/modules/fleet/go-live/driver-photos.ts');
    for (const reason of ['no-admin', 'plan']) {
      expect(records(photos, 'DRIVER_PHOTOS_GO_LIVE_MARK', reason), `driver photos: ${reason}`).toBe(true);
    }
    const odometer = code('src/modules/fleet/go-live/odometer.ts');
    for (const reason of ['vehicles-not-done', 'no-admin']) {
      expect(records(odometer, 'ODOMETER_GO_LIVE_MARK', reason), `odometer: ${reason}`).toBe(true);
    }
    const maintenance = code('src/modules/fleet/go-live/maintenance.ts');
    for (const reason of ['prior-steps-not-done', 'no-admin']) {
      expect(records(maintenance, 'MAINTENANCE_GO_LIVE_MARK', reason), `maintenance: ${reason}`).toBe(true);
    }
    for (const [step, mark] of [['violations', 'VIOLATIONS_GO_LIVE_MARK'], ['accidents', 'ACCIDENTS_GO_LIVE_MARK']]) {
      const source = code(`src/modules/fleet/go-live/${step}.ts`);
      for (const reason of ['vehicles-not-done', 'no-admin']) {
        expect(records(source, mark as string, reason), `${step}: ${reason}`).toBe(true);
      }
    }
  });

  it('is skipped under test, or every integration suite imports 209 cars', () => {
    const source = code('src/modules/fleet/go-live/vehicles.ts');
    expect(source).toMatch(/startVehicleGoLive\s*=\s*\(\):\s*void\s*=>\s*\{\s*\n\s*if \(isTest\) return;/);
    const photos = code('src/modules/fleet/go-live/driver-photos.ts');
    expect(photos).toMatch(/startDriverPhotosGoLive\s*=\s*\(\):\s*void\s*=>\s*\{\s*\n\s*if \(isTest\) return;/);
    const odometer = code('src/modules/fleet/go-live/odometer.ts');
    expect(odometer).toMatch(/startOdometerGoLive\s*=\s*\(\):\s*void\s*=>\s*\{\s*\n\s*if \(isTest\) return;/);
    const maintenance = code('src/modules/fleet/go-live/maintenance.ts');
    expect(maintenance).toMatch(/startMaintenanceGoLive\s*=\s*\(\):\s*void\s*=>\s*\{\s*\n\s*if \(isTest\) return;/);
    expect(code('src/modules/fleet/go-live/violations.ts')).toMatch(/startViolationsGoLive\s*=\s*\(\):\s*void\s*=>\s*\{\s*\n\s*if \(isTest\) return;/);
    expect(code('src/modules/fleet/go-live/accidents.ts')).toMatch(/startAccidentsGoLive\s*=\s*\(\):\s*void\s*=>\s*\{\s*\n\s*if \(isTest\) return;/);
  });

  it('a car that fails records WHICH check failed, not «Validation failed»', () => {
    // Production recorded the message 209 times. The field and the reason live in `details`.
    const error = new ValidationError([
      { field: 'body.branchId', code: 'UNKNOWN', message: 'branch not found or inactive' },
    ]);
    expect(failureReason(error)).toBe('Validation failed — body.branchId: branch not found or inactive');
    expect(failureReason(new Error('plain'))).toBe('plain');
    expect(failureReason('text')).toBe('text');
    expect(code('src/modules/fleet/go-live/vehicles-import.ts')).toContain('reason: failureReason(error)');
  });

  it('matches a branch by FOLDED spelling — «أسيوط» in the data is «اسيوط» in /system', () => {
    // The production refusal: three of the seven branches were «missing» by one hamza each.
    for (const [data, system] of [
      ['أسيوط', 'اسيوط'],
      ['الأسكندرية', 'الاسكندرية'],
      ['أكتوبر', 'اكتوبر'],
      ['المهندسين', 'المهندسين'],
    ]) {
      expect(fold(data as string), `${data} ~ ${system}`).toBe(fold(system as string));
    }
    expect(fold('طنطا'), 'and different names stay different').not.toBe(fold('بورسعيد'));
    const source = code('src/modules/fleet/go-live/vehicles-import.ts');
    expect(source, 'the planner and the writer share one resolver').toContain('await resolveBranches(');
    expect(source, 'declared once').toContain('export const resolveBranches = async (');
    expect(source.split('resolveBranches(').length - 1, 'used twice — plan and apply').toBe(2);
    expect(source, 'no exact-only lookup is left').not.toContain('branchRepository.findByName(');
  });

  it('a deactivated branch is refused by the PLANNER, by the same rule the service applies', () => {
    // `findByName` matches any live branch; `assertBranch` demands `status === 'active'`. A plan
    // that only asked the first question claimed the run and failed every car on the second.
    const source = code('src/modules/fleet/go-live/vehicles-import.ts');
    expect(source).toContain("else if (found.status !== 'active') inactiveBranches.push(name);");
  });

  it('the run key is at v3 — v1 was cut off, v2 wrote no car, and neither must be resumed', () => {
    // v1 claimed a once-only mark, created the vehicle types and licence classes, and was killed
    // before the cars. v2 ran after the eight-screen reset and still wrote no car, for a reason
    // nobody could read. v3 runs after the reset that clears the vehicles too and records what it
    // finds on its own row. Resuming either earlier key would find its mark and do nothing.
    expect(VEHICLE_GO_LIVE_MARK).toBe('go-live:vehicles:v3');
  });

  it.each([
    ['src/modules/fleet/go-live/vehicles.ts', "'fleet go-live: partial import'", 'VEHICLE_GO_LIVE_MARK'],
    ['src/modules/fleet/go-live/driver-photos.ts', "'fleet go-live: partial driver scans'", 'DRIVER_PHOTOS_GO_LIVE_MARK'],
    ['src/modules/fleet/go-live/odometer.ts', "'fleet go-live: partial odometer import'", 'ODOMETER_GO_LIVE_MARK'],
    ['src/modules/fleet/go-live/maintenance.ts', "'fleet go-live: partial workshop import'", 'MAINTENANCE_GO_LIVE_MARK'],
    ['src/modules/fleet/go-live/violations.ts', "'fleet go-live: partial violations import'", 'VIOLATIONS_GO_LIVE_MARK'],
    ['src/modules/fleet/go-live/accidents.ts', "'fleet go-live: partial accidents import'", 'ACCIDENTS_GO_LIVE_MARK'],
  ])('%s: a run that FAILS is not marked done, so the next boot takes it over', (path, partial, mark) => {
    // The whole reason the mark became a lease. `finishGoLiveRun` must sit on the success path
    // only; a failure returns first and leaves the lease to expire.
    const source = code(path);
    const failureReturn = source.indexOf(partial);
    const finish = source.indexOf(`finishGoLiveRun(${mark}`);
    expect(failureReturn).toBeGreaterThan(-1);
    expect(finish).toBeGreaterThan(failureReturn);
    const between = source.slice(failureReturn, finish);
    expect(between, 'the failure path returns before the run is finished').toContain('return;');
    expect(source.slice(0, failureReturn), 'and the failure is written to the row first').toContain(
      `recordGoLiveFailure(${mark}`,
    );
  });
});

describe('the driver licence scans — one per driver, by employee code', () => {
  const employee = (code: string, status: 'active' | 'exited' = 'active') => ({
    employeeId: `id-${code}`,
    code,
    fullNameAr: `سائق ${code}`,
    status,
    branchId: null,
    departmentId: null,
    // The three HR facts the drivers registry orders by. Nothing here reads them — the photo
    // plan matches on the CODE — but the seam answers them, so the fake answers them too.
    phone: null,
    governorate: null,
    hiredAt: null,
  });

  it('is at v2, in its own folder beside the cars', () => {
    // v1 could not say why five scans were nobody's; v2 tells «no such employee» from «not a
    // driving seat» and re-runs, keeping every scan already attached.
    expect(DRIVER_PHOTOS_GO_LIVE_MARK).toBe('go-live:driver-photos:v2');
    expect(DRIVER_PHOTOS_DIR).toBe('driver-license-photos');
  });

  it('matches a file to a driving-seat employee by its stem, and by nothing else', () => {
    const plan = planDriverPhotos(['0100026.jpg', '0100028.jpeg'], [employee('0100026'), employee('0100028')]);
    expect(plan.matched.map((m) => [m.file, m.code, m.employee.employeeId])).toEqual([
      ['0100026.jpg', '0100026', 'id-0100026'],
      ['0100028.jpeg', '0100028', 'id-0100028'],
    ]);
    expect(plan.unmatched).toEqual([]);
  });

  it('reports a stem that is nobody’s code, and does not guess', () => {
    const plan = planDriverPhotos(['0100026.jpg', '9999999.jpg'], [employee('0100026')]);
    expect(plan.matched.map((m) => m.code)).toEqual(['0100026']);
    expect(plan.unmatched).toEqual(['9999999.jpg']);
  });

  it('sets aside a driver who has left — a profile cannot be opened for them', () => {
    const plan = planDriverPhotos(['0100026.jpg'], [employee('0100026', 'exited')]);
    expect(plan.matched).toEqual([]);
    expect(plan.exited).toEqual(['0100026.jpg']);
  });

  it('refuses a file that is not an image, and a code under two names', () => {
    const plan = planDriverPhotos(
      ['0100026.jpg', '0100026.png', 'notes.txt', '.DS_Store'],
      [employee('0100026')],
    );
    expect(plan.notImages).toEqual(['.DS_Store', 'notes.txt']);
    expect(plan.duplicates).toEqual(['0100026']);
    expect(plan.matched.map((m) => m.file)).toEqual(['0100026.jpg']);
  });

  it('takes exactly the image types the registry takes', () => {
    expect(Object.keys(MIME).sort()).toEqual(['.jpeg', '.jpg', '.png', '.webp']);
  });
});

describe('the go-live reset runs first, once, and spares what it was told to', () => {
  const seed = code('src/modules/fleet/fleet.seed.ts');

  it('fleet.seed.ts runs it before any catalog row is ensured', () => {
    // The vocabulary is seeded into the same collection the reset clears. Run the reset after it
    // and every boot would seed 167 names and then delete them.
    const reset = seed.indexOf('await startGoLiveReset()');
    const firstEnsure = seed.indexOf('fleetCatalogItemService.ensure(');
    expect(reset).toBeGreaterThan(-1);
    expect(firstEnsure).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(firstEnsure);
  });

  it('spares exactly the five things the owner named, and nothing it was not told to', () => {
    const source = code('src/modules/fleet/go-live/reset.ts');
    // «ما عدا أنواع المخالفات و السواقيين و وظيفة السائق و تخصص السائق ورخصة السائق».
    for (const kind of ['violationType', 'driverJob', 'driverSpecialization', 'driverLicenseType']) {
      expect(source, `${kind} is protected`).toContain(`'${kind}'`);
    }
    // The drivers registry is on the owner's protected list and the vehicle types were never
    // named — neither model may even be imported here. The VEHICLES joined the list at v2
    // («امسح الداتا fleet/maintenance-alarms اللى هنا بالمره» — that board is a view over them).
    expect(source).not.toContain('FleetDriverProfileModel');
    expect(source).not.toContain('FleetVehicleTypeModel');
    expect(source).toContain('gone(FleetVehicleModel)');
  });

  it('is at v2 — v1 spared the vehicles, and the owner asked for them too', () => {
    expect(code('src/modules/fleet/go-live/reset.ts')).toContain("'go-live:reset:v2'");
  });
});

describe('the data ships with the build', () => {
  it('tsup copies assets/ into dist/ — without it the deployed image has no cars', () => {
    // Bundling cannot do this: esbuild inlines what is imported, and 23MB of JPEG is read from
    // disk by path. `publicDir` is the copy, and the only one.
    expect(code('tsup.config.ts')).toContain("publicDir: 'assets'");
  });

  it('the vehicle data is in the repository and readable', () => {
    const dir = resolveGoLiveDataDir();
    expect(dir, 'assets/fleet-go-live is present').not.toBeNull();
    const parsed = parseCars(JSON.parse(readFileSync(join(dir as string, 'cars.json'), 'utf8')));
    // 213 rows in the handover, four of them flagged deleted in the legacy system.
    expect(parsed.rejected, 'every row can be read').toEqual([]);
    expect(parsed.cars.length).toBe(209);
    expect(parsed.skippedDeleted).toBe(4);
  });

  it('the odometer book is there: all 20,322 rows are read — 747 of them already deleted, two it cannot fully read', () => {
    const dir = resolveGoLiveDataDir() as string;
    const parsed = parseCarsLog(JSON.parse(readFileSync(join(dir, CARS_LOG_FILE), 'utf8')));
    expect(parsed.rows.length, 'EVERY row of the book — «متسبش داتا فاضيه»').toBe(20_322);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.keptDeleted).toBe(747);
    expect(parsed.unreadable.map((r) => r.reason)).toEqual([
      '176: the date cannot be read',
      '177: a reading is not a number',
    ]);
    // The book names rows on cars the handover did not have — «194», «تويوتا1» and, among the
    // rows the old system had deleted, four more. Reported by the run, not fixed here.
    const cars = parseCars(JSON.parse(readFileSync(join(dir, 'cars.json'), 'utf8')));
    const codes = new Set(cars.cars.map((car) => car.code));
    const live = parsed.rows.filter((row) => !row.deletion.isDeleted && !row.unreadable);
    expect([...new Set(live.filter((row) => !codes.has(row.code)).map((row) => row.code))].sort()).toEqual([
      '194',
      'تويوتا1',
    ]);
    expect(ODOMETER_GO_LIVE_MARK).toBe('go-live:odometer:v4');
  });

  it('every row of the odometer book is PLANNED, none dropped, and no car ends with two open periods', () => {
    const dir = resolveGoLiveDataDir() as string;
    const parsed = parseCarsLog(JSON.parse(readFileSync(join(dir, CARS_LOG_FILE), 'utf8')));
    const cars = parseCars(JSON.parse(readFileSync(join(dir, 'cars.json'), 'utf8')));
    const registry = new Map(cars.cars.map((car, index) => [car.code, index.toString(16).padStart(24, '0')]));
    const plan = planOdometerImport(parsed.rows, registry, new Map());
    expect(plan.vehicles.reduce((sum, v) => sum + v.rows.length, 0)).toBe(20_322);
    expect(plan.openedByPrevious, 'the 837 rows the book left with no opening reading').toBe(837);
    expect(plan.deleted, 'the 747 the old system deleted, and the one whose date is not a date').toBe(748);
    for (const vehicle of plan.vehicles) {
      const open = vehicle.rows.filter((row) => !row.deleted && row.in === null);
      expect(open.length, `${vehicle.code}: at most one open period — ux_open_period`).toBeLessThanOrEqual(1);
    }
  });

  it('the workshop book is there: all 1,938 visits are read — 133 already deleted, five it cannot fully read', () => {
    const dir = resolveGoLiveDataDir() as string;
    const parsed = parseVisits(JSON.parse(readFileSync(join(dir, CAR_MAINTENANCE_FILE), 'utf8')));
    expect(parsed.visits.length, 'EVERY visit in the book').toBe(1938);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.keptDeleted).toBe(133);
    // Two with no car, two whose out-date is not a date, one whose in-date is not. Every one of
    // them is kept, with the book's own words on the visit, and written deleted.
    expect(parsed.unreadable.map((r) => r.reason).sort()).toEqual([
      '171 2025-04-06: the out-date cannot be read',
      '209: the in-date cannot be read',
      '517 2025-08-06: the out-date cannot be read',
      'no car code',
      'no car code',
    ]);
    const cars = parseCars(JSON.parse(readFileSync(join(dir, 'cars.json'), 'utf8')));
    const codes = new Set(cars.cars.map((car) => car.code));
    const unknown = parsed.visits.filter((v) => !v.deletion.isDeleted && !v.unreadable && !codes.has(v.code));
    expect(unknown.length, 'six visits').toBe(6);
    expect(new Set(unknown.map((v) => v.code)).size, 'on five codes').toBe(5);
    expect(MAINTENANCE_GO_LIVE_MARK).toBe('go-live:maintenance:v3');
  });

  it('the violations book is there: all 1,023 rows are read — 86 of them already deleted, every one readable', () => {
    const dir = resolveGoLiveDataDir() as string;
    const parsed = parseViolations(JSON.parse(readFileSync(join(dir, CAR_VIOLATIONS_FILE), 'utf8')));
    expect(parsed.company.length + parsed.driver.length, 'EVERY row in the book').toBe(1023);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.unreadable).toEqual([]);
    expect(parsed.keptDeleted).toBe(86);
    expect(parsed.company.filter((row) => !row.deletion.isDeleted).length, 'live statement rows').toBe(425);
    expect(parsed.driver.filter((row) => !row.deletion.isDeleted).length, 'live fines').toBe(512);
    expect(VIOLATIONS_GO_LIVE_MARK).toBe('go-live:violations:v3');
  });

  it('the accidents book is there: all 196 files are read — 12 of them already deleted, 25 without a date', () => {
    const dir = resolveGoLiveDataDir() as string;
    const parsed = parseAccidents(JSON.parse(readFileSync(join(dir, FLEET_ACCIDENT_FILE), 'utf8')));
    expect(parsed.accidents.length, 'EVERY file in the book').toBe(196);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.unreadable).toEqual([]);
    expect(parsed.keptDeleted).toBe(12);
    expect(parsed.accidents.filter((a) => a.occurredAt === null).length).toBe(25);
    expect(ACCIDENTS_GO_LIVE_MARK).toBe('go-live:accidents:v3');
  });

  it('all 56 licence scans are there, and every one is named for a car in the data', () => {
    const dir = resolveGoLiveDataDir() as string;
    const photoDir = join(dir, 'license-photos');
    expect(existsSync(photoDir)).toBe(true);
    const photos = readdirSync(photoDir);
    expect(photos.length).toBe(56);

    const parsed = parseCars(JSON.parse(readFileSync(join(dir, 'cars.json'), 'utf8')));
    const named = new Set(parsed.cars.map((car) => car.photo).filter((p): p is string => p !== null));
    // A scan nobody's row points at would be imported by nothing and noticed by no one.
    for (const photo of photos) expect(named.has(photo), `${photo} belongs to a car`).toBe(true);
  });

  it('all 41 driver scans are there, each named for an employee code, none twice', () => {
    const dir = resolveGoLiveDataDir() as string;
    const photoDir = join(dir, DRIVER_PHOTOS_DIR);
    expect(existsSync(photoDir)).toBe(true);
    const photos = readdirSync(photoDir);
    expect(photos.length).toBe(41);
    // `0100026` — branch `010`, employee `0026`: the company's own seven-digit code, and an
    // image extension the registry takes. Anything else would be refused at boot.
    for (const photo of photos) expect(photo, photo).toMatch(/^\d{7}\.(jpg|jpeg|png|webp)$/);
    const stems = photos.map((photo) => photo.replace(/\.[^.]+$/, ''));
    expect(new Set(stems).size, 'one scan per driver').toBe(photos.length);
    const plan = planDriverPhotos(photos, []);
    expect(plan.notImages).toEqual([]);
    expect(plan.duplicates).toEqual([]);
  });

  it('resolves the data beside the bundle first, then the source tree', () => {
    // Two placements because there are two ways this runs: `dist/fleet-go-live` in the image that
    // `publicDir` wrote, `apps/api/assets/fleet-go-live` under `tsx`. Neither is guessed at — each
    // is checked for cars.json before it is used.
    const source = code('src/modules/fleet/go-live/vehicles.ts');
    expect(source).toContain("['fleet-go-live', '../../../../assets/fleet-go-live']");
  });
});
