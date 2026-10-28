// The consumables store (FR-20) — «أقدر أحدد عندي Stock إيه من كل واحده وإيه الهالك»: add an item
// to a branch's store (with its opening quantity, if any), edit its facts, receive stock, scrap it,
// take it back from a person, and read the store and its ledger. The issue to a person — the one
// action that writes a memo — is `consumable-issue.service`.
//
// Every quantity moves through a MOVEMENT written in the same transaction as the counters it moves
// (`itConsumableRepository.moveStock`, whose filter is the guard), and is audited after the commit.
// There is no «set on hand to N»: an adjustment that leaves no movement is a number nobody can
// explain six months later (ADR-024).
import { Types, type FilterQuery } from 'mongoose';
import {
  type AuditChange,
  type CreateItConsumable,
  type ListItConsumableMovementsQuery,
  type ListItConsumablesQuery,
  type Paginated,
  type ReceiveItConsumable,
  type ReturnItConsumable,
  type ScrapItConsumable,
  type UpdateItConsumable,
} from '@ecms/contracts';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors';
import { keyReachesBranch, type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { getDirectoryEmployees } from '../../../platform/directory';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
// Types only, and imported as such: the mapper module reaches every IT model, which a service that
// only names the label shapes has no reason to load.
import type { ItConsumableMovementLabels, ItHolderLabels } from '../it.mappers';
import { itCatalogItemRepository } from '../catalog-items/catalog-item.repository';
import { itAssetRepository } from '../assets/asset.repository';
import { reserveSequenceBlock } from '../shared/sequence';
import { cairoDayEnd, cairoDayStart } from '../shared/cairo-day';
import { registerSearchPattern } from '../shared/register-search';
import { CONSUMABLE_SEQUENCE_KEY, formatConsumableCode } from './consumable-number';
import { NO_STOCK, beforeStockEffect, stockEffect } from './consumable-stock';
import { CONSUMABLE_TYPE_NAME_SORT, itConsumableRepository } from './consumable.repository';
import { itConsumableMovementRepository } from './consumable-movement.repository';
import { itConsumableMemoRepository } from './consumable-memo.repository';
import {
  auditConsumableCreated,
  auditStockMovement,
  change,
  consumableEntityRef,
  consumableItemRow,
  consumableMovementRow,
  consumableSnapshot,
  ensureItConsumableCollections,
  type ConsumableMovementInput,
} from './consumable-history';
import { type ItConsumableDoc } from './consumable.model';
import { type ItConsumableMovementDoc } from './consumable-movement.model';

/**
 * A search box's text as one pattern over an item's code and name, or none when the box holds
 * nothing to match. A code is ASCII («CON-00012») and is often typed in Arabic digits; a name may
 * carry either digit set on purpose («كابل HDMI ٣ متر») — so a digit matches its value in every set
 * (`registerSearchPattern`, the custody register's rule). Escaped, so `.` is a dot.
 */
const itemSearch = (text: string): FilterQuery<ItConsumableDoc>[] | null => {
  const pattern = registerSearchPattern(text);
  return pattern === null ? null : [{ code: pattern }, { name: pattern }];
};

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

const nameTaken = (name: string): ConflictError =>
  new ConflictError(`«${name}» is already an item of this branch's store`);

const idOf = (id: Types.ObjectId | null | undefined): string | null =>
  id == null ? null : String(id);

const employeeLabels = async (ids: readonly (string | null)[]): Promise<ItHolderLabels> => {
  const distinct = [...new Set(ids.filter((id): id is string => id !== null))];
  if (distinct.length === 0) return new Map();
  const employees = await getDirectoryEmployees(distinct);
  return new Map(
    [...employees].map(([id, employee]) => [
      id,
      { code: employee.code, fullNameAr: employee.fullNameAr },
    ]),
  );
};

/** The register's sortable columns; `typeName` is joined from the catalog before the page is cut. */
const REGISTER_SORTABLE = [
  'code',
  'name',
  'typeName',
  'unit',
  'onHandQty',
  'issuedQty',
  'scrappedQty',
  'minQty',
  'createdAt',
  'updatedAt',
] as const;

class ItConsumableService {
  /** A type must be an ACTIVE catalog row of the consumables' kind — never an asset category. */
  private async assertType(typeId: string): Promise<void> {
    const type = await itCatalogItemRepository.findActiveOfKind(typeId, 'consumableType');
    if (type === null) {
      throw new BusinessRuleError('typeId must reference an active consumable type');
    }
  }

  private registerFilter(query: ListItConsumablesQuery): FilterQuery<ItConsumableDoc> {
    const clauses: FilterQuery<ItConsumableDoc>[] = [];
    if (query.typeId !== undefined) clauses.push({ typeId: new Types.ObjectId(query.typeId) });
    if (query.branchId !== undefined) {
      clauses.push({ branchId: new Types.ObjectId(query.branchId) });
    }
    if (query.active !== undefined) clauses.push({ active: query.active });
    // «Below minimum» compares two fields, so it needs `$expr`; an item with no minimum has none to
    // be below, and is never «below» — nor kept out of «not below».
    if (query.belowMin === true) {
      clauses.push({ minQty: { $ne: null }, $expr: { $lte: ['$onHandQty', '$minQty'] } });
    }
    if (query.belowMin === false) {
      clauses.push({ $or: [{ minQty: null }, { $expr: { $gt: ['$onHandQty', '$minQty'] } }] });
    }
    const searched = itemSearch(query.search ?? '');
    if (searched !== null) {
      clauses.push({ $or: searched });
    }
    return clauses.length === 0 ? {} : { $and: clauses };
  }

  async list(
    query: ListItConsumablesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItConsumableDoc>> {
    return itConsumableRepository.list({
      filter: this.registerFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      // Unsorted, the store reads in the order its items were added — the owner's own sheet order
      // for the opening stock, and a stable order for everything after.
      ...(query.sortBy === undefined ? { sorts: [{ by: 'code', dir: 'asc' as const }] } : {}),
      sortableFields: REGISTER_SORTABLE,
      sortDerived: [CONSUMABLE_TYPE_NAME_SORT],
      scope,
    });
  }

  async get(id: string, scope: ScopeSelector): Promise<ItConsumableDoc> {
    const item = await itConsumableRepository.findById(id, scope);
    if (item === null) throw new NotFoundError('consumable not found');
    return item;
  }

  /**
   * Add an item to a branch's store — only a branch the caller's `itAsset.create` reaches: the
   * scope that hides another store from them must not let them stock it.
   *
   * No quantity is a field. An opening quantity is a `received` movement written in the SAME
   * transaction, and the counters are what that movement makes of an empty item — so the opening
   * balance is never the one number in the store with no movement behind it. The code is reserved
   * inside the transaction too: a refused add gives it back.
   */
  async create(input: CreateItConsumable, ctx: AuthContext): Promise<ItConsumableDoc> {
    if (!keyReachesBranch(ctx, 'itAsset.create', input.branchId)) {
      throw new ForbiddenError('itAsset.create does not reach this branch');
    }
    await this.assertType(input.typeId);
    const branchId = new Types.ObjectId(input.branchId);
    if ((await itConsumableRepository.findByBranchAndName(branchId, input.name)) !== null) {
      throw nameTaken(input.name);
    }

    const at = new Date();
    const openingQty = input.openingQty ?? null;
    await ensureItConsumableCollections();
    const done = await unitOfWork(async (session) => {
      const seq = await reserveSequenceBlock(CONSUMABLE_SEQUENCE_KEY, 1, session);
      const item = await itConsumableRepository.create(
        consumableItemRow({
          code: formatConsumableCode(seq),
          name: input.name,
          typeId: new Types.ObjectId(input.typeId),
          unit: input.unit,
          branchId,
          minQty: input.minQty ?? null,
          notes: input.notes ?? null,
          openingQty,
        }),
        { by: ctx.userId, session },
      );
      const movement =
        openingQty === null
          ? null
          : await itConsumableMovementRepository.create(
              consumableMovementRow({
                item,
                kind: 'received',
                qty: openingQty,
                at,
                byUserId: ctx.userId,
              }),
              { by: ctx.userId, session },
            );
      return { item, movement };
    });

    await auditConsumableCreated(done.item);
    if (done.movement !== null) {
      await auditStockMovement({
        consumableId: String(done.item._id),
        kind: 'received',
        before: NO_STOCK,
        after: done.item,
        extra: [change('movementId', null, String(done.movement._id))],
      });
    }
    return done.item;
  }

  /**
   * Edit the store's facts — never a quantity, which only movements move, and never the branch: a
   * store's item stays in it. A new type must be an active consumable type; a new name must be free
   * in this store (the unique index holds it under a race, and either way it is a 409).
   */
  async update(
    id: string,
    input: UpdateItConsumable,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItConsumableDoc> {
    const before = await this.get(id, scope);
    if (input.typeId !== undefined && input.typeId !== String(before.typeId)) {
      await this.assertType(input.typeId);
    }
    if (input.name !== undefined && input.name !== before.name) {
      const clash = await itConsumableRepository.findByBranchAndName(
        before.branchId,
        input.name,
        before._id,
      );
      if (clash !== null) throw nameTaken(input.name);
    }

    const set: Partial<ItConsumableDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.typeId !== undefined) set.typeId = new Types.ObjectId(input.typeId);
    if (input.unit !== undefined) set.unit = input.unit;
    if (input.minQty !== undefined) set.minQty = input.minQty;
    if (input.notes !== undefined) set.notes = input.notes;
    if (input.active !== undefined) set.active = input.active;

    await itConsumableRepository.ensureCollection();
    let updated: ItConsumableDoc;
    try {
      updated = await itConsumableRepository.updateById(id, set, {
        by: ctx.userId,
        version: input.version,
        scope,
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw nameTaken(input.name ?? before.name);
      throw error;
    }
    const changes = diffChanges(consumableSnapshot(before), consumableSnapshot(updated));
    if (changes.length > 0) {
      await auditService.record({ entityRef: consumableEntityRef(id), action: 'update', changes });
    }
    return updated;
  }

  /**
   * One movement and the counters it moves, in one transaction, audited after the commit. The
   * counters BEFORE are derived from the row the write returned, so the audit is true even if
   * another movement landed a moment earlier.
   */
  private async move(
    id: string,
    movement: Omit<ConsumableMovementInput, 'item' | 'byUserId'>,
    ctx: AuthContext,
    scope: ScopeSelector,
    options: { activeFor?: 'receive'; extra?: readonly AuditChange[] } = {},
  ): Promise<ItConsumableDoc> {
    const effect = stockEffect(movement.kind, movement.qty);
    await ensureItConsumableCollections();
    const done = await unitOfWork(async (session) => {
      const item = await itConsumableRepository.moveStock(id, effect, {
        session,
        by: ctx.userId,
        scope,
        activeFor: options.activeFor,
      });
      const row = await itConsumableMovementRepository.create(
        consumableMovementRow({ ...movement, item, byUserId: ctx.userId }),
        { by: ctx.userId, session },
      );
      return { item, row };
    });
    await auditStockMovement({
      consumableId: id,
      kind: movement.kind,
      before: beforeStockEffect(done.item, effect),
      after: done.item,
      extra: [change('movementId', null, String(done.row._id)), ...(options.extra ?? [])],
    });
    return done.item;
  }

  /** «توريد» — stock in. A retired item takes none: a delivery for it is the wrong item picked. */
  async receive(
    id: string,
    input: ReceiveItConsumable,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItConsumableDoc> {
    return this.move(
      id,
      { kind: 'received', qty: input.qty, at: input.at ?? new Date(), notes: input.notes ?? null },
      ctx,
      scope,
      { activeFor: 'receive' },
    );
  }

  /**
   * «هالك» — out of the store as scrap, why being the record. A retired item may still be
   * scrapped: writing off what is left of it is how its shelf is emptied.
   */
  async scrap(
    id: string,
    input: ScrapItConsumable,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItConsumableDoc> {
    return this.move(
      id,
      { kind: 'scrapped', qty: input.qty, at: input.at ?? new Date(), reason: input.reason },
      ctx,
      scope,
      { extra: [change('reason', null, input.reason)] },
    );
  }

  /**
   * «مرتجع» — back on the shelf in working order, from a person when known. Taken back even for a
   * retired item: the unit physically came back, and the ledger records what happened. A leaver
   * is not refused — giving things back is exactly what leaving is.
   */
  async returnStock(
    id: string,
    input: ReturnItConsumable,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItConsumableDoc> {
    const employeeId = input.employeeId ?? null;
    return this.move(
      id,
      {
        kind: 'returned',
        qty: input.qty,
        at: input.at ?? new Date(),
        employeeId,
        notes: input.notes ?? null,
      },
      ctx,
      scope,
      { extra: employeeId === null ? [] : [change('employeeId', null, employeeId)] },
    );
  }

  /**
   * The ledger's filter. The item's facts — its type, its code or name — are matched through the
   * items the caller may see; everything else is the movement's own.
   */
  private async ledgerFilter(
    query: ListItConsumableMovementsQuery,
    scope: ScopeSelector,
  ): Promise<FilterQuery<ItConsumableMovementDoc>> {
    const clauses: FilterQuery<ItConsumableMovementDoc>[] = [];
    if (query.kind !== undefined) clauses.push({ kind: query.kind });
    if (query.consumableId !== undefined) {
      clauses.push({ consumableId: new Types.ObjectId(query.consumableId) });
    }
    if (query.employeeId !== undefined) {
      clauses.push({ employeeId: new Types.ObjectId(query.employeeId) });
    }
    if (query.assetId !== undefined) clauses.push({ assetId: new Types.ObjectId(query.assetId) });
    if (query.branchId !== undefined) {
      clauses.push({ branchId: new Types.ObjectId(query.branchId) });
    }
    // Cairo days, the days the ledger prints: a movement typed at 01:30 is the day before in UTC.
    if (query.from !== undefined) clauses.push({ at: { $gte: cairoDayStart(query.from) } });
    if (query.to !== undefined) clauses.push({ at: { $lt: cairoDayEnd(query.to) } });
    const searched = itemSearch(query.search ?? '');
    if (query.typeId !== undefined || searched !== null) {
      const items: FilterQuery<ItConsumableDoc>[] = [];
      if (query.typeId !== undefined) items.push({ typeId: new Types.ObjectId(query.typeId) });
      if (searched !== null) items.push({ $or: searched });
      clauses.push({
        consumableId: { $in: await itConsumableRepository.idsMatching({ $and: items }, scope) },
      });
    }
    return clauses.length === 0 ? {} : { $and: clauses };
  }

  /** The ledger across items, newest first — scoped on each movement's store. */
  async listMovements(
    query: ListItConsumableMovementsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItConsumableMovementDoc>> {
    return itConsumableMovementRepository.list({
      filter: await this.ledgerFilter(query, scope),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'at',
      sortDir: query.sortDir,
      sortableFields: ['at', 'qty', 'kind', 'createdAt'],
      scope,
    });
  }

  /** One item's movements — read only once the item itself is, under the same scope. */
  async itemMovements(
    id: string,
    query: ListItConsumableMovementsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItConsumableMovementDoc>> {
    await this.get(id, scope);
    return this.listMovements({ ...query, consumableId: id }, scope);
  }

  /**
   * The labels on ONE page of the ledger — four reads per page, never four per row: the items
   * (their store is the movement's, already read under scope), the employees through the
   * directory, the assets THROUGH the caller's scope (an asset from a branch they cannot see is not
   * named), and the memos with their signed state (a memo that is gone is not listed, so the row
   * offers none).
   */
  async movementLabels(
    rows: readonly ItConsumableMovementDoc[],
    scope: ScopeSelector,
  ): Promise<ItConsumableMovementLabels> {
    const assetIds = [...new Set(rows.flatMap((row) => idOf(row.assetId) ?? []))];
    const [items, employees, assets, memos] = await Promise.all([
      itConsumableRepository.findByIdsSystem(rows.map((row) => String(row.consumableId))),
      employeeLabels(rows.map((row) => idOf(row.employeeId))),
      assetIds.length === 0 ? [] : itAssetRepository.findManyByIds(assetIds, scope),
      itConsumableMemoRepository.findByIdsSystem(rows.flatMap((row) => idOf(row.memoId) ?? [])),
    ]);
    return {
      items: new Map(
        items.map((item) => [
          String(item._id),
          { code: item.code, name: item.name, typeId: String(item.typeId) },
        ]),
      ),
      employees,
      assets: new Map(
        assets.map((asset) => [
          String(asset._id),
          { assetCode: asset.assetCode, name: asset.name },
        ]),
      ),
      memos: new Map(
        memos
          .filter((memo) => !memo.isDeleted)
          .map((memo) => [
            String(memo._id),
            { memoNumber: memo.memoNumber, signed: memo.signedCopy != null },
          ]),
      ),
    };
  }
}

export const itConsumableService = new ItConsumableService();
