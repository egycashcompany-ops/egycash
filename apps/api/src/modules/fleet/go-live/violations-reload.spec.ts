// THE VIOLATIONS RELOAD — «امسح من ecms كل المخالفات لحد يوم 23 يعنى من يوم 24 البدايه وكل اللى
// فى الملف ضيفه ويكون الصف لونه اخضر» — pinned without a database.
//
// Four things have to be right, and each is a way the step could go wrong quietly:
//
//   1. THE LINE. Midnight at the start of 24 September in Cairo is 21:00 UTC on the 23rd, because
//      Egypt is on summer time in September. An hour off either way sweeps up an evening of work
//      somebody did on the 24th, or leaves the last hour of the 23rd standing.
//   2. WHICH ROWS. The sweep takes live rows RECORDED before the line, never a row of the book, and
//      it is a soft delete that names nobody. The write's «already there» counts only the book's
//      own rows, so the rows it just swept do not stand in for the book.
//   3. THE ORDER. Sweep, then write — and no write at all over a sweep that failed.
//   4. THE COLOUR. Every row the book writes says so, and the board is told `false` for a row
//      that never had the field.
//
// The whole run against a real mongo is `tests/integration/fleet-go-live-violations-reload.spec.ts`.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const runs = vi.hoisted(() => ({
  log: [] as string[],
  waitForGoLiveRuns: vi.fn(async (_keys: readonly string[]) => true),
  claimGoLiveRun: vi.fn(async (_key: string, _lease: number) => true),
  recordGoLiveRefusal: vi.fn(async (_key: string, _outcome: Record<string, unknown>) => undefined),
  recordGoLiveFailure: vi.fn(async (_key: string, _outcome: Record<string, unknown>) => undefined),
  finishGoLiveRun: vi.fn(async (_key: string, _outcome: Record<string, unknown>) => undefined),
}));

vi.mock('./go-live-run.model', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  waitForGoLiveRuns: runs.waitForGoLiveRuns,
  claimGoLiveRun: runs.claimGoLiveRun,
  recordGoLiveRefusal: runs.recordGoLiveRefusal,
  recordGoLiveFailure: runs.recordGoLiveFailure,
  finishGoLiveRun: runs.finishGoLiveRun,
}));
// Nobody in HR: every driver name is kept as text, which is all these tests need of a name.
vi.mock('../../../platform/directory', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findDirectoryEmployeesByNames: async () => new Map(),
}));

import { userService } from '../../../platform/users';
import { fleetCatalogItemRepository } from '../catalogs';
import { toViolationDto } from '../fleet.mappers';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import {
  FleetGrievanceModel,
  FleetViolationModel,
  type FleetViolationDoc,
} from '../violations/violation.model';
import {
  fleetGrievanceRepository,
  fleetViolationRepository,
  grievancesRecordedBefore,
  violationsRecordedBefore,
} from '../violations/violation.repository';
import { groupByKey } from './book-ref';
import { FleetGoLiveRunModel } from './go-live-run.model';
import { resolveGoLiveDataDir, VEHICLE_GO_LIVE_MARK } from './vehicles';
import { fold, parseCars } from './vehicles-import';
import { CAR_VIOLATIONS_FILE, VIOLATIONS_GO_LIVE_MARK } from './violations';
import {
  parseViolations,
  planViolationsImport,
  violationKey,
  type ViolationTypeIndex,
} from './violations-import';
import {
  describeViolation,
  runViolationsReloadGoLive,
  VIOLATIONS_RELOAD_CUTOFF,
  VIOLATIONS_RELOAD_MARK,
} from './violations-reload';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The source with its comments removed — see `go-live.spec.ts` for why a guard reads code only. */
const code = (file: string): string =>
  readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const oid = (n: number): string => n.toString(16).padStart(24, '0');
const V175 = oid(175);
const T_PARK = oid(1);
const T_SPEED = oid(3);

