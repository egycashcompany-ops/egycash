// The engine's service: R12's baseline, PX-1.1 of
// docs/12-planning/administration-module-phase-px1.md §7, and each fix's cases after it.
//
// PX-1.1 wrote it over the code as it stood. A case that pins a defect a later pull request fixes
// names it, so that pull request can show the case flip: PX-1.2 rewrote the R2 and R4 cases to the
// fixed behavior and added its own beside them, and the R9 cases still pin today's save for
// PX-1.6. R5's case is the 'engine' default, which PX-1.5 keeps for leave and sets its 'host'
// cases beside; the rest is behavior the fixes keep. The seams are mocked — the chain rows, the
// approver lookup, names, places, the permission registry and audit — while `approval-chain`,
// `approval-trail` and `override-reach` run for real, because the rules are theirs and this service
// only joins them to one request. A real leave request through the HTTP edge is
// `tests/integration/approvals.spec.ts`.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ApprovalLevel, type SetApprovalWorkflow } from '@ecms/contracts';
import { BusinessRuleError } from '../../shared/errors';
import { type AuthContext } from '../../shared/types';
import { type ChainStatus, type DecidedEntry } from './approval-trail';
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

const actor = (
  permissions: AuthContext['permissions'] = {},
  placement: Partial<Pick<AuthContext, 'branchId' | 'departmentId'>> = {},
): AuthContext => ({
  userId: 'u-actor',
  sessionId: 'spec',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions,
  permissionVersion: 1,
  isPrivileged: false,
  ...placement,
});

/** Overrides by reach (ADR-041 decision 6): the company, the request's branch, another branch. */
const ORG_OVERRIDE = actor({ 'approval.override': 'organization' });
const BRANCH_OVERRIDE = actor({ 'approval.override': 'branch' }, { branchId: UNIT.branchId });
const OTHER_BRANCH_OVERRIDE = actor(
  { 'approval.override': 'branch' },
  { branchId: String(new Types.ObjectId()) },
);

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
      status: 'pending',
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
      status: 'noChain',
    });
    expect(mocks.hasApprovers).not.toHaveBeenCalled();
  });

  it('R2: answers pending, unstaffed or noChain before anybody decides, never approved', async () => {
    // What a host reads at submission to apply its own policy (ADR-041 decision 3).
    chain(LADDER, ['organization']);
    expect((await approvalService.chainFor('hr.leave', UNIT)).status).toBe('pending');
    chain(LADDER, []);
    expect((await approvalService.chainFor('hr.leave', UNIT)).status).toBe('unstaffed');
    mocks.findActiveForType.mockResolvedValue([]);
    expect((await approvalService.chainFor('hr.leave', UNIT)).status).toBe('noChain');
  });

  it('asks staffing once per distinct key and level within a call, and afresh at the next call', async () => {
    // A rung repeated at one level gets past no save, but the memo must hold whatever a row says.
    chain([rung('unit'), rung('organization'), rung('unit')]);
    await approvalService.chainFor('hr.leave', UNIT);
    expect(mocks.hasApprovers).toHaveBeenCalledTimes(2);
    await approvalService.chainFor('hr.leave', UNIT);
    expect(mocks.hasApprovers).toHaveBeenCalledTimes(4);

    // Two keys at one level are two questions: a memo keyed by level alone would hand the second
    // rung the first one's answer. The type declares both keys, so no later key rule touches it.
    mocks.hasApprovers.mockReset();
    registerApprovalRequestType({
      key: 'spec.twoKeys',
      moduleId: 'spec',
      name: { ar: 'نوع اختبار بمفتاحين', en: 'Spec type with two keys' },
      permissionKeys: ['first.approve', 'second.approve'],
    });
    mocks.findActiveForType.mockResolvedValue([
      row([rung('unit', 'first.approve'), rung('unit', 'second.approve')], {
        requestType: 'spec.twoKeys',
      }),
    ]);
    mocks.hasApprovers.mockImplementation((key: string) =>
      Promise.resolve(key === 'first.approve'),
    );
    const mixed = await approvalService.chainFor('spec.twoKeys', UNIT);
    expect(mocks.hasApprovers).toHaveBeenCalledTimes(2);
    expect(mixed.steps.map((s) => s.staffed)).toEqual([true, false]);
  });
});

