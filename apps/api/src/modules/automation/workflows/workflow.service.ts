import { Types, type FilterQuery } from 'mongoose';
import {
  AutomationTriggerSchema,
  type AutomationWorkflowDto,
  type CreateAutomationWorkflow,
  type ListAutomationWorkflowsQuery,
  type Paginated,
  type SetAutomationWorkflowEnabled,
  type TransferAutomationWorkflow,
  type UpdateAutomationWorkflow,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../../platform/audit';
import { userService } from '../../../platform/users';
import { automationWorkflowRepository } from './workflow.repository';
import { canEnableTrigger, validateTrigger, type TriggerProblem } from './trigger-validation';
import { type AutomationWorkflowDoc, type WorkflowTriggerSubdoc } from './workflow.model';

const entityRef = (id: string) => ({
  moduleId: 'automation',
  entityType: 'workflow',
  entityId: id,
});

const snapshot = (doc: AutomationWorkflowDoc) => ({
  key: doc.key,
  name: doc.name,
  status: doc.status,
  trigger: doc.trigger,
  ownerUserId: String(doc.ownerUserId),
  branchScope: doc.branchScope,
  aiOptIn: doc.aiOptIn,
});

/** The stored sub-document, from the parsed contract shape. */
const toTriggerSubdoc = (trigger: {
  kind: string;
  event?: string | undefined;
  cron?: string | undefined;
  runAt?: Date | undefined;
  timezone: string;
  filters: { field: string; op: string; value?: unknown }[];
}): WorkflowTriggerSubdoc => ({
  kind: trigger.kind,
  event: trigger.event ?? null,
  cron: trigger.cron ?? null,
  runAt: trigger.runAt ?? null,
  timezone: trigger.timezone,
  filters: trigger.filters,
});

/** Back to the contract shape, so validation runs against exactly what a caller would send. */
const fromTriggerSubdoc = (trigger: WorkflowTriggerSubdoc) =>
  AutomationTriggerSchema.parse({
    kind: trigger.kind,
    ...(trigger.event === null ? {} : { event: trigger.event }),
    ...(trigger.cron === null ? {} : { cron: trigger.cron }),
    ...(trigger.runAt === null ? {} : { runAt: trigger.runAt }),
    timezone: trigger.timezone,
    filters: trigger.filters,
  });

const refuseOnError = (problems: TriggerProblem[]): void => {
  const errors = problems.filter((problem) => problem.severity === 'error');
  if (errors.length === 0) return;
  throw new BusinessRuleError(errors.map((problem) => problem.message).join('; '));
};

class AutomationWorkflowService {
  /**
   * A workflow runs as its owner, in the owner's branch (§7.2). The branch is denormalized at save
   * time rather than joined on every dispatch: the dispatch lookup is the hot path, and a join per
   * published event would put user reads on it.
   */
  private async ownerBranchId(ownerUserId: string): Promise<Types.ObjectId | null> {
    const owner = await userService.getById(ownerUserId);
    const branchId = owner.organization.branchId;
    return branchId === null ? null : new Types.ObjectId(String(branchId));
  }

  async create(
    input: CreateAutomationWorkflow,
    by: string,
  ): Promise<{ doc: AutomationWorkflowDoc; warnings: TriggerProblem[] }> {
    const problems = validateTrigger(input.trigger);
    refuseOnError(problems);

    const existing = await automationWorkflowRepository.findByKey(input.key);
    if (existing !== null) {
      throw new BusinessRuleError(`a workflow with the key '${input.key}' already exists`);
    }

    const doc = await automationWorkflowRepository.create(
      {
        key: input.key,
        name: input.name,
        description: input.description,
        // Always `draft`. Creating an enabled workflow would mean the first anyone hears of a new
        // automation is it having already run.
        status: 'draft',
        trigger: toTriggerSubdoc(input.trigger),
        ownerUserId: new Types.ObjectId(by),
        branchId: await this.ownerBranchId(by),
        branchScope: input.branchScope,
        aiOptIn: input.aiOptIn,
        providerRef: null,
        template:
          input.templateKey === undefined
            ? null
            : { key: input.templateKey, version: input.templateVersion ?? '0.0.0' },
        suspendedReason: null,
      },
      { by },
    );

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return { doc, warnings: problems.filter((problem) => problem.severity === 'warning') };
  }

  async update(
    id: string,
    input: UpdateAutomationWorkflow,
    by: string,
    scope: ScopeSelector,
  ): Promise<{ doc: AutomationWorkflowDoc; warnings: TriggerProblem[] }> {
    const before = await automationWorkflowRepository.getById(id, scope);
    let warnings: TriggerProblem[] = [];

    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.branchScope !== undefined) set.branchScope = input.branchScope;
    if (input.aiOptIn !== undefined) set.aiOptIn = input.aiOptIn;
    if (input.trigger !== undefined) {
      const problems = validateTrigger(input.trigger);
      refuseOnError(problems);
      warnings = problems.filter((problem) => problem.severity === 'warning');
      // Re-pointing a LIVE workflow at another event silently changes what fires it, so the
      // change is allowed but the workflow drops back to draft for a human to re-enable.
      if (before.status === 'active') set.status = 'draft';
      set.trigger = toTriggerSubdoc(input.trigger);
    }

    const doc = await automationWorkflowRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(doc)),
    });
    return { doc, warnings };
  }

  /** `workflow.enable` — the gate, not a toggle. */
  async setEnabled(
    id: string,
    input: SetAutomationWorkflowEnabled,
    by: string,
    scope: ScopeSelector,
  ): Promise<AutomationWorkflowDoc> {
    const before = await automationWorkflowRepository.getById(id, scope);

    if (input.enabled) {
      if (before.status === 'suspended') {
        // Suspension means the owner is gone. Re-enabling without a live owner would resurrect a
        // workflow running as a deactivated principal — `workflow.transfer` first.
        throw new BusinessRuleError(
          `this workflow is suspended (${before.suspendedReason ?? 'unknown reason'}); transfer it to a live owner before enabling it`,
        );
      }
      const verdict = canEnableTrigger(fromTriggerSubdoc(before.trigger));
      if (!verdict.ok) throw new BusinessRuleError(verdict.reason ?? 'this trigger cannot be enabled');
    }

    const doc = await automationWorkflowRepository.updateById(
      id,
      { status: input.enabled ? 'active' : 'disabled', suspendedReason: null },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: input.enabled ? 'automationEnabled' : 'automationDisabled',
      changes: diffChanges({ status: before.status }, { status: doc.status }),
    });
    return doc;
  }

  /** `workflow.transfer` — moves the principal a workflow executes AS. Always audited. */
  async transfer(
    id: string,
    input: TransferAutomationWorkflow,
    by: string,
    scope: ScopeSelector,
  ): Promise<AutomationWorkflowDoc> {
    const before = await automationWorkflowRepository.getById(id, scope);
    const owner = await userService.getById(input.ownerUserId);
    if (owner.status !== 'active') {
      throw new BusinessRuleError('a workflow cannot be transferred to an inactive user');
    }

    const doc = await automationWorkflowRepository.updateById(
      id,
      {
        ownerUserId: new Types.ObjectId(input.ownerUserId),
        branchId: await this.ownerBranchId(input.ownerUserId),
        // A transfer resolves the suspension but does not re-enable: what the workflow may now do
        // has changed, so a human confirms it.
        ...(before.status === 'suspended' ? { status: 'draft', suspendedReason: null } : {}),
      },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'automationTransferred',
      changes: diffChanges(
        { ownerUserId: String(before.ownerUserId), status: before.status },
        { ownerUserId: String(doc.ownerUserId), status: doc.status },
      ),
    });
    return doc;
  }

  async softDelete(id: string, by: string, scope: ScopeSelector): Promise<void> {
    const before = await automationWorkflowRepository.getById(id, scope);
    if (before.status === 'active') {
      throw new BusinessRuleError('disable the workflow before deleting it');
    }
    await automationWorkflowRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  /**
   * Owner deactivated ⇒ suspend everything they own (§7.2). Not "leave it running": a workflow
   * whose owner has been offboarded keeps acting with their permissions, which is exactly what
   * deactivating them was meant to stop.
   */
  async suspendOwnedBy(ownerUserId: string, reason: string): Promise<number> {
    const owned = await automationWorkflowRepository.listByOwner(ownerUserId);
    let suspended = 0;
    for (const workflow of owned) {
      if (workflow.status !== 'active') continue;
      await automationWorkflowRepository.updateById(
        String(workflow._id),
        { status: 'suspended', suspendedReason: reason },
        // The document as just read: this is a platform-initiated write with no user version to
        // supply, and a concurrent edit should lose to the suspension, not the other way round.
        { by: null, version: workflow.__v },
      );
      await auditService.record({
        entityRef: entityRef(String(workflow._id)),
        action: 'automationSuspended',
        changes: diffChanges({ status: 'active' }, { status: 'suspended', reason }),
      });
      suspended += 1;
    }
    return suspended;
  }

  async getById(id: string, scope: ScopeSelector): Promise<AutomationWorkflowDoc> {
    return automationWorkflowRepository.getById(id, scope);
  }

  async list(
    query: ListAutomationWorkflowsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<AutomationWorkflowDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.triggerKind !== undefined) filter['trigger.kind'] = query.triggerKind;
    if (query.event !== undefined) filter['trigger.event'] = query.event;
    if (query.ownerUserId !== undefined) filter.ownerUserId = new Types.ObjectId(query.ownerUserId);
    if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
    if (query.templateKey !== undefined) filter['template.key'] = query.templateKey;
    if (query.q !== undefined) {
      const pattern = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ key: pattern }, { 'name.ar': pattern }, { 'name.en': pattern }];
    }
    return automationWorkflowRepository.list({
      filter: filter as FilterQuery<AutomationWorkflowDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['key', 'status', 'createdAt', 'updatedAt'],
      scope,
    });
  }

  /** Problems with a stored workflow's trigger — what a detail page shows without saving. */
  async diagnose(id: string, scope: ScopeSelector): Promise<TriggerProblem[]> {
    const doc = await automationWorkflowRepository.getById(id, scope);
    if (doc === null) throw new NotFoundError('Workflow not found');
    return validateTrigger(fromTriggerSubdoc(doc.trigger));
  }

  toDto(doc: AutomationWorkflowDoc, ownerName: string | null = null): AutomationWorkflowDto {
    return {
      id: String(doc._id),
      key: doc.key,
      name: doc.name,
      description: doc.description,
      status: doc.status,
      trigger: {
        kind: doc.trigger.kind as AutomationWorkflowDto['trigger']['kind'],
        event: doc.trigger.event,
        cron: doc.trigger.cron,
        runAt: doc.trigger.runAt === null ? null : doc.trigger.runAt.toISOString(),
        timezone: doc.trigger.timezone,
        filters: doc.trigger.filters as AutomationWorkflowDto['trigger']['filters'],
      },
      owner: { id: String(doc.ownerUserId), name: ownerName },
      branchScope: doc.branchScope,
      branchId: doc.branchId === null ? null : String(doc.branchId),
      providerRef: doc.providerRef,
      template:
        doc.template === null
          ? null
          : { key: doc.template.key, version: doc.template.version, updateAvailable: false },
      aiOptIn: doc.aiOptIn,
      // Executions land at A-7; reporting zeroes beats inventing numbers the UI would render as
      // real. The shape is stable, so nothing changes for a client when they become real.
      lastRun: null,
      stats: { runs7d: 0, failures7d: 0 },
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const automationWorkflowService = new AutomationWorkflowService();
