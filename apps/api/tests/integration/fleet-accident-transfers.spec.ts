// Moving «المتبقي» from one car's accident files onto another file, against a real mongo.
//
// «اختار عربيه و جمبها مبلغ ... ينقص من متبقى العربيه و يمنعنى اخد اكتر من المبلغ اللى موجود على
// العربيه» — and a log of «خدت من مين او ادت ل مين». These are the rules only a database can prove:
// the draw lands on the source car's files oldest first, the car's figure and the filtered strip
// agree, the fleet total never moves, removing a transfer puts every piastre back, and two clerks
// taking from one car — or adding to one file — at once cannot both have it.
//
// EVERY FILE THAT TAKES IS BELOW ZERO. «اعرف المبلغ اللى بالسالب كام وشيله» (owner, 2026-11-09): a
// take brings the receiving file up to zero and never past it, so the server caps the amount by
// that file's negative (FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT) as it caps it by what the giving cars
// have (FLEET_ACCIDENT_TRANSFER_SHORT).
//
// The figures (EGP; remaining = collected + company cost − paid + in − out):
//   TR-214  B1  2026-01-10  3,000 + 1,000 − 1,000 =  3,000
//           B2  2026-03-01  2,000 +     0 −     0 =  2,000     car total 5,000
//   TR-150  A1  2026-09-20  1,500 +   500 − 7,300 = −5,300     the file that takes
//   TR-305  (no files yet)
import { ErrorCodes } from '@ecms/contracts';
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
import { fleetVehicleRepository } from '../../src/modules/fleet/vehicles/vehicle.repository';

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
  p: new Types.ObjectId(),
  q: new Types.ObjectId(),
  r: new Types.ObjectId(),
  s: new Types.ObjectId(),
  t: new Types.ObjectId(),
  u: new Types.ObjectId(),
  v: new Types.ObjectId(),
  w: new Types.ObjectId(),
  x: new Types.ObjectId(),
  y: new Types.ObjectId(),
  z: new Types.ObjectId(),
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
  p: 'TR-700',
  q: 'TR-701',
  r: 'TR-702',
  s: 'TR-801',
  t: 'TR-802',
  u: 'TR-803',
  v: 'TR-810',
  w: 'TR-811',
  x: 'TR-812',
  y: 'TR-820',
  z: 'TR-821',
};

/** Two cars outside `cars`: a deleted «TR-900» and the live car that carries that code now. */
const goneBookCar = new Types.ObjectId();
const liveBookCar = new Types.ObjectId();
/**
 * Cars whose registry code and old-book code are spelled differently: the go-live registry stores
 * «فورتشنر 2 » (trailing space), the book wrote «فورتشنر 2»; the registry stores «MG 2», the book
 * wrote «mg 2». Plus the car that takes from them.
 */
const spacedCar = new Types.ObjectId();
const latinCar = new Types.ObjectId();
const spellingTaker = new Types.ObjectId();
/** The old-book codes this file plants, cleaned up after. */
const BOOK_CODES = ['TR-600', 'TR-900', 'فورتشنر 2', 'mg 2'];

const vehicleDoc = (id: Types.ObjectId, code: string, suffix = '') => ({
  _id: id,
  code,
  typeId: new Types.ObjectId(),
  plateNumber: `س ص ${code}${suffix}`,
  chassisNumber: `CH-${code}${suffix}`,
  motorNumber: `MO-${code}${suffix}`,
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
});

const plantCars = async (): Promise<void> => {
  await FleetVehicleModel.collection.insertMany(
    (Object.keys(cars) as (keyof typeof cars)[]).map((key) => vehicleDoc(cars[key], CODES[key])),
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
        : { transfer: { fromVehicleIds: [String(cars[transfer.from])], amount: transfer.amount } }),
    },
    ACTOR,
  );

/** Take `amount` from `from` onto an existing file, through the edit — as the dialog does. */
const take = async (accidentId: string, from: keyof typeof cars, amount: number) => {
  const current = await fleetAccidentRepository.getById(accidentId);
  return fleetAccidentService.update(
    accidentId,
    { version: current.__v, transfer: { fromVehicleIds: [String(cars[from])], amount } },
    ACTOR,
  );
};

const file = (id: unknown) => fleetAccidentRepository.getById(String(id));
/** What a refusal's details carry: the figures in pounds, as plain decimal strings. */
const refusal = (code: string, figures: Record<string, string>) => ({
  httpStatus: 422,
  code,
  details: Object.entries(figures).map(([field, message]) => ({
    field,
    code: field.toUpperCase(),
    message,
  })),
});
const SHORT = ErrorCodes.FLEET_ACCIDENT_TRANSFER_SHORT;
const OVER = ErrorCodes.FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT;
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
  a1 = String((await record('a', '2026-09-20', 1500, 500, 7300))._id);
}, 120_000);

