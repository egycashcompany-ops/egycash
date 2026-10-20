// A line's custody — «صفحة لإدارتهم وتسليمهم» — as the hand-over, the return and the two status
// actions decide it.
//
// What is pinned is the decision, with the data layer mocked (the custody-receipt spec's posture):
// a line goes to a current employee on a paper they sign, or to a car on none; a suspended line, a
// held line and a leaver are refused before anything is written; a return closes the interval it
// names; and a line is suspended only from stock. The transaction itself is the platform's.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DirectoryEmployee } from '../../../platform/directory';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  readReceiptHolder: vi.fn(),
  numberFor: vi.fn(),
  nextNumber: vi.fn(),
  claimNumber: vi.fn(),
  unitOfWork: vi.fn(),
  audit: vi.fn(),
  getLineForUpdate: vi.fn(),
  findLine: vi.fn(),
  updateLine: vi.fn(),
  createAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  findOpenForLine: vi.fn(),
  listOpenForEmployee: vi.fn(),
  appendEvent: vi.fn(),
  createReceipt: vi.fn(),
}));

const ready = () => vi.fn(async () => undefined);

vi.mock('../assets/receipt-holder', () => ({ readReceiptHolder: mocks.readReceiptHolder }));
vi.mock('../assets/receipt-number', () => ({
  mobileLineReceiptNumberFor: mocks.numberFor,
  nextReceiptNumber: mocks.nextNumber,
  claimReceiptNumber: mocks.claimNumber,
}));
vi.mock('../../../platform/kernel/unit-of-work', () => ({ unitOfWork: mocks.unitOfWork }));
vi.mock('../../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
vi.mock('../../../platform/files', () => ({ fileService: {}, fileCategoryService: {} }));
vi.mock('./mobile-line.repository', () => ({
  itMobileLineRepository: {
    getByIdForUpdate: mocks.getLineForUpdate,
    findById: mocks.findLine,
    updateById: mocks.updateLine,
    ensureCollection: ready(),
  },
}));
vi.mock('./line-assignment.repository', () => ({
  itMobileLineAssignmentRepository: {
    create: mocks.createAssignment,
    updateById: mocks.updateAssignment,
    findOpenForLine: mocks.findOpenForLine,
    listOpenForEmployee: mocks.listOpenForEmployee,
    ensureCollection: ready(),
  },
}));
vi.mock('./line-event.repository', () => ({
  itMobileLineEventRepository: { append: mocks.appendEvent, ensureCollection: ready() },
}));
vi.mock('./line-receipt.repository', () => ({
  itMobileLineReceiptRepository: { create: mocks.createReceipt, ensureCollection: ready() },
}));

const { itMobileLineCustodyService } = await import('./line-custody.service');
const { itMobileLineReceiptService } = await import('./line-receipt.service');

const LINE = String(new Types.ObjectId());
const BRANCH = new Types.ObjectId();
const EMPLOYEE = String(new Types.ObjectId());
const OPEN = new Types.ObjectId();
const HANDED_AT = new Date('2026-10-01T08:00:00.000Z');

const ctx = {
  userId: String(new Types.ObjectId()),
  locale: 'ar',
  identity: { displayName: { ar: 'فني', en: 'Technician' } },
} as never;
const scope = {} as never;

const line = (status: 'inStock' | 'assigned' | 'suspended') => ({
  _id: new Types.ObjectId(LINE),
  network: 'vodafone' as const,
  phoneNumber: '01034455917',
  accountNumber: '8.29280625.1',
  ratePlan: '2025 Business Flex 80',
  simKind: 'physical' as const,
  simSerial: '8920022022712847788',
  status,
  branchId: BRANCH,
  currentAssignmentId: status === 'assigned' ? OPEN : null,
  notes: null,
  __v: 3,
});

const person = (status: DirectoryEmployee['status']): DirectoryEmployee => ({
  employeeId: EMPLOYEE,
  code: '0101002',
  fullNameAr: 'وليد صفوت جلال',
  status,
  branchId: String(BRANCH),
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
  nationalId: '29801011234567',
  section: { ar: 'التسويات', en: 'Settlements' },
  department: { ar: 'الإدارة المالية', en: 'Finance' },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) => fn({}));
  mocks.readReceiptHolder.mockResolvedValue(holderFor('active'));
  // The F-14 counter as the hand-over sees it: the printed number it names, or the next one (41).
  mocks.numberFor.mockImplementation(async (printed?: number) => printed ?? 41);
  mocks.nextNumber.mockResolvedValue(42);
  mocks.createAssignment.mockImplementation(async (data: Record<string, unknown>) => ({
    ...data,
    _id: new Types.ObjectId(),
  }));
  mocks.createReceipt.mockImplementation(async (data: Record<string, unknown>) => data);
  mocks.updateLine.mockImplementation(async (_id: string, set: Record<string, unknown>) => ({
    ...line('inStock'),
    ...set,
  }));
  mocks.updateAssignment.mockImplementation(
    async (_id: string, set: Record<string, unknown>) => set,
  );
  mocks.findOpenForLine.mockResolvedValue({
    _id: OPEN,
    lineId: new Types.ObjectId(LINE),
    holderKind: 'employee',
    assignedToEmployeeId: new Types.ObjectId(EMPLOYEE),
    vehicleCode: null,
    vehiclePlate: null,
    assignedAt: HANDED_AT,
    returnedAt: null,
    receiptId: new Types.ObjectId(),
    __v: 0,
  });
});

