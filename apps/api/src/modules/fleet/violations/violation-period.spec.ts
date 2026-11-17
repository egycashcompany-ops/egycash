// «مخالفات السائقين في الفترة» — the dashboard's period over the drivers' ledger, against a REAL
// database (an in-memory Mongo): what only the store can answer — which rows a whole-day bound
// keeps, what `$ne: true` makes of a row with no flag, which shape a `kind` clause leaves out.
//
// The promises:
//   · DRIVERS' fines only — a company statement carries a year, never a day, and never counts
//     (also when someone wrote a date on one);
//   · WHOLE days on both ends — an old-book row stored at 01:00Z on the first day and at 21:00Z on
//     the last is in; the instant before and the day after are out;
//   · «قائمة» = `collected` not true, a missing flag included; «محصَّلة» = ticked; as of now;
//   · by type: count desc, amount desc, name — «غير محدد» always last; a type gone from the catalog
//     keeps its id and a null name;
//   · a fine carried onto another year's statement counts by ITS OWN day on the car it sits on now;
//   · a vehicle set (type, operation or branch) drops the old book's carless rows; the typed codes
//     still reach them;
//   · the rows are the register's first page (`kind=driver&from&to&sortBy=date&sortDir=desc`), at
//     most `limit`, every name resolved, and `more` the rest;
//   · «مخالفات قائمة» (every year) splits the drivers by whom, with the distinct employees.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type LocalizedString } from '@ecms/contracts';
import { FleetViolationModel } from './violation.model';
import { UNSPECIFIED_VIOLATION_TYPE, isUnspecifiedViolationType } from './violation-unspecified';

const ID = (n: number): string => `64b0000000000000000000${String(n).padStart(2, '0')}`;
const oid = (n: number) => new Types.ObjectId(ID(n));

// Cars: A (150, live), B (151, deleted since), C (152, live, in the set). The set (type, operation
// or branch) resolves to B and C.
const CAR_A = 1;
const CAR_B = 2;
const CAR_C = 3;
const SET_IDS = [ID(CAR_B), ID(CAR_C)];
const CODES: Record<string, string> = { '150': ID(CAR_A), '151': ID(CAR_B), '152': ID(CAR_C) };
const MAKE = 20;

// Types: speed and belt (ordinary), phone (gone from the catalog), «غير محدد» (the catalog's).
const SPEED = 30;
const BELT = 31;
const PHONE_GONE = 32;
const UNSPEC = 33;
const NAMES = new Map<string, LocalizedString>([
  [ID(SPEED), { ar: 'سرعة', en: 'Speed' }],
  [ID(BELT), { ar: 'حزام', en: 'Seatbelt' }],
  [ID(UNSPEC), { ...UNSPECIFIED_VIOLATION_TYPE.driver }],
]);

vi.mock('../vehicles/vehicle-set', () => ({
  resolveVehicleFilterIds: vi.fn(async (f: Record<string, unknown>) =>
    f['typeIds'] !== undefined || f['operationIds'] !== undefined || f['branchIds'] !== undefined
      ? SET_IDS
      : undefined,
  ),
}));

const { fleetViolationService } = await import('./violation.service');
const { fleetViolationRepository } = await import('./violation.repository');
const { fleetVehicleRepository } = await import('../vehicles/vehicle.repository');
const { fleetVehicleTypeRepository } = await import('../vehicle-types/vehicle-type.repository');
const { fleetCatalogItemRepository } = await import('../catalogs/catalog-item.repository');

const OCT = {
  from: new Date('2026-10-01T00:00:00.000Z'),
  to: new Date('2026-10-31T00:00:00.000Z'),
};

let server: MongoMemoryServer;
let seq = 0;

/** A raw row, written past the schema so a missing `collected` stays missing (an old row). */
const row = (over: Record<string, unknown>): Record<string, unknown> => {
  seq += 1;
  return {
    _id: new Types.ObjectId(),
    kind: 'driver',
    vehicleId: oid(CAR_A),
    vehicleCode: null,
    violationTypeId: oid(SPEED),
    amount: 100,
    year: null,
    count: null,
    unitValue: null,
    date: new Date('2026-10-10T00:00:00.000Z'),
    filedYear: null,
    homeVehicleId: null,
    driverEmployeeId: null,
    driverName: 'مجهول',
    collected: false,
    isDeleted: false,
    // Recorded in order, so `_id` breaks a tie on the same day the way the register does.
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)),
    ...over,
  };
};

