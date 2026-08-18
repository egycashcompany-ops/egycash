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

  /**
   * THE DAY BOARD — the legacy `/main_ops` working set, which is a UNION of two different date
   * fields and cannot be expressed as a filter over one (contad_app.js:262-268).
   *
   * It exists as a repository query, and not as something the client assembles from two list
   * calls, because the union IS a business rule: which shipments a desk works today. Rebuilding it
   * in React would put a legacy rule back in a browser, which is exactly what this migration is
   * undoing.
   *
   * Newest-first by creation — the legacy `.sort({ input_date: -1 })`.
   */
  async dayBoard(day: Date, next: Date): Promise<OperationsShipmentDoc[]> {
    const range = { $gte: day, $lt: next };
    return this.model
      .find({
        isDeleted: false,
        $or: [
          // The day's collection runs.
          { shipmentType: 'daily', collectionDate: range },
          // Secured shipments DUE today — and only those already out of the vault or finished.
          // The legacy filter is `status: [1, 3]`, a Mongoose array cast to `$in` (quirk Q10):
          // 1 = completed, 3 = dispatched. A secured shipment still in the vault is NOT on this
          // board, which is why the vault screens exist separately.
          {
            shipmentType: 'secured',
            deliveryDate: range,
            status: { $in: ['completed', 'dispatched'] },
          },
        ],
      })
      .sort({ createdAt: -1 })
      .lean<OperationsShipmentDoc[]>()
      .exec();
  }

  /**
   * COMPLETED shipments in a range, for the reports — the legacy report `$match` (:4877/:4919).
   *
   * The two types are attributed by DIFFERENT dates: a daily shipment belongs to the month it was
   * COLLECTED, a secured one to the month it was DELIVERED. Reporting both on one field would
   * quietly move money between months, which is why this is a union and not a single filter.
   */
  async completedInRange(from: Date, toExclusive: Date): Promise<OperationsShipmentDoc[]> {
    const range = { $gte: from, $lt: toExclusive };
    return this.model
      .find({
        isDeleted: false,
        status: 'completed',
        $or: [
          { shipmentType: 'daily', collectionDate: range },
          { shipmentType: 'secured', deliveryDate: range },
        ],
      })
      .lean<OperationsShipmentDoc[]>()
      .exec();
  }
}

export const operationsShipmentRepository = new OperationsShipmentRepository();
