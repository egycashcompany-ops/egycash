// «تبقى موجودة بس سجل للكرت وبس» against a real mongo — a top-up the company's sheet reverses:
//
//   1. the ✓ with the charge ticked: the balance is the sheet's, the charge stays in the log only
//      («أُلغي بشيت الشركة»), the row is no longer green, «شُحن اليوم» no longer counts it, and the
//      line can no longer be changed or removed;
//   2. an old body (no `cancelCharges`) decides exactly as before;
//   3. every refusal writes nothing — a charge that is not a stored candidate, one already
//      cancelled, more than the sheet takes off (to the piastre);
//   4. «اعتماد طلب الرصيد» — the sheet higher by exactly the pending request approves it, instead of
//      an adjustment; a request that is not the difference any more is refused;
//   5. «تاريخ الشيت» — a charge dated after it is listed apart (`afterSheetDate`).
//
// Shares `helpers/fuel-reconcile-world.ts` with the read and decide specs.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  ErrorCodes,
  type FleetFuelCardTotalsDto,
  type FleetFuelReconcileResultDto,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { FleetFuelCardMovementModel } from '../../src/modules/fleet/fuel-cards/fuel-card.model';
import { FleetFuelReconciliationModel } from '../../src/modules/fleet/fuel-cards/reconcile/fuel-reconcile.model';
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
  readSheet,
  rowOf,
  useFuelReconcileWorld,
  world,
} from './helpers/fuel-reconcile-world';
import { FUEL_SHEET_HEADER, buildFuelSheet } from './helpers/fuel-sheet-workbook';

useFuelReconcileWorld('reconcile-cancel');
const { tokens } = world;

const chargedToday = async (): Promise<number> =>
  data<FleetFuelCardTotalsDto>(
    await request(world.app)
      .get(`${CARDS}/summary`)
      .set(...auth(tokens.clerk)),
  ).chargedTodayAmount;

/** A charge line written directly, `daysAgo` before now — an older top-up. */
const olderCharge = async (cardId: Types.ObjectId, amount: number, daysAgo: number) =>
  FleetFuelCardMovementModel.create({
    cardId,
    kind: 'charge',
    amount,
    balanceAfter: 0,
    counterpartCardId: null,
    receiptId: null,
    at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  });

