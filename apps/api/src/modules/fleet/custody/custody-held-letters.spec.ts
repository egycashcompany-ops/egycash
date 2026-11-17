// «استعاضة معلّقة» on the fund's figures (`/fleet/custody/fund/summary` → `held.letters`): each
// replenishment still waiting for its transfer, the OLDEST letter first, with the memos it holds —
// each memo as «المذكرات» lists it (`status=held`, live receipts and total), `no` ascending.
//
// The letters ARE `held`, cut per letter: as many as `held.count`, Σ amount = `held.amount`,
// Σ receipts = `held.receipts`, Σ memos = `held.memos`. A transferred, a cancelled or a deleted
// replenishment is not one of them, and neither is a deleted memo. Read against a real store (an
// in-memory Mongo); `heldLettersOf` — the grouping — is also pinned on its own.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FleetCustodyMemoRowDto } from '@ecms/contracts';
import { FleetReceiptModel } from '../receipts/receipt.model';
import { fleetCustodyFundService, heldLettersOf } from './custody-fund.service';
import { FleetCustodyMemoModel } from './custody-memo.model';
import { FleetCustodyOperationModel } from './custody-operation.model';

const day = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
const oid = (): Types.ObjectId => new Types.ObjectId();
const AT = day('2026-11-01');

const memoRow = (over: Partial<FleetCustodyMemoRowDto>): FleetCustodyMemoRowDto => ({
  id: String(oid()),
  no: 1,
  kind: 'fuel',
  name: '',
  date: '2026-10-01',
  from: '2026-10-01',
  to: '2026-10-31',
  receipts: 0,
  total: 0,
  replenishment: null,
  version: 0,
  createdAt: AT.toISOString(),
  updatedAt: AT.toISOString(),
  ...over,
});

describe('heldLettersOf — the grouping', () => {
  const a = { _id: oid(), date: day('2026-09-20'), from: null, to: null, amount: 100.1 };
  const b = {
    _id: oid(),
    date: day('2026-10-05'),
    from: day('2026-09-01'),
    to: day('2026-09-30'),
    amount: 0.3,
  };
  const held = (op: { _id: Types.ObjectId }) => ({
    id: String(op._id),
    date: '2026-10-05',
    held: true,
  });

  it('keeps the letters’ order, gives each its own memos by `no`, sums their live receipts', () => {
    const letters = heldLettersOf(
      [a, b],
      [
        memoRow({ no: 9, receipts: 2, total: 0.1, replenishment: held(b) }),
        memoRow({ no: 4, receipts: 3, total: 100.1, replenishment: held(a) }),
        memoRow({ no: 2, receipts: 1, total: 0.2, replenishment: held(b) }),
        // A memo no held letter names (a stale read) is nobody's.
        memoRow({ no: 5, receipts: 7, total: 9, replenishment: held({ _id: oid() }) }),
      ],
    );
    expect(letters.map((letter) => letter.id)).toEqual([String(a._id), String(b._id)]);
    expect(letters[0]).toMatchObject({
      date: '2026-09-20',
      from: null,
      to: null,
      amount: 100.1,
      receipts: 3,
    });
    expect(letters[1]).toMatchObject({ from: '2026-09-01', to: '2026-09-30', receipts: 3 });
    expect(letters[1]?.memos.map((memo) => memo.no)).toEqual([2, 9]);
    // Only the fields the held card prints — no period, status or version.
    expect(Object.keys(letters[1]?.memos[0] ?? {}).sort()).toEqual(
      ['date', 'id', 'kind', 'name', 'no', 'receipts', 'total'].sort(),
    );
  });

  it('a letter whose memos are gone still stands, with none', () => {
    expect(heldLettersOf([a], [])).toEqual([
      {
        id: String(a._id),
        date: '2026-09-20',
        from: null,
        to: null,
        amount: 100.1,
        receipts: 0,
        memos: [],
      },
    ]);
  });
});

