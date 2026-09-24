// Moving «المتبقي» from one car's accident files onto another file, against a real mongo.
//
// «اختار عربيه و جمبها مبلغ ... ينقص من متبقى العربيه و يمنعنى اخد اكتر من المبلغ اللى موجود على
// العربيه» — and a log of «خدت من مين او ادت ل مين». These are the rules only a database can prove:
// the draw lands on the source car's files oldest first, the car's figure and the filtered strip
// agree, the fleet total never moves, removing a transfer puts every piastre back, and two clerks
// taking from one car at once cannot both take its whole remaining.
//
// The figures (EGP; remaining = collected + company cost − paid + in − out):
//   TR-214  B1  2026-01-10  3,000 + 1,000 − 1,000 = 3,000
//           B2  2026-03-01  2,000 +     0 −     0 = 2,000      car total 5,000
//   TR-150  A1  2026-09-20  1,500 +   500 − 1,300 =   700
//   TR-305  (no files yet)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetAccidentModel } from '../../src/modules/fleet/accidents/accident.model';
import { fleetAccidentService } from '../../src/modules/fleet/accidents/accident.service';
import { fleetAccidentRepository } from '../../src/modules/fleet/accidents/accident.repository';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const ACTOR = new Types.ObjectId().toString();
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const cars = {
  a: new Types.ObjectId(),
  b: new Types.ObjectId(),
  c: new Types.ObjectId(),
  d: new Types.ObjectId(),
  e: new Types.ObjectId(),
  f: new Types.ObjectId(),
  g: new Types.ObjectId(),
  h: new Types.ObjectId(),
  k: new Types.ObjectId(),
  m: new Types.ObjectId(),
};
const CODES: Record<keyof typeof cars, string> = {
  a: 'TR-150',
  b: 'TR-214',
  c: 'TR-305',
  d: 'TR-410',
  e: 'TR-411',
  f: 'TR-412',
  g: 'TR-500',
  h: 'TR-501',
  k: 'TR-600',
  m: 'TR-601',
};

const plantCars = async (): Promise<void> => {
  await FleetVehicleModel.collection.insertMany(
    (Object.keys(cars) as (keyof typeof cars)[]).map((key) => ({
      _id: cars[key],
      code: CODES[key],
      typeId: new Types.ObjectId(),
      plateNumber: `س ص ${CODES[key]}`,
      chassisNumber: `CH-${CODES[key]}`,
      motorNumber: `MO-${CODES[key]}`,
      joinedAt: day('2026-01-01'),
      licenseExpiresAt: day('2027-01-01'),
      licenseClassId: null,
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
    })),
  );
};

const record = async (
  car: keyof typeof cars,
  occurred: string,
  collected: number,
  cost: number,
  paid: number,
  transfer?: { from: keyof typeof cars; amount: number },
) =>
  fleetAccidentService.create(
    {
      vehicleId: String(cars[car]),
      occurredAt: day(occurred),
      culprit: 'سائق',
      statement: 'حادث',
      amountCollected: collected,
      companyCost: cost,
      paidAmount: paid,
      ...(transfer === undefined
        ? {}
        : { transfer: { fromVehicleId: String(cars[transfer.from]), amount: transfer.amount } }),
    },
    ACTOR,
  );

/** Take `amount` from `from` onto an existing file, through the edit — as the dialog does. */
const take = async (accidentId: string, from: keyof typeof cars, amount: number) => {
  const current = await fleetAccidentRepository.getById(accidentId);
  return fleetAccidentService.update(
    accidentId,
    { version: current.__v, transfer: { fromVehicleId: String(cars[from]), amount } },
    ACTOR,
  );
};

const file = (id: unknown) => fleetAccidentRepository.getById(String(id));
const remainingOf = async (id: unknown): Promise<number> => {
  const doc = await file(id);
  return (
    doc.amountCollected +
    doc.companyCost -
    doc.paidAmount +
    (doc.transferredIn ?? 0) -
    (doc.transferredOut ?? 0)
  );
};
const carFigure = async (car: keyof typeof cars): Promise<number> =>
  (await fleetAccidentService.carTransfers(String(cars[car]))).remaining;
