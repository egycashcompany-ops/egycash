// The custody receipt — إيصال استلام (FR-18) — as the hand-over writes it.
//
// «وأنا بسلم الموظف جهاز او أصل يكون فى طباعة إيصال الأول وبعد الطباعة يسلم الجهاز على السيستم».
// What is pinned here is the invariant the paper depends on: every interval handed to a person
// names the receipt they signed, the receipt lists exactly the intervals that were opened, and a
// hand-over the system refuses half-way leaves no receipt behind. The data layer is mocked so what
// is tested is the decision; the transaction itself is the platform's.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../../../shared/errors';

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
}));

vi.mock('./receipt-holder', () => ({ readReceiptHolder: mocks.readReceiptHolder }));
vi.mock('./receipt.repository', () => ({
  itCustodyReceiptRepository: { create: mocks.createReceipt },
}));
vi.mock('../../../platform/kernel/unit-of-work', () => ({ unitOfWork: mocks.unitOfWork }));
vi.mock('../../../platform/kernel/event-bus', () => ({ emit: mocks.emit }));
vi.mock('../../../platform/audit', () => ({
  auditService: { record: vi.fn(async () => undefined) },
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

const ctx = {
  userId: String(new Types.ObjectId()),
  locale: 'ar',
  identity: { displayName: { ar: 'فني', en: 'Technician' } },
} as never;
const scope = {} as never;

const asset = (id: string, status: 'inStock' | 'assigned', name: string, serial: string) => ({
  _id: new Types.ObjectId(id),
  assetCode: name === 'Dell Optiplex 7090' ? 'AST-00001' : 'AST-00002',
  name,
  serialNumber: serial,
  status,
  branchId: BRANCH,
  __v: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) => fn({}));
  mocks.readReceiptHolder.mockResolvedValue({
    employee: null,
    employeeCode: '0100026',
    employeeName: 'مصطفى عثمان محمود',
    jobTitle: { ar: 'محاسب', en: 'Accountant' },
  });
  mocks.createAssignment.mockImplementation(async (data: Record<string, unknown>) => ({
    ...data,
    _id: new Types.ObjectId(),
  }));
  mocks.createReceipt.mockImplementation(async (data: Record<string, unknown>) => data);
  mocks.updateAsset.mockImplementation(async (id: string) => ({
    ...asset(id, 'assigned', 'x', 'y'),
  }));
  mocks.updateAssignment.mockResolvedValue({});
  mocks.findOpenForAsset.mockResolvedValue(null);
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
    // Every interval names THIS receipt, and the receipt names every interval.
    for (const [index, assignment] of assignments.entries()) {
      expect(String(assignment.receiptId)).toBe(String(receipt._id));
      expect(String(receipt.lines[index]?.assignmentId)).toBe(String(assignment._id));
    }
    // One platform event per asset, after the commit — exactly what an assign always emitted.
    expect(mocks.emit).toHaveBeenCalledTimes(2);
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
      { _id: Types.ObjectId; employeeId: Types.ObjectId; lines: { conditionOnIssue: string }[] },
    ];
    expect(String(receipt.employeeId)).toBe(EMPLOYEE);
    expect(receipt.lines[0]?.conditionOnIssue).toBe('U');
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
