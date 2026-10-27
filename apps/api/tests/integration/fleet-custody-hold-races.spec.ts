// «استعاضة معلّقة لحين التحويل» — two things at once, against a real mongo. Each race runs once
// (`Promise.allSettled`), on a replenishment of its own, and checks what must hold whichever of
// the two landed first:
//
//   1. confirm ∥ confirm, 2. confirm ∥ cancel, 3. cancel ∥ cancel — exactly one move lands;
//   4. cancel ∥ a new replenishment of the same memo — at most one live letter ever holds it;
//   5. a receipt's amount ∥ confirm, 6. ∥ cancel — a held letter's figure is always its memos';
//   7. deleting the memo ∥ cancel — only once it is free;
//   8. a charge ∥ confirm, 9. a settlement ∥ confirm — neither prints a stale fund.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { FleetCustodyMemoModel } from '../../src/modules/fleet/custody/custody-memo.model';
import { FleetCustodyOperationModel } from '../../src/modules/fleet/custody/custody-operation.model';
import { fleetCustodyMemoService } from '../../src/modules/fleet/custody/custody-memo.service';
import { fleetCustodyFundService } from '../../src/modules/fleet/custody/custody-fund.service';
import {
  ACTOR,
  bootCustody,
  cancel,
  charge,
  confirm,
  editReceipt,
  fundNow,
  heldOne,
  licence,
  replenish,
  settle,
  statusOf,
  stopCustody,
  sum,
} from './helpers/custody-hold-fixture';

beforeAll(async () => {
  await bootCustody();
  await charge({ date: '2026-07-01', amount: 50000 });
}, 120_000);

afterAll(stopCustody);

const statusNow = async (id: string) => (await fleetCustodyFundService.operation(id)).status;
const memoNow = (id: string) => FleetCustodyMemoModel.findById(id).lean().exec();

describe('the two moves of one held replenishment', () => {
  it('confirm ∥ confirm: one lands, the other is 409 — the fund rises once', async () => {
    const { op } = await heldOne('2026-07-02', 700);
    const fund = await fundNow();
    const results = await Promise.allSettled([
      confirm(op.id, { date: '2026-07-03' }),
      confirm(op.id, { date: '2026-07-04' }),
    ]);
    expect(results.map(statusOf).sort()).toEqual([409, 'ok']);
    expect(await fundNow()).toBe(sum([fund, 700]));
  });

  it('confirm ∥ cancel: exactly one lands, and what it left is whole', async () => {
    const { op, memoId } = await heldOne('2026-07-05', 300);
    const fund = await fundNow();
    const results = await Promise.allSettled([
      confirm(op.id, { date: '2026-07-06' }),
      cancel(op.id),
    ]);
    expect(results.map(statusOf).sort()).toEqual([409, 'ok']);
    const memo = await memoNow(memoId);
    if ((await statusNow(op.id)) === 'done') {
      expect(memo).toMatchObject({
        replenishmentHeld: false,
        replenishedAt: new Date('2026-07-06'),
      });
      expect(String(memo?.replenishmentId)).toBe(op.id);
      expect(await fundNow()).toBe(sum([fund, 300]));
    } else {
      expect(memo).toMatchObject({ replenishmentId: null, replenishedAt: null });
      expect(await fundNow()).toBe(fund);
    }
  });

  it('cancel ∥ cancel: one lands, the other is 409', async () => {
    const { op } = await heldOne('2026-07-07', 200);
    const results = await Promise.allSettled([cancel(op.id), cancel(op.id)]);
    expect(results.map(statusOf).sort()).toEqual([409, 'ok']);
    expect(await statusNow(op.id)).toBe('cancelled');
  });

  it('cancel ∥ a new replenishment of its memo: at most one live letter holds the memo', async () => {
    const { op, memoId } = await heldOne('2026-07-08', 150);
    const results = await Promise.allSettled([
      cancel(op.id),
      replenish({ date: '2026-07-09', memoIds: [memoId] }),
    ]);
    const [cancelled, again] = results.map(statusOf);
    expect(cancelled).toBe('ok');
    // The new letter came after the cancel (ok), or met the memo still held (409).
    expect([409, 'ok']).toContain(again);
    const holding = await FleetCustodyOperationModel.find({
      'memos.memoId': new Types.ObjectId(memoId),
      status: { $in: ['held', 'done'] },
    })
      .lean()
      .exec();
    expect(holding.length).toBeLessThanOrEqual(1);
    const memo = await memoNow(memoId);
    expect(memo?.replenishmentId == null ? null : String(memo.replenishmentId)).toBe(
      holding[0] === undefined ? null : String(holding[0]._id),
    );
  });
});

