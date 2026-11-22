// Department custody as the custody service decides it (2026-11-19) — «عند تسليم الأصول … إنى
// مأسلمش لموظف ولكن أعينها فى مكان بس تبقى على عهده الإدارة .. زى السيرفرات والكاميرات والسويتشات».
//
// With the data layer mocked (the custody specs' posture), what is pinned is the decision: a
// department hand-over opens the department's intervals — never the signer's — on ONE paper signed
// by the responsible person and naming the department and the place; every refusal (a department
// or place not live, a signer who left, an asset outside the place's branch) comes before anything
// is written; a transfer is a new holder whenever the department, the place or the signer changes,
// and a place does not travel to another branch; «نقل إلى فرع» refuses a department-held asset;
// a return takes it back; and a leaving signer is flagged while the custody stands.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItEvents } from '@ecms/contracts';
import { AppError, BusinessRuleError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  readReceiptHolder: vi.fn(),
  unitOfWork: vi.fn(),
  getByIdForUpdate: vi.fn(),
  updateAsset: vi.fn(),
  findOpenForAsset: vi.fn(),
  createAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  listOpenForEmployee: vi.fn(),
  listOpenSignedBy: vi.fn(),
  createReceipt: vi.fn(),
  appendHistory: vi.fn(),
  record: vi.fn(),
  recordMany: vi.fn(),
  emit: vi.fn(),
  findDepartments: vi.fn(),
  findLocations: vi.fn(),
  findBranch: vi.fn(),
}));

vi.mock('./receipt-holder', () => ({ readReceiptHolder: mocks.readReceiptHolder }));
vi.mock('./receipt.repository', () => ({
  itCustodyReceiptRepository: {
    create: mocks.createReceipt,
    ensureCollection: vi.fn(async () => undefined),
  },
}));
vi.mock('./receipt-number', () => ({
  receiptNumberFor: async (printed?: number) => printed ?? 41,
  claimReceiptNumber: async () => undefined,
}));
vi.mock('./receipt-device', () => ({
  readDeviceTypesOf: async () => new Map(),
  receiptDeviceFields: () => ({}),
}));
vi.mock('../../../platform/organization', () => ({
  branchRepository: { findById: mocks.findBranch, listAll: vi.fn(async () => []) },
  departmentRepository: { findByIdsSystem: mocks.findDepartments },
}));
vi.mock('../locations/location.repository', () => ({
  itLocationRepository: { findByIdsSystem: mocks.findLocations },
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
    listOpenForEmployee: mocks.listOpenForEmployee,
    listOpenSignedBy: mocks.listOpenSignedBy,
  },
}));
vi.mock('./asset-event.repository', () => ({
  itAssetEventRepository: { append: mocks.appendHistory },
}));
vi.mock('../maintenance/order.repository', () => ({
  itMaintenanceOrderRepository: { hasActiveForAsset: vi.fn(async () => false) },
}));

const { itAssetCustodyService } = await import('./custody.service');

const OCTOBER = new Types.ObjectId();
const TANTA = new Types.ObjectId();
const IT = new Types.ObjectId();
const SERVER_ROOM = new Types.ObjectId();
const CAMERA_ROOM = new Types.ObjectId();
const TANTA_ROOM = new Types.ObjectId();
const SIGNER = new Types.ObjectId();
const NEW_SIGNER = new Types.ObjectId();
const EMPLOYEE = new Types.ObjectId();
const SERVER = String(new Types.ObjectId());
const SWITCH = String(new Types.ObjectId());
const OPEN_INTERVAL = new Types.ObjectId();
const OLD_RECEIPT = new Types.ObjectId();

const ctx = {
  userId: String(new Types.ObjectId()),
  locale: 'ar',
  identity: { displayName: { ar: 'فني', en: 'Technician' } },
  permissions: { 'itAsset.assign': 'organization' },
} as never;
const scope = { scope: 'organization' } as never;

