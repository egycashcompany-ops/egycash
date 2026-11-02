// «حذف العملية» against a real mongo — «زرار امسح منه استعادة او طلب عهدة او تسوية ووجود سجل للهذة
// الحركات»:
//
//   1. each kind and status: the operation leaves «سجل العهدة» and every figure (the ledger refolds,
//      a later row's «قبلها/بعدها» moves), `GET /operations/:id` is 404, and it lives on in
//      «العمليات المحذوفة» with who, when, why and the fund on either side of it;
//   2. what it had claimed is free again, found by query: a transferred, legacy or held
//      replenishment's memos (pending, editable, their receipts unlocked, offered anew), never a
//      cancelled one's — not even a memo another replenishment re-took; a settlement's licensing
//      memos (unlocked unless the record's other memo is settled by another letter);
//   3. a charge with operations after it may go, and the fund may go negative;
//   4. the guards: 404 / 409 / 403 / 400; «العمليات المحذوفة»'s from/to are Cairo days;
//   5. its audit trail.
//
// The races are in `fleet-custody-delete-races.spec.ts`. The fund is one fund: every case compares
// the fund before and after, never a figure another case left behind.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  ListFleetCustodyLedgerQuerySchema,
  ListFleetCustodyMemosQuerySchema,
  UpdateFleetCustodyMemoSchema,
  UpdateFleetLicenseExpenseSchema,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyOperationDto,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { FleetReceiptModel } from '../../src/modules/fleet/receipts/receipt.model';
import { fleetReceiptService } from '../../src/modules/fleet/receipts/receipt.service';
import { FleetCustodyMemoModel } from '../../src/modules/fleet/custody/custody-memo.model';
import { FleetCustodyOperationModel } from '../../src/modules/fleet/custody/custody-operation.model';
import { fleetCustodyMemoService } from '../../src/modules/fleet/custody/custody-memo.service';
import { fleetCustodyFundService } from '../../src/modules/fleet/custody/custody-fund.service';
import { FleetLicenseExpenseModel } from '../../src/modules/fleet/license-expenses/license-expense.model';
import { fleetLicenseExpenseService } from '../../src/modules/fleet/license-expenses/license-expense.service';
import {
  ACTOR,
  bootCustody,
  cancel,
  charge,
  confirm,
  data,
  day,
  editReceipt,
  fundNow,
  heldOne,
  licence,
  licenceBoth,
  plantReceipt,
  removeOp,
  replenish,
  settle,
  stopCustody,
  sum,
  tokenWith,
} from './helpers/custody-hold-fixture';

let app: Express;
/** May record the letters AND delete them. */
let writer: string;
/** May record the letters, never delete one. */
let noDelete: string;
/** May delete, never record — the custody receipts' delete grant alone. */
let deleteOnly: string;
/** Reads the custody screens only. */
let reader: string;
/** Nothing custody at all. */
let stranger: string;

beforeAll(async () => {
  app = await bootCustody();
  writer = await tokenWith(['fleetCustody.view', 'fleetReceipt.create', 'fleetReceipt.delete']);
  noDelete = await tokenWith(['fleetCustody.view', 'fleetReceipt.create']);
  deleteOnly = await tokenWith(['fleetCustody.view', 'fleetReceipt.delete']);
  reader = await tokenWith(['fleetCustody.view']);
  stranger = await tokenWith(['fleetReceipt.delete']);
}, 120_000);

afterAll(stopCustody);

