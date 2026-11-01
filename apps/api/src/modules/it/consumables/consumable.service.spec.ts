// The consumables store's own rules — «أقدر أحدد عندي Stock إيه من كل واحده وإيه الهالك».
//
// With the data layer mocked (the mobile lines' posture), what is pinned is what the service
// decides: an item is stocked only in a branch the caller reaches, of an active consumable type,
// under a name its store does not have yet; its code — and its opening quantity, as a delivery —
// are written in ONE transaction; every later quantity moves through a movement and the guarded
// stock write, inside the transaction, audited only after it commits; and the register and the
// ledger filter as the screens ask. The transaction itself is the platform's.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  unitOfWork: vi.fn(),
  audit: vi.fn(),
  reserve: vi.fn(),
  findActiveOfKind: vi.fn(),
  findItem: vi.fn(),
  findByBranchAndName: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  moveStock: vi.fn(),
  listItems: vi.fn(),
  idsMatching: vi.fn(),
  itemsByIds: vi.fn(),
  createMovement: vi.fn(),
  listMovements: vi.fn(),
  memosByIds: vi.fn(),
  assetsByIds: vi.fn(),
  employees: vi.fn(),
}));

const ready = () => vi.fn(async () => undefined);

vi.mock('../../../platform/kernel/unit-of-work', () => ({ unitOfWork: mocks.unitOfWork }));
vi.mock('../../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
vi.mock('../../../platform/directory', () => ({ getDirectoryEmployees: mocks.employees }));
vi.mock('../shared/sequence', () => ({ reserveSequenceBlock: mocks.reserve }));
vi.mock('../catalog-items/catalog-item.repository', () => ({
  itCatalogItemRepository: { findActiveOfKind: mocks.findActiveOfKind },
}));
vi.mock('../assets/asset.repository', () => ({
  itAssetRepository: { findManyByIds: mocks.assetsByIds },
}));
vi.mock('./consumable.repository', () => ({
  CONSUMABLE_TYPE_NAME_SORT: {
    key: 'typeName',
    from: 'it_catalog_items',
    localField: 'typeId',
    pick: 'name.ar',
  },
  itConsumableRepository: {
    findById: mocks.findItem,
    findByBranchAndName: mocks.findByBranchAndName,
    create: mocks.createItem,
    updateById: mocks.updateItem,
    moveStock: mocks.moveStock,
    list: mocks.listItems,
    idsMatching: mocks.idsMatching,
    findByIdsSystem: mocks.itemsByIds,
    ensureCollection: ready(),
  },
}));
vi.mock('./consumable-movement.repository', () => ({
  itConsumableMovementRepository: {
    create: mocks.createMovement,
    list: mocks.listMovements,
    ensureCollection: ready(),
  },
}));
vi.mock('./consumable-memo.repository', () => ({
  itConsumableMemoRepository: { findByIdsSystem: mocks.memosByIds, ensureCollection: ready() },
}));

const { itConsumableService } = await import('./consumable.service');

const ITEM = String(new Types.ObjectId());
const TYPE = String(new Types.ObjectId());
const HOME = String(new Types.ObjectId());
const ELSEWHERE = String(new Types.ObjectId());
const EMPLOYEE = String(new Types.ObjectId());
/** The one transaction every write runs in — so «inside it» is an assertion, not a hope. */
const SESSION = { transaction: 'consumables' };

/** Holds `itAsset.*` over ONE branch — the home one. */
const ctx = {
  userId: String(new Types.ObjectId()),
  locale: 'ar',
  branchId: HOME,
  departmentId: null,
  sectionId: null,
  permissions: { 'itAsset.create': 'branch', 'itAsset.edit': 'branch' },
  identity: { displayName: { ar: 'فني', en: 'Technician' } },
} as never;
const scope = { scope: 'branch', userId: 'u', branchId: HOME } as never;

const item = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(ITEM),
  code: 'CON-00012',
  name: 'حبر HP 85A',
  typeId: new Types.ObjectId(TYPE),
  unit: 'قطعة',
  branchId: new Types.ObjectId(HOME),
  minQty: 2,
  notes: null,
  active: true,
  onHandQty: 5,
  issuedQty: 3,
  scrappedQty: 1,
  isDeleted: false,
  __v: 4,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) =>
    fn(SESSION),
  );
  mocks.reserve.mockResolvedValue(12);
  mocks.findActiveOfKind.mockResolvedValue({ _id: new Types.ObjectId(TYPE) });
  mocks.findByBranchAndName.mockResolvedValue(null);
  mocks.createItem.mockImplementation(async (data: Record<string, unknown>) => ({
    ...data,
    _id: new Types.ObjectId(ITEM),
    __v: 0,
  }));
  mocks.createMovement.mockImplementation(async (data: Record<string, unknown>) => ({
    ...data,
    _id: new Types.ObjectId(),
  }));
  mocks.listItems.mockResolvedValue({ items: [], meta: {} });
  mocks.listMovements.mockResolvedValue({ items: [], meta: {} });
  mocks.idsMatching.mockResolvedValue([]);
  mocks.employees.mockResolvedValue(new Map());
});