const department = (over: Record<string, unknown> = {}) => ({
  departmentId: String(IT),
  locationId: String(SERVER_ROOM),
  responsibleEmployeeId: String(SIGNER),
  ...over,
});

const asset = (id: string, over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(id),
  assetCode: id === SERVER ? 'AST-00101' : 'AST-00102',
  name: id === SERVER ? 'Dell PowerEdge R740' : 'Cisco Catalyst 2960',
  serialNumber: null,
  status: 'inStock',
  branchId: OCTOBER,
  location: null,
  __v: 0,
  ...over,
});

let stored: Record<string, ReturnType<typeof asset>>;

/** The open interval of a department-held server: IT at the server room, signed for by SIGNER. */
const departmentInterval = (over: Record<string, unknown> = {}) => ({
  _id: OPEN_INTERVAL,
  holderKind: 'department',
  assignedToEmployeeId: null,
  departmentId: IT,
  locationId: SERVER_ROOM,
  responsibleEmployeeId: SIGNER,
  assignedAt: new Date('2026-11-01T08:00:00.000Z'),
  conditionOnIssue: 'جديد',
  expectedReturnAt: null,
  notes: null,
  receiptId: OLD_RECEIPT,
  branchId: OCTOBER,
  __v: 0,
  ...over,
});

const signerAnswer = (status = 'active') => ({
  employee: { code: '0300001', status },
  employeeCode: '0300001',
  employeeName: 'وليد صفوت جلال',
  jobTitle: { ar: 'مهندس شبكات', en: 'Network engineer' },
  nationalId: '28001010101010',
  section: null,
  department: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
});

/** The 422 field issue a refusal carries — its field and code. */
const issueOf = async (attempt: Promise<unknown>) => {
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  const app = error as AppError;
  expect(app.httpStatus).toBe(422);
  return app.details?.[0];
};

beforeEach(() => {
  vi.clearAllMocks();
  stored = { [SERVER]: asset(SERVER), [SWITCH]: asset(SWITCH) };
  mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) => fn({}));
  mocks.getByIdForUpdate.mockImplementation(async (id: string) => stored[id]);
  mocks.updateAsset.mockImplementation(async (id: string, set: Record<string, unknown>) => ({
    ...stored[id],
    ...set,
  }));
  mocks.findOpenForAsset.mockResolvedValue(null);
  mocks.createAssignment.mockImplementation(async (data: Record<string, unknown>) => ({
    ...data,
    _id: new Types.ObjectId(),
  }));
  mocks.updateAssignment.mockResolvedValue({});
  mocks.createReceipt.mockImplementation(async (data: Record<string, unknown>) => data);
  mocks.readReceiptHolder.mockResolvedValue(signerAnswer());
  mocks.findDepartments.mockResolvedValue([
    { _id: IT, name: { ar: 'تكنولوجيا المعلومات', en: 'IT' }, status: 'active', isDeleted: false },
  ]);
  mocks.findLocations.mockImplementation(async ([id]: string[]) => {
    const rooms = new Map([
      [String(SERVER_ROOM), { ar: 'غرفة السيرفرات', en: 'Server room', branch: OCTOBER }],
      [String(CAMERA_ROOM), { ar: 'غرفة الكاميرات', en: 'Camera room', branch: OCTOBER }],
      [String(TANTA_ROOM), { ar: 'غرفة السيرفرات', en: 'Server room', branch: TANTA }],
    ]);
    const room = rooms.get(String(id));
    return room === undefined
      ? []
      : [
          {
            _id: new Types.ObjectId(id),
            branchId: room.branch,
            name: { ar: room.ar, en: room.en },
            isActive: true,
            isDeleted: false,
          },
        ];
  });
  mocks.findBranch.mockResolvedValue({ status: 'active' });
  mocks.listOpenForEmployee.mockResolvedValue([]);
  mocks.listOpenSignedBy.mockResolvedValue([]);
});

