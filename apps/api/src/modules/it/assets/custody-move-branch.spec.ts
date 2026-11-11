// «نقل إلى فرع» as the custody service decides it — «عايز إمكانية نقل أصل … إلى فرع تاني»; a held
// asset «ينتقل مع عهدته»; «فوراً»; «لا، السجل كفاية»; «كذا حاجة مرة واحدة».
//
// With the data layer mocked (the custody specs' posture), what is pinned is the decision: every
// asset of a move is written in ONE transaction, an asset in stock changing branch and losing its
// place in the branch it left, a held one through custody's own transfer — same holder, same
// receipt, the next interval in the new branch carrying its due date, condition and notes; every
// refusal named at once and before anything is written, a date before the custody began among
// them; the target branch compared as an id, reachable and live; and nothing audited or announced
// until the transaction has committed — the custody transfer itself included, now that it shares
// the body, a new holder's receipt row before the transfer's.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItEvents } from '@ecms/contracts';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  readReceiptHolder: vi.fn(),
  unitOfWork: vi.fn(),
  getByIdForUpdate: vi.fn(),
  updateAsset: vi.fn(),
  findOpenForAsset: vi.fn(),
  createAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  createReceipt: vi.fn(),
  appendHistory: vi.fn(),
  hasActiveOrder: vi.fn(),
  findBranch: vi.fn(),
  listBranches: vi.fn(),
  record: vi.fn(),
  recordMany: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('./receipt-holder', () => ({ readReceiptHolder: mocks.readReceiptHolder }));
vi.mock('./receipt.repository', () => ({
  itCustodyReceiptRepository: {
    create: mocks.createReceipt,
    ensureCollection: vi.fn(async () => undefined),
  },
}));
vi.mock('./receipt-number', () => ({
  receiptNumberFor: async (printed?: number) => printed ?? 1,
  claimReceiptNumber: async () => undefined,
}));
vi.mock('./receipt-device', () => ({
  readDeviceTypesOf: async () => new Map(),
  receiptDeviceFields: () => ({}),
}));
vi.mock('../../../platform/organization', () => ({
  branchRepository: { findById: mocks.findBranch, listAll: mocks.listBranches },
}));
vi.mock('../../../platform/kernel/unit-of-work', () => ({ unitOfWork: mocks.unitOfWork }));
vi.mock('../../../platform/kernel/event-bus', () => ({ emit: mocks.emit }));
vi.mock('../../../platform/audit', () => ({
  auditService: { record: mocks.record, recordMany: mocks.recordMany },
}));
vi.mock('./asset.repository', () => ({
  itAssetRepository: { getByIdForUpdate: mocks.getByIdForUpdate, updateById: mocks.updateAsset },
}));
vi.mock('./assignment.repository', () => ({
  itAssetAssignmentRepository: {
    findOpenForAsset: mocks.findOpenForAsset,
    create: mocks.createAssignment,
    updateById: mocks.updateAssignment,
  },
}));
vi.mock('./asset-event.repository', () => ({
  itAssetEventRepository: { append: mocks.appendHistory },
}));
vi.mock('../maintenance/order.repository', () => ({
  itMaintenanceOrderRepository: { hasActiveForAsset: mocks.hasActiveOrder },
}));

const { itAssetCustodyService } = await import('./custody.service');

// Spelled with letters, so an upper-case copy of either is a different string for the same id.
const HEAD_OFFICE = new Types.ObjectId('6563a1b2c3d4e5f6a7b8c9d1');
const TANTA = '6563a1b2c3d4e5f6a7b8c9d2';
const SHELVED = String(new Types.ObjectId());
const HELD = String(new Types.ObjectId());
const HOLDER = new Types.ObjectId();
const RECEIPT = new Types.ObjectId();
const OPEN_INTERVAL = new Types.ObjectId();
const AT = new Date('2026-11-11T09:00:00.000Z');
/** The custody the holder signed for: due back, in what condition, with what notes. */
const HELD_SINCE = new Date('2026-01-01T08:00:00.000Z');
const DUE_BACK = new Date('2027-01-31T00:00:00.000Z');
const CONDITION = 'بحالة جيدة';
const INTERVAL_NOTES = 'مع الحقيبة والشاحن';
/** The one transaction — so «inside it» is an assertion, not a hope. */
const SESSION = { transaction: 'the move' };

