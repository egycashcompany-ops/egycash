// The licensing board (التراخيص) against a real mongo — membership, and what happens to the ticks
// when a car leaves it.
//
// Two rules the owner stated, and neither can be proved without a database:
//
//   • «العربيات ... يكون اخرها ت ... لكن اللى برقاش م متبقاش موجوده» — the board is a JOIN over the
//     licence-class catalog, so which cars are on it is decided at read time by a name an admin
//     owns, not by anything this module stores.
//   • «لو رجعت كل العلامات تتشال» — a car that leaves the board loses its ticks, so a car that
//     comes back arrives blank. There are TWO ways to leave and they are written in different
//     places: the CAR is moved to another class, or the CLASS ITSELF is renamed. Each is closed
//     by a different mechanism, and this file exercises both.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type ScopeSelector } from '../../src/shared/types';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { FleetVehicleLicensingModel } from '../../src/modules/fleet/licensing/licensing.model';
import { fleetLicensingService } from '../../src/modules/fleet/licensing/licensing.service';
import { fleetVehicleService } from '../../src/modules/fleet/vehicles/vehicle.service';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const ACTOR = new Types.ObjectId().toString();
/** What `scopeSelector` builds for an admin holding an `organization` grant — no narrowing. */
const SCOPE: ScopeSelector = {
  scope: 'organization',
  userId: ACTOR,
  branchId: null,
  departmentId: null,
  sectionId: null,
};

const classes = {
  /** On the board. */
  barqashT: new Types.ObjectId(),
  gizaT: new Types.ObjectId(),
  /** Off it — the twin that differs by one letter, which is the whole point of the rule. */
  barqashM: new Types.ObjectId(),
  /** Neither: a class whose name merely ENDS in the letter ت without being «… ت». */
  bayt: new Types.ObjectId(),
};

const cars = {
  onBoard: new Types.ObjectId(),
  alsoOnBoard: new Types.ObjectId(),
  offBoard: new Types.ObjectId(),
  notAClass: new Types.ObjectId(),
};

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const plantClasses = async (): Promise<void> => {
  await FleetCatalogItemModel.collection.insertMany([
    { _id: classes.barqashT, kind: 'licenseClass', name: { ar: 'برقاش ت', en: 'Barqash T' }, countsForAlarm: false, violationSide: null, isActive: true, isDeleted: false },
    { _id: classes.gizaT, kind: 'licenseClass', name: { ar: 'العجوزة ت', en: 'Agouza T' }, countsForAlarm: false, violationSide: null, isActive: true, isDeleted: false },
    { _id: classes.barqashM, kind: 'licenseClass', name: { ar: 'برقاش م', en: 'Barqash M' }, countsForAlarm: false, violationSide: null, isActive: true, isDeleted: false },
    { _id: classes.bayt, kind: 'licenseClass', name: { ar: 'بيت', en: 'House' }, countsForAlarm: false, violationSide: null, isActive: true, isDeleted: false },
  ]);
};

const plantCars = async (): Promise<void> => {
  const base = (id: Types.ObjectId, code: string, classId: Types.ObjectId) => ({
    _id: id,
    code,
    typeId: new Types.ObjectId(),
    plateNumber: `س ص ${code}`,
    chassisNumber: `CH-${code}`,
    motorNumber: `MO-${code}`,
    joinedAt: day('2026-01-01'),
    licenseExpiresAt: day('2027-01-01'),
    licenseClassId: classId,
    operationId: null,
    insuranceCompanyId: null,
    branchId: null,
    departmentId: null,
    radio: { issi: null, motorolaSn: null },
    status: 'active',
    statusReason: null,
    licenseImage: null,
    isDeleted: false,
    schemaVersion: 1,
    __v: 0,
    createdAt: day('2026-01-01'),
    updatedAt: day('2026-01-01'),
  });
  await FleetVehicleModel.collection.insertMany([
    base(cars.onBoard, 'LIC-100', classes.barqashT),
    base(cars.alsoOnBoard, 'LIC-200', classes.gizaT),
    base(cars.offBoard, 'LIC-300', classes.barqashM),
    base(cars.notAClass, 'LIC-400', classes.bayt),
  ]);
};