const EMP_1 = oid(60);
const EMP_2 = oid(61);

/** The month's world, and what is around it. Ids kept for the row assertions. */
const W = {
  firstDayEarly: row({ date: new Date('2026-10-01T01:00:00.000Z'), amount: 50 }),
  lastDayLate: row({
    date: new Date('2026-10-31T21:00:00.000Z'),
    amount: 70,
    driverEmployeeId: EMP_1,
    driverName: null,
    collected: true,
  }),
  beforeWindow: row({ date: new Date('2026-09-30T23:59:59.999Z'), amount: 1000 }),
  afterWindow: row({ date: new Date('2026-11-01T00:00:00.000Z'), amount: 1000 }),
  // A company statement, with a stray date on it — still never a period's.
  statement: row({
    kind: 'vehicle',
    year: 2026,
    count: 3,
    unitValue: 100,
    amount: 300,
    date: new Date('2026-10-15T00:00:00.000Z'),
    driverName: null,
  }),
  statementNoDate: row({ kind: 'vehicle', year: 2026, count: 1, amount: 40, date: null }),
  deleted: row({ isDeleted: true, amount: 999 }),
  // No `collected` key at all — an old row: owed.
  noFlag: (() => {
    const r = row({
      date: new Date('2026-10-12T00:00:00.000Z'),
      amount: 30,
      violationTypeId: oid(BELT),
    });
    delete r['collected'];
    return r;
  })(),
  beltOwed: row({
    date: new Date('2026-10-13T00:00:00.000Z'),
    amount: 40,
    violationTypeId: oid(BELT),
  }),
  beltCollected: row({
    date: new Date('2026-10-14T00:00:00.000Z'),
    amount: 35,
    violationTypeId: oid(BELT),
    collected: true,
    driverEmployeeId: EMP_2,
    driverName: null,
  }),
  // Carried from A onto B's 2025 statement: counted by its OWN day, on B (where it sits now).
  carried: row({
    vehicleId: oid(CAR_B),
    homeVehicleId: oid(CAR_A),
    filedYear: 2025,
    date: new Date('2026-10-20T00:00:00.000Z'),
    amount: 60,
    violationTypeId: oid(PHONE_GONE),
    driverEmployeeId: EMP_1,
    driverName: null,
  }),
  // The old book's row on a car the registry never had — known by its code.
  book: row({
    vehicleId: null,
    vehicleCode: 'B-9',
    date: new Date('2026-10-05T22:00:00.000Z'),
    amount: 25,
    violationTypeId: oid(UNSPEC),
    driverName: 'حسن علي',
  }),
  unspecA: row({
    date: new Date('2026-10-06T00:00:00.000Z'),
    amount: 10,
    violationTypeId: oid(UNSPEC),
  }),
  unspecC: row({
    vehicleId: oid(CAR_C),
    date: new Date('2026-10-07T00:00:00.000Z'),
    amount: 10,
    violationTypeId: oid(UNSPEC),
  }),
  unspecC2: row({
    vehicleId: oid(CAR_C),
    date: new Date('2026-10-07T00:00:00.000Z'),
    amount: 10,
    violationTypeId: oid(UNSPEC),
  }),
  // Another year, still owed — «مخالفات قائمة» counts every year.
  lastYear: row({
    date: new Date('2025-03-01T00:00:00.000Z'),
    amount: 200,
    driverEmployeeId: EMP_2,
    driverName: null,
  }),
};

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('ecms-violation-period'));
  await FleetViolationModel.collection.insertMany(Object.values(W));
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(() => {
  vi.spyOn(fleetVehicleRepository, 'idsByCodes').mockImplementation(async (codes) =>
    codes.flatMap((code) => (CODES[code] === undefined ? [] : [CODES[code]])),
  );
  vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockImplementation(
    async (ids) =>
      ids.flatMap((id) => {
        const code = Object.entries(CODES).find(([, carId]) => carId === id)?.[0];
        return code === undefined
          ? []
          : [{ _id: new Types.ObjectId(id), code, typeId: oid(MAKE), isDeleted: id === ID(CAR_B) }];
      }) as never,
  );
  vi.spyOn(fleetVehicleTypeRepository, 'findByIdsSystem').mockImplementation(
    async (ids) =>
      ids.map((id) => ({
        _id: new Types.ObjectId(id),
        name: { ar: 'تويوتا', en: 'Toyota' },
      })) as never,
  );
  vi.spyOn(fleetCatalogItemRepository, 'namesByIds').mockImplementation(
    async (ids) =>
      new Map(ids.flatMap((id) => (NAMES.has(id) ? [[id, NAMES.get(id) as LocalizedString]] : []))),
  );
});
afterEach(() => vi.restoreAllMocks());