describe('a top-up the sheet does not show — cancelled by the ✓', () => {
  it('5,000 + 1,000 → sheet 5,000 → ✓ with the charge ticked: 5,000, not green, not counted, locked', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-CANCEL', 5000);
    await charge(a._id, 1000);
    expect((await card(a._id)).lastChargedAt).not.toBeNull();
    expect(await chargedToday()).toBe(1000);

    const dto = await read('wataniya', [rowOf(a, 5000)]);
    const [line] = dto.differs;
    expect(line?.difference).toBe(-1000);
    expect(line?.charges).toEqual([
      expect.objectContaining({ amount: 1000, byName: 'سامح علي', afterSheetDate: false }),
    ]);
    const chargeId = line?.charges[0]?.id ?? '';

    const applied = await decide(dto.id, 'apply', [String(a._id)], tokens.clerk, {
      cancelCharges: [chargeId],
    });
    expect(applied.status, applied.text).toBe(200);
    expect(data<FleetFuelReconcileResultDto[]>(applied)).toEqual([
      expect.objectContaining({ balance: 5000, cancelledAmount: 1000, approvedRequest: null }),
    ]);
    const after = await card(a._id);
    expect(after.balance).toBe(5000);
    // The only charge is cancelled: nothing is «charged today» on the card any more.
    expect(after.lastChargedAt).toBeNull();
    expect(await chargedToday()).toBe(0);

    const lines = await log(a._id);
    expect(lines.map((m) => m.kind)).toEqual(['sheetAdjust', 'charge']);
    expect(lines[0]?.sheet?.cancelledCharges).toEqual([{ id: chargeId, amount: 1000 }]);
    expect(lines[1]).toMatchObject({
      id: chargeId,
      amount: 1000,
      cancelledBySheet: {
        reconciliationId: dto.id,
        fileName: 'أرصدة وطنية.xlsx',
        byName: 'سامح علي',
      },
    });

    // A cancelled charge is never changed or removed here — that would take the money twice.
    const patched = await request(world.app)
      .patch(`${CARDS}/movements/${chargeId}`)
      .set(...auth(tokens.clerk))
      .send({ amount: 1 });
    expect([patched.status, failure(patched).details?.[0]?.message]).toEqual([
      400,
      'a charge cancelled by a company sheet is not changed here',
    ]);
    const removed = await request(world.app)
      .delete(`${CARDS}/movements/${chargeId}`)
      .set(...auth(tokens.clerk));
    expect(removed.status).toBe(400);
    expect((await card(a._id)).balance).toBe(5000);

    const audit = await AuditLogModel.findOne({
      'entityRef.entityType': 'fuelCard',
      'entityRef.entityId': String(a._id),
      action: 'correct',
    })
      .lean()
      .exec();
    expect(audit?.changes).toContainEqual({ field: 'cancelledCharges', old: null, new: chargeId });
  });

  it('the green row follows the charges that are left — an older one stays', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-OLDER', 2000);
    const older = await olderCharge(a._id, 300, 3);
    await charge(a._id, 500);
    const dto = await read('wataniya', [rowOf(a, 2000)]);
    const ids = dto.differs[0]?.charges.map((c) => c.amount);
    expect(ids).toEqual([500, 300]); // newest first
    const newest = dto.differs[0]?.charges[0]?.id ?? '';
    const applied = await decide(dto.id, 'apply', [String(a._id)], tokens.clerk, {
      cancelCharges: [newest],
    });
    expect(applied.status, applied.text).toBe(200);
    expect((await card(a._id)).lastChargedAt?.toISOString()).toBe(older.at.toISOString());
  });

  it('an old body — no cancelCharges — decides exactly as before', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-PLAIN', 5000);
    await charge(a._id, 1000);
    const lastCharged = (await card(a._id)).lastChargedAt;
    const dto = await read('wataniya', [rowOf(a, 5000)]);
    const applied = await decide(dto.id, 'apply', [String(a._id)]);
    expect(applied.status, applied.text).toBe(200);
    expect(data<FleetFuelReconcileResultDto[]>(applied)[0]).toMatchObject({
      cancelledAmount: 0,
      approvedRequest: null,
    });
    expect((await card(a._id)).lastChargedAt).toEqual(lastCharged);
    expect(await chargedToday()).toBe(1000);
    const [adjust, kept] = await log(a._id);
    expect(adjust?.sheet?.cancelledCharges).toEqual([]);
    expect(kept?.cancelledBySheet).toBeNull();
    // No field written on a line that cancelled nothing.
    const raw = await FleetFuelCardMovementModel.collection.findOne({ kind: 'sheetAdjust' });
    expect(raw !== null && 'cancelled' in (raw.reconciliation as object)).toBe(false);
  });

  it('candidates: only a sheet LOWER than the card, live charges after its last sheet decision, never a transfer', async () => {
    const lower = await mkCard('wataniya', 'EGYCASH-LOW', 1000);
    const higher = await mkCard('wataniya', 'EGYCASH-HIGH', 1000);
    await charge(lower._id, 100);
    await charge(higher._id, 100);
    // A transfer into the card is no top-up.
    await FleetFuelCardMovementModel.create({
      cardId: lower._id,
      kind: 'transferIn',
      amount: 50,
      balanceAfter: 1150,
      counterpartCardId: higher._id,
      receiptId: null,
      at: new Date(),
    });
    let dto = await read('wataniya', [rowOf(lower, 900), rowOf(higher, 1300)]);
    const byCard = new Map(dto.differs.map((l) => [l.card.id, l.charges]));
    expect(byCard.get(String(lower._id))?.map((c) => c.amount)).toEqual([100]);
    expect(byCard.get(String(higher._id))).toEqual([]);

    // A ✗ is a sheet decision: what it judged is not offered by the next sheet.
    const rejected = await decide(dto.id, 'reject', [String(lower._id)]);
    expect(rejected.status, rejected.text).toBe(200);
    dto = await read('wataniya', [rowOf(lower, 900)]);
    expect(dto.differs[0]?.charges).toEqual([]);
  });

  it('a ✗ judges as of its sheet’s READ: a top-up written before a late ✗ is still offered by the next, lower sheet', async () => {
    const x = await mkCard('wataniya', 'EGYCASH-LATE', 1000);
    // S1 read at 900; its line is left undecided.
    const s1 = await read('wataniya', [rowOf(x, 900)]);
    expect(s1.differs.map((l) => l.card.id)).toEqual([String(x._id)]);
    // After the read: a 500 top-up — S1 could never have shown it.
    await charge(x._id, 500);
    expect((await card(x._id)).balance).toBe(1500);
    // Days later the reader gives S1's line a ✗ — allowed: a ✗ moves nothing.
    const rejected = await decide(s1.id, 'reject', [String(x._id)]);
    expect(rejected.status, rejected.text).toBe(200);
    // S2 is 500 lower — the 500 never reached the company: it is offered, so a ✓ may cancel it.
    const s2 = await read('wataniya', [rowOf(x, 1000)]);
    expect(s2.differs[0]?.difference).toBe(-500);
    expect(s2.differs[0]?.charges.map((c) => c.amount)).toEqual([500]);
  });

  it('«اعتماد طلب الرصيد» is a sheet judgement too: the charge it wrote is never offered by a later, lower sheet', async () => {
    // Morning: the sheet higher by exactly the pending 500 — ✓ approves it, a `charge` line.
    const a = await mkCard('wataniya', 'EGYCASH-MORNING', 1000, { requestedAmount: 500 });
    const morning = await read('wataniya', [rowOf(a, 1500)]);
    const approved = await decide(morning.id, 'apply', [String(a._id)], tokens.clerk, {
      approveRequests: [String(a._id)],
    });
    expect(approved.status, approved.text).toBe(200);
    expect((await log(a._id)).map((m) => [m.kind, m.amount])).toEqual([['charge', 500]]);
    const greenSince = (await card(a._id)).lastChargedAt;
    const counted = await chargedToday();

    // Afternoon: a newer sheet 500 lower — fuel used, the receipts not entered yet. The 10:00
    // charge the morning sheet confirmed is no «شحن لا يظهر في الشيت»: nothing to tick.
    const afternoon = await read('wataniya', [rowOf(a, 1000)]);
    expect(afternoon.differs[0]?.difference).toBe(-500);
    expect(afternoon.differs[0]?.charges).toEqual([]);
    const stored = await FleetFuelReconciliationModel.findById(afternoon.id).lean().exec();
    expect(stored?.lines[0]?.charges).toEqual([]);
    // So no ✓ can cancel it: the green row and «شحن اليوم» stand.
    const [chargeLine] = await log(a._id);
    const refused = await decide(afternoon.id, 'apply', [String(a._id)], tokens.clerk, {
      cancelCharges: [chargeLine?.id ?? ''],
    });
    expect([refused.status, failure(refused).details?.[0]?.code]).toEqual([422, 'NOT_A_CANDIDATE']);
    expect((await card(a._id)).lastChargedAt).toEqual(greenSince);
    expect(await chargedToday()).toBe(counted);
  });

  it('a sheet that MATCHED the card judged its charges up to that read — a later one is still offered', async () => {
    const b = await mkCard('wataniya', 'EGYCASH-EQUAL', 2000);
    await charge(b._id, 300);
    // The sheet shows 2,300: equal — nothing is written, and the session says it judged the card.
    const equal = await read('wataniya', [rowOf(b, 2300)]);
    expect(equal.equal.map((l) => l.card.id)).toEqual([String(b._id)]);
    const raw = await FleetFuelReconciliationModel.findById(equal.id).lean().exec();
    expect(raw?.equalCardIds?.map(String)).toEqual([String(b._id)]);

    await charge(b._id, 200);
    // 2,500 in the system, the next sheet 2,000: only the 200 after the matching sheet is offered —
    // the 300 that sheet already showed is not.
    const lower = await read('wataniya', [rowOf(b, 2000)]);
    expect(lower.differs[0]?.difference).toBe(-500);
    expect(lower.differs[0]?.charges.map((c) => c.amount)).toEqual([200]);
  });

  it('a session read before the equal cards were kept (no `equalCardIds`) judges only by its decided lines', async () => {
    const c = await mkCard('wataniya', 'EGYCASH-OLDSESSION', 1000);
    await charge(c._id, 100);
    const first = await read('wataniya', [rowOf(c, 1100)]);
    // As a session stored before this batch: the field is absent.
    await FleetFuelReconciliationModel.collection.updateOne(
      { _id: new Types.ObjectId(first.id) },
      { $unset: { equalCardIds: '' } },
    );
    const next = await read('wataniya', [rowOf(c, 1000)]);
    expect(next.differs[0]?.charges.map((ch) => ch.amount)).toEqual([100]);
  });
});

