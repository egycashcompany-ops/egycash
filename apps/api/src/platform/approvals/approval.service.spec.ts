// The engine's service as it stands before PX-1's fixes (R12's baseline, PX-1.1 of
// docs/12-planning/administration-module-phase-px1.md §7).
//
// Every case passes on today's code. A case that pins a defect a later pull request fixes names it
// (R2, R4, R5, R9), so that pull request can show the case flip; the rest is behavior the fixes
// keep. The seams are mocked — the chain rows, the approver lookup, names, places, the permission
// registry and audit — while `approval-chain` and `approval-trail` run for real, because the rules
// are theirs and this service only joins them to one request. A real leave request through the
// HTTP edge is `tests/integration/approvals.spec.ts`.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ApprovalLevel, type SetApprovalWorkflow } from '@ecms/contracts';
import { BusinessRuleError } from '../../shared/errors';
import { type AuthContext } from '../../shared/types';
import { type DecidedEntry } from './approval-trail';
import { type Unit } from './approver-level';
import { type ApprovalWorkflowDoc, type WorkflowStep } from './workflow.model';
import { clearApprovalRequestTypes, registerApprovalRequestType } from './request-type.registry';

const mocks = vi.hoisted(() => ({
  findActiveForType: vi.fn(),
  findForPlace: vi.fn(),
  create: vi.fn(),
  updateById: vi.fn(),
  approversFor: vi.fn(),
  hasApprovers: vi.fn(),
  ownStepsOf: vi.fn(),
  findByIdsSystem: vi.fn(),
  departmentFindById: vi.fn(),
  branchFindById: vi.fn(),
  registeredPermissionKeys: vi.fn(),
  record: vi.fn(),
}));

vi.mock('./workflow.repository', () => ({
  approvalWorkflowRepository: {
    findActiveForType: mocks.findActiveForType,
    findForPlace: mocks.findForPlace,
    create: mocks.create,
    updateById: mocks.updateById,
  },
}));
vi.mock('./approver-lookup', () => ({
  approversFor: mocks.approversFor,
  hasApprovers: mocks.hasApprovers,
  ownStepsOf: mocks.ownStepsOf,
}));
vi.mock('../users/user.repository', () => ({
  userRepository: { findByIdsSystem: mocks.findByIdsSystem },
}));
vi.mock('../organization/department-catalog/department-catalog.repository', () => ({
  departmentCatalogRepository: { findById: mocks.departmentFindById },
}));
vi.mock('../organization/branches/branch.repository', () => ({
  branchRepository: { findById: mocks.branchFindById },
}));
vi.mock('../rbac/rbac.service', () => ({
  rbacService: { registeredPermissionKeys: mocks.registeredPermissionKeys },
}));
vi.mock('../audit', () => ({ auditService: { record: mocks.record } }));

const { approvalService } = await import('./approval.service');

const AT = new Date('2026-11-25T09:00:00.000Z');
const BRANCH = new Types.ObjectId();
const CATALOG = new Types.ObjectId();
const UNIT: Unit = {
  branchId: String(BRANCH),
  departmentCatalogId: String(CATALOG),
  departmentId: String(new Types.ObjectId()),
};

const rung = (level: ApprovalLevel, permissionKey = 'leave.approve'): WorkflowStep => ({
  permissionKey,
  level,
  label: null,
});
/** 0 مدير الإدارة في الفرع · 1 مدير عام الإدارة · 2 الموارد البشرية — leave's ladder. */
const LADDER = [rung('unit'), rung('department'), rung('organization')];

/** A chain row; the service reads none of the base fields but the id, `__v` and `updatedAt`. */
const row = (steps: WorkflowStep[], over: Partial<ApprovalWorkflowDoc> = {}) =>
  ({
    _id: new Types.ObjectId(),
    requestType: 'hr.leave',
    departmentCatalogId: null,
    branchId: null,
    steps,
    isActive: true,
    updatedAt: AT,
    __v: 0,
    ...over,
  }) as ApprovalWorkflowDoc;

