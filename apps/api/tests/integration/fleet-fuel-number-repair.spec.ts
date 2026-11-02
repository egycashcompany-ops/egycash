// «تصحيح أرقام الكروت» (6d) against a real mongo — the go-live's 15 crossed Wataniya numbers in
// three cycles and the 0849 pair:
//
//   1. the dry run: three ready cycles and a ready pair, masked numbers only, no Chill Out card;
//   2. execute: every number with its PIN (as stored), photo and expiry; names, cars and balances
//      kept; the pair's names and openings swapped; 17 `dataFix` lines, 17 audit rows;
//   3. no PIN in any answer, line, audit row or log call;
//   4–7. a record changed by hand holds its unit only, re-checked at execution; a re-run is a no-op;
//      a cycle fixed by hand reads done;
//   8–9. an error rolls back its unit only; two executes at once apply each unit once;
//   10–11. Chill Out cards, other Wataniya cards and the «S» names are never touched;
//   12. the grants; 13. the 0849 lock of «مطابقة أرصدة الكروت» lifts with the repair;
//   14. the route is not read as a card id; 15. a `dataFix` line is never changed or removed.
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  ErrorCodes,
  type FleetFuelCardDto,
  type FleetFuelCardMovementDto,
  type FleetFuelNumberRepairDto,
  type FleetFuelNumberRepairResultDto,
  type FleetFuelReconcileDto,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { logger } from '../../src/infrastructure/logging/logger';
import {
  FleetFuelCardModel,
  FleetFuelCardMovementModel,
  type FleetFuelCardDoc,
  type FleetFuelCardMovementDoc,
} from '../../src/modules/fleet/fuel-cards/fuel-card.model';
import { fleetFuelCardMovementRepository } from '../../src/modules/fleet/fuel-cards/fuel-card.repository';
import {
  REPAIR_PAIR,
  REPAIR_RECORDS,
} from '../../src/modules/fleet/fuel-cards/number-repair/number-repair-definition';
import { buildFuelSheet, type FuelSheetCell } from './helpers/fuel-sheet-workbook';
import {
  ALL_PINS,
  CARDS,
  NEIGHBOURS,
  REPAIR,
  auth,
  cardByNumber,
  cardOnCar,
  data,
  failure,
  photoIdOf,
  pinOf,
  useNumberRepairWorld,
  world,
} from './helpers/fuel-number-repair-world';

useNumberRepairWorld('number-repair');
const { tokens } = world;

const dryRun = async (token = tokens.viewer): Promise<FleetFuelNumberRepairDto> => {
  const res = await request(world.app)
    .get(REPAIR)
    .set(...auth(token));
  expect(res.status, res.text).toBe(200);
  return data<FleetFuelNumberRepairDto>(res);
};
const execute = (units: string[], token = tokens.executor, body: Record<string, unknown> = {}) =>
  request(world.app)
    .post(`${REPAIR}/execute`)
    .set(...auth(token))
    .send({ reviewed: true, units, ...body });
const executeOk = async (units: string[]): Promise<FleetFuelNumberRepairResultDto> => {
  const res = await execute(units);
  expect(res.status, res.text).toBe(200);
  return data<FleetFuelNumberRepairResultDto>(res);
};
const ALL = ['C4', 'C5', 'C6', 'pair'];
const dataFixLines = () =>
  FleetFuelCardMovementModel.find({ kind: 'dataFix' }).lean<FleetFuelCardMovementDoc[]>().exec();
const allCards = () =>
  FleetFuelCardModel.find({}).sort({ number: 1 }).lean<FleetFuelCardDoc[]>().exec();
/** A card as stored, but for the time it was last touched. */
const strip = (doc: FleetFuelCardDoc): unknown =>
  JSON.parse(JSON.stringify({ ...doc, updatedAt: null })) as unknown;
const unitCars = (unit: string) => REPAIR_RECORDS.filter((r) => r.unit === unit).map((r) => r.car);
const patchCard = async (car: string, body: Record<string, unknown>) => {
  const card = await cardOnCar(car);
  const res = await request(world.app)
    .patch(`${CARDS}/${String(card._id)}`)
    .set(...auth(tokens.boss))
    .send({ ...body, version: card.__v });
  expect(res.status, res.text).toBe(200);
};
const leaks = (text: string): string[] => ALL_PINS.filter((pin) => text.includes(pin));
const record = (car: string) =>
  REPAIR_RECORDS.find((r) => r.car === car) as (typeof REPAIR_RECORDS)[number];
