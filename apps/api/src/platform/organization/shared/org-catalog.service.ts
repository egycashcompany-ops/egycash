// The service half shared by the department and section catalogs (P-ORG-2).
//
// CRUD, audited, announced — and two things that are not CRUD:
//
//   • `assertNameAvailable`, supplied by each catalog rather than implemented here. The whole point
//     of a catalog is that a name appears once, so a second «العمليات» is refused rather than
//     discovered in a dropdown six months later — but "once" means different things to the two:
//     company-wide for a department, and only within its own department for a section, because
//     «الصيانة» under Fleet and «الصيانة» under Facilities are two different jobs sharing a word.
//   • `renameLinked`. A catalog entry's name is copied onto the branch rows that declare it, so a
//     rename must reach them or the screens go back to disagreeing with each other. See the method.
import {
  PlatformEvents,
  type ListOrgUnitsQuery,
  type LocalizedString,
  type Paginated,
} from '@ecms/contracts';
import { type FilterQuery, Types } from 'mongoose';
import { BusinessRuleError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { type BaseRepository } from '../../../shared/base/base.repository';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../audit';
import { emit } from '../../kernel/event-bus';
import { type OrgCatalogDoc } from './org-catalog';

export type CatalogEntityType = 'departmentCatalog' | 'sectionCatalog';

export interface CreateCatalogInput {
  code: string;
  name: LocalizedString;
  description?: LocalizedString | null | undefined;
}

export interface UpdateCatalogInput {
  name?: LocalizedString | undefined;
  description?: LocalizedString | null | undefined;
  status?: 'active' | 'inactive' | undefined;
  version: number;
}

export interface OrgCatalogHooks<TDoc extends OrgCatalogDoc> {
  /**
   * Refuse a name the catalog already has. `owner` is whatever knows the entry's parent — the raw
   * create body on a create, the stored document on an update — so a catalog whose uniqueness is
   * narrower than "the whole company" can read it. `excludeId` skips the entry being renamed.
   */
  assertNameAvailable: (name: LocalizedString, owner: unknown, excludeId?: string) => Promise<void>;
  /** Parent-derived fields, e.g. a section catalog entry's department catalog entry. */
  buildCreateExtras?: (input: unknown) => Promise<Partial<TDoc>>;
  /** Blocks delete while something still declares this entry. */
  hasDependents?: (id: string) => Promise<boolean>;
  /**
   * Push a renamed catalog entry down onto the branch rows that copied its name. Returns how many
   * rows followed, which is what the audit entry records.
   */
  renameLinked?: (id: string, name: LocalizedString, by: string) => Promise<number>;
}

export class OrgCatalogService<TDoc extends OrgCatalogDoc> {
  constructor(
    private readonly entityType: CatalogEntityType,
    private readonly repository: BaseRepository<TDoc>,
    private hooks: OrgCatalogHooks<TDoc>,
  ) {}

  setHooks(hooks: Partial<OrgCatalogHooks<TDoc>>): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  private entityRef(id: string) {
    return { moduleId: 'platform', entityType: this.entityType, entityId: id };
  }

  private snapshot(doc: TDoc): Record<string, unknown> {
    return { code: doc.code, name: doc.name, description: doc.description, status: doc.status };
  }

  private announce(id: string, change: 'created' | 'updated' | 'deleted'): Promise<void> {
    return emit(PlatformEvents.OrgUnitChanged, { unitType: this.entityType, unitId: id, change });
  }

  async create(input: CreateCatalogInput & Record<string, unknown>, by: string): Promise<TDoc> {
    await this.hooks.assertNameAvailable(input.name, input);
    const extras = (await this.hooks.buildCreateExtras?.(input)) ?? {};
    const doc = await this.repository.create(
      {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        status: 'active',
        ...extras,
      } as Partial<TDoc>,
      { by },
    );
    await auditService.record({
      entityRef: this.entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, this.snapshot(doc)),
    });
    await this.announce(String(doc._id), 'created');
    return doc;
  }

  /**
   * Edit the entry, and carry a rename down to the branch rows that declare it.
   *
   * WHY THE ROWS CARRY A COPY AT ALL. A `departments` row keeps its own `name` because the list
   * endpoint searches on it and the DTO is built one document at a time — resolving the catalog
   * per row would mean a join the paged reader has nowhere to put, and a `name.ar` search that
   * silently stopped matching linked rows. So the copy is real, and this is what keeps it true.
   *
   * ONE AUDIT ENTRY, ON THE CATALOG, naming how many rows followed — not one per row. The rows did
   * not change independently; they were re-spelled by a single decision taken here, and a reader
   * asking why a department's name changed is asking about that decision. There are as many rows
   * as there are branches holding the department, so the fan-out is bounded by the branch count.
   */
  async update(id: string, input: UpdateCatalogInput, by: string): Promise<TDoc> {
    const before = await this.repository.getById(id);
    if (input.name !== undefined) await this.hooks.assertNameAvailable(input.name, before, id);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.status !== undefined) set.status = input.status;
    const after = await this.repository.updateById(id, set, { by, version: input.version });

    const renamed =
      input.name !== undefined && this.hooks.renameLinked !== undefined
        ? await this.hooks.renameLinked(id, after.name, by)
        : 0;

    await auditService.record({
      entityRef: this.entityRef(id),
      action: 'update',
      changes: [
        ...diffChanges(this.snapshot(before), this.snapshot(after)),
        ...(renamed > 0 ? [{ field: 'linkedUnitsRenamed', old: null, new: renamed }] : []),
      ],
    });
    await this.announce(id, 'updated');
    return after;
  }

  /**
   * Soft delete, refused while any branch still declares this entry.
   *
   * The same rule the hierarchy already has for a department with sections under it, and for the
   * same reason: removing the definition out from under the rows that cite it would leave every one
   * of them pointing at nothing, with no screen able to say what they are instances of.
   */
  async softDelete(id: string, by: string): Promise<void> {
    if (this.hooks.hasDependents !== undefined && (await this.hooks.hasDependents(id))) {
      throw new BusinessRuleError(
        'Cannot delete a catalog entry that branches still declare — remove it from those branches first',
      );
    }
    await this.repository.softDeleteById(id, { by });
    await auditService.record({ entityRef: this.entityRef(id), action: 'delete' });
    await this.announce(id, 'deleted');
  }

  async getById(id: string): Promise<TDoc> {
    return this.repository.getById(id);
  }

  /** The active entry an id names, or `null` — what a create validates its `catalogId` against. */
  async findActive(id: string): Promise<TDoc | null> {
    const doc = await this.repository.findById(id);
    return doc === null || doc.status !== 'active' ? null : doc;
  }

  async list(
    query: ListOrgUnitsQuery,
    scope: ScopeSelector,
    extraFilter: FilterQuery<TDoc> = {},
  ): Promise<Paginated<TDoc>> {
    const filter: Record<string, unknown> = { ...extraFilter };
    if (query.status !== undefined) filter.status = query.status;
    if (query.search !== undefined) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ code: pattern }, { 'name.ar': pattern }, { 'name.en': pattern }];
    }
    return this.repository.list({
      filter: filter as FilterQuery<TDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['code', 'status', 'createdAt'],
      scope,
    });
  }

  baseDto(doc: TDoc) {
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

/** Shared by both catalog repositories: match a name exactly, case-insensitively, in ar or en. */
export const catalogNameFilter = (
  name: LocalizedString,
  excludeId?: string,
): Record<string, unknown> => {
  const exact = (value: string): RegExp =>
    new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const filter: Record<string, unknown> = {
    $or: [{ 'name.ar': exact(name.ar) }, { 'name.en': exact(name.en) }],
  };
  if (excludeId !== undefined && Types.ObjectId.isValid(excludeId)) {
    filter._id = { $ne: new Types.ObjectId(excludeId) };
  }
  return filter;
};
