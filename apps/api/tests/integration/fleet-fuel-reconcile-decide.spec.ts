// «مطابقة أرصدة الكروت» against a real mongo — deciding on a sheet's lines:
//
//   1. ✓ sets the balance to the sheet's with its own `sheetAdjust` line — not a charge; ✗ records
//      a `sheetReject` line of 0; each audited on the card; a line is decided once;
//   2. THE OWNER'S RULE: a card that moved after the read refuses ✓ for the whole request, nothing
//      written — a charge, a back-dated line, a +X/−X; read again and it goes through;
//   3. two decisions at once on one card: exactly one line;
//   4. the card log names who made each line and the sheet behind a sheet line, which is never
//      changed or removed.
//
// Reading the sheet (grants, the comparison, the upload's refusals) is in
// `fleet-fuel-reconcile.spec.ts`; both share `helpers/fuel-reconcile-world.ts`.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  type FleetFuelCardTotalsDto,
  type FleetFuelReconcileResultDto,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import {
  FleetFuelCardModel,
  FleetFuelCardMovementModel,
} from '../../src/modules/fleet/fuel-cards/fuel-card.model';
import {
  CARDS,
  auth,
  card,
  charge,
  data,
  decide,
  failure,
  log,
  mkCard,
  movementCount,
  read,
  rowOf,
  useFuelReconcileWorld,
  world,
} from './helpers/fuel-reconcile-world';

useFuelReconcileWorld('reconcile-decide');
const { tokens } = world;

describe('✓ and ✗', () => {
  it('✓ sets the sheet’s balance with a sheetAdjust line — not a charge; ✗ records a 0 line; each audited', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-A', 100, {
      requestedAmount: 30,
      lastChargedAt: new Date('2026-10-01'),
    });
    const c = await mkCard('wataniya', 'EGYCASH-C', 300);
    const summaryBefore = data<FleetFuelCardTotalsDto>(
      await request(world.app)
        .get(`${CARDS}/summary`)
        .set(...auth(tokens.clerk)),
    );
    const dto = await read('wataniya', [rowOf(a, 150.25), rowOf(c, 250)]);

    const applied = await decide(dto.id, 'apply', [String(a._id).toUpperCase()]);
    expect(applied.status, applied.text).toBe(200);
    expect(data<FleetFuelReconcileResultDto[]>(applied)).toEqual([
      expect.objectContaining({
        cardId: String(a._id),
        decision: 'apply',
        balance: 150.25,
        byName: 'سامح علي',
      }),
    ]);
    const after = await card(a._id);
    expect(after).toMatchObject({
      balance: 150.25,
      requestedAmount: 30,
      lastChargedAt: new Date('2026-10-01'),
    });
    const summaryAfter = data<FleetFuelCardTotalsDto>(
      await request(world.app)
        .get(`${CARDS}/summary`)
        .set(...auth(tokens.clerk)),
    );
    expect(summaryAfter.chargedTodayAmount).toBe(summaryBefore.chargedTodayAmount);

    const rejected = await decide(dto.id, 'reject', [String(c._id)]);
    expect(rejected.status, rejected.text).toBe(200);
    expect(data<FleetFuelReconcileResultDto[]>(rejected)[0]).toMatchObject({
      decision: 'reject',
      balance: 300,
    });
    expect((await card(c._id)).balance).toBe(300);

    const [adjust] = await log(a._id);
    expect(adjust).toMatchObject({
      kind: 'sheetAdjust',
      amount: 50.25,
      balanceAfter: 150.25,
      byName: 'سامح علي',
    });
    expect(adjust?.sheet).toEqual({
      reconciliationId: dto.id,
      fileName: 'أرصدة وطنية.xlsx',
      sheetBalance: 150.25,
      systemBalance: 100,
    });
    const [refusal] = await log(c._id);
    expect(refusal).toMatchObject({ kind: 'sheetReject', amount: 0, balanceAfter: 300 });

    const audit = async (id: Types.ObjectId) =>
      AuditLogModel.find({
        'entityRef.moduleId': 'fleet',
        'entityRef.entityType': 'fuelCard',
        'entityRef.entityId': String(id),
      })
        .lean()
        .exec();
    expect((await audit(a._id)).map((row) => [row.action, row.changes])).toEqual([
      [
        'correct',
        [
          { field: 'balance', old: '100', new: '150.25' },
          { field: 'reconciliation', old: null, new: dto.id },
        ],
      ],
    ]);
    expect((await audit(c._id)).map((row) => row.action)).toEqual(['reject']);

    // A line is decided once.
    const again = await decide(dto.id, 'reject', [String(a._id)]);
    expect(again.status).toBe(409);
    expect(failure(again)).toMatchObject({
      code: ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED,
      details: [{ field: 'cardIds', code: 'DECIDED', message: String(a._id) }],
    });
  });

  it('only a card the sheet differs on may be named; an unknown session is 404', async () => {
    const equal = await mkCard('wataniya', 'EGYCASH-EQ', 10);
    const other = await mkCard('chillout', 'EGYCASHTCS-1', 10);
    const twice = await mkCard('wataniya', 'EGYCASH-2X', 10);
    await mkCard('wataniya', 'EGYCASH-2X', 11);
    const dto = await read('wataniya', [rowOf(equal, 10), rowOf(twice, 50)]);
    for (const id of [equal._id, other._id, twice._id]) {
      const res = await decide(dto.id, 'apply', [String(id)]);
      expect(res.status).toBe(400);
      expect(failure(res).details).toEqual([
        { field: 'body.cardIds', code: 'NOT_IN_SHEET', message: String(id) },
      ]);
    }
    expect(
      (await decide(new Types.ObjectId().toString(), 'apply', [String(equal._id)])).status,
    ).toBe(404);
  });
});