describe('a held letter’s figure is always its memos’', () => {
  it('a receipt’s amount ∥ confirm: the edit is refused either way', async () => {
    const { op, memoId, receiptId } = await heldOne('2026-07-10', 410);
    const results = await Promise.allSettled([
      editReceipt(receiptId, { amount: 999 }),
      confirm(op.id, { date: '2026-07-11' }),
    ]);
    expect(results.map(statusOf)).toEqual([422, 'ok']);
    expect((await fleetCustodyMemoService.get(memoId)).total).toBe(op.amount);
  });

  it('a receipt’s amount ∥ cancel: it lands only on the freed memo — else it is refused', async () => {
    const { op, memoId, receiptId } = await heldOne('2026-07-12', 420);
    const results = await Promise.allSettled([
      editReceipt(receiptId, { amount: 999 }),
      cancel(op.id),
    ]);
    const [edited, cancelled] = results.map(statusOf);
    expect(cancelled).toBe('ok');
    const memo = await fleetCustodyMemoService.get(memoId);
    if (edited === 'ok') {
      expect(memo).toMatchObject({ replenishment: null, total: 999 });
    } else {
      expect(edited).toBe(422);
      expect(memo.total).toBe(op.amount);
    }
  });

  it('deleting its memo ∥ cancel: the delete lands only once the memo is free', async () => {
    const { op, memoId } = await heldOne('2026-07-13', 430);
    const results = await Promise.allSettled([
      fleetCustodyMemoService.remove(memoId, ACTOR),
      cancel(op.id),
    ]);
    const [removed, cancelled] = results.map(statusOf);
    expect(cancelled).toBe('ok');
    const memo = await memoNow(memoId);
    if (removed === 'ok') {
      expect(memo).toMatchObject({ isDeleted: true, replenishmentId: null });
    } else {
      expect(removed).toBe(422);
      expect(memo).toMatchObject({ isDeleted: false, replenishmentId: null });
    }
  });
});

describe('the fund a letter prints, while a transfer is confirmed', () => {
  it('a charge ∥ confirm: the charge prints the fund before or after the transfer, never between', async () => {
    const { op } = await heldOne('2026-07-14', 800);
    const fund = await fundNow();
    const results = await Promise.allSettled([
      charge({ date: '2026-07-15', amount: 25 }),
      confirm(op.id, { date: '2026-07-15' }),
    ]);
    expect(results.map(statusOf)).toEqual(['ok', 'ok']);
    const charged = (results[0] as PromiseFulfilledResult<{ fundBefore: number }>).value;
    expect([fund, sum([fund, 800])]).toContain(charged.fundBefore);
    expect(await fundNow()).toBe(sum([fund, 800, 25]));
  });

  it('a settlement ∥ confirm: its «من العهده» is the fund at its own commit', async () => {
    const { op } = await heldOne('2026-07-16', 900);
    const record = await licence('2026-07-16', 60);
    const fund = await fundNow();
    const results = await Promise.allSettled([
      settle({ parts: [{ expenseId: record.id, part: 'renewal' }] }),
      confirm(op.id, { date: '2026-07-17' }),
    ]);
    expect(results.map(statusOf)).toEqual(['ok', 'ok']);
    const settled = (
      results[0] as PromiseFulfilledResult<{ fundBefore: number; letterFigure: number | null }>
    ).value;
    expect(settled.letterFigure).toBe(settled.fundBefore);
    expect([fund, sum([fund, 900])]).toContain(settled.fundBefore);
    expect(await fundNow()).toBe(sum([fund, 900, -60]));
  });
});
