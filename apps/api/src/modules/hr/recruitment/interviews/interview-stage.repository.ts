import { BaseRepository } from '../../../../shared/base/base.repository';
import { InterviewStageModel, type InterviewStageDoc } from './interview-stage.model';

class InterviewStageRepository extends BaseRepository<InterviewStageDoc> {
  constructor() {
    super(InterviewStageModel, {}); // organization-level catalog, no branch scope
  }

  async findByKey(key: string): Promise<InterviewStageDoc | null> {
    return this.model.findOne({ key, isDeleted: false }).lean<InterviewStageDoc>().exec();
  }

  async findActiveById(id: string): Promise<InterviewStageDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.active ? doc : null;
  }

  /** The active stage immediately after `order`, if any (drives applicant progression). */
  async findNextActiveAfter(order: number): Promise<InterviewStageDoc | null> {
    return this.model
      .findOne({ isDeleted: false, active: true, order: { $gt: order } })
      .sort({ order: 1 })
      .lean<InterviewStageDoc>()
      .exec();
  }

  /** The active stage at exactly `order`, if any. */
  async findActiveByOrder(order: number): Promise<InterviewStageDoc | null> {
    return this.model
      .findOne({ isDeleted: false, active: true, order })
      .lean<InterviewStageDoc>()
      .exec();
  }

  /** The active stage immediately before `order`, if any (drives the entry gate). */
  async findPrevActiveBefore(order: number): Promise<InterviewStageDoc | null> {
    return this.model
      .findOne({ isDeleted: false, active: true, order: { $lt: order } })
      .sort({ order: -1 })
      .lean<InterviewStageDoc>()
      .exec();
  }

  /** The last (highest-order) active stage — the final interview round. */
  async findLastActive(): Promise<InterviewStageDoc | null> {
    return this.model
      .findOne({ isDeleted: false, active: true })
      .sort({ order: -1 })
      .lean<InterviewStageDoc>()
      .exec();
  }
}

export const interviewStageRepository = new InterviewStageRepository();
