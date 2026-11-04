// What the dashboard reads, and under which filters — with the data layer mocked, so what is pinned
// is the decision, not Mongo.
//
//   1. the totals take both filters; by category the branch alone; by branch the categories alone —
//      and every read carries the reader's scope;
//   2. «يحتاج متابعة» under both filters, each row the very rule of the list its «عرض» opens: the
//      leavers judged on HR's answer for the open intervals' holders (one grouped read, one
//      directory batch), the unsigned receipts, the overdue returns, the warranties inside
//      `it.warrantyWarnDays` — a window of 0 counting nothing and reading nothing;
//   3. «آخر الحركات»: the history entries of the assets the reader may see beside their
//      registrations, newest first, eight at most, labelled in one asset read and one directory
//      batch.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItDashboardQuerySchema, ItSettingKeys } from '@ecms/contracts';
import { type DirectoryEmployee } from '../../../platform/directory';
import type * as AssignmentRepositoryModule from '../assets/assignment.repository';

const mocks = vi.hoisted(() => ({
  countByStatus: vi.fn(),
  countByStatusGrouped: vi.fn(),
  idsMatching: vi.fn(),
  assetCount: vi.fn(),
  newestRegistered: vi.fn(),
  findAssets: vi.fn(),
  countByHolder: vi.fn(),
  intervalCount: vi.fn(),
  signedIds: vi.fn(),
  latestOfTypes: vi.fn(),
  getDirectoryEmployees: vi.fn(),
  resolveSetting: vi.fn(),
}));

vi.mock('../../../platform/directory', () => ({
  getDirectoryEmployees: mocks.getDirectoryEmployees,
}));
vi.mock('../../../platform/settings', () => ({
  settingsService: { resolve: mocks.resolveSetting },
}));
vi.mock('../assets/asset.repository', () => ({
  itAssetRepository: {
    countByStatus: mocks.countByStatus,
    countByStatusGrouped: mocks.countByStatusGrouped,
    idsMatching: mocks.idsMatching,
    count: mocks.assetCount,
    newestRegistered: mocks.newestRegistered,
    findByIdsSystem: mocks.findAssets,
  },
}));
// The repository's reads are mocked; its filter translation is the real one — the register's.
vi.mock('../assets/assignment.repository', async (importOriginal) => ({
  ...(await importOriginal<typeof AssignmentRepositoryModule>()),
  itAssetAssignmentRepository: {
    countByHolder: mocks.countByHolder,
    count: mocks.intervalCount,
  },
}));
vi.mock('../assets/receipt.repository', () => ({
  itCustodyReceiptRepository: { signedIds: mocks.signedIds },
}));
vi.mock('../assets/asset-event.repository', () => ({
  itAssetEventRepository: { latestOfTypes: mocks.latestOfTypes },
}));

const { itDashboardService } = await import('./dashboard.service');

const id = (): Types.ObjectId => new Types.ObjectId();
const LAPTOPS = String(id());
const SCREENS = String(id());
const BRANCH = String(id());
const scope = {
  scope: 'branch',
  userId: String(id()),
  branchId: BRANCH,
  departmentId: null,
  sectionId: null,
} as const;
const query = (raw: Record<string, string>) => ItDashboardQuerySchema.parse(raw);
const person = (status: DirectoryEmployee['status'], code: string, fullNameAr: string) =>
  ({ status, code, fullNameAr }) as DirectoryEmployee;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countByStatus.mockResolvedValue({});
  mocks.countByStatusGrouped.mockResolvedValue({});
  mocks.idsMatching.mockResolvedValue([]);
  mocks.assetCount.mockResolvedValue(0);
  mocks.newestRegistered.mockResolvedValue([]);
  mocks.findAssets.mockResolvedValue([]);
  mocks.countByHolder.mockResolvedValue(new Map());
  mocks.intervalCount.mockResolvedValue(0);
  mocks.signedIds.mockResolvedValue([]);
  mocks.latestOfTypes.mockResolvedValue([]);
  mocks.getDirectoryEmployees.mockResolvedValue(new Map());
  mocks.resolveSetting.mockResolvedValue(30);
});

