// The only place data scopes are enforced (ADR-004, ADR-015): every feature
// repository extends this class, so `own | branch | organization` filtering is
// automatic and identical everywhere. Repositories accept typed filters only —
// never raw user input (NoSQL-injection defense).
import {
  Types,
  type ClientSession,
  type FilterQuery,
  type Model,
  type UpdateQuery,
} from 'mongoose';
import { MAX_PAGE_SIZE, type Paginated } from '@ecms/contracts';
import { ConflictError, NotFoundError, StaleDocumentError } from '../errors';
import { type ScopeSelector } from '../types';
import { type BaseDocFields } from './base.model';

export interface BaseRepositoryOptions {
  /** Dot path of the branch scoping field (e.g. `branchId`, `organization.branchId`). */
  branchField?: string;
  /** Dot path of the department scoping field; enables the `department` scope. */
  departmentField?: string;
  /** Dot path of the section scoping field; enables the `section` scope. */
  sectionField?: string;
  /** Collection carries the standard `assignees` array (Review R17). */
  hasAssignees?: boolean;
  /**
   * Dot path of a denormalized SUBJECT-user field (Leave design C1-R): `own` scope then
   * matches records the caller created OR is the subject of (e.g. leave requests carry
   * `employeeUserId`). Opt-in per collection, like the org-scope fields above.
   */
  ownerUserField?: string;
  /** Business data soft-deletes by default; operational collections may opt out. */
  softDelete?: boolean;
}

export interface ListParams<T> {
  filter?: FilterQuery<T>;
  page: number;
  pageSize: number;
  sortBy?: string | undefined;
  sortDir?: 'asc' | 'desc' | undefined;
  /** Whitelist — unknown sort fields fall back to createdAt (API Standards §4). */
  sortableFields?: readonly string[];
  scope?: ScopeSelector;
}

interface WriteMeta {
  by: string | null;
  session?: ClientSession | undefined;
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** Matches nothing — used when a branch-scoped caller has no branch. */
const NEVER: FilterQuery<{ _id: unknown }> = {
  _id: new Types.ObjectId('000000000000000000000000'),
};

export class BaseRepository<T extends BaseDocFields> {
  constructor(
    protected readonly model: Model<T>,
    protected readonly options: BaseRepositoryOptions = {},
  ) {}

  /**
   * Filter one organizational scope by its configured field. When the collection does not declare
   * that field the scope widens to organization-wide ({}) — the same convention `branch` has always
   * used, so finer scopes are opt-in per collection and backward compatible (ADR-017).
   */
  private orgScopeFilter(field: string | undefined, id: string | null): FilterQuery<T> {
    if (field === undefined) return {};
    if (id === null) return NEVER as FilterQuery<T>;
    return { [field]: new Types.ObjectId(id) } as FilterQuery<T>;
  }

  protected scopeFilter(selector: ScopeSelector | undefined): FilterQuery<T> {
    if (selector === undefined || selector.scope === 'organization') return {};
    // Hierarchical scopes filter by the caller's own placement (branch ⊃ department ⊃ section).
    // Filtering by departmentId naturally includes every section under it; branch includes the
    // whole branch — matching the business rules for each scope.
    if (selector.scope === 'branch') {
      return this.orgScopeFilter(this.options.branchField, selector.branchId);
    }
    if (selector.scope === 'department') {
      return this.orgScopeFilter(this.options.departmentField, selector.departmentId);
    }
    if (selector.scope === 'section') {
      return this.orgScopeFilter(this.options.sectionField, selector.sectionId);
    }
    // own: records the user created, is assigned to (Review R17), or is the subject of (C1-R)
    const userId = new Types.ObjectId(selector.userId);
    const ors: FilterQuery<T>[] = [{ createdBy: userId } as FilterQuery<T>];
    if (this.options.hasAssignees === true) {
      ors.push({ 'assignees.userId': userId } as FilterQuery<T>);
    }
    if (this.options.ownerUserField !== undefined) {
      ors.push({ [this.options.ownerUserField]: userId } as FilterQuery<T>);
    }
    return { $or: ors } as FilterQuery<T>;
  }

  protected baseFilter(scope?: ScopeSelector, extra?: FilterQuery<T>): FilterQuery<T> {
    const clauses: FilterQuery<T>[] = [];
    if (this.options.softDelete !== false) clauses.push({ isDeleted: false } as FilterQuery<T>);
    const scoped = this.scopeFilter(scope);
    if (Object.keys(scoped).length > 0) clauses.push(scoped);
    if (extra !== undefined && Object.keys(extra).length > 0) clauses.push(extra);
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<T>;
    return { $and: clauses } as FilterQuery<T>;
  }

  async findById(id: string, scope?: ScopeSelector): Promise<T | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOne(this.baseFilter(scope, { _id: new Types.ObjectId(id) } as FilterQuery<T>))
      .lean<T>()
      .exec();
  }

  async getById(id: string, scope?: ScopeSelector): Promise<T> {
    const doc = await this.findById(id, scope);
    if (doc === null) throw new NotFoundError();
    return doc;
  }

  async findOne(filter: FilterQuery<T>, scope?: ScopeSelector): Promise<T | null> {
    return this.model.findOne(this.baseFilter(scope, filter)).lean<T>().exec();
  }

  async exists(filter: FilterQuery<T>): Promise<boolean> {
    const found = await this.model.exists(this.baseFilter(undefined, filter)).exec();
    return found !== null;
  }

