// The help desk (design §2.6, §4.4, §4.5).
//
// Every transition follows the IT-2 custody shape, because it is the same problem: one `unitOfWork`
// writing the ticket row + a stream entry + audit, and the platform event emitted AFTER the commit
// — a fact that rolled back is not one.
//
// Three rules carry this file:
//
//   1. **One `statusChanged` event and one `statusChanged` stream row per transition.** Resolve,
//      close, reopen and cancel are `to` VALUES, not four more event names (§8.1). They have their
//      own endpoints because each carries a different required fact, and they converge here.
//   2. **The SLA policy is snapshotted at creation** and never re-read. Editing a priority later
//      must not move a running clock or rewrite a closed ticket.
//   3. **Breach stamps are set once** (FR-6) and the ticket's own stamp is the idempotency mark —
//      the sweep needs no second collection to remember what it has done.
import { Types } from 'mongoose';
import {
  ItEvents,
  type AssignItTicket,
  type CancelItTicket,
  type ChangeItTicketStatus,
  type CloseItTicket,
  type CreateItTicket,
  type CreateItTicketComment,
  type ItTicketEventType,
  type ItTicketStatus,
  type ListItTicketEventsQuery,
  type ListItTicketsQuery,
  type Paginated,
  type ReopenItTicket,
  type ResolveItTicket,
  type UpdateItTicket,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { hasPermission, type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { itCatalogItemRepository } from '../catalog-items';
import { itAssetRepository } from '../assets';
import { itTicketRepository } from './ticket.repository';
import { itTicketPriorityRepository } from './priority.repository';
import { itTicketEventRepository } from './ticket-event.repository';
import { nextTicketCode } from './ticket-number';
import { canTransition, isActiveTicketStatus } from './ticket-lifecycle';
import { type ItTicketDoc, type ItTicketSlaSub } from './ticket.model';
import { type ItTicketEventDoc } from './ticket-event.model';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'ticket', entityId: id });

const actorNameOf = (ctx: AuthContext): string =>
  ctx.identity?.displayName?.[ctx.locale === 'ar' ? 'ar' : 'en'] ?? '';

const change = (field: string, from: unknown, to: unknown) => ({ field, old: from, new: to });

const snapshot = (doc: ItTicketDoc) => ({
  title: doc.title,
  description: doc.description,
  categoryId: String(doc.categoryId),
  priorityId: String(doc.priorityId),
  assetId: doc.assetId === null ? null : String(doc.assetId),
});

/** Whether the caller may see internal comments (§7, FR-7). The ONLY gate on that content. */
export const maySeeInternal = (ctx: AuthContext): boolean => hasPermission(ctx, 'itTicket.edit');

class ItTicketService {
  private async assertReferences(input: {
    categoryId?: string | undefined;
    priorityId?: string | undefined;
    assetId?: string | null | undefined;
    scope: ScopeSelector;
  }): Promise<void> {
    if (input.categoryId !== undefined) {
      const category = await itCatalogItemRepository.findActiveOfKind(
        input.categoryId,
        'ticketCategory',
      );
      if (category === null) {
        throw new BusinessRuleError('categoryId must reference an active ticket category');
      }
    }
    if (input.priorityId !== undefined) {
      const priority = await itTicketPriorityRepository.findActive(input.priorityId);
      if (priority === null) {
        throw new BusinessRuleError('priorityId must reference an active priority');
      }
    }
    if (input.assetId !== undefined && input.assetId !== null) {
      // Scoped: a ticket cannot point at an asset its opener could not see.
      const asset = await itAssetRepository.findById(input.assetId, input.scope);
      if (asset === null) throw new BusinessRuleError('assetId must reference a visible asset');
    }
  }

