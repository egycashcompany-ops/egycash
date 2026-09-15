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
import { parseCars } from './vehicles-import';

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

  it.each(LONG_RUNNING)('%s starts it after booting', (path) => {
    const source = code(path);
    const boot = source.indexOf('bootPlatform(');
    const goLive = source.indexOf('startVehicleGoLive()');
    expect(goLive, `${path} starts the import`).toBeGreaterThan(-1);
    // After the boot, because the mark's whole guarantee is the `ux_key` unique index and
    // `migrateFleetIndexes` — inside the Fleet seed, inside `bootPlatform` — is what builds it.
    // `autoIndex` is off in production, so claiming the mark first lets both processes insert it,
    // which is precisely the race this is guarded against.
    expect(goLive, `${path} starts it after the boot`).toBeGreaterThan(boot);
  });

  it.each(LONG_RUNNING)('%s does not await it', (path) => {
    // `server.ts` listens only after everything above `listen()` has resolved, and railway.json
    // fails the deploy if /health/ready has not answered in 300s, then retries ten times. An
    // import held in front of the port would take the platform down with it.
    expect(code(path)).not.toContain('await startVehicleGoLive()');
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
      expect(code(join('src', name)), `${name} must not start the go-live import`).not.toContain(
        'startVehicleGoLive',
      );
    }
  });

  it('the module seed does not start it either', () => {
    expect(code('src/modules/fleet/fleet.seed.ts')).not.toContain('startVehicleGoLive(');
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
      'admin === null',
      "dir === null",
    ]) {
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeGreaterThan(-1);
      expect(source.indexOf(refusal), `${refusal} is checked before the mark`).toBeLessThan(claim);
    }
  });

  it('is skipped under test, or every integration suite imports 209 cars', () => {
    const source = code('src/modules/fleet/go-live/vehicles.ts');
    expect(source).toMatch(/startVehicleGoLive\s*=\s*\(\):\s*void\s*=>\s*\{\s*\n\s*if \(isTest\) return;/);
  });

  it('the run key is at v2 — v1 was the run production cut off, and must not be resumed', () => {
    // v1 claimed a once-only mark, created the vehicle types and licence classes, and was killed
    // before the cars. Resuming v1 would find its mark and do nothing; v2 is a fresh claim.
    expect(VEHICLE_GO_LIVE_MARK).toBe('go-live:vehicles:v2');
  });

  it('a run that FAILS is not marked done, so the next boot takes it over', () => {
    // The whole reason the mark became a lease. `finishGoLiveRun` must sit on the success path
    // only; a failure returns first and leaves the lease to expire.
    const source = code('src/modules/fleet/go-live/vehicles.ts');
    const failureReturn = source.indexOf("'fleet go-live: partial import'");
    const finish = source.indexOf('finishGoLiveRun(VEHICLE_GO_LIVE_MARK');
    expect(failureReturn).toBeGreaterThan(-1);
    expect(finish).toBeGreaterThan(failureReturn);
    const between = source.slice(failureReturn, finish);
    expect(between, 'the failure path returns before the run is finished').toContain('return;');
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
    // The drivers registry, the vehicles and the vehicle types are not on the eight-screen list
    // and must not be deleted from — the models must not even be imported here.
    expect(source).not.toContain('FleetDriverProfileModel');
    expect(source).not.toContain('FleetVehicleModel');
    expect(source).not.toContain('FleetVehicleTypeModel');
  });

  it('is versioned like the import, so repeating it is a decision', () => {
    expect(code('src/modules/fleet/go-live/reset.ts')).toContain("'go-live:reset:v1'");
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

  it('resolves the data beside the bundle first, then the source tree', () => {
    // Two placements because there are two ways this runs: `dist/fleet-go-live` in the image that
    // `publicDir` wrote, `apps/api/assets/fleet-go-live` under `tsx`. Neither is guessed at — each
    // is checked for cars.json before it is used.
    const source = code('src/modules/fleet/go-live/vehicles.ts');
    expect(source).toContain("['fleet-go-live', '../../../../assets/fleet-go-live']");
  });
});
