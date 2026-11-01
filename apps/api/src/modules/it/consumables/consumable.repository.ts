import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { ItCatalogItemModel } from '../catalog-items/catalog-item.model';
import { collectionReady } from '../mobile-lines/ensure-collection';
import { type StockEffect } from './consumable-stock';
import { ItConsumableModel, type ItConsumableDoc } from './consumable.model';

/**
 * «النوع» as a sort key. The item stores a `typeId` and the column prints the type's NAME, so the
 * join happens before the page is cut — ordered by the ARABIC name, which the screen is read in.
 */
export const CONSUMABLE_TYPE_NAME_SORT = {
  key: 'typeName',
  from: ItCatalogItemModel.collection.name,
  localField: 'typeId',
  pick: 'name.ar',
} as const;

/** The two acts a retired item refuses, as the refusal names them. */
const REFUSED_WHEN_INACTIVE = {
  receive: 'receive stock',
  issue: 'be issued',
} as const;

export interface MoveStockOptions {
  session: ClientSession;
  by: string | null;
  scope?: ScopeSelector | undefined;
  /** Refuse a retired item — receiving into it, or issuing from it. A scrap or a return is not. */
  activeFor?: keyof typeof REFUSED_WHEN_INACTIVE | undefined;
}

class ItConsumableRepository extends BaseRepository<ItConsumableDoc> {
  readonly ensureCollection = collectionReady(ItConsumableModel);

  constructor() {
    // Branch-scoped like the assets and the lines: a branch-scoped technician keeps that store.
    super(ItConsumableModel, { branchField: 'branchId' });
  }

  /**
   * The requested items the caller may see — an issue's lines. Through the scoped list path, so a
   * branch-scoped reader is never told another store's item exists.
   */
  async findManyByIds(ids: readonly string[], scope?: ScopeSelector): Promise<ItConsumableDoc[]> {
    const distinct = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
    if (distinct.length === 0) return [];
    const page = await this.list({
      filter: { _id: { $in: distinct.map((id) => new Types.ObjectId(id)) } },
      page: 1,
      pageSize: distinct.length,
      ...(scope === undefined ? {} : { scope }),
    });
    return page.items;
  }

  /**
   * The store's item of this name, other than `exceptId` — the readable half of `ux_branch_name`:
   * the index is what holds under two people adding the same item at once, this is what lets the
   * refusal say which name it was.
   */
  async findByBranchAndName(
    branchId: Types.ObjectId,
    name: string,
    exceptId?: Types.ObjectId,
  ): Promise<ItConsumableDoc | null> {
    return this.model
      .findOne({
        branchId,
        name,
        isDeleted: false,
        ...(exceptId === undefined ? {} : { _id: { $ne: exceptId } }),
      })
      .lean<ItConsumableDoc>()
      .exec();
  }

  /**
   * The ids of the items a filter matches, as the caller may see them — for the ledger, which is
   * narrowed by facts of the ITEM (its type, its code or name). Ids only, in one read.
   */
  async idsMatching(
    filter: FilterQuery<ItConsumableDoc>,
    scope?: ScopeSelector,
  ): Promise<Types.ObjectId[]> {
    const rows = await this.model
      .find(this.baseFilter(scope, filter))
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return rows.map((row) => row._id);
  }

  /**
   * Move an item's counters by one movement's effect, and answer the row as it now stands.
   *
   * THE GUARD IS IN THE FILTER, not a read followed by a write: two people taking the last unit at
   * once both read «1 on hand» if they read first, and both writes then succeed. Here the second
   * one matches nothing (`onHandQty: { $gte: n }`), so on hand can never go below zero. A retired
   * item is refused the same way (`active: true`), so a deactivation racing a receipt cannot be
   * overtaken by it.
   *
   * A miss is therefore ambiguous — gone (or outside the caller's scope), retired, or not enough —
   * and it is told apart by reading the row in the same transaction rather than guessed at: the
   * answers are a 404 and two different 422s.
   *
   * No `__v` bump: the version guards the facts an edit changes (name, type, unit, minimum, notes,
   * active), which no movement touches — an edit form left open while stock arrives still saves.
   */
  async moveStock(
    id: string,
    effect: StockEffect,
    options: MoveStockOptions,
  ): Promise<ItConsumableDoc> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError('consumable not found');
    const _id = new Types.ObjectId(id);
    const guard: FilterQuery<ItConsumableDoc> = { _id };
    if (effect.onHand < 0) guard.onHandQty = { $gte: -effect.onHand };
    if (options.activeFor !== undefined) guard.active = true;

    const updated = await this.model
      .findOneAndUpdate(
        this.baseFilter(options.scope, guard),
        {
          $inc: {
            onHandQty: effect.onHand,
            issuedQty: effect.issued,
            scrappedQty: effect.scrapped,
          },
          $set: { updatedBy: options.by === null ? null : new Types.ObjectId(options.by) },
        },
        { new: true, session: options.session },
      )
      .lean<ItConsumableDoc>()
      .exec();
    if (updated !== null) return updated;

    const current = await this.model
      .findOne(this.baseFilter(options.scope, { _id }))
      .session(options.session)
      .lean<ItConsumableDoc>()
      .exec();
    if (current === null) throw new NotFoundError('consumable not found');
    if (options.activeFor !== undefined && !current.active) {
      throw new BusinessRuleError(
        `item ${current.code} is inactive and cannot ${REFUSED_WHEN_INACTIVE[options.activeFor]}`,
      );
    }
    throw new BusinessRuleError(
      `item ${current.code} has ${String(current.onHandQty)} on hand and cannot give ${String(-effect.onHand)}`,
    );
  }
}

export const itConsumableRepository = new ItConsumableRepository();