describe('handing a line to an employee', () => {
  beforeEach(() => {
    mocks.getLineForUpdate.mockResolvedValue(line('inStock'));
  });

  it('opens one interval and ONE acknowledgment naming each other, the paper a snapshot', async () => {
    const { receipt, assignment } = await itMobileLineCustodyService.assign(
      LINE,
      { employeeId: EMPLOYEE, formNumber: 7, notes: 'with charger' },
      ctx,
      scope,
    );

    expect(mocks.numberFor).toHaveBeenCalledWith(7);
    expect(mocks.claimNumber).toHaveBeenCalledWith(7, expect.anything());
    expect(mocks.createReceipt).toHaveBeenCalledTimes(1);
    expect(receipt?.formNumber).toBe(7);
    // The signer as the device paper names them — the same `signer(holder)`.
    expect(receipt).toMatchObject({
      employeeCode: '0101002',
      employeeName: 'وليد صفوت جلال',
      jobTitle: { ar: 'محاسب', en: 'Accountant' },
      nationalId: '29801011234567',
      section: { ar: 'التسويات', en: 'Settlements' },
      department: { ar: 'الإدارة المالية', en: 'Finance' },
    });
    // «خط محمول رقم … وبياناته كالتالي» — the line as it was when the paper was printed.
    expect(receipt?.line).toMatchObject({
      network: 'vodafone',
      phoneNumber: '01034455917',
      simKind: 'physical',
      simSerial: '8920022022712847788',
      ratePlan: '2025 Business Flex 80',
      accountNumber: '8.29280625.1',
    });
    expect(String(assignment.receiptId)).toBe(String(receipt?._id));
    expect(String(receipt?.line.assignmentId)).toBe(String(assignment._id));
    expect(assignment).toMatchObject({
      holderKind: 'employee',
      vehicleCode: null,
      branchId: BRANCH,
    });
    // The line points at its open interval, read and written under one version.
    expect(mocks.updateLine).toHaveBeenCalledWith(
      LINE,
      { status: 'assigned', currentAssignmentId: assignment._id },
      expect.objectContaining({ version: 3 }),
    );
  });

  it('audits the hand-over only once it has committed — a refused one leaves no audit row', async () => {
    // The paper's number turns out to be on another paper: the transaction refuses, and nothing
    // may say the line was handed over.
    mocks.claimNumber.mockRejectedValueOnce(new BusinessRuleError('already on another paper'));

    await expect(
      itMobileLineCustodyService.assign(LINE, { employeeId: EMPLOYEE, formNumber: 7 }, ctx, scope),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mocks.createReceipt).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('takes the next number when no paper was printed first', async () => {
    const { receipt } = await itMobileLineCustodyService.assign(
      LINE,
      { employeeId: EMPLOYEE },
      ctx,
      scope,
    );
    expect(mocks.numberFor).toHaveBeenCalledWith(undefined);
    expect(receipt?.formNumber).toBe(41);
  });

  it('refuses an employee HR says has left — before anything is written', async () => {
    mocks.readReceiptHolder.mockResolvedValue(holderFor('exited'));

    const attempt = itMobileLineCustodyService.assign(LINE, { employeeId: EMPLOYEE }, ctx, scope);

    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow(/0101002 has left/);
    expect(mocks.numberFor).not.toHaveBeenCalled();
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
    expect(mocks.createAssignment).not.toHaveBeenCalled();
  });

  it('a number the series refuses (never printed, or on a device paper) refuses the hand-over', async () => {
    mocks.numberFor.mockRejectedValue(new BusinessRuleError('already on a device receipt'));

    const attempt = itMobileLineCustodyService.assign(
      LINE,
      { employeeId: EMPLOYEE, formNumber: 5 },
      ctx,
      scope,
    );

    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });

  it('refuses a suspended line — reactivate it first — and writes nothing', async () => {
    mocks.getLineForUpdate.mockResolvedValue(line('suspended'));

    const attempt = itMobileLineCustodyService.assign(LINE, { employeeId: EMPLOYEE }, ctx, scope);

    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow(/reactivate/);
    expect(mocks.createAssignment).not.toHaveBeenCalled();
    expect(mocks.createReceipt).not.toHaveBeenCalled();
  });

  it('refuses a line somebody already holds', async () => {
    mocks.getLineForUpdate.mockResolvedValue(line('assigned'));

    const attempt = itMobileLineCustodyService.assign(LINE, { employeeId: EMPLOYEE }, ctx, scope);

    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    expect(mocks.createAssignment).not.toHaveBeenCalled();
  });
});

describe('handing a line to a car', () => {
  beforeEach(() => {
    mocks.getLineForUpdate.mockResolvedValue(line('inStock'));
  });

  it('writes the car as given and no paper — a car signs nothing, and HR is not asked', async () => {
    const { receipt, assignment } = await itMobileLineCustodyService.assign(
      LINE,
      { vehicleCode: '150', vehiclePlate: 'س ص 63' },
      ctx,
      scope,
    );

    expect(receipt).toBeNull();
    expect(mocks.createReceipt).not.toHaveBeenCalled();
    expect(mocks.numberFor).not.toHaveBeenCalled();
    expect(mocks.claimNumber).not.toHaveBeenCalled();
    expect(mocks.readReceiptHolder).not.toHaveBeenCalled();
    expect(assignment).toMatchObject({
      holderKind: 'vehicle',
      assignedToEmployeeId: null,
      vehicleCode: '150',
      vehiclePlate: 'س ص 63',
      receiptId: null,
    });
    const [entry] = mocks.appendEvent.mock.calls[0] as [{ metadata: Record<string, unknown> }];
    expect(entry.metadata).toMatchObject({
      holderKind: 'vehicle',
      employeeId: null,
      vehicleCode: '150',
      receiptId: null,
      formNumber: null,
    });
  });
});

describe('the paper printed before the hand-over', () => {
  it('refuses what the hand-over would, and takes its number only once nothing refused', async () => {
    mocks.findLine.mockResolvedValue(line('suspended'));
    await expect(
      itMobileLineReceiptService.preview({ lineId: LINE, employeeId: EMPLOYEE }, scope),
    ).rejects.toThrow(/reactivate/);
    expect(mocks.nextNumber).not.toHaveBeenCalled();

    mocks.findLine.mockResolvedValue(line('inStock'));
    const paper = await itMobileLineReceiptService.preview(
      { lineId: LINE, employeeId: EMPLOYEE },
      scope,
    );
    expect(paper.formNumber).toBe(42);
    expect(paper.line).toMatchObject({ assignmentId: null, phoneNumber: '01034455917' });
  });

  it('refuses a leaver before it reads the line', async () => {
    mocks.readReceiptHolder.mockResolvedValue(holderFor('exited'));
    await expect(
      itMobileLineReceiptService.preview({ lineId: LINE, employeeId: EMPLOYEE }, scope),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mocks.findLine).not.toHaveBeenCalled();
    expect(mocks.nextNumber).not.toHaveBeenCalled();
  });
});

describe('return', () => {
  it('closes the open interval and puts the line back in stock', async () => {
    mocks.getLineForUpdate.mockResolvedValue(line('assigned'));
    const at = new Date('2026-10-15T08:00:00.000Z');

    await itMobileLineCustodyService.returnLine(LINE, { returnedAt: at }, ctx, scope);

    expect(mocks.updateAssignment).toHaveBeenCalledWith(
      String(OPEN),
      { returnedAt: at, returnedToUserId: new Types.ObjectId((ctx as { userId: string }).userId) },
      expect.objectContaining({ version: 0 }),
    );
    expect(mocks.updateLine).toHaveBeenCalledWith(
      LINE,
      { status: 'inStock', currentAssignmentId: null },
      expect.objectContaining({ version: 3 }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'return' }));
  });

  it('refuses a return dated before the hand-over it closes', async () => {
    mocks.getLineForUpdate.mockResolvedValue(line('assigned'));
    const attempt = itMobileLineCustodyService.returnLine(
      LINE,
      { returnedAt: new Date('2026-09-01T08:00:00.000Z') },
      ctx,
      scope,
    );
    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mocks.updateAssignment).not.toHaveBeenCalled();
  });

  it('refuses a line nobody holds', async () => {
    mocks.getLineForUpdate.mockResolvedValue(line('inStock'));
    await expect(
      itMobileLineCustodyService.returnLine(LINE, {}, ctx, scope),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mocks.findOpenForLine).not.toHaveBeenCalled();
  });
});