const ctx = {
  userId: String(new Types.ObjectId()),
  locale: 'ar',
  identity: { displayName: { ar: 'فني', en: 'Technician' } },
  branchId: String(HEAD_OFFICE),
  permissions: { 'itAsset.assign': 'organization' },
} as never;
const scope = { scope: 'organization' } as never;

const asset = (id: string, over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(id),
  assetCode: id === SHELVED ? 'AST-00011' : 'AST-00012',
  name: id === SHELVED ? 'Lenovo AIO' : 'Dell Latitude',
  serialNumber: null,
  status: id === SHELVED ? 'inStock' : 'assigned',
  branchId: HEAD_OFFICE,
  location: 'مخزن IT',
  __v: 4,
  ...over,
});

/** Each asset as the transaction reads it — by id, so a test can change one of them. */
let stored: Record<string, ReturnType<typeof asset>>;
let committed = false;
const writtenWhileOpen: boolean[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  committed = false;
  writtenWhileOpen.length = 0;
  stored = { [SHELVED]: asset(SHELVED), [HELD]: asset(HELD) };
  mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) => {
    const result = await fn(SESSION);
    committed = true;
    return result;
  });
  mocks.getByIdForUpdate.mockImplementation(async (id: string) => {
    const doc = stored[id];
    if (doc === undefined) throw new NotFoundError();
    return doc;
  });
  mocks.updateAsset.mockImplementation(async (id: string, set: Record<string, unknown>) => {
    writtenWhileOpen.push(!committed);
    return { ...stored[id], ...set };
  });
  mocks.findOpenForAsset.mockResolvedValue({
    _id: OPEN_INTERVAL,
    assignedToEmployeeId: HOLDER,
    assignedAt: HELD_SINCE,
    conditionOnIssue: CONDITION,
    expectedReturnAt: DUE_BACK,
    notes: INTERVAL_NOTES,
    receiptId: RECEIPT,
    __v: 0,
  });
  mocks.readReceiptHolder.mockResolvedValue({
    employee: null,
    employeeCode: '0100031',
    employeeName: 'شريف ممدوح فاروق',
    jobTitle: null,
    nationalId: null,
    section: null,
    department: null,
  });
  mocks.createReceipt.mockImplementation(async (data: Record<string, unknown>) => data);
  mocks.createAssignment.mockImplementation(async (data: Record<string, unknown>) => ({
    ...data,
    _id: new Types.ObjectId(),
  }));
  mocks.updateAssignment.mockResolvedValue({});
  mocks.appendHistory.mockResolvedValue(undefined);
  mocks.hasActiveOrder.mockResolvedValue(false);
  mocks.findBranch.mockResolvedValue({ _id: new Types.ObjectId(TANTA), status: 'active' });
  mocks.record.mockImplementation(async () => {
    expect(committed).toBe(true);
  });
  mocks.recordMany.mockImplementation(async () => {
    expect(committed).toBe(true);
  });
  mocks.emit.mockImplementation(async () => {
    expect(committed).toBe(true);
  });
});

const move = (assetIds: string[], over: Record<string, unknown> = {}) =>
  itAssetCustodyService.moveToBranch(
    { assetIds, toBranchId: TANTA, at: AT, notes: 'نقل الأجهزة', ...over } as never,
    ctx,
    scope,
  );

