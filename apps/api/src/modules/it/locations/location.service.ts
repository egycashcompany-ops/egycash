// «المواقع» — each branch's list of places (design §2): where a department keeps what it holds.
// Configuration, not domain facts: audited, no events (the catalog's precedent).
//
// Managed under `itCatalog.manage` — no new key — and judged per BRANCH: a write names a branch the
// key must reach as a whole (`keyReachesBranch`, ATM's ref-label rule), because the caller's
// account reach is the union of ALL their grants. The tab's list reads under the key's scope; the
// pickers' options are names, unscoped (a hand-over may name a place in a branch the catalog key
// does not reach, as a department may be any branch's).
//
// A place never changes branch, and is retired, never deleted: retiring is refused (409) while an
// asset is held there — the custody would name a place nobody may pick again — and a past
// consumables issue does not block it (it names the place as it was).
import { Types, type FilterQuery } from 'mongoose';
import {
  type CreateItLocation,
  type ItLocationOptionsQuery,
  type ItMoveTargetsDto,
  type ListItLocationsQuery,
  type LocalizedString,
  type Paginated,
  type UpdateItLocation,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { branchRepository } from '../../../platform/organization';
import { publishAuditedChange } from '../../../platform/realtime';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import {
  hasPermission,
  keyReachesBranch,
  scopeSelector,
  type AuthContext,
} from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { moveTargetBranchIds } from '../assets/asset-move';
import { registerSearchPattern } from '../shared/register-search';
import { type ItLocationDoc } from './location.model';
import { heldAtLocationReader, itLocationRepository } from './location.repository';

/** The one grant every place write and the tab's list are judged on (design §2, default §8.14). */
export const LOCATION_GRANT = 'itCatalog.manage';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'location', entityId: id });

/** How many assets each place holds now, as the reader may see them; null without `itAsset.view`. */
export type HeldCounts = ReadonlyMap<string, number> | null;

/** Pure: one place's «في عهدته الآن» out of the counts — 0 when it holds nothing in reach. */
export const heldOf = (held: HeldCounts, doc: Pick<ItLocationDoc, '_id'>): number | null =>
  held === null ? null : (held.get(String(doc._id)) ?? 0);

/** Pure: the refusal's message — the count, and what to do about it. */
export const heldAtPlaceMessage = (count: number): string =>
  `${String(count)} ${count === 1 ? 'asset is' : 'assets are'} held at this place; transfer or return ${count === 1 ? 'it' : 'them'} first`;

const snapshot = (doc: ItLocationDoc) => ({
  branchId: String(doc.branchId),
  code: doc.code,
  name: doc.name,
  description: doc.description,
  sortOrder: doc.sortOrder,
  isActive: doc.isActive,
});

/** A place's name as stored: trimmed, so «غرفة السيرفرات » is the same place as «غرفة السيرفرات». */
const cleanName = (name: LocalizedString): LocalizedString => {
  const ar = name.ar.trim();
  const en = name.en.trim();
  if (ar === '') {
    throw new ValidationError([
      { field: 'body.name.ar', code: 'REQUIRED', message: 'a place needs a name' },
    ]);
  }
  if (en === '') {
    throw new ValidationError([
      { field: 'body.name.en', code: 'REQUIRED', message: 'a place needs a name' },
    ]);
  }
  return { ar, en };
};

const nameTaken = (nameAr: string): ConflictError =>
  new ConflictError(`"${nameAr}" is already a place in this branch`);

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * Every refresh signal names the place's branch: the audit row announces itself to the
 * organization-wide room only (it names no branch), and a branch-scoped `itCatalog.manage` holder
 * joins only their branches' rooms — this reaches them too (`signalConsumable`'s precedent).
 */
const signalLocation = (doc: ItLocationDoc): void => {
  publishAuditedChange({
    entityRef: entityRef(String(doc._id)),
    action: 'update',
    at: new Date().toISOString(),
    branchId: String(doc.branchId),
  });
};

class ItLocationService {
  /** The catalogs page's «المواقع» tab — under the key's scope, a branch, a status and a search. */
  async list(
    query: ListItLocationsQuery,
    ctx: AuthContext,
  ): Promise<{ page: Paginated<ItLocationDoc>; held: HeldCounts }> {
    const clauses: FilterQuery<ItLocationDoc>[] = [];
    if (query.branchId !== undefined) {
      clauses.push({ branchId: new Types.ObjectId(query.branchId) });
    }
    if (query.isActive !== undefined) clauses.push({ isActive: query.isActive });
    const pattern = query.search === undefined ? null : registerSearchPattern(query.search);
    if (pattern !== null) {
      clauses.push({ $or: [{ 'name.ar': pattern }, { 'name.en': pattern }, { code: pattern }] });
    }
    const page = await itLocationRepository.list({
      filter: clauses.length === 0 ? {} : { $and: clauses },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      // With no column chosen, a branch's places read in their own order, as the pickers list them.
      ...(query.sortBy === undefined
        ? {
            sorts: [
              { by: 'branchId', dir: 'asc' as const },
              { by: 'sortOrder', dir: 'asc' as const },
              { by: 'name.ar', dir: 'asc' as const },
            ],
          }
        : {}),
      sortableFields: [
        'branchId',
        'sortOrder',
        'name.ar',
        'name.en',
        'code',
        'isActive',
        'createdAt',
      ],
      scope: scopeSelector(ctx, LOCATION_GRANT),
    });
    return { page, held: await this.heldCounts(page.items, ctx) };
  }