const stripFor = async (...keys: (keyof typeof cars)[]): Promise<number> =>
  (await fleetAccidentService.summary({ vehicleCodes: keys.map((key) => CODES[key]) })).remaining;

let b1 = '';
let b2 = '';
let a1 = '';

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plantCars();
  b1 = String((await record('b', '2026-01-10', 3000, 1000, 1000))._id);
  b2 = String((await record('b', '2026-03-01', 2000, 0, 0))._id);
  a1 = String((await record('a', '2026-09-20', 1500, 500, 1300))._id);
}, 120_000);

afterAll(async () => {
  await FleetAccidentModel.deleteMany({
    $or: [{ vehicleId: { $in: Object.values(cars) } }],
  }).exec();
  await FleetVehicleModel.deleteMany({ _id: { $in: Object.values(cars) } }).exec();
  await disconnectMongo();
  await replset?.stop();
});

describe('taking from another car’s remaining', () => {
  it('starts from the figures in the header', async () => {
    expect(await carFigure('b')).toBe(5000);
    expect(await remainingOf(a1)).toBe(700);
    expect(await stripFor('a', 'b')).toBe(5700);
  });

  it('REFUSES more than the car has, and changes nothing', async () => {
    await expect(take(a1, 'b', 5000.01)).rejects.toMatchObject({ httpStatus: 422 });
    expect(await carFigure('b')).toBe(5000);
    expect((await file(a1)).transferredIn ?? 0).toBe(0);
    expect((await file(b1)).transferredOut ?? 0).toBe(0);
  });

  it('refuses a car taking from itself', async () => {
    await expect(take(a1, 'a', 10)).rejects.toMatchObject({ httpStatus: 422 });
  });

  it('adds the amount to the file, and draws it from the source car’s OLDEST files first', async () => {
    await take(a1, 'b', 3500);
    expect(await remainingOf(a1), '700 + 3,500').toBe(4200);
    expect((await file(b1)).transferredOut, 'the oldest file gives all it had').toBe(3000);
    expect(await remainingOf(b1)).toBe(0);
    expect((await file(b2)).transferredOut, '…and the next one the rest').toBe(500);
    expect(await remainingOf(b2)).toBe(1500);
  });

  it('the car’s figure, the strip filtered to it, and the dialog agree', async () => {
    expect(await carFigure('b')).toBe(1500);
    expect(await stripFor('b')).toBe(1500);
    expect(await stripFor('a')).toBe(4200);
  });

  it('never moves the total over both cars — the money only changed cars', async () => {
    expect(await stripFor('a', 'b')).toBe(5700);
  });

  it('logs the transfer on BOTH cars, each from its own side', async () => {
    const from = await fleetAccidentService.carTransfers(String(cars.b));
    expect(from.entries).toHaveLength(1);
    expect(from.entries[0]).toMatchObject({
      direction: 'out',
      accidentId: a1,
      otherVehicleCode: 'TR-150',
      amount: 3500,
    });
    const into = await fleetAccidentService.carTransfers(String(cars.a));
    expect(into.entries).toHaveLength(1);
    expect(into.entries[0]).toMatchObject({
      direction: 'in',
      accidentId: a1,
      otherVehicleCode: 'TR-214',
      amount: 3500,
    });
    expect(into.entries[0]?.transferId).toBe(from.entries[0]?.transferId);
  });

  it('takes on a NEW file as it is recorded, from what the car has left', async () => {
    const c1 = await record('c', '2026-09-22', 0, 0, 0, { from: 'b', amount: 1000 });
    expect(c1.transferredIn).toBe(1000);
    expect((await file(b2)).transferredOut, '500 before, 1,000 now').toBe(1500);
    expect(await carFigure('b')).toBe(500);
    expect(await carFigure('c')).toBe(1000);
    expect(await stripFor('a', 'b', 'c')).toBe(5700);
  });

  it('refuses moving a file that other files took from onto another car', async () => {
    const current = await file(b2);
    await expect(
      fleetAccidentService.update(b2, { version: current.__v, vehicleId: String(cars.c) }, ACTOR),
    ).rejects.toMatchObject({ httpStatus: 422 });
  });

  it('still lets the facts of a file that gave be edited', async () => {
    const current = await file(b2);
    const updated = await fleetAccidentService.update(
      b2,
      { version: current.__v, notes: 'دفعة' },
      ACTOR,
    );
    expect(updated.notes).toBe('دفعة');
    expect(updated.transferredOut, 'what it gave is untouched').toBe(1500);
  });
});