const idsOf = (rows: { violationId: string }[]): string[] => rows.map((r) => r.violationId);
const idOf = (doc: Record<string, unknown>): string => String(doc['_id']);

describe('periodDigest — the drivers’ fines of a period, as they stand now', () => {
  it('counts the drivers’ fines of the month: whole days both ends, statements and deleted rows never', async () => {
    const out = await fleetViolationService.periodDigest(OCT);
    // In: firstDayEarly 50, lastDayLate 70, noFlag 30, beltOwed 40, beltCollected 35, carried 60,
    // book 25, unspecA 10, unspecC 10, unspecC2 10 = 10 fines, 340.
    expect(out.count).toBe(10);
    expect(out.amount).toBe(340);
    // Owed = not ticked, the row with no flag included: everything but lastDayLate and beltCollected.
    expect(out.owed).toEqual({ count: 8, amount: 235 });
    expect(out.collected).toEqual({ count: 2, amount: 105 });
    expect(out.owed.count + out.collected.count).toBe(out.count);
  });

  it('a whole day: 01:00Z on the first day and 21:00Z on the last are in, the instants around them out', async () => {
    const one = await fleetViolationService.periodDigest({
      from: new Date('2026-10-31T00:00:00.000Z'),
      to: new Date('2026-10-31T00:00:00.000Z'),
    });
    expect(one.count).toBe(1);
    expect(one.amount).toBe(70);
    const first = await fleetViolationService.periodDigest({
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-01T00:00:00.000Z'),
    });
    expect(first.amount).toBe(50);
    const around = await fleetViolationService.periodDigest({
      from: new Date('2026-09-30T00:00:00.000Z'),
      to: new Date('2026-11-01T00:00:00.000Z'),
    });
    expect(around.amount).toBe(2340);
  });

  it('by type: count desc, then amount desc; a gone type keeps its id with no name; «غير محدد» LAST', async () => {
    const out = await fleetViolationService.periodDigest(OCT);
    expect(out.byType).toEqual([
      // speed: firstDayEarly 50 + lastDayLate 70 = 2 fines, 120 — but belt has 3.
      {
        violationTypeId: ID(BELT),
        name: NAMES.get(ID(BELT)),
        unspecified: false,
        count: 3,
        amount: 105,
      },
      {
        violationTypeId: ID(SPEED),
        name: NAMES.get(ID(SPEED)),
        unspecified: false,
        count: 2,
        amount: 120,
      },
      { violationTypeId: ID(PHONE_GONE), name: null, unspecified: false, count: 1, amount: 60 },
      // Four fines — the most of any type — and still last.
      {
        violationTypeId: ID(UNSPEC),
        name: NAMES.get(ID(UNSPEC)),
        unspecified: true,
        count: 4,
        amount: 55,
      },
    ]);
    expect(out.byType.reduce((sum, t) => sum + t.count, 0)).toBe(out.count);
    expect(out.byType.reduce((sum, t) => sum + t.amount, 0)).toBe(out.amount);
  });

  it('a carried fine counts by its OWN day on the car it sits on now', async () => {
    const onB = await fleetViolationService.periodDigest({ ...OCT, vehicleCodes: ['151'] });
    expect(onB).toMatchObject({ count: 1, amount: 60 });
    const onA = await fleetViolationService.periodDigest({ ...OCT, vehicleCodes: ['150'] });
    // A: firstDayEarly, lastDayLate, noFlag, beltOwed, beltCollected, unspecA — not the carried one.
    expect(onA).toMatchObject({ count: 6, amount: 235 });
  });

  it('a vehicle set drops the old book’s carless rows; the typed codes still reach them', async () => {
    for (const set of [
      { typeIds: [ID(70)] },
      { operationIds: [ID(71)] },
      { branchIds: [ID(72)] },
    ]) {
      const out = await fleetViolationService.periodDigest({ ...OCT, ...set });
      // B and C only: carried 60 + unspecC 10 + unspecC2 10 — the book's B-9 row is in no set.
      expect(out, JSON.stringify(set)).toMatchObject({ count: 3, amount: 80 });
    }
    const byCode = await fleetViolationService.periodDigest({ ...OCT, vehicleCodes: ['B-9'] });
    expect(byCode).toMatchObject({ count: 1, amount: 25 });
  });

  it('nothing in the period is zeros and no types — never a missing figure', async () => {
    const out = await fleetViolationService.periodDigest({
      from: new Date('2030-01-01T00:00:00.000Z'),
      to: new Date('2030-01-31T00:00:00.000Z'),
    });
    expect(out).toEqual({
      count: 0,
      amount: 0,
      owed: { count: 0, amount: 0 },
      collected: { count: 0, amount: 0 },
      byType: [],
    });
  });
});