describe('the counts', () => {
  it('takes both filters for the totals, the branch alone by category, the categories alone by branch', async () => {
    mocks.countByStatus.mockResolvedValue({ inStock: 97, assigned: 2 });
    mocks.countByStatusGrouped.mockImplementation(async (field: string) =>
      field === 'categoryId'
        ? { [LAPTOPS]: { inStock: 9, assigned: 18 }, [SCREENS]: { inStock: 89 } }
        : { [BRANCH]: { inStock: 97, assigned: 2 } },
    );
    const answer = await itDashboardService.assets(
      query({ categoryId: `${LAPTOPS},${SCREENS}`, branchId: BRANCH }),
      scope,
    );

    const categories = { $in: [new Types.ObjectId(LAPTOPS), new Types.ObjectId(SCREENS)] };
    const branch = new Types.ObjectId(BRANCH);
    expect(mocks.countByStatus).toHaveBeenCalledWith(
      { categoryId: categories, branchId: branch },
      scope,
    );
    expect(mocks.countByStatusGrouped).toHaveBeenCalledWith(
      'categoryId',
      { branchId: branch },
      scope,
    );
    expect(mocks.countByStatusGrouped).toHaveBeenCalledWith(
      'branchId',
      { categoryId: categories },
      scope,
    );

    expect(answer.totals).toEqual({
      inStock: 97,
      assigned: 2,
      underMaintenance: 0,
      disposed: 0,
      total: 99,
    });
    expect(answer.byCategory.map((row) => [row.categoryId, row.total])).toEqual([
      [SCREENS, 89],
      [LAPTOPS, 27],
    ]);
    expect(answer.byBranch).toEqual([
      { branchId: BRANCH, inStock: 97, assigned: 2, underMaintenance: 0, disposed: 0, total: 99 },
    ]);
  });

  it('reads every asset the reader may see when no filter is set', async () => {
    await itDashboardService.assets(query({}), scope);
    expect(mocks.countByStatus).toHaveBeenCalledWith({}, scope);
    expect(mocks.countByStatusGrouped).toHaveBeenCalledWith('categoryId', {}, scope);
    expect(mocks.countByStatusGrouped).toHaveBeenCalledWith('branchId', {}, scope);
    // No category, no asset-id read for the custody rows: the intervals' own scope is enough.
    expect(mocks.idsMatching).not.toHaveBeenCalled();
  });
});

