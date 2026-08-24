import { type FilterQuery } from 'mongoose';
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
}

export const atmMailTicketRepository = new AtmMailTicketRepository();
