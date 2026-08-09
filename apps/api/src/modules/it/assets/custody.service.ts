// Custody: assign · return · transfer · dispose (design §2.5, §4.3, ADR-021).
//
// Four NAMED actions, never a generic PATCH, because each is a distinct business act with its own
// guard, event, audit action and history entry. Each runs in ONE transaction (FR-3) that writes:
//
//     assignment row  +  asset denormalization  +  history event  +  platform event  +  audit
//
// A partial custody write must be impossible. That is why this is a `unitOfWork` and not five
// sequential awaits — and why the "one open assignment per asset" invariant is a partial unique
// index on the collection rather than the `findOpen` check below. The check produces the good
// error message; the index is what actually holds under two concurrent assigns.
//
// The platform event is emitted AFTER the transaction commits. Subscribers react to facts, and a
// fact that later rolled back is not one — the outbox exists for delivery, not for undo.
import { Types } from 'mongoose';
import {
  ItEvents,
  type AssignItAsset,
  type DisposeItAsset,
  type ItAssetEventType,
  type ListItAssetHistoryQuery,
  type Paginated,
  type ReturnItAsset,
  type TransferItAsset,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { logger } from '../../../infrastructure/logging/logger';
import { itAssetRepository } from './asset.repository';
import { itAssetAssignmentRepository } from './assignment.repository';
import { itAssetEventRepository } from './asset-event.repository';
import { itMaintenanceOrderRepository } from '../maintenance/order.repository';
import { type ItAssetEventDoc } from './asset-event.model';
import { type ItAssetAssignmentDoc } from './assignment.model';
import { type ItAssetDoc } from './asset.model';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'asset', entityId: id });

const actorNameOf = (ctx: AuthContext): string =>
  ctx.identity?.displayName?.[ctx.locale === 'ar' ? 'ar' : 'en'] ?? '';

/** Audit rows for custody carry the transition, not a field-by-field diff of the whole asset. */
const change = (field: string, from: unknown, to: unknown) => ({ field, old: from, new: to });

interface HistoryInput {
  assetId: string;
  type: ItAssetEventType;
  at: Date;
  metadata: Record<string, unknown>;
  notes: string | null;
}

class ItAssetCustodyService {
  /**
   * Load the asset for a custody transition and refuse the states that admit none.
   *
   * `disposed` is terminal (FR-4) and is rejected here for every action, including dispose itself —
   * disposing twice would overwrite the first disposal's reason and date, which is precisely the
   * record disposal exists to keep.
   */
  private async loadForTransition(
    assetId: string,
    scope: ScopeSelector,
    session: Parameters<Parameters<typeof unitOfWork>[0]>[0],
  ): Promise<ItAssetDoc> {
    const asset = await itAssetRepository.getByIdForUpdate(assetId, scope, session);
    if (asset.status === 'disposed') {
      throw new BusinessRuleError(
        `asset ${asset.assetCode} is disposed; a disposed asset accepts no further custody operation (FR-4)`,
      );
    }
    return asset;
  }

  /**
   * IT-4: an asset under an ACTIVE maintenance order does not move (design §2.7).
   *
   * `return`, `transfer` and `dispose` each write a custody fact that contradicts an order still in
   * hand — the technician holds the machine, so it cannot also be handed back, handed on, or
   * written off. `assign` is deliberately NOT guarded: an in-stock asset with an open order is a
   * machine waiting for a repair, and issuing it to its user is a decision this guard has no
   * business refusing. Starting the work is what actually takes it out of service, and the order
   * service guards that direction itself.
   *
   * The check runs INSIDE the caller's transaction. Outside it, a concurrent `start` could commit
   * between the check and the write, and the guard would pass on a fact that had already changed.
   */
  private async assertNoActiveMaintenance(
    asset: ItAssetDoc,
    action: string,
    session: Parameters<Parameters<typeof unitOfWork>[0]>[0],
  ): Promise<void> {
    const blocked = await itMaintenanceOrderRepository.hasActiveForAsset(
      String(asset._id),
      session,
    );
    if (blocked) {
      throw new ConflictError(
        `asset ${asset.assetCode} is under an open maintenance order; complete or cancel it before you ${action} the asset`,
      );
    }
  }

