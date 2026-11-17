// «تحويل إلى فرع» as the transfer service decides it — «لو مثلاً فى 10 ماوس .. فممكن أنقل 5 لفرع تاني».
//
// With the data layer mocked (the issue spec's posture), what is pinned is the decision: every line
// leaves its store and reaches the other in ONE transaction under ONE transfer id — the source
// item's take guarded as an issue's is, the receiving store's item of the same name added to or
// made there (its code reserved inside the transaction), and a pair of movements naming each other;
// a retired source may still send its stock; the refusals come before any write; and the audit rows
// — both stores', and the made item's — follow the commit.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { stockEffect } from './consumable-stock';

const mocks = vi.hoisted(() => ({
  unitOfWork: vi.fn(),
  audit: vi.fn(),
  signal: vi.fn(),
  reserve: vi.fn(),
  findBranch: vi.fn(),
  itemsByIds: vi.fn(),
  byBranchAndName: vi.fn(),
  moveStock: vi.fn(),
  createItem: vi.fn(),
  createMovement: vi.fn(),
}));

const ready = () => vi.fn(async () => undefined);

vi.mock('../../../platform/kernel/unit-of-work', () => ({ unitOfWork: mocks.unitOfWork }));
vi.mock('../../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
vi.mock('../../../platform/realtime', () => ({ publishAuditedChange: mocks.signal }));
vi.mock('../../../platform/organization', () => ({
  branchRepository: { findById: mocks.findBranch },
}));
vi.mock('../shared/sequence', () => ({ reserveSequenceBlock: mocks.reserve }));
vi.mock('./consumable.repository', () => ({
  itConsumableRepository: {
    findManyByIds: mocks.itemsByIds,
    findByBranchAndName: mocks.byBranchAndName,
    moveStock: mocks.moveStock,
    create: mocks.createItem,
    ensureCollection: ready(),
  },
}));
vi.mock('./consumable-movement.repository', () => ({
  itConsumableMovementRepository: { create: mocks.createMovement, ensureCollection: ready() },
}));
vi.mock('./consumable-memo.repository', () => ({
  itConsumableMemoRepository: { ensureCollection: ready() },
}));

const { itConsumableTransferService } = await import('./consumable-transfer.service');

// Spelled with letters, so an upper-case copy of either is a different string for the same id.
const OCTOBER = new Types.ObjectId('6563a1b2c3d4e5f6a7b8c9e1');
const TANTA = new Types.ObjectId('6563a1b2c3d4e5f6a7b8c9e2');
const MICE = new Types.ObjectId();
const MOUSE = new Types.ObjectId();
const CABLE = new Types.ObjectId();
const TANTA_MOUSE = new Types.ObjectId();
const AT = new Date('2026-11-11T09:00:00.000Z');
/** The one transaction — so «inside it» is an assertion, not a hope. */
const SESSION = { transaction: 'the transfer' };

const ctx = {
  userId: String(new Types.ObjectId()),
  locale: 'ar',
  branchId: String(OCTOBER),
  permissions: { 'itAsset.assign': 'organization' },
} as never;
const scope = { scope: 'organization' } as never;

const item = (_id: Types.ObjectId, over: Record<string, unknown> = {}) => ({
  _id,
  code: _id === MOUSE ? 'CON-00003' : _id === CABLE ? 'CON-00004' : 'CON-00041',
  name: _id === CABLE ? 'كابل HDMI 3 متر' : 'Mouse',
  typeId: MICE,
  unit: 'قطعة',
  branchId: _id === TANTA_MOUSE ? TANTA : OCTOBER,
  minQty: 3,
  notes: 'رف 2',
  active: true,
  onHandQty: 10,
  issuedQty: 4,
  scrappedQty: 1,
  ...over,
});

/** The part of a scope selector a store's rows are read by. */
type Scope = { scope: string; branchId?: string | null; branchIds?: readonly string[] };

/** Whether a scope lets its caller see a row — no scope, as the repository reads it, is no limit. */
const sees = (given: Scope | undefined, row: { branchId: Types.ObjectId }): boolean =>
  given === undefined ||
  given.scope === 'organization' ||
  (given.branchIds ?? [given.branchId]).includes(String(row.branchId));

/** The rows as stored, by id — moveStock answers each as it now stands. */
let rows: Map<string, ReturnType<typeof item>>;
let committed = false;
const auditedWhileCommitted: boolean[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  auditedWhileCommitted.length = 0;
  rows = new Map([
    [String(MOUSE), item(MOUSE)],
    [String(CABLE), item(CABLE)],
    [String(TANTA_MOUSE), item(TANTA_MOUSE, { onHandQty: 2, code: 'CON-00041' })],
  ]);
  mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) => {
    const result = await fn(SESSION);
    committed = true;
    return result;
  });
  mocks.audit.mockImplementation(async () => {
    auditedWhileCommitted.push(committed);
  });
  mocks.findBranch.mockResolvedValue({ _id: TANTA, status: 'active' });
  // As the repository reads them: only the rows the scope it is handed lets the caller see.
  mocks.itemsByIds.mockImplementation(async (ids: string[], given?: Scope) =>
    ids.flatMap((id) => {
      const row = rows.get(id);
      return row !== undefined && sees(given, row) ? [row] : [];
    }),
  );
  // Tanta's store holds a Mouse, and no cable yet.
  mocks.byBranchAndName.mockImplementation(async (branchId: Types.ObjectId, name: string) =>
    String(branchId) === String(TANTA) && name === 'Mouse' ? rows.get(String(TANTA_MOUSE)) : null,
  );
  mocks.moveStock.mockImplementation(
    async (id: string, effect: { onHand: number; issued: number; scrapped: number }) => {
      const row = rows.get(id);
      if (row === undefined) throw new NotFoundError('consumable not found');
      if (row.onHandQty + effect.onHand < 0) {
        throw new BusinessRuleError(`item ${row.code} has ${String(row.onHandQty)} on hand`);
      }
      const next = {
        ...row,
        onHandQty: row.onHandQty + effect.onHand,
        issuedQty: row.issuedQty + effect.issued,
        scrappedQty: row.scrappedQty + effect.scrapped,
      };
      rows.set(id, next);
      return next;
    },
  );
  mocks.reserve.mockResolvedValue(90);
  mocks.createItem.mockImplementation(async (data: Record<string, unknown>) => {
    const made = { ...data, _id: new Types.ObjectId() } as ReturnType<typeof item>;
    rows.set(String(made._id), made);
    return made;
  });
  mocks.createMovement.mockImplementation(async (data: Record<string, unknown>) => ({
    ...data,
    _id: new Types.ObjectId(),
  }));
});