  /**
   * «في عهدته الآن» for these places — ONE `$group` of the open intervals naming them, under the
   * reader's `itAsset.view` scope (a count never shows more than the custody register would list).
   * Null when the reader does not hold `itAsset.view`: the tab shows no column then.
   */
  async heldCounts(docs: readonly ItLocationDoc[], ctx: AuthContext): Promise<HeldCounts> {
    if (!hasPermission(ctx, 'itAsset.view')) return null;
    if (docs.length === 0) return new Map();
    return heldAtLocationReader.countOpenByLocations(
      docs.map((doc) => String(doc._id)),
      scopeSelector(ctx, 'itAsset.view'),
    );
  }

  /** The pickers: names only, every branch's or one branch's, active unless `includeInactive`. */
  async options(query: ItLocationOptionsQuery): Promise<ItLocationDoc[]> {
    return itLocationRepository.listOptions(query);
  }

  /**
   * Where the create dialog may file a place: every active branch `itCatalog.manage` reaches as a
   * whole — `moveTargetBranchIds`, the test `create` applies — so the dialog's branch picker offers
   * nothing the save would answer with 403 (the account's branches are the reach of ALL its
   * grants). In the branch options' order (by code).
   */
  async branchTargets(ctx: AuthContext): Promise<ItMoveTargetsDto> {
    const branches = await branchRepository.listAll();
    return {
      branchIds: moveTargetBranchIds(
        ctx,
        LOCATION_GRANT,
        branches.map((branch) => ({ id: String(branch._id), status: branch.status })),
      ),
    };
  }

  async create(input: CreateItLocation, ctx: AuthContext): Promise<ItLocationDoc> {
    if (!keyReachesBranch(ctx, LOCATION_GRANT, input.branchId)) {
      throw new ForbiddenError('itCatalog.manage does not reach this branch');
    }
    const branch = await branchRepository.findById(input.branchId);
    if (branch === null || branch.status !== 'active') {
      throw new ValidationError([
        { field: 'body.branchId', code: 'UNKNOWN', message: 'branch not found or inactive' },
      ]);
    }
    const name = cleanName(input.name);
    if ((await itLocationRepository.findByBranchAndNameAr(input.branchId, name.ar)) !== null) {
      throw nameTaken(name.ar);
    }
    // The unique index (`ux_branch_name_ar`) holds the race the read above cannot; the repository
    // turns its refusal into a 409.
    const doc = await itLocationRepository.create(
      {
        branchId: new Types.ObjectId(input.branchId),
        name,
        code: input.code ?? null,
        description: input.description ?? null,
        sortOrder: input.sortOrder,
        isActive: true,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    signalLocation(doc);
    return doc;
  }

  /**
   * Rename, re-code, re-order, describe, retire or bring back a place. Its branch never changes
   * (the contract takes none). The key must reach the place's branch as a whole — 403 otherwise:
   * the place is no secret, every IT reader's pickers list it. Retiring is refused (409) while
   * assets are held there, counted whoever may see them.
   */
  async update(id: string, input: UpdateItLocation, ctx: AuthContext): Promise<ItLocationDoc> {
    const before = await itLocationRepository.findById(id);
    if (before === null) throw new NotFoundError('IT location');
    const branchId = String(before.branchId);
    if (!keyReachesBranch(ctx, LOCATION_GRANT, branchId)) {
      throw new ForbiddenError('itCatalog.manage does not reach this place’s branch');
    }
    const set: Partial<ItLocationDoc> = {};
    if (input.name !== undefined) {
      const name = cleanName(input.name);
      if (
        name.ar !== before.name.ar &&
        (await itLocationRepository.findByBranchAndNameAr(branchId, name.ar, id)) !== null
      ) {
        throw nameTaken(name.ar);
      }
      set.name = name;
    }
    if (input.code !== undefined) set.code = input.code;
    if (input.description !== undefined) set.description = input.description;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) {
      if (!input.isActive && before.isActive) {
        const held = await heldAtLocationReader.countOpenAt(id);
        if (held > 0) throw new ConflictError(heldAtPlaceMessage(held));
      }
      set.isActive = input.isActive;
    }
    let updated: ItLocationDoc;
    try {
      updated = await itLocationRepository.updateById(id, set, {
        by: ctx.userId,
        version: input.version,
      });
    } catch (error) {
      // Two renames to one name at once: the index refuses the second.
      if (isDuplicateKeyError(error)) throw nameTaken(set.name?.ar ?? before.name.ar);
      throw error;
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    signalLocation(updated);
    return updated;
  }
}

export const itLocationService = new ItLocationService();
