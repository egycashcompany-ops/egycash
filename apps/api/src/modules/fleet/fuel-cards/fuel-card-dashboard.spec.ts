// «الوقود والمصروفات» — the fuel cards the fleet dashboard reads, against a REAL database (an
// in-memory Mongo): what only the store can answer — which cards a branch keeps, what one `$group`
// sums per company and for the cards on no car, which charges «شُحن اليوم» counts once a filter
// narrows, which card expires first, which cards are flagged and how.
//
// The promises (plan D10, §4.3):
//   · «الفرع» is the branch of the card's CURRENT car (`resolveVehicleFilterIds`, deleted cars
//     included, by their last branch) ∩ the typed codes; a card on no car is in no branch, so it
//     drops out under a branch and is counted in the company view only;
//   · the summary's per-company cards and the no-car cards / balance come from the same `$group`;
//   · «شُحن اليوم» follows WHICH cards are asked (company, cars, branch, number) — never the state
//     filter (a request waiting, a balance below a line) — and counts their charges, a card deleted
//     since included (the company view counts it); with none, every charge of the day as before;
//     `charged: false` never asks it;
//   · «أقربها» = the earliest expiry in the caller's window;
//   · «كروت تحتاج متابعة» = every flagged card with its states (critical ⊕ low), most urgent first,
//     then the car's code, the cards on no car last; ≤ limit rows, `total` every flagged card; a
//     deleted car still names the card (`vehicleDeleted`).
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetFuelCardModel, FleetFuelCardMovementModel } from './fuel-card.model';

const ID = (n: number): string => `64b00000000000000000f0${String(n).padStart(2, '0')}`;
const oid = (n: number) => new Types.ObjectId(ID(n));

// Cars: A «150» (live, B1), B «151» (deleted since, its last branch B1), C «152» (live, B2).
const CAR_A = ID(1);
const CAR_B = ID(2);
const CAR_C = ID(3);
const B1 = ID(10);
const B2 = ID(11);
const MAKE = ID(20);
const CARS: Record<string, { code: string; isDeleted: boolean }> = {
  [CAR_A]: { code: '150', isDeleted: false },
  [CAR_B]: { code: '151', isDeleted: true },
  [CAR_C]: { code: '152', isDeleted: false },
};
const IN_BRANCH: Record<string, string[]> = { [B1]: [CAR_A, CAR_B], [B2]: [CAR_C] };

vi.mock('../vehicles/vehicle-set', () => ({
  resolveVehicleFilterIds: vi.fn(async (f: { branchIds?: readonly string[] }) =>
    f.branchIds === undefined ? undefined : f.branchIds.flatMap((id) => IN_BRANCH[id] ?? []),
  ),
}));

const { fleetFuelCardService } = await import('./fuel-card.service');
const { fleetVehicleRepository } = await import('../vehicles/vehicle.repository');
const { fleetVehicleTypeRepository } = await import('../vehicle-types/vehicle-type.repository');

const TODAY = '2026-11-12';
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const RULES = { today: TODAY, warnDays: 30, yellowAt: 300, redAt: 100 };
/** The window the expiring count and its link send: tomorrow … today + 30, whole days. */
const WINDOW = {
  expiresFrom: day('2026-11-13'),
  expiresBefore: new Date('2026-12-12T23:59:59.999Z'),
};
/** 10:00 in Cairo on the 12th. */
const NOW = new Date('2026-11-12T08:00:00.000Z');

let server: MongoMemoryServer;

const card = (n: number, over: Record<string, unknown>) => ({
  _id: oid(n),
  vehicleId: null,
  label: null,
  company: 'wataniya',
  name: `كارت ${n}`,
  number: `70001234123400${String(n).padStart(2, '0')}`,
  expiresAt: null,
  password: null,
  balance: 1000,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: null,
  isDeleted: false,
  ...over,
});

