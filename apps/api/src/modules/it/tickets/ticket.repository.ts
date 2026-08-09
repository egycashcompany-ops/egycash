import { Types, type ClientSession } from 'mongoose';
import { type ListItTicketsQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { ItTicketModel, type ItTicketDoc } from './ticket.model';

/** Live work — the statuses a technician's queue means (§6). */
const ACTIVE_STATUSES = ['open', 'inProgress', 'onHold'] as const;

class ItTicketRepository extends BaseRepository<ItTicketDoc> {
  constructor() {
    // Branch-scoped like assets (design §7); `own` resolves through the requester, which is what
    // makes FR-8 — "a requester always sees their own tickets" — a scope rather than custom code.
    super(ItTicketModel, { branchField: 'branchId', ownerUserField: 'requesterUserId' });
  }

  /** Transactional read — the version handed to `updateById` must come from inside the tx. */
  async getByIdForUpdate(
    id: string,
    scope: ScopeSelector | undefined,
    session: ClientSession,
  ): Promise<ItTicketDoc> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError();
    const doc = await this.model
      .findOne(this.baseFilter(scope, { _id: new Types.ObjectId(id) }))
      .session(session)
      .lean<ItTicketDoc>()
      .exec();
    if (doc === null) throw new NotFoundError();
    return doc;
  }

  async listFiltered(
    query: ListItTicketsQuery,
    scope: ScopeSelector,
    requesterUserId: string,
  ): Promise<Paginated<ItTicketDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.categoryId !== undefined) filter.categoryId = new Types.ObjectId(query.categoryId);
    if (query.priorityId !== undefined) filter.priorityId = new Types.ObjectId(query.priorityId);
    if (query.assetId !== undefined) filter.assetId = new Types.ObjectId(query.assetId);
    if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
    if (query.assignedTechnicianUserId !== undefined) {
      filter.assignedTechnicianUserId = new Types.ObjectId(query.assignedTechnicianUserId);
    }
    // "My tickets" — narrows to the caller on top of whatever scope they already have.
    if (query.mine === true) filter.requesterUserId = new Types.ObjectId(requesterUserId);
    if (query.active === true) filter.status = { $in: ACTIVE_STATUSES };
    if (query.active === false) filter.status = { $in: ['resolved', 'closed', 'cancelled'] };
    // Breached reads the STAMPS, never a recomputed clock (FR-6).
    if (query.breached === true) {
      filter.$or = [
        { 'sla.responseBreachedAt': { $ne: null } },
        { 'sla.resolutionBreachedAt': { $ne: null } },
      ];
    }
    if (query.search !== undefined && query.search !== '') {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const text = [{ ticketCode: pattern }, { title: pattern }, { description: pattern }];
      // Keep an existing `$or` (breached) intact — combining them with `$and` rather than
      // letting the second silently overwrite the first.
      if (filter.$or === undefined) {
        filter.$or = text;
      } else {
        // Two independent OR groups must AND together; assigning `$or` twice would silently
        // discard the breached filter and quietly widen the result set.
        filter.$and = [{ $or: filter.$or }, { $or: text }];
        delete filter.$or;
      }
    }
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'ticketCode', 'status', 'sla.resolutionDueAt'],
      scope,
    });
  }

  /**
   * The SLA sweep's query (§4.5): live tickets past a due date with no stamp yet.
   *
   * Unscoped by design — a sweep is the system acting for the organization, not a user reading.
   * Backed by the partial indexes that only hold unstamped rows, so this shrinks as it works.
   */
  async findUnstampedOverdue(
    phase: 'response' | 'resolution',
    now: Date,
    limit: number,
  ): Promise<ItTicketDoc[]> {
    const dueField = phase === 'response' ? 'sla.responseDueAt' : 'sla.resolutionDueAt';
    const stampField = phase === 'response' ? 'sla.responseBreachedAt' : 'sla.resolutionBreachedAt';
    // A response clock stops at first response; a resolution clock stops at resolution. Neither
    // keeps running once the ticket has left the states where the promise still applies.
    const stillRunning =
      phase === 'response'
        ? { 'sla.firstResponseAt': null, status: { $in: ACTIVE_STATUSES } }
        : { status: { $in: ACTIVE_STATUSES } };
    return this.model
      .find({
        [dueField]: { $lte: now },
        [stampField]: null,
        isDeleted: false,
        ...stillRunning,
      })
      .limit(limit)
      .lean<ItTicketDoc[]>()
      .exec();
  }

  /** The auto-close sweep's query (§4.4): resolved long enough ago to close. */
  async findResolvedBefore(cutoff: Date, limit: number): Promise<ItTicketDoc[]> {
    return this.model
      .find({ status: 'resolved', 'resolution.resolvedAt': { $lte: cutoff }, isDeleted: false })
      .limit(limit)
      .lean<ItTicketDoc[]>()
      .exec();
  }
}

export const itTicketRepository = new ItTicketRepository();