/** Every full card number of the world — the dry run shows last fours only. */
const FULL_NUMBERS = [
  ...REPAIR_RECORDS.map((r) => r.before.number),
  ...REPAIR_PAIR.map((p) => p.number),
  ...Object.values(NEIGHBOURS),
];

describe('1 · the dry run', () => {
  it('three ready cycles and a ready pair — masked numbers only, no Chill Out card', async () => {
    const dto = await dryRun();
    expect([dto.state, dto.company, dto.key]).toEqual(['pending', 'wataniya', '6d:2026-10-04']);
    expect(dto.counts).toEqual({ records: 17, crossed: 15, pair: 2, ready: 17, held: 0, done: 0 });
    expect(dto.readyUnits).toEqual(ALL);
    expect(dto.cycles.map((c) => [c.unit, c.n, c.state, c.cars])).toEqual([
      ['C4', 1, 'ready', ['239', '241', '243', '209']],
      ['C5', 2, 'ready', ['233', '525', '284', '269', '230']],
      ['C6', 3, 'ready', ['232', '800', '256', '267', '251', '246']],
    ]);
    expect(dto.pair.state).toBe('ready');
    expect(dto.noPinAfterCars).toEqual(['284', '269', '230', '256', '251']);
    const c4 = dto.cycles[0];
    expect(c4?.heldLast4).toEqual(['2813', '3375', '4116', '0935']);
    expect(c4?.rows[0]).toMatchObject({
      car: '239',
      name: 'EGYCASH-4643-4209073',
      state: 'ok',
      numberPrefix: '548',
      numberBeforeLast4: '2813',
      numberAfterLast4: '0935',
      afterIsNowOnCar: '209',
      beforeGoesToCar: '241',
      chassisTypo: true,
      balance: 3049.73,
      topUpsMore: 0,
      changes: [],
      log: null,
    });
    expect(c4?.rows[0]?.topUps.map((t) => t.amount)).toEqual([500, 750]);
    // The photo of the right number is on the record of car 209 today.
    const car209 = await cardOnCar('209');
    expect(c4?.rows[0]?.photoAfter).toMatchObject({
      cardId: String(car209._id),
      thumb: true,
      stickerCar: '239',
      last4: '0935',
    });
    expect(dto.pair.rows.map((r) => [r.car, r.nameAfter, r.delta, r.balanceAfter])).toEqual([
      ['530', 'EGYCASH-1137-401485', -11_872.62, 1258],
      ['283', 'EGYCASH-8616-783211', 11_872.62, 13_130.62],
    ]);
    expect(dto.pair.rows[1]).toMatchObject({ statementOpening: 11_430.62, numberLast4: '0849' });
    expect(dto.pair.sheetAdjustments).toEqual([]);

    const json = JSON.stringify(dto);
    expect(FULL_NUMBERS.filter((number) => json.includes(number))).toEqual([]);
    expect(json).not.toMatch(/EGYCASHTCS|S778864|S783211/u);
    expect(leaks(json)).toEqual([]);
  });
});

