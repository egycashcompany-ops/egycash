// «استعاضة معلّقة لحين التحويل» against a real mongo — what the scenario suite does not walk:
//
//   1. rows from before the hold (no `status`, no `transfer`, no `replenishmentHeld`) read as they
//      always did — transferred on their letter's day — and no read, and no write elsewhere, ever
//      changes them;
//   2. «إلغاء الاستعاضة المعلّقة»: a status, never a delete — the letter stays as a row that counts
//      nothing, its memos are free again (editable, offered, replenished anew), the fund never
//      moves; and it moves once;
//   3. its audit trail.
//
// The races of the two moves are in `fleet-custody-hold-races.spec.ts`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  ListFleetCustodyLedgerQuerySchema,
  ListFleetCustodyMemosQuerySchema,
  UpdateFleetCustodyMemoSchema,
  type FleetCustodyOperationDto,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { FleetReceiptModel } from '../../src/modules/fleet/receipts/receipt.model';
import { fleetReceiptService } from '../../src/modules/fleet/receipts/receipt.service';
import { FleetCustodyMemoModel } from '../../src/modules/fleet/custody/custody-memo.model';
import { FleetCustodyOperationModel } from '../../src/modules/fleet/custody/custody-operation.model';
import { fleetCustodyMemoService } from '../../src/modules/fleet/custody/custody-memo.service';
import { fleetCustodyFundService } from '../../src/modules/fleet/custody/custody-fund.service';
import {
  ACTOR,
  bootCustody,
  cancel,
  confirm,
  data,
  day,
  editReceipt,
  fundNow,
  heldOne,
  replenish,
  stopCustody,
  tokenWith,
} from './helpers/custody-hold-fixture';

let app: Express;
let writerToken: string;

beforeAll(async () => {
  app = await bootCustody();
  writerToken = await tokenWith(['fleetCustody.view', 'fleetReceipt.create']);
}, 120_000);

afterAll(stopCustody);

const ledger = async () =>
  (await fleetCustodyFundService.ledger(ListFleetCustodyLedgerQuerySchema.parse({ pageSize: 100 })))
    .items;
const memosWith = async (status: 'pending' | 'held' | 'replenished') =>
  (
    await fleetCustodyMemoService.list(ListFleetCustodyMemosQuerySchema.parse({ status }))
  ).items.map((row) => row.id);

