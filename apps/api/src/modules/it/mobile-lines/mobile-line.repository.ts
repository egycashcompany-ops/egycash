import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { collectionReady } from './ensure-collection';
import { ItMobileLineModel, type ItMobileLineDoc } from './mobile-line.model';

/** One group of the summary's facet: a network, and a status or a value counted under it. */
interface CountRow {
  _id: { network: string; key: string | null };
  count: number;
}

export interface ItMobileLineCounts {
  statuses: CountRow[];
  accounts: CountRow[];
  ratePlans: CountRow[];
}

class ItMobileLineRepository extends BaseRepository<ItMobileLineDoc> {
  readonly ensureCollection = collectionReady(ItMobileLineModel);

  constructor() {
    // Branch-scoped like the assets: a branch-scoped technician sees that branch's lines.
    super(ItMobileLineModel, { branchField: 'branchId' });
  }

  /**
   * Read inside a transaction, for a custody or status transition: the `__v` handed to
   * `updateById` must come from the SAME transaction, or a concurrent writer's bump goes unseen.
   * Scoped like every other read, so a caller cannot move another branch's line.
   */
  async getByIdForUpdate(
    id: string,
    scope: ScopeSelector | undefined,
    session: ClientSession,
  ): Promise<ItMobileLineDoc> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError('mobile line not found');
    const doc = await this.model
      .findOne(this.baseFilter(scope, { _id: new Types.ObjectId(id) }))
      .session(session)
      .lean<ItMobileLineDoc>()
      .exec();
    if (doc === null) throw new NotFoundError('mobile line not found');
    return doc;
  }

  /**
   * The requested lines the caller may see — the labels on a page of custody intervals. Through
   * the scoped list path, so a branch-scoped reader is never told another branch's number.
   */
  async findManyByIds(ids: readonly string[], scope?: ScopeSelector): Promise<ItMobileLineDoc[]> {
    const distinct = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
    if (distinct.length === 0) return [];
    const page = await this.list({
      filter: { _id: { $in: distinct.map((id) => new Types.ObjectId(id)) } },
      page: 1,
      pageSize: distinct.length,
      ...(scope === undefined ? {} : { scope }),
    });
    return page.items;
  }

  /**
   * «مع بيانات كل شبكة» — every count the network cards show, in ONE aggregation: lines per network
   * and status, per network and account, per network and plan. Scoped and soft-delete-aware like
   * the register itself, so a card never counts a line its reader cannot list.
   */
  async countsByNetwork(
    filter: FilterQuery<ItMobileLineDoc>,
    scope: ScopeSelector,
  ): Promise<ItMobileLineCounts> {
    // `$ifNull`, because a field MISSING from a document drops out of a grouped `_id` altogether,
    // which would count «no account» twice — once as null, once as nothing.
    const by = (key: string) => [
      {
        $group: {
          _id: { network: '$network', key: { $ifNull: [`$${key}`, null] } },
          count: { $sum: 1 },
        },
      },
    ];
    const [facets] = await this.model
      .aggregate<ItMobileLineCounts>([
        { $match: this.baseFilter(scope, filter) },
        {
          $facet: {
            statuses: by('status'),
            accounts: by('accountNumber'),
            ratePlans: by('ratePlan'),
          },
        },
      ])
      .exec();
    return facets ?? { statuses: [], accounts: [], ratePlans: [] };
  }
}

export const itMobileLineRepository = new ItMobileLineRepository();