describe('removing a transfer from the log', () => {
  it('puts every piastre back where it came from', async () => {
    const log = await fleetAccidentService.carTransfers(String(cars.a));
    const transferId = log.entries[0]?.transferId ?? '';
    await fleetAccidentService.voidTransfer(a1, transferId, ACTOR);
    expect(await remainingOf(a1)).toBe(700);
    expect((await file(b1)).transferredOut).toBe(0);
    expect((await file(b2)).transferredOut, 'only the other transfer’s 1,000 is left on it').toBe(
      1000,
    );
    expect(await carFigure('b')).toBe(4000);
    expect(await stripFor('a', 'b', 'c')).toBe(5700);
  });

  it('keeps the removed transfer in the database and out of the log', async () => {
    const raw = await FleetAccidentModel.collection.findOne({ _id: new Types.ObjectId(a1) });
    const transfers = (raw?.['transfersIn'] ?? []) as {
      voidedAt: Date | null;
      voidReason: string;
    }[];
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.voidedAt).toBeInstanceOf(Date);
    expect(transfers[0]?.voidReason).toBe('removed');
    expect((await fleetAccidentService.carTransfers(String(cars.a))).entries).toEqual([]);
    const b = await fleetAccidentService.carTransfers(String(cars.b));
    expect(
      b.entries.map((entry) => [entry.direction, entry.otherVehicleCode, entry.amount]),
    ).toEqual([['out', 'TR-305', 1000]]);
  });

  it('answers 404 for a transfer that is already removed', async () => {
    const raw = await FleetAccidentModel.collection.findOne({ _id: new Types.ObjectId(a1) });
    const id = String((raw?.['transfersIn'] as { _id: Types.ObjectId }[])[0]?._id);
    await expect(fleetAccidentService.voidTransfer(a1, id, ACTOR)).rejects.toMatchObject({
      httpStatus: 404,
    });
  });
});

describe('deleting a file that took from, or gave to, another', () => {
  it('a file that GAVE takes its money back from whoever drew on it', async () => {
    // B2 gave 1,000 to C's file. Deleting B2 voids that transfer whole.
    await fleetAccidentService.softDelete(b2, ACTOR);
    expect(await carFigure('c')).toBe(0);
    expect(await carFigure('b'), 'B1 alone').toBe(3000);
    expect((await fleetAccidentService.carTransfers(String(cars.b))).entries).toEqual([]);
    expect(await stripFor('a', 'b', 'c')).toBe(3700);
  });

  it('a file that TOOK gives the money back to the car it came from', async () => {
    await take(a1, 'b', 1000);
    expect((await file(b1)).transferredOut).toBe(1000);
    await fleetAccidentService.softDelete(a1, ACTOR);
    expect((await file(b1)).transferredOut).toBe(0);
    expect(await carFigure('b')).toBe(3000);
  });
});