afterAll(async () => {
  const planted = [
    ...Object.values(cars),
    goneBookCar,
    liveBookCar,
    spacedCar,
    latinCar,
    spellingTaker,
  ];
  await FleetAccidentModel.deleteMany({
    $or: [{ vehicleId: { $in: planted } }, { vehicleCode: { $in: BOOK_CODES } }],
  }).exec();
  await FleetVehicleModel.deleteMany({ _id: { $in: planted } }).exec();
  await disconnectMongo();
  await replset?.stop();
});

describe('taking from another car’s remaining', () => {
  it('starts from the figures in the header', async () => {
    expect(await carFigure('b')).toBe(5000);
    expect(await remainingOf(a1)).toBe(-5300);
    expect(await stripFor('a', 'b')).toBe(-300);
  });

  it('REFUSES more than the car has, naming both figures, and changes nothing', async () => {
    await expect(take(a1, 'b', 5000.01)).rejects.toMatchObject(
      refusal(SHORT, { available: '5000.00', amount: '5000.01' }),
    );
    expect(await carFigure('b')).toBe(5000);
    expect((await file(a1)).transferredIn ?? 0).toBe(0);
    expect((await file(b1)).transferredOut ?? 0).toBe(0);
  });

  it('REFUSES more than a NEW file’s negative — and records nothing', async () => {
    // Paid 200 with nothing collected: the file is 200 below zero, and TR-214 has 5,000.
    await expect(
      record('c', '2026-09-21', 0, 0, 200, { from: 'b', amount: 200.01 }),
    ).rejects.toMatchObject(refusal(OVER, { deficit: '200.00', amount: '200.01' }));
    expect(await FleetAccidentModel.countDocuments({ vehicleId: cars.c }).exec()).toBe(0);
    expect(await carFigure('b')).toBe(5000);
  });

  it('reads an EDIT’s negative from the figures the edit saves, not the stored ones', async () => {
    // Stored, A1 is 5,300 below zero; paid 2,300 instead of 7,300 leaves it 300 below.
    const current = await file(a1);
    await expect(
      fleetAccidentService.update(
        a1,
        {
          version: current.__v,
          paidAmount: 2300,
          transfer: { fromVehicleIds: [String(cars.b)], amount: 300.01 },
        },
        ACTOR,
      ),
    ).rejects.toMatchObject(refusal(OVER, { deficit: '300.00', amount: '300.01' }));
    expect((await file(a1)).paidAmount, 'the edit’s facts are not saved either').toBe(7300);
    expect((await file(a1)).transferredIn ?? 0).toBe(0);
    expect(await carFigure('b')).toBe(5000);
  });

  it('refuses a car taking from itself', async () => {
    await expect(take(a1, 'a', 10)).rejects.toMatchObject({ httpStatus: 422 });
  });

  it('adds the amount to the file, and draws it from the source car’s OLDEST files first', async () => {
    await take(a1, 'b', 3500);
    expect(await remainingOf(a1), '−5,300 + 3,500').toBe(-1800);
    expect((await file(b1)).transferredOut, 'the oldest file gives all it had').toBe(3000);
    expect(await remainingOf(b1)).toBe(0);
    expect((await file(b2)).transferredOut, '…and the next one the rest').toBe(500);
    expect(await remainingOf(b2)).toBe(1500);
  });

  it('the car’s figure, the strip filtered to it, and the dialog agree', async () => {
    expect(await carFigure('b')).toBe(1500);
    expect(await stripFor('b')).toBe(1500);
    expect(await stripFor('a')).toBe(-1800);
  });

  it('never moves the total over both cars — the money only changed cars', async () => {
    expect(await stripFor('a', 'b')).toBe(-300);
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
    // Paid 1,000 with nothing collected: 1,000 below zero, and it takes exactly that.
    const c1 = await record('c', '2026-09-22', 0, 0, 1000, { from: 'b', amount: 1000 });
    expect(c1.transferredIn).toBe(1000);
    expect((await file(b2)).transferredOut, '500 before, 1,000 now').toBe(1500);
    expect(await carFigure('b')).toBe(500);
    expect(await carFigure('c'), 'up to zero, never past it').toBe(0);
    expect(await stripFor('a', 'b', 'c'), '−300 before, and C’s own −1,000').toBe(-1300);
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
    expect(await remainingOf(a1)).toBe(-5300);
    expect((await file(b1)).transferredOut).toBe(0);
    expect((await file(b2)).transferredOut, 'only the other transfer’s 1,000 is left on it').toBe(
      1000,
    );
    expect(await carFigure('b')).toBe(4000);
    expect(await stripFor('a', 'b', 'c')).toBe(-1300);
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
    expect(await carFigure('c'), 'back below zero').toBe(-1000);
    expect(await carFigure('b'), 'B1 alone').toBe(3000);
    expect((await fleetAccidentService.carTransfers(String(cars.b))).entries).toEqual([]);
    expect(await stripFor('a', 'b', 'c')).toBe(-3300);
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
  it('cannot both take its whole remaining — the second is told what is left', async () => {
    const source = await record('d', '2026-01-01', 500, 0, 0);
    // Each file is 400 below zero, so each may take 400 — but TR-410 has only 500 for both.
    const first = await record('e', '2026-09-01', 0, 0, 400);
    const second = await record('f', '2026-09-01', 0, 0, 400);
    const outcomes = await Promise.allSettled([
      take(String(first._id), 'd', 400),
      take(String(second._id), 'd', 400),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(refused?.status === 'rejected' && refused.reason).toMatchObject(
      refusal(SHORT, { available: '100.00', amount: '400.00' }),
    );
    expect((await file(source._id)).transferredOut).toBe(400);
    expect(await carFigure('d')).toBe(100);
  });
});

describe('two clerks adding to one file at the same moment', () => {
  // TR-803's file is 500 below zero. Each clerk takes 400 from a car of his own (TR-801, TR-802,
  // 1,000 each): each is within the negative alone, both together are not.
  it('cannot both fill its negative — the file never goes past zero', async () => {
    await record('s', '2026-01-01', 1000, 0, 0);
    await record('t', '2026-01-01', 1000, 0, 0);
    const taker = await record('u', '2026-09-01', 0, 0, 500);
    const id = String(taker._id);
    const outcomes = await Promise.allSettled([take(id, 's', 400), take(id, 't', 400)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === 'rejected');
    // Re-run on the file the first one left: 100 below zero is all there is to fill.
    expect(refused?.status === 'rejected' && refused.reason).toMatchObject(
      refusal(OVER, { deficit: '100.00', amount: '400.00' }),
    );
    expect((await file(id)).transferredIn).toBe(400);
    expect(await remainingOf(id)).toBe(-100);
    expect((await carFigure('s')) + (await carFigure('t')), 'only one car gave').toBe(1600);
  });
});

describe('a take planned on a figure that has moved since — «short» (race)', () => {
  // TR-810 shows 600 in the picker. Before the first clerk saves, a second takes 200 from it.
  it('is refused with what the car has NOW, and nothing moves', async () => {
    await record('v', '2026-01-01', 600, 0, 0);
    const shown = (await fleetAccidentService.carBalances()).find(
      (car) => car.vehicleId === String(cars.v),
    );
    expect(shown?.remaining).toBe(600);
    const other = await record('w', '2026-09-01', 0, 0, 200);
    await take(String(other._id), 'v', 200);
    const mine = await record('x', '2026-09-02', 0, 0, 600);
    await expect(take(String(mine._id), 'v', shown?.remaining ?? 0)).rejects.toMatchObject(
      refusal(SHORT, { available: '400.00', amount: '600.00' }),
    );
    expect((await file(mine._id)).transferredIn ?? 0).toBe(0);
    expect(await carFigure('v')).toBe(400);
    // …and the list read again offers what the save would allow.
    expect(
      (await fleetAccidentService.carBalances()).find((car) => car.vehicleId === String(cars.v))
        ?.remaining,
    ).toBe(400);
  });
});

describe('a file moved off the source car in the same save', () => {
  // TR-500: G1 500 (oldest), G2 −1,000 (the file that moves and takes), G3 −100 (overpaid). With
  // G2 the car is 600 below zero; without it, it has 400 to give.
  it('does not count itself: its own remaining leaves with it', async () => {
    await record('g', '2026-01-01', 500, 0, 0);
    const moving = await record('g', '2026-02-01', 0, 0, 1000);
    await record('g', '2026-03-01', 0, 0, 100);
    expect(await carFigure('g')).toBe(-600);
    const id = String(moving._id);
    const edit = async (amount: number) => {
      const current = await file(id);
      return fleetAccidentService.update(
        id,
        {
          version: current.__v,
          vehicleId: String(cars.h),
          transfer: { fromVehicleIds: [String(cars.g)], amount },
        },
        ACTOR,
      );
    };
    // Without the moving file the car has 500 − 100 = 400, so 401 is refused — and nothing moves.
    // Counted, the file would leave the car nothing at all to give.
    await expect(edit(401)).rejects.toMatchObject(
      refusal(SHORT, { available: '400.00', amount: '401.00' }),
    );
    expect(String((await file(id)).vehicleId)).toBe(String(cars.g));
    expect((await file(id)).transferredIn ?? 0).toBe(0);
    // 400 is what the car can give once the file has left it.
    const moved = await edit(400);
    expect(String(moved.vehicleId)).toBe(String(cars.h));
    expect(moved.transferredIn).toBe(400);
    expect(moved.transferredOut ?? 0, 'the file never drew on itself').toBe(0);
    expect(await carFigure('g'), 'G1 gave its 400: 500 − 400 − 100').toBe(0);
    expect(await carFigure('h'), 'G2: −1,000 + 400').toBe(-600);
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
    await record('m', '2026-09-01', 0, 0, 300, { from: 'k', amount: 300 });
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

describe('several drivers on one accident — «اكتر من سواق فى المره الواحده»', () => {
  it('files every driver, keeps the first as the single one, and is found by any of them', async () => {
    const first = new Types.ObjectId().toString();
    const second = new Types.ObjectId().toString();
    const doc = await fleetAccidentService.create(
      {
        vehicleId: String(cars.k),
        occurredAt: day('2026-09-10'),
        culprit: 'سائق أ، سائق ب',
        culpritEmployeeIds: [first, second],
        statement: 'حادث بسائقين',
        amountCollected: 0,
        companyCost: 0,
        paidAmount: 0,
      },
      ACTOR,
    );
    expect((doc.culpritEmployeeIds ?? []).map(String)).toEqual([first, second]);
    expect(String(doc.culpritEmployeeId)).toBe(first);
    const bySecond = await fleetAccidentService.list({
      page: 1,
      pageSize: 25,
      sortDir: 'desc',
      culpritEmployeeId: [second],
    } as Parameters<typeof fleetAccidentService.list>[0]);
    expect(bySecond.items.map((item) => String(item._id))).toEqual([String(doc._id)]);
  });
});

describe('taking from several cars — the first to zero before the next', () => {
  // TR-700 has 300 left, TR-701 has 1,000. A file on TR-702, 1,500 below zero, takes 500 from
  // [TR-700, TR-701].
  it('empties the first car picked before drawing on the second', async () => {
    await record('p', '2026-01-01', 300, 0, 0);
    await record('q', '2026-01-01', 1000, 0, 0);
    const taker = await record('r', '2026-09-01', 0, 0, 1500);
    const id = String(taker._id);
    const edit = async (amount: number) => {
      const current = await file(id);
      return fleetAccidentService.update(
        id,
        {
          version: current.__v,
          transfer: { fromVehicleIds: [String(cars.p), String(cars.q)], amount },
        },
        ACTOR,
      );
    };
    // Together they have 1,300: 1,400 is refused and nothing moves.
    await expect(edit(1400)).rejects.toMatchObject(
      refusal(SHORT, { available: '1300.00', amount: '1400.00' }),
    );
    expect(await carFigure('p')).toBe(300);

    const updated = await edit(500);
    expect(updated.transferredIn).toBe(500);
    expect(await carFigure('p'), 'the first car picked is emptied').toBe(0);
    expect(await carFigure('q'), '…and only the rest comes from the second').toBe(800);
    const log = await fleetAccidentService.carTransfers(String(cars.r));
    expect(log.entries.map((e) => [e.otherVehicleCode, e.amount]).sort()).toEqual([
      ['TR-700', 300],
      ['TR-701', 200],
    ]);
  });

  it('offers only the cars with something left', async () => {
    const offered = (await fleetAccidentService.carBalances()).map((car) => car.vehicleCode);
    expect(offered).toContain('TR-701');
    expect(offered, 'emptied — nothing to give').not.toContain('TR-700');
    const q = (await fleetAccidentService.carBalances()).find(
      (car) => car.vehicleCode === 'TR-701',
    );
    expect(q?.remaining).toBe(800);
  });
});

describe('a deleted car is never offered — the list and the save agree', () => {
  it('leaves a soft-deleted car out of car-balances, as the save refuses it', async () => {
    await record('y', '2026-01-01', 700, 0, 0);
    const offered = async () =>
      (await fleetAccidentService.carBalances()).map((car) => car.vehicleId);
    expect(await offered()).toContain(String(cars.y));
    await fleetVehicleRepository.softDeleteById(String(cars.y), { by: ACTOR });
    expect(await offered()).not.toContain(String(cars.y));
    const taker = await record('z', '2026-09-01', 0, 0, 100);
    await expect(take(String(taker._id), 'y', 100)).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('counts an old-book code for the LIVE car carrying it, never a deleted one', async () => {
    // «TR-900» belonged to a car that was deleted (its own file: 300) and is carried now by a live
    // car. An old-book file under «TR-900» (250) is the live car's — and only that is offered.
    await FleetVehicleModel.collection.insertMany([
      { ...vehicleDoc(goneBookCar, 'TR-900', '-old'), isDeleted: true },
      vehicleDoc(liveBookCar, 'TR-900', '-new'),
    ]);
    await FleetAccidentModel.collection.insertMany(
      [
        { _id: new Types.ObjectId(), vehicleId: goneBookCar, vehicleCode: null, amount: 300 },
        { _id: new Types.ObjectId(), vehicleId: null, vehicleCode: 'TR-900', amount: 250 },
      ].map(({ amount, ...ref }) => ({
        ...ref,
        occurredAt: null,
        culprit: 'من الدفتر',
        culpritEmployeeId: null,
        statement: 'حادث قديم',
        companyCost: 0,
        amountCollected: amount,
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
      })),
    );
    const listed = (await fleetAccidentService.carBalances()).filter(
      (car) => car.vehicleCode === 'TR-900',
    );
    expect(listed).toEqual([
      { vehicleId: String(liveBookCar), vehicleCode: 'TR-900', remaining: 250 },
    ]);
    // The figure offered is the figure the save is capped by.
    expect((await fleetAccidentService.carTransfers(String(liveBookCar))).remaining).toBe(250);
  });
});

describe('an old-book code spelled unlike the registry — the list counts it as the save does', () => {
  /** An old-book file (no registry id) under `code`, holding `collected − paid`. */
  const bookFile = (code: string, collected: number, paid: number) => ({
    _id: new Types.ObjectId(),
    vehicleId: null,
    vehicleCode: code,
    occurredAt: null,
    culprit: 'من الدفتر',
    culpritEmployeeId: null,
    statement: 'حادث قديم',
    companyCost: 0,
    amountCollected: collected,
    paidAmount: paid,
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
  const listedFor = async (id: Types.ObjectId) =>
    (await fleetAccidentService.carBalances()).find((car) => car.vehicleId === String(id));
  const saveCap = async (id: Types.ObjectId): Promise<number> =>
    (await fleetAccidentService.carTransfers(String(id))).remaining;

  beforeAll(async () => {
    await FleetVehicleModel.collection.insertMany([
      vehicleDoc(spacedCar, 'فورتشنر 2 '),
      vehicleDoc(latinCar, 'MG 2'),
      vehicleDoc(spellingTaker, 'TR-950'),
    ]);
  });

  it('offers a car stored with a trailing space for the book file written without it', async () => {
    await FleetAccidentModel.collection.insertOne(bookFile('فورتشنر 2', 800, 0));
    expect(await saveCap(spacedCar)).toBe(800);
    expect(await listedFor(spacedCar)).toEqual({
      vehicleId: String(spacedCar),
      vehicleCode: 'فورتشنر 2 ',
      remaining: 800,
    });
  });

  it('counts a book file in another Latin case — the figure offered is the one the save allows', async () => {
    // The car's own file holds +500; the book's «mg 2» file is overpaid by 300 → 200 to give.
    await fleetAccidentService.create(
      {
        vehicleId: String(latinCar),
        occurredAt: day('2026-01-01'),
        culprit: 'سائق',
        statement: 'حادث',
        amountCollected: 500,
        companyCost: 0,
        paidAmount: 0,
      },
      ACTOR,
    );
    await FleetAccidentModel.collection.insertOne(bookFile('mg 2', 0, 300));
    expect(await saveCap(latinCar)).toBe(200);
    expect((await listedFor(latinCar))?.remaining).toBe(200);

    // Taking the whole figure offered is accepted — never refused SHORT.
    const offered = (await listedFor(latinCar))?.remaining ?? 0;
    const taker = await fleetAccidentService.create(
      {
        vehicleId: String(spellingTaker),
        occurredAt: day('2026-09-01'),
        culprit: 'سائق',
        statement: 'حادث',
        amountCollected: 0,
        companyCost: 0,
        paidAmount: 1000,
        transfer: { fromVehicleIds: [String(latinCar)], amount: offered },
      },
      ACTOR,
    );
    expect(await remainingOf(taker._id)).toBe(-800);
    expect(await saveCap(latinCar)).toBe(0);
    expect(await listedFor(latinCar), 'emptied — no longer offered').toBeUndefined();
  });
});