describe('a move of several assets — «كذا حاجة مرة واحدة»', () => {
  it('moves one in stock and one held in ONE transaction, and answers each in request order', async () => {
    const result = await move([HELD, SHELVED]);

    expect(mocks.unitOfWork).toHaveBeenCalledTimes(1);
    expect(writtenWhileOpen).toEqual([true, true]);
    expect(result).toEqual({
      toBranchId: TANTA,
      moved: [
        {
          assetId: HELD,
          assetCode: 'AST-00012',
          fromBranchId: String(HEAD_OFFICE),
          toBranchId: TANTA,
          holderEmployeeId: String(HOLDER),
        },
        {
          assetId: SHELVED,
          assetCode: 'AST-00011',
          fromBranchId: String(HEAD_OFFICE),
          toBranchId: TANTA,
          holderEmployeeId: null,
        },
      ],
    });
  });

  it('an asset in stock changes branch and leaves its place behind — under the version it was read at', async () => {
    await move([SHELVED]);

    expect(mocks.updateAsset).toHaveBeenCalledWith(
      SHELVED,
      { branchId: new Types.ObjectId(TANTA), location: null },
      expect.objectContaining({ version: 4, session: SESSION, scope }),
    );
    // A branch-only transfer: the two branches, and nobody.
    expect(mocks.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transferred',
        at: AT,
        metadata: { fromBranchId: String(HEAD_OFFICE), toBranchId: TANTA },
        notes: 'نقل الأجهزة',
      }),
      expect.objectContaining({ session: SESSION }),
    );
    expect(mocks.createAssignment).not.toHaveBeenCalled();
  });

  it('a held asset moves with its custody — the same holder, on the receipt they already signed, in the new branch', async () => {
    await move([HELD]);

    expect(mocks.updateAssignment).toHaveBeenCalledWith(
      String(OPEN_INTERVAL),
      expect.objectContaining({ returnedAt: AT }),
      expect.objectContaining({ session: SESSION }),
    );
    expect(mocks.createAssignment).toHaveBeenCalledTimes(1);
    expect(mocks.createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedToEmployeeId: HOLDER,
        branchId: new Types.ObjectId(TANTA),
        receiptId: RECEIPT,
        assignedAt: AT,
        // The custody they signed for, carried as it was — the due date above all. The move's own
        // notes are not the interval's.
        expectedReturnAt: DUE_BACK,
        conditionOnIssue: CONDITION,
        notes: INTERVAL_NOTES,
      }),
      expect.objectContaining({ session: SESSION }),
    );
    // No hand-over, so no paper — and HR is asked nothing: the holder is not refused for leaving.
    expect(mocks.createReceipt).not.toHaveBeenCalled();
    expect(mocks.readReceiptHolder).not.toHaveBeenCalled();
    expect(mocks.updateAsset).toHaveBeenCalledWith(
      HELD,
      expect.objectContaining({
        status: 'assigned',
        branchId: new Types.ObjectId(TANTA),
        location: null,
      }),
      expect.objectContaining({ version: 4, session: SESSION }),
    );
    // ONE `transferred` entry, naming the holder on both sides — and carrying the move's notes.
    expect(mocks.appendHistory).toHaveBeenCalledTimes(1);
    expect(mocks.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transferred',
        notes: 'نقل الأجهزة',
        metadata: expect.objectContaining({
          fromEmployeeId: String(HOLDER),
          toEmployeeId: String(HOLDER),
          fromBranchId: String(HEAD_OFFICE),
          toBranchId: TANTA,
          receiptId: String(RECEIPT),
        }),
      }),
      expect.anything(),
    );
  });

  it('audits and announces only after the commit, in request order', async () => {
    await move([HELD, SHELVED]);

    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.recordMany).toHaveBeenCalledTimes(1);
    const [entries] = mocks.recordMany.mock.calls[0] as [
      { entityRef: { entityId: string }; action: string; changes: unknown[] }[],
    ];
    expect(entries).toEqual([
      {
        entityRef: { moduleId: 'it', entityType: 'asset', entityId: HELD },
        action: 'transfer',
        changes: [
          { field: 'holder', old: String(HOLDER), new: String(HOLDER) },
          { field: 'branchId', old: String(HEAD_OFFICE), new: TANTA },
          { field: 'location', old: 'مخزن IT', new: null },
        ],
      },
      {
        entityRef: { moduleId: 'it', entityType: 'asset', entityId: SHELVED },
        action: 'transfer',
        changes: [
          { field: 'branchId', old: String(HEAD_OFFICE), new: TANTA },
          { field: 'location', old: 'مخزن IT', new: null },
        ],
      },
    ]);
    expect(mocks.emit.mock.calls).toEqual([
      [
        ItEvents.AssetTransferred,
        {
          assetId: HELD,
          assetCode: 'AST-00012',
          fromEmployeeId: String(HOLDER),
          toEmployeeId: String(HOLDER),
          fromBranchId: String(HEAD_OFFICE),
          toBranchId: TANTA,
        },
      ],
      [
        ItEvents.AssetTransferred,
        {
          assetId: SHELVED,
          assetCode: 'AST-00011',
          fromEmployeeId: null,
          toEmployeeId: null,
          fromBranchId: String(HEAD_OFFICE),
          toBranchId: TANTA,
        },
      ],
    ]);
  });

  it('an upper-case target is the branch it names — read, written and answered as its id', async () => {
    const result = await move([SHELVED], { toBranchId: TANTA.toUpperCase() });

    expect(mocks.findBranch).toHaveBeenCalledWith(TANTA);
    expect(result.toBranchId).toBe(TANTA);
    expect(mocks.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { fromBranchId: String(HEAD_OFFICE), toBranchId: TANTA },
      }),
      expect.anything(),
    );
  });

  it('an asset with no place in its branch audits only the branch', async () => {
    stored[SHELVED] = asset(SHELVED, { location: null });
    await move([SHELVED]);

    const [entries] = mocks.recordMany.mock.calls[0] as [{ changes: unknown[] }[]];
    expect(entries[0]?.changes).toEqual([
      { field: 'branchId', old: String(HEAD_OFFICE), new: TANTA },
    ]);
  });
});