const K = {
  // On A: nearly empty (critical), expiry far away.
  critical: card(31, {
    vehicleId: new Types.ObjectId(CAR_A),
    balance: 50,
    expiresAt: day('2027-03-01'),
  }),
  // On B (deleted since): expired TODAY — on the last instant's side of the bound.
  expiredOnDeleted: card(32, {
    vehicleId: new Types.ObjectId(CAR_B),
    company: 'chillout',
    expiresAt: new Date('2026-11-12T21:00:00.000Z'),
  }),
  // On C: a request waiting and a low balance; no expiry on file.
  requestedLow: card(33, {
    vehicleId: new Types.ObjectId(CAR_C),
    balance: 250,
    requestedAmount: 500,
  }),
  // On no car («سفر»): low and expiring in ten days.
  travelLowExpiring: card(34, {
    label: 'سفر',
    company: 'chillout',
    balance: 120,
    expiresAt: day('2026-11-22'),
  }),
  // On no car («اسبير»): nothing to follow.
  spare: card(35, { label: 'اسبير', balance: 2000 }),
  // On A: expiring in five days — the nearest.
  expiringSoon: card(36, {
    vehicleId: new Types.ObjectId(CAR_A),
    balance: 5000,
    expiresAt: day('2026-11-17'),
  }),
  // On A, deleted: never anywhere.
  deleted: card(37, { vehicleId: new Types.ObjectId(CAR_A), balance: 10, isDeleted: true }),
  // On A: expired yesterday AND nearly empty.
  expiredCritical: card(38, {
    vehicleId: new Types.ObjectId(CAR_A),
    balance: 20,
    expiresAt: day('2026-11-11'),
  }),
  // On no car («احتياطي»): expired — after the cars' expired ones.
  spareExpired: card(39, { label: 'احتياطي', balance: 900, expiresAt: day('2026-10-01') }),
};

const move = (
  cardId: Types.ObjectId,
  amount: number,
  at: Date,
  over: Record<string, unknown> = {},
) => ({
  _id: new Types.ObjectId(),
  cardId,
  kind: 'charge',
  amount,
  balanceAfter: 0,
  counterpartCardId: null,
  receiptId: null,
  at,
  cancelledBySheet: null,
  isDeleted: false,
  ...over,
});

const MOVES = [
  move(K.critical._id, 100, new Date('2026-11-12T06:00:00.000Z')), // today, A (B1)
  move(K.requestedLow._id, 200, new Date('2026-11-12T07:00:00.000Z')), // today, C (B2)
  move(K.travelLowExpiring._id, 50, new Date('2026-11-12T07:30:00.000Z')), // today, no car
  move(K.deleted._id, 7, new Date('2026-11-12T07:40:00.000Z')), // today, a DELETED card
  // Cancelled by the company's sheet — never counted.
  move(K.critical._id, 999, new Date('2026-11-12T07:45:00.000Z'), {
    cancelledBySheet: {
      reconciliationId: oid(90),
      movementId: oid(91),
      fileName: 'x.xlsx',
      at: NOW,
      by: null,
    },
  }),
  // Yesterday in Cairo (21:59Z on the 11th = 23:59 Cairo) — not today's.
  move(K.critical._id, 1000, new Date('2026-11-11T21:59:00.000Z')),
];

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('ecms-fuel-card-dashboard'));
  await FleetFuelCardModel.collection.insertMany(Object.values(K));
  await FleetFuelCardMovementModel.collection.insertMany(MOVES);
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(() => {
  vi.spyOn(fleetVehicleRepository, 'idsByCodes').mockImplementation(async (codes) =>
    Object.entries(CARS).flatMap(([id, car]) => (codes.includes(car.code) ? [id] : [])),
  );
  vi.spyOn(fleetVehicleRepository, 'findByIdsSystem').mockImplementation(
    async (ids) =>
      ids.flatMap((id) =>
        CARS[id] === undefined
          ? []
          : [{ _id: new Types.ObjectId(id), typeId: new Types.ObjectId(MAKE), ...CARS[id] }],
      ) as never,
  );
  vi.spyOn(fleetVehicleTypeRepository, 'findByIdsSystem').mockImplementation(
    async (ids) =>
      ids.map((id) => ({
        _id: new Types.ObjectId(id),
        name: { ar: 'تويوتا', en: 'Toyota' },
      })) as never,
  );
});
afterEach(() => vi.restoreAllMocks());

