// «حذف العملية» — two things at once, against a real mongo. Each race runs once
// (`Promise.allSettled`), on an operation of its own, and checks what must hold whichever of the two
// landed first:
//
//   1. delete ∥ confirm, 2. delete ∥ cancel, 3. delete ∥ delete — exactly one lands, and what it
//      left is whole (the operation, its memos, the fund);
//   4. deleting a held replenishment ∥ a new replenishment of its memo — at most one live letter
//      ever holds the memo;
//   5. deleting a settlement ∥ a new settlement of its licensing memo — at most one live letter
//      ever settles it;
//   6. deleting a transferred replenishment ∥ an edit of one of its receipts — the edit lands only
//      on the freed memo;
//   7. deleting a charge ∥ a new charge — the new letter prints the fund before or after the
//      delete, never between.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { FleetCustodyMemoModel } from '../../src/modules/fleet/custody/custody-memo.model';
import { FleetCustodyOperationModel } from '../../src/modules/fleet/custody/custody-operation.model';
import { fleetCustodyMemoService } from '../../src/modules/fleet/custody/custody-memo.service';
import { FleetLicenseExpenseModel } from '../../src/modules/fleet/license-expenses/license-expense.model';
import {
  bootCustody,
  cancel,
  charge,
  confirm,
  editReceipt,
  fundNow,
  heldOne,
  licence,
  removeOp,
  replenish,
  settle,
  statusOf,
  stopCustody,
  sum,
} from './helpers/custody-hold-fixture';

beforeAll(async () => {
  await bootCustody();
  await charge({ date: '2026-08-01', amount: 50000 });
}, 120_000);

afterAll(stopCustody);

const opNow = (id: string) => FleetCustodyOperationModel.findById(id).lean().exec();
const memoNow = (id: string) => FleetCustodyMemoModel.findById(id).lean().exec();

describe('a delete and a move of the same operation', () => {
  it('delete ∥ confirm: exactly one lands — deleted and free, or transferred and counted', async () => {
    const { op, memoId } = await heldOne('2026-08-02', 700);
    const fund = await fundNow();
    const results = await Promise.allSettled([
      removeOp(op.id, { version: op.version }),
      confirm(op.id, { date: '2026-08-03' }),
    ]);
    const [removed, confirmed] = results.map(statusOf);
    const stored = await opNow(op.id);
    const memo = await memoNow(memoId);
    if (removed === 'ok') {
      expect(confirmed).toBe(404);
      expect(stored).toMatchObject({ isDeleted: true, status: 'held' });
      expect(memo).toMatchObject({ replenishmentId: null, replenishmentHeld: false });
      expect(await fundNow()).toBe(fund);
    } else {
      expect(confirmed).toBe('ok');
      // The version the delete read was the held one: it is refused, never applied late.
      expect(removed).toBe(409);
      expect(stored).toMatchObject({ isDeleted: false, status: 'done' });
      expect(String(memo?.replenishmentId)).toBe(op.id);
      expect(memo?.replenishmentHeld).toBe(false);
      expect(await fundNow()).toBe(sum([fund, 700]));
    }
  });

  it('delete ∥ cancel: exactly one lands, and the memo is free either way', async () => {
    const { op, memoId } = await heldOne('2026-08-04', 300);
    const fund = await fundNow();
    const results = await Promise.allSettled([
      removeOp(op.id, { version: op.version }),
      cancel(op.id),
    ]);
    const [removed, cancelled] = results.map(statusOf);
    expect([removed, cancelled].filter((one) => one === 'ok')).toHaveLength(1);
    expect([removed, cancelled]).toContain(removed === 'ok' ? 404 : 409);
    const stored = await opNow(op.id);
    expect(stored?.isDeleted).toBe(removed === 'ok');
    expect(stored?.status).toBe(removed === 'ok' ? 'held' : 'cancelled');
    expect(await memoNow(memoId)).toMatchObject({ replenishmentId: null, replenishedAt: null });
    expect(await fundNow()).toBe(fund);
  });

  it('delete ∥ delete: one lands, the other is refused — the fund falls once', async () => {
    const op = await charge({ date: '2026-08-05', amount: 120 });
    const fund = await fundNow();
    const results = await Promise.allSettled([
      removeOp(op.id, { version: op.version }),
      removeOp(op.id, { version: op.version, reason: 'ثانية' }),
    ]);
    const outcomes = results.map(statusOf);
    expect(outcomes.filter((one) => one === 'ok')).toHaveLength(1);
    expect([404, 409]).toContain(outcomes.find((one) => one !== 'ok'));
    expect(await fundNow()).toBe(sum([fund, -120]));
    const stored = await opNow(op.id);
    expect(stored?.isDeleted).toBe(true);
    // One deletion, the winner's — its fund figures the fund it really moved.
    expect(stored?.deletion).toMatchObject({ fundBefore: fund, fundAfter: sum([fund, -120]) });
  });
});

