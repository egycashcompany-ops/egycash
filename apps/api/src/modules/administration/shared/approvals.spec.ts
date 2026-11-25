// The module's approval adapter (P2 plan §8.1–§8.2, §12.1; design §5.2, §5.16): the purchase
// request's type registered with the host audit, the Unit read from the document and its copy, the
// subject's entries mapped to the engine's, OD-19 A's three refusals at submission with pair A1 off
// the live rung, and the engine's refusals in the module's words.
//
// The platform barrels are mocked, as the module's isolation spec admits only barrel paths: the
// registry gives no host its audit mode back, so the option is read as the registration's second
// argument (P2 plan §1.2 item 29), and the engine and the organization answer as each case needs.
// The engine's own answers — the pin, the live rung's holders — are the integration suite's.
import { ErrorCodes } from '@ecms/contracts';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, BusinessRuleError } from '../../../shared/errors';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  chainFor: vi.fn(),
  currentApprovers: vi.fn(),
  findDepartment: vi.fn(),
}));

vi.mock('../../../platform/approvals', () => ({
  registerApprovalRequestType: mocks.register,
  approvalService: { chainFor: mocks.chainFor, currentApprovers: mocks.currentApprovers },
  // The engine's two pure readers, as the barrel gives them: a pin is the row and its rungs.
  pinOf: (chain: { workflowId: string | null; steps: unknown[] }) =>
    chain.workflowId === null || chain.steps.length === 0
      ? null
      : { workflowId: chain.workflowId, steps: chain.steps },
  readApprovalPin: (doc: { approvalWorkflowId?: unknown; approvalChainShape?: unknown[] }) =>
    doc.approvalWorkflowId === null || doc.approvalWorkflowId === undefined
      ? null
      : { workflowId: String(doc.approvalWorkflowId), steps: doc.approvalChainShape ?? [] },
}));
vi.mock('../../../platform/organization', () => ({
  departmentRepository: { findById: mocks.findDepartment },
}));

const adapter = await import('./approvals');
// The registration runs once, as the module loads — read before any case resets the mocks.
const registrations = [...mocks.register.mock.calls];

const BRANCH = new Types.ObjectId('64a0000000000000000000b1');
const OTHER_BRANCH = new Types.ObjectId('64a0000000000000000000b2');
const COPY = new Types.ObjectId('64a0000000000000000000d1');
const CATALOG = new Types.ObjectId('64a0000000000000000000c1');
const REQUESTER = '64a0000000000000000000a1';
const APPROVER = '64a0000000000000000000a2';
const SECOND = '64a0000000000000000000a3';
const UNIT = { branchId: String(BRANCH), departmentId: String(COPY), departmentCatalogId: null };
const RUNGS = [
  { permissionKey: 'administrationPurchaseRequest.approve', level: 'unit', label: null },
  { permissionKey: 'administrationPurchaseRequest.approve', level: 'organization', label: null },
];

/** A refusal's code, status and details, as the error handler would send them. */
const refusalOf = async (promise: Promise<unknown>) => {
  const error: unknown = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AppError);
  const app = error as AppError;
  return {
    code: app.code,
    status: app.httpStatus,
    details: app.details?.map((d) => `${d.field ?? ''}:${d.code}`),
  };
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('the request type (ADR-041 decision 7; design §6.4)', () => {
  it('registers the purchase request once, offering `.approve` alone, with the host audit', () => {
    expect(registrations).toEqual([
      [
        {
          key: 'administration.purchaseRequest',
          moduleId: 'administration',
          name: { ar: 'طلبات الشراء', en: 'Purchase requests' },
          permissionKeys: ['administrationPurchaseRequest.approve'],
        },
        { audit: 'host' },
      ],
    ]);
    expect(adapter.PURCHASE_REQUEST_APPROVAL_TYPE).toBe('administration.purchaseRequest');
  });
});