describe('summary — the cards of the reader’s branches, by their CURRENT car', () => {
  it('the company view: every live card, each company’s, and the cards on no car with their balance', async () => {
    const out = await fleetFuelCardService.summary({}, NOW);
    expect(out).toMatchObject({
      cardCount: 8,
      wataniyaCards: 6,
      chilloutCards: 2,
      noCarCards: 3,
      noCarBalance: 3020, // 120 + 2000 + 900
    });
    expect(out.wataniyaCards + out.chilloutCards).toBe(out.cardCount);
  });

  it('a branch: the cards on its cars — a deleted car’s too — and never a card on no car', async () => {
    const out = await fleetFuelCardService.summary({ branchIds: [B1] }, NOW);
    // critical, expiredOnDeleted, expiringSoon, expiredCritical — the deleted card never.
    expect(out).toMatchObject({
      cardCount: 4,
      wataniyaCards: 3,
      chilloutCards: 1,
      noCarCards: 0,
      noCarBalance: 0,
    });
    expect(out.wataniyaBalance).toBe(50 + 5000 + 20);
    expect(out.chilloutBalance).toBe(1000);
  });

  it('the typed codes AND the branch: their intersection; none in common narrows to nothing', async () => {
    expect(
      (await fleetFuelCardService.summary({ branchIds: [B1], vehicleCodes: ['151'] }, NOW))
        .cardCount,
    ).toBe(1);
    const none = await fleetFuelCardService.summary(
      { branchIds: [B2], vehicleCodes: ['150'] },
      NOW,
    );
    expect(none).toMatchObject({ cardCount: 0, chargedTodayAmount: 0 });
  });
});

describe('«شُحن اليوم» follows the same cards', () => {
  it('with no filter: every charge of the Cairo day, as it always was (a sheet-cancelled one never)', async () => {
    expect((await fleetFuelCardService.summary({}, NOW)).chargedTodayAmount).toBe(357);
  });

  it('under a branch: the charges of the branch’s cards only — a card deleted since too', async () => {
    // 100 on «critical» + 7 on the card deleted since (on A, B1): the company view's 357 counts it.
    expect((await fleetFuelCardService.summary({ branchIds: [B1] }, NOW)).chargedTodayAmount).toBe(
      107,
    );
    expect((await fleetFuelCardService.summary({ branchIds: [B2] }, NOW)).chargedTodayAmount).toBe(
      200,
    );
  });

  it('under the screen’s own filters (a company, the cars): the same narrowing', async () => {
    expect(
      (await fleetFuelCardService.summary({ company: 'chillout' }, NOW)).chargedTodayAmount,
    ).toBe(50);
    expect(
      (await fleetFuelCardService.summary({ vehicleCodes: ['152'] }, NOW)).chargedTodayAmount,
    ).toBe(200);
  });

  it('never by the screen’s STATE filter: a request approved or a card topped up is still today’s charge', async () => {
    // «طلبات بانتظار الاعتماد» (requested) and «رصيد منخفض» (below the yellow line): the cards
    // shown narrow, the day's charges do not — only which cards (here: none, or B2's).
    expect((await fleetFuelCardService.summary({ requested: true }, NOW)).chargedTodayAmount).toBe(
      357,
    );
    expect(
      (await fleetFuelCardService.summary({ balanceBelow: 300 }, NOW)).chargedTodayAmount,
    ).toBe(357);
    expect((await fleetFuelCardService.summary({ ...WINDOW }, NOW)).chargedTodayAmount).toBe(357);
    const b2Requested = await fleetFuelCardService.summary(
      { branchIds: [B2], requested: true },
      NOW,
    );
    expect(b2Requested).toMatchObject({ cardCount: 1, chargedTodayAmount: 200 });
    const b1Low = await fleetFuelCardService.summary({ branchIds: [B1], balanceBelow: 300 }, NOW);
    // The cards: critical (50) and expiredCritical (20); the charges: every B1 card's.
    expect(b1Low).toMatchObject({ cardCount: 2, chargedTodayAmount: 107 });
  });

  it('`charged: false` answers the counts and never asks the charges', async () => {
    const out = await fleetFuelCardService.summary({}, NOW, { charged: false });
    expect(out.chargedTodayAmount).toBe(0);
    expect(out.cardCount).toBe(8);
  });
});