describe('a hand-over to a department at a place — «في عهدة إدارة …»', () => {
  it('opens the department’s intervals — never the signer’s — on ONE paper the signer signs', async () => {
    const { receipt, assignments } = await itAssetCustodyService.handOver(
      { department: department(), lines: [{ assetId: SERVER }, { assetId: SWITCH }] },
      ctx,
      scope,
    );

    expect(assignments).toHaveLength(2);
    for (const interval of mocks.createAssignment.mock.calls.map((call) => call[0])) {
      expect(interval).toMatchObject({ holderKind: 'department', assignedToEmployeeId: null });
      expect(String(interval.departmentId)).toBe(String(IT));
      expect(String(interval.locationId)).toBe(String(SERVER_ROOM));
      expect(String(interval.responsibleEmployeeId)).toBe(String(SIGNER));
    }
    // The paper: signed by the responsible person, for the department at the place, in its branch.
    expect(String(receipt.employeeId)).toBe(String(SIGNER));
    expect(receipt.employeeName).toBe('وليد صفوت جلال');
    expect(String(receipt.branchId)).toBe(String(OCTOBER));
    expect(receipt.custodian).toMatchObject({
      departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
      locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
    });
    expect(String(receipt.custodian?.departmentId)).toBe(String(IT));
    expect(String(receipt.custodian?.locationId)).toBe(String(SERVER_ROOM));
    // HR is asked about the signer.
    expect(mocks.readReceiptHolder).toHaveBeenCalledWith(String(SIGNER));
  });

  it('records the department on the history, the audit and the event — no employee holder', async () => {
    await itAssetCustodyService.handOver(
      { department: department(), lines: [{ assetId: SERVER }] },
      ctx,
      scope,
    );

    const [entry] = mocks.appendHistory.mock.calls[0] as [{ metadata: Record<string, unknown> }];
    expect(entry.metadata).toMatchObject({
      holderKind: 'department',
      departmentId: String(IT),
      locationId: String(SERVER_ROOM),
      responsibleEmployeeId: String(SIGNER),
    });
    expect(entry.metadata).not.toHaveProperty('employeeId');

    const audits = mocks.record.mock.calls.map((call) => call[0]) as {
      action: string;
      changes: { field: string; new: unknown }[];
    }[];
    const assign = audits.find((row) => row.action === 'assign');
    expect(assign?.changes.map((c) => c.field)).toEqual([
      'status',
      'holderKind',
      'departmentId',
      'locationId',
      'responsibleEmployeeId',
    ]);
    const paper = audits.find((row) => row.action === 'create');
    expect(paper?.changes.map((c) => [c.field, c.new])).toEqual([
      ['employeeId', String(SIGNER)],
      ['departmentId', String(IT)],
      ['locationId', String(SERVER_ROOM)],
      ['assets', ['AST-00101']],
    ]);

    expect(mocks.emit).toHaveBeenCalledWith(
      ItEvents.AssetAssigned,
      expect.objectContaining({
        employeeId: null,
        holderKind: 'department',
        departmentId: String(IT),
        locationId: String(SERVER_ROOM),
        responsibleEmployeeId: String(SIGNER),
      }),
    );
  });

  it('refuses every asset outside the place’s branch — naming each — before anything is written', async () => {
    stored[SWITCH] = asset(SWITCH, { branchId: TANTA });
    const issue = await issueOf(
      itAssetCustodyService.handOver(
        { department: department(), lines: [{ assetId: SERVER }, { assetId: SWITCH }] },
        ctx,
        scope,
      ),
    );
    expect(issue).toMatchObject({ field: 'body.department.locationId', code: 'OTHER_BRANCH' });
    expect(issue?.message).toContain('AST-00102');
    expect(issue?.message).not.toContain('AST-00101');
    expect(mocks.createAssignment).not.toHaveBeenCalled();
    expect(mocks.createReceipt).not.toHaveBeenCalled();
  });

  it('refuses a department or a place that is unknown or not live — on its own field', async () => {
    mocks.findDepartments.mockResolvedValueOnce([]);
    expect(
      await issueOf(
        itAssetCustodyService.handOver(
          { department: department(), lines: [{ assetId: SERVER }] },
          ctx,
          scope,
        ),
      ),
    ).toMatchObject({ field: 'body.department.departmentId', code: 'UNKNOWN' });

    mocks.findDepartments.mockResolvedValueOnce([
      { _id: IT, name: { ar: 'x', en: 'x' }, status: 'inactive', isDeleted: false },
    ]);
    expect(
      await issueOf(
        itAssetCustodyService.handOver(
          { department: department(), lines: [{ assetId: SERVER }] },
          ctx,
          scope,
        ),
      ),
    ).toMatchObject({ field: 'body.department.departmentId', code: 'INACTIVE' });

    expect(
      await issueOf(
        itAssetCustodyService.handOver(
          { department: department({ locationId: String(new Types.ObjectId()) }), lines: [] },
          ctx,
          scope,
        ),
      ),
    ).toMatchObject({ field: 'body.department.locationId', code: 'UNKNOWN' });

    mocks.findLocations.mockResolvedValueOnce([
      { _id: SERVER_ROOM, branchId: OCTOBER, name: { ar: 'x', en: 'x' }, isActive: false },
    ]);
    expect(
      await issueOf(
        itAssetCustodyService.handOver(
          { department: department(), lines: [{ assetId: SERVER }] },
          ctx,
          scope,
        ),
      ),
    ).toMatchObject({ field: 'body.department.locationId', code: 'INACTIVE' });
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });

  it('refuses a responsible person who has left — custody is signed for by a current employee', async () => {
    mocks.readReceiptHolder.mockResolvedValue(signerAnswer('exited'));
    const attempt = itAssetCustodyService.handOver(
      { department: department(), lines: [{ assetId: SERVER }] },
      ctx,
      scope,
    );
    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toThrow(/signed for by a current employee/);
    expect(mocks.unitOfWork).not.toHaveBeenCalled();
  });

  it('the single-asset assign hands to a department the same way', async () => {
    const { assignment } = await itAssetCustodyService.assign(
      SERVER,
      { department: department() },
      ctx,
      scope,
    );
    expect(assignment).toMatchObject({ holderKind: 'department', assignedToEmployeeId: null });
  });
});