describe('a cancel that cannot be — refused, nothing written', () => {
  it('not a stored candidate (another card’s, an unknown id), more than the difference, already cancelled', async () => {
    const a = await mkCard('chillout', 'EGYCASHTCS-R1', 1000);
    const b = await mkCard('chillout', 'EGYCASHTCS-R2', 1000);
    await charge(a._id, 600);
    await charge(a._id, 500.1);
    await charge(b._id, 200);
    // a: system 2,100.10, sheet 1,000.10 → 1,100 off; b: system 1,200, sheet 1,000 → 200 off.
    const dto = await read('chillout', [rowOf(a, 1000.1), rowOf(b, 1000)]);
    const lineOf = (id: Types.ObjectId) => dto.differs.find((l) => l.card.id === String(id));
    const [aNew, aOld] = lineOf(a._id)?.charges ?? [];
    const [bOnly] = lineOf(b._id)?.charges ?? [];
    const movements = await movementCount();
    const balances = async () => [(await card(a._id)).balance, (await card(b._id)).balance];

    const tryCancel = (cardIds: string[], cancelCharges: string[]) =>
      decide(dto.id, 'apply', cardIds, tokens.clerk, { cancelCharges });

    // b's charge named on a decision about a alone.
    const foreign = await tryCancel([String(a._id)], [bOnly?.id ?? '']);
    expect([foreign.status, failure(foreign).code, failure(foreign).details]).toEqual([
      422,
      ErrorCodes.FLEET_FUEL_RECONCILE_CANCEL_REFUSED,
      [{ field: 'cancelCharges', code: 'NOT_A_CANDIDATE', message: bOnly?.id }],
    ]);
    const unknown = new Types.ObjectId().toString();
    expect(failure(await tryCancel([String(a._id)], [unknown])).details?.[0]).toMatchObject({
      code: 'NOT_A_CANDIDATE',
      message: unknown,
    });
    // 600 + 500.10 = 1,100.10 > 1,100.00 — by ten piastres.
    const over = await tryCancel([String(a._id)], [aNew?.id ?? '', aOld?.id ?? '']);
    expect([over.status, failure(over).details]).toEqual([
      422,
      [{ field: 'cancelCharges', code: 'EXCEEDS_DIFFERENCE', message: String(a._id) }],
    ]);
    expect(await movementCount()).toBe(movements);
    expect(await balances()).toEqual([2100.1, 1200]);

    // Cancelled behind the session's back (no write time moved): refused as such.
    await FleetFuelCardMovementModel.collection.updateOne(
      { _id: new Types.ObjectId(bOnly?.id ?? '') },
      {
        $set: {
          cancelledBySheet: {
            reconciliationId: new Types.ObjectId(),
            movementId: new Types.ObjectId(),
            fileName: 'x.xlsx',
            at: new Date(),
            by: null,
          },
        },
      },
    );
    const twice = await tryCancel([String(b._id)], [bOnly?.id ?? '']);
    expect([twice.status, failure(twice).details?.[0]?.code]).toEqual([422, 'CANCELLED']);
    expect(await movementCount()).toBe(movements);

    // Within the difference is allowed: 500.10 + 600 is too much, 600 alone is not.
    const fits = await tryCancel([String(a._id)], [aOld?.id ?? '']);
    expect(fits.status, fits.text).toBe(200);
    expect(data<FleetFuelReconcileResultDto[]>(fits)[0]?.cancelledAmount).toBe(aOld?.amount ?? NaN);
  });

  it('a cancel with ✗ is refused by the schema', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-X', 1000);
    await charge(a._id, 100);
    const dto = await read('wataniya', [rowOf(a, 1000)]);
    const res = await decide(dto.id, 'reject', [String(a._id)], tokens.clerk, {
      cancelCharges: [dto.differs[0]?.charges[0]?.id ?? ''],
    });
    expect(res.status).toBe(400);
  });
});

