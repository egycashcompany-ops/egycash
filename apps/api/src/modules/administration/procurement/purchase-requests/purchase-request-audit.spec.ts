// A purchase request's trail (P2 plan §10, §12.1; P2.2's share): the literal ref the realtime
// registry scans for; a `create` row of the request's facts, the requester as ids and the lines
// summarized; an `update` row of what an edit changed, and nothing for a save that changed none;
// and after every audited act one `update` signal carrying the request's branch, which a
// department requester's room hears and the audit row alone (no branch) never reaches. The
// `consumable-history.spec.ts` posture: the platform's audit and realtime mocked.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdministrationPurchaseRequestDoc } from './purchase-request.model';

const mocks = vi.hoisted(() => ({ record: vi.fn(), publish: vi.fn() }));

vi.mock('../../../../platform/audit', () => ({ auditService: { record: mocks.record } }));
vi.mock('../../../../platform/realtime', () => ({ publishAuditedChange: mocks.publish }));

const {
  auditPurchaseRequestCreated,
  auditPurchaseRequestEdited,
  purchaseRequestEntityRef,
  signalPurchaseRequest,
} = await import('./purchase-request-audit');

const HERE = dirname(fileURLToPath(import.meta.url));
const AT = new Date('2026-11-24T09:00:00.000Z');
const BRANCH = new Types.ObjectId('64a0000000000000000000b1');
const DEPARTMENT = new Types.ObjectId('64a0000000000000000000d1');
const USER = new Types.ObjectId('64a0000000000000000000a1');
const EMPLOYEE = new Types.ObjectId('64a0000000000000000000e1');
const ITEM = new Types.ObjectId('64a0000000000000000000c1');
const UNIT = new Types.ObjectId('64a0000000000000000000c9');

const request = (
  over: Partial<AdministrationPurchaseRequestDoc> = {},
): AdministrationPurchaseRequestDoc => ({
  _id: new Types.ObjectId('64a0000000000000000000f1'),
  number: null,
  status: 'draft',
  orderStatus: 'notOrdered',
  branchId: BRANCH,
  departmentId: DEPARTMENT,
  requesterUserId: USER,
  requesterEmployeeId: EMPLOYEE,
  requesterName: 'منسق الإدارة',
  requester: {
    employeeCode: 'E-1',
    jobTitle: null,
    departmentId: DEPARTMENT,
    departmentName: { ar: 'المشتريات', en: 'Purchasing' },
  },
  branch: { code: '80', name: { ar: 'فرع أ', en: 'Branch A' } },
  neededBy: new Date('2026-12-01T00:00:00.000Z'),
  justification: 'مستلزمات',
  notes: null,
  businessDate: null,
  lines: [
    {
      _id: new Types.ObjectId('64a000000000000000000011'),
      itemId: ITEM,
      itemCode: 'ITM-00001',
      itemName: { ar: 'ورق تصوير', en: 'Copy paper' },
      unitName: { ar: 'رزمة', en: 'Ream' },
      unitId: UNIT,
      qty: 5,
      orderedQty: 0,
      cancelledQty: 0,
      notes: null,
    },
  ],
  attachments: [],
  approvalRequestType: null,
  approvalWorkflowId: null,
  approvalChainShape: [],
  approvalSteps: [],
  approvalRounds: [],
  submittedBy: null,
  submittedAt: null,
  approvedAt: null,
  approvedByUserId: null,
  rejectedAt: null,
  rejectedByUserId: null,
  returnedAt: null,
  returnedByUserId: null,
  returnReason: null,
  cancelledAt: null,
  cancelledByUserId: null,
  cancelReason: null,
  schemaVersion: 1,
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
  createdBy: USER,
  updatedBy: USER,
  createdAt: AT,
  updatedAt: AT,
  __v: 0,
  ...over,
});