describe('a refused move writes nothing', () => {
  const nothingWritten = () => {
    expect(mocks.updateAsset).not.toHaveBeenCalled();
    expect(mocks.updateAssignment).not.toHaveBeenCalled();
    expect(mocks.createAssignment).not.toHaveBeenCalled();
    expect(mocks.appendHistory).not.toHaveBeenCalled();
    expect(mocks.recordMany).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  };

  it('names every asset that holds it back — a disposed one and one already there — as a rule', async () => {
    stored[SHELVED] = asset(SHELVED, { status: 'disposed' });
    stored[HELD] = asset(HELD, { branchId: new Types.ObjectId(TANTA) });

    const attempt = move([SHELVED, HELD]);

    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow(
      /AST-00011 is disposed.*AST-00012 is already in that branch/,
    );
    nothingWritten();
  });

  it('an open maintenance order is custody’s conflict, read inside the transaction', async () => {
    mocks.hasActiveOrder.mockImplementation(async (id: string) => id === HELD);

    const attempt = move([SHELVED, HELD]);

    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow(/AST-00012 is under maintenance/);
    expect(mocks.hasActiveOrder).toHaveBeenCalledWith(HELD, SESSION);
    nothingWritten();
  });

  it('a held asset dated before its custody began — named with the others, in ONE refusal', async () => {
    const LATER = String(new Types.ObjectId());
    stored[LATER] = asset(LATER, { assetCode: 'AST-00013' });
    stored[SHELVED] = asset(SHELVED, { status: 'disposed' });

    // Both held since HELD_SINCE; the move is dated the day before.
    const attempt = move([SHELVED, HELD, LATER], { at: new Date('2025-12-31T09:00:00.000Z') });

    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow(
      /AST-00011 is disposed.*assets AST-00012, AST-00013 are held only since after the move's date/,
    );
    // Read in the transaction, with the others — not one asset at a time as each is written.
    expect(mocks.findOpenForAsset).toHaveBeenCalledWith(HELD, SESSION);
    expect(mocks.findOpenForAsset).toHaveBeenCalledWith(LATER, SESSION);
    nothingWritten();
  });

  it('…and so before the asset in stock named first is written', async () => {
    const attempt = move([SHELVED, HELD], { at: new Date('2025-12-31T09:00:00.000Z') });
    await expect(attempt).rejects.toThrow(
      /asset AST-00012 is held only since after the move's date/,
    );
    nothingWritten();
  });

  it('an upper-case copy of the branch they are in is that branch — already there, nothing written', async () => {
    const attempt = move([SHELVED, HELD], { toBranchId: String(HEAD_OFFICE).toUpperCase() });

    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow(/assets AST-00011, AST-00012 are already in that branch/);
    nothingWritten();
  });

  it('an asset under maintenance by its status alone', async () => {
    stored[SHELVED] = asset(SHELVED, { status: 'underMaintenance' });
    await expect(move([SHELVED])).rejects.toBeInstanceOf(ConflictError);
    nothingWritten();
  });

  it('one asset the caller cannot see is the whole request’s 404', async () => {
    const attempt = move([SHELVED, String(new Types.ObjectId())]);
    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
    nothingWritten();
  });

  it('a branch the caller’s itAsset.assign does not reach — before anything is read', async () => {
    const branchKeeper = {
      ...(ctx as object),
      permissions: { 'itAsset.assign': 'branch' },
      branchId: String(HEAD_OFFICE),
    } as never;
    const attempt = itAssetCustodyService.moveToBranch(
      { assetIds: [SHELVED], toBranchId: TANTA } as never,
      branchKeeper,
      scope,
    );
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });

  it('a branch that is not there, or no longer active', async () => {
    mocks.findBranch.mockResolvedValueOnce(null);
    await expect(move([SHELVED])).rejects.toBeInstanceOf(ValidationError);
    mocks.findBranch.mockResolvedValueOnce({ _id: new Types.ObjectId(TANTA), status: 'inactive' });
    await expect(move([SHELVED])).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });

  it('a version conflict on any asset fails the whole move, and nothing is audited', async () => {
    let calls = 0;
    mocks.updateAsset.mockImplementation(async (id: string, set: Record<string, unknown>) => {
      calls += 1;
      if (calls === 2) throw new ConflictError('stale');
      return { ...stored[id], ...set };
    });
    await expect(move([SHELVED, HELD])).rejects.toBeInstanceOf(ConflictError);
    expect(mocks.recordMany).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('the custody transfer, sharing the body', () => {
  it('still writes its audit rows and event — now after its commit', async () => {
    await itAssetCustodyService.transfer(HELD, { toBranchId: TANTA }, ctx, scope);

    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith({
      entityRef: { moduleId: 'it', entityType: 'asset', entityId: HELD },
      action: 'transfer',
      changes: [
        { field: 'holder', old: String(HOLDER), new: String(HOLDER) },
        { field: 'branchId', old: String(HEAD_OFFICE), new: TANTA },
      ],
    });
    // A transfer by itself does not touch the asset's place: only the move clears it.
    const [, set] = mocks.updateAsset.mock.calls[0] as [string, Record<string, unknown>];
    expect(set).not.toHaveProperty('location');
    expect(mocks.emit).toHaveBeenCalledWith(
      ItEvents.AssetTransferred,
      expect.objectContaining({ assetId: HELD, toBranchId: TANTA }),
    );
  });

  it('a transfer to somebody new audits its receipt, THEN the transfer — both after the commit', async () => {
    const NEWCOMER = String(new Types.ObjectId());
    await itAssetCustodyService.transfer(HELD, { toEmployeeId: NEWCOMER }, ctx, scope);

    expect(mocks.createReceipt).toHaveBeenCalledTimes(1);
    const [receipt] = mocks.createReceipt.mock.calls[0] as [{ _id: Types.ObjectId }];
    // `mocks.record` refuses any row written before the commit; the order is the order written.
    expect(mocks.record.mock.calls).toEqual([
      [
        {
          entityRef: {
            moduleId: 'it',
            entityType: 'custodyReceipt',
            entityId: String(receipt._id),
          },
          action: 'create',
          changes: [
            { field: 'employeeId', old: null, new: NEWCOMER },
            { field: 'assets', old: null, new: ['AST-00012'] },
          ],
        },
      ],
      [
        {
          entityRef: { moduleId: 'it', entityType: 'asset', entityId: HELD },
          action: 'transfer',
          changes: [
            { field: 'holder', old: String(HOLDER), new: NEWCOMER },
            { field: 'branchId', old: String(HEAD_OFFICE), new: String(HEAD_OFFICE) },
          ],
        },
      ],
    ]);
  });

  it('in the same hands, carries the custody facts unless it gives its own', async () => {
    await itAssetCustodyService.transfer(HELD, { toBranchId: TANTA }, ctx, scope);
    expect(mocks.createAssignment).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedReturnAt: DUE_BACK,
        conditionOnIssue: CONDITION,
        notes: INTERVAL_NOTES,
      }),
      expect.anything(),
    );

    const due = new Date('2027-06-30T00:00:00.000Z');
    await itAssetCustodyService.transfer(
      HELD,
      { toBranchId: TANTA, expectedReturnAt: due, conditionOnIssue: 'خدش بالغطاء', notes: 'تسليم' },
      ctx,
      scope,
    );
    expect(mocks.createAssignment).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedReturnAt: due,
        conditionOnIssue: 'خدش بالغطاء',
        notes: 'تسليم',
      }),
      expect.anything(),
    );
    // A transfer's own notes are its history entry's too, as they always were.
    expect(mocks.appendHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ notes: 'تسليم' }),
      expect.anything(),
    );
  });

  it('to somebody new, carries nothing of the last holder’s custody — the new interval is theirs', async () => {
    await itAssetCustodyService.transfer(
      HELD,
      { toEmployeeId: String(new Types.ObjectId()) },
      ctx,
      scope,
    );
    expect(mocks.createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ expectedReturnAt: null, conditionOnIssue: null, notes: null }),
      expect.anything(),
    );
  });

  it('an upper-case copy of the branch it is in, in the same hands, changes nothing — refused', async () => {
    await expect(
      itAssetCustodyService.transfer(
        HELD,
        { toBranchId: String(HEAD_OFFICE).toUpperCase() },
        ctx,
        scope,
      ),
    ).rejects.toThrow(/changes neither/);
    expect(mocks.updateAssignment).not.toHaveBeenCalled();
    expect(mocks.createAssignment).not.toHaveBeenCalled();
  });
});

