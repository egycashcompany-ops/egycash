// Maintenance orders (design §2.7, §4.6, §4.7).
//
// Four named actions — create · start · complete · cancel — never a generic status PATCH, for the
// same reason custody has four: each is a distinct business act with its own guard, its own asset
// consequence and its own audit row.
//
// **The asset-status contract.** `start` puts the asset `underMaintenance` and REMEMBERS what it
// was (`assetStatusBefore`); `complete` and a cancel-from-`inProgress` put it back. The design says
// "completion returns the asset to its prior custody state (assigned assets stay assigned — a
// laptop being repaired is still that person's laptop)", and a remembered status is the only way to
// honour that: recomputing it would have to guess, and it would guess `inStock`, silently breaking
// the custody thread of every repaired laptop.
//
// Everything that must land together lands in ONE transaction: the order row, the asset row, the
// asset history event, the part movements and the plan's advanced clock. Events are emitted after
// the commit — subscribers react to facts, and a fact that rolled back is not one.
import { Types } from 'mongoose';
import {
  ItEvents,
  type CancelItMaintenanceOrder,
  type CompleteItMaintenanceOrder,
  type CreateItMaintenanceOrder,
  type ItAssetStatus,
  type ListItMaintenanceOrdersQuery,
  type Paginated,
  type StartItMaintenanceOrder,
  type UpdateItMaintenanceOrder,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector, scopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { itAssetRepository } from '../assets/asset.repository';
import { itAssetEventRepository } from '../assets/asset-event.repository';
import { itTicketRepository } from '../tickets/ticket.repository';
import { itVendorRepository } from '../vendors/vendor.repository';
import { itSparePartService } from '../spare-parts/part.service';
import { itSparePartMovementRepository } from '../spare-parts/movement.repository';
import { type ItSparePartMovementDoc } from '../spare-parts/movement.model';
import { type ItAssetDoc } from '../assets/asset.model';
import { itMaintenanceOrderRepository } from './order.repository';
import { itMaintenancePlanRepository } from './plan.repository';
import { canTransitionOrder } from './order-lifecycle';
import { nextMaintenanceOrderCode } from './order-number';
import { addDays } from './plan.service';
import { type ItMaintenanceOrderDoc } from './order.model';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'maintenanceOrder', entityId: id });

const actorNameOf = (ctx: AuthContext): string =>
  ctx.identity?.displayName?.[ctx.locale === 'ar' ? 'ar' : 'en'] ?? '';

const change = (field: string, from: unknown, to: unknown) => ({ field, old: from, new: to });

/**
 * The order's own scope anchor is its ASSET — orders carry no branch of their own (§7), so every
 * asset read on this path goes through the maintenance grant's scope. Using `itAsset.view` instead
 * would silently fall back to `own` for a technician who holds no asset grant, and `own` on assets
 * means "assets you registered" — which is nobody's idea of a maintenance queue.
 */
const maintenanceScope = (ctx: AuthContext): ScopeSelector =>
  scopeSelector(ctx, 'itMaintenance.view');