describe('two clerks taking from one car at the same moment', () => {
  it('cannot both take its whole remaining', async () => {
    const source = await record('d', '2026-01-01', 500, 0, 0);
    const first = await record('e', '2026-09-01', 0, 0, 0);
    const second = await record('f', '2026-09-01', 0, 0, 0);
    const outcomes = await Promise.allSettled([
      take(String(first._id), 'd', 400),
      take(String(second._id), 'd', 400),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect((await file(source._id)).transferredOut).toBe(400);
    expect(await carFigure('d')).toBe(100);
  });
});

describe('a file moved off the source car in the same save', () => {
  // TR-500: G 500 (oldest), F 1,000, H −400 (overpaid) — the car has 1,100.
  it('does not draw on itself: its own remaining leaves with it', async () => {
    await record('g', '2026-01-01', 500, 0, 0);
    const moving = await record('g', '2026-02-01', 1000, 0, 0);
    await record('g', '2026-03-01', 0, 0, 400);
    expect(await carFigure('g')).toBe(1100);
    const id = String(moving._id);
    const edit = async (amount: number) => {
      const current = await file(id);
      return fleetAccidentService.update(
        id,
        {
          version: current.__v,
          vehicleId: String(cars.h),
          transfer: { fromVehicleId: String(cars.g), amount },
        },
        ACTOR,
      );
    };
    // Without the moving file the car has 500 − 400 = 100, so 1,100 is refused — and nothing moves.
    await expect(edit(1100)).rejects.toMatchObject({ httpStatus: 422 });
    expect(String((await file(id)).vehicleId)).toBe(String(cars.g));
    expect((await file(id)).transferredIn ?? 0).toBe(0);
    // 100 is what the car can give once the file has left it.
    const moved = await edit(100);
    expect(String(moved.vehicleId)).toBe(String(cars.h));
    expect(moved.transferredIn).toBe(100);
    expect(moved.transferredOut ?? 0, 'the file never drew on itself').toBe(0);
    expect(await carFigure('g'), 'G gave its 100: 400 − 400').toBe(0);
    expect(await carFigure('h'), 'F: 1,000 + 100').toBe(1100);
  });
});

describe('a file kept from the old book that a transfer drew on', () => {
  // O: an old-book file for «TR-600» with no registry id, 800 remaining. The registry now has a
  // car TR-600 too, so O is one of that car's files by its code.
  const old = new Types.ObjectId();

  it('can still be given its own car — that is not a move', async () => {
    await FleetAccidentModel.collection.insertOne({
      _id: old,
      vehicleId: null,
      vehicleCode: 'TR-600',
      occurredAt: null,
      culprit: 'من الدفتر',
      culpritEmployeeId: null,
      statement: 'حادث قديم',
      companyCost: 0,
      amountCollected: 800,
      paidAmount: 0,
      transfersIn: [],
      transferredIn: 0,
      transferredOut: 0,
      status: 'open',
      notes: null,
      isDeleted: false,
      __v: 0,
      createdAt: day('2020-01-01'),
      updatedAt: day('2020-01-01'),
    });
    expect(await carFigure('k')).toBe(800);
    await record('m', '2026-09-01', 0, 0, 0, { from: 'k', amount: 300 });
    expect((await file(old)).transferredOut).toBe(300);
    expect(await carFigure('k')).toBe(500);

    // Moving it to ANOTHER car is still refused: what it gave is logged against TR-600.
    const first = await file(old);
    await expect(
      fleetAccidentService.update(
        String(old),
        { version: first.__v, vehicleId: String(cars.m) },
        ACTOR,
      ),
    ).rejects.toMatchObject({ httpStatus: 422 });

    // Naming the registry car that carries its own code is allowed — the form needs it to save.
    const second = await file(old);
    const saved = await fleetAccidentService.update(
      String(old),
      { version: second.__v, vehicleId: String(cars.k), notes: 'رُبط بالسجل' },
      ACTOR,
    );
    expect(String(saved.vehicleId)).toBe(String(cars.k));
    expect(saved.transferredOut).toBe(300);
    expect(await carFigure('k')).toBe(500);
  });
});
