// The custody receipt — إيصال استلام (FR-18) — as the hand-over writes it.
//
// «وأنا بسلم الموظف جهاز او أصل يكون فى طباعة إيصال الأول وبعد الطباعة يسلم الجهاز على السيستم».
// What is pinned here is the invariant the paper depends on: every interval handed to a person
// names the receipt they signed, the receipt lists exactly the intervals that were opened, and a
// hand-over the system refuses half-way leaves no receipt behind. The data layer is mocked so what
// is tested is the decision; the transaction itself is the platform's.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  readReceiptHolder: vi.fn(),
  unitOfWork: vi.fn(),
  getByIdForUpdate: vi.fn(),
  updateAsset: vi.fn(),
  findOpenForAsset: vi.fn(),
  createAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  createReceipt: vi.fn(),
  emit: vi.fn(),
  receiptNumberFor: vi.fn(),
  findAssetsSystem: vi.fn(),
  findCategoriesSystem: vi.fn(),
}));

vi.mock('./receipt-holder', () => ({ readReceiptHolder: mocks.readReceiptHolder }));
vi.mock('./receipt.repository', () => ({
  itCustodyReceiptRepository: {
    create: mocks.createReceipt,
    ensureCollection: vi.fn(async () => undefined),
  },
}));
vi.mock('./receipt-number', () => ({ receiptNumberFor: mocks.receiptNumberFor }));
vi.mock('../../../platform/kernel/unit-of-work', () => ({ unitOfWork: mocks.unitOfWork }));
vi.mock('../../../platform/kernel/event-bus', () => ({ emit: mocks.emit }));
vi.mock('../../../platform/audit', () => ({
  auditService: { record: vi.fn(async () => undefined) },
}));
vi.mock('./asset.repository', () => ({
  itAssetRepository: {
    getByIdForUpdate: mocks.getByIdForUpdate,
    updateById: mocks.updateAsset,
    findByIdsSystem: mocks.findAssetsSystem,
  },
}));
vi.mock('../catalog-items/catalog-item.repository', () => ({
  itCatalogItemRepository: { findByIdsSystem: mocks.findCategoriesSystem },
}));
vi.mock('./assignment.repository', () => ({
  itAssetAssignmentRepository: {
    findOpenForAsset: mocks.findOpenForAsset,
    create: mocks.createAssignment,
    updateById: mocks.updateAssignment,
  },
}));
vi.mock('./asset-event.repository', () => ({
  itAssetEventRepository: { append: vi.fn(async () => undefined) },
}));
vi.mock('../maintenance/order.repository', () => ({
  itMaintenanceOrderRepository: { hasActiveForAsset: vi.fn(async () => false) },
}));

const { itAssetCustodyService } = await import('./custody.service');

const BRANCH = new Types.ObjectId();
const OTHER_BRANCH = String(new Types.ObjectId());
const EMPLOYEE = String(new Types.ObjectId());
const HOLDER = new Types.ObjectId();
const PC = String(new Types.ObjectId());
const SCREEN = String(new Types.ObjectId());
const LAPTOPS = new Types.ObjectId();
const SCREENS = new Types.ObjectId();

const ctx = {
  userId: String(new Types.ObjectId()),
  locale: 'ar',
  identity: { displayName: { ar: 'فني', en: 'Technician' } },
} as never;
const scope = {} as never;

