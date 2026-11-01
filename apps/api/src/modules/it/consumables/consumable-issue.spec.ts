// «صرف لموظف» — «وأتبدل لمين واطبعله مذكره … أقدر أذكر الجهاز اللى أتركب عليه من اللأصول» — as the
// one issue action decides it.
//
// With the data layer mocked (the custody specs' posture), what is pinned is the decision: one
// action writes every line's movement, every item's counters and ONE memo in one transaction,
// the memo's number reserved INSIDE it; a replacement counts the damaged unit as scrap; a leaver,
// an unseen or retired item, more than a store holds, two stores on one memo, and an unseen or
// disposed asset are refused before anything is written; and nothing is audited until the
// transaction has committed. The transaction itself is the platform's.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DirectoryEmployee } from '../../../platform/directory';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  readReceiptHolder: vi.fn(),
  unitOfWork: vi.fn(),
  audit: vi.fn(),
  reserve: vi.fn(),
  typesByIds: vi.fn(),
  assetsByIds: vi.fn(),
  itemsByIds: vi.fn(),
  moveStock: vi.fn(),
  createMovement: vi.fn(),
  createMemo: vi.fn(),
}));

const ready = () => vi.fn(async () => undefined);

vi.mock('../assets/receipt-holder', () => ({ readReceiptHolder: mocks.readReceiptHolder }));
vi.mock('../../../platform/kernel/unit-of-work', () => ({ unitOfWork: mocks.unitOfWork }));
vi.mock('../../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
vi.mock('../shared/sequence', () => ({ reserveSequenceBlock: mocks.reserve }));
vi.mock('../catalog-items/catalog-item.repository', () => ({
  itCatalogItemRepository: { findByIdsSystem: mocks.typesByIds },
}));
vi.mock('../assets/asset.repository', () => ({
  itAssetRepository: { findManyByIds: mocks.assetsByIds },
}));
vi.mock('./consumable.repository', () => ({
  itConsumableRepository: {
    findManyByIds: mocks.itemsByIds,
    moveStock: mocks.moveStock,
    ensureCollection: ready(),
  },
}));
vi.mock('./consumable-movement.repository', () => ({
  itConsumableMovementRepository: { create: mocks.createMovement, ensureCollection: ready() },
}));
vi.mock('./consumable-memo.repository', () => ({
  itConsumableMemoRepository: { create: mocks.createMemo, ensureCollection: ready() },
}));

const { itConsumableIssueService } = await import('./consumable-issue.service');

const STORE = new Types.ObjectId();
const INK = new Types.ObjectId();
const MOUSE = new Types.ObjectId();
const INKS = new Types.ObjectId();
const MICE = new Types.ObjectId();
const ASSET = new Types.ObjectId();
const EMPLOYEE = String(new Types.ObjectId());
const ISSUED_AT = new Date('2026-10-28T09:00:00.000Z');
/** The one transaction — so «inside it» is an assertion, not a hope. */
const SESSION = { transaction: 'the issue' };

const ctx = {
  userId: String(new Types.ObjectId()),
  locale: 'en',
  identity: { displayName: { ar: 'أحمد سمير', en: 'Ahmed Samir' } },
} as never;
const scope = { scope: 'branch', userId: 'u', branchId: String(STORE) } as never;

const item = (_id: Types.ObjectId, over: Record<string, unknown> = {}) => ({
  _id,
  code: _id === INK ? 'CON-00001' : 'CON-00002',
  name: _id === INK ? 'حبر HP 85A' : 'Mouse',
  typeId: _id === INK ? INKS : MICE,
  unit: 'قطعة',
  branchId: STORE,
  minQty: null,
  active: true,
  onHandQty: 5,
  issuedQty: 0,
  scrappedQty: 0,
  ...over,
});

const person = (status: DirectoryEmployee['status']): DirectoryEmployee => ({
  employeeId: EMPLOYEE,
  code: '0101002',
  fullNameAr: 'وليد صفوت جلال',
  status,
  branchId: String(STORE),
  departmentId: null,
  phone: null,
  governorate: null,
  hiredAt: null,
  address: null,
});

const holderFor = (status: DirectoryEmployee['status']) => ({
  employee: person(status),
  employeeCode: '0101002',
  employeeName: 'وليد صفوت جلال',
  jobTitle: { ar: 'محاسب', en: 'Accountant' },
  // HR has one — and this paper does not print it.
  nationalId: '29801011234567',
  section: null,
  department: null,
});

/** An ink for a new need, and a mouse in place of a broken one, installed on an asset. */
const input = () => ({
  employeeId: EMPLOYEE,
  issuedAt: ISSUED_AT,
  notes: 'للمكتب الأمامي',
  lines: [
    { consumableId: String(INK), qty: 2, reason: 'new' as const },
    {
      consumableId: String(MOUSE),
      qty: 1,
      reason: 'replacement' as const,
      assetId: String(ASSET),
    },
  ],
});

/** Whether the transaction had committed when each audit row was written. */
let committed = false;
const auditedWhileCommitted: boolean[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  auditedWhileCommitted.length = 0;
  mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) => {
    const result = await fn(SESSION);
    committed = true;
    return result;
  });
  mocks.audit.mockImplementation(async () => {
    auditedWhileCommitted.push(committed);
  });
  mocks.readReceiptHolder.mockResolvedValue(holderFor('active'));
  mocks.reserve.mockResolvedValue(41);
  mocks.itemsByIds.mockResolvedValue([item(INK), item(MOUSE)]);
  mocks.assetsByIds.mockResolvedValue([
    { _id: ASSET, assetCode: 'AST-00031', name: 'Lenovo ThinkCentre', status: 'assigned' },
  ]);
  mocks.typesByIds.mockResolvedValue([
    { _id: INKS, name: { ar: 'حبارات', en: 'Ink & toner' } },
    { _id: MICE, name: { ar: 'ماوس', en: 'Mice' } },
  ]);
  // The guarded write answers the row as it now stands: the effect applied to five on hand.
  mocks.moveStock.mockImplementation(
    async (id: string, effect: { onHand: number; issued: number; scrapped: number }) => ({
      ...item(id === String(INK) ? INK : MOUSE),
      onHandQty: 5 + effect.onHand,
      issuedQty: effect.issued,
      scrappedQty: effect.scrapped,
    }),
  );
  mocks.createMovement.mockImplementation(async (data: Record<string, unknown>) => ({
    ...data,
    _id: new Types.ObjectId(),
  }));
  mocks.createMemo.mockImplementation(async (data: Record<string, unknown>) => data);
});

