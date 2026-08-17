import { type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { OperationsShipmentModel, type OperationsShipmentDoc } from './shipment.model';

class OperationsShipmentRepository extends BaseRepository<OperationsShipmentDoc> {
  constructor() {
    super(OperationsShipmentModel, {}); // org scoping arrives with the day/board slice if needed
  }

  async listShipments(
    params: Omit<ListParams<OperationsShipmentDoc>, 'sortableFields'> & {
      filter: FilterQuery<OperationsShipmentDoc>;
    },
  ): Promise<Paginated<OperationsShipmentDoc>> {
    return this.list({
      ...params,
      sortableFields: ['collectionDate', 'deliveryDate', 'status', 'createdAt'],
    });
  }
}

export const operationsShipmentRepository = new OperationsShipmentRepository();