/** The PC is a laptop with its specifications and charger on file; the screen has neither. */
const asset = (id: string, status: 'inStock' | 'assigned', name: string, serial: string) => {
  const isPc = name === 'Dell Optiplex 7090';
  return {
    _id: new Types.ObjectId(id),
    assetCode: isPc ? 'AST-00001' : 'AST-00002',
    name,
    serialNumber: serial,
    status,
    branchId: BRANCH,
    categoryId: isPc ? LAPTOPS : SCREENS,
    manufacturer: 'Dell',
    model: isPc ? 'N4050' : null,
    specs: isPc
      ? {
          processor: 'Intel® Core™ i3-2330M CPU @ 2.10GHZ 3MB Cache',
          memory: '4.00 GB RAM',
          systemType: null,
          storage: '500 GB',
          mediaDrive: null,
          displayAdapter: null,
          graphicsMemory: null,
          networkAdapters: ['Dell Wireless 1701 802.11 b/g/n'],
        }
      : null,
    accessories: isPc ? ['شاحن لاب توب'] : [],
    __v: 0,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) => fn({}));
  mocks.readReceiptHolder.mockResolvedValue({
    employee: null,
    employeeCode: '0100026',
    employeeName: 'مصطفى عثمان محمود',
    jobTitle: { ar: 'محاسب', en: 'Accountant' },
    nationalId: '29801011234567',
    section: { ar: 'التسويات', en: 'Settlements' },
    department: { ar: 'الإدارة المالية', en: 'Finance' },
  });
  mocks.createAssignment.mockImplementation(async (data: Record<string, unknown>) => ({
    ...data,
    _id: new Types.ObjectId(),
  }));
  mocks.createReceipt.mockImplementation(async (data: Record<string, unknown>) => data);
  // The counter, as the hand-over sees it: the printed number it names, or the next one (41).
  mocks.receiptNumberFor.mockImplementation(async (printed?: number) => printed ?? 41);
  mocks.updateAsset.mockImplementation(async (id: string) => ({
    ...asset(id, 'assigned', 'x', 'y'),
  }));
  mocks.updateAssignment.mockResolvedValue({});
  mocks.findOpenForAsset.mockResolvedValue(null);
  mocks.findAssetsSystem.mockImplementation(async (ids: string[]) =>
    ids.map((id) =>
      id === PC
        ? asset(PC, 'inStock', 'Dell Optiplex 7090', 'B600DN3')
        : asset(id, 'inStock', 'Dell Screen', '49WNRS3'),
    ),
  );
  mocks.findCategoriesSystem.mockResolvedValue([
    { _id: LAPTOPS, name: { ar: 'لاب توب', en: 'Laptop' } },
    { _id: SCREENS, name: { ar: 'شاشة', en: 'Screen' } },
  ]);
});

