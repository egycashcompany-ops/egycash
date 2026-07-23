// Shared shape + generic service for the fixed hierarchy Branch → Department → Section
// (ADR-015, Review R11/R12). Job Titles are organization-level catalogs and reuse
// only the schema helpers. Each unit feature stays canonical-shaped and thin.
import { Schema, Types, type FilterQuery } from 'mongoose';
import {
  ErrorCodes,
  PlatformEvents,
  type ActingManager,
  type ListOrgUnitsQuery,
  type LocalizedString,
  type OrgUnitDto,
  type Paginated,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { type BaseRepository } from '../../../shared/base/base.repository';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../audit';
import { emit } from '../../kernel/event-bus';

export interface OrgUnitDoc extends BaseDocFields {
  code: string;
  name: LocalizedString;
  status: 'active' | 'inactive';
  managerId: Types.ObjectId | null;
  actingManager: { userId: Types.ObjectId; from: Date; to: Date } | null;
  path: string;
}

export const localizedField = {
  ar: { type: String, required: true },
  en: { type: String, required: true },
} as const;

const actingManagerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
  },
  { _id: false },
);

export const orgUnitFields = {
  code: { type: String, required: true, uppercase: true, trim: true },
  name: localizedField,
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  managerId: { type: Schema.Types.ObjectId, default: null },
  actingManager: { type: actingManagerSchema, default: null },
  path: { type: String, required: true },
  ...baseFields,
} as const;

export { baseSchemaOptions };

