import { Types, type FilterQuery } from 'mongoose';
import {
  type AutomationVariableDto,
  type ListAutomationVariablesQuery,
  type Paginated,
  type UpsertAutomationVariable,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../../platform/audit';
import { automationVariableRepository } from './variable.repository';
import { type AutomationVariableDoc } from './variable.model';

const entityRef = (id: string) => ({
  moduleId: 'automation',
  entityType: 'variable',
  entityId: id,
});

const snapshot = (doc: AutomationVariableDoc) => ({
  key: doc.key,
  value: doc.value,
  scope: doc.scope,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  workflowId: doc.workflowId === null ? null : String(doc.workflowId),
});

class AutomationVariableService {
  /**
   * Upsert by (key, scope, target) rather than by id, because that is how a caller thinks about a
   * variable: "set `approverEmail` for this branch". A create/update split would make the client
   * look it up first and race with itself.
   */
  async upsert(
    key: string,
    input: UpsertAutomationVariable,
    by: string,
  ): Promise<AutomationVariableDoc> {
    const branchId = input.branchId ?? null;
    const workflowId = input.workflowId ?? null;
    const existing = await automationVariableRepository.findScoped(
      key,
      input.scope,
      branchId,
      workflowId,
    );

    if (existing === null) {
      const doc = await automationVariableRepository.create(
        {
          key,
          value: input.value,
          scope: input.scope,
          branchId: branchId === null ? null : new Types.ObjectId(branchId),
          workflowId: workflowId === null ? null : new Types.ObjectId(workflowId),
        },
        { by },
      );
      await auditService.record({
        entityRef: entityRef(String(doc._id)),
        action: 'create',
        changes: diffChanges({}, snapshot(doc)),
      });
      return doc;
    }

    const doc = await automationVariableRepository.updateById(
      String(existing._id),
      { value: input.value },
      { by, version: existing.__v },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'update',
      changes: diffChanges(snapshot(existing), snapshot(doc)),
    });
    return doc;
  }

  async softDelete(id: string, by: string, scope: ScopeSelector): Promise<void> {
    await automationVariableRepository.getById(id, scope);
    await automationVariableRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  async list(
    query: ListAutomationVariablesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<AutomationVariableDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.scope !== undefined) filter.scope = query.scope;
    if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
    if (query.workflowId !== undefined) filter.workflowId = new Types.ObjectId(query.workflowId);
    return automationVariableRepository.list({
      filter: filter as FilterQuery<AutomationVariableDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['key', 'scope', 'updatedAt'],
      scope,
    });
  }

  toDto(doc: AutomationVariableDoc): AutomationVariableDto {
    return {
      id: String(doc._id),
      key: doc.key,
      value: doc.value,
      scope: doc.scope,
      branchId: doc.branchId === null ? null : String(doc.branchId),
      workflowId: doc.workflowId === null ? null : String(doc.workflowId),
      version: doc.__v,
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const automationVariableService = new AutomationVariableService();
