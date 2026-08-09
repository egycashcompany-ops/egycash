import { Types, type ClientSession } from 'mongoose';
import { type ListItSparePartsQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { ItSparePartModel, type ItSparePartDoc } from './part.model';

class ItSparePartRepository extends BaseRepository<ItSparePartDoc> {
  constructor() {
    super(ItSparePartModel, {});
  }

  async findByCode(partCode: string, session?: ClientSession): Promise<ItSparePartDoc | null> {
    const query = this.model.findOne({ partCode, isDeleted: false });
    if (session !== undefined) query.session(session);
    return query.lean<ItSparePartDoc>().exec();
  }

  async listFiltered(query: ListItSparePartsQuery): Promise<Paginated<ItSparePartDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.active !== undefined) filter.active = query.active;
    // "Below minimum" compares two fields, so it needs `$expr`; parts with no `minQty` have no
    // minimum to be below and drop out, which is the intended reading of "not set".
    if (query.belowMin === true) {
      filter.minQty = { $ne: null };
      filter.$expr = { $lte: ['$onHandQty', '$minQty'] };
    }
    if (query.search !== undefined && query.search !== '') {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ partCode: pattern }, { name: pattern }];
    }
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'partCode', 'name', 'onHandQty'],
    });
  }

  /**
   * Move stock by `delta` and return the row as it now stands.
   *
   * The sufficiency check is IN THE FILTER, not a read followed by a write: two technicians
   * consuming the last part concurrently both match `onHandQty >= 1` if you read first, and both
   * writes then succeed. Here the second one matches nothing.
   *
   * A miss is therefore ambiguous — gone, or not enough — so it is disambiguated with a second
   * read rather than guessed at, because the two answers are a 404 and a 422.
   */
  async moveStock(
    partId: string,
    delta: number,
    session: ClientSession,
  ): Promise<ItSparePartDoc> {
    if (!Types.ObjectId.isValid(partId)) throw new NotFoundError();
    const filter: Record<string, unknown> = {
      _id: new Types.ObjectId(partId),
      isDeleted: false,
    };
    if (delta < 0) filter.onHandQty = { $gte: -delta };

    const updated = await this.model
      .findOneAndUpdate(filter, { $inc: { onHandQty: delta } }, { new: true, session })
      .lean<ItSparePartDoc>()
      .exec();
    if (updated !== null) return updated;

    const exists = await this.model
      .findOne({ _id: new Types.ObjectId(partId), isDeleted: false })
      .session(session)
      .lean<ItSparePartDoc>()
      .exec();
    if (exists === null) throw new NotFoundError();
    throw new BusinessRuleError(
      `spare part ${exists.partCode} has ${String(exists.onHandQty)} on hand and cannot issue ${String(-delta)}`,
    );
  }
}

export const itSparePartRepository = new ItSparePartRepository();