  /**
   * Write one stream entry. Always inside the caller's transaction: the entry and the state change
   * it describes land together or not at all.
   */
  private async writeEvent(
    input: {
      ticketId: string;
      type: ItTicketEventType;
      at: Date;
      fromStatus?: ItTicketStatus | null;
      toStatus?: ItTicketStatus | null;
      body?: string | null;
      visibility?: 'public' | 'internal' | null;
      metadata?: Record<string, unknown>;
      notes?: string | null;
    },
    ctx: AuthContext | null,
    session: Parameters<Parameters<typeof unitOfWork>[0]>[0],
  ): Promise<ItTicketEventDoc> {
    return itTicketEventRepository.append(
      {
        subjectId: new Types.ObjectId(input.ticketId),
        type: input.type,
        at: input.at,
        actorUserId: ctx === null ? null : new Types.ObjectId(ctx.userId),
        actorName: ctx === null ? '' : actorNameOf(ctx),
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        body: input.body ?? null,
        visibility: input.visibility ?? null,
        metadata: input.metadata ?? {},
        notes: input.notes ?? null,
      } as Partial<ItTicketEventDoc>,
      // Same rule as the sweeps: a system write is `by: null`, never a sentinel string — the base
      // repository casts `by` to an ObjectId and would throw on anything else.
      { by: ctx === null ? null : ctx.userId, session },
    );
  }

  // ── Creation ──────────────────────────────────────────────────────────────

