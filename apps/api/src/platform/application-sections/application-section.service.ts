// Application Sections — the organizational layer between a module and its pages.
//
// Deliberately NOT an authorization boundary: a section holds no permission key, and the
// navigation resolver never consults it when deciding what a caller may see. It decides only how
// the rows the caller may already see are grouped and ordered.
import { Types, type FilterQuery } from 'mongoose';
import {
  ErrorCodes,
  type ApplicationSectionDto,
  type CreateApplicationSection,
  type ListApplicationSectionsQuery,
  type Paginated,
  type ReorderApplicationSections,
  type UpdateApplicationSection,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../shared/types';
import { BusinessRuleError } from '../../shared/errors';
import { diffChanges } from '../../shared/utils/diff';
import { auditService } from '../audit';
// Leaf-repository imports (not the barrels) — avoids a service-level import cycle.
import { applicationRepository } from '../applications/application.repository';
import { applicationCategoryRepository } from '../application-categories/application-category.repository';
import { applicationSectionRepository } from './application-section.repository';
import {
  ApplicationSectionModel,
  type ApplicationSectionDoc,
} from './application-section.model';

const entityRef = (id: string) => ({
  moduleId: 'platform',
  entityType: 'applicationSection',
  entityId: id,
});

const snapshot = (doc: ApplicationSectionDoc) => ({
  name: doc.name,
  categoryId: String(doc.categoryId),
  sortOrder: doc.sortOrder,
  status: doc.status,
});

/** Positions are renumbered in tens, so a later hand-edit has room to land between two rows. */
export const STEP = 10;

class ApplicationSectionService {
  async create(input: CreateApplicationSection, by: string): Promise<ApplicationSectionDoc> {
    // The parent must exist: a section under no module is a group nothing can ever render.
    await applicationCategoryRepository.getById(input.categoryId);
    const doc = await applicationSectionRepository.create(
      {
        name: input.name,
        categoryId: new Types.ObjectId(input.categoryId),
        sortOrder: input.sortOrder ?? (await this.nextSortOrder(input.categoryId)),
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

  async update(
    id: string,
    input: UpdateApplicationSection,
    by: string,
  ): Promise<ApplicationSectionDoc> {
    const before = await applicationSectionRepository.getById(id);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.categoryId !== undefined) {
      await applicationCategoryRepository.getById(input.categoryId);
      set.categoryId = new Types.ObjectId(input.categoryId);
    }
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    if (input.status !== undefined) set.status = input.status;
    const after = await applicationSectionRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(after)),
    });
    return after;
  }

  /**
   * Deleting a section that still holds applications is refused rather than cascading. Emptying it
   * first is one drag per row and it is the administrator's decision where each row goes; silently
   * unsectioning them would move pages in the sidebar as a side effect of a delete.
   */
  async softDelete(id: string, by: string): Promise<void> {
    const inUse = await applicationRepository.exists({ sectionId: id });
    if (inUse) {
      throw new BusinessRuleError(
        'Cannot delete a section that still has applications',
        ErrorCodes.APPLICATION_SECTION_IN_USE,
      );
    }
    await applicationSectionRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  /**
   * Apply an ORDER, not a set of numbers: the caller sends the ids as it wants them read and the
   * server renumbers 0, 10, 20 … from that list. Ids the category does not own are ignored, and
   * any section the caller omitted keeps its place AFTER the listed ones — so a partial or stale
   * list can reshuffle what it names and never silently drops a row out of view.
   *
   * Idempotent: the same list applied twice produces the same numbers, and writes nothing the
   * second time because every value already matches.
   */
  async reorder(input: ReorderApplicationSections): Promise<ApplicationSectionDoc[]> {
    const sections = await ApplicationSectionModel.find({
      categoryId: input.categoryId,
      isDeleted: false,
    })
      .lean<ApplicationSectionDoc[]>()
      .exec();

    const byId = new Map(sections.map((s) => [String(s._id), s]));
    const listed = input.sectionIds.filter((id) => byId.has(id));
    const rest = sections
      .filter((s) => !listed.includes(String(s._id)))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => String(s._id));
    const ordered = [...listed, ...rest];

    let changed = 0;
    for (const [index, id] of ordered.entries()) {
      const sortOrder = index * STEP;
      if (byId.get(id)?.sortOrder === sortOrder) continue;
      await ApplicationSectionModel.updateOne({ _id: id }, { $set: { sortOrder } }).exec();
      changed += 1;
    }
    if (changed > 0) {
      await auditService.record({
        entityRef: entityRef(input.categoryId),
        action: 'update',
        changes: [{ field: 'sectionOrder', old: null, new: ordered.join(',') }],
      });
    }
    return ApplicationSectionModel.find({ categoryId: input.categoryId, isDeleted: false })
      .sort({ sortOrder: 1 })
      .lean<ApplicationSectionDoc[]>()
      .exec();
  }

  private async nextSortOrder(categoryId: string): Promise<number> {
    const last = await ApplicationSectionModel.findOne({ categoryId, isDeleted: false })
      .sort({ sortOrder: -1 })
      .lean<{ sortOrder: number }>()
      .exec();
    return last === null ? 0 : last.sortOrder + STEP;
  }

  async getById(id: string): Promise<ApplicationSectionDoc> {
    return applicationSectionRepository.getById(id);
  }

  async list(
    query: ListApplicationSectionsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ApplicationSectionDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.categoryId !== undefined) filter.categoryId = query.categoryId;
    if (query.search !== undefined) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ 'name.ar': pattern }, { 'name.en': pattern }];
    }
    return applicationSectionRepository.list({
      filter: filter as FilterQuery<ApplicationSectionDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'sortOrder',
      sortDir: query.sortDir ?? 'asc',
      sortableFields: ['sortOrder', 'status', 'createdAt'],
      scope,
    });
  }

  toDto(doc: ApplicationSectionDoc): ApplicationSectionDto {
    return {
      id: String(doc._id),
      name: doc.name,
      categoryId: String(doc.categoryId),
      sortOrder: doc.sortOrder,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const applicationSectionService = new ApplicationSectionService();