describe('the owner’s rule: a card that moved after the read refuses ✓ — all or nothing', () => {
  it('a charge, a back-dated line, a +X/−X: nothing written, the moved cards named; read again and it goes through', async () => {
    const x = await mkCard('chillout', 'EGYCASHTCS-X', 100);
    const y = await mkCard('chillout', 'EGYCASHTCS-Y', 100);
    const z = await mkCard('chillout', 'EGYCASHTCS-Z', 100);
    const ids = [x, y, z].map((c) => String(c._id));
    const rows = [rowOf(x, 110), rowOf(y, 120), rowOf(z, 130)];

    let dto = await read('chillout', rows);
    await charge(y._id, 100);
    const movements = await movementCount();
    const refused = await decide(dto.id, 'apply', ids);
    expect(refused.status).toBe(409);
    expect(failure(refused)).toMatchObject({
      code: ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED,
      details: [{ field: 'cardIds', code: 'CARD_CHANGED', message: String(y._id) }],
    });
    expect([
      (await card(x._id)).balance,
      (await card(y._id)).balance,
      (await card(z._id)).balance,
    ]).toEqual([100, 200, 100]);
    expect(await movementCount()).toBe(movements);

    // A line dated in the past but WRITTEN after the read (a receipt carries its own day).
    dto = await read('chillout', [rowOf(x, 110), rowOf(y, 120), rowOf(z, 130)]);
    await FleetFuelCardMovementModel.create({
      cardId: z._id,
      kind: 'receipt',
      amount: 0,
      balanceAfter: 100,
      counterpartCardId: null,
      receiptId: new Types.ObjectId(),
      at: new Date('2020-01-01'),
    });
    expect(failure(await decide(dto.id, 'apply', ids)).details?.map((d) => d.message)).toEqual([
      String(z._id),
    ]);

    // +100 then the charge removed: the balance is back where it was, and it is still refused.
    dto = await read('chillout', [rowOf(x, 110), rowOf(y, 120), rowOf(z, 130)]);
    await charge(x._id, 100);
    const line = (await log(x._id)).find((m) => m.kind === 'charge');
    expect(
      (
        await request(world.app)
          .delete(`${CARDS}/movements/${line?.id ?? ''}`)
          .set(...auth(tokens.clerk))
      ).status,
    ).toBe(204);
    expect((await card(x._id)).balance).toBe(100);
    expect(failure(await decide(dto.id, 'apply', [String(x._id)])).code).toBe(
      ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED,
    );

    // ✗ is not refused by a move — it changes no balance and records the card as it is.
    const rejected = await decide(dto.id, 'reject', [String(x._id)]);
    expect(data<FleetFuelReconcileResultDto[]>(rejected)[0]).toMatchObject({ balance: 100 });

    // Read again: the same ✓ goes through.
    dto = await read('chillout', rows);
    const applied = await decide(dto.id, 'apply', ids);
    expect(applied.status, applied.text).toBe(200);
    expect([
      (await card(x._id)).balance,
      (await card(y._id)).balance,
      (await card(z._id)).balance,
    ]).toEqual([110, 120, 130]);
  });

  it('a card deleted after the read refuses ✓ and ✗ alike', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-DEL', 0);
    const dto = await read('wataniya', [rowOf(a, 20)]);
    await FleetFuelCardModel.updateOne({ _id: a._id }, { isDeleted: true }).exec();
    for (const decision of ['apply', 'reject'] as const) {
      expect(failure(await decide(dto.id, decision, [String(a._id)])).code).toBe(
        ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED,
      );
    }
    expect(await movementCount()).toBe(0);
  });

  it('two ✓ at once on one card: one goes through, one line is written', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-RACE', 10);
    const dto = await read('wataniya', [rowOf(a, 99)]);
    const settled = await Promise.allSettled([
      decide(dto.id, 'apply', [String(a._id)]),
      decide(dto.id, 'apply', [String(a._id)]),
    ]);
    const statuses = settled.map((s) => (s.status === 'fulfilled' ? s.value.status : 0)).sort();
    expect(statuses).toEqual([200, 409]);
    expect(
      await FleetFuelCardMovementModel.countDocuments({
        cardId: a._id,
        kind: 'sheetAdjust',
      }).exec(),
    ).toBe(1);
    expect((await card(a._id)).balance).toBe(99);
  });
});

