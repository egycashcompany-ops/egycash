// The engine, wired to the database: resolve a chain for a request, read its trail, decide on it.
//
// What a host module owes this service is small on purpose: the request's TYPE, the unit it belongs
// to, the decided entries it has stored, and the chain it pinned at submission. It gets back a
// trail, a status, and — on a decision — the entries to append. It never learns who the approvers
// are, and the engine never learns what a leave request is.
//
// One rule is worth stating before the code, because it is the one everything else follows from:
// **nothing about people is stored.** Every «who is on this rung» is asked of the permission layer
// at the moment it matters. A workflow that cached approvers would route this month's requests by
// last month's org chart — and would do it silently, because a stale name looks exactly like a
// current one.
//
// The RUNGS are a different fact, and the host keeps them (ADR-041 decision 4). Its decided entries
// are keyed by rung index, so a request read against a chain somebody edited since would have its
// decisions laid over other rungs. The pin holds the rungs a request was submitted on; the row can
// then be edited, deactivated or deleted, and only new submissions follow it.
import { Types } from 'mongoose';
import {
  type ApprovalDecision,
  type ApprovalLevel,
  type ApprovalStep,
  type ApprovalTrailDto,
  type ApprovalWorkflowDto,
  type AuditChange,
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
  rungToDecide,
  statusOf,
  viewerDecision,
  type ChainStatus,
  type DecidedEntry,
} from './approval-trail';
import { approversFor, hasApprovers, ownStepsOf, type Unit } from './approver-lookup';
import { approvalWorkflowRepository } from './workflow.repository';
import { type ApprovalWorkflowDoc } from './workflow.model';
import {
  auditModeOf,
  getApprovalRequestType,
  listApprovalRequestTypes,
} from './request-type.registry';
import { APPROVAL_OVERRIDE_KEY, overrideReaches } from './override-reach';

export { APPROVAL_OVERRIDE_KEY } from './override-reach';

/**
 * The chain a request was submitted on, as its host stores it: the chosen row's id and its rungs,
 * captions included, without their staffing, which is read afresh at every call.
 */
export interface ApprovalChainPin {
  workflowId: string;
  steps: readonly ApprovalStep[];
}

/** Everything the engine needs to know about one request. */
export interface ApprovalSubject {
  requestType: string;
  unit: Unit;
  decisions: readonly DecidedEntry[];
  /**
   * The chain the host pinned at submission, which the request is decided on whatever has become
   * of its row since. Null for a request submitted before its host pinned: that one reads the chain
   * that applies now, as every request did before ADR-041 decision 4, because nobody can know which
   * chain it was submitted on (decision 10).
   */
  pin: ApprovalChainPin | null;
}

/** A chain resolved against the org as it stands right now. */
export interface LiveChain {
  workflowId: string | null;
  steps: ResolvedStep[];
  /**
   * The chain's answer before anybody decides: `pending`, or `unstaffed` when nobody holds any of
   * its rungs, or `noChain` when no chain applies. A host reads it at submission and applies its
   * own policy to the last two (ADR-041 decision 2).
   */
  status: ChainStatus;
}

/** A rung as a chain row, or a host's pinned copy of one, stores it. */
interface StoredRung {
  permissionKey: string;
  level: ApprovalLevel;
  label?: { ar: string; en: string } | null;
}

/**
 * A rung reduced to what the rules read, as a plain object. A pin read from a host's hydrated
 * document holds its caption as a subdocument, which a trail must not hand to the screen as such.
 */
const toStep = (step: StoredRung): ChainStep => ({
  permissionKey: step.permissionKey,
  level: step.level,
  label:
    step.label === null || step.label === undefined
      ? null
      : { ar: step.label.ar, en: step.label.en },
});

/**
 * What a host stores at submission for the chain `chainFor` just gave it: the row's id and its
 * rungs, without their staffing. Null when no row applies or the row has no rungs, because a pin
 * of nothing would hold the request to a chain it can never be decided on.
 */
export const pinOf = (chain: LiveChain): ApprovalChainPin | null =>
  chain.workflowId === null || chain.steps.length === 0
    ? null
    : { workflowId: chain.workflowId, steps: chain.steps.map(toStep) };

/**
 * The pin a host stored through `approvalPinFields`, read back from its document.
 *
 * Null when `approvalWorkflowId` is missing or null: a request submitted before its host pinned
 * has neither field, and one read without its schema's defaults (`.lean()`) has them missing
 * rather than null. Either way it is not pinned, and reads the chain that applies now.
 */
