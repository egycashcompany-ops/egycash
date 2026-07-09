import { BaseRepository } from '../../../shared/base/base.repository';
import { BranchModel, type BranchDoc } from './branch.model';

class BranchRepository extends BaseRepository<BranchDoc> {
  constructor() {
    // A branch-scoped caller sees exactly their own branch record.
    super(BranchModel, { branchField: '_id' });
  }
}

export const branchRepository = new BranchRepository();
