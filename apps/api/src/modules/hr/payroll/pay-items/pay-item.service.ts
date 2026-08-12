// Pay-item catalog service (PY-1).
//
// Two rules carry the weight, and both exist because a payslip line will cite an item by id:
//
//   • what an item MEANS never changes. `code`, `kind` and `calcBasis` are set once, at creation,
//     and the update contract does not accept them — turning an earning into a deduction, or a
//     flat allowance into a per-day one, would silently restate every payslip already citing it.
//   • an item in use is ARCHIVED, not deleted. Archiving keeps it out of new selections while
//     history keeps naming something real. Deletion stays available only while nothing uses it,
//     which today means always — the first consumer arrives in PY-2, and the guard arrives with
//     it rather than as a check against a collection that does not exist yet.
import { type FilterQuery } from 'mongoose';
import {
  type CreatePayItem,
  type ListPayItemsQuery,
  type Paginated,
  type PayItemDto,
  type UpdatePayItem,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../../../shared/types';
import { ConflictError } from '../../../../shared/errors';
import { diffChanges } from '../../../../shared/utils/diff';
import { auditService } from '../../../../platform/audit';
import { payItemRepository } from './pay-item.repository';
import { PayItemModel, type PayItemDoc } from './pay-item.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'payItem', entityId: id });

const snapshot = (doc: PayItemDoc) => ({
  code: doc.code,
  name: doc.name,
  kind: doc.kind,
  calcBasis: doc.calcBasis,
  sortOrder: doc.sortOrder,
  status: doc.status,
});

class PayItemService {
  async create(input: CreatePayItem, by: string): Promise<PayItemDoc> {
    const code = input.code.toUpperCase();
    // Checked here for the readable 409; the unique index is what actually holds under a race.
    const clash = await PayItemModel.findOne({ code, isDeleted: false }).lean().exec();
    if (clash !== null) throw new ConflictError(`a pay item with code ${code} already exists`);

    const doc = await payItemRepository.create(
      {
        code,
        name: input.name,
        kind: input.kind,
        calcBasis: input.calcBasis,
        sortOrder: input.sortOrder ?? (await this.nextSortOrder()),
        status: 'active',
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

  /** Name, order and status only — see the header for why the arithmetic is immutable. */
  async update(id: string, input: UpdatePayItem, by: string): Promise<PayItemDoc> {
    const before = await payItemRepository.getById(id);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    if (input.status !== undefined) set.status = input.status;
    const after = await payItemRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(after)),
    });
    return after;
  }

  async softDelete(id: string, by: string): Promise<void> {
    await payItemRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  async getById(id: string): Promise<PayItemDoc> {
    return payItemRepository.getById(id);
  }

  async list(query: ListPayItemsQuery, scope: ScopeSelector): Promise<Paginated<PayItemDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.kind !== undefined) filter.kind = query.kind;
    if (query.status !== undefined) filter.status = query.status;
    if (query.search !== undefined) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ 'name.ar': pattern }, { 'name.en': pattern }, { code: pattern }];
    }
    return payItemRepository.list({
      filter: filter as FilterQuery<PayItemDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'sortOrder',
      sortDir: query.sortDir,
      sortableFields: ['sortOrder', 'code', 'status', 'createdAt'],
      scope,
    });
  }

  private async nextSortOrder(): Promise<number> {
    const last = await PayItemModel.findOne({ isDeleted: false })
      .sort({ sortOrder: -1 })
      .lean<{ sortOrder: number }>()
      .exec();
    return last === null ? 0 : last.sortOrder + 10;
  }

  toDto(doc: PayItemDoc): PayItemDto {
    return {
      id: String(doc._id),
      code: doc.code,
      name: doc.name,
      kind: doc.kind,
      calcBasis: doc.calcBasis,
      sortOrder: doc.sortOrder,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const payItemService = new PayItemService();
