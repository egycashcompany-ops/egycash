import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { OPERATIONS_SHIPMENT_STATUSES, type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { OperationsShipmentModel, type OperationsShipmentDoc } from './shipment.model';

/**
 * Which union a board read means — the two screens that answer "which shipments belong to these
 * days" answer it differently since Round 8:
 *
 *   · `day`     — THE DAY BOARD: daily shipments COLLECTED on the days, plus secured shipments due
 *                 for DELIVERY on them, whatever their stage («اليوم التشغيلى هيظهر فيها اليومى
 *                 والمحصنة اللى اليوم بتاعها فى اليوم اللى هتخرج فيه»). The legacy board kept only
 *                 the secured ones already out of the vault (`status: [1,3]`, Q10); the owner asked
 *                 for every one due that day, so the desk sees today's محصنات from the moment they
 *                 are booked, coloured by their stage.
 *   · `history` — THE HISTORY and the deleted list: the same dailies, plus secured shipments whose
 *                 COLLECTION or DELIVERY date falls in the range, whatever their stage
 *                 («المفروض الشاشة اللى احنا عملينها history تكون شحنات ومحصنات»).
 */
export type BoardUnion = 'day' | 'history';

/**
 * The union as one filter, shared by the read and the count so the count can never measure a
 * different set than the rows it stands in for. Each branch of the `$or` is served by its own index:
 * `ix_type_collection_date` for the collection-date ones, `ix_type_delivery_date_status` (its
 * `{shipmentType, deliveryDate}` prefix) for the delivery-date one. A secured shipment both collected
 * and delivered in a history range matches two branches and is still ONE document — `$or` is a
 * filter, not a concatenation, so it is listed and counted once.
 */
const boardFilter = (
  from: Date,
  toExclusive: Date,
  union: BoardUnion,
  deleted = false,
): FilterQuery<OperationsShipmentDoc> => {
  const range = { $gte: from, $lt: toExclusive };
  return {
    // `deleted` reads the SAME union over the rows that were deleted from those days — the
    // deleted shipments list («اعملى ايقون اقدر اجيب منه اللى اتمسح»). One filter for both, so a row
    // listed there is exactly a row that comes back onto that history when it is restored.
    isDeleted: deleted,
    $or: [
      // The days' collection runs.
      { shipmentType: 'daily', collectionDate: range },
      // Secured shipments due out in the range — any stage.
      { shipmentType: 'secured', deliveryDate: range },
      // …and, over a history, the secured ones collected in it too.
      ...(union === 'history' ? [{ shipmentType: 'secured', collectionDate: range }] : []),
    ],
  };
};

/** Every status a secured shipment can hold before the desk closes it — the open backlog. */
const OPEN_SECURED_STATUSES = OPERATIONS_SHIPMENT_STATUSES.filter((s) => s !== 'completed');

/**
 * THE SECURED SCREEN's set: every secured shipment not completed and not deleted — the legacy
 * `/mohsana` backlog `{type:"محصنة", status:{$ne:1}, deleted:0}` (:657), no date filter. Spelled as
 * an `$in` of the open statuses rather than `$ne`, so `ix_type_status_created` serves both the
 * match and the newest-first order.
 */
const openSecuredFilter: FilterQuery<OperationsShipmentDoc> = {
  isDeleted: false,
  shipmentType: 'secured',
  status: { $in: OPEN_SECURED_STATUSES },
};

/** The secured shipments the vault has not received yet — status draft, not deleted. */
const securedDraftFilter: FilterQuery<OperationsShipmentDoc> = {
  isDeleted: false,
  shipmentType: 'secured',
  status: 'draft',
};

/**
 * «صرف الخزينة» (Round 10) — every secured shipment IN THE VAULT, or only those whose delivery date
 * is `day` (a UTC midnight — the stored form). Without a day it is served by
 * `ix_type_status_created`; with one, by `ix_type_delivery_date_status`. A shipment with no delivery
 * date matches only the unfiltered form — a day is a question about a date it lacks.
 */
const inVaultFilter = (day: Date | undefined): FilterQuery<OperationsShipmentDoc> => ({
  isDeleted: false,
  shipmentType: 'secured',
  status: 'inVault',
  ...(day === undefined ? {} : { deliveryDate: day }),
});

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
   * THE DAY BOARD and THE HISTORY — a UNION over two different date fields that cannot be
   * expressed as a filter over one (see `BoardUnion`) — over the half-open range [from, toExclusive).
   * One day of `day` is the day board; a range of `history` is the shipments history.
   *
   * It exists as a repository query, and not as something the client assembles from list calls,
   * because the union IS a business rule: which shipments a desk works on a day. Rebuilding it in
   * React would put a rule back in a browser, which is exactly what this migration is undoing.
   *
   * Newest-first by creation — the legacy `.sort({ input_date: -1 })`.
   */
  async boardInRange(
    from: Date,
    toExclusive: Date,
    union: BoardUnion,
  ): Promise<OperationsShipmentDoc[]> {
    return this.model
      .find(boardFilter(from, toExclusive, union))
      .sort({ createdAt: -1 })
      .lean<OperationsShipmentDoc[]>()
      .exec();
  }

  /**
   * How many rows `boardInRange` would return, without loading one — so a history range that is
   * too large is refused for the price of an index count, before anything is read or joined.
   */
  async countBoardInRange(from: Date, toExclusive: Date, union: BoardUnion): Promise<number> {
    return this.model.countDocuments(boardFilter(from, toExclusive, union)).exec();
  }

  /**
   * The rows DELETED from the history of [from, toExclusive) — the history's union over deleted
   * rows, newest deleted first.
   */
  async deletedBoardInRange(from: Date, toExclusive: Date): Promise<OperationsShipmentDoc[]> {
    return this.model
      .find(boardFilter(from, toExclusive, 'history', true))
      .sort({ deletedAt: -1, _id: -1 })
      .lean<OperationsShipmentDoc[]>()
      .exec();
  }

  /** How many rows `deletedBoardInRange` would return — counted before anything is loaded. */
  async countDeletedBoardInRange(from: Date, toExclusive: Date): Promise<number> {
    return this.model.countDocuments(boardFilter(from, toExclusive, 'history', true)).exec();
  }

  /** THE SECURED SCREEN — every open secured shipment, newest created first (`openSecuredFilter`). */
  async openSecured(): Promise<OperationsShipmentDoc[]> {
    return this.model
      .find(openSecuredFilter)
      .sort({ createdAt: -1 })
      .lean<OperationsShipmentDoc[]>()
      .exec();
  }

  /** How many rows `openSecured` would return — counted before anything is loaded. */
  async countOpenSecured(): Promise<number> {
    return this.model.countDocuments(openSecuredFilter).exec();
  }

  /**
   * Every secured shipment the vault has not received yet (status `draft`), newest created first —
   * the vault's receive queue reads these and keeps the ones its stage asks for.
   */
  async securedDrafts(): Promise<OperationsShipmentDoc[]> {
    return this.model
      .find(securedDraftFilter)
      .sort({ createdAt: -1 })
      .lean<OperationsShipmentDoc[]>()
      .exec();
  }

  /** How many rows `securedDrafts` would return — counted before anything is loaded. */
  async countSecuredDrafts(): Promise<number> {
    return this.model.countDocuments(securedDraftFilter).exec();
  }

  /**
   * «صرف الخزينة» — the secured shipments in the vault (`inVaultFilter`), in no particular order: the
   * service orders them by delivery date with the undated ones last, which Mongo's ascending sort
   * (nulls first) cannot say.
   */
  async securedInVault(day?: Date): Promise<OperationsShipmentDoc[]> {
    return this.model.find(inVaultFilter(day)).lean<OperationsShipmentDoc[]>().exec();
  }

  /** How many rows `securedInVault` would return — counted before anything is loaded. */
  async countSecuredInVault(day?: Date): Promise<number> {
    return this.model.countDocuments(inVaultFilter(day)).exec();
  }

  /**
   * THE CAPTAIN'S PICKUP ✓, recorded on the shipment (Round 10) — in the caller's transaction, ONE
   * conditional write: only a live SECURED shipment still in `draft` with NO pickup recorded
   * (`pickup: null` matches the explicit null and a pre-Round-10 row without the field alike). So
   * the desk's ✓ is never overwritten («لو العمليات عملت صح القائد مينفعش يشيلها»), a shipment the
   * vault already has is never touched, and two racing writes cannot both land. The version moves
   * like any other write's, so a desk screen read before it is refused as stale.
   *
   * Returns the updated row, or null when nothing matched — which is not an error: a daily
   * shipment, or one whose pickup someone already recorded, simply keeps what it has.
   */
  async recordCaptainPickup(
    id: string,
    pickup: NonNullable<OperationsShipmentDoc['pickup']>,
    session?: ClientSession,
  ): Promise<OperationsShipmentDoc | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, isDeleted: false, shipmentType: 'secured', status: 'draft', pickup: null },
        { $set: { pickup, updatedBy: pickup.userId }, $inc: { __v: 1 } },
        { new: true, session: session ?? null },
      )
      .lean<OperationsShipmentDoc>()
      .exec();
  }

  /**
   * The soft delete held to the vault's lock AT THE WRITE (Round 10): ONE conditional write that
   * matches only a live shipment that is not locked — a daily one, or a secured one still in
   * `draft` (`isOperationsShipmentLocked`). The service checks the lock first for the plain answer;
   * this closes the moment between that check and the write. A delete carries no version, so
   * without it the vault's ✓ landing in that moment would be deleted over — a shipment off every
   * board with its custody still held.
   *
   * Null when nothing matched (deleted meanwhile, or locked by then); the caller says which.
   */
  async softDeleteUnlocked(id: string, by: string): Promise<OperationsShipmentDoc | null> {
    const actor = new Types.ObjectId(by);
    return this.model
      .findOneAndUpdate(
        {
          _id: id,
          isDeleted: false,
          $or: [{ shipmentType: { $ne: 'secured' } }, { status: 'draft' }],
        },
        {
          $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actor, updatedBy: actor },
          $inc: { __v: 1 },
        },
        { new: true },
      )
      .lean<OperationsShipmentDoc>()
      .exec();
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