describe('the Unit (design §7.6)', () => {
  it('is the document’s own branch and copy, and the copy’s company department as it is now', async () => {
    mocks.findDepartment.mockResolvedValueOnce({ branchId: BRANCH, catalogId: CATALOG });
    await expect(adapter.approvalUnitOf({ branchId: BRANCH, departmentId: COPY })).resolves.toEqual(
      {
        branchId: String(BRANCH),
        departmentId: String(COPY),
        departmentCatalogId: String(CATALOG),
      },
    );
    expect(mocks.findDepartment).toHaveBeenCalledWith(String(COPY));
  });

  it('is read again at every call: a copy linked since gains its company department', async () => {
    mocks.findDepartment
      .mockResolvedValueOnce({ branchId: BRANCH, catalogId: null })
      .mockResolvedValueOnce({ branchId: BRANCH, catalogId: CATALOG })
      // A copy written before the catalog existed lacks the field: unlinked, never «undefined».
      .mockResolvedValueOnce({ branchId: BRANCH });
    const filed = { branchId: BRANCH, departmentId: COPY };
    expect((await adapter.approvalUnitOf(filed)).departmentCatalogId).toBeNull();
    expect((await adapter.approvalUnitOf(filed)).departmentCatalogId).toBe(String(CATALOG));
    expect((await adapter.approvalUnitOf(filed)).departmentCatalogId).toBeNull();
  });

  it('refuses a copy that no longer lies in the document’s branch, or is gone: 422, copyMoved', async () => {
    const filed = { branchId: BRANCH, departmentId: COPY };
    mocks.findDepartment.mockResolvedValueOnce({ branchId: OTHER_BRANCH, catalogId: CATALOG });
    expect(await refusalOf(adapter.approvalUnitOf(filed))).toEqual({
      code: ErrorCodes.ADMINISTRATION_TRANSITION_BLOCKED,
      status: 422,
      details: ['departmentId:copyMoved'],
    });
    mocks.findDepartment.mockResolvedValueOnce(null);
    expect((await refusalOf(adapter.approvalUnitOf(filed))).details).toEqual([
      'departmentId:copyMoved',
    ]);
  });
});

describe('the subject (P2 plan §8.1; §1.2 item 26)', () => {
  it('maps each stored entry to the engine’s six facts, the decider’s id a string', () => {
    const decidedAt = new Date('2026-11-25T08:00:00.000Z');
    const subject = adapter.approvalSubjectOf('administration.purchaseRequest', UNIT, {
      approvalWorkflowId: new Types.ObjectId('64a00000000000000000c0c0'),
      approvalChainShape: RUNGS as never,
      approvalSteps: [
        {
          stepIndex: 0,
          outcome: 'approved',
          deciderUserId: new Types.ObjectId(APPROVER),
          decidedAt,
          comment: 'موافق',
          overriddenWith: null,
          // The two snapshots the engine never reads stay behind.
          ...{ stepLabel: null, deciderName: 'معتمد' },
        },
        {
          stepIndex: 1,
          outcome: 'skipped',
          deciderUserId: null,
          decidedAt,
          comment: null,
          overriddenWith: null,
        },
      ],
    });
    expect(subject).toEqual({
      requestType: 'administration.purchaseRequest',
      unit: UNIT,
      decisions: [
        {
          stepIndex: 0,
          outcome: 'approved',
          deciderUserId: APPROVER,
          decidedAt,
          comment: 'موافق',
          overriddenWith: null,
        },
        {
          stepIndex: 1,
          outcome: 'skipped',
          deciderUserId: null,
          decidedAt,
          comment: null,
          overriddenWith: null,
        },
      ],
      pin: { workflowId: '64a00000000000000000c0c0', steps: RUNGS },
    });
    expect(typeof subject.decisions[0]?.deciderUserId).toBe('string');
  });
});

