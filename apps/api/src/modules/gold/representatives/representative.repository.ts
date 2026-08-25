import { Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { GoldRepresentativeModel, type GoldRepresentativeDoc } from './representative.model';

class GoldRepresentativeRepository extends BaseRepository<GoldRepresentativeDoc> {
  constructor() {
    // Follows its company: organization-level, exactly as the gold system had it.
    super(GoldRepresentativeModel, {});
  }

  /** Ids that are not ObjectIds are dropped — see `namesOf` on the company repository for why. */
  async namesOf(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].filter((value) => Types.ObjectId.isValid(value));
    if (unique.length === 0) return new Map();
    const docs = await this.model
      .find({ _id: { $in: unique } })
      .select('fullName')
      .lean<Pick<GoldRepresentativeDoc, '_id' | 'fullName'>[]>()
      .exec();
    return new Map(docs.map((d) => [String(d._id), d.fullName]));
  }

  async countForCompany(companyId: string): Promise<number> {
    return this.count({ companyId } as never);
  }
}

export const goldRepresentativeRepository = new GoldRepresentativeRepository();
