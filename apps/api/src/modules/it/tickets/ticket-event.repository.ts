// Append-only, like the asset history: no update, no delete on this repository, and their absence
// is the cheapest enforcement of that.
//
// The one thing this file must get right is FR-7: **internal comments never leave the server for a
// caller without `itTicket.edit`**. That filter lives HERE, in the query, not in a mapper and
// certainly not in the UI — a mapper that dropped a field would still have shipped the body over
// the wire, and the requester's browser is not a place to enforce confidentiality.
import { Types, type ClientSession } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { ItTicketEventModel, type ItTicketEventDoc } from './ticket-event.model';

class ItTicketEventRepository extends BaseRepository<ItTicketEventDoc> {
  constructor() {
    super(ItTicketEventModel);
  }

  /**
   * @param options.by the acting user, or `null` for a SYSTEM write (the sweeps).
   *
   * `string | null` matches `WriteMeta` deliberately. Narrowing it to `string` is what made the
   * sweeps reach for a `'system'` sentinel, which `BaseRepository.create` then tried to cast to an
   * ObjectId and threw on — the type has to admit the case that actually exists.
   */
  async append(
    entry: Partial<ItTicketEventDoc>,
    options: { by: string | null; session?: ClientSession | undefined },
  ): Promise<ItTicketEventDoc> {
    return this.create(entry, options);
  }

  /**
   * One ticket's stream, newest first.
   *
   * @param includeInternal only ever true for a caller holding `itTicket.edit`. When false the
   * query itself excludes internal rows, so they are never read, never mapped and never sent.
   */
  async listForTicket(params: {
    ticketId: string;
    type?: string | undefined;
    includeInternal: boolean;
    page: number;
    pageSize: number;
  }): Promise<Paginated<ItTicketEventDoc>> {
    const filter: Record<string, unknown> = {
      subjectId: new Types.ObjectId(params.ticketId),
    };
    if (params.type !== undefined) filter.type = params.type;
    if (!params.includeInternal) {
      // Every non-comment row has `visibility: null`, so "not internal" is the right shape —
      // matching on `'public'` alone would hide the whole history from a requester.
      filter.visibility = { $ne: 'internal' };
    }
    return this.list({
      filter,
      page: params.page,
      pageSize: params.pageSize,
      // A stream is a chronology, not a sortable table.
      sortBy: 'at',
      sortDir: 'desc',
      sortableFields: ['at'],
    });
  }
}

export const itTicketEventRepository = new ItTicketEventRepository();
