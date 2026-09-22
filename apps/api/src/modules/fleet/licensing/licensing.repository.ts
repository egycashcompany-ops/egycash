import { Types } from 'mongoose';
import { type FleetLicensingMark } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  FleetVehicleLicensingModel,
  type FleetVehicleLicensingDoc,
} from './licensing.model';

class FleetVehicleLicensingRepository extends BaseRepository<FleetVehicleLicensingDoc> {
  constructor() {
    // Scope rides the VEHICLES a caller may see, exactly as the fixed crew's row does: the mark
    // itself carries no org placement, and inventing one here would let a branch-scoped clerk see
    // a tick for a car the registry refuses to show them.
    super(FleetVehicleLicensingModel, {});
  }

  /** The marks for a KNOWN set of vehicles — the board's other half, in one query. */
  async findForVehicles(vehicleIds: readonly string[]): Promise<FleetVehicleLicensingDoc[]> {
    if (vehicleIds.length === 0) return [];
    return this.model
      .find({
        isDeleted: false,
        vehicleId: { $in: vehicleIds.map((id) => new Types.ObjectId(id)) },
      })
      .lean<FleetVehicleLicensingDoc[]>()
      .exec();
  }

  /**
   * Set ONE square, creating the row if this is the first thing done to the car.
   *
   * An upsert rather than a read-then-write: the row's existence is an implementation detail of
   * "has anybody ticked anything yet", not a fact the caller should have to establish first, and
   * a read-then-write would race two clerks into two rows for one car — which the unique index
   * would then refuse, turning an ordinary tick into a 409 the clerk cannot act on.
   *
   * `$setOnInsert` carries the three squares this call is NOT setting, so a row born from one
   * tick is still a complete row. Mongo refuses a field in both `$set` and `$setOnInsert`, which
   * is why the mark being written is excluded from the defaults.
   */
  async setMark(
    vehicleId: string,
    mark: FleetLicensingMark,
    value: boolean,
    by: string | null,
  ): Promise<FleetVehicleLicensingDoc> {
    const defaults: Record<string, boolean> = {
      insuranceHandover: false,
      insuranceReceipt: false,
      taxHandover: false,
      taxReceipt: false,
    };
    delete defaults[mark];
    const doc = await this.model
      .findOneAndUpdate(
        { vehicleId: new Types.ObjectId(vehicleId), isDeleted: false },
        {
          $set: {
            [mark]: value,
            updatedBy: by === null ? null : new Types.ObjectId(by),
          },
          $setOnInsert: {
            ...defaults,
            vehicleId: new Types.ObjectId(vehicleId),
            schemaVersion: 1,
            isDeleted: false,
            deletedAt: null,
            deletedBy: null,
            createdBy: by === null ? null : new Types.ObjectId(by),
          },
        },
        { new: true, upsert: true },
      )
      .lean<FleetVehicleLicensingDoc>()
      .exec();
    return doc;
  }

  /**
   * VOID a car's papers — «لو رجعت كل العلامات تتشال».
   *
   * A soft delete rather than four `false`s. The row is what a clerk DID, and the house rule is
   * that deleted data leaves the screen and stays in the database («الداتا اللى ممسوحه متظهرش
   * للمستخدم تبقى فى الداتا بيز فقط»); flipping the booleans would overwrite the record of a
   * completed errand with something indistinguishable from an errand never started.
   *
   * It is also what makes a return to the board start CLEAN without any special case: the unique
   * index is partial on `isDeleted: false` and so is the upsert's filter, so the next tick writes
   * a brand-new row beside the retired one rather than reviving it.
   *
   * Returns how many rows it retired, so callers can stay silent when there was nothing to void —
   * which is the ordinary case for a car nobody had ticked anything for.
   */
  async voidForVehicles(vehicleIds: readonly string[], by: string | null): Promise<number> {
    if (vehicleIds.length === 0) return 0;
    const result = await this.model
      .updateMany(
        {
          isDeleted: false,
          vehicleId: { $in: vehicleIds.map((id) => new Types.ObjectId(id)) },
        },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: by === null ? null : new Types.ObjectId(by),
          },
        },
      )
      .exec();
    return result.modifiedCount;
  }

  /** The vehicles that still hold live marks — the sweep's candidates, and nothing else. */
  async markedVehicleIds(): Promise<string[]> {
    const rows = await this.model
      .find({ isDeleted: false })
      .select({ vehicleId: 1 })
      .lean<{ vehicleId: Types.ObjectId }[]>()
      .exec();
    return rows.map((row) => String(row.vehicleId));
  }
}

export const fleetVehicleLicensingRepository = new FleetVehicleLicensingRepository();