  async create(input: CreateItTicket, ctx: AuthContext, scope: ScopeSelector): Promise<ItTicketDoc> {
    await this.assertReferences({ ...input, scope });
    const priority = await itTicketPriorityRepository.findActive(input.priorityId);
    if (priority === null) throw new BusinessRuleError('priorityId must reference an active priority');

    const at = new Date();
    // THE SNAPSHOT (§2.6). Copied, never referenced — a later edit to this priority must not move
    // this ticket's clock or rewrite its history.
    const sla: ItTicketSlaSub = {
      policy: {
        responseMinutes: priority.responseMinutes,
        resolutionMinutes: priority.resolutionMinutes,
      },
      responseDueAt: new Date(at.getTime() + priority.responseMinutes * 60_000),
      resolutionDueAt: new Date(at.getTime() + priority.resolutionMinutes * 60_000),
      firstResponseAt: null,
      responseBreachedAt: null,
      resolutionBreachedAt: null,
      pausedMs: 0,
      holdStartedAt: null,
    };
    const ticketCode = await nextTicketCode();

    const ticket = await unitOfWork(async (session) => {
      const created = await itTicketRepository.create(
        {
          ticketCode,
          title: input.title,
          description: input.description,
          // The requester is the CALLER, never a field — a client that could name one could open
          // a ticket as somebody else.
          requesterUserId: new Types.ObjectId(ctx.userId),
          branchId: ctx.branchId === null ? null : new Types.ObjectId(ctx.branchId),
          categoryId: new Types.ObjectId(input.categoryId),
          priorityId: new Types.ObjectId(input.priorityId),
          assetId: input.assetId === undefined ? null : new Types.ObjectId(input.assetId),
          assignedTechnicianUserId: null,
          status: 'open',
          sla,
          resolution: null,
          closedAt: null,
          reopenCount: 0,
        },
        { by: ctx.userId, session },
      );
      await this.writeEvent(
        { ticketId: String(created._id), type: 'opened', at, toStatus: 'open' },
        ctx,
        session,
      );
      await auditService.record({
        entityRef: entityRef(String(created._id)),
        action: 'create',
        changes: diffChanges({}, snapshot(created)),
      });
      return created;
    });

    await emit(ItEvents.TicketOpened, {
      ticketId: String(ticket._id),
      ticketCode: ticket.ticketCode,
      categoryId: String(ticket.categoryId),
      priorityId: String(ticket.priorityId),
      requesterUserId: String(ticket.requesterUserId),
      assetId: ticket.assetId === null ? null : String(ticket.assetId),
    });
    return ticket;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(
    query: ListItTicketsQuery,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<Paginated<ItTicketDoc>> {
    return itTicketRepository.listFiltered(query, scope, ctx.userId);
  }

  async getById(id: string, scope: ScopeSelector): Promise<ItTicketDoc> {
    return itTicketRepository.getById(id, scope);
  }

  /** The stream. Internal rows are excluded IN THE QUERY for anyone without `itTicket.edit`. */
  async events(
    ticketId: string,
    query: ListItTicketEventsQuery,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<Paginated<ItTicketEventDoc>> {
    const ticket = await itTicketRepository.findById(ticketId, scope);
    if (ticket === null) throw new NotFoundError('ticket not found');
    return itTicketEventRepository.listForTicket({
      ticketId,
      type: query.type,
      includeInternal: maySeeInternal(ctx),
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  // ── Editing the ticket's own fields ───────────────────────────────────────

  async update(
    id: string,
    input: UpdateItTicket,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItTicketDoc> {
    const before = await itTicketRepository.getById(id, scope);
    if (before.status === 'closed' || before.status === 'cancelled') {
      throw new BusinessRuleError(`ticket ${before.ticketCode} is ${before.status} and cannot be edited`);
    }
    await this.assertReferences({ ...input, scope });

    const at = new Date();
    const set: Partial<ItTicketDoc> = {};
    if (input.title !== undefined) set.title = input.title;
    if (input.description !== undefined) set.description = input.description;
    if (input.categoryId !== undefined) set.categoryId = new Types.ObjectId(input.categoryId);
    if (input.assetId !== undefined) {
      set.assetId = input.assetId === null ? null : new Types.ObjectId(input.assetId);
    }
    const priorityChanged =
      input.priorityId !== undefined && input.priorityId !== String(before.priorityId);
    if (input.priorityId !== undefined) set.priorityId = new Types.ObjectId(input.priorityId);

    const updated = await unitOfWork(async (session) => {
      const doc = await itTicketRepository.updateById(id, set, {
        by: ctx.userId,
        version: input.version,
        session,
        scope,
      });
      // A priority change is a fact worth its own row — but it does NOT re-snapshot the SLA. The
      // promise made when the ticket opened is the promise being measured (§2.6).
      if (priorityChanged) {
        await this.writeEvent(
          {
            ticketId: id,
            type: 'priorityChanged',
            at,
            metadata: { from: String(before.priorityId), to: String(doc.priorityId) },
          },
          ctx,
          session,
        );
      }
      await auditService.record({
        entityRef: entityRef(id),
        action: 'update',
        changes: diffChanges(snapshot(before), snapshot(doc)),
      });
      return doc;
    });
    return updated;
  }

  // ── Transitions ───────────────────────────────────────────────────────────

  /**
   * The single path every status move goes through.
   *
   * Guards the transition table, writes ONE `statusChanged` row, records audit, and emits ONE
   * `it.ticket.statusChanged` after commit. Callers add the facts their move requires.
   */
  private async transition(
    id: string,
    to: ItTicketStatus,
    ctx: AuthContext,
    scope: ScopeSelector,
    options: {
      auditAction?: 'statusChange' | 'resolve' | 'reopen';
      summary?: string | null;
      note?: string | null;
      extraSet?: (current: ItTicketDoc, at: Date) => Partial<ItTicketDoc>;
      guard?: (current: ItTicketDoc) => void;
    } = {},
  ): Promise<ItTicketDoc> {
    const at = new Date();
    const result = await unitOfWork(async (session) => {
      const current = await itTicketRepository.getByIdForUpdate(id, scope, session);
      if (!canTransition(current.status, to)) {
        throw new ConflictError(
          `ticket ${current.ticketCode} cannot move from ${current.status} to ${to}`,
        );
      }
      options.guard?.(current);

      const set: Partial<ItTicketDoc> = { status: to, ...options.extraSet?.(current, at) };

      // Leaving `onHold` banks the paused time onto the resolution clock; the response clock
      // never pauses (§2.6).
      if (current.status === 'onHold' && current.sla.holdStartedAt !== null) {
        const paused = at.getTime() - current.sla.holdStartedAt.getTime();
        set.sla = {
          ...current.sla,
          ...(set.sla ?? {}),
          pausedMs: current.sla.pausedMs + Math.max(0, paused),
          holdStartedAt: null,
          resolutionDueAt: new Date(current.sla.resolutionDueAt.getTime() + Math.max(0, paused)),
        };
      }
      if (to === 'onHold') {
        set.sla = { ...current.sla, ...(set.sla ?? {}), holdStartedAt: at };
      }
      // First response: the move to `inProgress`, or the first public technician comment —
      // whichever comes first, stamped once (§4.4).
      if (to === 'inProgress' && current.sla.firstResponseAt === null) {
        set.sla = { ...current.sla, ...(set.sla ?? {}), firstResponseAt: at };
      }

      const updated = await itTicketRepository.updateById(id, set, {
        by: ctx.userId,
        version: current.__v,
        session,
        scope,
      });
      await this.writeEvent(
        {
          ticketId: id,
          type: 'statusChanged',
          at,
          fromStatus: current.status,
          toStatus: to,
          notes: options.note ?? options.summary ?? null,
        },
        ctx,
        session,
      );
      await auditService.record({
        entityRef: entityRef(id),
        action: options.auditAction ?? 'statusChange',
        changes: [change('status', current.status, to)],
      });
      return { updated, from: current.status };
    });

    await emit(ItEvents.TicketStatusChanged, {
      ticketId: id,
      ticketCode: result.updated.ticketCode,
      from: result.from,
      to,
      summary: options.summary ?? null,
    });
    return result.updated;
  }

  async start(id: string, input: ChangeItTicketStatus, ctx: AuthContext, scope: ScopeSelector) {
    return this.transition(id, input.to, ctx, scope, { note: input.reason ?? null });
  }

  async resolve(id: string, input: ResolveItTicket, ctx: AuthContext, scope: ScopeSelector) {
    return this.transition(id, 'resolved', ctx, scope, {
      auditAction: 'resolve',
      summary: input.summary,
      extraSet: (_current, at) => ({
        resolution: {
          summary: input.summary,
          resolvedByUserId: new Types.ObjectId(ctx.userId),
          resolvedAt: at,
        },
      }),
    });
  }

  async close(id: string, input: CloseItTicket, ctx: AuthContext, scope: ScopeSelector) {
    return this.transition(id, 'closed', ctx, scope, {
      note: input.note ?? null,
      extraSet: (_current, at) => ({ closedAt: at }),
    });
  }

  async reopen(id: string, input: ReopenItTicket, ctx: AuthContext, scope: ScopeSelector) {
    return this.transition(id, 'inProgress', ctx, scope, {
      auditAction: 'reopen',
      note: input.reason,
      extraSet: (current) => ({ reopenCount: current.reopenCount + 1, closedAt: null }),
    });
  }

  /**
   * Cancel. FR-14: a requester may cancel their OWN ticket while it is still `open`, with no
   * permission minted for it — the ownership rule rides the `own` scope, exactly as the design
   * says. Anyone else needs `itTicket.close`.
   */
  async cancel(id: string, input: CancelItTicket, ctx: AuthContext, scope: ScopeSelector) {
    return this.transition(id, 'cancelled', ctx, scope, {
      note: input.reason,
      guard: (current) => {
        const isOwner = String(current.requesterUserId) === ctx.userId;
        if (hasPermission(ctx, 'itTicket.close')) return;
        if (isOwner && current.status === 'open') return;
        throw new ForbiddenError(
          isOwner
            ? 'a requester may cancel their own ticket only while it is still open (FR-14)'
            : 'cancelling another user’s ticket needs itTicket.close',
        );
      },
    });
  }

  // ── Assignment ────────────────────────────────────────────────────────────

  /** Assignment is independent of state; assigning an `open` ticket also starts it (§4.4). */
  async assign(
    id: string,
    input: AssignItTicket,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItTicketDoc> {
    const at = new Date();
    const result = await unitOfWork(async (session) => {
      const current = await itTicketRepository.getByIdForUpdate(id, scope, session);
      if (!isActiveTicketStatus(current.status)) {
        throw new ConflictError(
          `ticket ${current.ticketCode} is ${current.status} and cannot be assigned`,
        );
      }
      const startsWork = current.status === 'open';
      const set: Partial<ItTicketDoc> = {
        assignedTechnicianUserId: new Types.ObjectId(input.technicianUserId),
      };
      if (startsWork) {
        set.status = 'inProgress';
        if (current.sla.firstResponseAt === null) {
          set.sla = { ...current.sla, firstResponseAt: at };
        }
      }
      const updated = await itTicketRepository.updateById(id, set, {
        by: ctx.userId,
        version: current.__v,
        session,
        scope,
      });
      await this.writeEvent(
        {
          ticketId: id,
          type: 'assigned',
          at,
          metadata: { technicianUserId: input.technicianUserId },
          notes: input.note ?? null,
        },
        ctx,
        session,
      );
      // The move to inProgress is its own fact, so the stream reads as two things that happened.
      if (startsWork) {
        await this.writeEvent(
          { ticketId: id, type: 'statusChanged', at, fromStatus: 'open', toStatus: 'inProgress' },
          ctx,
          session,
        );
      }
      await auditService.record({
        entityRef: entityRef(id),
        action: 'assign',
        changes: [
          change(
            'assignedTechnicianUserId',
            current.assignedTechnicianUserId === null
              ? null
              : String(current.assignedTechnicianUserId),
            input.technicianUserId,
          ),
        ],
      });
      return { updated, startsWork };
    });

    await emit(ItEvents.TicketAssigned, {
      ticketId: id,
      ticketCode: result.updated.ticketCode,
      technicianUserId: input.technicianUserId,
    });
    if (result.startsWork) {
      await emit(ItEvents.TicketStatusChanged, {
        ticketId: id,
        ticketCode: result.updated.ticketCode,
        from: 'open',
        to: 'inProgress',
        summary: null,
      });
    }
    return result.updated;
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  /**
   * A comment is a row in the same stream (§2.6) — not a sibling collection.
   *
   * `internal` requires `itTicket.edit`. FR-14's other half lives here too: a requester may
   * comment PUBLICLY on their own ticket without any grant, because answering a question about
   * your own request is not a privilege.
   */
  async comment(
    id: string,
    input: CreateItTicketComment,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItTicketEventDoc> {
    const at = new Date();
    return unitOfWork(async (session) => {
      const current = await itTicketRepository.getByIdForUpdate(id, scope, session);
      const isOwner = String(current.requesterUserId) === ctx.userId;
      const canWork = hasPermission(ctx, 'itTicket.edit');
      if (input.visibility === 'internal' && !canWork) {
        throw new ForbiddenError('internal comments need itTicket.edit');
      }
      if (!canWork && !isOwner) {
        throw new ForbiddenError('commenting on another user’s ticket needs itTicket.edit');
      }
      if (current.status === 'cancelled') {
        throw new BusinessRuleError(`ticket ${current.ticketCode} is cancelled`);
      }

      // First PUBLIC technician comment counts as the first response (§4.4).
      const stampsFirstResponse =
        canWork && !isOwner && input.visibility === 'public' && current.sla.firstResponseAt === null;
      if (stampsFirstResponse) {
        await itTicketRepository.updateById(
          id,
          { sla: { ...current.sla, firstResponseAt: at } },
          { by: ctx.userId, version: current.__v, session, scope },
        );
      }

      return this.writeEvent(
        {
          ticketId: id,
          type: 'commented',
          at,
          body: input.body,
          visibility: input.visibility,
        },
        ctx,
        session,
      );
    });
  }
}

export const itTicketService = new ItTicketService();