describe('a transfer with a department on either side', () => {
  beforeEach(() => {
    stored[SERVER] = asset(SERVER, { status: 'assigned' });
    mocks.findOpenForAsset.mockResolvedValue(departmentInterval());
  });

  it('department → employee: a new holder, a new paper, the department on the history', async () => {
    mocks.readReceiptHolder.mockResolvedValue({
      ...signerAnswer(),
      employeeName: 'شريف ممدوح فاروق',
    });
    await itAssetCustodyService.transfer(SERVER, { toEmployeeId: String(EMPLOYEE) }, ctx, scope);

    const [next] = mocks.createAssignment.mock.calls[0] as [Record<string, unknown>];
    expect(next).toMatchObject({ holderKind: 'employee', departmentId: null, locationId: null });
    expect(String(next.assignedToEmployeeId)).toBe(String(EMPLOYEE));
    // Nothing carried over from the department's custody.
    expect(next.conditionOnIssue).toBeNull();
    const [paper] = mocks.createReceipt.mock.calls[0] as [Record<string, unknown>];
    expect(String(paper.employeeId)).toBe(String(EMPLOYEE));
    expect(paper.custodian).toBeNull();

    const [entry] = mocks.appendHistory.mock.calls[0] as [{ metadata: Record<string, unknown> }];
    expect(entry.metadata).toMatchObject({
      fromDepartmentId: String(IT),
      fromLocationId: String(SERVER_ROOM),
      fromResponsibleEmployeeId: String(SIGNER),
      toEmployeeId: String(EMPLOYEE),
    });
    expect(entry.metadata).not.toHaveProperty('fromEmployeeId');
    expect(mocks.emit).toHaveBeenCalledWith(
      ItEvents.AssetTransferred,
      expect.objectContaining({
        fromEmployeeId: null,
        toEmployeeId: String(EMPLOYEE),
        fromDepartmentId: String(IT),
        toDepartmentId: null,
        fromLocationId: String(SERVER_ROOM),
        toLocationId: null,
      }),
    );
  });

  it('employee → department: the department’s interval, its paper signed by the responsible person', async () => {
    mocks.findOpenForAsset.mockResolvedValue({
      ...departmentInterval(),
      holderKind: undefined,
      assignedToEmployeeId: EMPLOYEE,
      departmentId: undefined,
      locationId: undefined,
      responsibleEmployeeId: undefined,
    });
    await itAssetCustodyService.transfer(SERVER, { toDepartment: department() }, ctx, scope);

    const [next] = mocks.createAssignment.mock.calls[0] as [Record<string, unknown>];
    expect(next).toMatchObject({ holderKind: 'department', assignedToEmployeeId: null });
    const [paper] = mocks.createReceipt.mock.calls[0] as [Record<string, unknown>];
    expect(String(paper.employeeId)).toBe(String(SIGNER));
    expect(paper.custodian).toMatchObject({
      locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
    });
    const rows = mocks.record.mock.calls.map((call) => call[0]) as {
      action: string;
      changes: { field: string; old: unknown; new: unknown }[];
    }[];
    const transfer = rows.find((row) => row.action === 'transfer');
    expect(transfer?.changes).toContainEqual({ field: 'holder', old: String(EMPLOYEE), new: null });
    expect(transfer?.changes).toContainEqual({
      field: 'holderKind',
      old: null,
      new: 'department',
    });
  });

  it('a move to another room, and signing again after the signer left, are new holders', async () => {
    await itAssetCustodyService.transfer(
      SERVER,
      { toDepartment: department({ locationId: String(CAMERA_ROOM) }) },
      ctx,
      scope,
    );
    expect(mocks.createReceipt).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.unitOfWork.mockImplementation(async (fn: (session: unknown) => Promise<unknown>) =>
      fn({}),
    );
    mocks.readReceiptHolder.mockResolvedValue(signerAnswer());
    mocks.createAssignment.mockImplementation(async (data: Record<string, unknown>) => ({
      ...data,
      _id: new Types.ObjectId(),
    }));
    mocks.createReceipt.mockImplementation(async (data: Record<string, unknown>) => data);
    mocks.findOpenForAsset.mockResolvedValue(departmentInterval());
    mocks.updateAsset.mockImplementation(async (id: string) => stored[id]);
    await itAssetCustodyService.transfer(
      SERVER,
      { toDepartment: department({ responsibleEmployeeId: String(NEW_SIGNER) }) },
      ctx,
      scope,
    );
    const [paper] = mocks.createReceipt.mock.calls[0] as [Record<string, unknown>];
    expect(String(paper.employeeId)).toBe(String(NEW_SIGNER));
    const [next] = mocks.createAssignment.mock.calls[0] as [Record<string, unknown>];
    expect(String(next.responsibleEmployeeId)).toBe(String(NEW_SIGNER));
  });

  it('naming the same department, place and signer changes nothing — refused', async () => {
    await expect(
      itAssetCustodyService.transfer(SERVER, { toDepartment: department() }, ctx, scope),
    ).rejects.toThrow(/changes neither/);
  });

  it('a place does not travel: another branch alone is refused; a place there must be there', async () => {
    await expect(
      itAssetCustodyService.transfer(SERVER, { toBranchId: String(TANTA) }, ctx, scope),
    ).rejects.toThrow(/held by a department at a place in its branch/);

    // A place in Tanta, without naming Tanta: the place is in another branch than the asset's.
    expect(
      await issueOf(
        itAssetCustodyService.transfer(
          SERVER,
          { toDepartment: department({ locationId: String(TANTA_ROOM) }) },
          ctx,
          scope,
        ),
      ),
    ).toMatchObject({ field: 'body.toDepartment.locationId', code: 'OTHER_BRANCH' });

    // …and naming Tanta with Tanta's place goes.
    await itAssetCustodyService.transfer(
      SERVER,
      { toBranchId: String(TANTA), toDepartment: department({ locationId: String(TANTA_ROOM) }) },
      ctx,
      scope,
    );
    const [next] = mocks.createAssignment.mock.calls.at(-1) as [Record<string, unknown>];
    expect(String(next.branchId)).toBe(String(TANTA));
    expect(String(next.locationId)).toBe(String(TANTA_ROOM));
  });
});