const audited = (action: string) =>
  mocks.audit.mock.calls
    .map(
      ([entry]) =>
        entry as { action: string; changes: { field: string; old: unknown; new: unknown }[] },
    )
    .filter((entry) => entry.action === action);

describe('adding an item to a store', () => {
  const input = { name: 'حبر HP 85A', typeId: TYPE, unit: 'قطعة', branchId: HOME };

  it('files it under a code reserved INSIDE the transaction, with nothing on hand', async () => {
    const doc = await itConsumableService.create(input, ctx);

    expect(mocks.reserve).toHaveBeenCalledWith('consumable:global', 1, SESSION);
    expect(mocks.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CON-00012', onHandQty: 0, issuedQty: 0, scrappedQty: 0 }),
      expect.objectContaining({ session: SESSION }),
    );
    expect(doc).toMatchObject({ active: true, minQty: null, notes: null });
    // No opening quantity, no movement — and nothing pretends one happened.
    expect(mocks.createMovement).not.toHaveBeenCalled();
    expect(audited('create')).toHaveLength(1);
    expect(audited('receive')).toHaveLength(0);
  });

  it('writes an opening quantity as a DELIVERY in the same transaction — never as a bare number', async () => {
    const doc = await itConsumableService.create({ ...input, openingQty: 23 }, ctx);

    expect(doc).toMatchObject({ onHandQty: 23, issuedQty: 0, scrappedQty: 0 });
    expect(mocks.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'received', qty: 23, employeeId: null, memoId: null }),
      expect.objectContaining({ session: SESSION }),
    );
    const [receipt] = audited('receive');
    expect(receipt?.changes).toContainEqual({ field: 'onHandQty', old: 0, new: 23 });
  });

  it('audits nothing when the transaction refuses — a rolled-back add left no trace', async () => {
    mocks.createItem.mockRejectedValueOnce(new ConflictError('Duplicate resource'));
    await expect(
      itConsumableService.create({ ...input, openingQty: 3 }, ctx),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('refuses a branch the caller’s itAsset.create does not reach — nothing is written', async () => {
    await expect(
      itConsumableService.create({ ...input, branchId: ELSEWHERE }, ctx),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });

  it('refuses a type that is not an active consumable type', async () => {
    mocks.findActiveOfKind.mockResolvedValue(null);
    await expect(itConsumableService.create(input, ctx)).rejects.toThrow(/active consumable type/);
    expect(mocks.findActiveOfKind).toHaveBeenCalledWith(TYPE, 'consumableType');
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });

  it('refuses a name its store already has — one stock per item per branch', async () => {
    mocks.findByBranchAndName.mockResolvedValue(item());
    await expect(itConsumableService.create(input, ctx)).rejects.toBeInstanceOf(ConflictError);
    expect(mocks.findByBranchAndName).toHaveBeenCalledWith(new Types.ObjectId(HOME), input.name);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });
});

describe('editing an item', () => {
  beforeEach(() => {
    mocks.findItem.mockResolvedValue(item());
    mocks.updateItem.mockImplementation(async (_id: string, set: Record<string, unknown>) => ({
      ...item(),
      ...set,
      __v: 5,
    }));
  });

  it('writes the facts given, under the caller’s version — never a quantity or the branch', async () => {
    await itConsumableService.update(ITEM, { minQty: 4, notes: 'رف 3', version: 4 }, ctx, scope);
    expect(mocks.updateItem).toHaveBeenCalledWith(
      ITEM,
      { minQty: 4, notes: 'رف 3' },
      expect.objectContaining({ version: 4, scope }),
    );
    const [update] = audited('update');
    expect(update?.changes.map((c) => c.field)).toEqual(['minQty', 'notes']);
  });

  it('checks a NEW type, and only a new one', async () => {
    const other = String(new Types.ObjectId());
    await itConsumableService.update(ITEM, { typeId: TYPE, version: 4 }, ctx, scope);
    expect(mocks.findActiveOfKind).not.toHaveBeenCalled();

    mocks.findActiveOfKind.mockResolvedValue(null);
    await expect(
      itConsumableService.update(ITEM, { typeId: other, version: 4 }, ctx, scope),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('refuses a name another item of the same store holds — read first, the index behind it', async () => {
    mocks.findByBranchAndName.mockResolvedValue(item({ _id: new Types.ObjectId() }));
    await expect(
      itConsumableService.update(ITEM, { name: 'Mouse', version: 4 }, ctx, scope),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mocks.updateItem).not.toHaveBeenCalled();

    // Two renames racing past the read: the unique index's refusal is a 409 too, not a 500.
    mocks.findByBranchAndName.mockResolvedValue(null);
    mocks.updateItem.mockRejectedValueOnce(Object.assign(new Error('E11000'), { code: 11000 }));
    await expect(
      itConsumableService.update(ITEM, { name: 'Mouse', version: 4 }, ctx, scope),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('retires an item, and records only what changed', async () => {
    await itConsumableService.update(ITEM, { active: false, version: 4 }, ctx, scope);
    const [update] = audited('update');
    expect(update?.changes).toEqual([{ field: 'active', old: true, new: false }]);
  });
});

describe('stock in and out', () => {
  const after = (over: Record<string, unknown>) => item(over);

  it('receives: one delivery and the counter it moves, in one transaction, audited after it', async () => {
    mocks.moveStock.mockResolvedValue(after({ onHandQty: 9 }));
    const at = new Date('2026-10-20T09:00:00.000Z');

    const doc = await itConsumableService.receive(
      ITEM,
      { qty: 4, at, notes: 'فاتورة 77' },
      ctx,
      scope,
    );

    expect(mocks.moveStock).toHaveBeenCalledWith(
      ITEM,
      { onHand: 4, issued: 0, scrapped: 0 },
      expect.objectContaining({ session: SESSION, scope, activeFor: 'receive' }),
    );
    expect(mocks.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'received', qty: 4, at, notes: 'فاتورة 77', reason: null }),
      expect.objectContaining({ session: SESSION }),
    );
    // The level before is derived from the write's own answer — true even if another delivery
    // landed a moment earlier.
    const [receipt] = audited('receive');
    expect(receipt?.changes).toContainEqual({ field: 'onHandQty', old: 5, new: 9 });
    expect(doc.onHandQty).toBe(9);
  });

  it('writes no movement and no audit when the guarded write refuses', async () => {
    mocks.moveStock.mockRejectedValue(new BusinessRuleError('item CON-00012 is inactive'));
    await expect(itConsumableService.receive(ITEM, { qty: 4 }, ctx, scope)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(mocks.createMovement).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('scraps: off the shelf into the scrap count, why being the record — and a retired item may be', async () => {
    mocks.moveStock.mockResolvedValue(after({ onHandQty: 3, scrappedQty: 3 }));

    await itConsumableService.scrap(ITEM, { qty: 2, reason: 'كسر أثناء النقل' }, ctx, scope);

    const [, effect, options] = mocks.moveStock.mock.calls[0] as [
      string,
      unknown,
      { activeFor?: string },
    ];
    expect(effect).toEqual({ onHand: -2, issued: 0, scrapped: 2 });
    expect(options.activeFor).toBeUndefined();
    expect(mocks.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'scrapped', qty: 2, reason: 'كسر أثناء النقل' }),
      expect.anything(),
    );
    const [writeOff] = audited('dispose');
    expect(writeOff?.changes).toEqual(
      expect.arrayContaining([
        { field: 'onHandQty', old: 5, new: 3 },
        { field: 'scrappedQty', old: 1, new: 3 },
        { field: 'reason', old: null, new: 'كسر أثناء النقل' },
      ]),
    );
  });

  it('takes a return back on the shelf from the person named — and does not un-issue it', async () => {
    mocks.moveStock.mockResolvedValue(after({ onHandQty: 6 }));

    await itConsumableService.returnStock(ITEM, { qty: 1, employeeId: EMPLOYEE }, ctx, scope);

    expect(mocks.moveStock).toHaveBeenCalledWith(
      ITEM,
      { onHand: 1, issued: 0, scrapped: 0 },
      expect.objectContaining({ activeFor: undefined }),
    );
    expect(mocks.createMovement).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'returned', employeeId: new Types.ObjectId(EMPLOYEE) }),
      expect.anything(),
    );
    const [back] = audited('return');
    expect(back?.changes.map((c) => c.field)).toEqual(['onHandQty', 'movementId', 'employeeId']);
  });
});

describe('the register’s filters', () => {
  const params = () => (mocks.listItems.mock.calls.at(-1) as [Record<string, unknown>])[0];
  const page = { page: 1, pageSize: 25, sortDir: 'desc' as const };

  it('reads in the order items were added, unless a column is asked for — the type by its name', async () => {
    await itConsumableService.list(page, scope);
    expect(params()).toMatchObject({ sorts: [{ by: 'code', dir: 'asc' }], scope });

    await itConsumableService.list({ ...page, sortBy: 'typeName', sortDir: 'asc' }, scope);
    expect(params()).not.toHaveProperty('sorts');
    expect(params().sortableFields).toContain('typeName');
    expect(params().sortDerived).toEqual([
      expect.objectContaining({ key: 'typeName', pick: 'name.ar' }),
    ]);
  });

  it('narrows by type, store, active and the reorder hint — an item with no minimum is never «below»', async () => {
    await itConsumableService.list(
      { ...page, typeId: TYPE, branchId: HOME, active: true, belowMin: true },
      scope,
    );
    expect(params().filter).toEqual({
      $and: [
        { typeId: new Types.ObjectId(TYPE) },
        { branchId: new Types.ObjectId(HOME) },
        { active: true },
        { minQty: { $ne: null }, $expr: { $lte: ['$onHandQty', '$minQty'] } },
      ],
    });

    await itConsumableService.list({ ...page, belowMin: false }, scope);
    expect(params().filter).toEqual({
      $and: [{ $or: [{ minQty: null }, { $expr: { $gt: ['$onHandQty', '$minQty'] } }] }],
    });
  });

  it('finds a code typed in Arabic digits, and a name in whichever digits it was typed', async () => {
    await itConsumableService.list({ ...page, search: 'CON-٠٠٠١٢' }, scope);
    const [{ $or }] = (params().filter as { $and: { $or: Record<string, RegExp>[] }[] }).$and as [
      { $or: Record<string, RegExp>[] },
    ];
    expect($or.map((clause) => Object.keys(clause)[0])).toEqual(['code', 'name']);
    const [code] = $or.map((clause) => Object.values(clause)[0]) as [RegExp];
    expect(code.test('CON-00012')).toBe(true);
    // A name keeps the digits it was typed with: «٣» and "3" find each other, both ways.
    await itConsumableService.list({ ...page, search: 'HDMI 3' }, scope);
    const [{ $or: again }] = (params().filter as { $and: { $or: Record<string, RegExp>[] }[] })
      .$and as [{ $or: Record<string, RegExp>[] }];
    expect((Object.values(again[1] ?? {})[0] as RegExp).test('كابل HDMI ٣ متر')).toBe(true);
  });

  it('reads a box of spaces as no search at all', async () => {
    await itConsumableService.list({ ...page, search: '   ' }, scope);
    expect(params().filter).toEqual({});
  });

  it('answers 404 for an item the caller cannot see', async () => {
    mocks.findItem.mockResolvedValue(null);
    await expect(itConsumableService.get(ITEM, scope)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('the ledger', () => {
  const params = () => (mocks.listMovements.mock.calls.at(-1) as [Record<string, unknown>])[0];
  const page = { page: 1, pageSize: 25, sortDir: 'desc' as const };

  it('reads newest first, and a day is a whole CAIRO day — the day the ledger prints', async () => {
    await itConsumableService.listMovements(
      {
        ...page,
        kind: 'issued',
        employeeId: EMPLOYEE,
        from: new Date('2026-10-01T00:00:00.000Z'),
        to: new Date('2026-10-18T00:00:00.000Z'),
      },
      scope,
    );
    expect(params()).toMatchObject({ sortBy: 'at', sortDir: 'desc', scope });
    expect(params().filter).toEqual({
      $and: [
        { kind: 'issued' },
        { employeeId: new Types.ObjectId(EMPLOYEE) },
        // October 2026 is summer time in Cairo, UTC+3: its midnights are 21:00 UTC the day before.
        { at: { $gte: new Date('2026-09-30T21:00:00.000Z') } },
        { at: { $lt: new Date('2026-10-18T21:00:00.000Z') } },
      ],
    });
  });

  it('matches an item’s type or its code and name through the items the caller may see', async () => {
    const ids = [new Types.ObjectId()];
    mocks.idsMatching.mockResolvedValue(ids);
    const ASSET = String(new Types.ObjectId());

    await itConsumableService.listMovements(
      { ...page, typeId: TYPE, search: 'HDMI', assetId: ASSET },
      scope,
    );

    const [itemFilter, itemScope] = mocks.idsMatching.mock.calls[0] as [
      { $and: Record<string, unknown>[] },
      unknown,
    ];
    expect(itemScope).toBe(scope);
    expect(itemFilter.$and[0]).toEqual({ typeId: new Types.ObjectId(TYPE) });
    expect(params().filter).toEqual({
      $and: [{ assetId: new Types.ObjectId(ASSET) }, { consumableId: { $in: ids } }],
    });
  });

  it('lists one item’s movements only once the item itself is seen, under the same scope', async () => {
    mocks.findItem.mockResolvedValue(null);
    await expect(itConsumableService.itemMovements(ITEM, page, scope)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mocks.listMovements).not.toHaveBeenCalled();

    mocks.findItem.mockResolvedValue(item());
    await itConsumableService.itemMovements(ITEM, page, scope);
    expect(params().filter).toEqual({ $and: [{ consumableId: new Types.ObjectId(ITEM) }] });
  });

  it('labels a page in one read per kind — the assets under scope, a gone or deleted memo not at all', async () => {
    const ASSET = new Types.ObjectId();
    const MEMO = new Types.ObjectId();
    const GONE = new Types.ObjectId();
    const DELETED = new Types.ObjectId();
    const row = (memoId: Types.ObjectId | null) => ({
      _id: new Types.ObjectId(),
      consumableId: new Types.ObjectId(ITEM),
      employeeId: new Types.ObjectId(EMPLOYEE),
      assetId: ASSET,
      memoId,
    });
    mocks.itemsByIds.mockResolvedValue([item()]);
    mocks.assetsByIds.mockResolvedValue([
      { _id: ASSET, assetCode: 'AST-00009', name: 'Lenovo AIO' },
    ]);
    mocks.memosByIds.mockResolvedValue([
      { _id: MEMO, memoNumber: 7, signedCopy: { fileId: new Types.ObjectId() }, isDeleted: false },
      { _id: DELETED, memoNumber: 8, signedCopy: null, isDeleted: true },
    ]);
    mocks.employees.mockResolvedValue(
      new Map([[EMPLOYEE, { code: '0101002', fullNameAr: 'وليد صفوت جلال' }]]),
    );

    const labels = await itConsumableService.movementLabels(
      [row(MEMO), row(GONE), row(DELETED), row(null)] as never,
      scope,
    );

    expect(mocks.assetsByIds).toHaveBeenCalledWith([String(ASSET)], scope);
    expect(labels.items.get(ITEM)).toEqual({ code: 'CON-00012', name: 'حبر HP 85A', typeId: TYPE });
    expect(labels.assets.get(String(ASSET))).toEqual({
      assetCode: 'AST-00009',
      name: 'Lenovo AIO',
    });
    expect(labels.employees.get(EMPLOYEE)).toEqual({
      code: '0101002',
      fullNameAr: 'وليد صفوت جلال',
    });
    expect([...labels.memos.keys()]).toEqual([String(MEMO)]);
    expect(labels.memos.get(String(MEMO))).toEqual({ memoNumber: 7, signed: true });
  });
});
