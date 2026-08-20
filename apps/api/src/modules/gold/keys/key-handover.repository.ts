import { Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { GoldKeyHandoverModel, type GoldKeyHandoverDoc } from './key-handover.model';

class GoldKeyHandoverRepository extends BaseRepository<GoldKeyHandoverDoc> {
  constructor() {
    super(GoldKeyHandoverModel, { branchField: 'branchId' });
  }

  /** The live handover for a drawer, if any — the "one key per drawer" check. */
  async findActiveForDrawer(drawerId: string): Promise<GoldKeyHandoverDoc | null> {
    return this.model
      .findOne({ drawerId: new Types.ObjectId(drawerId), status: 'active', isDeleted: false })
      .lean<GoldKeyHandoverDoc>()
      .exec();
  }

  /** Every live handover in scope — the overlay the vault board and the Keys page share. */
  async findActive(scope?: ScopeSelector): Promise<GoldKeyHandoverDoc[]> {
    return this.model
      .find(this.baseFilter(scope, { status: 'active' }))
      .lean<GoldKeyHandoverDoc[]>()
      .exec();
  }
}

export const goldKeyHandoverRepository = new GoldKeyHandoverRepository();