/** The board's codes, in the order it answers them. */
const codes = async (): Promise<string[]> =>
  (await fleetLicensingService.board(SCOPE))
    .filter((row) => row.code.startsWith('LIC-'))
    .map((row) => row.code);

const rowFor = async (code: string) =>
  (await fleetLicensingService.board(SCOPE)).find((row) => row.code === code);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plantClasses();
  await plantCars();
}, 120_000);

afterAll(async () => {
  await FleetVehicleLicensingModel.deleteMany({ vehicleId: { $in: Object.values(cars) } }).exec();
  await FleetVehicleModel.deleteMany({ code: { $regex: '^LIC-' } }).exec();
  await FleetCatalogItemModel.deleteMany({ _id: { $in: Object.values(classes) } }).exec();
  await disconnectMongo();
  await replset?.stop();
});

describe('who is on the board', () => {
  it('takes the «… ت» cars and refuses the «… م» twin', async () => {
    const on = await codes();
    expect(on).toContain('LIC-100');
    expect(on).toContain('LIC-200');
    expect(on, '«برقاش م» is not on the board').not.toContain('LIC-300');
  });

  it('matches the WORD — a class merely ending in the letter is not a licensing class', async () => {
    expect(await codes(), '«بيت» ends with ت and is not «… ت»').not.toContain('LIC-400');
  });

  it('carries the car and its licence, so an absence can be explained', async () => {
    const row = await rowFor('LIC-100');
    expect(row?.plateNumber).toBe('س ص LIC-100');
    expect(row?.chassisNumber).toBe('CH-LIC-100');
    expect(row?.licenseClass).toBe('برقاش ت');
    // The date the errand is about, carried on the row rather than looked up per car.
    expect(row?.licenseExpiresAt).toBe(day('2027-01-01').toISOString());
  });

  it('reads a car nobody has ticked as four falses, without writing a row for it', async () => {
    const row = await rowFor('LIC-200');
    expect(row).toMatchObject({
      insuranceHandover: false,
      insuranceReceipt: false,
      taxHandover: false,
      taxReceipt: false,
    });
    expect(
      await FleetVehicleLicensingModel.countDocuments({ vehicleId: cars.alsoOnBoard }).exec(),
      'looking at the board writes nothing',
    ).toBe(0);
  });
});

describe('ticking a square', () => {
  it('lands, and comes back on the next read', async () => {
    await fleetLicensingService.setMark(
      { vehicleId: String(cars.onBoard), mark: 'insuranceHandover', value: true },
      ACTOR,
      SCOPE,
    );
    expect(await rowFor('LIC-100')).toMatchObject({
      insuranceHandover: true,
      insuranceReceipt: false,
    });
  });

  it('writes ONE row however many squares are ticked', async () => {
    await fleetLicensingService.setMark(
      { vehicleId: String(cars.onBoard), mark: 'taxHandover', value: true },
      ACTOR,
      SCOPE,
    );
    expect(
      await FleetVehicleLicensingModel.countDocuments({
        vehicleId: cars.onBoard,
        isDeleted: false,
      }).exec(),
    ).toBe(1);
    expect(await rowFor('LIC-100')).toMatchObject({
      insuranceHandover: true,
      taxHandover: true,
    });
  });

  it('unticks — the clerk can undo a square as freely as they set it', async () => {
    await fleetLicensingService.setMark(
      { vehicleId: String(cars.onBoard), mark: 'taxHandover', value: false },
      ACTOR,
      SCOPE,
    );
    expect(await rowFor('LIC-100')).toMatchObject({ taxHandover: false });
  });

  it('refuses a square for a car that is not on the board', async () => {
    // A mark nobody can see, undo or explain is worse than a refusal — and this is also what a
    // stale tab meets after the class was renamed under it.
    await expect(
      fleetLicensingService.setMark(
        { vehicleId: String(cars.offBoard), mark: 'insuranceHandover', value: true },
        ACTOR,
        SCOPE,
      ),
    ).rejects.toThrow();
  });
});