const transfer = (
  lines: { consumableId: string; qty: number }[],
  over: Record<string, unknown> = {},
) =>
  itConsumableTransferService.transfer(
    { toBranchId: String(TANTA), at: AT, notes: 'لفرع طنطا', lines, ...over } as never,
    ctx,
    scope,
  );

describe('ten mice, five of them to another branch', () => {
  it('takes five off this shelf and puts five on the other store’s Mouse — on hand alone moving', async () => {
    const result = await transfer([{ consumableId: String(MOUSE), qty: 5 }]);

    expect(mocks.unitOfWork).toHaveBeenCalledTimes(1);
    expect(mocks.moveStock).toHaveBeenNthCalledWith(
      1,
      String(MOUSE),
      stockEffect('transferredOut', 5),
      // Under the caller's scope, and with no `activeFor`: a retired item may still send its stock.
      { session: SESSION, by: (ctx as { userId: string }).userId, scope },
    );
    expect(mocks.moveStock).toHaveBeenNthCalledWith(
      2,
      String(TANTA_MOUSE),
      stockEffect('transferredIn', 5),
      { session: SESSION, by: (ctx as { userId: string }).userId, activeFor: 'receive' },
    );
    expect(rows.get(String(MOUSE))).toMatchObject({ onHandQty: 5, issuedQty: 4, scrappedQty: 1 });
    expect(rows.get(String(TANTA_MOUSE))).toMatchObject({ onHandQty: 7 });
    expect(mocks.byBranchAndName).toHaveBeenCalledWith(TANTA, 'Mouse', undefined, SESSION);
    expect(mocks.createItem).not.toHaveBeenCalled();

    expect(result).toMatchObject({
      fromBranchId: String(OCTOBER),
      toBranchId: String(TANTA),
      at: AT.toISOString(),
      lines: [
        {
          fromConsumableId: String(MOUSE),
          fromCode: 'CON-00003',
          toConsumableId: String(TANTA_MOUSE),
          toCode: 'CON-00041',
          name: 'Mouse',
          unit: 'قطعة',
          qty: 5,
          created: false,
        },
      ],
    });
  });

  it('writes the pair of movements, one in each store, sharing one transfer id and naming each other', async () => {
    const result = await transfer([{ consumableId: String(MOUSE), qty: 5 }]);

    const [[out], [into]] = mocks.createMovement.mock.calls as [
      [Record<string, unknown>],
      [Record<string, unknown>],
    ];
    expect(out).toMatchObject({
      consumableId: MOUSE,
      kind: 'transferredOut',
      qty: 5,
      at: AT,
      branchId: OCTOBER,
      counterpartBranchId: TANTA,
      counterpartConsumableId: TANTA_MOUSE,
      notes: 'لفرع طنطا',
      employeeId: null,
      memoId: null,
    });
    expect(into).toMatchObject({
      consumableId: TANTA_MOUSE,
      kind: 'transferredIn',
      qty: 5,
      branchId: TANTA,
      counterpartBranchId: OCTOBER,
      counterpartConsumableId: MOUSE,
    });
    expect(String(out.transferId)).toBe(result.transferId);
    expect(String(into.transferId)).toBe(result.transferId);
  });

  it('makes the item in the other store when it has none — same name, type and unit, a new code, nothing else carried', async () => {
    const result = await transfer([{ consumableId: String(CABLE), qty: 2 }]);

    expect(mocks.reserve).toHaveBeenCalledWith('consumable:global', 1, SESSION);
    expect(mocks.createItem).toHaveBeenCalledWith(
      {
        code: 'CON-00090',
        name: 'كابل HDMI 3 متر',
        typeId: MICE,
        unit: 'قطعة',
        branchId: TANTA,
        minQty: null,
        notes: null,
        active: true,
        onHandQty: 0,
        issuedQty: 0,
        scrappedQty: 0,
      },
      expect.objectContaining({ session: SESSION }),
    );
    expect(result.lines[0]).toMatchObject({ toCode: 'CON-00090', qty: 2, created: true });
  });

  it('carries several items under ONE transfer id, in one transaction', async () => {
    await transfer([
      { consumableId: String(MOUSE), qty: 5 },
      { consumableId: String(CABLE), qty: 1 },
    ]);
    expect(mocks.unitOfWork).toHaveBeenCalledTimes(1);
    const ids = mocks.createMovement.mock.calls.map(([row]) =>
      String((row as { transferId: Types.ObjectId }).transferId),
    );
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(1);
  });

  it('an upper-case target is the store it names — read, written and answered as its id', async () => {
    const result = await transfer([{ consumableId: String(MOUSE), qty: 5 }], {
      toBranchId: String(TANTA).toUpperCase(),
    });

    expect(mocks.findBranch).toHaveBeenCalledWith(String(TANTA));
    expect(result.toBranchId).toBe(String(TANTA));
    // Tanta's Mouse received them: the store was found by its id, not by its spelling.
    expect(result.lines[0]).toMatchObject({ toConsumableId: String(TANTA_MOUSE), created: false });
  });

  it('lets a retired item send what is left of it', async () => {
    rows.set(String(MOUSE), item(MOUSE, { active: false }));
    await expect(transfer([{ consumableId: String(MOUSE), qty: 10 }])).resolves.toBeDefined();
    expect(rows.get(String(MOUSE))?.onHandQty).toBe(0);
  });

  it('audits after the commit: the item it left, the item made, the item it reached — each store signalled', async () => {
    await transfer([
      { consumableId: String(MOUSE), qty: 5 },
      { consumableId: String(CABLE), qty: 2 },
    ]);

    expect(auditedWhileCommitted.every(Boolean)).toBe(true);
    const audits = mocks.audit.mock.calls.map(
      ([entry]) =>
        entry as {
          entityRef: { entityId: string };
          action: string;
          changes: { field: string; old: unknown; new: unknown }[];
        },
    );
    expect(audits.map((entry) => entry.action)).toEqual([
      'transfer',
      'transfer',
      'transfer',
      'create',
      'transfer',
    ]);
    expect(audits[0]).toMatchObject({
      entityRef: { entityId: String(MOUSE) },
      changes: expect.arrayContaining([
        { field: 'onHandQty', old: 10, new: 5 },
        { field: 'toBranchId', old: null, new: String(TANTA) },
      ]),
    });
    expect(audits[1]).toMatchObject({
      entityRef: { entityId: String(TANTA_MOUSE) },
      changes: expect.arrayContaining([
        { field: 'onHandQty', old: 2, new: 7 },
        { field: 'fromBranchId', old: null, new: String(OCTOBER) },
        { field: 'fromConsumableId', old: null, new: String(MOUSE) },
      ]),
    });
    // The made item: registered, then its first units — from nothing.
    expect(audits[4]?.changes).toEqual(
      expect.arrayContaining([{ field: 'onHandQty', old: 0, new: 2 }]),
    );
    // Both stores' screens told to read again.
    const signalled = mocks.signal.mock.calls.map(
      ([change]) => (change as { branchId?: string }).branchId,
    );
    expect(signalled).toEqual(expect.arrayContaining([String(OCTOBER), String(TANTA)]));
  });
});

