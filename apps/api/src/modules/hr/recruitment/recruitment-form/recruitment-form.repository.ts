import { Types } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { RecruitmentFormModel, type RecruitmentFormDoc } from './recruitment-form.model';

class RecruitmentFormRepository extends BaseRepository<RecruitmentFormDoc> {
  constructor() {
    super(RecruitmentFormModel, {}); // organization-level configuration, no branch scope
  }

  async findSingleton(): Promise<RecruitmentFormDoc | null> {
    return this.model.findOne({ key: 'default', isDeleted: false }).lean<RecruitmentFormDoc>().exec();
  }

  /** The public page's entry point: a token names its link, and the link names its source. */
  async findByToken(token: string): Promise<RecruitmentFormDoc | null> {
    return this.model
      .findOne({ 'links.token': token, isDeleted: false })
      .lean<RecruitmentFormDoc>()
      .exec();
  }

  /**
   * A submission counter, incremented on its own rather than through a read-modify-write of the
   * whole document: two candidates submitting at the same second must both be counted, and
   * neither should be able to lose the other's answers by writing a stale `links` array back.
   */
  async countSubmission(id: string, token: string): Promise<void> {
    await this.model
      .updateOne(
        { _id: new Types.ObjectId(id), 'links.token': token },
        { $inc: { 'links.$.submissions': 1 } },
      )
      .exec();
  }
}

export const recruitmentFormRepository = new RecruitmentFormRepository();