describe('the return of a department’s asset', () => {
  it('is always allowed — the department named on the history, the audit and the event', async () => {
    stored[SERVER] = asset(SERVER, { status: 'assigned' });
    mocks.findOpenForAsset.mockResolvedValue(departmentInterval());
    mocks.updateAssignment.mockResolvedValue(departmentInterval({ returnedAt: new Date() }));
    await itAssetCustodyService.returnAsset(SERVER, {}, ctx, scope);

    const [entry] = mocks.appendHistory.mock.calls[0] as [{ metadata: Record<string, unknown> }];
    expect(entry.metadata).toMatchObject({
      holderKind: 'department',
      departmentId: String(IT),
      locationId: String(SERVER_ROOM),
    });
    expect(entry.metadata).not.toHaveProperty('employeeId');
    expect(mocks.emit).toHaveBeenCalledWith(
      ItEvents.AssetReturned,
      expect.objectContaining({ employeeId: null, departmentId: String(IT) }),
    );
    // HR is asked nothing about anybody for a return.
    expect(mocks.readReceiptHolder).not.toHaveBeenCalled();
  });
});

describe('«نقل إلى فرع» and a department-held asset', () => {
  it('refuses it, naming its code — it moves with «نقل» to a place in the new branch', async () => {
    stored[SERVER] = asset(SERVER, { status: 'assigned' });
    mocks.findOpenForAsset.mockResolvedValue(departmentInterval());
    await expect(
      itAssetCustodyService.moveToBranch(
        { assetIds: [SERVER, SWITCH], toBranchId: String(TANTA) } as never,
        ctx,
        scope,
      ),
    ).rejects.toThrow(/asset AST-00101 is held by a department at a place in its branch/);
    expect(mocks.updateAsset).not.toHaveBeenCalled();
  });
});

describe('a responsible person who leaves the company', () => {
  it('flags every department custody they signed for — the custody stands', async () => {
    const intervals = [
      departmentInterval({ assetId: new Types.ObjectId() }),
      departmentInterval({ _id: new Types.ObjectId(), assetId: new Types.ObjectId() }),
    ];
    mocks.listOpenSignedBy.mockResolvedValue(intervals);

    const flagged = await itAssetCustodyService.flagAssetsHeldByExitedEmployee(String(SIGNER));

    expect(flagged).toBe(2);
    expect(mocks.listOpenSignedBy).toHaveBeenCalledWith(String(SIGNER));
    const rows = mocks.record.mock.calls.map((call) => call[0]) as {
      action: string;
      changes: { field: string; new: unknown }[];
    }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.action).toBe('alertRaised');
      expect(row.changes).toEqual([{ field: 'responsibleExited', old: null, new: String(SIGNER) }]);
    }
    // Nothing returned, nothing written to custody.
    expect(mocks.updateAssignment).not.toHaveBeenCalled();
    expect(mocks.updateAsset).not.toHaveBeenCalled();
  });
});