const recorded = () =>
  mocks.record.mock.calls.map(
    // A mock's calls are untyped; each is the one entry `auditService.record` was handed.
    ([entry]) =>
      entry as {
        entityRef: Record<string, string>;
        action: string;
        changes: { field: string; old: unknown; new: unknown }[];
      },
  );

/** Each signal sent, as `publishAuditedChange` received it. */
const signals = () =>
  // A mock's calls are untyped; each is the one change `publishAuditedChange` was handed.
  mocks.publish.mock.calls.map(([signal]) => signal as Record<string, unknown>);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.record.mockResolvedValue(undefined);
});

describe('the request’s entity ref', () => {
  it('is a literal pair — the realtime registry classifies `administration.purchaseRequest`', () => {
    expect(purchaseRequestEntityRef('x')).toEqual({
      moduleId: 'administration',
      entityType: 'purchaseRequest',
      entityId: 'x',
    });
    const source = readFileSync(join(HERE, 'purchase-request-audit.ts'), 'utf8');
    expect(source).toMatch(/moduleId:\s*'administration',\s*entityType:\s*'purchaseRequest'/);
  });

  it('the signal is an `update` WITH the request’s branch', () => {
    signalPurchaseRequest('r1', String(BRANCH));
    expect(signals()).toEqual([
      expect.objectContaining({
        entityRef: purchaseRequestEntityRef('r1'),
        action: 'update',
        branchId: String(BRANCH),
      }),
    ]);
  });
});

describe('create (design §10.2)', () => {
  it('records one `create` row of the request’s facts, then signals its branch', async () => {
    await auditPurchaseRequestCreated(request());
    const [row] = recorded();
    expect(recorded()).toHaveLength(1);
    expect(row?.action).toBe('create');
    expect(row?.entityRef).toEqual(purchaseRequestEntityRef('64a0000000000000000000f1'));
    expect(Object.fromEntries((row?.changes ?? []).map((c) => [c.field, c.new]))).toEqual({
      status: 'draft',
      orderStatus: 'notOrdered',
      branchId: String(BRANCH),
      departmentId: String(DEPARTMENT),
      requesterUserId: String(USER),
      requesterEmployeeId: String(EMPLOYEE),
      neededBy: '2026-12-01',
      justification: 'مستلزمات',
      // The lines summarized: the item's code, the quantity, the notes (design §10.1).
      lines: [{ itemCode: 'ITM-00001', qty: 5, notes: null }],
    });
    expect(signals()).toEqual([expect.objectContaining({ branchId: String(BRANCH) })]);
  });

  it('copies no person’s name into the trail — HR’s permanent delete never rewrites it', async () => {
    await auditPurchaseRequestCreated(request());
    expect(JSON.stringify(recorded())).not.toContain('منسق الإدارة');
  });
});

describe('a draft’s edit (design §10.2)', () => {
  it('records one `update` row of what changed, then signals the branch', async () => {
    const before = request();
    const after = request({
      notes: 'تسليم المخزن الرئيسي',
      lines: [
        { ...(before.lines[0] as AdministrationPurchaseRequestDoc['lines'][number]), qty: 7 },
      ],
      __v: 1,
    });
    await auditPurchaseRequestEdited(before, after);
    expect(recorded().map((row) => row.action)).toEqual(['update']);
    expect(recorded()[0]?.changes).toEqual([
      { field: 'notes', old: null, new: 'تسليم المخزن الرئيسي' },
      {
        field: 'lines',
        old: [{ itemCode: 'ITM-00001', qty: 5, notes: null }],
        new: [{ itemCode: 'ITM-00001', qty: 7, notes: null }],
      },
    ]);
    expect(signals()).toEqual([expect.objectContaining({ branchId: String(BRANCH) })]);
  });

  it('writes nothing, and signals nothing, for a save that only refreshed the snapshots', async () => {
    const before = request();
    await auditPurchaseRequestEdited(
      before,
      request({ requesterName: 'اسم جديد', branch: { code: '80', name: { ar: 'أ', en: 'A' } } }),
    );
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
