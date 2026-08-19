import { BaseRepository } from '../../../shared/base/base.repository';
import { OperationsCurrencyModel, type OperationsCurrencyDoc } from './currency.model';

class OperationsCurrencyRepository extends BaseRepository<OperationsCurrencyDoc> {
  constructor() {
    super(OperationsCurrencyModel, {}); // organization-level reference data, no org scoping
  }

  /** Active currencies among the given ids — one query for a whole lines[] check. */
  async findActiveByIds(ids: readonly string[]): Promise<OperationsCurrencyDoc[]> {
    return this.model
      .find({ _id: { $in: ids }, isDeleted: false, isActive: true })
      .lean<OperationsCurrencyDoc[]>()
      .exec();
  }
}

export const operationsCurrencyRepository = new OperationsCurrencyRepository();
