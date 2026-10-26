// Append-only: one write and one read. There is deliberately no update and no delete — a line's
// history is a business record (ADR-021), and the missing methods are the cheapest enforcement.
import { Types, type ClientSession } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { collectionReady } from './ensure-collection';
import { ItMobileLineEventModel, type ItMobileLineEventDoc } from './line-event.model';

class ItMobileLineEventRepository extends BaseRepository<ItMobileLineEventDoc> {
  readonly ensureCollection = collectionReady(ItMobileLineEventModel);

  constructor() {
    super(ItMobileLineEventModel);
  }

  /** One entry, inside the caller's transaction: the fact and its record land together or not. */
  async append(
    entry: {
      subjectId: Types.ObjectId;
      type: ItMobileLineEventDoc['type'];
      at: Date;
      actorUserId: Types.ObjectId | null;
      actorName: string;
      metadata: Record<string, unknown>;
      notes: string | null;
    },
    options: { by: string; session?: ClientSession },
  ): Promise<ItMobileLineEventDoc> {
    return this.create(entry as Partial<ItMobileLineEventDoc>, options);
  }

  async listForLine(params: {
    lineId: string;
    type?: string | undefined;
    page: number;
    pageSize: number;
  }): Promise<Paginated<ItMobileLineEventDoc>> {
    const filter: Record<string, unknown> = { subjectId: new Types.ObjectId(params.lineId) };
    if (params.type !== undefined) filter.type = params.type;
    return this.list({
      filter,
      page: params.page,
      pageSize: params.pageSize,
      // A chronology, newest first — not a sortable table.
      sortBy: 'at',
      sortDir: 'desc',
      sortableFields: ['at'],
    });
  }
}

export const itMobileLineEventRepository = new ItMobileLineEventRepository();