describe('deciding (decide)', () => {
  it('decides the waiting rung for its holder, and audits it itself before returning (R5: the engine default PX-1.5 keeps)', async () => {
    chain(LADDER);
    mocks.ownStepsOf.mockResolvedValue([0]);
    const outcome = await approvalService.decide(subject(), actor(), {
      decision: 'approved',
      comment: 'موافق',
    });
    expect(outcome.entries).toEqual([
      {
        stepIndex: 0,
        outcome: 'approved',
        deciderUserId: 'u-actor',
        decidedAt: expect.any(Date),
        comment: 'موافق',
        overriddenWith: null,
      },
    ]);
    // Matched rather than equal, so the `auditChanges` PX-1.5 adds to the result leaves this
    // 'engine' case standing; the row below is what it guards.
    expect(outcome).toMatchObject({ status: 'pending', stepIndex: 0 });
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
    // The row names the rung decided, not the one that was waiting.
    expect(auditedChanges()).toEqual([
      { field: 'decision', old: null, new: 'approved' },
      { field: 'step', old: null, new: '2' },
      { field: 'level', old: null, new: 'organization' },
      { field: 'permissionKey', old: null, new: 'leave.approve' },
      { field: 'covers', old: null, new: '0,1' },
    ]);
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
      for (const who of [actor(), ORG_OVERRIDE]) {
        expect(await refusalOf(approvalService.decide(subject(decisions), who, APPROVE))).toBe(
          'approvals.alreadyDecided',
        );
      }
    }
  });

  it('R2: no chain and no staffed rung are not approved, and neither is refused as already decided', async () => {
    // No chain: nothing to decide, for anybody. Before PX-1.2 both read approved, and both were
    // refused as already decided, so a request nobody could decide looked finished.
    expect(await approvalService.statusFor(subject())).toBe('noChain');
    expect(await refusalOf(approvalService.decide(subject(), ORG_OVERRIDE, APPROVE))).toBe(
      'approvals.nothingToDecide',
    );
    // No staffed rung: still waiting, so «not your step» to anyone without an override that
    // reaches the rung.
    chain(LADDER, []);
    expect(await approvalService.statusFor(subject())).toBe('unstaffed');
    expect(await refusalOf(approvalService.decide(subject(), actor(), APPROVE))).toBe(
      'approvals.notYourStep',
    );
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('answers each row of the refusal table, the chain’s status first and then the actor (R2, R4)', async () => {
    // docs/12-planning/administration-module-phase-px1.md §4. The waiting rung of LADDER is the
    // `unit` rung, which the request's branch reaches, and another branch does not. Each row: the
    // chain's status, which levels anybody holds (null: no chain), the host's entries, the actor,
    // the rungs the actor stands on, and the answer — a refusal key, or who decided.
    const ALL = LADDER.map((s) => s.level);
    const NOBODY: ApprovalLevel[] = [];
    const OWN_RUNG = 'own rung';
    type Row = [
      ChainStatus,
      readonly ApprovalLevel[] | null,
      readonly DecidedEntry[],
      AuthContext,
      number[],
      string,
    ];
    const rows: Row[] = [
      ['noChain', null, [], ORG_OVERRIDE, [0], 'approvals.nothingToDecide'],
      ['approved', ALL, ALL_APPROVED, ORG_OVERRIDE, [], 'approvals.alreadyDecided'],
      ['rejected', ALL, [entry(0, 'rejected')], ORG_OVERRIDE, [], 'approvals.alreadyDecided'],
      ['pending', ALL, [], actor(), [1], OWN_RUNG],
      ['pending', ALL, [], BRANCH_OVERRIDE, [], 'approval.override'],
      ['unstaffed', NOBODY, [], BRANCH_OVERRIDE, [], 'approval.override'],
      ['pending', ALL, [], actor(), [], 'approvals.notYourStep'],
      ['pending', ALL, [], OTHER_BRANCH_OVERRIDE, [], 'approvals.notYourStep'],
      ['unstaffed', NOBODY, [], actor(), [], 'approvals.notYourStep'],
      ['unstaffed', NOBODY, [], OTHER_BRANCH_OVERRIDE, [], 'approvals.notYourStep'],
      // Nobody stands on a rung an unstaffed chain has left, whatever the lookup says of a reader.
      ['unstaffed', NOBODY, [], actor(), [0], 'approvals.notYourStep'],
    ];
    for (const [status, staffed, decisions, who, ownSteps, answer] of rows) {
      if (staffed === null) mocks.findActiveForType.mockResolvedValue([]);
      else chain(LADDER, staffed);
      mocks.ownStepsOf.mockResolvedValue(ownSteps);
      expect(await approvalService.statusFor(subject(decisions)), status).toBe(status);
      const decided = approvalService.decide(subject(decisions), who, APPROVE);
      if (answer.startsWith('approvals.')) {
        expect(await refusalOf(decided), `${status}: ${answer}`).toBe(answer);
        continue;
      }
      const settled = (await decided).entries.at(-1);
      expect(settled?.overriddenWith ?? OWN_RUNG, status).toBe(answer);
      expect(settled?.stepIndex, status).toBe(answer === OWN_RUNG ? 1 : 0);
    }
  });

  it('R4: an override decides the waiting rung only where it reaches that rung’s level', async () => {
    // The waiting rung is the `unit` rung. `own` and `section` reach no Unit, and a branch-wide
    // override over another branch does not reach this one; before PX-1.2 any of them decided.
    chain(LADDER);
    for (const out of [
      actor({ 'approval.override': 'own' }),
      actor({ 'approval.override': 'section' }),
      OTHER_BRANCH_OVERRIDE,
    ]) {
      expect(await refusalOf(approvalService.decide(subject(), out, APPROVE))).toBe(
        'approvals.notYourStep',
      );
    }
    expect(mocks.record).not.toHaveBeenCalled();

    const outcome = await approvalService.decide(subject(), BRANCH_OVERRIDE, APPROVE);
    expect(outcome.entries.map((e) => [e.stepIndex, e.deciderUserId, e.overriddenWith])).toEqual([
      [0, 'u-actor', 'approval.override'],
    ]);
    expect(outcome.status).toBe('pending');
    expect(auditedChanges()).toContainEqual({
      field: 'overriddenWith',
      old: null,
      new: 'approval.override',
    });

    // On the `organization` rung the same branch-wide override reaches nothing.
    expect(
      await refusalOf(
        approvalService.decide(
          subject([entry(0, 'approved'), entry(1, 'approved')]),
          BRANCH_OVERRIDE,
          APPROVE,
        ),
      ),
    ).toBe('approvals.notYourStep');

    // One who also stands on a rung decides as themselves, however far their override reaches: the
    // rung, the rungs it covers and the third fact stay theirs, and nothing records an override.
    mocks.ownStepsOf.mockResolvedValue([1]);
    const own = await approvalService.decide(subject(), ORG_OVERRIDE, APPROVE);
    expect(own.entries.map((e) => [e.stepIndex, e.outcome, e.overriddenWith])).toEqual([
      [0, 'covered', null],
      [1, 'approved', null],
    ]);
    const ownChanges = (mocks.record.mock.calls.at(-1)?.[0] as { changes: { field: string }[] })
      .changes;
    expect(ownChanges.map((change) => change.field)).not.toContain('overriddenWith');
    expect(ownChanges).toContainEqual({ field: 'covers', old: null, new: '0' });
  });

  it('R2: an override within reach decides the first unsettled rung of an unstaffed chain, and settles nothing above it', async () => {
    chain(LADDER, []);
    const outcome = await approvalService.decide(subject(), BRANCH_OVERRIDE, APPROVE);
    expect(outcome.entries.map((e) => [e.stepIndex, e.outcome, e.overriddenWith])).toEqual([
      [0, 'approved', 'approval.override'],
    ]);
    expect(outcome).toMatchObject({ status: 'unstaffed', stepIndex: 0 });

    // The next rung asks for the department in every branch, which a branch-wide override does
    // not reach: it is not settled by the override below it, and not by this one either.
    expect(
      await refusalOf(approvalService.decide(subject(outcome.entries), BRANCH_OVERRIDE, APPROVE)),
    ).toBe('approvals.notYourStep');
  });

  it('an organization-scope override decides the waiting rung, not an empty rung below it', async () => {
    chain(LADDER, ['department', 'organization']);
    const outcome = await approvalService.decide(
      subject(),
      actor({ 'approval.override': 'organization' }),
      APPROVE,
    );
    expect(outcome.entries.map((e) => [e.stepIndex, e.outcome, e.overriddenWith])).toEqual([
      [0, 'skipped', null],
      [1, 'approved', 'approval.override'],
    ]);
    expect(outcome).toMatchObject({ status: 'pending', stepIndex: 1 });
  });

  it('R4: an override is read on the rung to decide, not on another rung of the chain it happens to reach', async () => {
    // Pending: the branch-wide override reaches the empty unit rung below, not the organization
    // rung that waits.
    chain([rung('unit'), rung('organization')], ['organization']);
    expect(await refusalOf(approvalService.decide(subject(), BRANCH_OVERRIDE, APPROVE))).toBe(
      'approvals.notYourStep',
    );
    expect(await approvalService.trailFor(subject(), BRANCH_OVERRIDE)).toMatchObject({
      currentStep: 1,
      viewerMayOverride: false,
    });

    // Unstaffed: the first unsettled rung is out of reach and the next is within it. Refused, and
    // nothing is written skipped below a rung the override does reach.
    chain([rung('department'), rung('branch')], []);
    expect(await refusalOf(approvalService.decide(subject(), BRANCH_OVERRIDE, APPROVE))).toBe(
      'approvals.notYourStep',
    );
    expect(await approvalService.trailFor(subject(), BRANCH_OVERRIDE)).toMatchObject({
      currentStep: 0,
      viewerMayOverride: false,
    });

    // Pending: the waiting rung is out of reach and a rung above it is within reach. An override
    // never decides early.
    chain([rung('branch'), rung('department')], ['branch', 'department']);
    const everywhere: AuthContext = {
      ...actor({ 'approval.override': 'department' }),
      keyReach: {
        'approval.override': { branchIds: [], departments: [], everywhere: [String(CATALOG)] },
      },
    };
    expect(await refusalOf(approvalService.decide(subject(), everywhere, APPROVE))).toBe(
      'approvals.notYourStep',
    );
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

describe('where a request stands (statusFor)', () => {
  it('reads the host’s entries against the chain', async () => {
    chain(LADDER);
    expect(await approvalService.statusFor(subject([entry(0, 'approved')]))).toBe('pending');
    expect(await approvalService.statusFor(subject(ALL_APPROVED))).toBe('approved');
    expect(await approvalService.statusFor(subject([entry(0, 'rejected')]))).toBe('rejected');
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
    expect(mocks.ownStepsOf).toHaveBeenLastCalledWith('u-actor', expect.any(Array), UNIT);

    // The waiting rung is the first STAFFED one: an empty rung below it is not where the request waits.
    chain(LADDER, ['department', 'organization']);
    mocks.ownStepsOf.mockResolvedValue([]);
    expect((await approvalService.trailFor(subject(), actor())).currentStep).toBe(1);
  });

  it('R4: offers the override only to a reader with no decision of their own whose override reaches the rung to decide, never on a finished chain', async () => {
    chain(LADDER);
    for (const out of [actor({ 'approval.override': 'own' }), OTHER_BRANCH_OVERRIDE]) {
      expect((await approvalService.trailFor(subject(), out)).viewerMayOverride).toBe(false);
    }
    expect(await approvalService.trailFor(subject(), BRANCH_OVERRIDE)).toMatchObject({
      viewerMayDecide: false,
      viewerStep: null,
      viewerMayOverride: true,
    });
    // A reader on a rung decides as themselves, however far their override reaches.
    mocks.ownStepsOf.mockResolvedValue([0]);
    expect(await approvalService.trailFor(subject(), ORG_OVERRIDE)).toMatchObject({
      viewerMayDecide: true,
      viewerMayOverride: false,
    });

    mocks.ownStepsOf.mockResolvedValue([]);
    const approved = await approvalService.trailFor(subject(ALL_APPROVED), ORG_OVERRIDE);
    expect(approved).toMatchObject({ currentStep: null, viewerMayOverride: false });
    const rejected = await approvalService.trailFor(subject([entry(0, 'rejected')]), ORG_OVERRIDE);
    expect(rejected).toMatchObject({ currentStep: null, viewerMayOverride: false });
    expect(rejected.steps.map((s) => s.outcome)).toEqual(['rejected', 'unreached', 'unreached']);
  });

  it('R2: with no staffed rung the trail marks the first unsettled rung, and offers it only to an override that reaches it', async () => {
    chain(LADDER, []);
    expect(await approvalService.trailFor(subject(), ORG_OVERRIDE)).toMatchObject({
      currentStep: 0,
      viewerMayDecide: false,
      viewerMayOverride: true,
    });
    const out = await approvalService.trailFor(subject(), OTHER_BRANCH_OVERRIDE);
    expect(out).toMatchObject({ currentStep: 0, viewerMayDecide: false, viewerMayOverride: false });
    expect(out.steps.map((s) => s.outcome)).toEqual(['pending', 'pending', 'pending']);
  });

  it('R2: on a chain with two empty rungs the rung to decide is the first, then the second, while the chain reads unstaffed', async () => {
    chain([rung('unit'), rung('organization')], []);
    expect((await approvalService.trailFor(subject(), ORG_OVERRIDE)).currentStep).toBe(0);

    const first = await approvalService.decide(subject(), ORG_OVERRIDE, APPROVE);
    expect(first).toMatchObject({ status: 'unstaffed', stepIndex: 0 });
    const after = await approvalService.trailFor(subject(first.entries), ORG_OVERRIDE);
    expect(after).toMatchObject({ currentStep: 1, viewerMayOverride: true });
    expect(after.steps.map((s) => s.outcome)).toEqual(['approved', 'pending']);
    expect(await approvalService.statusFor(subject(first.entries))).toBe('unstaffed');

    const second = await approvalService.decide(subject(first.entries), ORG_OVERRIDE, APPROVE);
    expect(second).toMatchObject({ status: 'approved', stepIndex: 1 });
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