export const readApprovalPin = (doc: {
  approvalWorkflowId?: Types.ObjectId | null;
  approvalChainShape?: readonly StoredRung[] | null;
}): ApprovalChainPin | null =>
  doc.approvalWorkflowId === null || doc.approvalWorkflowId === undefined
    ? null
    : {
        workflowId: String(doc.approvalWorkflowId),
        steps: (doc.approvalChainShape ?? []).map(toStep),
      };

class ApprovalService {
  /**
   * The chain that applies to one request now, with each rung told whether anybody can stand on
   * it: what a host reads at submission, and pins.
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
    if (chosen === null) return { workflowId: null, steps: [], status: 'noChain' };
    return this.staffed(String(chosen.value._id), chosen.value.steps, unit);
  }

  /**
   * Where a request stands, for a host module that only needs the one word.
   *
   * No chain and no staffed rung are reported as what they are — `noChain` and `unstaffed` — and
   * never as approved. Whether a request nobody configured approvals for should pass, wait or be
   * refused is a policy, and a different one for each host (ADR-041 decision 2): the engine says
   * which case this is, and the host applies its own answer. Reading either as approved here would
   * approve the request for every host that read the word, without any of them having chosen to.
   */
  async statusFor(subject: ApprovalSubject): Promise<ChainStatus> {
    const chain = await this.chainOf(subject);
    return statusOf(chain.steps, subject.decisions);
  }