/** The one chain row that applies, with only these levels held by anybody. */
const chain = (
  steps: WorkflowStep[],
  staffed: readonly ApprovalLevel[] = LADDER.map((s) => s.level),
) => {
  const written = row(steps);
  mocks.findActiveForType.mockResolvedValue([written]);
  mocks.hasApprovers.mockImplementation((_key: string, level: ApprovalLevel) =>
    Promise.resolve(staffed.includes(level)),
  );
  return written;
};

const entry = (
  stepIndex: number,
  outcome: DecidedEntry['outcome'],
  deciderUserId: string | null = 'u-earlier',
): DecidedEntry => ({
  stepIndex,
  outcome,
  deciderUserId,
  decidedAt: AT,
  comment: null,
  overriddenWith: null,
});
const ALL_APPROVED = [entry(0, 'approved'), entry(1, 'approved'), entry(2, 'approved')];

const subject = (decisions: readonly DecidedEntry[] = []) => ({
  requestType: 'hr.leave',
  unit: UNIT,
  decisions,
});

const actor = (permissions: AuthContext['permissions'] = {}): AuthContext => ({
  userId: 'u-actor',
  sessionId: 'spec',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions,
  permissionVersion: 1,
  isPrivileged: false,
});

const APPROVE = { decision: 'approved', comment: null } as const;

/** The key a refusal carries, once it is known to be the 422 a business rule answers. */
const refusalOf = async (pending: Promise<unknown>): Promise<string> => {
  const error = await pending.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(BusinessRuleError);
  return (error as BusinessRuleError).message;
};

const auditedChanges = () => (mocks.record.mock.calls[0]?.[0] as { changes: unknown[] }).changes;

beforeEach(() => {
  vi.resetAllMocks();
  registerApprovalRequestType({
    key: 'hr.leave',
    moduleId: 'hr',
    name: { ar: 'طلبات الإجازة', en: 'Leave requests' },
    permissionKeys: ['leave.approve'],
  });
  mocks.findActiveForType.mockResolvedValue([]);
  mocks.ownStepsOf.mockResolvedValue([]);
  mocks.findByIdsSystem.mockResolvedValue([]);
  mocks.registeredPermissionKeys.mockReturnValue(['leave.approve', 'approval.configure']);
  mocks.record.mockResolvedValue(undefined);
});

afterEach(() => clearApprovalRequestTypes());

describe('which chain applies (chainFor)', () => {
  it('takes the most specific row that matches, each rung told whether anybody holds it', async () => {
    const exact = row([rung('unit'), rung('organization')], {
      departmentCatalogId: CATALOG,
      branchId: BRANCH,
    });
    mocks.findActiveForType.mockResolvedValue([
      row([rung('organization')]),
      row([rung('department')], { departmentCatalogId: CATALOG }),
      exact,
      row([rung('branch')], { departmentCatalogId: new Types.ObjectId(), branchId: BRANCH }),
    ]);
    mocks.hasApprovers.mockImplementation((_key: string, level: ApprovalLevel) =>
      Promise.resolve(level === 'unit'),
    );
    expect(await approvalService.chainFor('hr.leave', UNIT)).toEqual({
      workflowId: String(exact._id),
      steps: [
        { ...rung('unit'), staffed: true },
        { ...rung('organization'), staffed: false },
      ],
    });
    expect(mocks.hasApprovers).toHaveBeenCalledWith('leave.approve', 'unit', UNIT);

    // No row for the request's place: no rungs, and nobody is asked about staffing.
    mocks.findActiveForType.mockResolvedValue([
      row([rung('unit')], { branchId: new Types.ObjectId() }),
    ]);
    mocks.hasApprovers.mockClear();
    expect(await approvalService.chainFor('hr.leave', UNIT)).toEqual({
      workflowId: null,
      steps: [],
    });
    expect(mocks.hasApprovers).not.toHaveBeenCalled();
  });

  it('asks staffing once per distinct key and level within a call, and afresh at the next call', async () => {
    // A rung repeated at one level gets past no save, but the memo must hold whatever a row says.
    chain([rung('unit'), rung('organization'), rung('unit')]);
    await approvalService.chainFor('hr.leave', UNIT);
    expect(mocks.hasApprovers).toHaveBeenCalledTimes(2);
    await approvalService.chainFor('hr.leave', UNIT);
    expect(mocks.hasApprovers).toHaveBeenCalledTimes(4);
  });
});