describe('a refused transfer writes nothing', () => {
  const nothingWritten = () => {
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.signal).not.toHaveBeenCalled();
  };

  it('a branch the caller’s itAsset.assign does not reach — before anything is read', async () => {
    const keeper = { ...(ctx as object), permissions: { 'itAsset.assign': 'branch' } } as never;
    const attempt = itConsumableTransferService.transfer(
      { toBranchId: String(TANTA), lines: [{ consumableId: String(MOUSE), qty: 1 }] } as never,
      keeper,
      scope,
    );
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.itemsByIds).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('an item the caller cannot see — there, but outside the scope they act in', async () => {
    // The command bar narrowed to Tanta: October's Mouse is there, and not theirs to read.
    const narrowed = { scope: 'branch', branchId: String(TANTA) } as never;
    const attempt = itConsumableTransferService.transfer(
      {
        toBranchId: String(TANTA),
        lines: [{ consumableId: String(MOUSE), qty: 1 }],
      } as never,
      ctx,
      narrowed,
    );

    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
    // Read under the caller's scope — the one the route handed in.
    expect(mocks.itemsByIds).toHaveBeenCalledWith([String(MOUSE)], narrowed);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
    expect(mocks.moveStock).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('an item that is nowhere at all', async () => {
    await expect(
      transfer([{ consumableId: String(new Types.ObjectId()), qty: 1 }]),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });

  it('an upper-case copy of the store the items are in is that store — refused, nothing written', async () => {
    await expect(
      transfer([{ consumableId: String(MOUSE), qty: 1 }], {
        toBranchId: String(OCTOBER).toUpperCase(),
      }),
    ).rejects.toThrow(/already in that branch/);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
    expect(mocks.moveStock).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('items of two stores, and a transfer to the store they are in', async () => {
    await expect(
      transfer([
        { consumableId: String(MOUSE), qty: 1 },
        { consumableId: String(TANTA_MOUSE), qty: 1 },
      ]),
    ).rejects.toThrow(/leave one store/);
    await expect(
      transfer([{ consumableId: String(MOUSE), qty: 1 }], { toBranchId: String(OCTOBER) }),
    ).rejects.toThrow(/already in that branch/);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });

  it('a branch that is not there, or no longer active', async () => {
    mocks.findBranch.mockResolvedValueOnce(null);
    await expect(transfer([{ consumableId: String(MOUSE), qty: 1 }])).rejects.toBeInstanceOf(
      ValidationError,
    );
    mocks.findBranch.mockResolvedValueOnce({ _id: TANTA, status: 'inactive' });
    await expect(transfer([{ consumableId: String(MOUSE), qty: 1 }])).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });

  it('a receiving item that counts in another unit, or is retired — inside the transaction', async () => {
    rows.set(String(TANTA_MOUSE), item(TANTA_MOUSE, { unit: 'علبة' }));
    await expect(transfer([{ consumableId: String(MOUSE), qty: 1 }])).rejects.toThrow(/«علبة»/);
    rows.set(String(TANTA_MOUSE), item(TANTA_MOUSE, { active: false }));
    await expect(transfer([{ consumableId: String(MOUSE), qty: 1 }])).rejects.toThrow(/inactive/);
    expect(mocks.createMovement).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('more than the shelf holds', async () => {
    await expect(transfer([{ consumableId: String(MOUSE), qty: 11 }])).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(mocks.createMovement).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('a name added to the other store a moment ago is a conflict, not a second row', async () => {
    mocks.createItem.mockRejectedValueOnce(Object.assign(new Error('E11000'), { code: 11000 }));
    await expect(transfer([{ consumableId: String(CABLE), qty: 1 }])).rejects.toBeInstanceOf(
      ConflictError,
    );
    nothingWritten();
  });
});
