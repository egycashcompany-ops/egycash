// Custody is handed only to somebody who works here today — «فى حاله الاضافه اللى موجود بس».
//
// The holder box on assign and transfer offers the employed alone, while the custody register's
// search finds leavers too. So the rule cannot live in which list a box loads: it is asserted here,
// on the two actions that hand an asset to somebody, with the data layer mocked so what is tested
// is the decision — who is refused, who is not, and that a refusal writes nothing.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DirectoryEmployee } from '../../../platform/directory';
import { BusinessRuleError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  getDirectoryEmployee: vi.fn(),
  unitOfWork: vi.fn(),
  getByIdForUpdate: vi.fn(),
  updateAsset: vi.fn(),
  findOpenForAsset: vi.fn(),
  createAssignment: vi.fn(),
  updateAssignment: vi.fn(),
}));

vi.mock('../../../platform/directory', () => ({
  getDirectoryEmployee: mocks.getDirectoryEmployee,
}));
vi.mock('../../../platform/kernel/unit-of-work', () => ({ unitOfWork: mocks.unitOfWork }));
vi.mock('../../../platform/kernel/event-bus', () => ({ emit: vi.fn(async () => undefined) }));
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

const ASSET = String(new Types.ObjectId());
const BRANCH = new Types.ObjectId();
const OTHER_BRANCH = String(new Types.ObjectId());
const HOLDER = new Types.ObjectId();
const NEWCOMER = String(new Types.ObjectId());

const ctx = {
  userId: String(new Types.ObjectId()),
  locale: 'ar',
  identity: { displayName: { ar: 'فني', en: 'Technician' } },
} as never;
const scope = {} as never;

const person = (status: DirectoryEmployee['status']): DirectoryEmployee => ({
  employeeId: NEWCOMER,
  code: '0100026',
  fullNameAr: 'مصطفى عثمان محمود',
  status,
  branchId: String(BRANCH),
  departmentId: null,
  phone: null,
  governorate: null,
  hiredAt: null,
  address: null,
});

const asset = (status: 'inStock' | 'assigned') => ({
  _id: new Types.ObjectId(ASSET),
  assetCode: 'IT-000042',
  status,
  branchId: BRANCH,
  __v: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  // The real unit of work opens a Mongo transaction; here it simply runs the body.
  mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) => fn({}));
  mocks.findOpenForAsset.mockResolvedValue({
    _id: new Types.ObjectId(),
    assignedToEmployeeId: HOLDER,
    assignedAt: new Date('2026-01-01T08:00:00.000Z'),
    __v: 0,
  });
  mocks.createAssignment.mockResolvedValue({ _id: new Types.ObjectId() });
  mocks.updateAssignment.mockResolvedValue({});
  mocks.updateAsset.mockResolvedValue(asset('assigned'));
});

describe('assign', () => {
  beforeEach(() => {
    mocks.getByIdForUpdate.mockResolvedValue(asset('inStock'));
  });

  it('refuses an employee HR says has left — before anything is written', async () => {
    mocks.getDirectoryEmployee.mockResolvedValue(person('exited'));

    const attempt = itAssetCustodyService.assign(ASSET, { employeeId: NEWCOMER }, ctx, scope);

    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow(/0100026 has left/);
    expect(mocks.getDirectoryEmployee).toHaveBeenCalledWith(NEWCOMER);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
    expect(mocks.createAssignment).not.toHaveBeenCalled();
  });

  // «اللى موجود» is everybody still employed — on leave and suspended included, exactly the
  // population the hand-over box offers (`employed=true`).
  for (const status of ['probation', 'active', 'onLeave', 'suspended'] as const) {
    it(`hands custody to an employee who is ${status}`, async () => {
      mocks.getDirectoryEmployee.mockResolvedValue(person(status));

      await itAssetCustodyService.assign(ASSET, { employeeId: NEWCOMER }, ctx, scope);

      expect(mocks.createAssignment).toHaveBeenCalledTimes(1);
    });
  }

  it('leaves an id the directory cannot read exactly as it was — accepted', async () => {
    // No HR source, or a person HR does not know: the rule adds the one fact HR can state, not a
    // new dependency on HR answering.
    mocks.getDirectoryEmployee.mockResolvedValue(null);

    await itAssetCustodyService.assign(ASSET, { employeeId: NEWCOMER }, ctx, scope);

    expect(mocks.createAssignment).toHaveBeenCalledTimes(1);
  });
});

describe('transfer', () => {
  beforeEach(() => {
    mocks.getByIdForUpdate.mockResolvedValue(asset('assigned'));
  });

  it('refuses to hand the asset to an employee who has left — the open interval stays open', async () => {
    mocks.getDirectoryEmployee.mockResolvedValue(person('exited'));

    const attempt = itAssetCustodyService.transfer(ASSET, { toEmployeeId: NEWCOMER }, ctx, scope);

    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mocks.updateAssignment).not.toHaveBeenCalled();
    expect(mocks.createAssignment).not.toHaveBeenCalled();
  });

  it('hands the asset to a current employee', async () => {
    mocks.getDirectoryEmployee.mockResolvedValue(person('active'));

    await itAssetCustodyService.transfer(ASSET, { toEmployeeId: NEWCOMER }, ctx, scope);

    expect(mocks.createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ assignedToEmployeeId: new Types.ObjectId(NEWCOMER) }),
      expect.anything(),
    );
  });

  // Moving an asset between branches in the SAME hands hands it to nobody, even when those hands
  // have since left: the return is still owed, and refusing the move brings it no closer.
  it('still moves a departed holder’s asset to another branch', async () => {
    await itAssetCustodyService.transfer(ASSET, { toBranchId: OTHER_BRANCH }, ctx, scope);

    expect(mocks.getDirectoryEmployee).not.toHaveBeenCalled();
    expect(mocks.createAssignment).toHaveBeenCalledTimes(1);
  });

  it('and does so when the same departed holder is named explicitly', async () => {
    mocks.getDirectoryEmployee.mockResolvedValue({
      ...person('exited'),
      employeeId: String(HOLDER),
    });

    await itAssetCustodyService.transfer(
      ASSET,
      { toEmployeeId: String(HOLDER), toBranchId: OTHER_BRANCH },
      ctx,
      scope,
    );

    expect(mocks.createAssignment).toHaveBeenCalledTimes(1);
  });
});