describe('deciding (decide)', () => {
  it('decides the waiting rung for its holder; R5 (today): audits it itself before returning', async () => {
    chain(LADDER);
    mocks.ownStepsOf.mockResolvedValue([0]);
    const outcome = await approvalService.decide(subject(), actor(), {
      decision: 'approved',
      comment: 'موافق',
    });
    expect(outcome).toEqual({
      entries: [
        {
          stepIndex: 0,
          outcome: 'approved',
          deciderUserId: 'u-actor',
          decidedAt: expect.any(Date),
          comment: 'موافق',
          overriddenWith: null,
        },
      ],
      status: 'pending',
      stepIndex: 0,
    });
    expect(mocks.ownStepsOf).toHaveBeenCalledWith('u-actor', expect.any(Array), UNIT);
    // Written before the host's own write, so a host refusing afterwards leaves it behind. It names
    // the type and the rung, not the host's document; the HTTP request id is its only link.
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith({
      entityRef: { moduleId: 'platform', entityType: 'approval', entityId: 'hr.leave:0' },
      action: 'update',
      changes: [
        { field: 'decision', old: null, new: 'approved' },
        { field: 'step', old: null, new: '0' },
        { field: 'level', old: null, new: 'unit' },
        { field: 'permissionKey', old: null, new: 'leave.approve' },
      ],
    });
  });

  it('lets a higher rung’s holder decide early, the waiting rungs below written covered or skipped', async () => {
    chain(LADDER, ['unit', 'organization']);
    mocks.ownStepsOf.mockResolvedValue([2]);
    const outcome = await approvalService.decide(subject(), actor(), APPROVE);
    expect(outcome.entries.map((e) => [e.stepIndex, e.outcome, e.deciderUserId])).toEqual([
      [0, 'covered', null],
      [1, 'skipped', null],
      [2, 'approved', 'u-actor'],
    ]);
    expect(outcome).toMatchObject({ status: 'approved', stepIndex: 2 });
    expect(auditedChanges()).toContainEqual({ field: 'covers', old: null, new: '0,1' });
  });

  it('refuses approvals.notYourStep to someone on no rung at or above the waiting one', async () => {
    chain(LADDER);
    expect(await refusalOf(approvalService.decide(subject(), actor(), APPROVE))).toBe(
      'approvals.notYourStep',
    );
    // A rung already passed is not a place on the chain.
    mocks.ownStepsOf.mockResolvedValue([0]);
    expect(
      await refusalOf(approvalService.decide(subject([entry(0, 'approved')]), actor(), APPROVE)),
    ).toBe('approvals.notYourStep');
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('refuses approvals.alreadyDecided once the chain is approved or rejected', async () => {
    chain(LADDER);
    mocks.ownStepsOf.mockResolvedValue([0, 1, 2]);
    for (const decisions of [ALL_APPROVED, [entry(0, 'rejected')]]) {
      expect(await refusalOf(approvalService.decide(subject(decisions), actor(), APPROVE))).toBe(
        'approvals.alreadyDecided',
      );
    }
  });

  it('R2 (today): no chain, or no staffed rung, reads approved and is refused as already decided', async () => {
    const overrider = actor({ 'approval.override': 'organization' });
    expect(await approvalService.statusFor(subject())).toBe('approved');
    expect(await refusalOf(approvalService.decide(subject(), overrider, APPROVE))).toBe(
      'approvals.alreadyDecided',
    );
    chain(LADDER, []);
    expect(await approvalService.statusFor(subject())).toBe('approved');
    expect(await refusalOf(approvalService.decide(subject(), overrider, APPROVE))).toBe(
      'approvals.alreadyDecided',
    );
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('R4 (today): an approval.override at any scope, own included, decides the waiting rung', async () => {
    chain(LADDER);
    const outcome = await approvalService.decide(
      subject(),
      actor({ 'approval.override': 'own' }),
      APPROVE,
    );
    expect(outcome.entries.map((e) => [e.stepIndex, e.deciderUserId, e.overriddenWith])).toEqual([
      [0, 'u-actor', 'approval.override'],
    ]);
    expect(outcome.status).toBe('pending');
    expect(auditedChanges()).toContainEqual({
      field: 'overriddenWith',
      old: null,
      new: 'approval.override',
    });

    // One who also stands on a rung decides as themselves, and nothing records an override.
    mocks.ownStepsOf.mockResolvedValue([1]);
    const own = await approvalService.decide(
      subject(),
      actor({ 'approval.override': 'own' }),
      APPROVE,
    );
    expect(own.entries.map((e) => [e.stepIndex, e.outcome, e.overriddenWith])).toEqual([
      [0, 'covered', null],
      [1, 'approved', null],
    ]);
  });
});

describe('the trail and what its reader may do (trailFor)', () => {
  it('marks the waiting rung, names who decided, and offers the decision to a rung’s holder', async () => {
    const written = chain(LADDER);
    const decider = new Types.ObjectId();
    mocks.findByIdsSystem.mockResolvedValue([
      {
        _id: decider,
        email: 'unit@ecms.local',
        profile: { firstName: { ar: 'أحمد', en: 'Ahmed' }, lastName: { ar: 'علي', en: 'Ali' } },
      },
    ]);
    mocks.ownStepsOf.mockResolvedValue([1]);
    const decided = subject([entry(0, 'approved', String(decider))]);
    const trail = await approvalService.trailFor(decided, actor());
    expect(trail).toMatchObject({
      requestType: 'hr.leave',
      workflowId: String(written._id),
      currentStep: 1,
      viewerMayDecide: true,
      viewerStep: 1,
      viewerCovers: [],
      viewerMayOverride: false,
    });
    expect(trail.steps.map((s) => [s.level, s.outcome, s.decidedBy?.name ?? null])).toEqual([
      ['unit', 'approved', 'أحمد علي'],
      ['department', 'pending', null],
      ['organization', 'pending', null],
    ]);

    // The holder of a higher rung is offered the early decision, with what it would cover.
    mocks.ownStepsOf.mockResolvedValue([2]);
    expect(await approvalService.trailFor(subject(), actor())).toMatchObject({
      currentStep: 0,
      viewerStep: 2,
      viewerCovers: [0, 1],
    });
  });

  it('R4 (today): offers the override at any scope to a reader on no rung, never on a finished chain', async () => {
    chain(LADDER);
    const overrider = actor({ 'approval.override': 'own' });
    expect(await approvalService.trailFor(subject(), overrider)).toMatchObject({
      viewerMayDecide: false,
      viewerStep: null,
      viewerMayOverride: true,
    });
    mocks.ownStepsOf.mockResolvedValue([0]);
    expect((await approvalService.trailFor(subject(), overrider)).viewerMayOverride).toBe(false);

    mocks.ownStepsOf.mockResolvedValue([]);
    const approved = await approvalService.trailFor(subject(ALL_APPROVED), overrider);
    expect(approved).toMatchObject({ currentStep: null, viewerMayOverride: false });
    const rejected = await approvalService.trailFor(subject([entry(0, 'rejected')]), overrider);
    expect(rejected).toMatchObject({ currentStep: null, viewerMayOverride: false });
    expect(rejected.steps.map((s) => s.outcome)).toEqual(['rejected', 'unreached', 'unreached']);
  });

  it('R2 (today): with no staffed rung the trail reads finished — nothing waits, nobody may act', async () => {
    chain(LADDER, []);
    const overrider = actor({ 'approval.override': 'organization' });
    const trail = await approvalService.trailFor(subject(), overrider);
    expect(trail).toMatchObject({
      currentStep: null,
      viewerMayDecide: false,
      viewerMayOverride: false,
    });
    expect(trail.steps.map((s) => s.outcome)).toEqual(['pending', 'pending', 'pending']);
  });
});

describe('who is told (currentApprovers)', () => {
  it('asks for the holders of the waiting rung, past an empty one, and nobody once nothing waits', async () => {
    chain(LADDER, ['unit', 'organization']);
    mocks.approversFor.mockResolvedValue(['u-hr-1', 'u-hr-2']);
    expect(await approvalService.currentApprovers(subject([entry(0, 'approved')]))).toEqual([
      'u-hr-1',
      'u-hr-2',
    ]);
    expect(mocks.approversFor).toHaveBeenCalledWith('leave.approve', 'organization', UNIT);

    mocks.approversFor.mockClear();
    expect(await approvalService.currentApprovers(subject(ALL_APPROVED))).toEqual([]);
    chain(LADDER, []);
    expect(await approvalService.currentApprovers(subject())).toEqual([]);
    expect(mocks.approversFor).not.toHaveBeenCalled();
  });
});

describe('saving a chain (setWorkflow)', () => {
  const input = (over: Partial<SetApprovalWorkflow> = {}): SetApprovalWorkflow => ({
    requestType: 'hr.leave',
    departmentCatalogId: null,
    branchId: null,
    steps: [rung('unit'), rung('organization')],
    isActive: true,
    ...over,
  });

  it.each([
    ['approvals.unknownRequestType', { requestType: 'hr.unknown' }],
    ['approvals.unknownPermissionKey', { steps: [rung('unit', 'nobody.declares')] }],
    ['approvals.duplicateStep', { steps: [rung('unit'), rung('unit')] }],
  ])('refuses %s and writes nothing', async (key, over: Partial<SetApprovalWorkflow>) => {
    expect(await refusalOf(approvalService.setWorkflow(input(over), actor()))).toBe(key);
    expect(mocks.findForPlace).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('R9 (today): takes any key the permission registry holds, and any key while it is empty', async () => {
    mocks.findForPlace.mockResolvedValue(null);
    mocks.create.mockImplementation((doc: { steps: WorkflowStep[] }) =>
      Promise.resolve(row(doc.steps)),
    );
    // `approval.configure` is registered, and is not one of `hr.leave`'s keys.
    const dto = await approvalService.setWorkflow(
      input({ steps: [rung('organization', 'approval.configure')] }),
      actor(),
    );
    mocks.registeredPermissionKeys.mockReturnValue([]);
    await approvalService.setWorkflow(input({ steps: [rung('unit', 'nobody.declares')] }), actor());

    expect(mocks.create.mock.calls.map(([doc]) => (doc as ApprovalWorkflowDoc).steps)).toEqual([
      [rung('organization', 'approval.configure')],
      [rung('unit', 'nobody.declares')],
    ]);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'hr.leave',
        departmentCatalogId: null,
        branchId: null,
      }),
      { by: 'u-actor' },
    );
    expect(dto).toMatchObject({ requestType: 'hr.leave', department: null, branch: null });
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityRef: { moduleId: 'platform', entityType: 'approvalWorkflow', entityId: dto.id },
        action: 'create',
      }),
    );
  });

  it('R9 (today): edits the place’s chain in place under the version the server itself just read', async () => {
    const existing = row(LADDER, { departmentCatalogId: CATALOG, branchId: BRANCH, __v: 3 });
    mocks.findForPlace.mockResolvedValue(existing);
    mocks.updateById.mockResolvedValue({ ...existing, steps: [rung('organization')], __v: 4 });
    mocks.departmentFindById.mockResolvedValue({
      _id: CATALOG,
      name: { ar: 'الحركة', en: 'Fleet' },
    });
    mocks.branchFindById.mockResolvedValue({ _id: BRANCH, name: { ar: 'المركز', en: 'HQ' } });

    const place = { departmentCatalogId: String(CATALOG), branchId: String(BRANCH) };
    const dto = await approvalService.setWorkflow(
      input({ ...place, steps: [rung('organization')] }),
      actor(),
    );
    expect(mocks.findForPlace).toHaveBeenCalledWith(
      'hr.leave',
      place.departmentCatalogId,
      place.branchId,
    );
    // No version comes from the screen, so a save over a chain edited since it loaded wins.
    expect(mocks.updateById).toHaveBeenCalledWith(
      String(existing._id),
      { steps: [rung('organization')], isActive: true },
      { by: 'u-actor', version: 3 },
    );
    expect(dto).toMatchObject({
      id: String(existing._id),
      department: { id: String(CATALOG), name: { ar: 'الحركة', en: 'Fleet' } },
      branch: { id: String(BRANCH), name: { ar: 'المركز', en: 'HQ' } },
    });
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'update' }));
  });
});
