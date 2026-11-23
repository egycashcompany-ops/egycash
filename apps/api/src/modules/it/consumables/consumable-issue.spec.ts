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
  counterTimeline: vi.fn(),
  createMemo: vi.fn(),
  departmentsByIds: vi.fn(),
  locationsByIds: vi.fn(),
}));

const ready = () => vi.fn(async () => undefined);

vi.mock('../assets/receipt-holder', () => ({ readReceiptHolder: mocks.readReceiptHolder }));
// «صرف لإدارة»: the department and its place, read through the asset hand-over's own seam.
vi.mock('../../../platform/organization', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  departmentRepository: { findByIdsSystem: mocks.departmentsByIds },
}));
vi.mock('../locations/location.repository', () => ({
  itLocationRepository: { findByIdsSystem: mocks.locationsByIds },
}));
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
  itConsumableMovementRepository: {
    create: mocks.createMovement,
    counterTimelineSystem: mocks.counterTimeline,
    ensureCollection: ready(),
  },
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
/**
 * The ASSET register's scope — the caller's own `itAsset.view` — deliberately not the store's, so
 * «the asset is read under the asset grant» is an assertion rather than a coincidence.
 */
const assetScope = { scope: 'organization', userId: 'u', branchId: null } as never;

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
  // The row as written — with the id the issue allocated for it.
  mocks.createMovement.mockImplementation(async (data: Record<string, unknown>) => ({
    _id: new Types.ObjectId(),
    ...data,
  }));
  mocks.counterTimeline.mockResolvedValue([]);
  mocks.createMemo.mockImplementation(async (data: Record<string, unknown>) => data);
});

