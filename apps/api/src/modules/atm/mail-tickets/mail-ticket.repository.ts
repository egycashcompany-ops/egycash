import { Types, type FilterQuery, type UpdateQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { cairoDayRange } from '../shared/cairo-time';
import { AtmMailTicketModel, type AtmMailTicketDoc } from './mail-ticket.model';

class AtmMailTicketRepository extends BaseRepository<AtmMailTicketDoc> {
  constructor() {
    super(AtmMailTicketModel, { branchField: 'branchId' });
  }

  /** The pending screen's working set — every mail with status 0 (contad_app.js:2648). */
  async listPending(params: {
    page: number;
    pageSize: number;
    scope: ScopeSelector;
  }): Promise<Paginated<AtmMailTicketDoc>> {
    return this.list({
      filter: { status: 'pending' } as FilterQuery<AtmMailTicketDoc>,
      page: params.page,
      pageSize: params.pageSize,
      sortBy: 'receivedAt',
      sortDir: 'desc',
      sortableFields: ['receivedAt'],
      scope: params.scope,
    });
  }

  /** The log page (contad_app.js:2934-2935): all mails in a received-day range, newest first. */
  async listLog(params: {
    from: string;
    to: string;
    page: number;
    pageSize: number;
    scope: ScopeSelector;
  }): Promise<Paginated<AtmMailTicketDoc>> {
    const { start } = cairoDayRange(params.from);
    const { end } = cairoDayRange(params.to);
    return this.list({
      filter: { receivedAt: { $gte: start, $lt: end } } as FilterQuery<AtmMailTicketDoc>,
      page: params.page,
      pageSize: params.pageSize,
      sortBy: 'receivedAt',
      sortDir: 'desc',
      sortableFields: ['receivedAt'],
      scope: params.scope,
    });
  }

  /** The badge every legacy ATM page renders (contad_app.js:266-268): pending mails, scoped. */
  async unreadCount(scope: ScopeSelector): Promise<number> {
    return this.count({ status: 'pending' } as FilterQuery<AtmMailTicketDoc>, scope);
  }

  async findByProviderMessageId(providerMessageId: string): Promise<AtmMailTicketDoc | null> {
    return this.findOne({ providerMessageId } as FilterQuery<AtmMailTicketDoc>);
  }

  /**
   * Decide every still-PENDING ticket of `ids` the scope reaches, in ONE write, and return the
   * tickets THIS write decided — in the order `ids` names them, each once.
   *
   * `status: 'pending'` rides inside the write's own filter, so a ticket decided a moment earlier
   * (another person, a double click) is not matched and not returned: skipped like any decided
   * ticket, never overwritten. Which tickets this write decided is read back by its own stamp: a
   * fresh `decisionId` per call, written with the decision. The decider and the instant would not
   * do — two submits by one person can share a millisecond, and each would read back (and audit)
   * the other's tickets — and the stamp is read back without the status, so a ticket restored to
   * pending between the write and the read is still answered and audited as rejected first.
   *
   * Ids are taken in their canonical form (lowercase hex) before anything else: the contract's
   * `objectId()` accepts `[0-9a-fA-F]`, and `'ABC…'` is the very same ticket as `'abc…'` — the write
   * matches it either way, so the read-back (keyed by `String(row._id)`, lowercase) must find it
   * the same way, or a ticket would be rejected with no answer row, no audit row and no signal. The
   * two spellings of one id are also one ticket in the dedupe.
   */
  async decidePending(
    ids: readonly string[],
    decision: {
      status: 'accepted' | 'rejected';
      actionById: Types.ObjectId;
      actionByName: string | null;
      actionAt: Date;
    },
    meta: { by: string; scope: ScopeSelector },
  ): Promise<AtmMailTicketDoc[]> {
    const order = [
      ...new Set(
        ids
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id).toHexString()),
      ),
    ];
    if (order.length === 0) return [];
    const selected = { $in: order.map((id) => new Types.ObjectId(id)) };
    const decisionId = new Types.ObjectId();
    await this.model
      .updateMany(
        this.baseFilter(meta.scope, {
          _id: selected,
          status: 'pending',
        } as FilterQuery<AtmMailTicketDoc>),
        {
          $set: { ...decision, decisionId, updatedBy: new Types.ObjectId(meta.by) },
          $inc: { __v: 1 },
        } as UpdateQuery<AtmMailTicketDoc>,
      )
      .exec();
    const decided = await this.model
      .find(
        this.baseFilter(meta.scope, {
          _id: selected,
          decisionId,
        } as FilterQuery<AtmMailTicketDoc>),
      )
      .lean<AtmMailTicketDoc[]>()
      .exec();
    const byId = new Map(decided.map((row) => [String(row._id), row]));
    return order.flatMap((id) => {
      const row = byId.get(id);
      return row === undefined ? [] : [row];
    });
  }
}

export const atmMailTicketRepository = new AtmMailTicketRepository();
