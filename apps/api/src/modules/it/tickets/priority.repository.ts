import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { ItTicketPriorityModel, type ItTicketPriorityDoc } from './priority.model';

class ItTicketPriorityRepository extends BaseRepository<ItTicketPriorityDoc> {
  constructor() {
    // Organization-wide reference data — priorities are not branch-scoped.
    super(ItTicketPriorityModel);
  }

  /** The one a ticket is opening against. Must be ACTIVE — an archived policy opens nothing. */
  async findActive(id: string): Promise<ItTicketPriorityDoc | null> {
    return this.findOne({ _id: id, isActive: true });
  }

  async listFiltered(params: {
    isActive?: boolean | undefined;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
  }): Promise<Paginated<ItTicketPriorityDoc>> {
    const filter: Record<string, unknown> = {};
    if (params.isActive !== undefined) filter.isActive = params.isActive;
    return this.list({
      filter,
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy ?? 'rank',
      sortDir: params.sortDir ?? 'asc',
      sortableFields: ['rank', 'createdAt', 'name.ar'],
    });
  }
}

export const itTicketPriorityRepository = new ItTicketPriorityRepository();