describe('dashboardRows — the register’s first page of the period', () => {
  it('newest fine day first (the tie by the newest recorded), at most `limit`, `more` the rest', async () => {
    const out = await fleetViolationService.dashboardRows(OCT, 6);
    expect(idsOf(out.rows)).toEqual(
      [W.lastDayLate, W.carried, W.beltCollected, W.beltOwed, W.noFlag, W.unspecC2].map(idOf),
    );
    expect(out.more).toBe(4);
    // The same rows the register lists on its first page — one call, one order.
    const page = await fleetViolationService.list({
      kind: 'driver',
      from: OCT.from,
      to: OCT.to,
      page: 1,
      pageSize: 6,
      sortBy: 'date',
      sortDir: 'desc',
    });
    expect(page.items.map((doc) => String(doc._id))).toEqual(idsOf(out.rows));
    expect(page.meta.totalItems).toBe(out.rows.length + out.more);
  });

  it('resolves every name: code and make (a deleted car’s too, with no record link), type, day', async () => {
    const out = await fleetViolationService.dashboardRows(OCT, 10);
    const byId = new Map(out.rows.map((r) => [r.violationId, r]));
    expect(byId.get(idOf(W.lastDayLate))).toEqual({
      violationId: idOf(W.lastDayLate),
      vehicleId: ID(CAR_A),
      code: '150',
      typeName: { ar: 'تويوتا', en: 'Toyota' },
      vehicleDeleted: false,
      // The stored instant's own day — never a time.
      date: '2026-10-31',
      driverEmployeeId: String(EMP_1),
      driverName: null,
      violationTypeId: ID(SPEED),
      violationType: NAMES.get(ID(SPEED)),
      unspecified: false,
      amount: 70,
      collected: true,
    });
    expect(byId.get(idOf(W.carried))).toMatchObject({
      vehicleId: ID(CAR_B),
      code: '151',
      vehicleDeleted: true,
      violationType: null,
      date: '2026-10-20',
    });
    // The old book's row: its own code, no make, no registry car.
    expect(byId.get(idOf(W.book))).toMatchObject({
      vehicleId: null,
      code: 'B-9',
      typeName: null,
      vehicleDeleted: false,
      date: '2026-10-05',
      driverName: 'حسن علي',
      unspecified: true,
      collected: false,
    });
    // The row with no flag is owed («قائمة»).
    expect(byId.get(idOf(W.noFlag))?.collected).toBe(false);
    expect(out.rows).toHaveLength(10);
    expect(out.more).toBe(0);
    expect(out.rows.some((r) => r.violationId === idOf(W.statement))).toBe(false);
  });

  it('a set drops the book’s carless rows from the list too', async () => {
    const out = await fleetViolationService.dashboardRows({ ...OCT, branchIds: [ID(72)] }, 6);
    expect(idsOf(out.rows).sort()).toEqual([W.carried, W.unspecC, W.unspecC2].map(idOf).sort());
    expect(out.more).toBe(0);
  });
});