describe('«يحتاج متابعة»', () => {
  const NOW_ISH = Date.now();
  const condition = (call: unknown[] | undefined): Record<string, unknown> =>
    (call?.[0] ?? {}) as Record<string, unknown>;

  it('counts the open intervals whose holder HR shows as having left — one grouped read, one batch', async () => {
    const leaver = String(id());
    const employed = String(id());
    const unknown = String(id());
    mocks.countByHolder.mockResolvedValue(
      new Map([
        [leaver, 3],
        [employed, 5],
        [unknown, 2],
      ]),
    );
    mocks.getDirectoryEmployees.mockResolvedValue(
      new Map([
        [leaver, person('exited', '0100001', 'شريف ممدوح فاروق')],
        [employed, person('active', '0101002', 'وليد صفوت جلال')],
      ]),
    );
    const { attention } = await itDashboardService.assets(query({}), scope);
    // Only the positive answer counts: a holder HR does not know is not a leaver.
    expect(attention.heldByLeavers).toBe(3);
    expect(mocks.countByHolder).toHaveBeenCalledTimes(1);
    expect(mocks.countByHolder).toHaveBeenCalledWith({ returnedAt: null }, scope);
    expect(mocks.getDirectoryEmployees).toHaveBeenCalledTimes(1);
    expect([...(mocks.getDirectoryEmployees.mock.calls[0]?.[0] as string[])].sort()).toEqual(
      [leaver, employed, unknown].sort(),
    );
  });

  it('asks HR nothing when nobody holds anything', async () => {
    const { attention } = await itDashboardService.assets(query({}), scope);
    expect(attention.heldByLeavers).toBe(0);
    expect(mocks.getDirectoryEmployees).not.toHaveBeenCalled();
  });

  it('counts the unsigned receipts and the overdue returns by the custody register’s own rules', async () => {
    const signed = [id(), id()];
    mocks.signedIds.mockResolvedValue(signed);
    mocks.intervalCount.mockImplementation(async (filter: Record<string, unknown>) =>
      JSON.stringify(filter).includes('receiptId') ? 23 : 2,
    );
    const { attention } = await itDashboardService.assets(query({}), scope);
    expect(attention.receiptsAwaitingSignature).toBe(23);
    expect(attention.overdueReturns).toBe(2);
    expect(mocks.signedIds).toHaveBeenCalledTimes(1);

    const [unsigned, overdue] = mocks.intervalCount.mock.calls;
    expect(condition(unsigned)).toEqual({
      $and: [{ returnedAt: null }, { receiptId: { $ne: null, $nin: signed } }],
    });
    const late = condition(overdue) as { $and: Record<string, { $lt?: Date }>[] };
    expect(late.$and[0]).toEqual({ returnedAt: null });
    expect(late.$and[1]?.expectedReturnAt?.$lt?.getTime()).toBeGreaterThanOrEqual(NOW_ISH);
    for (const call of mocks.intervalCount.mock.calls) expect(call[1]).toBe(scope);
  });

  it('reaches the intervals through the chosen categories’ assets, read once, and the interval’s branch', async () => {
    const assets = [id(), id()];
    mocks.idsMatching.mockResolvedValue(assets);
    await itDashboardService.assets(query({ categoryId: LAPTOPS, branchId: BRANCH }), scope);
    expect(mocks.idsMatching).toHaveBeenCalledTimes(1);
    expect(mocks.idsMatching).toHaveBeenCalledWith(
      { categoryId: { $in: [new Types.ObjectId(LAPTOPS)] } },
      scope,
    );
    const narrowed = [{ assetId: { $in: assets } }, { branchId: new Types.ObjectId(BRANCH) }];
    expect(condition(mocks.countByHolder.mock.calls[0])).toEqual({
      $and: [{ returnedAt: null }, ...narrowed],
    });
    for (const call of mocks.intervalCount.mock.calls) {
      const clauses = (condition(call) as { $and: unknown[] }).$and;
      expect(clauses).toEqual(expect.arrayContaining(narrowed));
    }
  });

  it('counts the warranties ending inside `it.warrantyWarnDays`, under both filters', async () => {
    mocks.resolveSetting.mockResolvedValue(45);
    mocks.assetCount.mockResolvedValue(6);
    const { attention } = await itDashboardService.assets(
      query({ categoryId: LAPTOPS, branchId: BRANCH }),
      scope,
    );
    expect(mocks.resolveSetting).toHaveBeenCalledWith(ItSettingKeys.WarrantyWarnDays, {
      userId: null,
      branchId: null,
    });
    expect(attention).toMatchObject({ warrantyEndingSoon: 6, warrantyWindowDays: 45 });
    const [filter, readScope] = mocks.assetCount.mock.calls[0] as [
      Record<string, { $gt: Date; $lte: Date }>,
      unknown,
    ];
    expect(readScope).toBe(scope);
    expect(filter.categoryId).toEqual({ $in: [new Types.ObjectId(LAPTOPS)] });
    expect(filter.branchId).toEqual(new Types.ObjectId(BRANCH));
    expect(filter.status).toEqual({ $ne: 'disposed' });
    const window = filter['warranty.end'] as { $gt: Date; $lte: Date };
    expect(window.$lte.getTime() - window.$gt.getTime()).toBe(45 * 86_400_000);
  });

  it('counts nothing, and reads nothing, when the early warning is switched off', async () => {
    mocks.resolveSetting.mockResolvedValue(0);
    const { attention } = await itDashboardService.assets(query({}), scope);
    expect(attention).toMatchObject({ warrantyEndingSoon: 0, warrantyWindowDays: 0 });
    expect(mocks.assetCount).not.toHaveBeenCalled();
  });
});

