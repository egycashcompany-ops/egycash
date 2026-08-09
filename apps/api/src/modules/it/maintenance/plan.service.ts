// Maintenance plans — the preventive schedule (design §2.7, §4.6). Reference data with a clock:
// audited, no events. The order it generates is what fires.
//
// `nextDueAt` is the plan's ONLY clock and nothing recomputes it from a formula. It advances when
// the generated order completes, FROM THE COMPLETION DATE — the Fleet alarm-baseline lesson:
// advancing from the due date compounds drift, so a plan that slips once slips forever.
import { Types } from 'mongoose';
import {
  type CreateItMaintenancePlan,
  type ListItMaintenancePlansQuery,
  type Paginated,
  type UpdateItMaintenancePlan,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector, scopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { itAssetRepository } from '../assets/asset.repository';
import { type ItAssetDoc } from '../assets/asset.model';
import { itMaintenancePlanRepository } from './plan.repository';
import { type ItMaintenancePlanDoc } from './plan.model';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'maintenancePlan', entityId: id });

const snapshot = (doc: ItMaintenancePlanDoc) => ({
  assetId: String(doc.assetId),
  name: doc.name,
  intervalDays: doc.intervalDays,
  checklist: doc.checklist,
  nextDueAt: doc.nextDueAt.toISOString(),
  active: doc.active,
});

export const DAY_MS = 86_400_000;

/** The schedule's arithmetic, in one place: a due date is a base date plus whole days. */
export const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * DAY_MS);

class ItMaintenancePlanService {
  /**
   * Load the asset a plan will hang off, refusing the ones that cannot carry one.
   *
   * Returns the asset because the caller needs its `branchId`: the plan denormalizes the asset's
   * scope anchor at creation (§7), so a branch-scoped planner's list is filtered by the same
   * dimension the asset itself is filtered by.
   */
  private async loadPlannableAsset(assetId: string, scope: ScopeSelector): Promise<ItAssetDoc> {
    // Scoped: a plan cannot be attached to an asset its author could not see.
    const asset = await itAssetRepository.findById(assetId, scope);
    if (asset === null) throw new BusinessRuleError('assetId must reference a visible asset');
    if (asset.status === 'disposed') {
      throw new BusinessRuleError(
        `asset ${asset.assetCode} is disposed and cannot carry a maintenance plan`,
      );
    }
    return asset;
  }

  async create(input: CreateItMaintenancePlan, ctx: AuthContext): Promise<ItMaintenancePlanDoc> {
    const scope = scopeSelector(ctx, 'itMaintenance.view');
    const asset = await this.loadPlannableAsset(input.assetId, scope);

    const doc = await itMaintenancePlanRepository.create(
      {
        assetId: new Types.ObjectId(input.assetId),
        name: input.name,
        intervalDays: input.intervalDays,
        checklist: input.checklist ?? null,
        lastCompletedAt: null,
        // Absent → the first service falls one interval from today, which is the only default that
        // does not make a brand-new plan instantly overdue.
        nextDueAt: input.nextDueAt ?? addDays(new Date(), input.intervalDays),
        active: true,
        branchId: asset.branchId,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(
    query: ListItMaintenancePlansQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItMaintenancePlanDoc>> {
    return itMaintenancePlanRepository.listFiltered(query, scope);
  }

  async getById(id: string, scope: ScopeSelector): Promise<ItMaintenancePlanDoc> {
    return itMaintenancePlanRepository.getById(id, scope);
  }

  async update(
    id: string,
    input: UpdateItMaintenancePlan,
    ctx: AuthContext,
  ): Promise<ItMaintenancePlanDoc> {
    const scope = scopeSelector(ctx, 'itMaintenancePlan.manage');
    const before = await itMaintenancePlanRepository.getById(id, scope);
    const set: Partial<ItMaintenancePlanDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.intervalDays !== undefined) set.intervalDays = input.intervalDays;
    if (input.checklist !== undefined) set.checklist = input.checklist;
    // Changing the interval does NOT retroactively move the pending due date: the plan may already
    // have an order out against it, and moving the date under a live order would make the record
    // disagree with what was scheduled. `nextDueAt` is editable in its own right for exactly that.
    if (input.nextDueAt !== undefined) set.nextDueAt = input.nextDueAt;

    const updated = await itMaintenancePlanRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  /**
   * Activate / deactivate (§12). A named action, not a PATCH field: pausing a schedule is an
   * operational decision, and it is the one thing that takes a plan out of the sweep's sight.
   */
  async setActive(id: string, active: boolean, ctx: AuthContext): Promise<ItMaintenancePlanDoc> {
    const scope = scopeSelector(ctx, 'itMaintenancePlan.manage');
    const before = await itMaintenancePlanRepository.getById(id, scope);
    if (before.active === active) return before;
    const updated = await itMaintenancePlanRepository.updateById(
      id,
      { active },
      { by: ctx.userId, version: before.__v, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: active ? 'activate' : 'deactivate',
      changes: [{ field: 'active', old: before.active, new: active }],
    });
    return updated;
  }
}

export const itMaintenancePlanService = new ItMaintenancePlanService();