class ItMaintenanceOrderService {
  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(
    query: ListItMaintenanceOrdersQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItMaintenanceOrderDoc>> {
    return itMaintenanceOrderRepository.listFiltered(query, scope);
  }

  async getById(id: string, scope: ScopeSelector): Promise<ItMaintenanceOrderDoc> {
    return itMaintenanceOrderRepository.getById(id, scope);
  }

  /**
   * The order detail's "parts used" panel — the movements ARE the list (ADR-024).
   *
   * The order is re-read UNDER SCOPE first: the movements carry no branch of their own, so the
   * order is what decides whether this caller may see them at all.
   */
  async listParts(id: string, scope: ScopeSelector): Promise<ItSparePartMovementDoc[]> {
    const order = await itMaintenanceOrderRepository.getById(id, scope);
    return itSparePartMovementRepository.listForOrder(order._id);
  }

  // ── Creation ──────────────────────────────────────────────────────────────

  private async assertReferences(
    input: { ticketId?: string | null | undefined; vendorId?: string | null | undefined },
  ): Promise<void> {
    if (input.ticketId !== undefined && input.ticketId !== null) {
      const ticket = await itTicketRepository.findById(input.ticketId);
      if (ticket === null) throw new BusinessRuleError('ticketId must reference an existing ticket');
    }
    if (input.vendorId !== undefined && input.vendorId !== null) {
      const vendor = await itVendorRepository.findOne({ _id: input.vendorId, isActive: true });
      if (vendor === null) throw new BusinessRuleError('vendorId must reference an active vendor');
    }
  }

  /**
   * Corrective order (§4.7) — created directly, or from a ticket via `ticketId`.
   *
   * `kind` is not a parameter: a preventive order is born from the sweep, never from a caller, and
   * letting a client claim `preventive` would put an order in the plan's history that no plan
   * generated.
   */
  async create(
    input: CreateItMaintenanceOrder,
    ctx: AuthContext,
  ): Promise<{ order: ItMaintenanceOrderDoc; asset: ItAssetDoc }> {
    const scope = maintenanceScope(ctx);
    const asset = await itAssetRepository.findById(input.assetId, scope);
    if (asset === null) throw new BusinessRuleError('assetId must reference a visible asset');
    if (asset.status === 'disposed') {
      throw new BusinessRuleError(
        `asset ${asset.assetCode} is disposed and accepts no maintenance order (FR-4)`,
      );
    }
    await this.assertReferences(input);

    const orderCode = await nextMaintenanceOrderCode();
    const order = await itMaintenanceOrderRepository.create(
      {
        orderCode,
        kind: 'corrective',
        assetId: new Types.ObjectId(input.assetId),
        planId: null,
        ticketId: input.ticketId === undefined ? null : new Types.ObjectId(input.ticketId),
        status: 'open',
        scheduledFor: input.scheduledFor ?? null,
        startedAt: null,
        completedAt: null,
        performedByUserId: null,
        vendorId: input.vendorId === undefined ? null : new Types.ObjectId(input.vendorId),
        cost: null,
        summary: input.summary ?? null,
        assetStatusBefore: null,
        branchId: asset.branchId,
      },
      { by: ctx.userId },
    );

    await auditService.record({
      entityRef: entityRef(String(order._id)),
      action: 'create',
      changes: [
        change('orderCode', null, orderCode),
        change('assetId', null, input.assetId),
        change('kind', null, 'corrective'),
      ],
    });
    await emit(ItEvents.MaintenanceOrderCreated, {
      orderId: String(order._id),
      orderCode,
      kind: 'corrective',
      assetId: input.assetId,
      assetCode: asset.assetCode,
      planId: null,
      ticketId: input.ticketId ?? null,
    });
    return { order, asset };
  }

  // ── Editing the schedule fields ───────────────────────────────────────────

  /**
   * Edit the planning fields of an order that has not finished. `status`, the timestamps, `cost`
   * and `assetStatusBefore` are server facts and appear on no update schema — cost is set by the
   * completion that incurred it, not by a later edit.
   */
  async update(
    id: string,
    input: UpdateItMaintenanceOrder,
    ctx: AuthContext,
  ): Promise<ItMaintenanceOrderDoc> {
    const scope = maintenanceScope(ctx);
    const before = await itMaintenanceOrderRepository.getById(id, scope);
    if (before.status === 'completed' || before.status === 'cancelled') {
      throw new BusinessRuleError(
        `order ${before.orderCode} is ${before.status} and is a finished record`,
      );
    }
    await this.assertReferences(input);

    const set: Partial<ItMaintenanceOrderDoc> = {};
    if (input.scheduledFor !== undefined) set.scheduledFor = input.scheduledFor;
    if (input.summary !== undefined) set.summary = input.summary;
    if (input.vendorId !== undefined) {
      set.vendorId = input.vendorId === null ? null : new Types.ObjectId(input.vendorId);
    }

    const updated = await itMaintenanceOrderRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        change(
          'scheduledFor',
          before.scheduledFor?.toISOString() ?? null,
          updated.scheduledFor?.toISOString() ?? null,
        ),
        change('vendorId', before.vendorId === null ? null : String(before.vendorId),
          updated.vendorId === null ? null : String(updated.vendorId)),
        change('summary', before.summary, updated.summary),
      ],
    });
    return updated;
  }

  // ── The three transitions ─────────────────────────────────────────────────

  private assertTransition(order: ItMaintenanceOrderDoc, to: ItMaintenanceOrderDoc['status']): void {
    if (!canTransitionOrder(order.status, to)) {
      throw new BusinessRuleError(
        `order ${order.orderCode} is ${order.status} and cannot move to ${to}`,
      );
    }
  }

  /**
   * Start: the asset goes `underMaintenance` and its previous status is remembered (§4.7).
   *
   * Two orders cannot be in progress on one asset — the second would capture `underMaintenance` as
   * the status to restore, and completing it would leave the asset stuck there forever. The asset's
   * own status is the check, because `underMaintenance` has exactly one cause.
   */
  async start(
    id: string,
    input: StartItMaintenanceOrder,
    ctx: AuthContext,
  ): Promise<ItMaintenanceOrderDoc> {
    const scope = maintenanceScope(ctx);
    const at = new Date();
    const result = await unitOfWork(async (session) => {
      const order = await itMaintenanceOrderRepository.getByIdForUpdate(id, scope, session);
      this.assertTransition(order, 'inProgress');

      const asset = await itAssetRepository.getByIdForUpdate(String(order.assetId), scope, session);
      if (asset.status === 'disposed') {
        throw new BusinessRuleError(
          `asset ${asset.assetCode} is disposed and accepts no further operation (FR-4)`,
        );
      }
      if (asset.status === 'underMaintenance') {
        throw new ConflictError(
          `asset ${asset.assetCode} is already under maintenance; finish that order first`,
        );
      }

      const updated = await itMaintenanceOrderRepository.updateById(
        id,
        { status: 'inProgress', startedAt: at, assetStatusBefore: asset.status },
        { by: ctx.userId, version: order.__v, session, scope },
      );
      await itAssetRepository.updateById(
        String(order.assetId),
        { status: 'underMaintenance' },
        { by: ctx.userId, version: asset.__v, session, scope },
      );
      await itAssetEventRepository.append(
        {
          subjectId: asset._id,
          type: 'maintenanceStarted',
          at,
          actorUserId: new Types.ObjectId(ctx.userId),
          actorName: actorNameOf(ctx),
          metadata: { orderId: id, orderCode: order.orderCode, kind: order.kind },
          notes: input.note ?? null,
        },
        { by: ctx.userId, session },
      );
      await auditService.record({
        entityRef: entityRef(id),
        action: 'start',
        changes: [
          change('status', order.status, 'inProgress'),
          change('assetStatus', asset.status, 'underMaintenance'),
        ],
      });
      return updated;
    });
    return result;
  }

  /**
   * Complete (§4.7): parts consumption + cost + summary, the asset back to its prior status, and —
   * for a preventive order — the plan's clock advanced FROM THE COMPLETION DATE (§4.6).
   */
  async complete(
    id: string,
    input: CompleteItMaintenanceOrder,
    ctx: AuthContext,
  ): Promise<ItMaintenanceOrderDoc> {
    const scope = maintenanceScope(ctx);
    const at = new Date();
    const result = await unitOfWork(async (session) => {
      const order = await itMaintenanceOrderRepository.getByIdForUpdate(id, scope, session);
      this.assertTransition(order, 'completed');

      const asset = await itAssetRepository.getByIdForUpdate(String(order.assetId), scope, session);
      // `?? 'inStock'` covers an order started before this field existed; it is a floor, not the
      // normal path — `start` always writes it.
      const restored: ItAssetStatus = order.assetStatusBefore ?? 'inStock';

      const crossed = await itSparePartService.consumeForOrder(
        order._id,
        input.parts ?? [],
        ctx,
        at,
        session,
      );

      const updated = await itMaintenanceOrderRepository.updateById(
        id,
        {
          status: 'completed',
          completedAt: at,
          performedByUserId: new Types.ObjectId(ctx.userId),
          cost: input.cost ?? null,
          summary: input.summary,
        },
        { by: ctx.userId, version: order.__v, session, scope },
      );

      if (asset.status !== restored) {
        await itAssetRepository.updateById(
          String(order.assetId),
          { status: restored },
          { by: ctx.userId, version: asset.__v, session, scope },
        );
      }

      await itAssetEventRepository.append(
        {
          subjectId: asset._id,
          type: 'maintenanceCompleted',
          at,
          actorUserId: new Types.ObjectId(ctx.userId),
          actorName: actorNameOf(ctx),
          metadata: {
            orderId: id,
            orderCode: order.orderCode,
            kind: order.kind,
            partsCount: (input.parts ?? []).length,
            ...(input.cost === undefined ? {} : { cost: input.cost }),
          },
          notes: input.summary,
        },
        { by: ctx.userId, session },
      );

      // §4.6 — the plan's clock. From the COMPLETION date, never the due date: advancing from the
      // due date compounds drift, so a plan serviced late would stay late forever.
      // Unscoped on purpose: the caller already proved they may finish THIS order, and the plan's
      // clock is a consequence of that, not a second thing to authorize.
      if (order.planId !== null) {
        const plan = await itMaintenancePlanRepository.findById(String(order.planId));
        if (plan !== null) {
          await itMaintenancePlanRepository.updateById(
            String(plan._id),
            { lastCompletedAt: at, nextDueAt: addDays(at, plan.intervalDays) },
            { by: ctx.userId, version: plan.__v, session },
          );
        }
      }

      await auditService.record({
        entityRef: entityRef(id),
        action: 'complete',
        changes: [
          change('status', order.status, 'completed'),
          change('assetStatus', asset.status, restored),
          change('cost', order.cost, input.cost ?? null),
        ],
      });
      return { order: updated, asset, crossed };
    });

    await emit(ItEvents.MaintenanceOrderCompleted, {
      orderId: id,
      orderCode: result.order.orderCode,
      assetId: String(result.order.assetId),
      assetCode: result.asset.assetCode,
      cost: result.order.cost,
      partsCount: (input.parts ?? []).length,
    });
    await itSparePartService.announceBelowMin(result.crossed);
    return result.order;
  }

  /**
   * Cancel. From `inProgress` it also puts the asset back — an abandoned repair must not leave the
   * asset stuck `underMaintenance`, which is the state nothing else can clear.
   */
  async cancel(
    id: string,
    input: CancelItMaintenanceOrder,
    ctx: AuthContext,
  ): Promise<ItMaintenanceOrderDoc> {
    const scope = maintenanceScope(ctx);
    const at = new Date();
    return unitOfWork(async (session) => {
      const order = await itMaintenanceOrderRepository.getByIdForUpdate(id, scope, session);
      this.assertTransition(order, 'cancelled');

      const updated = await itMaintenanceOrderRepository.updateById(
        id,
        { status: 'cancelled', completedAt: at, summary: input.reason },
        { by: ctx.userId, version: order.__v, session, scope },
      );

      if (order.status === 'inProgress') {
        const asset = await itAssetRepository.getByIdForUpdate(
          String(order.assetId),
          scope,
          session,
        );
        const restored: ItAssetStatus = order.assetStatusBefore ?? 'inStock';
        if (asset.status !== restored) {
          await itAssetRepository.updateById(
            String(order.assetId),
            { status: restored },
            { by: ctx.userId, version: asset.__v, session, scope },
          );
        }
      }

      await auditService.record({
        entityRef: entityRef(id),
        action: 'cancel',
        changes: [change('status', order.status, 'cancelled'), change('reason', null, input.reason)],
      });
      return updated;
    });
  }

  /**
   * The sweep's write (§4.6), under the SYSTEM actor.
   *
   * Separate from `create` on purpose: no `AuthContext` exists, `kind` is `preventive`, and the
   * idempotency guard belongs here rather than on the human path — a technician may open a second
   * corrective order for the same asset, but a plan may not generate one while its last is unfinished.
   */
  async createFromPlan(planId: Types.ObjectId): Promise<ItMaintenanceOrderDoc | null> {
    const plan = await itMaintenancePlanRepository.findById(String(planId));
    if (plan === null || !plan.active) return null;
    if (await itMaintenanceOrderRepository.hasUnfinishedForPlan(planId)) return null;

    const asset = await itAssetRepository.findById(String(plan.assetId));
    // A plan whose asset is gone or written off generates nothing, and says so by returning null
    // rather than throwing — one bad plan must not stop the sweep for every other.
    if (asset === null || asset.status === 'disposed') return null;

    const orderCode = await nextMaintenanceOrderCode();
    const order = await itMaintenanceOrderRepository.create(
      {
        orderCode,
        kind: 'preventive',
        assetId: plan.assetId,
        planId: plan._id,
        ticketId: null,
        status: 'open',
        scheduledFor: plan.nextDueAt,
        startedAt: null,
        completedAt: null,
        performedByUserId: null,
        vendorId: null,
        cost: null,
        summary: plan.checklist,
        assetStatusBefore: null,
        branchId: asset.branchId,
      },
      // `null`, not a 'system' sentinel: the base repository casts `by` to an ObjectId.
      { by: null },
    );

    await auditService.record({
      entityRef: entityRef(String(order._id)),
      action: 'create',
      changes: [
        change('orderCode', null, orderCode),
        change('planId', null, String(plan._id)),
        change('kind', null, 'preventive'),
      ],
    });
    await emit(ItEvents.MaintenanceOrderCreated, {
      orderId: String(order._id),
      orderCode,
      kind: 'preventive',
      assetId: String(plan.assetId),
      assetCode: asset.assetCode,
      planId: String(plan._id),
      ticketId: null,
    });
    return order;
  }
}

export const itMaintenanceOrderService = new ItMaintenanceOrderService();