  private async writeHistory(
    input: HistoryInput,
    ctx: AuthContext,
    session: Parameters<Parameters<typeof unitOfWork>[0]>[0],
  ): Promise<void> {
    await itAssetEventRepository.append(
      {
        subjectId: new Types.ObjectId(input.assetId),
        type: input.type,
        at: input.at,
        actorUserId: new Types.ObjectId(ctx.userId),
        actorName: actorNameOf(ctx),
        metadata: input.metadata,
        notes: input.notes,
      },
      { by: ctx.userId, session },
    );
  }

  /** Assign: the asset must be in stock, i.e. free of an open interval (design §2.5). */
  async assign(
    assetId: string,
    input: AssignItAsset,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<{ asset: ItAssetDoc; assignment: ItAssetAssignmentDoc }> {
    const at = input.assignedAt ?? new Date();
    const result = await unitOfWork(async (session) => {
      const asset = await this.loadForTransition(assetId, scope, session);
      if (asset.status !== 'inStock') {
        const open = await itAssetAssignmentRepository.findOpenForAsset(assetId, session);
        throw new ConflictError(
          open === null
            ? `asset ${asset.assetCode} is ${asset.status} and cannot be assigned`
            : `asset ${asset.assetCode} is already assigned; return or transfer it first`,
        );
      }

      const assignment = await itAssetAssignmentRepository.create(
        {
          assetId: new Types.ObjectId(assetId),
          assignedToEmployeeId: new Types.ObjectId(input.employeeId),
          assignedByUserId: new Types.ObjectId(ctx.userId),
          assignedAt: at,
          conditionOnIssue: input.conditionOnIssue ?? null,
          expectedReturnAt: input.expectedReturnAt ?? null,
          returnedAt: null,
          returnedToUserId: null,
          conditionOnReturn: null,
          notes: input.notes ?? null,
          branchId: asset.branchId,
        },
        { by: ctx.userId, session },
      );

      const updated = await itAssetRepository.updateById(
        assetId,
        { status: 'assigned', currentAssignmentId: assignment._id },
        { by: ctx.userId, version: asset.__v, session, scope },
      );

      await this.writeHistory(
        {
          assetId,
          type: 'assigned',
          at,
          metadata: {
            assignmentId: String(assignment._id),
            employeeId: input.employeeId,
            ...(input.expectedReturnAt === undefined
              ? {}
              : { expectedReturnAt: input.expectedReturnAt.toISOString() }),
            ...(input.conditionOnIssue === undefined
              ? {}
              : { conditionOnIssue: input.conditionOnIssue }),
          },
          notes: input.notes ?? null,
        },
        ctx,
        session,
      );

      await auditService.record({
        entityRef: entityRef(assetId),
        action: 'assign',
        changes: [
          change('status', asset.status, 'assigned'),
          change('holder', null, input.employeeId),
        ],
      });

      return { asset: updated, assignment };
    });

    await emit(ItEvents.AssetAssigned, {
      assetId,
      assetCode: result.asset.assetCode,
      employeeId: input.employeeId,
      assignmentId: String(result.assignment._id),
    });
    return result;
  }

  /** Return: closes the open interval and puts the asset back in stock. */
  async returnAsset(
    assetId: string,
    input: ReturnItAsset,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<{ asset: ItAssetDoc; assignment: ItAssetAssignmentDoc }> {
    const at = input.returnedAt ?? new Date();
    const result = await unitOfWork(async (session) => {
      const asset = await this.loadForTransition(assetId, scope, session);
      await this.assertNoActiveMaintenance(asset, 'return', session);
      const open = await itAssetAssignmentRepository.findOpenForAsset(assetId, session);
      if (open === null) {
        throw new ConflictError(`asset ${asset.assetCode} is not currently assigned to anyone`);
      }
      if (at.getTime() < open.assignedAt.getTime()) {
        throw new BusinessRuleError('the return cannot precede the assignment it closes');
      }

      const closed = await itAssetAssignmentRepository.updateById(
        String(open._id),
        {
          returnedAt: at,
          returnedToUserId: new Types.ObjectId(ctx.userId),
          conditionOnReturn: input.conditionOnReturn ?? null,
        },
        { by: ctx.userId, version: open.__v, session },
      );

      const updated = await itAssetRepository.updateById(
        assetId,
        { status: 'inStock', currentAssignmentId: null },
        { by: ctx.userId, version: asset.__v, session, scope },
      );

      await this.writeHistory(
        {
          assetId,
          type: 'returned',
          at,
          metadata: {
            assignmentId: String(open._id),
            employeeId: String(open.assignedToEmployeeId),
            ...(input.conditionOnReturn === undefined
              ? {}
              : { conditionOnReturn: input.conditionOnReturn }),
          },
          notes: input.notes ?? null,
        },
        ctx,
        session,
      );

      await auditService.record({
        entityRef: entityRef(assetId),
        action: 'return',
        changes: [
          change('status', asset.status, 'inStock'),
          change('holder', String(open.assignedToEmployeeId), null),
        ],
      });

      return { asset: updated, assignment: closed, employeeId: String(open.assignedToEmployeeId) };
    });

    await emit(ItEvents.AssetReturned, {
      assetId,
      assetCode: result.asset.assetCode,
      employeeId: result.employeeId,
      condition: input.conditionOnReturn ?? null,
    });
    return { asset: result.asset, assignment: result.assignment };
  }

  /**
   * Transfer: ONE fact, not two (design §2.5).
   *
   * Person→person, branch→branch, or both. It closes the current interval and opens the next
   * inside a single transaction and writes a single `transferred` event — never return+assign,
   * because read back later the two would be indistinguishable from an unrelated same-day
   * return and reissue, and the history has to show intent.
   */
  async transfer(
    assetId: string,
    input: TransferItAsset,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<{ asset: ItAssetDoc; assignment: ItAssetAssignmentDoc }> {
    const at = input.at ?? new Date();
    const result = await unitOfWork(async (session) => {
      const asset = await this.loadForTransition(assetId, scope, session);
      await this.assertNoActiveMaintenance(asset, 'transfer', session);
      const open = await itAssetAssignmentRepository.findOpenForAsset(assetId, session);
      if (open === null) {
        throw new ConflictError(
          `asset ${asset.assetCode} is not currently assigned; assign it rather than transferring it`,
        );
      }
      if (at.getTime() < open.assignedAt.getTime()) {
        throw new BusinessRuleError('the transfer cannot precede the assignment it closes');
      }

      const toEmployeeId = input.toEmployeeId ?? String(open.assignedToEmployeeId);
      const toBranchId = input.toBranchId ?? String(asset.branchId);
      const sameHolder = toEmployeeId === String(open.assignedToEmployeeId);
      const sameBranch = toBranchId === String(asset.branchId);
      if (sameHolder && sameBranch) {
        throw new BusinessRuleError(
          'a transfer must change the holder, the branch, or both — this changes neither',
        );
      }

      // Close the current interval. `returnedAt` is what makes it closed, so the partial unique
      // index releases immediately and the new interval can be inserted in the same transaction.
      await itAssetAssignmentRepository.updateById(
        String(open._id),
        {
          returnedAt: at,
          returnedToUserId: new Types.ObjectId(ctx.userId),
          conditionOnReturn: input.conditionOnReturn ?? null,
        },
        { by: ctx.userId, version: open.__v, session },
      );

      const next = await itAssetAssignmentRepository.create(
        {
          assetId: new Types.ObjectId(assetId),
          assignedToEmployeeId: new Types.ObjectId(toEmployeeId),
          assignedByUserId: new Types.ObjectId(ctx.userId),
          assignedAt: at,
          conditionOnIssue: input.conditionOnIssue ?? null,
          expectedReturnAt: input.expectedReturnAt ?? null,
          returnedAt: null,
          returnedToUserId: null,
          conditionOnReturn: null,
          notes: input.notes ?? null,
          branchId: new Types.ObjectId(toBranchId),
        },
        { by: ctx.userId, session },
      );

      // `branchId` is the asset's data-scope anchor and the design says it changes ONLY here.
      const updated = await itAssetRepository.updateById(
        assetId,
        {
          status: 'assigned',
          currentAssignmentId: next._id,
          branchId: new Types.ObjectId(toBranchId),
        },
        { by: ctx.userId, version: asset.__v, session, scope },
      );

      await this.writeHistory(
        {
          assetId,
          type: 'transferred',
          at,
          metadata: {
            fromEmployeeId: String(open.assignedToEmployeeId),
            toEmployeeId,
            fromBranchId: String(asset.branchId),
            toBranchId,
            assignmentId: String(next._id),
          },
          notes: input.notes ?? null,
        },
        ctx,
        session,
      );

      await auditService.record({
        entityRef: entityRef(assetId),
        action: 'transfer',
        changes: [
          change('holder', String(open.assignedToEmployeeId), toEmployeeId),
          change('branchId', String(asset.branchId), toBranchId),
        ],
      });

      return {
        asset: updated,
        assignment: next,
        fromEmployeeId: String(open.assignedToEmployeeId),
        toEmployeeId,
        fromBranchId: String(asset.branchId),
        toBranchId,
      };
    });

    await emit(ItEvents.AssetTransferred, {
      assetId,
      assetCode: result.asset.assetCode,
      fromEmployeeId: result.fromEmployeeId,
      toEmployeeId: result.toEmployeeId,
      fromBranchId: result.fromBranchId,
      toBranchId: result.toBranchId,
    });
    return { asset: result.asset, assignment: result.assignment };
  }

  /**
   * Dispose: terminal, set once (FR-4).
   *
   * Requires no open assignment — writing off an asset someone still holds would record a
   * disposal that did not happen and lose the custody thread at the moment it matters most.
   */
  async dispose(
    assetId: string,
    input: DisposeItAsset,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItAssetDoc> {
    const at = input.at ?? new Date();
    const asset = await unitOfWork(async (session) => {
      const current = await this.loadForTransition(assetId, scope, session);
      await this.assertNoActiveMaintenance(current, 'dispose', session);
      const open = await itAssetAssignmentRepository.findOpenForAsset(assetId, session);
      if (open !== null) {
        throw new ConflictError(
          `asset ${current.assetCode} is still assigned; record its return before disposing of it (FR-4)`,
        );
      }

      const updated = await itAssetRepository.updateById(
        assetId,
        {
          status: 'disposed',
          currentAssignmentId: null,
          disposal: {
            at,
            method: input.method,
            reason: input.reason,
            notes: input.notes ?? null,
          },
        },
        { by: ctx.userId, version: current.__v, session, scope },
      );

      await this.writeHistory(
        {
          assetId,
          type: 'disposed',
          at,
          metadata: { method: input.method, reason: input.reason },
          notes: input.notes ?? null,
        },
        ctx,
        session,
      );

      await auditService.record({
        entityRef: entityRef(assetId),
        action: 'dispose',
        changes: [
          change('status', current.status, 'disposed'),
          change('disposal.method', null, input.method),
        ],
      });

      return updated;
    });

    await emit(ItEvents.AssetDisposed, {
      assetId,
      assetCode: asset.assetCode,
      method: input.method,
      reason: input.reason,
    });
    return asset;
  }

  /**
   * `hr.employee.exited` (design §9.1, FR-13).
   *
   * The leaver's open assignments are RECORDED, never auto-returned. A physical return is a thing
   * a human witnesses; writing one because HR closed a record would put a custody fact in the
   * chain that never happened — and this chain is what settles disputes. The exit checklist is the
   * process; this is its safety net.
   *
   * The notification half of §9.1 needs the module's templates, which are IT-6. Until then the
   * fact is recorded in the audit trail (`alertRaised`, an existing action) and logged, so nothing
   * is silently dropped in the meantime.
   */
  async flagAssetsHeldByExitedEmployee(employeeId: string): Promise<number> {
    const open = await itAssetAssignmentRepository.listOpenForEmployee(employeeId);
    if (open.length === 0) return 0;
    logger.warn(
      { employeeId, assignments: open.length },
      'employee exited while still holding IT assets — physical return must be recorded by a human (FR-13)',
    );
    for (const assignment of open) {
      await auditService.record({
        entityRef: entityRef(String(assignment.assetId)),
        action: 'alertRaised',
        changes: [change('heldByExitedEmployee', null, employeeId)],
      });
    }
    return open.length;
  }

  async history(
    assetId: string,
    query: ListItAssetHistoryQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ItAssetEventDoc>> {
    // Read the asset first so history obeys exactly the same authorization as the asset itself —
    // a branch-scoped caller must not read another branch's custody chain.
    const asset = await itAssetRepository.findById(assetId, scope);
    if (asset === null) throw new NotFoundError('asset not found');
    return itAssetEventRepository.listForAsset({
      assetId,
      type: query.type,
      page: query.page,
      pageSize: query.pageSize,
    });
  }
}

export const itAssetCustodyService = new ItAssetCustodyService();
