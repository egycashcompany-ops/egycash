import { AtmOperationLogRepository } from '../shared/operation-log.repository';
import { AtmReplenishmentModel, type AtmReplenishmentDoc } from './replenishment.model';

class AtmReplenishmentRepository extends AtmOperationLogRepository<AtmReplenishmentDoc> {
  constructor() {
    super(AtmReplenishmentModel, { branchField: 'branchId' });
  }
}

export const atmReplenishmentRepository = new AtmReplenishmentRepository();