  async count(filter: FilterQuery<T> = {}, scope?: ScopeSelector): Promise<number> {
    return this.model.countDocuments(this.baseFilter(scope, filter)).exec();
  }

  /**
   * One `$group` producing every status bucket at once, scope- and soft-delete-aware. Callers that
   * need per-status numbers use this instead of a count per status, so a queue dashboard costs one
   * round trip per collection rather than one per bucket.
   */
  async countByStatus(
    filter: FilterQuery<T> = {},
    scope?: ScopeSelector,
  ): Promise<Record<string, number>> {
    const rows = await this.model
      .aggregate<{ _id: string; count: number }>([
        { $match: this.baseFilter(scope, filter) },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();
    return Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
  }

  /**
   * The same `$group`, split by a second key as well — the per-stage / per-phase form of
   * `countByStatus`. Returns `{ [groupId]: { [status]: count } }`.
   */
  async countByStatusGrouped(
    groupField: string,
    filter: FilterQuery<T> = {},
    scope?: ScopeSelector,
  ): Promise<Record<string, Record<string, number>>> {
    const rows = await this.model
      .aggregate<{ _id: { group: unknown; status: string }; count: number }>([
        { $match: this.baseFilter(scope, filter) },
        { $group: { _id: { group: `$${groupField}`, status: '$status' }, count: { $sum: 1 } } },
      ])
      .exec();
    const out: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      const key = String(row._id.group);
      out[key] = { ...(out[key] ?? {}), [String(row._id.status)]: row.count };
    }
    return out;
  }

  async list(params: ListParams<T>): Promise<Paginated<T>> {
    const pageSize = Math.min(params.pageSize, MAX_PAGE_SIZE);
    const page = Math.max(1, params.page);
    const filter = this.baseFilter(params.scope, params.filter);

    const sortField =
      params.sortBy !== undefined && (params.sortableFields ?? []).includes(params.sortBy)
        ? params.sortBy
        : 'createdAt';
    const sortDir = params.sortDir === 'asc' ? 1 : -1;

    const [items, totalItems] = await Promise.all([
      this.model
        .find(filter)
        .sort({ [sortField]: sortDir, _id: sortDir })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<T[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      items,
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      },
    };
  }

  async create(data: Partial<T>, meta: WriteMeta): Promise<T> {
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    const payload = { ...data, createdBy: by, updatedBy: by };
    try {
      const [doc] = await this.model.create([payload], { session: meta.session ?? null });
      if (doc === undefined) throw new NotFoundError('create returned no document');
      return doc.toObject() as T;
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new ConflictError();
      throw error;
    }
  }

  /**
   * Extra conditions EVERY write through this seam must satisfy, on top of id, version and scope.
   * Empty here; a subclass narrows it to make a class of rows permanently unwritable.
   *
   * It is a filter rather than a pre-check on purpose: the condition rides inside the same atomic
   * `findOneAndUpdate` as the write, so a concurrent change that makes the row unwritable cannot be
   * overtaken by a request that read it a moment earlier.
   */
  protected writeConditions(): FilterQuery<T> {
    return {} as FilterQuery<T>;
  }

  /**
   * Explain a write that matched nothing because `writeConditions()` excluded the row. Called with
   * the row as it actually is, BEFORE the miss is reported as a version conflict or a 404, so the
   * caller is told the real reason. No-op here; a subclass that narrows the conditions throws.
   */
  protected assertWritable(_current: T): void {
    /* nothing is excluded by default */
  }

  /**
   * Optimistic-concurrency update (API Standards §6): the caller supplies the document
   * `version` (__v); mismatch → 409 STALE_DOCUMENT.
   */
  async updateById(
    id: string,
    set: UpdateQuery<T>['$set'],
    meta: WriteMeta & { version: number; scope?: ScopeSelector | undefined },
  ): Promise<T> {
    const filter = this.baseFilter(meta.scope, {
      _id: new Types.ObjectId(id),
      __v: meta.version,
      ...this.writeConditions(),
    } as FilterQuery<T>);
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    const updated = await this.model
      .findOneAndUpdate(
        filter,
        { $set: { ...set, updatedBy: by }, $inc: { __v: 1 } } as UpdateQuery<T>,
        { new: true, session: meta.session ?? null },
      )
      .lean<T>()
      .exec();
    if (updated !== null) return updated;

    const current = await this.findById(id, meta.scope);
    if (current === null) throw new NotFoundError();
    // Why it missed, in order of precision: "this row may never be written" beats "someone else
    // wrote it first", because retrying with a fresh version would not help.
    this.assertWritable(current);
    throw new StaleDocumentError();
  }

  async softDeleteById(
    id: string,
    meta: WriteMeta & { scope?: ScopeSelector | undefined },
  ): Promise<T> {
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    const deleted = await this.model
      .findOneAndUpdate(
        this.baseFilter(meta.scope, {
          _id: new Types.ObjectId(id),
          ...this.writeConditions(),
        } as FilterQuery<T>),
        {
          $set: { isDeleted: true, deletedAt: new Date(), deletedBy: by, updatedBy: by },
          $inc: { __v: 1 },
        } as UpdateQuery<T>,
        { new: true, session: meta.session ?? null },
      )
      .lean<T>()
      .exec();
    if (deleted !== null) return deleted;

    const current = await this.findById(id, meta.scope);
    if (current !== null) this.assertWritable(current);
    throw new NotFoundError();
  }
}