describe('«لو رجعت كل العلامات تتشال» — leaving the board voids the ticks', () => {
  it('when the CAR is moved to a «م» class, and stays void when it comes back', async () => {
    // LIC-100 currently holds a tick. Move it off the board through the ordinary edit path.
    const before = await FleetVehicleModel.findById(cars.onBoard).lean().exec();
    await fleetVehicleService.update(
      String(cars.onBoard),
      { licenseClassId: String(classes.barqashM), version: (before as { __v: number }).__v },
      ACTOR,
      SCOPE,
    );
    expect(await codes(), 'it has left the board').not.toContain('LIC-100');
    expect(
      await FleetVehicleLicensingModel.countDocuments({
        vehicleId: cars.onBoard,
        isDeleted: false,
      }).exec(),
      'and its ticks went with it',
    ).toBe(0);

    const moved = await FleetVehicleModel.findById(cars.onBoard).lean().exec();
    await fleetVehicleService.update(
      String(cars.onBoard),
      { licenseClassId: String(classes.barqashT), version: (moved as { __v: number }).__v },
      ACTOR,
      SCOPE,
    );
    expect(await codes(), 'and it is back').toContain('LIC-100');
    expect(await rowFor('LIC-100'), 'blank, not half-done').toMatchObject({
      insuranceHandover: false,
      insuranceReceipt: false,
      taxHandover: false,
      taxReceipt: false,
    });
  });

  it('keeps what a retired row held — it leaves the screen, not the database', async () => {
    // «الداتا اللى ممسوحه متظهرش للمستخدم تبقى فى الداتا بيز فقط». The tick from the test above
    // is still there, marked deleted, which is what makes this a retirement and not an erasure.
    const retired = await FleetVehicleLicensingModel.find({
      vehicleId: cars.onBoard,
      isDeleted: true,
    })
      .lean()
      .exec();
    expect(retired.length, 'the row is kept').toBeGreaterThan(0);
    expect(
      retired.some((row) => (row as unknown as { insuranceHandover: boolean }).insuranceHandover),
      'and it still says what was done',
    ).toBe(true);
  });

  it('when the CLASS ITSELF is renamed — nothing about the car changes, so the read sweeps it', async () => {
    await fleetLicensingService.setMark(
      { vehicleId: String(cars.alsoOnBoard), mark: 'taxHandover', value: true },
      ACTOR,
      SCOPE,
    );
    expect(await rowFor('LIC-200')).toMatchObject({ taxHandover: true });

    // «العجوزة ت» becomes «العجوزة م». The vehicle document is untouched, so there is no write on
    // the car for a hook to fire on — the board's own read is what notices.
    await FleetCatalogItemModel.updateOne(
      { _id: classes.gizaT },
      { $set: { 'name.ar': 'العجوزة م' } },
    ).exec();
    expect(await codes(), 'the car has left').not.toContain('LIC-200');
    expect(
      await FleetVehicleLicensingModel.countDocuments({
        vehicleId: cars.alsoOnBoard,
        isDeleted: false,
      }).exec(),
      'and its ticks are void',
    ).toBe(0);

    await FleetCatalogItemModel.updateOne(
      { _id: classes.gizaT },
      { $set: { 'name.ar': 'العجوزة ت' } },
    ).exec();
    expect(await rowFor('LIC-200'), 'and it returns blank').toMatchObject({ taxHandover: false });
  });

  it('leaves OTHER cars’ ticks alone while it sweeps', async () => {
    // The sweep asks one question about a known set of ids. A version that asked it per reader,
    // or that voided everything not in the scoped page, would empty the board for a branch user.
    await fleetLicensingService.setMark(
      { vehicleId: String(cars.onBoard), mark: 'insuranceReceipt', value: true },
      ACTOR,
      SCOPE,
    );
    await fleetLicensingService.setMark(
      { vehicleId: String(cars.alsoOnBoard), mark: 'insuranceHandover', value: true },
      ACTOR,
      SCOPE,
    );
    expect(await rowFor('LIC-100')).toMatchObject({ insuranceReceipt: true });
    expect(await rowFor('LIC-200')).toMatchObject({ insuranceHandover: true });
  });
});