describe('`held.letters` over a real store', () => {
  let server: MongoMemoryServer;
  const vehicleId = oid();

  // Three held letters: B (the oldest day), A, and A2 (same day as A, recorded after it).
  const opA = oid();
  const opA2 = oid();
  const opB = oid();
  const opDone = oid();
  const opCancelled = oid();
  const opDeleted = oid();

  const memo = (
    no: number,
    over: {
      replenishmentId?: Types.ObjectId | null;
      held?: boolean | undefined;
      isDeleted?: boolean;
      name?: string;
    } = {},
  ) => ({
    _id: oid(),
    no,
    kind: no % 2 === 0 ? 'fuel' : 'maintenance',
    name: over.name ?? '',
    date: day('2026-10-02'),
    from: day('2026-10-01'),
    to: day('2026-10-31'),
    lines: [],
    signatures: { blocks: [], note: '' },
    replenishmentId: over.replenishmentId ?? null,
    replenishedAt: over.replenishmentId == null ? null : day('2026-10-05'),
    ...(over.held === undefined ? {} : { replenishmentHeld: over.held }),
    lockSeq: 0,
    isDeleted: over.isDeleted ?? false,
    deletedAt: null,
    createdAt: AT,
    updatedAt: AT,
    __v: 0,
  });
  const m1 = memo(1, { replenishmentId: opA, held: true, name: 'وقود أكتوبر' });
  const m2 = memo(2, { replenishmentId: opB, held: true });
  const m3 = memo(3, { replenishmentId: opA, held: true });
  const m4 = memo(4, { replenishmentId: opA2, held: true });
  const pending = memo(5);
  const replenished = memo(6, { replenishmentId: opDone, held: false });
  // From before the hold: no `replenishmentHeld` at all — replenished, never held.
  const legacy = memo(7, { replenishmentId: opDone });

  const receipt = (memoId: Types.ObjectId | null, amount: number, over = {}) => ({
    _id: oid(),
    vehicleId,
    date: day('2026-10-03'),
    kind: 'fuel',
    source: 'custody',
    amount,
    memoId,
    isDeleted: false,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  });

  const snap = (doc: ReturnType<typeof memo>, receipts: number, amount: number) => ({
    memoId: doc._id,
    no: doc.no,
    kind: doc.kind,
    name: doc.name,
    from: doc.from,
    to: doc.to,
    receipts,
    amount,
  });

  const operation = (
    _id: Types.ObjectId,
    over: Record<string, unknown> & { date: Date; amount: number },
  ) => ({
    _id,
    kind: 'replenish',
    from: day('2026-10-01'),
    to: day('2026-10-31'),
    reason: '',
    memos: [],
    parts: [],
    fundBefore: 0,
    chargedTotal: 0,
    letterFigure: 0,
    signatures: { blocks: [], note: '' },
    isDeleted: false,
    deletedAt: null,
    createdAt: AT,
    updatedAt: AT,
    __v: 0,
    ...over,
  });

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri('ecms-custody-held-letters'));
    await FleetCustodyMemoModel.collection.insertMany([
      m1,
      m2,
      m3,
      m4,
      pending,
      replenished,
      legacy,
    ]);
    await FleetReceiptModel.collection.insertMany([
      receipt(m1._id, 100.1),
      receipt(m1._id, 0.2, { kind: 'maintenance' }),
      receipt(m3._id, 50),
      receipt(m2._id, 0.1),
      receipt(m2._id, 0.2),
      receipt(m2._id, 1000, { isDeleted: true }),
      receipt(m4._id, 75.5),
      receipt(pending._id, 12),
      receipt(replenished._id, 30),
      receipt(null, 9),
      // A card receipt is never a custody memo's.
      receipt(m1._id, 400, { source: 'card' }),
    ]);
    await FleetCustodyOperationModel.collection.insertMany([
      operation(opA, {
        date: day('2026-10-05'),
        createdAt: day('2026-10-05'),
        amount: 150.3,
        status: 'held',
        memos: [snap(m1, 2, 100.3), snap(m3, 1, 50)],
      }),
      operation(opA2, {
        date: day('2026-10-05'),
        createdAt: day('2026-10-06'),
        from: null,
        to: null,
        amount: 75.5,
        status: 'held',
        memos: [snap(m4, 1, 75.5)],
      }),
      operation(opB, {
        date: day('2026-09-20'),
        amount: 0.3,
        status: 'held',
        memos: [snap(m2, 2, 0.3)],
      }),
      operation(opDone, {
        date: day('2026-09-01'),
        amount: 30,
        status: 'done',
        memos: [snap(replenished, 1, 30), snap(legacy, 0, 0)],
      }),
      operation(opCancelled, { date: day('2026-08-01'), amount: 44, status: 'cancelled' }),
      operation(opDeleted, {
        date: day('2026-08-02'),
        amount: 55,
        status: 'held',
        isDeleted: true,
        deletedAt: AT,
      }),
      operation(oid(), {
        kind: 'charge',
        date: day('2026-08-01'),
        from: null,
        to: null,
        amount: 5000,
        letterFigure: null,
      }),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server.stop();
  });

  it('lists every held letter, the oldest first — a transferred, cancelled or deleted one is not', async () => {
    const { held } = await fleetCustodyFundService.summary();
    expect(held.letters.map((letter) => letter.id)).toEqual([
      String(opB),
      String(opA),
      String(opA2),
    ]);
    expect(held.letters.map((letter) => letter.date)).toEqual([
      '2026-09-20',
      '2026-10-05',
      '2026-10-05',
    ]);
    expect(held.letters[1]).toMatchObject({ from: '2026-10-01', to: '2026-10-31', amount: 150.3 });
    expect(held.letters[2]).toMatchObject({ from: null, to: null });
  });

  it('each letter carries its own memos, `no` ascending, as «المذكرات» lists them (live)', async () => {
    const { held } = await fleetCustodyFundService.summary();
    const [b, a, a2] = held.letters;
    expect(a?.memos).toEqual([
      {
        id: String(m1._id),
        no: 1,
        kind: 'maintenance',
        name: 'وقود أكتوبر',
        date: '2026-10-02',
        receipts: 2,
        total: 100.3,
      },
      {
        id: String(m3._id),
        no: 3,
        kind: 'maintenance',
        name: '',
        date: '2026-10-02',
        receipts: 1,
        total: 50,
      },
    ]);
    expect(a?.receipts).toBe(3);
    // The deleted receipt is in no memo's figures.
    expect(b?.memos).toEqual([expect.objectContaining({ no: 2, receipts: 2, total: 0.3 })]);
    expect(a2?.memos.map((memo) => memo.no)).toEqual([4]);
  });

  it('the letters ARE `held`, cut per letter — count, amount, receipts and memos tie', async () => {
    const { held } = await fleetCustodyFundService.summary();
    const piastres = (n: number): number => Math.round(n * 100);
    expect(held.letters).toHaveLength(held.count);
    expect(held.count).toBe(3);
    expect(held.letters.reduce((sum, letter) => sum + piastres(letter.amount), 0)).toBe(
      piastres(held.amount),
    );
    expect(held.letters.reduce((sum, letter) => sum + letter.receipts, 0)).toBe(held.receipts);
    expect(held.letters.reduce((sum, letter) => sum + letter.memos.length, 0)).toBe(held.memos);
    // Each letter's receipts are its memos' receipts.
    for (const letter of held.letters) {
      expect(letter.receipts).toBe(letter.memos.reduce((sum, memo) => sum + memo.receipts, 0));
    }
  });

  it('a deleted memo is not listed', async () => {
    const gone = memo(8, { replenishmentId: opA2, held: true, isDeleted: true });
    await FleetCustodyMemoModel.collection.insertOne(gone);
    try {
      const { held } = await fleetCustodyFundService.summary();
      expect(held.letters[2]?.memos.map((row) => row.id)).toEqual([String(m4._id)]);
    } finally {
      await FleetCustodyMemoModel.collection.deleteOne({ _id: gone._id });
    }
  });

  it('none held → no letters', async () => {
    await FleetCustodyOperationModel.collection.updateMany(
      { status: 'held' },
      { $set: { status: 'cancelled' } },
    );
    try {
      const { held } = await fleetCustodyFundService.summary();
      expect(held.count).toBe(0);
      expect(held.letters).toEqual([]);
    } finally {
      await FleetCustodyOperationModel.collection.updateMany(
        { _id: { $in: [opA, opA2, opB] } },
        { $set: { status: 'held' } },
      );
    }
  });
});
