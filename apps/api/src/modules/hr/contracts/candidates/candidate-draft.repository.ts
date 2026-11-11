// Data access only (ADR-003).
import { Types } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { CandidateDraftModel, type CandidateDraftDoc } from './candidate-draft.model';

class CandidateDraftRepository extends BaseRepository<CandidateDraftDoc> {
  constructor() {
    super(CandidateDraftModel, {});
  }

  async findByOffer(offerId: string): Promise<CandidateDraftDoc | null> {
    return this.model
      .findOne({ offerId: new Types.ObjectId(offerId), isDeleted: false })
      .lean<CandidateDraftDoc>()
      .exec();
  }
}

export const candidateDraftRepository = new CandidateDraftRepository();