export const addOrgUnitIndexes = (schema: Schema): void => {
  schema.index(
    { code: 1 },
    { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
  );
  schema.index({ status: 1 }, { name: 'ix_status' });
  schema.index({ path: 1 }, { name: 'ix_path' });
};

export type UnitEntityType = 'branch' | 'department' | 'section';

interface CreateUnitInput {
  code: string;
  name: LocalizedString;
  managerId?: string | null | undefined;
  actingManager?: ActingManager | null | undefined;
}

interface UpdateUnitInput {
  name?: LocalizedString | undefined;
  status?: 'active' | 'inactive' | undefined;
  managerId?: string | null | undefined;
  actingManager?: ActingManager | null | undefined;
  version: number;
}

/** Effective manager honours the acting-manager delegation window (Review R11). */
export const effectiveManagerId = (unit: OrgUnitDoc, at: Date = new Date()): string | null => {
  const acting = unit.actingManager;
  if (acting !== null && acting.from <= at && at < acting.to) return String(acting.userId);
  return unit.managerId === null ? null : String(unit.managerId);
};

export interface OrgUnitHooks<TDoc extends OrgUnitDoc> {
  /** Validate parent linkage and return parent-derived fields + path segments. */
  buildCreateExtras: (input: unknown, id: Types.ObjectId) => Promise<Partial<TDoc>>;
  /** Blocks delete while children exist. */
  hasChildren?: (id: string) => Promise<boolean>;
  /** Validates a referenced manager user id. */
  assertManagerExists: (userId: string) => Promise<void>;
  /** Optional: reject a duplicate name (opt-in per unit, e.g. Branches). `excludeId` skips self. */
  assertNameAvailable?: (name: LocalizedString, excludeId?: string) => Promise<void>;
  /**
   * Optional: map the raw update body to extra `$set` fields for per-unit columns that the generic
   * update does not know about (e.g. Branch `address`, Department/Section `description`). Only keys
   * present in the returned object are set, so callers guard with `!== undefined` to preserve
   * omitted-field semantics.
   */
  buildUpdateSet?: (input: Record<string, unknown>) => Record<string, unknown>;
}

export class OrgUnitService<TDoc extends OrgUnitDoc> {
  constructor(
    private readonly entityType: UnitEntityType,
    private readonly repository: BaseRepository<TDoc> & {
      listFiltered?: never;
    },
    private hooks: OrgUnitHooks<TDoc>,
  ) {}

  setHooks(hooks: Partial<OrgUnitHooks<TDoc>>): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  private entityRef(id: string) {
    return { moduleId: 'platform', entityType: this.entityType, entityId: id };
  }

  private async assertManagers(input: {
    managerId?: string | null | undefined;
    actingManager?: ActingManager | null | undefined;
  }): Promise<void> {
    if (input.managerId !== null && input.managerId !== undefined) {
      await this.hooks.assertManagerExists(input.managerId);
    }
    if (input.actingManager !== null && input.actingManager !== undefined) {
      await this.hooks.assertManagerExists(input.actingManager.userId);
    }
  }

  private auditSnapshot(doc: TDoc): Record<string, unknown> {
    return {
      code: doc.code,
      name: doc.name,
      status: doc.status,
      managerId: doc.managerId,
      actingManager: doc.actingManager,
    };
  }

  async create(input: CreateUnitInput & Record<string, unknown>, by: string): Promise<TDoc> {
    await this.assertManagers(input);
    if (this.hooks.assertNameAvailable !== undefined) {
      await this.hooks.assertNameAvailable(input.name);
    }
    const id = new Types.ObjectId();
    const extras = await this.hooks.buildCreateExtras(input, id);
    const doc = await this.repository.create(
      {
        _id: id,
        code: input.code,
        name: input.name,
        status: 'active',
        managerId: input.managerId == null ? null : new Types.ObjectId(input.managerId),
        actingManager:
          input.actingManager == null
            ? null
            : { ...input.actingManager, userId: new Types.ObjectId(input.actingManager.userId) },
        ...extras,
      } as Partial<TDoc>,
      { by },
    );
    await auditService.record({
      entityRef: this.entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, this.auditSnapshot(doc)),
    });
    await emit(PlatformEvents.OrgUnitChanged, {
      unitType: this.entityType,
      unitId: String(doc._id),
      change: 'created',
    });
    return doc;
  }

  async update(id: string, input: UpdateUnitInput, by: string): Promise<TDoc> {
    await this.assertManagers(input);
    if (input.name !== undefined && this.hooks.assertNameAvailable !== undefined) {
      await this.hooks.assertNameAvailable(input.name, id);
    }
    const before = await this.repository.getById(id);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.status !== undefined) set.status = input.status;
    if (input.managerId !== undefined) {
      set.managerId = input.managerId === null ? null : new Types.ObjectId(input.managerId);
    }
    if (input.actingManager !== undefined) {
      set.actingManager =
        input.actingManager === null
          ? null
          : { ...input.actingManager, userId: new Types.ObjectId(input.actingManager.userId) };
    }
    if (this.hooks.buildUpdateSet !== undefined) {
      Object.assign(set, this.hooks.buildUpdateSet(input as unknown as Record<string, unknown>));
    }
    const after = await this.repository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: this.entityRef(id),
      action: 'update',
      changes: diffChanges(this.auditSnapshot(before), this.auditSnapshot(after)),
    });
    await emit(PlatformEvents.OrgUnitChanged, {
      unitType: this.entityType,
      unitId: id,
      change: 'updated',
    });
    return after;
  }

  async softDelete(id: string, by: string): Promise<void> {
    if (this.hooks.hasChildren !== undefined && (await this.hooks.hasChildren(id))) {
      throw new BusinessRuleError(
        `Cannot delete a ${this.entityType} that still has child units`,
        ErrorCodes.ORG_UNIT_HAS_CHILDREN,
      );
    }
    await this.repository.softDeleteById(id, { by });
    await auditService.record({ entityRef: this.entityRef(id), action: 'delete' });
    await emit(PlatformEvents.OrgUnitChanged, {
      unitType: this.entityType,
      unitId: id,
      change: 'deleted',
    });
  }

  async getById(id: string, scope?: ScopeSelector): Promise<TDoc> {
    return this.repository.getById(id, scope);
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

  /**
   * Minimal active-unit options ({id, code, name}) for populating reference dropdowns across the app
   * (e.g. the Branch selector on the Department / Section forms). Organization-wide and NOT gated by
   * the unit's data-scope `view` permission — it exposes only non-sensitive identifiers a form needs.
   */
  async options(): Promise<{ id: string; code: string; name: LocalizedString }[]> {
    const page = await this.repository.list({
      filter: { status: 'active' } as FilterQuery<TDoc>,
      page: 1,
      pageSize: 500,
      sortBy: 'code',
      sortDir: 'asc',
      sortableFields: ['code'],
      scope: { scope: 'organization', userId: '', branchId: null, departmentId: null, sectionId: null },
    });
    return page.items.map((u) => ({ id: String(u._id), code: u.code, name: u.name }));
  }

  baseDto(doc: TDoc): OrgUnitDto {
    return {
      id: String(doc._id),
      code: doc.code,
      name: doc.name,
      status: doc.status,
      managerId: doc.managerId === null ? null : String(doc.managerId),
      actingManager:
        doc.actingManager === null
          ? null
          : {
              userId: String(doc.actingManager.userId),
              from: doc.actingManager.from.toISOString(),
              to: doc.actingManager.to.toISOString(),
            },
      path: doc.path,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}