describe('no migration — rows from before the hold', () => {
  const ids = {
    op: new Types.ObjectId(),
    taken: new Types.ObjectId(),
    pending: new Types.ObjectId(),
    r1: new Types.ObjectId(),
    r2: new Types.ObjectId(),
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
  const receipt = (_id: Types.ObjectId, iso: string, amount: number, memoId: Types.ObjectId) => ({
    _id,
    date: day(iso),
    vehicleId: new Types.ObjectId(),
    driverEmployeeId: null,
    driverName: 'سائق',
    kind: 'wash',
    source: 'custody',
    cardId: null,
    fuelType: null,
    pricePerLitre: null,
    litres: null,
    amount,
    image: null,
    memoId,
    ...base(day(iso)),
  });
  const memoRow = (
    _id: Types.ObjectId,
    no: number,
    receiptId: Types.ObjectId,
    replenished: boolean,
  ) => ({
    _id,
    no,
    kind: 'wash',
    name: '',
    date: day('2025-06-05'),
    from: day('2025-06-02'),
    to: day('2025-06-03'),
    lines: [{ receiptId, mission: '', statement: '', note: '' }],
    signatures: { blocks: [], note: '' },
    replenishmentId: replenished ? ids.op : null,
    replenishedAt: replenished ? day('2025-06-10') : null,
    lockSeq: 0,
    ...base(day('2025-06-05')),
  });
  /** Every legacy document as it is stored, read raw. */
  const raw = async () => ({
    op: await FleetCustodyOperationModel.collection.findOne({ _id: ids.op }),
    taken: await FleetCustodyMemoModel.collection.findOne({ _id: ids.taken }),
    pending: await FleetCustodyMemoModel.collection.findOne({ _id: ids.pending }),
    r1: await FleetReceiptModel.collection.findOne({ _id: ids.r1 }),
    r2: await FleetReceiptModel.collection.findOne({ _id: ids.r2 }),
  });
  let stored: Awaited<ReturnType<typeof raw>>;

  beforeAll(async () => {
    await FleetReceiptModel.collection.insertMany([
      receipt(ids.r1, '2025-06-02', 120, ids.taken),
      receipt(ids.r2, '2025-06-03', 80, ids.pending),
    ]);
    await FleetCustodyMemoModel.collection.insertMany([
      memoRow(ids.taken, 900, ids.r1, true),
      memoRow(ids.pending, 901, ids.r2, false),
    ]);
    await FleetCustodyOperationModel.collection.insertOne({
      _id: ids.op,
      kind: 'replenish',
      date: day('2025-06-10'),
      from: day('2025-06-01'),
      to: day('2025-06-30'),
      amount: 120,
      reason: '',
      memos: [
        {
          memoId: ids.taken,
          no: 900,
          kind: 'wash',
          name: '',
          from: day('2025-06-02'),
          to: day('2025-06-02'),
          receipts: 1,
          amount: 120,
        },
      ],
      parts: [],
      fundBefore: -200,
      chargedTotal: 0,
      letterFigure: 0,
      signatures: { blocks: [], note: '' },
      ...base(new Date('2025-06-10T08:00:00.000Z')),
    });
    stored = await raw();
  });

  it('reads a replenishment with no status as transferred on its letter’s day', async () => {
    expect(await fleetCustodyFundService.summary()).toMatchObject({
      fundTotal: -80,
      replenished: { count: 1, amount: 120, memos: 1 },
      held: { count: 0, amount: 0, memos: 0, receipts: 0 },
      cancelled: { count: 0, amount: 0 },
      operations: 1,
      memos: { count: 2, pending: 1, pendingTotal: 80 },
    });
    expect(
      (await ledger()).map((row) => [row.op, row.status, row.date, row.letterDate, row.after]),
    ).toEqual([
      ['replenish', 'done', '2025-06-10', null, -80],
      ['spend', 'done', '2025-06-02', null, -200],
    ]);
    expect(await fleetCustodyFundService.operation(String(ids.op))).toMatchObject({
      status: 'done',
      transfer: null,
      cancellation: null,
      ledger: { before: -200, after: -80 },
    });
  });

  it('its memo is replenished on the letter’s day — the list, the status filter, the receipt’s link', async () => {
    expect((await fleetCustodyMemoService.get(String(ids.taken))).replenishment).toEqual({
      id: String(ids.op),
      date: '2025-06-10',
      held: false,
    });
    expect(await memosWith('replenished')).toEqual([String(ids.taken)]);
    expect(await memosWith('held')).toEqual([]);
    expect(await memosWith('pending')).toEqual([String(ids.pending)]);
    expect((await fleetReceiptService.get(String(ids.r1))).memo).toEqual({
      id: String(ids.taken),
      no: 900,
      replenishedAt: '2025-06-10',
      held: false,
    });
    expect((await fleetReceiptService.get(String(ids.r2))).memo).toMatchObject({ held: false });
  });

  it('no read wrote a thing', async () => {
    expect(await raw()).toEqual(stored);
  });

  it('a write elsewhere leaves them as stored: a pending memo edited gains no new field', async () => {
    await fleetCustodyMemoService.update(
      String(ids.pending),
      UpdateFleetCustodyMemoSchema.parse({
        kind: 'wash',
        name: 'غسيل يونيو',
        lines: [{ receiptId: String(ids.r2) }],
        version: 0,
      }),
      ACTOR,
    );
    const after = await raw();
    expect(after.pending).toMatchObject({ name: 'غسيل يونيو', replenishmentId: null });
    expect(after.pending).not.toHaveProperty('replenishmentHeld');
    // Another replenishment held and transferred: the legacy one and its memo are untouched.
    const fresh = await heldOne('2025-07-01', 40, 'wash');
    await confirm(fresh.op.id, { date: '2025-07-02' });
    const last = await raw();
    expect(last.op).toEqual(stored.op);
    expect(last.taken).toEqual(stored.taken);
    expect(last.r1).toEqual(stored.r1);
    expect(last.op).not.toHaveProperty('status');
    expect(last.taken).not.toHaveProperty('replenishmentHeld');
  });
});

describe('«إلغاء الاستعاضة المعلّقة»', () => {
  const post = (id: string, verb: 'transfer' | 'cancel', body: Record<string, unknown>) =>
    request(app)
      .post(`/api/v1/fleet/custody/fund/operations/${id}/${verb}`)
      .set('Authorization', `Bearer ${writerToken}`)
      .send(body);
  let held: Awaited<ReturnType<typeof heldOne>>;

  it('frees the memos and keeps the letter as a row that counts nothing — the fund never moves', async () => {
    held = await heldOne('2026-08-10', 500);
    const fund = await fundNow();
    const before = await FleetCustodyOperationModel.findById(held.op.id).lean().exec();

    const res = await post(held.op.id, 'cancel', { reason: 'خطاب مكرر' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const op = data<FleetCustodyOperationDto>(res);
    expect(op).toMatchObject({
      status: 'cancelled',
      transfer: null,
      date: '2026-08-10',
      amount: 500,
    });
    // A row on its letter's day that adds nothing (that day's receipt comes after it).
    expect(op.ledger?.after).toBe(op.ledger?.before);
    expect(op.cancellation).toMatchObject({ reason: 'خطاب مكرر', byName: 'م م' });
    expect(await fundNow()).toBe(fund);
    expect(await fleetCustodyFundService.summary()).toMatchObject({
      held: { count: 0, amount: 0 },
      cancelled: { count: 1, amount: 500 },
    });
    expect((await ledger()).find((row) => row.id === held.op.id)).toMatchObject({
      status: 'cancelled',
      date: '2026-08-10',
      amount: 500,
      before: op.ledger?.before,
      after: op.ledger?.before,
    });
    // A status, never a delete: the row and everything its letter printed stay.
    const after = await FleetCustodyOperationModel.findById(held.op.id).lean().exec();
    expect(after).toMatchObject({
      isDeleted: false,
      status: 'cancelled',
      amount: before?.amount,
      fundBefore: before?.fundBefore,
      chargedTotal: before?.chargedTotal,
      letterFigure: before?.letterFigure,
    });
    expect(after?.memos).toEqual(before?.memos);
    expect(after?.signatures).toEqual(before?.signatures);
  });

  it('its memo is pending again: editable, its receipts unlocked, offered and replenished anew', async () => {
    const row = await fleetCustodyMemoService.get(held.memoId);
    expect(row.replenishment).toBeNull();
    expect((await fleetReceiptService.get(held.receiptId)).memo).toMatchObject({
      replenishedAt: null,
      held: false,
    });
    const amount = await editReceipt(held.receiptId, { amount: 650 });
    expect(amount.doc.amount).toBe(650);
    const edited = await fleetCustodyMemoService.update(
      held.memoId,
      UpdateFleetCustodyMemoSchema.parse({
        kind: 'tyres',
        name: 'كاوتش أغسطس',
        lines: [{ receiptId: held.receiptId }],
        version: row.version,
      }),
      ACTOR,
    );
    expect(edited).toMatchObject({ name: 'كاوتش أغسطس', total: 650 });
    expect(await memosWith('pending')).toContain(held.memoId);
    expect(
      (await fleetCustodyFundService.replenishCandidates()).memos.map((one) => one.id),
    ).toContain(held.memoId);
    const again = await replenish({ date: '2026-08-12', memoIds: [held.memoId] });
    expect(again).toMatchObject({ status: 'held', amount: 650 });
    expect((await fleetCustodyMemoService.get(held.memoId)).replenishment).toEqual({
      id: again.id,
      date: '2026-08-12',
      held: true,
    });
  });

  it('moves once: a second cancel, or a confirm after it, is 409 and changes nothing', async () => {
    const fund = await fundNow();
    expect((await post(held.op.id, 'cancel', {})).status).toBe(409);
    expect((await post(held.op.id, 'transfer', { date: '2026-08-20' })).status).toBe(409);
    await expect(cancel(held.op.id)).rejects.toMatchObject({ httpStatus: 409 });
    expect((await fleetCustodyFundService.operation(held.op.id)).status).toBe('cancelled');
    expect(await fundNow()).toBe(fund);
  });

  it('is audited: the operation’s status change, and each memo’s', async () => {
    const operation = await AuditLogModel.find({
      'entityRef.entityType': 'custodyOperation',
      'entityRef.entityId': held.op.id,
      action: 'statusChange',
    })
      .lean()
      .exec();
    expect(operation).toHaveLength(1);
    expect(operation[0]?.changes[0]).toEqual({ field: 'status', old: 'held', new: 'cancelled' });
    expect(operation[0]?.changes[1]).toMatchObject({
      field: 'cancellation',
      old: null,
      new: { reason: 'خطاب مكرر', byName: 'م م' },
    });
    const memo = await AuditLogModel.find({
      'entityRef.entityType': 'custodyMemo',
      'entityRef.entityId': held.memoId,
      action: 'statusChange',
    })
      .sort({ _id: 1 })
      .lean()
      .exec();
    // Held, freed, held again.
    expect(memo.map((one) => one.changes)).toEqual([
      [
        { field: 'replenishmentId', old: null, new: held.op.id },
        { field: 'replenishedAt', old: null, new: '2026-08-10' },
        { field: 'replenishmentHeld', old: false, new: true },
      ],
      [
        { field: 'replenishmentId', old: held.op.id, new: null },
        { field: 'replenishedAt', old: '2026-08-10', new: null },
        { field: 'replenishmentHeld', old: true, new: false },
      ],
      expect.any(Array),
    ]);
  });
});
