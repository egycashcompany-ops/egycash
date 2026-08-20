import { Types, type FilterQuery } from 'mongoose';
import { MAX_PAGE_SIZE, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { GoldVaultModel, type GoldVaultDoc } from './vault.model';

class GoldVaultRepository extends BaseRepository<GoldVaultDoc> {
  constructor() {
    super(GoldVaultModel, { branchField: 'branchId' });
  }

  /** Is this code already taken by a live vault? Drives the auto-uniquified code on create. */
  async codeTaken(code: string): Promise<boolean> {
    return this.exists({ code } as never);
  }

  /**
   * The vault list in gold's own sequence: `{ order: 1, createdAt: -1 }`.
   *
   * `BaseRepository.list` ties on `_id` ascending, which reverses gold's tie-break — and ties are
   * ordinary here, because `create` defaults `order` to the live vault count, so any delete makes
   * the next creations reuse an existing order. `_id` stays as the last key so paging is still
   * deterministic.
   */
  async listInGoldOrder(params: {
    filter: FilterQuery<GoldVaultDoc>;
    page: number;
    pageSize: number;
    scope?: ScopeSelector;
  }): Promise<Paginated<GoldVaultDoc>> {
    const pageSize = Math.min(params.pageSize, MAX_PAGE_SIZE);
    const page = Math.max(1, params.page);
    const filter = this.baseFilter(params.scope, params.filter);
    const [items, totalItems] = await Promise.all([
      this.model
        .find(filter)
        .sort({ order: 1, createdAt: -1, _id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<GoldVaultDoc[]>()
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

  async listOrdered(scope?: ScopeSelector): Promise<GoldVaultDoc[]> {
    return this.model
      .find(this.baseFilter(scope))
      .sort({ order: 1, createdAt: -1 })
      .lean<GoldVaultDoc[]>()
      .exec();
  }

  async setOrder(id: string, order: number, floorId?: string | null): Promise<void> {
    const set: Record<string, unknown> = { order };
    if (floorId !== undefined) {
      set.floorId = floorId === null ? null : new Types.ObjectId(floorId);
    }
    await this.model.updateOne({ _id: id }, { $set: set }).exec();
  }

  async detachFloor(floorId: string): Promise<void> {
    await this.model
      .updateMany({ floorId: new Types.ObjectId(floorId) }, { $set: { floorId: null } })
      .exec();
  }

  async countOnFloor(floorId: string): Promise<number> {
    return this.count({ floorId: new Types.ObjectId(floorId) } as never);
  }
}

export const goldVaultRepository = new GoldVaultRepository();