describe('«آخر الحركات»', () => {
  const LEAVER = id();
  const HOLDER = id();
  const asset = (code: string, name: string, createdAt: Date) => ({
    _id: id(),
    assetCode: code,
    name,
    branchId: new Types.ObjectId(BRANCH),
    createdAt,
  });
  const entry = (subject: Types.ObjectId, type: string, at: Date, metadata = {}) => ({
    _id: id(),
    subjectId: subject,
    type,
    at,
    metadata,
  });

  it('reads the history of the assets the reader may see under the filters, and their registrations', async () => {
    const visible = [id(), id()];
    mocks.idsMatching.mockResolvedValue(visible);
    await itDashboardService.activity(query({ categoryId: LAPTOPS, branchId: BRANCH }), scope);
    const filter = {
      categoryId: { $in: [new Types.ObjectId(LAPTOPS)] },
      branchId: new Types.ObjectId(BRANCH),
    };
    expect(mocks.idsMatching).toHaveBeenCalledWith(filter, scope);
    expect(mocks.newestRegistered).toHaveBeenCalledWith(filter, scope, 8);
    expect(mocks.latestOfTypes).toHaveBeenCalledWith({
      assetIds: visible,
      types: [
        'assigned',
        'returned',
        'transferred',
        'maintenanceStarted',
        'maintenanceCompleted',
        'disposed',
      ],
      limit: 8,
    });
  });

  it('puts both together newest first, eight at most, labelled in one asset read and one directory batch', async () => {
    const laptop = asset(
      'AST-00512',
      'Lenovo ThinkCentre neo 50a 24',
      new Date('2026-10-01T08:00:00Z'),
    );
    const printer = asset('AST-00140', 'طابعة HP LaserJet', new Date('2026-10-02T08:00:00Z'));
    const fresh = asset(
      'AST-00551',
      'Lenovo ThinkCentre neo 50a 24',
      new Date('2026-11-02T07:00:00Z'),
    );
    mocks.newestRegistered.mockResolvedValue([fresh]);
    const day = (d: number, h: number) => new Date(Date.UTC(2026, 10, d, h));
    mocks.latestOfTypes.mockResolvedValue([
      entry(laptop._id, 'assigned', day(3, 8), { employeeId: String(HOLDER) }),
      entry(printer._id, 'maintenanceStarted', day(2, 9)),
      entry(laptop._id, 'returned', day(1, 8), { employeeId: String(LEAVER) }),
      ...Array.from({ length: 6 }, (_, n) => entry(printer._id, 'disposed', day(1, 7 - n))),
    ]);
    mocks.findAssets.mockResolvedValue([laptop, printer]);
    mocks.getDirectoryEmployees.mockResolvedValue(
      new Map([[String(HOLDER), person('active', '0101002', 'وليد صفوت جلال')]]),
    );

    const { items } = await itDashboardService.activity(query({}), scope);
    expect(items).toHaveLength(8);
    expect(items.slice(0, 4).map((item) => [item.kind, item.assetCode])).toEqual([
      ['assigned', 'AST-00512'],
      ['maintenanceStarted', 'AST-00140'],
      ['registered', 'AST-00551'],
      ['returned', 'AST-00512'],
    ]);
    expect(items[0]).toMatchObject({
      employeeId: String(HOLDER),
      employeeCode: '0101002',
      employeeName: 'وليد صفوت جلال',
      branchId: BRANCH,
    });
    // HR cannot name this one: the id stays, the label is honest about it.
    expect(items[3]).toMatchObject({ employeeId: String(LEAVER), employeeName: null });
    expect(items[2]).toMatchObject({ id: String(fresh._id), assetId: String(fresh._id) });

    // The registration's asset is already in hand; the others are read once, the people once.
    expect(mocks.findAssets).toHaveBeenCalledTimes(1);
    expect([...(mocks.findAssets.mock.calls[0]?.[0] as string[])].sort()).toEqual(
      [String(laptop._id), String(printer._id)].sort(),
    );
    expect(mocks.getDirectoryEmployees).toHaveBeenCalledTimes(1);
    expect([...(mocks.getDirectoryEmployees.mock.calls[0]?.[0] as string[])].sort()).toEqual(
      [String(HOLDER), String(LEAVER)].sort(),
    );
  });

  it('reads no labels at all when nothing moved', async () => {
    const { items } = await itDashboardService.activity(query({}), scope);
    expect(items).toEqual([]);
    expect(mocks.findAssets).not.toHaveBeenCalled();
    expect(mocks.getDirectoryEmployees).not.toHaveBeenCalled();
  });
});