describe('2–3 · execute, and no PIN anywhere', () => {
  it('moves number, PIN, photo and expiry together; keeps name, car, balance; swaps the pair', async () => {
    const before = new Map((await allCards()).map((c) => [c.number, c]));
    const spies = (['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const).map((level) =>
      vi.spyOn(logger, level),
    );
    const result = await executeOk(ALL);
    const logged = spies.flatMap((spy) => spy.mock.calls);
    spies.forEach((spy) => spy.mockRestore());
    expect([result.executed, result.alreadyDone, result.held, result.notRequested]).toEqual([
      ALL,
      [],
      [],
      [],
    ]);
    expect(result.repair.state).toBe('done');
    expect(result.repair.counts.done).toBe(17);

    for (const record of REPAIR_RECORDS) {
      const card = await cardOnCar(record.car);
      const held = before.get(record.after.number) as FleetFuelCardDoc;
      const was = before.get(record.before.number) as FleetFuelCardDoc;
      expect(card.number, record.car).toBe(record.after.number);
      // The PIN that was stored with that number — or none (the five).
      expect(card.password, record.car).toBe(held.password);
      expect(card.password ?? null, record.car).toBe(
        record.after.hasPin ? pinOf(record.after.number) : null,
      );
      expect(String(card.image?.fileId), record.car).toBe(
        String(photoIdOf.get(record.after.number)),
      );
      expect(card.image?.fileName).toBe(`${record.after.number}.jpg`);
      expect(card.expiresAt?.toISOString().slice(0, 10)).toBe(record.after.expiresAt);
      // Kept: the record's own name, car, balance, id.
      expect([card.name, String(card.vehicleId), card.balance, String(card._id)]).toEqual([
        record.name,
        String(was.vehicleId),
        was.balance,
        String(was._id),
      ]);
    }
    for (const pair of REPAIR_PAIR) {
      const card = await cardOnCar(pair.car);
      const was = before.get(pair.number) as FleetFuelCardDoc;
      expect([card.number, card.name, card.password, card.balance]).toEqual([
        pair.number,
        pair.nameAfter,
        was.password,
        Math.round((was.balance + pair.delta) * 100) / 100,
      ]);
    }
    expect(await FleetFuelCardModel.countDocuments({ number: /^6d-tmp-/u })).toBe(0);

    const lines = await dataFixLines();
    expect(lines).toHaveLength(17);
    const line239 = lines.find((l) => l.repair?.numberAfter === record('239').after.number);
    expect(line239?.repair).toMatchObject({
      key: '6d:2026-10-04',
      unit: 'C4',
      kind: 'number',
      numberBefore: record('239').before.number,
      pinMoved: true,
      photoMoved: true,
    });
    expect(line239?.amount).toBe(0);
    const line284 = lines.find((l) => l.repair?.numberAfter === record('284').after.number);
    expect(line284?.repair?.pinMoved).toBe(false);
    const pairLines = lines.filter((l) => l.repair?.unit === 'pair');
    expect(pairLines.map((l) => [l.amount, l.repair?.kind])).toEqual(
      expect.arrayContaining([
        [-11_872.62, 'nameSwap'],
        [11_872.62, 'nameSwap'],
      ]),
    );

    // The card log shows it — last fours only.
    const car239 = await cardOnCar('239');
    const log = await request(world.app)
      .get(`${CARDS}/movements`)
      .query({ cardId: String(car239._id) })
      .set(...auth(tokens.viewer));
    const repairLine = data<FleetFuelCardMovementDto[]>(log).find((l) => l.kind === 'dataFix');
    expect(repairLine?.repair).toEqual({
      key: '6d:2026-10-04',
      unit: 'C4',
      kind: 'number',
      numberBeforeLast4: '2813',
      numberAfterLast4: '0935',
      pinMoved: true,
      photoMoved: true,
      expiryBefore: '2027-03-31',
      expiryAfter: '2027-03-31',
      nameBefore: null,
      nameAfter: null,
      openingBefore: null,
      openingAfter: null,
    });

    const audits = await AuditLogModel.find({
      'entityRef.entityType': 'fuelCard',
      'changes.field': 'dataFix',
    })
      .lean()
      .exec();
    expect(audits).toHaveLength(17);
    expect(new Set(audits.map((a) => a.action))).toEqual(new Set(['correct']));

    // 3 — no PIN in any answer, line, audit row, card DTO or log call.
    const texts: string[] = [JSON.stringify(result), JSON.stringify(lines), JSON.stringify(audits)];
    for (const card of await allCards()) {
      const dto = await request(world.app)
        .get(`${CARDS}/${String(card._id)}`)
        .set(...auth(tokens.viewer));
      texts.push(JSON.stringify(data<FleetFuelCardDto>(dto)));
      const movements = await request(world.app)
        .get(`${CARDS}/movements`)
        .query({ cardId: String(card._id) })
        .set(...auth(tokens.viewer));
      texts.push(movements.text);
    }
    texts.push(JSON.stringify(logged));
    expect(texts.flatMap(leaks)).toEqual([]);
  });
});

describe('4–7 · a changed record, re-checked; idempotent; fixed by hand', () => {
  it('4 · an expiry edited on 269 holds C5 only; restored, C5 runs alone', async () => {
    await patchCard('269', { expiresAt: '2028-02-29' });
    const dto = await dryRun();
    const c5 = dto.cycles[1];
    expect(dto.cycles.map((c) => c.state)).toEqual(['ready', 'held', 'ready']);
    expect(dto.readyUnits).toEqual(['C4', 'C6', 'pair']);
    expect(dto.counts).toMatchObject({ ready: 12, held: 5, done: 0 });
    expect(c5?.rows.map((r) => r.state)).toEqual(['held', 'held', 'held', 'changed', 'held']);
    expect(c5?.rows[3]?.changes).toEqual([
      {
        field: 'expiry',
        expected: record('269').before.expiresAt,
        now: '2028-02-29',
        at: expect.any(String),
        byName: 'منى حسن',
      },
    ]);
    expect(dto.noPinAfterCars).toEqual(['256', '251']);

    const c5Before = await Promise.all(unitCars('C5').map((car) => cardOnCar(car)));
    const result = await executeOk(ALL);
    expect([result.executed, result.held]).toEqual([['C4', 'C6', 'pair'], ['C5']]);
    const c5After = await Promise.all(unitCars('C5').map((car) => cardOnCar(car)));
    expect(c5After.map(strip)).toEqual(c5Before.map(strip));
    expect(result.repair.state).toBe('partial');

    await patchCard('269', { expiresAt: record('269').before.expiresAt });
    expect((await dryRun()).readyUnits).toEqual(['C5']);
    const rest = await executeOk(['C5']);
    expect([rest.executed, rest.repair.state]).toEqual([['C5'], 'done']);
    expect((await cardOnCar('269')).number).toBe(record('269').after.number);
  });

  it('5 · a record changed after the review is held at execution', async () => {
    expect((await dryRun()).readyUnits).toEqual(ALL);
    await patchCard('800', { name: 'EGYCASH-CHANGED-BY-HAND' });
    const result = await executeOk(ALL);
    expect([result.executed, result.held]).toEqual([['C4', 'C5', 'pair'], ['C6']]);
    expect((await cardOnCar('232')).number).toBe(record('232').before.number);
  });

  it('6 · a second execute writes nothing', async () => {
    await executeOk(ALL);
    const cards = (await allCards()).map(strip);
    const lines = await FleetFuelCardMovementModel.countDocuments({});
    const audits = await AuditLogModel.countDocuments({});
    const again = await executeOk(ALL);
    expect([again.executed, again.alreadyDone]).toEqual([[], ALL]);
    expect((await allCards()).map(strip)).toEqual(cards);
    expect(await FleetFuelCardMovementModel.countDocuments({})).toBe(lines);
    expect(await AuditLogModel.countDocuments({})).toBe(audits);
  });

  it('7 · a cycle fixed by hand reads done; execute writes nothing for it', async () => {
    // C4 swapped to the «after» state directly, number, PIN, photo and expiry together.
    const c4 = REPAIR_RECORDS.filter((r) => r.unit === 'C4');
    const docs = new Map(
      await Promise.all(c4.map(async (r) => [r.car, await cardOnCar(r.car)] as const)),
    );
    for (const r of c4) {
      await FleetFuelCardModel.updateOne(
        { _id: docs.get(r.car)?._id },
        { $set: { number: `tmp-${r.car}` } },
      ).exec();
    }
    for (const r of c4) {
      const donor = [...docs.values()].find((d) => d.number === r.after.number) as FleetFuelCardDoc;
      await FleetFuelCardModel.updateOne(
        { _id: docs.get(r.car)?._id },
        {
          $set: {
            number: r.after.number,
            password: donor.password,
            image: donor.image,
            expiresAt: donor.expiresAt,
          },
        },
      ).exec();
    }
    const dto = await dryRun();
    expect(dto.cycles[0]?.state).toBe('done');
    expect(dto.readyUnits).toEqual(['C5', 'C6', 'pair']);
    const result = await executeOk(ALL);
    expect([result.executed, result.alreadyDone]).toEqual([['C5', 'C6', 'pair'], ['C4']]);
    const lines = await dataFixLines();
    expect(lines.filter((l) => l.repair?.unit === 'C4')).toEqual([]);
    expect(lines).toHaveLength(13);
  });
});

describe('8–9 · rollback, and two executes at once', () => {
  it('8 · an error inside C5 rolls back C5 only; C4 stays; a re-run completes', async () => {
    const before = new Map((await allCards()).map((c) => [String(c._id), strip(c)]));
    const create = fleetFuelCardMovementRepository.create.bind(fleetFuelCardMovementRepository);
    let calls = 0;
    const spy = vi
      .spyOn(fleetFuelCardMovementRepository, 'create')
      .mockImplementation(async (...args) => {
        calls += 1;
        // C4 writes four lines; the third line of C5 fails.
        if (calls === 4 + 3) throw new Error('disk on fire');
        return create(...args);
      });
    const failed = await execute(ALL);
    spy.mockRestore();
    expect([failed.status, failure(failed).code]).toEqual([500, ErrorCodes.INTERNAL]);
    expect(failed.text).not.toContain('disk on fire');
    for (const car of unitCars('C4')) {
      expect((await cardOnCar(car)).number).toBe(record(car).after.number);
    }
    for (const car of [...unitCars('C5'), ...unitCars('C6'), '530', '283']) {
      const card = await cardOnCar(car);
      expect(strip(card), car).toEqual(before.get(String(card._id)));
    }
    expect((await dataFixLines()).map((l) => l.repair?.unit)).toEqual(['C4', 'C4', 'C4', 'C4']);
    const rerun = await executeOk(ALL);
    expect([rerun.executed, rerun.alreadyDone, rerun.repair.state]).toEqual([
      ['C5', 'C6', 'pair'],
      ['C4'],
      'done',
    ]);
  });

  it('9 · two executes at once apply each unit once', async () => {
    const [a, b] = await Promise.all([execute(ALL), execute(ALL)]);
    expect([a.status, b.status], `${a.text} ${b.text}`).toEqual([200, 200]);
    const ra = data<FleetFuelNumberRepairResultDto>(a);
    const rb = data<FleetFuelNumberRepairResultDto>(b);
    expect([...ra.executed, ...rb.executed].sort()).toEqual([...ALL].sort());
    expect([...ra.alreadyDone, ...rb.alreadyDone].sort()).toEqual([...ALL].sort());
    expect(await dataFixLines()).toHaveLength(17);
    for (const r of REPAIR_RECORDS) {
      expect((await cardOnCar(r.car)).number).toBe(r.after.number);
    }
    expect((await cardOnCar('530')).balance).toBe(1258);
  });
});

describe('10–11 · company scoping, exact names', () => {
  it('10 · Chill Out cards and every other Wataniya card are untouched', async () => {
    const strangers = async () =>
      Promise.all(
        Object.values(NEIGHBOURS).map(async (number) => strip(await cardByNumber(number))),
      );
    const before = await strangers();
    await executeOk(ALL);
    expect(await strangers()).toEqual(before);
    expect((await cardOnCar('232', 'chillout')).number).toBe(NEIGHBOURS.chill232);
  });

  it('11 · a name with an «S» is another name — the cycle is held; the travel cards untouched', async () => {
    await patchCard('284', { name: 'EGYCASH-8618-S778864' });
    const dto = await dryRun();
    expect(dto.cycles[1]?.state).toBe('held');
    expect(dto.cycles[1]?.rows[2]?.changes.map((c) => [c.field, c.now])).toEqual([
      ['name', 'EGYCASH-8618-S778864'],
    ]);
    const travel = strip(await cardByNumber(NEIGHBOURS.travelS778864));
    const result = await executeOk(ALL);
    expect(result.held).toEqual(['C5']);
    expect(strip(await cardByNumber(NEIGHBOURS.travelS778864))).toEqual(travel);
  });
});

describe('12 · the grants', () => {
  it('reads with the cards’ view grant; executes with edit AND approve only', async () => {
    const get = await request(world.app)
      .get(REPAIR)
      .set(...auth(tokens.stranger));
    expect(get.status).toBe(403);
    for (const token of [tokens.viewer, tokens.editor, tokens.approver]) {
      expect((await execute(ALL, token)).status).toBe(403);
    }
    expect(await dataFixLines()).toEqual([]);
    for (const body of [
      { reviewed: false, units: ALL },
      { units: ALL },
      { reviewed: true, units: ['C4', 'C4'] },
      { reviewed: true, units: [] },
    ]) {
      const res = await request(world.app)
        .post(`${REPAIR}/execute`)
        .set(...auth(tokens.executor))
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const one = await executeOk(['C6']);
    expect([one.executed, one.notRequested]).toEqual([['C6'], ['C4', 'C5', 'pair']]);
    expect((await cardOnCar('239')).number).toBe(record('239').before.number);
  });
});

describe('13 · the 0849 lock of «مطابقة أرصدة الكروت» lifts with the repair', () => {
  const HEADER: FuelSheetCell[] = ['Card Number', 'Card Name', 'Card Balance', 'كود'];
  const readSheet = async (rows: FuelSheetCell[][]): Promise<FleetFuelReconcileDto> => {
    const file = await buildFuelSheet({ rows: [HEADER, ...rows] });
    const res = await request(world.app)
      .post(`${CARDS}/reconcile`)
      .set(...auth(tokens.boss))
      .field('company', 'wataniya')
      .attach('file', file, 'وطنية.xlsx');
    expect(res.status, res.text).toBe(200);
    return data<FleetFuelReconcileDto>(res);
  };
  const decide = (id: string, decision: 'apply' | 'reject', cardIds: string[]) =>
    request(world.app)
      .post(`${CARDS}/reconcile/${id}/decisions`)
      .set(...auth(tokens.boss))
      .send({ decision, cardIds });
  const lineOf = (dto: FleetFuelReconcileDto, cardId: string) =>
    [...dto.differs, ...dto.equal].find((line) => line.card.id === cardId);

  it('before: links and ✓ held; after: a new sheet decides them; the old one stays held', async () => {
    const c530 = await cardOnCar('530');
    const c283 = await cardOnCar('283');
    // The statement by the names embossed on the cards — each name sits on the other record now.
    const rows: FuelSheetCell[][] = [
      ['548**********0849', 'EGYCASH-1137-401485', 1400, '530'],
      ['548**********0849', 'EGYCASH-8616-783211', 11_430.62, '283'],
    ];
    const old = await readSheet(rows);
    expect(lineOf(old, String(c283._id))?.inRepair).toBe(true);
    expect(lineOf(old, String(c530._id))?.inRepair).toBe(true);
    expect(old.links.map((l) => l.inRepair)).toEqual([true, true]);
    const movements = await FleetFuelCardMovementModel.countDocuments({});
    const held = await decide(old.id, 'apply', [String(c283._id)]);
    expect([held.status, failure(held).code, failure(held).details]).toEqual([
      409,
      ErrorCodes.FLEET_FUEL_RECONCILE_IN_REPAIR,
      [{ field: 'cardIds', code: 'IN_REPAIR', message: String(c283._id) }],
    ]);
    expect(await FleetFuelCardMovementModel.countDocuments({})).toBe(movements);
    expect((await decide(old.id, 'reject', [String(c530._id)])).status).toBe(200);

    expect((await executeOk(['pair'])).executed).toEqual(['pair']);

    const fresh = await readSheet([
      ['548**********0849', 'EGYCASH-1137-401485', 1400, '530'],
      ['548**********0849', 'EGYCASH-8616-783211', 11_430.62, 'R6D-NOWHERE'],
    ]);
    expect(lineOf(fresh, String(c530._id))?.inRepair).toBe(false);
    expect(lineOf(fresh, String(c283._id))?.inRepair).toBe(false);
    const applied = await decide(fresh.id, 'apply', [String(c530._id), String(c283._id)]);
    expect(applied.status, applied.text).toBe(200);
    expect([(await cardOnCar('530')).balance, (await cardOnCar('283')).balance]).toEqual([
      1400, 11_430.62,
    ]);
    // The old session's ✓ stays refused — its name match was the other card's.
    const stale = await decide(old.id, 'apply', [String(c283._id)]);
    expect([stale.status, failure(stale).code]).toEqual([
      409,
      ErrorCodes.FLEET_FUEL_RECONCILE_IN_REPAIR,
    ]);
  });
});

describe('14–15 · the route, and the line', () => {
  it('14 · GET /fleet/fuel-cards/number-repair is the dry run, not a card id', async () => {
    const res = await request(world.app)
      .get(REPAIR)
      .set(...auth(tokens.viewer));
    expect([res.status, res.headers['cache-control']]).toEqual([200, 'private, no-store']);
  });

  it('15 · a dataFix line is never changed or removed', async () => {
    await executeOk(['C4']);
    const [line] = await dataFixLines();
    const id = String(line?._id);
    const patch = await request(world.app)
      .patch(`${CARDS}/movements/${id}`)
      .set(...auth(tokens.boss))
      .send({ amount: 10 });
    const remove = await request(world.app)
      .delete(`${CARDS}/movements/${id}`)
      .set(...auth(tokens.boss));
    expect([patch.status, remove.status]).toEqual([400, 400]);
    const after = await FleetFuelCardMovementModel.findById(id).lean<FleetFuelCardMovementDoc>();
    expect([after?.amount, after?.isDeleted]).toEqual([0, false]);
  });
});