  /** The full trail, plus what THIS reader may do about it. */
  async trailFor(subject: ApprovalSubject, viewer: AuthContext): Promise<ApprovalTrailDto> {
    const chain = await this.chainOf(subject);
    const own = await ownStepsOf(viewer.userId, chain.steps, subject.unit);
    const decision = viewerDecision(chain.steps, subject.decisions, own);
    const target = rungToDecide(chain.steps, subject.decisions);

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
      // The rung to decide, also on an `unstaffed` chain: the panel marks where the request
      // stopped, which is the rung an override would decide, rather than drawing a stuck request
      // as a finished one.
      currentStep: target,
      viewerMayDecide: decision !== null,
      viewerStep: decision?.step ?? null,
      viewerCovers: decision?.covers ?? [],
      // Being ON the chain and being able to step INTO it are different claims, and only the
      // second needs an extra permission. Somebody in the chain deciding ahead of his turn is
      // using his own authority. Stepping in reaches only as far as the override does, read by the
      // level of the rung it would decide.
      viewerMayOverride:
        decision === null && this.overrideDecides(viewer, chain.steps, target, subject.unit),
    };
  }

  /**
   * Record one decision, and return the entries the host module must append.
   *
   * The service does not save them: the host owns its aggregate, and a request whose status,
   * balance and notifications all move together must move them in one write of its own. Handing
   * back the entries keeps that possible; writing them here would force every host into a second
   * transaction it did not ask for.
   *
   * The audit row follows the type's registration (ADR-041 decision 7). For an `'engine'` type,
   * the default and leave's, it is recorded here, before the host writes, so a host that refuses
   * afterwards leaves it behind. For a `'host'` type the host records it, on its own document and
   * after its own commit, so a decision its host refused leaves no row. `auditChanges` comes back
   * either way: the facts the engine's row carries, which a host's own row must carry too.
   */
  async decide(
    subject: ApprovalSubject,
    actor: AuthContext,
    input: { decision: ApprovalDecision; comment: string | null },
  ): Promise<{
    entries: DecidedEntry[];
    status: ChainStatus;
    stepIndex: number;
    auditChanges: AuditChange[];
  }> {
    const chain = await this.chainOf(subject);
    // The chain's status first, then the actor: one answer per case (ADR-041 decision 3). A
    // request with no staffed rung left is still waiting, so it falls through to «not your step»
    // for anybody without an override that reaches it, rather than reading as decided.
    const before = statusOf(chain.steps, subject.decisions);
    if (before === 'noChain') throw new BusinessRuleError('approvals.nothingToDecide');
    if (before === 'approved' || before === 'rejected') {
      throw new BusinessRuleError('approvals.alreadyDecided');
    }
    const target = rungToDecide(chain.steps, subject.decisions);

    const own = await ownStepsOf(actor.userId, chain.steps, subject.unit);
    const mine = viewerDecision(chain.steps, subject.decisions, own);

    // Two ways to be allowed, and they are recorded differently on purpose. The owner asked for
    // exactly four facts to survive a decision — «مين كان المفروض يوافق، مين وافق فعليًا،
    // الصلاحية/السبب، وقت القرار» — and `overriddenWith` is the third. An override decides the rung
    // to decide and nothing above it, and only where it reaches as far as that rung's level asks.
    const allowed =
      mine !== null
        ? { stepIndex: mine.step, overriddenWith: null }
        : target !== null && this.overrideDecides(actor, chain.steps, target, subject.unit)
          ? { stepIndex: target, overriddenWith: APPROVAL_OVERRIDE_KEY }
          : null;
    if (allowed === null) throw new BusinessRuleError('approvals.notYourStep');
    const { stepIndex, overriddenWith } = allowed;

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

    const auditChanges: AuditChange[] = [
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
    ];
    if (auditModeOf(subject.requestType) === 'engine') {
      await auditService.record({
        entityRef: {
          moduleId: 'platform',
          entityType: 'approval',
          entityId: `${subject.requestType}:${stepIndex}`,
        },
        action: 'update',
        changes: auditChanges,
      });
    }

    return { entries, status, stepIndex, auditChanges };
  }

  /** Who is standing on the rung a request is waiting for — the notification list, read live. */
  async currentApprovers(subject: ApprovalSubject): Promise<string[]> {
    const chain = await this.chainOf(subject);
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
   * Three things are refused rather than stored, because each one gives a chain that LOOKS
   * configured and does not run as written: an unregistered request type, whose chain no host ever
   * reads; a permission key no module declares, whose rung resolves to «nobody holds this», so it
   * is only ever passed over, and with no staffed rung above it a request that reaches it waits
   * `unstaffed` for an override; and a rung repeated at the same level, which would ask one person
   * twice.
   */
  async setWorkflow(input: SetApprovalWorkflow, actor: AuthContext): Promise<ApprovalWorkflowDto> {
    if (getApprovalRequestType(input.requestType) === null) {
      throw new BusinessRuleError('approvals.unknownRequestType');
    }
    // Checked against the registry this deployment actually booted with rather than a compile-time
    // list: a key from a module nobody enabled here is exactly the kind that resolves to «nobody
    // holds this»: its rung is only ever passed over, and with nothing staffed above it the request
    // waits `unstaffed` for an override, on a chain that looks configured. Empty means the boot
    // sync has not run (a CLI process, a test); then nothing is refused, because refusing
    // everything would be worse than refusing nothing.
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

  /**
   * The chain one request is read and decided on: the one its host pinned, with no chain row read,
   * or, for a request with no pin, the one that applies now.
   *
   * The pinned rungs are staffed for the Unit the host hands over at this call, so who stands on
   * them follows the org; only which rungs there are, and their captions, were fixed at submission.
   */
  private async chainOf(subject: ApprovalSubject): Promise<LiveChain> {
    if (subject.pin === null) return this.chainFor(subject.requestType, subject.unit);
    return this.staffed(subject.pin.workflowId, subject.pin.steps, subject.unit);
  }

  /**
   * One chain's rungs, each told whether anybody can stand on it, and its answer before anybody
   * decides. A pin with no rungs comes out as any chain without them does, `noChain`: never
   * approved, and refused for everybody, while the request stays readable for its host's cancel.
   *
   * Staffing is asked once per distinct (key, level) rather than once per rung: a chain routinely
   * names the same key at two levels, and each question is a fan-out across roles, assignments and
   * delegations. Within one call the answer cannot change, and across calls it is deliberately not
   * cached at all.
   */
  private async staffed(
    workflowId: string,
    rungs: readonly StoredRung[],
    unit: Unit,
  ): Promise<LiveChain> {
    const staffing = new Map<string, boolean>();
    for (const step of rungs) {
      const at = `${step.permissionKey}::${step.level}`;
      if (!staffing.has(at)) {
        staffing.set(at, await hasApprovers(step.permissionKey, step.level, unit));
      }
    }
    const steps = resolveChain(
      rungs.map(toStep),
      (step) => staffing.get(`${step.permissionKey}::${step.level}`) === true,
    );
    return { workflowId, steps, status: statusOf(steps, []) };
  }

  /** Whether the reader's override reaches the rung to decide, by that rung's level. */
  private overrideDecides(
    reader: AuthContext,
    steps: readonly ResolvedStep[],
    target: number | null,
    unit: Unit,
  ): boolean {
    const rung = target === null ? undefined : steps[target];
    return rung !== undefined && overrideReaches(reader, rung.level, unit);
  }

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