const BASE = '/api/v1/fleet/custody/fund';
const del = (token: string, id: string, body: Record<string, unknown>) =>
  request(app)
    .delete(`${BASE}/operations/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
const get = (token: string, path: string) =>
  request(app).get(`${BASE}${path}`).set('Authorization', `Bearer ${token}`);
const summary = async () => data<FleetCustodyFundSummaryDto>(await get(reader, '/summary'));
const ledger = async () =>
  (await fleetCustodyFundService.ledger(ListFleetCustodyLedgerQuerySchema.parse({ pageSize: 100 })))
    .items;
const ledgerRow = async (id: string) => (await ledger()).find((row) => row.id === id);
const deletedOne = async (id: string) =>
  data<FleetCustodyOperationDto>(await get(reader, `/deleted/${id}`));
const deletedIds = async (query: string) =>
  data<FleetCustodyOperationDto[]>(await get(reader, `/deleted?pageSize=100${query}`)).map(
    (op) => op.id,
  );
const versionOf = async (id: string) => (await fleetCustodyFundService.operation(id)).version;
const memoRaw = (id: string) => FleetCustodyMemoModel.findById(id).lean().exec();
const memosWith = async (status: 'pending' | 'held' | 'replenished') =>
  (
    await fleetCustodyMemoService.list(ListFleetCustodyMemosQuerySchema.parse({ status }))
  ).items.map((row) => row.id);
const auditOf = (entityType: string, entityId: string, action: string) =>
  AuditLogModel.find({
    'entityRef.entityType': entityType,
    'entityRef.entityId': entityId,
    action,
  })
    .sort({ _id: 1 })
    .lean()
    .exec();

describe('a «طلب عهدة»', () => {
  let op: FleetCustodyOperationDto;
  let later: FleetCustodyOperationDto;

  it('leaves «سجل العهدة» and every figure — and lives on in «العمليات المحذوفة»', async () => {
    // His row: 2026/11/01, «نظير تراخيص», +150,000.00 — recorded through the screen, by a person.
    const posted = await request(app)
      .post(`${BASE}/charge`)
      .set('Authorization', `Bearer ${writer}`)
      .send({ date: '2026-03-01', amount: 150000, reason: 'تراخيص' });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    op = data<FleetCustodyOperationDto>(posted);
    expect(op).toMatchObject({ deletion: null, createdByName: 'م م' });
    later = await charge({ date: '2026-03-05', amount: 10 });
    const laterBefore = (await ledgerRow(later.id))?.before ?? NaN;
    const before = await summary();
    const stored = await FleetCustodyOperationModel.findById(op.id).lean().exec();

    const res = await del(writer, op.id, { reason: '  مكرر  ', version: op.version });
    expect(res.status, JSON.stringify(res.body)).toBe(204);

    const after = await summary();
    expect(after.fundTotal).toBe(sum([before.fundTotal, -150000]));
    expect(after.operations).toBe(before.operations - 1);
    expect(after.charged).toEqual({
      count: before.charged.count - 1,
      amount: sum([before.charged.amount, -150000]),
    });
    expect(after.deleted).toEqual({ count: before.deleted.count + 1 });
    // The ledger refolds as if it never happened: no row, and the later one moves down with it.
    expect(await ledgerRow(op.id)).toBeUndefined();
    expect((await ledgerRow(later.id))?.before).toBe(sum([laterBefore, -150000]));
    expect((await ledger()).find((row) => row.latest)?.after).toBe(after.fundTotal);
    expect((await get(reader, `/operations/${op.id}`)).status).toBe(404);

    const gone = await deletedOne(op.id);
    expect(gone).toMatchObject({
      id: op.id,
      kind: 'charge',
      status: 'done',
      amount: 150000,
      reason: 'تراخيص',
      ledger: null,
      createdByName: 'م م',
      fundBefore: op.fundBefore,
      deletion: {
        reason: 'مكرر',
        byName: 'م م',
        fundBefore: before.fundTotal,
        fundAfter: after.fundTotal,
      },
    });
    expect(await deletedIds('')).toContain(op.id);
    // Soft: the row and everything its letter printed stay; the base fields say it is deleted.
    const raw = await FleetCustodyOperationModel.findById(op.id).lean().exec();
    expect(raw).toMatchObject({
      isDeleted: true,
      kind: 'charge',
      amount: stored?.amount,
      fundBefore: stored?.fundBefore,
      chargedTotal: stored?.chargedTotal,
      letterFigure: stored?.letterFigure,
    });
    expect(raw?.signatures).toEqual(stored?.signatures);
    expect(raw?.deletedAt?.toISOString()).toBe(gone.deletion?.at);
    expect(String(raw?.deletedBy)).toBe(String(raw?.createdBy));
  });

  it('is audited as a delete, with its deletion', async () => {
    const rows = await auditOf('custodyOperation', op.id, 'delete');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.changes).toEqual(
      expect.arrayContaining([
        { field: 'kind', old: 'charge', new: null },
        { field: 'amount', old: 150000, new: null },
        {
          field: 'deletion',
          old: null,
          new: expect.objectContaining({ reason: 'مكرر', byName: 'م م' }),
        },
      ]),
    );
  });

  it('a second delete is 404; a version read before a change is 409 — nothing moves', async () => {
    expect((await del(writer, op.id, { version: op.version + 1 })).status).toBe(404);
    const fund = await fundNow();
    const stale = await del(writer, later.id, { version: later.version + 1 });
    expect(stale.status).toBe(409);
    expect(await fundNow()).toBe(fund);
    expect((await fleetCustodyFundService.operation(later.id)).deletion).toBeNull();
    expect((await del(writer, later.id, { version: later.version })).status).toBe(204);
    expect(await fundNow()).toBe(sum([fund, -10]));
    // A deleted operation cannot be confirmed or cancelled either.
    expect(
      (
        await request(app)
          .post(`${BASE}/operations/${later.id}/cancel`)
          .set('Authorization', `Bearer ${writer}`)
          .send({})
      ).status,
    ).toBe(404);
  });

  it('with operations after it, it still goes — and the fund may go negative', async () => {
    const fund = await fundNow();
    const amount = Math.ceil(Math.abs(fund)) + 5000;
    const big = await charge({ date: '2026-03-10', amount });
    // Spent down to 10.00 after it.
    await plantReceipt('2026-03-11', 'maintenance', sum([fund, amount, -10]));
    const record = await licence('2026-03-12', 4);
    await settle({ date: '2026-03-12', parts: [{ expenseId: record.id, part: 'renewal' }] });
    expect(await fundNow()).toBe(6);

    expect((await del(writer, big.id, { version: big.version })).status).toBe(204);
    expect(await fundNow()).toBe(sum([6, -amount]));
    expect((await deletedOne(big.id)).deletion).toMatchObject({
      fundBefore: 6,
      fundAfter: sum([6, -amount]),
    });
    expect((await summary()).fundTotal).toBeLessThan(0);
  });
});

describe('a «استعاضة»', () => {
  it('transferred: the fund falls by it, and its memos are pending again — editable, unlocked, offered', async () => {
    const held = await heldOne('2026-04-01', 700);
    await confirm(held.op.id, { date: '2026-04-03' });
    const fund = await fundNow();

    expect((await del(writer, held.op.id, { version: await versionOf(held.op.id) })).status).toBe(
      204,
    );
    expect(await fundNow()).toBe(sum([fund, -700]));
    expect((await deletedOne(held.op.id)).deletion).toMatchObject({
      fundBefore: fund,
      fundAfter: sum([fund, -700]),
    });
    expect(await memoRaw(held.memoId)).toMatchObject({
      replenishmentId: null,
      replenishedAt: null,
      replenishmentHeld: false,
    });
    expect((await fleetCustodyMemoService.get(held.memoId)).replenishment).toBeNull();
    expect(await memosWith('pending')).toContain(held.memoId);
    expect((await fleetReceiptService.get(held.receiptId)).memo).toMatchObject({
      replenishedAt: null,
      held: false,
    });
    // Its receipt and the memo itself can be changed again, and a new letter can take it.
    expect((await editReceipt(held.receiptId, { amount: 720 })).doc.amount).toBe(720);
    const memo = await fleetCustodyMemoService.get(held.memoId);
    expect(
      await fleetCustodyMemoService.update(
        held.memoId,
        UpdateFleetCustodyMemoSchema.parse({
          kind: 'tyres',
          name: 'كاوتش أبريل',
          lines: [{ receiptId: held.receiptId }],
          version: memo.version,
        }),
        ACTOR,
      ),
    ).toMatchObject({ name: 'كاوتش أبريل', total: 720 });
    expect(
      (await fleetCustodyFundService.replenishCandidates()).memos.map((row) => row.id),
    ).toContain(held.memoId);
    // Audited per memo: the transfer's day gone, no hold to undo.
    const memoAudit = await auditOf('custodyMemo', held.memoId, 'statusChange');
    expect(memoAudit.at(-1)?.changes).toEqual([
      { field: 'replenishmentId', old: held.op.id, new: null },
      { field: 'replenishedAt', old: '2026-04-03', new: null },
    ]);
  });

  it('held: the fund does not move, and its memos are free again', async () => {
    const held = await heldOne('2026-04-10', 300);
    const before = await summary();

    expect((await del(deleteOnly, held.op.id, { version: held.op.version })).status).toBe(204);
    const after = await summary();
    expect(after.fundTotal).toBe(before.fundTotal);
    expect(after.held.count).toBe(before.held.count - 1);
    expect(after.memos.pending).toBe(before.memos.pending + 1);
    expect((await deletedOne(held.op.id)).deletion).toMatchObject({
      fundBefore: before.fundTotal,
      fundAfter: before.fundTotal,
    });
    expect(await memoRaw(held.memoId)).toMatchObject({
      replenishmentId: null,
      replenishedAt: null,
      replenishmentHeld: false,
    });
    expect((await auditOf('custodyMemo', held.memoId, 'statusChange')).at(-1)?.changes).toEqual([
      { field: 'replenishmentId', old: held.op.id, new: null },
      { field: 'replenishedAt', old: '2026-04-10', new: null },
      { field: 'replenishmentHeld', old: true, new: false },
    ]);
    // Neither a confirm nor a cancel finds it any more.
    await expect(confirm(held.op.id, { date: '2026-04-11' })).rejects.toMatchObject({
      httpStatus: 404,
    });
  });

  it('cancelled: nothing is written to a memo — not even one another replenishment re-took', async () => {
    const held = await heldOne('2026-04-15', 250);
    await cancel(held.op.id, { reason: 'خطأ' });
    const again = await replenish({ date: '2026-04-16', memoIds: [held.memoId] });
    const memoBefore = await memoRaw(held.memoId);
    const fund = await fundNow();
    const audits = (await auditOf('custodyMemo', held.memoId, 'statusChange')).length;

    expect((await del(writer, held.op.id, { version: await versionOf(held.op.id) })).status).toBe(
      204,
    );
    expect(await fundNow()).toBe(fund);
    expect(await memoRaw(held.memoId)).toEqual(memoBefore);
    expect(String(memoBefore?.replenishmentId)).toBe(again.id);
    expect(await auditOf('custodyMemo', held.memoId, 'statusChange')).toHaveLength(audits);
    expect((await deletedOne(held.op.id)).status).toBe('cancelled');
    expect((await summary()).cancelled.count).toBe(0);
    expect((await fleetCustodyFundService.operation(again.id)).status).toBe('held');
  });

  it('from before the hold (no status): read as transferred — the fund falls, its memo is free and gains no hold field', async () => {
    const ids = {
      op: new Types.ObjectId(),
      memo: new Types.ObjectId(),
      receipt: new Types.ObjectId(),
    };
    const base = (at: Date) => ({
      schemaVersion: 1,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdBy: null,
      updatedBy: null,
      createdAt: at,
      updatedAt: at,
      __v: 0,
    });
    await FleetReceiptModel.collection.insertOne({
      _id: ids.receipt,
      date: day('2025-05-02'),
      vehicleId: new Types.ObjectId(),
      driverEmployeeId: null,
      driverName: 'سائق',
      kind: 'wash',
      source: 'custody',
      cardId: null,
      fuelType: null,
      pricePerLitre: null,
      litres: null,
      amount: 90,
      image: null,
      memoId: ids.memo,
      ...base(day('2025-05-02')),
    });
    await FleetCustodyMemoModel.collection.insertOne({
      _id: ids.memo,
      no: 800,
      kind: 'wash',
      name: '',
      date: day('2025-05-03'),
      from: day('2025-05-02'),
      to: day('2025-05-02'),
      lines: [{ receiptId: ids.receipt, mission: '', statement: '', note: '' }],
      signatures: { blocks: [], note: '' },
      replenishmentId: ids.op,
      replenishedAt: day('2025-05-04'),
      lockSeq: 0,
      ...base(day('2025-05-03')),
    });
    await FleetCustodyOperationModel.collection.insertOne({
      _id: ids.op,
      kind: 'replenish',
      date: day('2025-05-04'),
      from: day('2025-05-01'),
      to: day('2025-05-31'),
      amount: 90,
      reason: '',
      memos: [
        {
          memoId: ids.memo,
          no: 800,
          kind: 'wash',
          name: '',
          from: day('2025-05-02'),
          to: day('2025-05-02'),
          receipts: 1,
          amount: 90,
        },
      ],
      parts: [],
      fundBefore: 0,
      chargedTotal: 0,
      letterFigure: 0,
      signatures: { blocks: [], note: '' },
      ...base(new Date('2025-05-04T08:00:00.000Z')),
    });
    const fund = await fundNow();

    expect((await del(writer, String(ids.op), { version: 0 })).status).toBe(204);
    expect(await fundNow()).toBe(sum([fund, -90]));
    expect(await ledgerRow(String(ids.op))).toBeUndefined();
    const memo = await FleetCustodyMemoModel.collection.findOne({ _id: ids.memo });
    expect(memo).toMatchObject({ replenishmentId: null, replenishedAt: null });
    expect(memo).not.toHaveProperty('replenishmentHeld');
    // Still a legacy row: the delete names a deletion, never a status.
    const raw = await FleetCustodyOperationModel.collection.findOne({ _id: ids.op });
    expect(raw).not.toHaveProperty('status');
    expect((await deletedOne(String(ids.op))).status).toBe('done');
  });
});

describe('a «تسوية»', () => {
  it('the fund rises by it, and its licensing memos are «لم تُسوَّ بعد» again — the record unlocks unless another letter settled its other memo', async () => {
    const alone = await licence('2026-05-02', 120);
    const both = await licenceBoth('2026-05-03', 40, 15);
    const first = await settle({
      date: '2026-05-05',
      parts: [
        { expenseId: alone.id, part: 'renewal' },
        { expenseId: both.id, part: 'renewal' },
      ],
    });
    const second = await settle({
      date: '2026-05-06',
      parts: [{ expenseId: both.id, part: 'extension' }],
    });
    const fund = await fundNow();

    expect((await del(writer, first.id, { version: first.version })).status).toBe(204);
    expect(await fundNow()).toBe(sum([fund, 160]));
    expect((await deletedOne(first.id)).deletion).toMatchObject({
      fundBefore: fund,
      fundAfter: sum([fund, 160]),
    });
    const aloneNow = await fleetLicenseExpenseService.get(alone.id);
    expect(aloneNow.renewal?.settlement).toBeNull();
    const bothNow = await fleetLicenseExpenseService.get(both.id);
    expect(bothNow.renewal?.settlement).toBeNull();
    expect(bothNow.extension?.settlement).toEqual({ operationId: second.id, date: '2026-05-06' });
    // Offered again — the two renewals; the extension another letter still holds is not.
    const offered = (await fleetCustodyFundService.settleCandidates()).parts
      .filter((row) => [alone.id, both.id].includes(row.expenseId))
      .map((row) => [row.expenseId, row.part]);
    expect(offered).toEqual([
      [alone.id, 'renewal'],
      [both.id, 'renewal'],
    ]);
    // The record its letter alone settled can be edited and deleted again…
    const edited = await fleetLicenseExpenseService.update(
      alone.id,
      UpdateFleetLicenseExpenseSchema.parse({
        date: aloneNow.date,
        renewal: {
          vehicles: [{ vehicleId: null, plate: 'ل ت 1' }],
          items: [
            { itemId: null, label: 'تجديد', amount: 130, count: 1, paidBy: 'visa', receipt: true },
          ],
        },
        extension: null,
        signatures: aloneNow.signatures,
        version: aloneNow.version,
      }),
      ACTOR,
    );
    expect(edited.renewal?.items[0]?.amount).toBe(130);
    await fleetLicenseExpenseService.remove(alone.id, ACTOR);
    expect((await FleetLicenseExpenseModel.findById(alone.id).lean().exec())?.isDeleted).toBe(true);
    // …the one whose other memo the second letter settled stays locked (the lock is the record's).
    await expect(fleetLicenseExpenseService.remove(both.id, ACTOR)).rejects.toMatchObject({
      httpStatus: 422,
    });
    // One status change per record, naming the memo it freed.
    expect((await auditOf('licenseExpense', both.id, 'statusChange')).at(-1)?.changes).toEqual([
      {
        field: 'renewalSettlement',
        old: { operationId: first.id, settledAt: '2026-05-05' },
        new: null,
      },
    ]);
  });
});

describe('who may delete, and what a delete accepts', () => {
  let op: FleetCustodyOperationDto;
  beforeAll(async () => {
    op = await charge({ date: '2026-06-01', amount: 55 });
  });

  it('needs the custody grant AND the receipts’ delete grant — the backend says so', async () => {
    expect((await del(noDelete, op.id, { version: op.version })).status).toBe(403);
    expect((await del(reader, op.id, { version: op.version })).status).toBe(403);
    expect((await del(stranger, op.id, { version: op.version })).status).toBe(403);
    expect((await fleetCustodyFundService.operation(op.id)).deletion).toBeNull();
  });

  it('a strict body: the version is required, an unknown key or a reason over 500 is 400', async () => {
    expect((await del(writer, op.id, {})).status).toBe(400);
    expect((await del(writer, op.id, { version: op.version, why: 'x' })).status).toBe(400);
    expect(
      (await del(writer, op.id, { version: op.version, reason: 'س'.repeat(501) })).status,
    ).toBe(400);
    expect((await del(writer, 'not-an-id', { version: 0 })).status).toBe(400);
    expect((await fleetCustodyFundService.operation(op.id)).deletion).toBeNull();
  });

  it('the reason is optional', async () => {
    expect((await del(writer, op.id, { version: op.version })).status).toBe(204);
    expect((await deletedOne(op.id)).deletion?.reason).toBe('');
  });

  it('«العمليات المحذوفة» is read under the custody grant alone', async () => {
    expect((await get(reader, '/deleted')).status).toBe(200);
    expect((await get(reader, `/deleted/${op.id}`)).status).toBe(200);
    expect((await get(stranger, '/deleted')).status).toBe(403);
    expect((await get(stranger, `/deleted/${op.id}`)).status).toBe(403);
    // A live operation is not in it.
    const live = await charge({ date: '2026-06-02', amount: 5 });
    expect((await get(reader, `/deleted/${live.id}`)).status).toBe(404);
    expect(await deletedIds('')).not.toContain(live.id);
  });
});

describe('«العمليات المحذوفة» — by the CAIRO day of the delete', () => {
  // Winter (UTC+2) and summer (UTC+3): 23:30 in Cairo is still that day; 00:30 is the next one,
  // though UTC has not reached midnight yet.
  const AT = {
    winterLate: new Date('2026-02-10T21:30:00.000Z'), // 23:30 Cairo, 10/02
    winterAfter: new Date('2026-02-10T22:30:00.000Z'), // 00:30 Cairo, 11/02 — UTC still 10/02
    summerLate: new Date('2026-07-10T20:30:00.000Z'), // 23:30 Cairo, 10/07
    summerAfter: new Date('2026-07-10T21:30:00.000Z'), // 00:30 Cairo, 11/07 — UTC still 10/07
  };
  const ids: Record<keyof typeof AT, string> = {
    winterLate: '',
    winterAfter: '',
    summerLate: '',
    summerAfter: '',
  };
  let settled = '';

  beforeAll(async () => {
    for (const key of Object.keys(AT) as (keyof typeof AT)[]) {
      const op = await charge({ date: '2026-06-10', amount: 1 });
      await removeOp(op.id, { version: op.version });
      ids[key] = op.id;
    }
    const record = await licence('2026-06-11', 2);
    const op = await settle({
      date: '2026-06-11',
      parts: [{ expenseId: record.id, part: 'renewal' }],
    });
    await removeOp(op.id, { version: op.version });
    settled = op.id;
    // The delete's instant, moved to the case's: both the base field and the deletion carry it.
    const move = (id: string, at: Date) =>
      FleetCustodyOperationModel.collection.updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { deletedAt: at, 'deletion.at': at } },
      );
    for (const key of Object.keys(AT) as (keyof typeof AT)[]) await move(ids[key], AT[key]);
    await move(settled, new Date('2026-02-11T10:00:00.000Z'));
  });

  it('a delete at 23:30 in Cairo is that day’s; one at 00:30 is the next day’s', async () => {
    expect(await deletedIds('&from=2026-02-10&to=2026-02-10')).toEqual([ids.winterLate]);
    expect(await deletedIds('&from=2026-02-11&to=2026-02-11')).toEqual([settled, ids.winterAfter]);
    expect(await deletedIds('&from=2026-07-10&to=2026-07-10')).toEqual([ids.summerLate]);
    expect(await deletedIds('&from=2026-07-11&to=2026-07-11')).toEqual([ids.summerAfter]);
    // An open side is open: up to 10/02 in Cairo, nothing of 11/02.
    expect(await deletedIds('&to=2026-02-10')).toEqual([ids.winterLate]);
  });

  it('newest delete first by default; `deletedAt:asc` turns it round; `kind` picks', async () => {
    const range = '&from=2026-02-10&to=2026-02-11';
    expect(await deletedIds(range)).toEqual([settled, ids.winterAfter, ids.winterLate]);
    expect(await deletedIds(`${range}&sort=deletedAt:asc`)).toEqual([
      ids.winterLate,
      ids.winterAfter,
      settled,
    ]);
    expect(await deletedIds(`${range}&kind=settle`)).toEqual([settled]);
    expect(await deletedIds(`${range}&kind=charge,replenish`)).toEqual([
      ids.winterAfter,
      ids.winterLate,
    ]);
  });

  it('pages, and says how many', async () => {
    const res = await get(reader, '/deleted?from=2026-02-10&to=2026-07-11&pageSize=2&page=2');
    expect(res.status).toBe(200);
    // Newest first: the two summer deletes, then the settlement of 11/02, then 10/02's.
    expect(data<FleetCustodyOperationDto[]>(res).map((op) => op.id)).toEqual([
      settled,
      ids.winterAfter,
    ]);
    expect((res.body as { meta: unknown }).meta).toEqual({
      page: 2,
      pageSize: 2,
      totalItems: 5,
      totalPages: 3,
    });
  });
});
