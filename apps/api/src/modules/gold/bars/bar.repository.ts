import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { GoldBarModel, type GoldBarDoc } from './bar.model';

class GoldBarRepository extends BaseRepository<GoldBarDoc> {
  constructor() {
    super(GoldBarModel, { branchField: 'branchId' });
  }

  /** Live bars carrying any of these serials — the duplicate check a confirm runs. */
  async findBySerials(serials: readonly string[]): Promise<GoldBarDoc[]> {
    if (serials.length === 0) return [];
    return this.model
      .find({ serialNumber: { $in: [...serials] }, isDeleted: false })
      .select('serialNumber')
      .lean<GoldBarDoc[]>()
      .exec();
  }

  /**
   * Every live bar physically inside one drawer, unpaginated.
   *
   * Deliberately not `list()`: the drawer dialog and the جرد الدرج audit sheet show a drawer's
   * WHOLE contents, and nothing bounds how many bars a drawer holds (`weightLimit` is indicative).
   * `list()` clamps to MAX_PAGE_SIZE, which would silently truncate the sheet — gold's `getDrawer`
   * read the full set.
   */
  async findInDrawer(
    drawerId: string | Types.ObjectId,
    scope?: ScopeSelector,
  ): Promise<GoldBarDoc[]> {
    return this.model
      .find(
        this.baseFilter(scope, {
          currentDrawerId: new Types.ObjectId(String(drawerId)),
          status: 'in_vault',
        } as FilterQuery<GoldBarDoc>),
      )
      .sort({ serialNumber: 1 })
      .lean<GoldBarDoc[]>()
      .exec();
  }

  async findByIds(ids: readonly (string | Types.ObjectId)[]): Promise<GoldBarDoc[]> {
    if (ids.length === 0) return [];
    return this.model
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(String(id))) }, isDeleted: false })
      .lean<GoldBarDoc[]>()
      .exec();
  }

  async insertMany(docs: Partial<GoldBarDoc>[]): Promise<GoldBarDoc[]> {
    const created = await this.model.insertMany(docs, { ordered: true });
    return created.map((doc) => doc.toObject() as GoldBarDoc);
  }

  /** Direct `$set` — the operation services own the bar's state machine, not the base seam. */
  async patch(id: string | Types.ObjectId, set: Partial<GoldBarDoc>): Promise<void> {
    await this.model
      .updateOne({ _id: new Types.ObjectId(String(id)) }, { $set: set, $inc: { __v: 1 } })
      .exec();
  }

  async pushHistory(
    id: string | Types.ObjectId,
    entry: GoldBarDoc['history'][number],
    set: Partial<GoldBarDoc> = {},
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: new Types.ObjectId(String(id)) },
        { $push: { history: entry }, $set: set, $inc: { __v: 1 } },
      )
      .exec();
  }

  async distinctPurities(scope?: ScopeSelector): Promise<string[]> {
    const values = await this.model.distinct('purity', this.baseFilter(scope)).exec();
    return values.filter((v): v is string => typeof v === 'string' && v !== '');
  }

  async aggregateRaw<T>(pipeline: PipelineStage[]): Promise<T[]> {
    return this.model.aggregate<T>(pipeline).exec();
  }

  /** The scope + soft-delete filter, so the module's aggregations start from the same ground. */
  scopedMatch(scope: ScopeSelector | undefined, extra: FilterQuery<GoldBarDoc> = {}) {
    return this.baseFilter(scope, extra);
  }
}

export const goldBarRepository = new GoldBarRepository();