describe('one issue, one memo', () => {
  it('moves every line and writes ONE memo in one transaction, its number reserved inside it', async () => {
    const { memo, consumables } = await itConsumableIssueService.issue(input(), ctx, scope);

    expect(mocks.unitOfWork).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledWith('consumableMemo:global', 1, SESSION);
    expect(mocks.moveStock).toHaveBeenCalledTimes(2);
    for (const [, , options] of mocks.moveStock.mock.calls as [
      string,
      unknown,
      Record<string, unknown>,
    ][]) {
      expect(options).toMatchObject({ session: SESSION, scope, activeFor: 'issue' });
    }
    expect(mocks.createMemo).toHaveBeenCalledTimes(1);
    expect(mocks.createMemo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ session: SESSION }),
    );

    // Every movement names the person, the memo, and — for the mouse — the asset it went on.
    const movements = (await Promise.all(
      mocks.createMovement.mock.results.map((result) => result.value as Promise<unknown>),
    )) as Record<string, unknown>[];
    expect(movements).toHaveLength(2);
    for (const row of movements) {
      expect(row).toMatchObject({
        kind: 'issued',
        at: ISSUED_AT,
        branchId: STORE,
        employeeId: new Types.ObjectId(EMPLOYEE),
        memoId: memo._id,
      });
    }
    expect(movements[0]).toMatchObject({ qty: 2, reason: 'new', assetId: null });
    expect(movements[1]).toMatchObject({ qty: 1, reason: 'replacement', assetId: ASSET });

    expect(memo).toMatchObject({
      memoNumber: 41,
      issuedAt: ISSUED_AT,
      employeeId: new Types.ObjectId(EMPLOYEE),
      employeeCode: '0101002',
      employeeName: 'وليد صفوت جلال',
      jobTitle: { ar: 'محاسب', en: 'Accountant' },
      // The paper is Arabic: the issuer's Arabic name, whatever language the screen is in.
      issuedByName: 'أحمد سمير',
      branchId: STORE,
      notes: 'للمكتب الأمامي',
      signedCopy: null,
    });
    // «بطاقة رقم قومي» is the custody form's line, not this paper's.
    expect(memo).not.toHaveProperty('nationalId');
    // The table, as it was that day — each row the movement it is.
    expect(memo.lines).toEqual([
      expect.objectContaining({
        consumableId: INK,
        movementId: movements[0]?._id,
        code: 'CON-00001',
        name: 'حبر HP 85A',
        typeName: { ar: 'حبارات', en: 'Ink & toner' },
        unit: 'قطعة',
        qty: 2,
        reason: 'new',
        assetId: null,
        assetCode: null,
        assetName: null,
      }),
      expect.objectContaining({
        consumableId: MOUSE,
        qty: 1,
        reason: 'replacement',
        typeName: { ar: 'ماوس', en: 'Mice' },
        assetId: ASSET,
        assetCode: 'AST-00031',
        assetName: 'Lenovo ThinkCentre',
      }),
    ]);
    expect(consumables.map((doc) => doc.onHandQty)).toEqual([3, 4]);
  });

  it('counts the damaged unit a replacement takes back as scrap — the shelf gives the new one only', async () => {
    await itConsumableIssueService.issue(input(), ctx, scope);
    const effects = mocks.moveStock.mock.calls.map(
      ([, effect]) => effect as Record<string, number>,
    );
    expect(effects).toEqual([
      { onHand: -2, issued: 2, scrapped: 0 },
      { onHand: -1, issued: 1, scrapped: 1 },
    ]);
  });

  it('audits each item and the memo — only once the transaction has committed', async () => {
    await itConsumableIssueService.issue(input(), ctx, scope);

    const rows = mocks.audit.mock.calls.map(
      ([entry]) =>
        entry as {
          entityRef: { entityType: string };
          action: string;
          changes: { field: string; old: unknown; new: unknown }[];
        },
    );
    expect(rows.map((row) => [row.entityRef.entityType, row.action])).toEqual([
      ['consumable', 'assign'],
      ['consumable', 'assign'],
      ['consumableMemo', 'create'],
    ]);
    expect(auditedWhileCommitted).toEqual([true, true, true]);
    // The mouse's row: five on hand became four, one issued, and the broken one is scrap.
    expect(rows[1]?.changes).toEqual(
      expect.arrayContaining([
        { field: 'onHandQty', old: 5, new: 4 },
        { field: 'issuedQty', old: 0, new: 1 },
        { field: 'scrappedQty', old: 0, new: 1 },
        { field: 'reason', old: null, new: 'replacement' },
        { field: 'assetId', old: null, new: String(ASSET) },
        { field: 'memoNumber', old: null, new: 41 },
      ]),
    );
  });

  it('writes no memo and audits nothing when the guarded write refuses inside the transaction', async () => {
    // The early check saw enough; somebody issued the last mouse a moment before this write.
    mocks.moveStock.mockImplementation(async (id: string) => {
      if (id === String(MOUSE)) {
        throw new BusinessRuleError('item CON-00002 has 0 on hand and cannot give 1');
      }
      return item(INK, { onHandQty: 3 });
    });

    await expect(itConsumableIssueService.issue(input(), ctx, scope)).rejects.toThrow(
      /has 0 on hand/,
    );
    expect(mocks.createMemo).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('what an issue refuses — before anything is written', () => {
  const nothingWritten = () => {
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.moveStock).not.toHaveBeenCalled();
    expect(mocks.createMemo).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  };

  it('a leaver — «اللى موجود بس» — before even the items are read', async () => {
    mocks.readReceiptHolder.mockResolvedValue(holderFor('exited'));
    const attempt = itConsumableIssueService.issue(input(), ctx, scope);
    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow(/0101002 has left/);
    expect(mocks.itemsByIds).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('an item the caller cannot see', async () => {
    mocks.itemsByIds.mockResolvedValue([item(INK)]);
    await expect(itConsumableIssueService.issue(input(), ctx, scope)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mocks.itemsByIds).toHaveBeenCalledWith([String(INK), String(MOUSE)], scope);
    nothingWritten();
  });

  it('a retired item', async () => {
    mocks.itemsByIds.mockResolvedValue([item(INK), item(MOUSE, { active: false })]);
    await expect(itConsumableIssueService.issue(input(), ctx, scope)).rejects.toThrow(
      'item CON-00002 is inactive and cannot be issued',
    );
    nothingWritten();
  });

  it('more than its store holds', async () => {
    mocks.itemsByIds.mockResolvedValue([item(INK, { onHandQty: 1 }), item(MOUSE)]);
    await expect(itConsumableIssueService.issue(input(), ctx, scope)).rejects.toThrow(
      'item CON-00001 has 1 on hand and cannot give 2',
    );
    nothingWritten();
  });

  it('items from two stores — a memo is one store’s paper', async () => {
    mocks.itemsByIds.mockResolvedValue([
      item(INK),
      item(MOUSE, { branchId: new Types.ObjectId() }),
    ]);
    await expect(itConsumableIssueService.issue(input(), ctx, scope)).rejects.toThrow(
      /one store's items/,
    );
    nothingWritten();
  });

  it('an asset the caller cannot see', async () => {
    mocks.assetsByIds.mockResolvedValue([]);
    await expect(itConsumableIssueService.issue(input(), ctx, scope)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mocks.assetsByIds).toHaveBeenCalledWith([String(ASSET)], scope);
    nothingWritten();
  });

  it('an asset that is disposed — nothing is installed on a device written off', async () => {
    mocks.assetsByIds.mockResolvedValue([
      { _id: ASSET, assetCode: 'AST-00031', name: 'Lenovo ThinkCentre', status: 'disposed' },
    ]);
    await expect(itConsumableIssueService.issue(input(), ctx, scope)).rejects.toThrow(
      'asset AST-00031 is disposed; nothing can be installed on it',
    );
    nothingWritten();
  });

  it('asks the assets nothing when no line names one', async () => {
    await itConsumableIssueService.issue(
      { employeeId: EMPLOYEE, lines: [{ consumableId: String(INK), qty: 1, reason: 'new' }] },
      ctx,
      scope,
    );
    expect(mocks.assetsByIds).not.toHaveBeenCalled();
  });
});
