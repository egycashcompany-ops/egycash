import { BaseRepository } from '../../../shared/base/base.repository';
import { OperationsAreaModel, type OperationsAreaDoc } from './area.model';

class OperationsAreaRepository extends BaseRepository<OperationsAreaDoc> {
  constructor() {
    super(OperationsAreaModel, {}); // organization-level reference data, no org scoping
  }
}

export const operationsAreaRepository = new OperationsAreaRepository();