describe('OD-19 A at submission (P2 plan §8.2 steps 3–5)', () => {
  const chain = (status: string, workflowId: string | null = 'w1', steps: unknown[] = RUNGS) => ({
    workflowId,
    steps,
    status,
  });

  it.each([
    ['no chain applies', chain('noChain', null, []), 'approval:noChain'],
    ['nobody holds any rung', chain('unstaffed'), 'approval:unstaffed'],
  ])('%s: 422 CHAIN_MISSING, and the live rung is never asked', async (_label, answer, detail) => {
    mocks.chainFor.mockResolvedValueOnce(answer);
    expect(
      await refusalOf(adapter.chainForSubmission('administration.purchaseRequest', UNIT, [])),
    ).toEqual({
      code: ErrorCodes.ADMINISTRATION_APPROVAL_CHAIN_MISSING,
      status: 422,
      details: [detail],
    });
    expect(mocks.currentApprovers).not.toHaveBeenCalled();
  });

  it('asks the live rung of the chain it pins, with no decisions, and takes pair A1 off it', async () => {
    mocks.chainFor.mockResolvedValueOnce(chain('pending'));
    mocks.currentApprovers.mockResolvedValueOnce([REQUESTER, APPROVER, SECOND, APPROVER]);
    await expect(
      adapter.chainForSubmission('administration.purchaseRequest', UNIT, [REQUESTER]),
    ).resolves.toEqual({
      pin: { workflowId: 'w1', steps: RUNGS },
      approvers: [APPROVER, SECOND],
    });
    expect(mocks.chainFor).toHaveBeenCalledWith('administration.purchaseRequest', UNIT);
    expect(mocks.currentApprovers).toHaveBeenCalledWith({
      requestType: 'administration.purchaseRequest',
      unit: UNIT,
      decisions: [],
      pin: { workflowId: 'w1', steps: RUNGS },
    });
  });

  it('a live rung held only by pair A1 has nobody to decide it: 422, noEligibleApprover', async () => {
    mocks.chainFor.mockResolvedValueOnce(chain('pending'));
    mocks.currentApprovers.mockResolvedValueOnce([REQUESTER]);
    expect(
      await refusalOf(
        adapter.chainForSubmission('administration.purchaseRequest', UNIT, [REQUESTER]),
      ),
    ).toEqual({
      code: ErrorCodes.ADMINISTRATION_APPROVAL_CHAIN_MISSING,
      status: 422,
      details: ['approval:noEligibleApprover'],
    });
  });

  it('the eligible are the holders less pair A1 and the round’s deciders, each once', () => {
    const decided = {
      stepIndex: 0,
      outcome: 'approved' as const,
      deciderUserId: APPROVER,
      decidedAt: new Date(),
      comment: null,
      overriddenWith: null,
    };
    const skipped = { ...decided, stepIndex: 1, outcome: 'skipped' as const, deciderUserId: null };
    expect(
      adapter.eligibleAmong([APPROVER, SECOND, REQUESTER, SECOND], [decided, skipped], [REQUESTER]),
    ).toEqual([SECOND]);
    expect(adapter.eligibleAmong([APPROVER], [], [])).toEqual([APPROVER]);
  });

  it('reads a pending chain as no refusal, and only the other two as one', () => {
    expect(adapter.chainStatusRefusal('pending')).toBeNull();
    expect(adapter.chainStatusRefusal('noChain')?.code).toBe(
      ErrorCodes.ADMINISTRATION_APPROVAL_CHAIN_MISSING,
    );
    expect(adapter.chainStatusRefusal('unstaffed')?.details?.[0]?.code).toBe('unstaffed');
  });
});

describe('the engine’s refusals, in the module’s words (design §5.15)', () => {
  it.each([
    [
      'approvals.alreadyDecided',
      ErrorCodes.ADMINISTRATION_APPROVAL_NOT_PENDING,
      ['status:approved'],
    ],
    [
      'approvals.nothingToDecide',
      ErrorCodes.ADMINISTRATION_APPROVAL_NOT_PENDING,
      ['status:approved'],
    ],
    ['approvals.notYourStep', ErrorCodes.ADMINISTRATION_APPROVAL_NOT_YOUR_STEP, undefined],
  ])('%s is 422 %s', (key, code, details) => {
    const remapped = adapter.remapEngineRefusal(new BusinessRuleError(key), 'approved');
    expect(remapped).toBeInstanceOf(AppError);
    const app = remapped as AppError;
    expect(app.code).toBe(code);
    expect(app.httpStatus).toBe(422);
    expect(app.details?.map((d) => `${d.field ?? ''}:${d.code}`)).toEqual(details);
  });

  it('passes anything else through as it came — another key, another error', () => {
    const other = new BusinessRuleError('approvals.unknownPermissionKey');
    expect(adapter.remapEngineRefusal(other, 'pendingApproval')).toBe(other);
    const crash = new Error('approvals.notYourStep');
    expect(adapter.remapEngineRefusal(crash, 'pendingApproval')).toBe(crash);
  });
});