describe('suspend and reactivate', () => {
  it('suspends a line in stock, audited as a status change', async () => {
    mocks.getLineForUpdate.mockResolvedValue(line('inStock'));

    await itMobileLineCustodyService.suspend(LINE, { notes: 'lost SIM' }, ctx, scope);

    expect(mocks.updateLine).toHaveBeenCalledWith(
      LINE,
      { status: 'suspended' },
      expect.objectContaining({ version: 3 }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'statusChange',
        changes: [{ field: 'status', old: 'inStock', new: 'suspended' }],
      }),
    );
    const [entry] = mocks.appendEvent.mock.calls[0] as [{ type: string; notes: string }];
    expect(entry).toMatchObject({ type: 'suspended', notes: 'lost SIM' });
  });

  it('refuses to suspend a line somebody holds — it is returned first', async () => {
    mocks.getLineForUpdate.mockResolvedValue(line('assigned'));
    await expect(itMobileLineCustodyService.suspend(LINE, {}, ctx, scope)).rejects.toThrow(
      /return it before suspending/,
    );
    expect(mocks.updateLine).not.toHaveBeenCalled();
  });

  it('refuses to suspend a line twice', async () => {
    mocks.getLineForUpdate.mockResolvedValue(line('suspended'));
    await expect(itMobileLineCustodyService.suspend(LINE, {}, ctx, scope)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('reactivates a suspended line into stock, and nothing else', async () => {
    mocks.getLineForUpdate.mockResolvedValue(line('suspended'));
    await itMobileLineCustodyService.reactivate(LINE, {}, ctx, scope);
    expect(mocks.updateLine).toHaveBeenCalledWith(LINE, { status: 'inStock' }, expect.anything());
    const [entry] = mocks.appendEvent.mock.calls[0] as [{ type: string }];
    expect(entry.type).toBe('reactivated');

    vi.clearAllMocks();
    mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) =>
      fn({}),
    );
    mocks.getLineForUpdate.mockResolvedValue(line('inStock'));
    await expect(itMobileLineCustodyService.reactivate(LINE, {}, ctx, scope)).rejects.toThrow(
      /not suspended/,
    );
    expect(mocks.updateLine).not.toHaveBeenCalled();
  });
});

describe('an employee leaving the company', () => {
  it('records every line they still hold — and returns none of them', async () => {
    const lines = [new Types.ObjectId(), new Types.ObjectId()];
    mocks.listOpenForEmployee.mockResolvedValue(lines.map((lineId) => ({ lineId })));

    expect(await itMobileLineCustodyService.flagMobileLinesHeldByExitedEmployee(EMPLOYEE)).toBe(2);

    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityRef: { moduleId: 'it', entityType: 'mobileLine', entityId: String(lines[0]) },
        action: 'alertRaised',
      }),
    );
    expect(mocks.updateAssignment).not.toHaveBeenCalled();
  });
});