describe('the line — «لحد يوم 23 يعنى من يوم 24 البدايه»', () => {
  it('is midnight at the START of 24 September, Cairo — 21:00 UTC the evening before', () => {
    expect(VIOLATIONS_RELOAD_CUTOFF.toISOString()).toBe('2026-09-23T21:00:00.000Z');
    const cairo = (at: Date): string =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(at);
    // Egypt is on summer time in September (UTC+3): the instant is the first second of the 24th
    // on a Cairo clock, and the millisecond before it is still the 23rd.
    expect(cairo(VIOLATIONS_RELOAD_CUTOFF)).toBe('24/09/2026, 00:00:00');
    expect(cairo(new Date(VIOLATIONS_RELOAD_CUTOFF.getTime() - 1))).toBe('23/09/2026, 23:59:59');
  });

  it('is its own run, v1, beside the first import rather than a new version of it', () => {
    // A new key, not `go-live:violations:v4`: the first import is DONE and stays done — this is a
    // second, different job, and the notice lists it on its own line.
    expect(VIOLATIONS_RELOAD_MARK).toBe('go-live:violations-reload:v1');
    expect(VIOLATIONS_GO_LIVE_MARK).toBe('go-live:violations:v3');
  });
});

describe('which rows the sweep takes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fines: live, RECORDED before the line, and never a row of the book', () => {
    expect(violationsRecordedBefore(VIOLATIONS_RELOAD_CUTOFF)).toEqual({
      isDeleted: false,
      // `createdAt` — when it was written HERE — not the fine's own date or year.
      createdAt: { $lt: VIOLATIONS_RELOAD_CUTOFF },
      // A take-over can never sweep up the rows the first attempt wrote, whatever the clock says.
      fromOldBook: { $ne: true },
    });
  });

  it('grievance figures: live, recorded before the line, AND not set again since', () => {
    // A figure is one row a person edits in place, so `createdAt` alone would sweep a figure
    // somebody set on the 25th.
    expect(grievancesRecordedBefore(VIOLATIONS_RELOAD_CUTOFF)).toEqual({
      isDeleted: false,
      createdAt: { $lt: VIOLATIONS_RELOAD_CUTOFF },
      updatedAt: { $lt: VIOLATIONS_RELOAD_CUTOFF },
    });
  });

  it('is a SOFT delete that names nobody and moves the version — for the fines and the figures', async () => {
    const at = new Date('2026-09-29T09:00:00.000Z');
    const exec = { exec: async () => ({ modifiedCount: 3 }) };
    const fines = vi.spyOn(FleetViolationModel, 'updateMany').mockReturnValue(exec as never);
    const figures = vi.spyOn(FleetGrievanceModel, 'updateMany').mockReturnValue(exec as never);

    expect(
      await fleetViolationRepository.softDeleteRecordedBefore(VIOLATIONS_RELOAD_CUTOFF, at),
    ).toBe(3);
    expect(
      await fleetGrievanceRepository.softDeleteRecordedBefore(VIOLATIONS_RELOAD_CUTOFF, at),
    ).toBe(3);

    const soft = { $set: { isDeleted: true, deletedAt: at, deletedBy: null }, $inc: { __v: 1 } };
    expect(fines.mock.calls[0]).toEqual([violationsRecordedBefore(VIOLATIONS_RELOAD_CUTOFF), soft]);
    expect(figures.mock.calls[0]).toEqual([
      grievancesRecordedBefore(VIOLATIONS_RELOAD_CUTOFF),
      soft,
    ]);
  });

  it('never hard-deletes — «الداتا اللى ممسوحه … تبقى فى الداتا بيز فقط»', () => {
    for (const file of ['violations-reload.ts', '../violations/violation.repository.ts']) {
      expect(code(file), file).not.toMatch(/deleteMany\(|deleteOne\(|findOneAndDelete\(/);
    }
  });

  it('counts the WHOLE sweep, on any attempt, by what only the sweep writes', async () => {
    const count = vi
      .spyOn(FleetViolationModel, 'countDocuments')
      .mockReturnValue({ exec: async () => 11 } as never);
    expect(await fleetViolationRepository.countSweptBefore(VIOLATIONS_RELOAD_CUTOFF)).toBe(11);
    expect(count.mock.calls[0]?.[0]).toEqual({
      isDeleted: true,
      deletedBy: null, // a person's delete names the person
      createdAt: { $lt: VIOLATIONS_RELOAD_CUTOFF },
      deletedAt: { $gte: VIOLATIONS_RELOAD_CUTOFF }, // the book's own deletions carry the old dates
      fromOldBook: { $ne: true },
    });
  });

  it('the write counts ONLY the book’s own rows as «already there» — deleted ones included', async () => {
    const find = vi.spyOn(FleetViolationModel, 'find').mockReturnValue({
      lean: () => ({ exec: async () => [] }),
    } as never);
    await fleetViolationRepository.existingByKey({ vehicleId: V175 }, violationKey);
    const filter = (find.mock.calls as unknown as Record<string, unknown>[][])[0]?.[0] ?? {};
    expect(filter['fromOldBook'], 'the swept rows and a typed twin are not the book').toBe(true);
    expect(String(filter['vehicleId'])).toBe(V175);
    expect(
      filter,
      'no `isDeleted` clause — a row the book wrote deleted has landed too',
    ).not.toHaveProperty('isDeleted');
  });
});

const company = (over: Record<string, unknown> = {}) => ({
  _id: { $oid: String(over['_id'] ?? '694d465224bc82fd3d28a05d') },
  car_code: '175',
  date_car: { $date: '2025-12-25T00:00:00.000Z' },
  type: 'الانتظار في الممنوع',
  num: '9',
  value_violationCar: '20',
  amount: '180',
  deleted: 0,
  total_before_grievance: '5000',
  done: 1,
  ...over,
});
const fine = (over: Record<string, unknown> = {}) => ({
  _id: { $oid: String(over['_id'] ?? '694d46d324bc82fd3d28a06b') },
  car_code: '175',
  date_driver: { $date: '2025-03-06T00:00:00.000Z' },
  driver: 'احمد جمال عطية',
  amount: '700',
  violation_driver: 'سرعة',
  done: null,
  deleted: 0,
  ...over,
});
const BOOK = [
  company(),
  fine(),
  fine({
    _id: 'gone',
    amount: '350',
    deleted: 1,
    deleted_date: { $date: '2025-12-31T00:00:00.000Z' },
  }),
];
const TYPES: ViolationTypeIndex = {
  byName: new Map([
    [fold('الانتظار في الممنوع'), { id: T_PARK, side: 'company' as const }],
    [fold('سرعة'), { id: T_SPEED, side: 'driver' as const }],
  ]),
};

describe('every row of the book says where it came from — «ويكون الصف لونه اخضر»', () => {
  it('both shapes, and the rows the book had deleted too', () => {
    const plan = planViolationsImport(
      parseViolations(BOOK),
      new Map([['175', V175]]),
      TYPES,
      new Map(),
    );
    const docs = plan.vehicles.flatMap((v) => v.rows.map((r) => r.doc));
    expect(docs.map((d) => [d.kind, d.isDeleted, d.fromOldBook])).toEqual([
      ['vehicle', false, true],
      ['driver', false, true],
      ['driver', true, true],
    ]);
  });

  it('the whole shipped book — all 1,023 rows — is planned flagged', () => {
    const dir = resolveGoLiveDataDir() as string;
    const parsed = parseViolations(
      JSON.parse(readFileSync(join(dir, CAR_VIOLATIONS_FILE), 'utf8')),
    );
    const cars = parseCars(JSON.parse(readFileSync(join(dir, 'cars.json'), 'utf8')));
    const registry = new Map(cars.cars.map((car, index) => [car.code, oid(index + 1)]));
    const plan = planViolationsImport(parsed, registry, { byName: new Map() }, new Map());
    const docs = plan.vehicles.flatMap((v) => v.rows.map((r) => r.doc));
    expect(docs.length, 'EVERY row — «متسبش داتا فاضيه»').toBe(1023);
    expect(docs.every((d) => d.fromOldBook === true)).toBe(true);
  });

  it('the board is told `false` for a row that never had the field — never «unknown»', () => {
    const base = {
      _id: new Types.ObjectId(),
      kind: 'driver',
      vehicleId: new Types.ObjectId(V175),
      vehicleCode: null,
      violationTypeId: new Types.ObjectId(T_SPEED),
      amount: 700,
      year: null,
      count: null,
      unitValue: null,
      date: new Date('2025-03-06T00:00:00.000Z'),
      filedYear: null,
      homeVehicleId: null,
      driverEmployeeId: null,
      driverName: null,
      collected: false,
      __v: 0,
      createdAt: new Date('2026-09-20T10:00:00.000Z'),
      updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    } as unknown as FleetViolationDoc;
    // Stored before the field existed: no key at all.
    expect(toViolationDto(base).fromOldBook).toBe(false);
    expect(toViolationDto({ ...base, fromOldBook: false }).fromOldBook).toBe(false);
    expect(toViolationDto({ ...base, fromOldBook: true }).fromOldBook).toBe(true);
  });
});

describe('how a swept row is named on the run', () => {
  it('its car, its year or day, its money — and ✓ if somebody had ticked it', () => {
    const codeOfId = new Map([[V175, '175']]);
    const row = {
      kind: 'driver' as const,
      vehicleId: new Types.ObjectId(V175),
      vehicleCode: null,
      year: null,
      amount: 700,
      collected: true,
    };
    expect(
      describeViolation({ ...row, date: new Date('2025-03-06T00:00:00.000Z') }, codeOfId),
    ).toBe('175 2025-03-06: 700 ✓');
    expect(
      describeViolation(
        { ...row, kind: 'vehicle', year: 2025, date: null, amount: 180, collected: false },
        codeOfId,
      ),
    ).toBe('175 2025: 180');
    expect(
      describeViolation(
        { ...row, vehicleId: null, vehicleCode: 'كوستر', date: null, collected: false },
        codeOfId,
      ),
      'a car the registry never had, by the book’s code',
    ).toBe('كوستر —: 700');
  });
});

describe('the run — sweep first, then the book, and nothing over a failed sweep', () => {
  let dataDir = '';
  let written: Partial<FleetViolationDoc>[] = [];
  let previous: Record<string, unknown> | null = null;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'fleet-violations-reload-'));
    await writeFile(join(dataDir, CAR_VIOLATIONS_FILE), JSON.stringify(BOOK), 'utf8');
  });
  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    runs.log.length = 0;
    written = [];
    previous = null;
    for (const fn of [
      runs.waitForGoLiveRuns,
      runs.claimGoLiveRun,
      runs.recordGoLiveRefusal,
      runs.recordGoLiveFailure,
      runs.finishGoLiveRun,
    ]) {
      fn.mockClear();
    }
    runs.waitForGoLiveRuns.mockImplementation(async () => true);
    runs.claimGoLiveRun.mockImplementation(async () => {
      runs.log.push('claim');
      return true;
    });
    runs.recordGoLiveFailure.mockImplementation(async () => {
      runs.log.push('failure');
    });
    runs.finishGoLiveRun.mockImplementation(async () => {
      runs.log.push('finish');
    });

    vi.spyOn(userService, 'findByEmail').mockResolvedValue({
      _id: new Types.ObjectId(oid(9001)),
    } as never);
    vi.spyOn(fleetVehicleRepository, 'codeIndex').mockResolvedValue(new Map([['175', V175]]));
    vi.spyOn(fleetCatalogItemRepository, 'listKind').mockResolvedValue([
      {
        _id: new Types.ObjectId(T_PARK),
        name: { ar: 'الانتظار في الممنوع', en: 'Parking' },
        violationSide: 'company',
      },
      {
        _id: new Types.ObjectId(T_SPEED),
        name: { ar: 'سرعة', en: 'Speeding' },
        violationSide: 'driver',
      },
    ] as never);

    vi.spyOn(FleetGoLiveRunModel, 'findOne').mockImplementation(
      () =>
        ({
          lean: () => ({ exec: async () => (previous === null ? null : { outcome: previous }) }),
        }) as never,
    );
    vi.spyOn(FleetGoLiveRunModel, 'updateOne').mockImplementation(
      () =>
        ({
          exec: async () => {
            runs.log.push('progress');
            return {};
          },
        }) as never,
    );

    vi.spyOn(fleetViolationRepository, 'recordedBeforeChangedSince').mockResolvedValue([
      {
        kind: 'driver',
        vehicleId: new Types.ObjectId(V175),
        vehicleCode: null,
        year: null,
        date: new Date('2025-03-06T00:00:00.000Z'),
        amount: 700,
        collected: true,
      },
    ] as never);
    vi.spyOn(fleetViolationRepository, 'countRecordedSince').mockResolvedValue(4);
    vi.spyOn(fleetViolationRepository, 'softDeleteRecordedBefore').mockImplementation(async () => {
      runs.log.push('sweep:violations');
      return 12;
    });
    vi.spyOn(fleetViolationRepository, 'countSweptBefore').mockResolvedValue(12);
    vi.spyOn(fleetViolationRepository, 'existingByKey').mockImplementation(async (_ref, keyOf) => {
      runs.log.push('existing');
      return groupByKey(written as FleetViolationDoc[], keyOf);
    });
    vi.spyOn(fleetViolationRepository, 'createMany').mockImplementation(async (rows) => {
      runs.log.push('write');
      written.push(...rows);
      return [];
    });
    vi.spyOn(fleetGrievanceRepository, 'softDeleteRecordedBefore').mockImplementation(async () => {
      runs.log.push('sweep:grievances');
      return 1;
    });
    vi.spyOn(fleetGrievanceRepository, 'countSweptBefore').mockResolvedValue(1);
    vi.spyOn(fleetGrievanceRepository, 'recordedBeforeChangedSince').mockResolvedValue([
      { vehicleId: new Types.ObjectId(V175), year: 2024, totalBeforeGrievance: 1234 },
    ] as never);
    vi.spyOn(fleetGrievanceRepository, 'findByVehicleAndYear').mockResolvedValue(null);
    vi.spyOn(fleetGrievanceRepository, 'create').mockImplementation(async () => {
      runs.log.push('grievance');
      return {} as never;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('waits for the cars AND the first import, and refuses unclaimed while they are not done', async () => {
    runs.waitForGoLiveRuns.mockImplementation(async () => false);
    await runViolationsReloadGoLive(dataDir);
    expect(runs.waitForGoLiveRuns).toHaveBeenCalledWith([
      VEHICLE_GO_LIVE_MARK,
      VIOLATIONS_GO_LIVE_MARK,
    ]);
    expect(runs.recordGoLiveRefusal).toHaveBeenCalledWith(VIOLATIONS_RELOAD_MARK, {
      reason: 'violations-not-done',
    });
    expect(runs.claimGoLiveRun).not.toHaveBeenCalled();
    expect(runs.log, 'nothing swept, nothing written').toEqual([]);
  });

  it('refuses unclaimed when there is no admin to author the book', async () => {
    vi.spyOn(userService, 'findByEmail').mockResolvedValue(null);
    await runViolationsReloadGoLive(dataDir);
    expect(runs.recordGoLiveRefusal.mock.calls[0]?.[0]).toBe(VIOLATIONS_RELOAD_MARK);
    expect(runs.recordGoLiveRefusal.mock.calls[0]?.[1]).toMatchObject({ reason: 'no-admin' });
    expect(runs.claimGoLiveRun).not.toHaveBeenCalled();
    expect(runs.log).toEqual([]);
  });

  it('claims, SWEEPS, records the sweep, and only then writes the book — and finishes', async () => {
    await runViolationsReloadGoLive(dataDir);
    expect(runs.log).toEqual([
      'claim',
      'sweep:violations',
      'sweep:grievances',
      'progress',
      'existing',
      'write',
      'grievance',
      'finish',
    ]);
    expect(vi.mocked(fleetViolationRepository.softDeleteRecordedBefore).mock.calls[0]?.[0]).toBe(
      VIOLATIONS_RELOAD_CUTOFF,
    );
    expect(written.map((d) => [d.kind, d.isDeleted, d.fromOldBook])).toEqual([
      ['vehicle', false, true],
      ['driver', false, true],
      ['driver', true, true],
    ]);

    const [key, outcome] = runs.finishGoLiveRun.mock.calls[0]!;
    expect(key).toBe(VIOLATIONS_RELOAD_MARK);
    expect(outcome).toMatchObject({
      cutoff: '2026-09-23T21:00:00.000Z',
      deletedViolations: 12,
      deletedGrievances: 1,
      keptRecordedSince: 4,
      changedSinceCutoff: ['175 2025-03-06: 700 ✓'],
      changedSinceCutoffCount: 1,
      grievancesKeptSinceCutoff: ['175 2024: 1234'],
      vehicles: 1,
      imported: 3, // EVERY row of the book — the deleted fine included
      alreadyThere: 0,
      grievancesWritten: 1,
      grievancesKept: [],
      keptDeleted: 1,
      deletedRows: 1,
      unreadable: [],
      unknownCars: [],
      unmatchedDrivers: ['احمد جمال عطية'],
    });
    expect(runs.recordGoLiveFailure).not.toHaveBeenCalled();
  });

  it('writes NOTHING of the book over a sweep that failed — the run is left unfinished', async () => {
    vi.spyOn(fleetViolationRepository, 'softDeleteRecordedBefore').mockRejectedValue(
      new Error('primary stepped down'),
    );
    await runViolationsReloadGoLive(dataDir);
    expect(runs.log).toEqual(['claim', 'failure']);
    expect(runs.recordGoLiveFailure).toHaveBeenCalledWith(VIOLATIONS_RELOAD_MARK, {
      stage: 'sweep',
      error: 'primary stepped down',
      failed: 1,
    });
    expect(written).toEqual([]);
    expect(runs.finishGoLiveRun).not.toHaveBeenCalled();
  });

  it('a take-over finds the book already landed, and still reports what the first attempt swept', async () => {
    await runViolationsReloadGoLive(dataDir);
    const [, first] = runs.finishGoLiveRun.mock.calls[0]!;

    // The second attempt: the sweep has nothing left to take and nothing left to name — the rows
    // are deleted and their `updatedAt` moved — so the list comes from the run row.
    previous = first;
    runs.log.length = 0;
    runs.finishGoLiveRun.mockClear();
    vi.spyOn(fleetViolationRepository, 'recordedBeforeChangedSince').mockResolvedValue([]);
    vi.spyOn(fleetGrievanceRepository, 'findByVehicleAndYear').mockResolvedValue({
      totalBeforeGrievance: 5000,
    } as never);

    await runViolationsReloadGoLive(dataDir);
    expect(runs.log, 'nothing new written').not.toContain('write');
    expect(runs.finishGoLiveRun.mock.calls[0]?.[1]).toMatchObject({
      deletedViolations: 12,
      changedSinceCutoff: ['175 2025-03-06: 700 ✓'],
      changedSinceCutoffCount: 1,
      imported: 0,
      alreadyThere: 3,
      grievancesWritten: 0,
      grievancesKept: [],
    });
  });
});

