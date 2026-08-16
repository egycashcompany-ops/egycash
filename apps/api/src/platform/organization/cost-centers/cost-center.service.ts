// Cost-centre catalog service (P-HR-23). CRUD, audited, and nothing else.
//
// It deliberately knows nothing about employees: membership is an employee-side concern and lives
// in HR, where the employee can be resolved and scoped. This file could not import that even if it
// wanted to — platform may not reach into a module — and the split is the right one anyway.
import {
  PlatformEvents,
  type CostCenterDto,
  type CreateCostCenter,
  type ListOrgUnitsQuery,
  type Paginated,
  type UpdateCostCenter,
} from '@ecms/contracts';
import { type FilterQuery } from 'mongoose';
import { type ScopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../audit';
import { emit } from '../../kernel/event-bus';
import { costCenterRepository } from './cost-center.repository';
import { type CostCenterDoc } from './cost-center.model';

const entityRef = (id: string) => ({
  moduleId: 'platform',
  entityType: 'costCenter',
  entityId: id,
});

const snapshot = (doc: CostCenterDoc) => ({
  code: doc.code,
  name: doc.name,
  description: doc.description,
  status: doc.status,
});

/** D-CC-9 — the existing org-unit event, with a new `unitType`. No new event name was invented. */
const announce = (id: string, change: 'created' | 'updated' | 'deleted'): Promise<void> =>
  emit(PlatformEvents.OrgUnitChanged, { unitType: 'costCenter', unitId: id, change });

class CostCenterService {
  async create(input: CreateCostCenter, by: string): Promise<CostCenterDoc> {
    const doc = await costCenterRepository.create(
      {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        status: 'active',
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await announce(String(doc._id), 'created');
    return doc;
  }

  async update(id: string, input: UpdateCostCenter, by: string): Promise<CostCenterDoc> {
    const before = await costCenterRepository.getById(id);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.status !== undefined) set.status = input.status;
    const after = await costCenterRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(after)),
    });
    await announce(id, 'updated');
    return after;
  }

  /**
   * Soft delete. Assignments that already cite this centre are left alone, and so are payslips.
   *
   * That is not an oversight: a payslip carries the id it was issued with, and rewriting history
   * to tidy a catalog is the one thing this codebase never does. Deleting a centre stops it being
   * chosen; it does not un-happen the months it was chosen for.
   */
  async softDelete(id: string, by: string): Promise<void> {
    await costCenterRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
    await announce(id, 'deleted');
  }

  async getById(id: string): Promise<CostCenterDoc> {
    return costCenterRepository.getById(id);
  }

  async list(query: ListOrgUnitsQuery, scope: ScopeSelector): Promise<Paginated<CostCenterDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.search !== undefined) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ code: pattern }, { 'name.ar': pattern }, { 'name.en': pattern }];
    }
    return costCenterRepository.list({
      filter: filter as FilterQuery<CostCenterDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['code', 'status', 'createdAt'],
      scope,
    });
  }

  toDto(doc: CostCenterDoc): CostCenterDto {
    return {
      id: String(doc._id),
      code: doc.code,
      name: doc.name,
      description: doc.description,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const costCenterService = new CostCenterService();
