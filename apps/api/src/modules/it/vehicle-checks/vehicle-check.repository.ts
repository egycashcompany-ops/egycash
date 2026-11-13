import { Types, type FilterQuery } from 'mongoose';
import { IT_VEHICLE_CHECK_MAX_PHOTOS, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { collectionReady } from '../mobile-lines/ensure-collection';
import { type VehicleCheckWindowFigures } from './vehicle-check-dashboard';
import {
  ItVehicleCheckModel,
  type ItVehicleCheckDoc,
  type ItVehicleCheckPhotoSub,
} from './vehicle-check.model';

class ItVehicleCheckRepository extends BaseRepository<ItVehicleCheckDoc> {
  /** The unique request-id index has to exist before the first report, as `autoIndex` is off. */
  readonly ensureCollection = collectionReady(ItVehicleCheckModel);

  constructor() {
    // The data-scope anchor for the dashboard's readers: the car's branch at filing. A report
    // filed on a car with no branch matches no branch, so no branch-scoped reader sees it. No
    // `ownerUserField` — the default `own` scope already matches `createdBy`, the reporter.
    super(ItVehicleCheckModel, { branchField: 'branchId' });
  }

  /**
   * «آخر التقارير» — one page, the newest first: the latest day, then the latest filing. The order
   * is the screen's and not the caller's to choose, so no `sortBy` from the query reaches it.
   */
  async listNewestFirst(
    filter: FilterQuery<ItVehicleCheckDoc>,
    page: { page: number; pageSize: number },
    scope: ScopeSelector,
  ): Promise<Paginated<ItVehicleCheckDoc>> {
    return this.list({
      filter,
      page: page.page,
      pageSize: page.pageSize,
      sorts: [
        { by: 'checkDate', dir: 'desc' },
        { by: 'createdAt', dir: 'desc' },
      ],
      sortableFields: ['checkDate', 'createdAt'],
      scope,
    });
  }

  /**
   * Each car's latest LIVE report the reader may see — the latest day, then the latest filing — in
   * ONE aggregation, whatever the number of cars: the `ix_vehicle_latest` order, and the first
   * report of each car. The match is this repository's own (live, under the scope), so the
   * reduction can never see a report the list would not show.
   */
  async latestPerVehicle(
    filter: FilterQuery<ItVehicleCheckDoc>,
    scope: ScopeSelector,
  ): Promise<ItVehicleCheckDoc[]> {
    return this.model
      .aggregate<ItVehicleCheckDoc>([
        { $match: this.baseFilter(scope, filter) },
        { $sort: { vehicleId: 1, checkDate: -1, createdAt: -1 } },
        { $group: { _id: '$vehicleId', report: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$report' } },
      ])
      .exec();
  }

  /**
   * The period's figures in ONE pass over the live reports the reader may see under `filter`: how
   * many, by how many people, on which cars, and how many hold no photo (design §7: «the
   * dashboard should show such reports»). The cars come back as ids — at most the fleet's size —
   * for the builder to count among the visible active cars (`carsCheckedOf`).
   */
  async windowFigures(
    filter: FilterQuery<ItVehicleCheckDoc>,
    scope: ScopeSelector,
  ): Promise<VehicleCheckWindowFigures> {
    const [row] = await this.model
      .aggregate<Omit<VehicleCheckWindowFigures, 'vehicleIds'> & { vehicleIds: Types.ObjectId[] }>([
        { $match: this.baseFilter(scope, filter) },
        {
          $group: {
            _id: null,
            reports: { $sum: 1 },
            reporters: { $addToSet: '$reportedByUserId' },
            cars: { $addToSet: '$vehicleId' },
            reportsWithoutPhoto: {
              $sum: { $cond: [{ $eq: [{ $size: { $ifNull: ['$photos', []] } }, 0] }, 1, 0] },
            },
          },
        },
        {
          $project: {
            _id: 0,
            reports: 1,
            reporters: { $size: '$reporters' },
            vehicleIds: '$cars',
            reportsWithoutPhoto: 1,
          },
        },
      ])
      .exec();
    if (row === undefined) {
      return { reports: 0, reporters: 0, vehicleIds: [], reportsWithoutPhoto: 0 };
    }
    return { ...row, vehicleIds: row.vehicleIds.map(String) };
  }

  /**
   * The report a request id already filed — UNSCOPED, and over every row, deleted ones included,
   * as the unique index counts them: an id once filed is that report's, whoever asks and whatever
   * has happened to it since.
   */
  async findByClientRequestId(clientRequestId: string): Promise<ItVehicleCheckDoc | null> {
    return this.model.findOne({ clientRequestId }).lean<ItVehicleCheckDoc>().exec();
  }

  /**
   * The caller's own live report — unscoped, because the reporter's data scope never decides what
   * they may add photos to (design §4). `null` for a missing, deleted or someone else's report,
   * which the caller answers 404 without telling them apart.
   */
  async findOwnLive(id: string, userId: string): Promise<ItVehicleCheckDoc | null> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) return null;
    return this.model
      .findOne({
        _id: new Types.ObjectId(id),
        createdBy: new Types.ObjectId(userId),
        isDeleted: false,
      })
      .lean<ItVehicleCheckDoc>()
      .exec();
  }

  /**
   * Add one photo in ONE atomic conditional update — only if the report is still the caller's,
   * not deleted, under five photos, filed at or after `filedAfter` (the window), and without this
   * `clientPhotoId`. Stamps `updatedBy` and bumps the version. `null` when any condition failed:
   * two racing uploads therefore cannot leave six photos, and the caller re-reads to learn which.
   */
  async pushPhoto(
    id: string,
    userId: string,
    photo: ItVehicleCheckPhotoSub,
    filedAfter: Date,
  ): Promise<ItVehicleCheckDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const by = new Types.ObjectId(userId);
    const filter: FilterQuery<ItVehicleCheckDoc> = {
      _id: new Types.ObjectId(id),
      createdBy: by,
      isDeleted: false,
      // The fifth slot (index 4) still empty: fewer than five photos.
      [`photos.${IT_VEHICLE_CHECK_MAX_PHOTOS - 1}`]: { $exists: false },
      createdAt: { $gte: filedAfter },
      'photos.clientPhotoId': { $ne: photo.clientPhotoId },
    };
    return this.model
      .findOneAndUpdate(
        filter,
        { $push: { photos: photo }, $set: { updatedBy: by }, $inc: { __v: 1 } },
        { new: true },
      )
      .lean<ItVehicleCheckDoc>()
      .exec();
  }
}

export const itVehicleCheckRepository = new ItVehicleCheckRepository();
