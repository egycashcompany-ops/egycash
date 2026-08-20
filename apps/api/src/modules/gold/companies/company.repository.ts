import { BaseRepository } from '../../../shared/base/base.repository';
import { GoldCompanyModel, type GoldCompanyDoc } from './company.model';

class GoldCompanyRepository extends BaseRepository<GoldCompanyDoc> {
  constructor() {
    // Organization-level reference data — a fund is a customer of the company, not of a branch.
    // This is how the gold system had it, and branch-scoping it now would hide half the owners
    // from a branch operator who has to hand their metal back.
    super(GoldCompanyModel, {});
  }

  /** Names for a page of rows — one query instead of one per row. */
  async namesOf(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const docs = await this.model
      .find({ _id: { $in: unique } })
      .select('name')
      .lean<Pick<GoldCompanyDoc, '_id' | 'name'>[]>()
      .exec();
    return new Map(docs.map((d) => [String(d._id), d.name]));
  }
}

export const goldCompanyRepository = new GoldCompanyRepository();