describe('one issue, one memo', () => {
  it('moves every line and writes ONE memo in one transaction, its number reserved inside it', async () => {
    const { memo, consumables } = await itConsumableIssueService.issue(
      input(),
      ctx,
      scope,
      assetScope,
    );

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
    await itConsumableIssueService.issue(input(), ctx, scope, assetScope);
    const effects = mocks.moveStock.mock.calls.map(
      ([, effect]) => effect as Record<string, number>,
    );
    expect(effects).toEqual([
      { onHand: -2, issued: 2, scrapped: 0 },
      { onHand: -1, issued: 1, scrapped: 1 },
    ]);
  });

  it('audits each item and the memo — only once the transaction has committed', async () => {
    await itConsumableIssueService.issue(input(), ctx, scope, assetScope);

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

    await expect(itConsumableIssueService.issue(input(), ctx, scope, assetScope)).rejects.toThrow(
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
    const attempt = itConsumableIssueService.issue(input(), ctx, scope, assetScope);
    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow(/0101002 has left/);
    expect(mocks.itemsByIds).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('an item the caller cannot see', async () => {
    mocks.itemsByIds.mockResolvedValue([item(INK)]);
    await expect(
      itConsumableIssueService.issue(input(), ctx, scope, assetScope),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.itemsByIds).toHaveBeenCalledWith([String(INK), String(MOUSE)], scope);
    nothingWritten();
  });

  it('a retired item', async () => {
    mocks.itemsByIds.mockResolvedValue([item(INK), item(MOUSE, { active: false })]);
    await expect(itConsumableIssueService.issue(input(), ctx, scope, assetScope)).rejects.toThrow(
      'item CON-00002 is inactive and cannot be issued',
    );
    nothingWritten();
  });

  it('more than its store holds', async () => {
    mocks.itemsByIds.mockResolvedValue([item(INK, { onHandQty: 1 }), item(MOUSE)]);
    await expect(itConsumableIssueService.issue(input(), ctx, scope, assetScope)).rejects.toThrow(
      'item CON-00001 has 1 on hand and cannot give 2',
    );
    nothingWritten();
  });

  it('items from two stores — a memo is one store’s paper', async () => {
    mocks.itemsByIds.mockResolvedValue([
      item(INK),
      item(MOUSE, { branchId: new Types.ObjectId() }),
    ]);
    await expect(itConsumableIssueService.issue(input(), ctx, scope, assetScope)).rejects.toThrow(
      /one store's items/,
    );
    nothingWritten();
  });

  it('an asset the caller cannot see', async () => {
    mocks.assetsByIds.mockResolvedValue([]);
    await expect(
      itConsumableIssueService.issue(input(), ctx, scope, assetScope),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.assetsByIds).toHaveBeenCalledWith([String(ASSET)], assetScope);
    nothingWritten();
  });

  it('any asset at all, for a caller without the asset grant — the register is not even asked', async () => {
    // A store keeper given the consumables and not the assets (2026-11-17): the issue must not be
    // a way to learn which devices exist. The same refusal as an asset out of scope.
    await expect(itConsumableIssueService.issue(input(), ctx, scope, null)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mocks.assetsByIds).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('an asset that is disposed — nothing is installed on a device written off', async () => {
    mocks.assetsByIds.mockResolvedValue([
      { _id: ASSET, assetCode: 'AST-00031', name: 'Lenovo ThinkCentre', status: 'disposed' },
    ]);
    await expect(itConsumableIssueService.issue(input(), ctx, scope, assetScope)).rejects.toThrow(
      'asset AST-00031 is disposed; nothing can be installed on it',
    );
    nothingWritten();
  });

  it('asks the assets nothing when no line names one', async () => {
    await itConsumableIssueService.issue(
      { employeeId: EMPLOYEE, lines: [{ consumableId: String(INK), qty: 1, reason: 'new' }] },
      ctx,
      scope,
      assetScope,
    );
    expect(mocks.assetsByIds).not.toHaveBeenCalled();
  });

  it('issues to a caller without the asset grant when no line names an asset', async () => {
    const { memo } = await itConsumableIssueService.issue(
      { employeeId: EMPLOYEE, lines: [{ consumableId: String(INK), qty: 1, reason: 'new' }] },
      ctx,
      scope,
      null,
    );
    expect(memo.lines).toHaveLength(1);
    expect(mocks.assetsByIds).not.toHaveBeenCalled();
  });
});

// «عند تسليم الأصول والمستهلكات يكون فى إمكانية إنى مأسلمش لموظف ولكن أعينها فى مكان بس تبقى على
// عهده الإدارة» (owner, 2026-11-19).
describe('«صرف لإدارة» — a memo to a department at a place, signed for by its responsible person', () => {
  const DEPARTMENT = new Types.ObjectId();
  const PLACE = new Types.ObjectId();
  const SIGNER = String(new Types.ObjectId());
  const department = (over: Record<string, unknown> = {}) => ({
    _id: DEPARTMENT,
    name: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
    status: 'active',
    isDeleted: false,
    ...over,
  });
  const place = (over: Record<string, unknown> = {}) => ({
    _id: PLACE,
    branchId: STORE,
    name: { ar: 'غرفة السيرفرات', en: 'Server room' },
    isActive: true,
    isDeleted: false,
    ...over,
  });
  const signerHolder = (status: DirectoryEmployee['status']) => ({
    ...holderFor(status),
    employee: { ...person(status), employeeId: SIGNER, code: '0101007' },
    employeeCode: '0101007',
    employeeName: 'شريف ممدوح فاروق',
    jobTitle: { ar: 'مهندس شبكات', en: 'Network engineer' },
  });
  /** The first block's two lines, to IT at the server room instead of an employee. */
  const toIt = (over: Record<string, unknown> = {}) => {
    const { issuedAt, notes, lines } = input();
    return {
      issuedAt,
      notes,
      lines,
      department: {
        departmentId: String(DEPARTMENT),
        locationId: String(PLACE),
        responsibleEmployeeId: SIGNER,
        ...over,
      },
    };
  };
  const rows = async () =>
    (await Promise.all(
      mocks.createMovement.mock.results.map((result) => result.value as Promise<unknown>),
    )) as Record<string, unknown>[];
  const nothingWritten = () => {
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.moveStock).not.toHaveBeenCalled();
    expect(mocks.createMemo).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  };
  /** The 422's one field issue. */
  const refusedOn = async (attempt: Promise<unknown>, field: string, code: string) => {
    await expect(attempt).rejects.toMatchObject({
      httpStatus: 422,
      details: [expect.objectContaining({ field, code })],
    });
  };

  beforeEach(() => {
    mocks.readReceiptHolder.mockResolvedValue(signerHolder('active'));
    mocks.departmentsByIds.mockResolvedValue([department()]);
    mocks.locationsByIds.mockResolvedValue([place()]);
  });

  it('writes the department, the place and the signer on every row — and no employee', async () => {
    await itConsumableIssueService.issue(toIt(), ctx, scope, assetScope);

    // The signer is read through HR, as an employee recipient is; the two catalogs by id.
    expect(mocks.readReceiptHolder).toHaveBeenCalledWith(SIGNER);
    expect(mocks.departmentsByIds).toHaveBeenCalledWith([String(DEPARTMENT)]);
    expect(mocks.locationsByIds).toHaveBeenCalledWith([String(PLACE)]);
    const movements = await rows();
    expect(movements).toHaveLength(2);
    for (const row of movements) {
      expect(row).toMatchObject({
        kind: 'issued',
        branchId: STORE,
        employeeId: null,
        departmentId: DEPARTMENT,
        locationId: PLACE,
        responsibleEmployeeId: new Types.ObjectId(SIGNER),
      });
    }
  });

  it('writes ONE memo signed by the responsible person, naming the department and the place', async () => {
    const { memo } = await itConsumableIssueService.issue(toIt(), ctx, scope, assetScope);

    expect(mocks.reserve).toHaveBeenCalledWith('consumableMemo:global', 1, SESSION);
    expect(memo).toMatchObject({
      memoNumber: 41,
      employeeId: new Types.ObjectId(SIGNER),
      employeeCode: '0101007',
      employeeName: 'شريف ممدوح فاروق',
      jobTitle: { ar: 'مهندس شبكات', en: 'Network engineer' },
      custodian: {
        departmentId: DEPARTMENT,
        departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
        locationId: PLACE,
        locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
      },
      // The memo is still the store's paper.
      branchId: STORE,
    });
    expect(memo).not.toHaveProperty('nationalId');
  });

  it('an employee’s memo names no department', async () => {
    const { memo } = await itConsumableIssueService.issue(input(), ctx, scope, assetScope);
    expect(memo.custodian).toBeNull();
    for (const row of await rows()) expect(row).not.toHaveProperty('departmentId');
  });

  it('audits each item to the department, the place and the signer, and the memo with its signer', async () => {
    await itConsumableIssueService.issue(toIt(), ctx, scope, assetScope);
    const rowsAudited = mocks.audit.mock.calls.map(
      ([entry]) =>
        entry as {
          entityRef: { entityType: string };
          changes: { field: string; old: unknown; new: unknown }[];
        },
    );
    const [ink, , paper] = rowsAudited;
    expect(ink?.changes).toEqual(
      expect.arrayContaining([
        { field: 'departmentId', old: null, new: String(DEPARTMENT) },
        { field: 'locationId', old: null, new: String(PLACE) },
        { field: 'responsibleEmployeeId', old: null, new: SIGNER },
      ]),
    );
    // Nobody is the employee it went to.
    expect(ink?.changes.map((entry) => entry.field)).not.toContain('employeeId');
    expect(paper?.entityRef.entityType).toBe('consumableMemo');
    expect(paper?.changes).toEqual(
      expect.arrayContaining([
        { field: 'employeeId', old: null, new: SIGNER },
        { field: 'departmentId', old: null, new: String(DEPARTMENT) },
        { field: 'locationId', old: null, new: String(PLACE) },
      ]),
    );
    expect(auditedWhileCommitted).toEqual([true, true, true]);
  });

  it('a signer who has left — before even the items are read', async () => {
    mocks.readReceiptHolder.mockResolvedValue(signerHolder('exited'));
    const attempt = itConsumableIssueService.issue(toIt(), ctx, scope, assetScope);
    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow(/0101007 has left the company/);
    expect(mocks.itemsByIds).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('a department that is unknown, deleted or inactive', async () => {
    mocks.departmentsByIds.mockResolvedValue([]);
    await refusedOn(
      itConsumableIssueService.issue(toIt(), ctx, scope, assetScope),
      'body.department.departmentId',
      'UNKNOWN',
    );
    mocks.departmentsByIds.mockResolvedValue([department({ isDeleted: true })]);
    await refusedOn(
      itConsumableIssueService.issue(toIt(), ctx, scope, assetScope),
      'body.department.departmentId',
      'UNKNOWN',
    );
    mocks.departmentsByIds.mockResolvedValue([department({ status: 'inactive' })]);
    await refusedOn(
      itConsumableIssueService.issue(toIt(), ctx, scope, assetScope),
      'body.department.departmentId',
      'INACTIVE',
    );
    expect(mocks.itemsByIds).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('a place that is unknown or retired', async () => {
    mocks.locationsByIds.mockResolvedValue([]);
    await refusedOn(
      itConsumableIssueService.issue(toIt(), ctx, scope, assetScope),
      'body.department.locationId',
      'UNKNOWN',
    );
    mocks.locationsByIds.mockResolvedValue([place({ isActive: false })]);
    await refusedOn(
      itConsumableIssueService.issue(toIt(), ctx, scope, assetScope),
      'body.department.locationId',
      'INACTIVE',
    );
    nothingWritten();
  });

  it('a place outside the store’s branch — what this store gives is kept in its own branch', async () => {
    mocks.locationsByIds.mockResolvedValue([place({ branchId: new Types.ObjectId() })]);
    const attempt = itConsumableIssueService.issue(toIt(), ctx, scope, assetScope);
    await refusedOn(attempt, 'body.department.locationId', 'OTHER_BRANCH');
    await expect(attempt).rejects.toThrow(/place in the store's branch/);
    nothingWritten();
  });

  it('a department in ANOTHER branch is fine — only the place is the store’s', async () => {
    mocks.departmentsByIds.mockResolvedValue([department({ branchId: new Types.ObjectId() })]);
    const { memo } = await itConsumableIssueService.issue(toIt(), ctx, scope, assetScope);
    expect(memo.custodian?.departmentId).toEqual(DEPARTMENT);
  });

  it('a body naming both, or neither, is refused — the contract’s rule, held here too', async () => {
    await expect(
      itConsumableIssueService.issue({ ...toIt(), employeeId: EMPLOYEE }, ctx, scope, assetScope),
    ).rejects.toThrow('a memo is issued to an employee or to a department — exactly one');
    const { issuedAt, notes, lines } = toIt();
    await expect(
      itConsumableIssueService.issue({ issuedAt, notes, lines }, ctx, scope, assetScope),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mocks.readReceiptHolder).not.toHaveBeenCalled();
    nothingWritten();
  });

  describe('a toner onto a printer the department holds — its counter, unchanged', () => {
    const PRINTER = new Types.ObjectId();
    const toner = (line: Record<string, unknown> = {}) => ({
      ...toIt(),
      lines: [
        {
          consumableId: String(INK),
          qty: 1,
          reason: 'new' as const,
          assetId: String(PRINTER),
          ...line,
        },
      ],
    });

    beforeEach(() => {
      mocks.typesByIds.mockResolvedValue([
        { _id: INKS, name: { ar: 'حبارات', en: 'Ink & toner' }, requiresCounterReading: true },
      ]);
      // In the department's custody: `assigned`, as every held asset is.
      mocks.assetsByIds.mockResolvedValue([
        { _id: PRINTER, assetCode: 'AST-00077', name: 'HP LaserJet M404', status: 'assigned' },
      ]);
    });

    it('still needs its reading', async () => {
      await expect(
        itConsumableIssueService.issue(toner(), ctx, scope, assetScope),
      ).rejects.toMatchObject({
        code: 'IT_CONSUMABLE_COUNTER_REQUIRED',
        details: [{ field: 'lines.0.counterReading', code: 'REQUIRED' }],
      });
      nothingWritten();
    });

    it('is judged on that printer’s own timeline', async () => {
      mocks.counterTimeline.mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          consumableId: INK,
          assetId: PRINTER,
          at: new Date('2026-10-01T09:00:00.000Z'),
          memoId: new Types.ObjectId(),
          counterReading: 15000,
        },
      ]);
      await expect(
        itConsumableIssueService.issue(toner({ counterReading: 15000 }), ctx, scope, assetScope),
      ).rejects.toMatchObject({ code: 'IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS' });

      mocks.counterTimeline.mockResolvedValue([]);
      await itConsumableIssueService.issue(
        toner({ counterReading: 16000 }),
        ctx,
        scope,
        assetScope,
      );
      expect(mocks.counterTimeline).toHaveBeenLastCalledWith([PRINTER], SESSION);
      expect((await rows()).at(-1)).toMatchObject({
        assetId: PRINTER,
        counterReading: 16000,
        employeeId: null,
        departmentId: DEPARTMENT,
      });
    });
  });
});

// «يعني إجبارى أدخل عدد الورق المطبوع عند تركيب الحبارة … وأكيد مش هيدخل عدد ورق أقل أو مساوي للى
// موجود» (owner, 2026-11-19).
describe('«عداد الطابعة» — a toner of a type that takes the printer’s counter', () => {
  const PRINTER = new Types.ObjectId();
  const printer = {
    _id: PRINTER,
    assetCode: 'AST-00050',
    name: 'HP LaserJet M404',
    status: 'inStock',
  };
  /** A row already on the printer's timeline, as the repository reads it. */
  const reading = (at: string, counterReading: number, over: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(),
    consumableId: INK,
    assetId: PRINTER,
    at: new Date(at),
    memoId: new Types.ObjectId(),
    counterReading,
    ...over,
  });
  const toner = (over: Record<string, unknown> = {}) => ({
    employeeId: EMPLOYEE,
    issuedAt: ISSUED_AT,
    lines: [
      {
        consumableId: String(INK),
        qty: 1,
        reason: 'new' as const,
        assetId: String(PRINTER),
        counterReading: 15000,
        ...over,
      },
    ],
  });
  /** On the printer, with no reading typed. */
  const unread = () => ({
    employeeId: EMPLOYEE,
    issuedAt: ISSUED_AT,
    lines: [
      { consumableId: String(INK), qty: 1, reason: 'new' as const, assetId: String(PRINTER) },
    ],
  });
  const rows = async () =>
    (await Promise.all(
      mocks.createMovement.mock.results.map((result) => result.value as Promise<unknown>),
    )) as Record<string, unknown>[];

  beforeEach(() => {
    // «حبارات» takes the printer's counter; the mice do not.
    mocks.typesByIds.mockResolvedValue([
      { _id: INKS, name: { ar: 'حبارات', en: 'Ink & toner' }, requiresCounterReading: true },
      { _id: MICE, name: { ar: 'ماوس', en: 'Mice' } },
    ]);
    mocks.assetsByIds.mockResolvedValue([printer]);
  });

  const nothingWritten = () => {
    expect(mocks.moveStock).not.toHaveBeenCalled();
    expect(mocks.createMovement).not.toHaveBeenCalled();
    expect(mocks.createMemo).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  };

  it('writes the reading on the row — with the id it was placed under — after locking and reading the printer in the transaction', async () => {
    mocks.counterTimeline.mockResolvedValue([reading('2026-10-01T09:00:00.000Z', 12000)]);
    await itConsumableIssueService.issue(toner(), ctx, scope, assetScope);

    expect(mocks.reserve).toHaveBeenCalledWith(`printerCounter:${String(PRINTER)}`, 1, SESSION);
    expect(mocks.counterTimeline).toHaveBeenCalledWith([PRINTER], SESSION);
    const [row] = await rows();
    expect(row).toMatchObject({ assetId: PRINTER, counterReading: 15000 });
    expect(row?._id).toBeInstanceOf(Types.ObjectId);
    // `counterReset` is present only when true.
    expect(row).not.toHaveProperty('counterReset');
    // The lock is taken before the printer's readings are read.
    const lockAt = mocks.reserve.mock.invocationCallOrder[1] ?? 0;
    expect(lockAt).toBeLessThan(mocks.counterTimeline.mock.invocationCallOrder[0] ?? 0);
  });

  it('audits the reading with the issue', async () => {
    await itConsumableIssueService.issue(
      toner({ counterReading: 40, counterReset: true }),
      ctx,
      scope,
      assetScope,
    );
    const [entry] = mocks.audit.mock.calls.map(
      ([value]) => value as { changes: { field: string; old: unknown; new: unknown }[] },
    );
    expect(entry?.changes).toEqual(
      expect.arrayContaining([
        { field: 'counterReading', old: null, new: 40 },
        { field: 'counterReset', old: null, new: true },
      ]),
    );
  });

  it('a first reading on a printer with none is taken as it is', async () => {
    await itConsumableIssueService.issue(toner({ counterReading: 0 }), ctx, scope, assetScope);
    expect((await rows())[0]).toMatchObject({ counterReading: 0 });
  });

  it('requires the printer, the reading and one cartridge — every gap one detail of ONE refusal', async () => {
    const attempt = itConsumableIssueService.issue(
      {
        employeeId: EMPLOYEE,
        lines: [{ consumableId: String(INK), qty: 2, reason: 'new' }],
      },
      ctx,
      scope,
      assetScope,
    );
    await expect(attempt).rejects.toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_REQUIRED',
      httpStatus: 422,
      details: [
        {
          field: 'lines.0.assetId',
          code: 'REQUIRED',
          message: expect.stringMatching(/مركّب على/u),
        },
        { field: 'lines.0.counterReading', code: 'REQUIRED' },
        { field: 'lines.0.qty', code: 'ONE_CARTRIDGE' },
      ],
    });
    await expect(attempt).rejects.toThrow(/CON-00001 takes the printer's counter/u);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('a printer with no reading is the one gap named', async () => {
    const attempt = itConsumableIssueService.issue(unread(), ctx, scope, assetScope);
    await expect(attempt).rejects.toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_REQUIRED',
      details: [{ field: 'lines.0.counterReading', code: 'REQUIRED' }],
    });
    nothingWritten();
  });

  it('a reading sent for an item that takes none is refused', async () => {
    const attempt = itConsumableIssueService.issue(
      {
        employeeId: EMPLOYEE,
        lines: [
          {
            consumableId: String(MOUSE),
            qty: 1,
            reason: 'new',
            assetId: String(PRINTER),
            counterReading: 5,
          },
        ],
      },
      ctx,
      scope,
      assetScope,
    );
    await expect(attempt).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      message: "item CON-00002 does not take the printer's counter; send no reading",
    });
    nothingWritten();
  });

  it('a reading NOT ABOVE the printer’s last one is refused with its figures — equal included', async () => {
    const last = reading('2026-10-01T09:00:00.000Z', 15000);
    mocks.counterTimeline.mockResolvedValue([last]);
    const attempt = itConsumableIssueService.issue(toner(), ctx, scope, assetScope);
    await expect(attempt).rejects.toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS',
      httpStatus: 422,
      details: [
        { field: 'lines.0.counterReading', code: 'PREVIOUS_READING', message: '15000' },
        {
          field: 'lines.0.counterReading',
          code: 'PREVIOUS_AT',
          message: '2026-10-01T09:00:00.000Z',
        },
      ],
    });
    await expect(attempt).rejects.toThrow(/AST-00050's last reading 15000/u);
    nothingWritten();
  });

  it('a backdated reading not below a later one is refused with that one’s figures', async () => {
    mocks.counterTimeline.mockResolvedValue([
      reading('2026-10-01T09:00:00.000Z', 12000),
      reading('2026-11-05T09:00:00.000Z', 14000),
    ]);
    const attempt = itConsumableIssueService.issue(toner(), ctx, scope, assetScope);
    await expect(attempt).rejects.toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_ABOVE_NEXT',
      details: [
        { field: 'lines.0.counterReading', code: 'NEXT_READING', message: '14000' },
        { field: 'lines.0.counterReading', code: 'NEXT_AT', message: '2026-11-05T09:00:00.000Z' },
      ],
    });
    nothingWritten();
  });

  it('a reset may read below the last one — and the row says it was a reset', async () => {
    mocks.counterTimeline.mockResolvedValue([reading('2026-10-01T09:00:00.000Z', 15000)]);
    await itConsumableIssueService.issue(
      toner({ counterReading: 120, counterReset: true }),
      ctx,
      scope,
      assetScope,
    );
    expect((await rows())[0]).toMatchObject({ counterReading: 120, counterReset: true });
  });

  it('two lines on one printer are one placement: one lock, one reading on both rows', async () => {
    mocks.typesByIds.mockResolvedValue([
      { _id: INKS, name: { ar: 'حبارات', en: 'Ink & toner' }, requiresCounterReading: true },
      { _id: MICE, name: { ar: 'حبارات ملونة', en: 'Colour toner' }, requiresCounterReading: true },
    ]);
    mocks.counterTimeline.mockResolvedValue([reading('2026-10-01T09:00:00.000Z', 12000)]);
    await itConsumableIssueService.issue(
      {
        employeeId: EMPLOYEE,
        issuedAt: ISSUED_AT,
        lines: [
          {
            consumableId: String(INK),
            qty: 1,
            reason: 'new',
            assetId: String(PRINTER),
            counterReading: 15000,
          },
          {
            consumableId: String(MOUSE),
            qty: 1,
            reason: 'new',
            assetId: String(PRINTER),
            counterReading: 15000,
          },
        ],
      },
      ctx,
      scope,
      assetScope,
    );
    const locks = mocks.reserve.mock.calls.filter(([key]) => String(key).startsWith('printer'));
    expect(locks).toHaveLength(1);
    expect((await rows()).map((row) => row.counterReading)).toEqual([15000, 15000]);
  });

  it('a retired «حبارات» still takes the counter — the flag is read as the type stands', async () => {
    mocks.typesByIds.mockResolvedValue([
      {
        _id: INKS,
        name: { ar: 'حبارات', en: 'Ink & toner' },
        isActive: false,
        requiresCounterReading: true,
      },
    ]);
    await expect(
      itConsumableIssueService.issue(unread(), ctx, scope, assetScope),
    ).rejects.toMatchObject({ code: 'IT_CONSUMABLE_COUNTER_REQUIRED' });
  });

  it('an item of a type that takes no counter is issued as before: no lock, no reading on its row', async () => {
    // The ink and the mouse of the first block, neither type taking the counter.
    mocks.typesByIds.mockResolvedValue([
      { _id: INKS, name: { ar: 'حبارات', en: 'Ink & toner' }, requiresCounterReading: false },
      { _id: MICE, name: { ar: 'ماوس', en: 'Mice' } },
    ]);
    mocks.assetsByIds.mockResolvedValue([
      { _id: ASSET, assetCode: 'AST-00031', name: 'Lenovo ThinkCentre', status: 'assigned' },
    ]);
    await itConsumableIssueService.issue(input(), ctx, scope, assetScope);
    expect(mocks.counterTimeline).not.toHaveBeenCalled();
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    for (const row of await rows()) {
      expect(row).not.toHaveProperty('counterReading');
      expect(row).not.toHaveProperty('counterReset');
    }
  });
});