describe('nearestExpiry — «أقربها»', () => {
  it('the earliest expiry in the window, as a day', async () => {
    expect(await fleetFuelCardService.nearestExpiry(WINDOW)).toBe('2026-11-17');
  });

  it('follows the branch: B2’s cards expire in no window → null', async () => {
    expect(await fleetFuelCardService.nearestExpiry({ ...WINDOW, branchIds: [B1] })).toBe(
      '2026-11-17',
    );
    expect(await fleetFuelCardService.nearestExpiry({ ...WINDOW, branchIds: [B2] })).toBeNull();
  });
});

describe('attentionList — «كروت تحتاج متابعة»', () => {
  it('the company view: states, the most urgent first, then the code, the cards on no car last', async () => {
    const out = await fleetFuelCardService.attentionList({}, { ...RULES, limit: 8 });
    expect(out.total).toBe(7);
    expect(out.rows.map((row) => [row.cardId, row.states])).toEqual([
      [ID(38), ['expired', 'critical']], // 150
      [ID(32), ['expired']], // 151 (deleted)
      [ID(39), ['expired']], // no car
      [ID(31), ['critical']], // critical excludes low
      [ID(33), ['requested', 'low']],
      [ID(34), ['low', 'expiring']], // no car
      [ID(36), ['expiring']],
    ]);
  });

  it('names each card as it is now: the car, its make, a deleted car without a record, no car by its label', async () => {
    const { rows } = await fleetFuelCardService.attentionList({}, { ...RULES, limit: 8 });
    const byId = new Map(rows.map((row) => [row.cardId, row]));
    expect(byId.get(ID(38))).toMatchObject({
      vehicleId: CAR_A,
      code: '150',
      typeName: { ar: 'تويوتا', en: 'Toyota' },
      vehicleDeleted: false,
      label: null,
      balance: 20,
      expiresAt: '2026-11-11',
      company: 'wataniya',
      number: '7000123412340038',
    });
    expect(byId.get(ID(32))).toMatchObject({
      vehicleId: CAR_B,
      code: '151',
      vehicleDeleted: true,
      company: 'chillout',
    });
    expect(byId.get(ID(34))).toMatchObject({
      vehicleId: null,
      code: null,
      typeName: null,
      vehicleDeleted: false,
      label: 'سفر',
    });
    expect(byId.get(ID(33))).toMatchObject({ requestedAmount: 500, expiresAt: null });
  });

  it('at most `limit` rows; `total` still every flagged card', async () => {
    const out = await fleetFuelCardService.attentionList({}, { ...RULES, limit: 3 });
    expect(out.rows.map((row) => row.cardId)).toEqual([ID(38), ID(32), ID(39)]);
    expect(out.total).toBe(7);
  });

  it('a branch: its cars’ cards (a deleted car’s too), never a card on no car', async () => {
    const out = await fleetFuelCardService.attentionList(
      { branchIds: [B1] },
      { ...RULES, limit: 8 },
    );
    expect(out.rows.map((row) => row.cardId)).toEqual([ID(38), ID(32), ID(31), ID(36)]);
    expect(out.total).toBe(4);
  });

  it('only what flags a card counts; a set matching no card: no rows and 0', async () => {
    const out = await fleetFuelCardService.attentionList(
      { vehicleCodes: ['152'] },
      { ...RULES, yellowAt: 0, redAt: 0, limit: 8 },
    );
    // Its only card still has a request waiting.
    expect(out.rows.map((row) => row.states)).toEqual([['requested']]);
    const none = await fleetFuelCardService.attentionList(
      { branchIds: [B2], vehicleCodes: ['150'] },
      { ...RULES, limit: 8 },
    );
    expect(none).toEqual({ rows: [], total: 0 });
  });
});

describe('cardIdsOf — a branch’s cards, for the sheet', () => {
  it('every card on the branch’s cars — one deleted since too (its sheet lines are history)', async () => {
    expect((await fleetFuelCardService.cardIdsOf({ branchIds: [B1] })).sort()).toEqual(
      [ID(31), ID(32), ID(36), ID(37), ID(38)].sort(),
    );
    expect(await fleetFuelCardService.cardIdsOf({ branchIds: [B2] })).toEqual([ID(33)]);
  });
});
