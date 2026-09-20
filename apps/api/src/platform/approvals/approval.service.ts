// The engine, wired to the database: resolve a chain for a request, read its trail, decide on it.
//
// What a host module owes this service is small on purpose: the request's TYPE, the unit it belongs
// to, and the decided entries it has stored. It gets back a trail, a status, and — on a decision —
// the entries to append. It never learns who the approvers are, and the engine never learns what a
// leave request is.
//
// One rule is worth stating before the code, because it is the one everything else follows from:
// **nothing about people is stored.** Every «who is on this rung» is asked of the permission layer
// at the moment it matters. A workflow that cached approvers would route this month's requests by
// last month's org chart — and would do it silently, because a stale name looks exactly like a
// current one.
import { Types } from 'mongoose';
import {
  type ApprovalDecision,
  type ApprovalLevel,
  type ApprovalTrailDto,
  type ApprovalWorkflowDto,
  type SetApprovalWorkflow,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../shared/errors';
import { type AuthContext } from '../../shared/types';
import { auditService } from '../audit';
import { userRepository } from '../users/user.repository';
import { departmentCatalogRepository } from '../organization/department-catalog/department-catalog.repository';
import { branchRepository } from '../organization/branches/branch.repository';
import { rbacService } from '../rbac/rbac.service';
import { selectChain, resolveChain, type ChainStep, type ResolvedStep } from './approval-chain';
import {
  buildTrail,
  entriesForDecision,
  progressOf,
  statusOf,
  viewerDecision,
  type ChainStatus,
  type DecidedEntry,
} from './approval-trail';
import { approversFor, hasApprovers, ownStepsOf, type Unit } from './approver-lookup';
import { approvalWorkflowRepository } from './workflow.repository';
import { type ApprovalWorkflowDoc } from './workflow.model';
import { getApprovalRequestType, listApprovalRequestTypes } from './request-type.registry';

export const APPROVAL_OVERRIDE_KEY = 'approval.override';

/** Everything the engine needs to know about one request. */
export interface ApprovalSubject {
  requestType: string;
  unit: Unit;
  decisions: readonly DecidedEntry[];
}

/** A chain resolved against the org as it stands right now. */
export interface LiveChain {
  workflowId: string | null;
  steps: ResolvedStep[];
}

const toStep = (step: { permissionKey: string; level: ApprovalLevel; label: { ar: string; en: string } | null }): ChainStep => ({
  permissionKey: step.permissionKey,
  level: step.level,
  label: step.label,
});

class ApprovalService {
  /**
   * The chain that applies to one request, with each rung told whether anybody can stand on it.
   *
   * Staffing is asked once per distinct (key, level) rather than once per rung: a chain routinely
   * names the same key at two levels, and each question is a fan-out across roles, assignments and
   * delegations. Within one call the answer cannot change, and across calls it is deliberately not
   * cached at all.
   */
  async chainFor(requestType: string, unit: Unit): Promise<LiveChain> {
    const rows = await approvalWorkflowRepository.findActiveForType(requestType);
    const chosen = selectChain(
      rows.map((row) => ({
        departmentCatalogId: row.departmentCatalogId === null ? null : String(row.departmentCatalogId),
        branchId: row.branchId === null ? null : String(row.branchId),
        value: row,
      })),
      unit,
    );
    if (chosen === null) return { workflowId: null, steps: [] };

    const staffing = new Map<string, boolean>();
    for (const step of chosen.value.steps) {
      const at = `${step.permissionKey}::${step.level}`;
      if (!staffing.has(at)) {
        staffing.set(at, await hasApprovers(step.permissionKey, step.level, unit));
      }
    }
    return {
      workflowId: String(chosen.value._id),
      steps: resolveChain(chosen.value.steps.map(toStep), (step) =>
        staffing.get(`${step.permissionKey}::${step.level}`) === true,
      ),
    };
  }

  /**
   * Where a request stands, for a host module that only needs the one word.
   *
   * A chain with NO steps — no workflow written for this request's place — leaves the request
   * approved. That is a policy, and it is deliberately this one: a company that has not configured
   * approvals for a request type is not a company that wants every such request frozen. The
   * configuration screen says so in as many words, because the opposite reading is defensible and
   * an administrator must not have to guess which one the code took.
   */
  async statusFor(subject: ApprovalSubject): Promise<ChainStatus> {
    const chain = await this.chainFor(subject.requestType, subject.unit);
    return statusOf(chain.steps, subject.decisions);
  }

  /** The full trail, plus what THIS reader may do about it. */
  async trailFor(subject: ApprovalSubject, viewer: AuthContext): Promise<ApprovalTrailDto> {
    const chain = await this.chainFor(subject.requestType, subject.unit);
    const own = await ownStepsOf(viewer.userId, chain.steps, subject.unit);
    const decision = viewerDecision(chain.steps, subject.decisions, own);

    const deciderIds = [
      ...new Set(
        subject.decisions
          .map((entry) => entry.deciderUserId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const names = await this.namesOf(deciderIds);

    return {
      requestType: subject.requestType,
      workflowId: chain.workflowId,
      steps: buildTrail(chain.steps, subject.decisions, (id) => names.get(id) ?? { id, name: id }),
      currentStep:
        statusOf(chain.steps, subject.decisions) === 'pending'
          ? (this.liveIndex(chain.steps, subject.decisions) ?? null)
          : null,
      viewerMayDecide: decision !== null,
      viewerStep: decision?.step ?? null,
      viewerCovers: decision?.covers ?? [],
      // Being ON the chain and being able to step INTO it are different claims, and only the
      // second needs an extra permission. Somebody in the chain deciding ahead of his turn is
      // using his own authority.
      viewerMayOverride:
        decision === null &&
        statusOf(chain.steps, subject.decisions) === 'pending' &&
        viewer.permissions[APPROVAL_OVERRIDE_KEY] !== undefined,
    };
  }

  /**
   * Record one decision, and return the entries the host module must append.
   *
   * The service does not save them: the host owns its aggregate, and a request whose status,
   * balance and notifications all move together must move them in one write of its own. Handing
   * back the entries keeps that possible; writing them here would force every host into a second
   * transaction it did not ask for.
   */
  async decide(
    subject: ApprovalSubject,
    actor: AuthContext,
    input: { decision: ApprovalDecision; comment: string | null },
  ): Promise<{ entries: DecidedEntry[]; status: ChainStatus; stepIndex: number }> {
    const chain = await this.chainFor(subject.requestType, subject.unit);
    if (statusOf(chain.steps, subject.decisions) !== 'pending') {
      throw new BusinessRuleError('approvals.alreadyDecided');
    }
    const live = this.liveIndex(chain.steps, subject.decisions);
    if (live === null) throw new BusinessRuleError('approvals.nothingToDecide');

    const own = await ownStepsOf(actor.userId, chain.steps, subject.unit);
    const mine = viewerDecision(chain.steps, subject.decisions, own);

    // Two ways to be allowed, and they are recorded differently on purpose. The owner asked for
    // exactly four facts to survive a decision — «مين كان المفروض يوافق، مين وافق فعليًا،
    // الصلاحية/السبب، وقت القرار» — and `overriddenWith` is the third.
    const stepIndex = mine?.step ?? live;
    const overriddenWith =
      mine === null
        ? actor.permissions[APPROVAL_OVERRIDE_KEY] !== undefined
          ? APPROVAL_OVERRIDE_KEY
          : null
        : null;
    if (mine === null && overriddenWith === null) {
      throw new BusinessRuleError('approvals.notYourStep');
    }

    const now = new Date();
    const entries = entriesForDecision(
      chain.steps,
      subject.decisions,
      {
        stepIndex,
        decision: input.decision,
        deciderUserId: actor.userId,
        comment: input.comment,
        overriddenWith,
      },
      now,
    );
    const status = statusOf(chain.steps, [...subject.decisions, ...entries]);

    await auditService.record({
      entityRef: {
        moduleId: 'platform',
        entityType: 'approval',
        entityId: `${subject.requestType}:${stepIndex}`,
      },
      action: 'update',
      changes: [
        { field: 'decision', old: null, new: input.decision },
        { field: 'step', old: null, new: String(stepIndex) },
        { field: 'level', old: null, new: chain.steps[stepIndex]?.level ?? null },
        { field: 'permissionKey', old: null, new: chain.steps[stepIndex]?.permissionKey ?? null },
        ...(overriddenWith === null
          ? []
          : [{ field: 'overriddenWith', old: null, new: overriddenWith }]),
        ...(mine !== null && mine.covers.length > 0
          ? [{ field: 'covers', old: null, new: mine.covers.join(',') }]
          : []),
      ],
    });

    return { entries, status, stepIndex };
  }

  /** Who is standing on the rung a request is waiting for — the notification list, read live. */
  async currentApprovers(subject: ApprovalSubject): Promise<string[]> {
    const chain = await this.chainFor(subject.requestType, subject.unit);
    const index = this.liveIndex(chain.steps, subject.decisions);
    const step = index === null ? undefined : chain.steps[index];
    if (step === undefined) return [];
    return approversFor(step.permissionKey, step.level, subject.unit);
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  async listWorkflows(): Promise<ApprovalWorkflowDto[]> {
    const rows = await approvalWorkflowRepository.listAll();
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  listRequestTypes(): ReturnType<typeof listApprovalRequestTypes> {
    return listApprovalRequestTypes();
  }

  /**
   * Write the one chain for a place, replacing whatever was there.
   *
   * Three things are refused rather than stored, because each one produces a chain that LOOKS
   * configured and quietly approves everything: an unregistered request type, a permission key no
   * module declares, and a rung repeated at the same level (which would ask one person twice).
   */
  async setWorkflow(input: SetApprovalWorkflow, actor: AuthContext): Promise<ApprovalWorkflowDto> {
    if (getApprovalRequestType(input.requestType) === null) {
      throw new BusinessRuleError('approvals.unknownRequestType');
    }
    // Checked against the registry this deployment actually booted with rather than a compile-time
    // list: a key from a module nobody enabled here is exactly the kind that resolves to «nobody
    // holds this», is SKIPPED, and leaves a chain that looks configured and approves everything.
    // Empty means the boot sync has not run (a CLI process, a test); then nothing is refused,
    // because refusing everything would be worse than refusing nothing.
    const known = new Set(rbacService.registeredPermissionKeys());
    const seen = new Set<string>();
    for (const step of input.steps) {
      if (known.size > 0 && !known.has(step.permissionKey)) {
        throw new BusinessRuleError('approvals.unknownPermissionKey');
      }
      const at = `${step.permissionKey}::${step.level}`;
      if (seen.has(at)) throw new BusinessRuleError('approvals.duplicateStep');
      seen.add(at);
    }

    const existing = await approvalWorkflowRepository.findForPlace(
      input.requestType,
      input.departmentCatalogId,
      input.branchId,
    );
    const saved =
      existing === null
        ? await approvalWorkflowRepository.create(
            {
              requestType: input.requestType,
              departmentCatalogId:
                input.departmentCatalogId === null
                  ? null
                  : new Types.ObjectId(input.departmentCatalogId),
              branchId: input.branchId === null ? null : new Types.ObjectId(input.branchId),
              steps: input.steps,
              isActive: input.isActive,
            },
            { by: actor.userId },
          )
        : await approvalWorkflowRepository.updateById(
            String(existing._id),
            { steps: input.steps, isActive: input.isActive },
            { by: actor.userId, version: existing.__v },
          );

    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'approvalWorkflow', entityId: String(saved._id) },
      action: existing === null ? 'create' : 'update',
      changes: [
        { field: 'requestType', old: null, new: input.requestType },
        { field: 'steps', old: null, new: input.steps.map((s) => `${s.permissionKey}@${s.level}`).join(' → ') },
        { field: 'isActive', old: null, new: String(input.isActive) },
      ],
    });
    return this.toDto(saved);
  }

  async deleteWorkflow(id: string, actor: AuthContext): Promise<void> {
    await approvalWorkflowRepository.softDeleteById(id, { by: actor.userId });
    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'approvalWorkflow', entityId: id },
      action: 'delete',
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private liveIndex(
    steps: readonly ResolvedStep[],
    decisions: readonly DecidedEntry[],
  ): number | null {
    for (let i = progressOf(decisions); i < steps.length; i += 1) {
      if (steps[i]?.staffed === true) return i;
    }
    return null;
  }

  private async namesOf(ids: string[]): Promise<Map<string, { id: string; name: string }>> {
    if (ids.length === 0) return new Map();
    const users = await userRepository.findByIdsSystem(ids);
    return new Map(
      users.map((user): [string, { id: string; name: string }] => [
        String(user._id),
        {
          id: String(user._id),
          name:
            `${user.profile.firstName.ar} ${user.profile.lastName.ar}`.trim() ||
            `${user.profile.firstName.en} ${user.profile.lastName.en}`.trim() ||
            (user.email ?? String(user._id)),
        },
      ]),
    );
  }

  private async toDto(row: ApprovalWorkflowDoc): Promise<ApprovalWorkflowDto> {
    const department =
      row.departmentCatalogId === null
        ? null
        : await departmentCatalogRepository.findById(String(row.departmentCatalogId));
    const branch =
      row.branchId === null ? null : await branchRepository.findById(String(row.branchId));
    return {
      id: String(row._id),
      requestType: row.requestType,
      department:
        department === null ? null : { id: String(department._id), name: department.name },
      branch: branch === null ? null : { id: String(branch._id), name: branch.name },
      steps: row.steps,
      isActive: row.isActive !== false,
      updatedAt: (row.updatedAt ?? new Date()).toISOString(),
    };
  }
}

export const approvalService = new ApprovalService();
export { type DecidedEntry } from './approval-trail';