describe('a hand-over is ONE receipt over every asset it hands over', () => {
  beforeEach(() => {
    mocks.getByIdForUpdate.mockImplementation(async (id: string) =>
      id === PC
        ? asset(PC, 'inStock', 'Dell Optiplex 7090', 'B600DN3')
        : asset(SCREEN, 'inStock', 'Dell Screen', '49WNRS3'),
    );
  });

  it('opens an interval per line, and one receipt listing them as the paper does', async () => {
    const { receipt, assignments } = await itAssetCustodyService.handOver(
      {
        employeeId: EMPLOYEE,
        lines: [
          { assetId: PC, conditionOnIssue: 'N', notes: 'Mouse&KeyBord' },
          { assetId: SCREEN, conditionOnIssue: 'N' },
        ],
      },
      ctx,
      scope,
    );

    expect(mocks.createAssignment).toHaveBeenCalledTimes(2);
    expect(mocks.createReceipt).toHaveBeenCalledTimes(1);
    expect(
      receipt.lines.map((line) => [
        line.name,
        line.serialNumber,
        line.conditionOnIssue,
        line.notes,
      ]),
    ).toEqual([
      ['Dell Optiplex 7090', 'B600DN3', 'N', 'Mouse&KeyBord'],
      ['Dell Screen', '49WNRS3', 'N', null],
    ]);
    // «الإسم» and «الوظيفة» — what the paper prints in the signature block, kept as printed.
    expect(receipt.employeeName).toBe('مصطفى عثمان محمود');
    expect(receipt.jobTitle).toEqual({ ar: 'محاسب', en: 'Accountant' });
    // «بطاقة رقم قومي … صادرة من قسم … – …» — the identity line, kept as printed too.
    expect(receipt.nationalId).toBe('29801011234567');
    expect(receipt.section).toEqual({ ar: 'التسويات', en: 'Settlements' });
    expect(receipt.department).toEqual({ ar: 'الإدارة المالية', en: 'Finance' });
    // Every interval names THIS receipt, and the receipt names every interval.
    for (const [index, assignment] of assignments.entries()) {
      expect(String(assignment.receiptId)).toBe(String(receipt._id));
      expect(String(receipt.lines[index]?.assignmentId)).toBe(String(assignment._id));
    }
    // One platform event per asset, after the commit — exactly what an assign always emitted.
    expect(mocks.emit).toHaveBeenCalledTimes(2);
  });

  it('each page names the device, its specifications and what came with it — as printed', async () => {
    const { receipt } = await itAssetCustodyService.handOver(
      {
        employeeId: EMPLOYEE,
        lines: [{ assetId: PC }, { assetId: SCREEN, accessories: ['كابل HDMI'] }],
      },
      ctx,
      scope,
    );

    const [pc, screen] = receipt.lines;
    // «بأنني قد استلمت جهاز لاب توب» — the device's kind is its category's Arabic name.
    expect(pc?.deviceType).toBe('لاب توب');
    expect([pc?.manufacturer, pc?.model]).toEqual(['Dell', 'N4050']);
    expect(pc?.specs).toMatchObject({
      processor: 'Intel® Core™ i3-2330M CPU @ 2.10GHZ 3MB Cache',
      storage: '500 GB',
      networkAdapters: ['Dell Wireless 1701 802.11 b/g/n'],
    });
    // «ومشتملاته كالتالي» — the asset's own list, unless the hand-over said what came this time.
    expect(pc?.accessories).toEqual(['شاحن لاب توب']);
    expect(screen?.deviceType).toBe('شاشة');
    expect(screen?.specs).toBeNull();
    expect(screen?.accessories).toEqual(['كابل HDMI']);
  });

  it('the paper keeps its own copy — editing the asset afterwards does not change it', async () => {
    const pc = asset(PC, 'inStock', 'Dell Optiplex 7090', 'B600DN3');
    mocks.getByIdForUpdate.mockResolvedValue(pc);
    const { receipt } = await itAssetCustodyService.handOver(
      { employeeId: EMPLOYEE, lines: [{ assetId: PC }] },
      ctx,
      scope,
    );

    pc.accessories.push('حقيبة');
    pc.specs?.networkAdapters.push('Realtec PCIe FE Family Controller');
    expect(receipt.lines[0]?.accessories).toEqual(['شاحن لاب توب']);
    expect(receipt.lines[0]?.specs?.networkAdapters).toEqual(['Dell Wireless 1701 802.11 b/g/n']);
  });

  it('refuses the whole paper when one asset is not in stock — no receipt is written', async () => {
    mocks.getByIdForUpdate.mockImplementation(async (id: string) =>
      id === PC
        ? asset(PC, 'inStock', 'Dell Optiplex 7090', 'B600DN3')
        : asset(SCREEN, 'assigned', 'Dell Screen', '49WNRS3'),
    );
    mocks.findOpenForAsset.mockResolvedValue({ _id: new Types.ObjectId() });

    const attempt = itAssetCustodyService.handOver(
      { employeeId: EMPLOYEE, lines: [{ assetId: PC }, { assetId: SCREEN }] },
      ctx,
      scope,
    );

    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow(/already assigned/);
    expect(mocks.createReceipt).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('the single-asset assign writes a receipt too — no interval is opened without one', async () => {
    await itAssetCustodyService.assign(
      PC,
      { employeeId: EMPLOYEE, conditionOnIssue: 'N', notes: 'charger' },
      ctx,
      scope,
    );

    expect(mocks.createReceipt).toHaveBeenCalledTimes(1);
    const [receipt] = mocks.createReceipt.mock.calls[0] as [{ lines: unknown[] }];
    expect(receipt.lines).toEqual([
      expect.objectContaining({ assetCode: 'AST-00001', conditionOnIssue: 'N', notes: 'charger' }),
    ]);
  });
});

describe('the receipt number — EGYCASH-IT-F-14-0001, one more on every print', () => {
  beforeEach(() => {
    mocks.getByIdForUpdate.mockResolvedValue(asset(PC, 'inStock', 'Dell Optiplex 7090', 'B600DN3'));
  });

  it('records the number printed on the paper the employee signed', async () => {
    const { receipt } = await itAssetCustodyService.handOver(
      { employeeId: EMPLOYEE, lines: [{ assetId: PC }], formNumber: 7 },
      ctx,
      scope,
    );
    expect(mocks.receiptNumberFor).toHaveBeenCalledWith(7);
    expect(receipt.formNumber).toBe(7);
  });

  it('takes the next number for a hand-over that printed nothing', async () => {
    const { receipt } = await itAssetCustodyService.handOver(
      { employeeId: EMPLOYEE, lines: [{ assetId: PC }] },
      ctx,
      scope,
    );
    expect(mocks.receiptNumberFor).toHaveBeenCalledWith(undefined);
    expect(receipt.formNumber).toBe(41);
  });

  it('a number that was never printed refuses the hand-over before anything is written', async () => {
    mocks.receiptNumberFor.mockRejectedValue(new BusinessRuleError('never printed'));
    const attempt = itAssetCustodyService.handOver(
      { employeeId: EMPLOYEE, lines: [{ assetId: PC }], formNumber: 9999 },
      ctx,
      scope,
    );
    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
    expect(mocks.createAssignment).not.toHaveBeenCalled();
  });
});

describe('a transfer to somebody new is a hand-over: it gets its own paper', () => {
  const OLD_RECEIPT = new Types.ObjectId();

  beforeEach(() => {
    mocks.getByIdForUpdate.mockResolvedValue(
      asset(PC, 'assigned', 'Dell Optiplex 7090', 'B600DN3'),
    );
    mocks.findOpenForAsset.mockResolvedValue({
      _id: new Types.ObjectId(),
      assignedToEmployeeId: HOLDER,
      assignedAt: new Date('2026-01-01T08:00:00.000Z'),
      receiptId: OLD_RECEIPT,
      __v: 0,
    });
  });

  it('writes a one-line receipt for the new holder, named on the new interval', async () => {
    await itAssetCustodyService.transfer(
      PC,
      { toEmployeeId: EMPLOYEE, conditionOnIssue: 'U', notes: 'without bag' },
      ctx,
      scope,
    );

    expect(mocks.createReceipt).toHaveBeenCalledTimes(1);
    const [receipt] = mocks.createReceipt.mock.calls[0] as [
      { _id: Types.ObjectId; employeeId: Types.ObjectId; lines: Record<string, unknown>[] },
    ];
    expect(String(receipt.employeeId)).toBe(EMPLOYEE);
    expect(receipt.lines[0]?.conditionOnIssue).toBe('U');
    // The new holder's identity line, like any hand-over's.
    expect((receipt as unknown as { nationalId: string }).nationalId).toBe('29801011234567');
    // The new holder's page describes the device like any hand-over's.
    expect(receipt.lines[0]).toMatchObject({
      deviceType: 'لاب توب',
      manufacturer: 'Dell',
      accessories: ['شاحن لاب توب'],
    });
    expect((receipt as unknown as { formNumber: number }).formNumber).toBe(41);
    const [interval] = mocks.createAssignment.mock.calls[0] as [{ receiptId: Types.ObjectId }];
    expect(String(interval.receiptId)).toBe(String(receipt._id));
    expect(String(interval.receiptId)).not.toBe(String(OLD_RECEIPT));
  });

  it('a move between branches in the same hands keeps the paper already signed', async () => {
    await itAssetCustodyService.transfer(PC, { toBranchId: OTHER_BRANCH }, ctx, scope);

    expect(mocks.createReceipt).not.toHaveBeenCalled();
    const [interval] = mocks.createAssignment.mock.calls[0] as [{ receiptId: Types.ObjectId }];
    expect(String(interval.receiptId)).toBe(String(OLD_RECEIPT));
  });
});