describe('the card log', () => {
  it('names who made each line; a sheet line is never changed or removed', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-LOG', 0);
    await charge(a._id, 40);
    // A line from before «بواسطة» existed — no writer on file.
    await FleetFuelCardMovementModel.create({
      cardId: a._id,
      kind: 'charge',
      amount: 0,
      balanceAfter: 40,
      counterpartCardId: null,
      receiptId: null,
      at: new Date('2020-01-01'),
    });
    const dto = await read('wataniya', [rowOf(a, 45)]);
    await decide(dto.id, 'apply', [String(a._id)]);
    const lines = await log(a._id);
    expect(lines.map((m) => [m.kind, m.byName, m.sheet === null])).toEqual([
      ['sheetAdjust', 'سامح علي', false],
      ['charge', 'سامح علي', true],
      ['charge', null, true],
    ]);
    // No default: an ordinary line is written without the field at all (nothing to backfill).
    const raw = await FleetFuelCardMovementModel.collection
      .find({ cardId: a._id }, { sort: { at: -1 } })
      .toArray();
    expect(raw.map((doc) => 'reconciliation' in doc)).toEqual([true, false, false]);
    const sheetLine = lines[0]?.id ?? '';
    const patched = await request(world.app)
      .patch(`${CARDS}/movements/${sheetLine}`)
      .set(...auth(tokens.clerk))
      .send({ amount: 1 });
    expect([patched.status, failure(patched).details?.[0]?.message]).toEqual([
      400,
      'a sheet line is not changed here',
    ]);
    expect(
      (
        await request(world.app)
          .delete(`${CARDS}/movements/${sheetLine}`)
          .set(...auth(tokens.clerk))
      ).status,
    ).toBe(400);
    expect((await card(a._id)).balance).toBe(45);
  });
});