describe('what the operation had claimed', () => {
  it('deleting a held replenishment ∥ a new one of its memo: at most one live letter holds it', async () => {
    const { op, memoId } = await heldOne('2026-08-06', 150);
    const results = await Promise.allSettled([
      removeOp(op.id, { version: op.version }),
      replenish({ date: '2026-08-07', memoIds: [memoId] }),
    ]);
    const [removed, again] = results.map(statusOf);
    expect(removed).toBe('ok');
    // The new letter came after the delete (ok), or met the memo still held (409).
    expect([409, 'ok']).toContain(again);
    const holding = await FleetCustodyOperationModel.find({
      'memos.memoId': new Types.ObjectId(memoId),
      isDeleted: false,
      status: { $in: ['held', 'done'] },
    })
      .lean()
      .exec();
    expect(holding).toHaveLength(again === 'ok' ? 1 : 0);
    const memo = await memoNow(memoId);
    expect(memo?.replenishmentId == null ? null : String(memo.replenishmentId)).toBe(
      holding[0] === undefined ? null : String(holding[0]._id),
    );
  });

  it('deleting a settlement ∥ a new one of its licensing memo: at most one live letter settles it', async () => {
    const record = await licence('2026-08-08', 80);
    const first = await settle({ parts: [{ expenseId: record.id, part: 'renewal' }] });
    const fund = await fundNow();
    const results = await Promise.allSettled([
      removeOp(first.id, { version: first.version }),
      settle({ parts: [{ expenseId: record.id, part: 'renewal' }] }),
    ]);
    const [removed, again] = results.map(statusOf);
    expect(removed).toBe('ok');
    expect([409, 'ok']).toContain(again);
    const live = await FleetCustodyOperationModel.find({
      'parts.expenseId': new Types.ObjectId(record.id),
      isDeleted: false,
    })
      .lean()
      .exec();
    expect(live).toHaveLength(again === 'ok' ? 1 : 0);
    const stored = await FleetLicenseExpenseModel.findById(record.id).lean().exec();
    expect(
      stored?.renewalSettlement == null ? null : String(stored.renewalSettlement.operationId),
    ).toBe(live[0] === undefined ? null : String(live[0]._id));
    // The first letter's 80 came back; a second one, if it landed, took it again.
    expect(await fundNow()).toBe(again === 'ok' ? fund : sum([fund, 80]));
  });

  it('deleting a transferred replenishment ∥ an edit of its receipt: the edit lands only on the freed memo', async () => {
    const { op, memoId, receiptId } = await heldOne('2026-08-09', 410);
    await confirm(op.id, { date: '2026-08-10' });
    const version = (await opNow(op.id))?.__v ?? NaN;
    const results = await Promise.allSettled([
      editReceipt(receiptId, { amount: 999 }),
      removeOp(op.id, { version }),
    ]);
    const [edited, removed] = results.map(statusOf);
    expect(removed).toBe('ok');
    const memo = await fleetCustodyMemoService.get(memoId);
    expect(memo.replenishment).toBeNull();
    if (edited === 'ok') {
      expect(memo.total).toBe(999);
    } else {
      expect(edited).toBe(422);
      expect(memo.total).toBe(410);
    }
    // What the deleted letter printed never changes.
    expect((await opNow(op.id))?.amount).toBe(410);
  });
});

describe('the fund a letter prints, while an operation is deleted', () => {
  it('a charge ∥ deleting another: it prints the fund before or after the delete, never between', async () => {
    const old = await charge({ date: '2026-08-11', amount: 900 });
    const fund = await fundNow();
    const results = await Promise.allSettled([
      charge({ date: '2026-08-12', amount: 25 }),
      removeOp(old.id, { version: old.version }),
    ]);
    expect(results.map(statusOf)).toEqual(['ok', 'ok']);
    const charged = (results[0] as PromiseFulfilledResult<{ fundBefore: number }>).value;
    expect([fund, sum([fund, -900])]).toContain(charged.fundBefore);
    expect(await fundNow()).toBe(sum([fund, -900, 25]));
    const deletion = (await opNow(old.id))?.deletion;
    // The delete's own figures are the fund at its commit — with or without the new charge.
    expect([fund, sum([fund, 25])]).toContain(deletion?.fundBefore);
    expect(deletion?.fundAfter).toBe(sum([deletion?.fundBefore ?? NaN, -900]));
  });
});