describe('«اعتماد طلب الرصيد» — the sheet higher by exactly the pending request', () => {
  it('exact: approved as a charge instead of an adjustment — the request cleared, the row green', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-REQ', 100, { requestedAmount: 50 });
    const dto = await read('wataniya', [rowOf(a, 150)]);
    expect(dto.differs[0]?.charges).toEqual([]);
    const before = await chargedToday();
    const applied = await decide(dto.id, 'apply', [String(a._id)], tokens.clerk, {
      approveRequests: [String(a._id)],
    });
    expect(applied.status, applied.text).toBe(200);
    expect(data<FleetFuelReconcileResultDto[]>(applied)[0]).toMatchObject({
      balance: 150,
      approvedRequest: 50,
      cancelledAmount: 0,
    });
    const after = await card(a._id);
    expect(after).toMatchObject({ balance: 150, requestedAmount: null, requestedAt: null });
    expect(after.lastChargedAt).not.toBeNull();
    expect(await chargedToday()).toBe(before + 50);
    const lines = await log(a._id);
    expect(lines.map((m) => [m.kind, m.amount, m.balanceAfter, m.sheet])).toEqual([
      ['charge', 50, 150, null],
    ]);
    const stored = await FleetFuelReconciliationModel.findById(dto.id).lean().exec();
    expect(String(stored?.lines[0]?.movementId)).toBe(lines[0]?.id);
  });

  it('a request that is not the difference any more — or approved since — is refused, nothing written', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-REQ2', 100, { requestedAmount: 40 });
    const b = await mkCard('wataniya', 'EGYCASH-REQ3', 100, { requestedAmount: 50 });
    const dto = await read('wataniya', [rowOf(a, 150), rowOf(b, 150)]);
    const movements = await movementCount();
    const mismatch = await decide(dto.id, 'apply', [String(a._id)], tokens.clerk, {
      approveRequests: [String(a._id)],
    });
    expect([mismatch.status, failure(mismatch)]).toEqual([
      409,
      expect.objectContaining({
        code: ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED,
        details: [{ field: 'cardIds', code: 'REQUEST_CHANGED', message: String(a._id) }],
      }),
    ]);
    // Approved after the read: the card moved — refused for that.
    const approved = await request(world.app)
      .post(`${CARDS}/${String(b._id)}/approve`)
      .set(...auth(tokens.clerk))
      .send({ version: (await card(b._id)).__v });
    expect(approved.status, approved.text).toBe(200);
    const late = await decide(dto.id, 'apply', [String(b._id)], tokens.clerk, {
      approveRequests: [String(b._id)],
    });
    expect([late.status, failure(late).code]).toEqual([
      409,
      ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED,
    ]);
    expect(await movementCount()).toBe(movements + 1); // only the approve itself
    expect((await card(a._id)).balance).toBe(100);
  });

  it('sheet higher with no request: a plain adjustment — not green, not counted', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-UP', 100);
    const before = await chargedToday();
    const dto = await read('wataniya', [rowOf(a, 175)]);
    const applied = await decide(dto.id, 'apply', [String(a._id)]);
    expect(applied.status, applied.text).toBe(200);
    expect(await card(a._id)).toMatchObject({ balance: 175, lastChargedAt: null });
    expect(await chargedToday()).toBe(before);
    expect((await log(a._id)).map((m) => m.kind)).toEqual(['sheetAdjust']);
  });

  it('a cancelled charge that came from a request does not bring the request back', async () => {
    const a = await mkCard('chillout', 'EGYCASHTCS-BACK', 300);
    await charge(a._id, 700);
    const dto = await read('chillout', [rowOf(a, 300)]);
    const applied = await decide(dto.id, 'apply', [String(a._id)], tokens.clerk, {
      cancelCharges: [dto.differs[0]?.charges[0]?.id ?? ''],
    });
    expect(applied.status, applied.text).toBe(200);
    expect(await card(a._id)).toMatchObject({ balance: 300, requestedAmount: null });
  });
});