describe('the register’s «من / إلى» — the fine’s day, whole days', () => {
  it('lists driver rows only, the bounded days whole; without `kind` a statement still never matches', async () => {
    const page = await fleetViolationService.list({
      from: OCT.from,
      to: OCT.to,
      page: 1,
      pageSize: 50,
      sortDir: 'desc',
    });
    expect(page.meta.totalItems).toBe(10);
    expect(page.items.every((doc) => doc.kind === 'driver')).toBe(true);
    // Beside the other filters: owed belts of the month.
    const owedBelts = await fleetViolationService.list({
      from: OCT.from,
      to: OCT.to,
      collected: false,
      violationTypeId: [ID(BELT)],
      page: 1,
      pageSize: 50,
      sortDir: 'desc',
    });
    expect(owedBelts.items.map((doc) => String(doc._id)).sort()).toEqual(
      [W.noFlag, W.beltOwed].map(idOf).sort(),
    );
  });
});

describe('«مخالفات قائمة» — every year, the drivers split by whom', () => {
  it('counts every year’s owed driver fines and the distinct employees of the attributed ones', async () => {
    const out = await fleetViolationService.openDigest({ filter: {}, bookOnly: true });
    // Owed driver rows of every year: firstDayEarly, beforeWindow, afterWindow, noFlag, beltOwed,
    // carried, book, unspecA, unspecC, unspecC2, lastYear (lastDayLate and beltCollected ticked).
    expect(out.drivers.total).toEqual({ count: 11, amount: 2435 });
    // Attributed: carried (EMP_1) + lastYear (EMP_2) — two fines, two people.
    expect(out.drivers.attributed).toEqual({ amount: 260, count: 2, drivers: 2 });
    expect(out.drivers.unlinked).toEqual({ amount: 25, count: 1 });
    expect(out.drivers.unknown).toEqual({ amount: 2150, count: 8 });
    // The statements: 300 (×3) + 40 (×1).
    expect(out.company).toEqual({ amount: 340, count: 4 });
    expect(out.bookOnly).toEqual({
      company: { amount: 0, count: 0 },
      drivers: { amount: 25, count: 1 },
    });
    // A narrowed view: no book rows (they are in no branch), no `bookOnly`.
    const branch = await fleetViolationService.openDigest({
      filter: { branchIds: [ID(72)] },
      bookOnly: false,
    });
    expect(branch.bookOnly).toBeNull();
    expect(branch.drivers.total).toEqual({ count: 3, amount: 80 });
    expect(branch.drivers.attributed).toEqual({ amount: 60, count: 1, drivers: 1 });
  });

  it('the distinct employees come from the repository’s own group', async () => {
    const groups = await fleetViolationRepository.driverFineGroups(undefined);
    const attributed = groups.find((g) => g.attributed);
    expect(attributed).toMatchObject({ count: 2, drivers: 2 });
    for (const group of groups.filter((g) => !g.attributed)) expect(group.drivers).toBe(0);
  });
});

describe('«غير محدد» is the catalog’s own row, by its name', () => {
  it('knows both sides’ rows, spacing folded, and nothing else', () => {
    expect(isUnspecifiedViolationType({ ...UNSPECIFIED_VIOLATION_TYPE.driver })).toBe(true);
    expect(isUnspecifiedViolationType({ ...UNSPECIFIED_VIOLATION_TYPE.company })).toBe(true);
    expect(isUnspecifiedViolationType({ ar: ' غير محدد  (مخالفات السائقين)', en: '' })).toBe(true);
    expect(isUnspecifiedViolationType({ ar: 'غير محدد', en: 'Unspecified' })).toBe(false);
    expect(isUnspecifiedViolationType(null)).toBe(false);
  });
});