describe('the step keeps the go-live conventions', () => {
  const source = code('violations-reload.ts');

  it('every refusal is checked BEFORE the claim, and written', () => {
    const claim = source.indexOf('claimGoLiveRun(VIOLATIONS_RELOAD_MARK');
    expect(claim).toBeGreaterThan(-1);
    for (const refusal of [
      'dir === null',
      '!existsSync(file)',
      'waitForGoLiveRuns(',
      'admin === null',
    ]) {
      expect(source.indexOf(refusal), `${refusal} is checked before the claim`).toBeGreaterThan(-1);
      expect(source.indexOf(refusal), `${refusal} is checked before the claim`).toBeLessThan(claim);
    }
    expect(source).toContain('waitForGoLiveRuns([VEHICLE_GO_LIVE_MARK, VIOLATIONS_GO_LIVE_MARK])');
    for (const reason of ['violations-not-done', 'no-admin']) {
      expect(source).toMatch(
        new RegExp(`recordGoLiveRefusal\\(VIOLATIONS_RELOAD_MARK,\\s*\\{\\s*reason: '${reason}'`),
      );
    }
  });

  it('sweeps after the claim and before the book is written', () => {
    const claim = source.indexOf('claimGoLiveRun(VIOLATIONS_RELOAD_MARK');
    const sweep = source.indexOf('await sweepRecordedBeforeCutoff(');
    const write = source.indexOf('await applyViolationsImport(');
    expect(sweep).toBeGreaterThan(claim);
    expect(write).toBeGreaterThan(sweep);
  });

  it('a run that FAILS is not marked done, so the next boot takes it over', () => {
    const partial = source.indexOf("'fleet go-live: partial violations reload'");
    const finish = source.indexOf('finishGoLiveRun(VIOLATIONS_RELOAD_MARK');
    expect(partial).toBeGreaterThan(-1);
    expect(finish).toBeGreaterThan(partial);
    expect(source.slice(partial, finish)).toContain('return;');
    expect(source.slice(0, partial)).toContain('recordGoLiveFailure(VIOLATIONS_RELOAD_MARK');
  });

  it('is started without being awaited, and skipped under test', () => {
    expect(source).toMatch(
      /startViolationsReloadGoLive\s*=\s*\(\):\s*void\s*=>\s*\{\s*\n\s*if \(isTest\) return;/,
    );
  });

  it('reads the book the first import read — no copy of it ships', () => {
    expect(source).toContain('join(dir, CAR_VIOLATIONS_FILE)');
  });
});
