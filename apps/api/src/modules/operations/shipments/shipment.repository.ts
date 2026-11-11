import { type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { OperationsShipmentModel, type OperationsShipmentDoc } from './shipment.model';

/**
 * The board's union as one filter, shared by the read and the count so the count can never
 * measure a different set than the rows it stands in for.
 */
const boardFilter = (
  from: Date,
  toExclusive: Date,
  deleted = false,
): FilterQuery<OperationsShipmentDoc> => {
  const range = { $gte: from, $lt: toExclusive };
  return {
    // `deleted` reads the SAME union over the rows that were deleted from those boards — the
    // deleted shipments list («اعملى ايقون اقدر اجيب منه اللى اتمسح»). One filter for both, so a row
    // listed there is exactly a row that comes back onto that board when it is restored.
    isDeleted: deleted,
    $or: [
      // The days' collection runs.
      { shipmentType: 'daily', collectionDate: range },
      // Secured shipments DUE in the range — and only those already out of the vault or finished.
      // The legacy filter is `status: [1, 3]`, a Mongoose array cast to `$in` (quirk Q10):
      // 1 = completed, 3 = dispatched. A secured shipment still in the vault is NOT on this
      // board, which is why the vault screens exist separately.
      {
        shipmentType: 'secured',
        deliveryDate: range,
        status: { $in: ['completed', 'dispatched'] },
      },
    ],
  };
};

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
   * fields and cannot be expressed as a filter over one (contad_app.js:262-268) — over the
   * half-open range [from, toExclusive). One day is the board; several days are the shipments
   * history («عاوز اعمل dublicat للشاشة دى بس التاريخ هيكون من الى»), which is the same board by
   * definition, so both read this one query and can never disagree about which rows a day holds.
   *
   * It exists as a repository query, and not as something the client assembles from two list
   * calls, because the union IS a business rule: which shipments a desk works today. Rebuilding it
   * in React would put a legacy rule back in a browser, which is exactly what this migration is
   * undoing.
   *
   * Newest-first by creation — the legacy `.sort({ input_date: -1 })`. Each half of the `$or` is
   * served by its own index (`ix_type_collection_date`, `ix_type_delivery_date_status`).
   */
  async boardInRange(from: Date, toExclusive: Date): Promise<OperationsShipmentDoc[]> {
    return this.model
      .find(boardFilter(from, toExclusive))
      .sort({ createdAt: -1 })
      .lean<OperationsShipmentDoc[]>()
      .exec();
  }

  /**
   * How many rows `boardInRange` would return, without loading one — so a history range that is
   * too large is refused for the price of an index count, before anything is read or joined.
   */
  async countBoardInRange(from: Date, toExclusive: Date): Promise<number> {
    return this.model.countDocuments(boardFilter(from, toExclusive)).exec();
  }

  /**
   * The rows DELETED from the boards of [from, toExclusive) — the history's union over deleted
   * rows, newest deleted first. Each half of the `$or` rides the same index as the board's own.
   */
  async deletedBoardInRange(from: Date, toExclusive: Date): Promise<OperationsShipmentDoc[]> {
    return this.model
      .find(boardFilter(from, toExclusive, true))
      .sort({ deletedAt: -1, _id: -1 })
      .lean<OperationsShipmentDoc[]>()
      .exec();
  }

  /** How many rows `deletedBoardInRange` would return — counted before anything is loaded. */
  async countDeletedBoardInRange(from: Date, toExclusive: Date): Promise<number> {
    return this.model.countDocuments(boardFilter(from, toExclusive, true)).exec();
  }

  /**
   * One shipment WHETHER OR NOT it is deleted — the action log answers for a deleted shipment too,
   * so the deleted list can show what happened to a row before it was taken off its board.
   */
  async findAnyById(id: string): Promise<OperationsShipmentDoc | null> {
    const [doc] = await this.findByIdsSystem([id]);
    return doc ?? null;
  }

  /** A set of shipments by id — the vault roll-up joins the money onto its custody rows. */
  async findByIds(ids: string[]): Promise<OperationsShipmentDoc[]> {
    if (ids.length === 0) return [];
    return this.model
      .find({ _id: { $in: ids }, isDeleted: false })
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
