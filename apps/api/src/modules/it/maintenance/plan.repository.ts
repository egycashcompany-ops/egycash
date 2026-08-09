import { Types } from 'mongoose';
import { type ListItMaintenancePlansQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { ItMaintenancePlanModel, type ItMaintenancePlanDoc } from './plan.model';

class ItMaintenancePlanRepository extends BaseRepository<ItMaintenancePlanDoc> {
  constructor() {
    // Same anchor as the order's, for the same reason (§7).
    super(ItMaintenancePlanModel, { branchField: 'branchId' });
  }

  async listFiltered(
    query: ListItMaintenancePlansQuery,
    scope?: ScopeSelector,
  ): Promise<Paginated<ItMaintenancePlanDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.assetId !== undefined) filter.assetId = new Types.ObjectId(query.assetId);
    if (query.active !== undefined) filter.active = query.active;
    // "Due" reads `nextDueAt`, never a recomputed schedule — the same stamp the sweep reads.
    if (query.due === true) filter.nextDueAt = { $lte: new Date() };
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['nextDueAt', 'name', 'createdAt'],
      ...(scope === undefined ? {} : { scope }),
    });
  }

  /**
   * §4.6's query: active plans due within the horizon. Backed by `ix_due_active`.
   *
   * Deliberately UNSCOPED, like `hasUnfinishedForPlan` — the sweep serves the whole organization.
   */
  async findDue(cutoff: Date, limit: number): Promise<ItMaintenancePlanDoc[]> {
    return this.model
      .find({ active: true, isDeleted: false, nextDueAt: { $lte: cutoff } })
      .limit(limit)
      .lean<ItMaintenancePlanDoc[]>()
      .exec();
  }
}

export const itMaintenancePlanRepository = new ItMaintenancePlanRepository();
