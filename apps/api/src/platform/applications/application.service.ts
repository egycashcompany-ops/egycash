import { Types, type FilterQuery } from 'mongoose';
import {
  type ApplicationDto,
  type CreateApplication,
  type ListApplicationsQuery,
  type Paginated,
  type ReorderApplications,
  type UpdateApplication,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../shared/types';
import { BusinessRuleError } from '../../shared/errors';
import { diffChanges } from '../../shared/utils/diff';
import { auditService } from '../audit';
// A leaf-repository import (not the application-categories barrel) — avoids a service import cycle.
import { applicationCategoryRepository } from '../application-categories/application-category.repository';
import { applicationSectionRepository } from '../application-sections/application-section.repository';
import { applicationRepository } from './application.repository';
import { ApplicationModel, type ApplicationDoc } from './application.model';

const entityRef = (id: string) => ({
  moduleId: 'platform',
  entityType: 'application',
  entityId: id,
});

const snapshot = (doc: ApplicationDoc) => ({
  name: doc.name,
  icon: doc.icon,
  route: doc.route,
  categoryId: doc.categoryId,
  sectionId: doc.sectionId,
  sortOrder: doc.sortOrder,
  permissionKey: doc.permissionKey,
  status: doc.status,
});

/** Positions are renumbered in tens, leaving room for a later hand-edit to land between rows. */
export const SORT_STEP = 10;

class ApplicationService {
  /** The owning category must exist and be active. */
  private async assertCategoryActive(categoryId: string): Promise<void> {
    const category = await applicationCategoryRepository.findById(categoryId);
    if (category === null || category.status !== 'active') {
      throw new BusinessRuleError('Application must belong to an existing active category');
    }
  }

  async create(input: CreateApplication, by: string): Promise<ApplicationDoc> {
    await this.assertCategoryActive(input.categoryId);
    const doc = await applicationRepository.create(
      {
        name: input.name,
        icon: input.icon,
        route: input.route,
        categoryId: new Types.ObjectId(input.categoryId),
        sectionId:
          input.sectionId === undefined || input.sectionId === null
            ? null
            : new Types.ObjectId(input.sectionId),
        sortOrder: input.sortOrder ?? 0,
        permissionKey: input.permissionKey ?? null,
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

  async update(id: string, input: UpdateApplication, by: string): Promise<ApplicationDoc> {
    const before = await applicationRepository.getById(id);
    if (input.categoryId !== undefined) await this.assertCategoryActive(input.categoryId);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.icon !== undefined) set.icon = input.icon;
    if (input.route !== undefined) set.route = input.route;
    if (input.categoryId !== undefined) set.categoryId = new Types.ObjectId(input.categoryId);
    if (input.sectionId !== undefined) {
      set.sectionId = input.sectionId === null ? null : new Types.ObjectId(input.sectionId);
    }
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    if (input.permissionKey !== undefined) set.permissionKey = input.permissionKey;
    if (input.status !== undefined) set.status = input.status;
    const after = await applicationRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(after)),
    });
    return after;
  }

  async softDelete(id: string, by: string): Promise<void> {
    await applicationRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  /**
   * The one write behind every drag on the applications board.
   *
   * It sets the BUCKET each listed application sits in — its section, or null for the rows that
   * hang directly off the module — and its position inside that bucket, because dragging a row
   * into another section is the same gesture as dragging it within one. The caller sends ids in
   * the order it wants them read; this renumbers 0, 10, 20 … from that list, so nobody types a
   * number and no neighbour is edited to make room.
   *
   * Idempotent: the same list applied twice yields the same numbers, and the second run writes
   * nothing because every value already matches. Ids the category does not own are ignored, and
   * applications already in the bucket that the caller did not list keep their relative order
   * after the listed ones — a stale list reshuffles what it names and drops nothing out of view.
   */
  async reorder(input: ReorderApplications): Promise<ApplicationDoc[]> {
    if (input.sectionId !== null) {
      const section = await applicationSectionRepository.findById(input.sectionId);
      if (section === null || String(section.categoryId) !== input.categoryId) {
        throw new BusinessRuleError('The section does not belong to that category');
      }
    }
    const categoryId = new Types.ObjectId(input.categoryId);
    const sectionId = input.sectionId === null ? null : new Types.ObjectId(input.sectionId);

    // Everything the category owns — the moved rows may be arriving from a sibling bucket.
    const owned = await ApplicationModel.find({ categoryId, isDeleted: false })
      .lean<ApplicationDoc[]>()
      .exec();
    const byId = new Map(owned.map((app) => [String(app._id), app]));
    const listed = input.applicationIds.filter((id) => byId.has(id));
    const stayed = owned
      .filter(
        (app) =>
          String(app.sectionId ?? '') === String(sectionId ?? '') &&
          !listed.includes(String(app._id)),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((app) => String(app._id));
    const ordered = [...listed, ...stayed];

    let changed = 0;
    for (const [index, id] of ordered.entries()) {
      const current = byId.get(id);
      const sortOrder = index * SORT_STEP;
      const sameBucket = String(current?.sectionId ?? '') === String(sectionId ?? '');
      if (sameBucket && current?.sortOrder === sortOrder) continue;
      await ApplicationModel.updateOne({ _id: id }, { $set: { sectionId, sortOrder } }).exec();
      changed += 1;
    }
    if (changed > 0) {
      await auditService.record({
        entityRef: entityRef(input.sectionId ?? input.categoryId),
        action: 'update',
        changes: [
          { field: 'sectionId', old: null, new: input.sectionId ?? '(none)' },
          { field: 'applicationOrder', old: null, new: ordered.join(',') },
        ],
      });
    }
    return ApplicationModel.find({ categoryId, isDeleted: false })
      .sort({ sortOrder: 1 })
      .lean<ApplicationDoc[]>()
      .exec();
  }

  async getById(id: string): Promise<ApplicationDoc> {
    return applicationRepository.getById(id);
  }

  async list(query: ListApplicationsQuery, scope: ScopeSelector): Promise<Paginated<ApplicationDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.categoryId !== undefined) filter.categoryId = new Types.ObjectId(query.categoryId);
    if (query.sectionId !== undefined) filter.sectionId = new Types.ObjectId(query.sectionId);
    if (query.search !== undefined) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ 'name.ar': pattern }, { 'name.en': pattern }, { route: pattern }];
    }
    return applicationRepository.list({
      filter: filter as FilterQuery<ApplicationDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['sortOrder', 'status', 'createdAt'],
      scope,
    });
  }

  toDto(doc: ApplicationDoc): ApplicationDto {
    return {
      id: String(doc._id),
      name: doc.name,
      icon: doc.icon,
      route: doc.route,
      categoryId: String(doc.categoryId),
      sectionId: doc.sectionId === null ? null : String(doc.sectionId),
      sortOrder: doc.sortOrder,
      permissionKey: doc.permissionKey ?? null,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const applicationService = new ApplicationService();