describe('«تاريخ الشيت»', () => {
  it('stored and answered; a charge on a later Cairo day is listed as after it', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-DATE', 1000);
    await charge(a._id, 250);
    const dto = await readSheet('wataniya', [FUEL_SHEET_HEADER, rowOf(a, 1000)], {
      fileName: 'رصيد وطنيه 4-10-2026.xlsx',
      sheetDate: '2026-10-04',
    });
    expect(dto.sheetDate).toBe('2026-10-04');
    expect(dto.differs[0]?.charges).toEqual([
      expect.objectContaining({ amount: 250, afterSheetDate: true }),
    ]);
    const stored = await FleetFuelReconciliationModel.findById(dto.id).lean().exec();
    expect(stored?.sheetDate?.toISOString()).toBe('2026-10-04T00:00:00.000Z');

    // None given: none stored, nothing is «after» it.
    const plain = await read('wataniya', [rowOf(a, 1000)]);
    expect(plain.sheetDate).toBeNull();
    expect(plain.differs[0]?.charges[0]?.afterSheetDate).toBe(false);
    const raw = await FleetFuelReconciliationModel.collection.findOne({
      _id: new Types.ObjectId(plain.id),
    });
    expect(raw?.sheetDate ?? null).toBeNull();
  });

  it('not a calendar day → 400, nothing stored', async () => {
    const a = await mkCard('wataniya', 'EGYCASH-BADDATE', 1);
    for (const sheetDate of ['4-10-2026', '2026-02-30']) {
      const res = await readSheetRaw(sheetDate, a);
      expect(res.status).toBe(400);
    }
    expect(await FleetFuelReconciliationModel.countDocuments({ fileName: 'bad.xlsx' }).exec()).toBe(
      0,
    );
  });
});

/** A raw upload with a given «تاريخ الشيت» — for the refusals. */
const readSheetRaw = async (sheetDate: string, a: { name: string; number: string }) => {
  const file = await buildFuelSheet({
    rows: [FUEL_SHEET_HEADER, [`548**********${a.number.slice(-4)}`, a.name, 2]],
  });
  return request(world.app)
    .post(`${CARDS}/reconcile`)
    .set(...auth(tokens.clerk))
    .field('company', 'wataniya')
    .field('sheetDate', sheetDate)
    .attach('file', file, 'bad.xlsx');
};
