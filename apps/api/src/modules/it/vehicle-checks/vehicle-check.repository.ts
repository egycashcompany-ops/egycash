import { Types, type FilterQuery } from 'mongoose';
import { IT_VEHICLE_CHECK_MAX_PHOTOS } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { collectionReady } from '../mobile-lines/ensure-collection';
import {
  ItVehicleCheckModel,
  type ItVehicleCheckDoc,
  type ItVehicleCheckPhotoSub,
} from './vehicle-check.model';

class ItVehicleCheckRepository extends BaseRepository<ItVehicleCheckDoc> {
  /** The unique request-id index has to exist before the first report, as `autoIndex` is off. */
  readonly ensureCollection = collectionReady(ItVehicleCheckModel);

  constructor() {
    // The data-scope anchor for the readers the dashboard brings: the car's branch at filing. No
    // `ownerUserField` — the default `own` scope already matches `createdBy`, the reporter.
    super(ItVehicleCheckModel, { branchField: 'branchId' });
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