describe('where a move may go — `GET /it/assets/move-targets`', () => {
  const ASSIUT = new Types.ObjectId('6563a1b2c3d4e5f6a7b8c9d3');
  const CLOSED = new Types.ObjectId('6563a1b2c3d4e5f6a7b8c9d4');

  beforeEach(() => {
    // The organisation's live branches, by code — one of them closed.
    mocks.listBranches.mockResolvedValue([
      { _id: HEAD_OFFICE, code: '01', status: 'active' },
      { _id: CLOSED, code: '02', status: 'inactive' },
      { _id: new Types.ObjectId(TANTA), code: '03', status: 'active' },
      { _id: ASSIUT, code: '04', status: 'active' },
    ]);
  });

  it('reads the organisation’s branch list once and answers every active one an org-wide grant reaches', async () => {
    expect(await itAssetCustodyService.moveTargets(ctx)).toEqual({
      branchIds: [String(HEAD_OFFICE), TANTA, String(ASSIUT)],
    });
    expect(mocks.listBranches).toHaveBeenCalledTimes(1);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });

  it('a branch-scoped keeper: their own branch — the one the move accepts from them', async () => {
    const branchKeeper = {
      ...(ctx as object),
      permissions: { 'itAsset.assign': 'branch' },
      branchId: String(HEAD_OFFICE),
      reach: { branchIds: [String(HEAD_OFFICE), TANTA], departments: [] },
      keyReach: {},
    } as never;
    expect(await itAssetCustodyService.moveTargets(branchKeeper)).toEqual({
      branchIds: [String(HEAD_OFFICE)],
    });
  });

  it('a department-scoped holder: none', async () => {
    const departmentKeeper = {
      ...(ctx as object),
      permissions: { 'itAsset.assign': 'department' },
      departmentId: String(new Types.ObjectId()),
    } as never;
    expect(await itAssetCustodyService.moveTargets(departmentKeeper)).toEqual({ branchIds: [] });
  });
});
