// The landing screen's aggregates, computed in the database.
//
// Every question here is "how many / how much, grouped by something" over a collection that
// outgrows a page: cars per type per branch, kilometres per branch, the five highest and the five
// lowest. Answering any of them from the list endpoints would mean one request per cell and a
// `MAX_PAGE_SIZE` ceiling in front of a fleet of hundreds, so each is one pipeline that returns
// only the counted rows.
//
// SCOPE IS PASSED IN, never assumed. A branch-scoped reader sees their branch's fleet and nothing
// else — the same `scopeFilter` every fleet list already applies, reached through the repository
// that owns each collection rather than re-implemented here.
import { type Types } from 'mongoose';
import { FleetVehicleModel } from '../vehicles/vehicle.model';
import { FleetDriverProfileModel } from '../driver-profiles/driver-profile.model';
import { FleetOdometerLogModel } from '../odometer/odometer.model';
import { FleetMaintenanceVisitModel } from '../maintenance/maintenance.model';
import { FleetAccidentModel } from '../accidents/accident.model';

export interface TypeBranchCount {
  typeId: string;
  branchId: string | null;
  count: number;
}

export interface OperationBranchCount {
  operationId: string | null;
  branchId: string | null;
  count: number;
}

export interface VehicleKm {
  vehicleId: string;
  branchId: string | null;
  code: string;
  km: number;
}

class FleetDashboardRepository {
  /** Active vehicles, counted per (type, branch) — the matrix, in one pass. */
  async vehiclesByTypeAndBranch(match: Record<string, unknown>): Promise<TypeBranchCount[]> {
    const rows = await FleetVehicleModel.aggregate<{
      _id: { typeId: Types.ObjectId; branchId: Types.ObjectId | null };
      count: number;
    }>([
      { $match: { isDeleted: false, status: 'active', ...match } },
      { $group: { _id: { typeId: '$typeId', branchId: '$branchId' }, count: { $sum: 1 } } },
    ]);
    return rows.map((row) => ({
      typeId: String(row._id.typeId),
      branchId: row._id.branchId === null ? null : String(row._id.branchId),
      count: row.count,
    }));
  }

  /**
   * Active vehicles per (operation, branch) — what «نقل أموال» and «ATM» are counted from.
   *
   * The operation is the registry's own `operation` catalog reference. Vehicles that carry none
   * group under `null` and are counted in the branch total without landing in either split, which
   * is the honest answer for a car nobody has classified.
   */
  async vehiclesByOperationAndBranch(
    match: Record<string, unknown>,
  ): Promise<OperationBranchCount[]> {
    const rows = await FleetVehicleModel.aggregate<{
      _id: { operationId: Types.ObjectId | null; branchId: Types.ObjectId | null };
      count: number;
    }>([
      { $match: { isDeleted: false, status: 'active', ...match } },
      {
        $group: {
          _id: { operationId: '$operationId', branchId: '$branchId' },
          count: { $sum: 1 },
        },
      },
    ]);
    return rows.map((row) => ({
      operationId: row._id.operationId === null ? null : String(row._id.operationId),
      branchId: row._id.branchId === null ? null : String(row._id.branchId),
      count: row.count,
    }));
  }

  /**
   * Live driver profiles, by specialization — the employee they belong to is resolved above.
   *
   * BOTH classifications come back. «التخصص» is a catalog reference now, and the legacy enum is
   * what a profile nobody has re-classified still carries; the caller prefers the first and falls
   * back to the second, so this split keeps answering for the whole registry rather than for the
   * part that has been through the new form.
   */
  async activeDriverProfiles(): Promise<
    { employeeId: string; specializationId: string | null; specialization: string | null }[]
  > {
    const rows = await FleetDriverProfileModel.find(
      { isDeleted: false, isActive: true },
      { employeeId: 1, specializationId: 1, specialization: 1 },
    )
      .lean<
        {
          employeeId: Types.ObjectId;
          specializationId?: Types.ObjectId | null;
          specialization?: string | null;
        }[]
      >()
      .exec();
    return rows.map((row) => ({
      employeeId: String(row.employeeId),
      specializationId: row.specializationId == null ? null : String(row.specializationId),
      specialization: row.specialization ?? null,
    }));
  }

  /**
   * Distance per vehicle: the SUM of the `km` the server derived for each closed period.
   *
   * `km` is `inReading − outReading` of one row, written by the odometer service and never by a
   * client, so summing it is summing measured distance rather than differencing two readings that
   * may belong to different eras of the same car. An open period contributes nothing — it has no
   * distance yet, which is exactly why `km` is null there.
   */
  async kilometresByVehicle(match: Record<string, unknown>): Promise<VehicleKm[]> {
    const vehicles = await FleetVehicleModel.find(
      { isDeleted: false, status: 'active', ...match },
      { code: 1, branchId: 1 },
    )
      .lean<{ _id: Types.ObjectId; code: string; branchId: Types.ObjectId | null }[]>()
      .exec();
    if (vehicles.length === 0) return [];
    const ids = vehicles.map((v) => v._id);
    const sums = await FleetOdometerLogModel.aggregate<{ _id: Types.ObjectId; km: number }>([
      { $match: { isDeleted: false, vehicleId: { $in: ids }, km: { $ne: null } } },
      { $group: { _id: '$vehicleId', km: { $sum: '$km' } } },
    ]);
    const byVehicle = new Map(sums.map((row) => [String(row._id), row.km]));
    // Every active vehicle appears, including the ones that have driven nothing: «أقل ٥ سيارات»
    // is precisely a question about those, and omitting them would answer it with the wrong cars.
    return vehicles.map((v) => ({
      vehicleId: String(v._id),
      branchId: v.branchId === null ? null : String(v.branchId),
      code: v.code,
      km: byVehicle.get(String(v._id)) ?? 0,
    }));
  }

  /** Visits that STARTED in the window — the strip's «صيانات اليوم» and the month's tally. */
  async visitsBetween(
    from: Date,
    to: Date,
    match: Record<string, unknown>,
    limit: number,
  ): Promise<
    {
      _id: Types.ObjectId;
      vehicleId: Types.ObjectId;
      workshopId: Types.ObjectId;
      workTypeId: Types.ObjectId;
      sparePartIds: Types.ObjectId[];
      notes: string | null;
    }[]
  > {
    return FleetMaintenanceVisitModel.find(
      { isDeleted: false, inDate: { $gte: from, $lt: to }, ...match },
      { vehicleId: 1, workshopId: 1, workTypeId: 1, sparePartIds: 1, notes: 1 },
    )
      .sort({ inDate: -1, _id: -1 })
      .limit(limit)
      .lean<
        {
          _id: Types.ObjectId;
          vehicleId: Types.ObjectId;
          workshopId: Types.ObjectId;
          workTypeId: Types.ObjectId;
          sparePartIds: Types.ObjectId[];
          notes: string | null;
        }[]
      >()
      .exec();
  }

  async countVisitsBetween(
    from: Date,
    to: Date,
    match: Record<string, unknown>,
  ): Promise<number> {
    return FleetMaintenanceVisitModel.countDocuments({
      isDeleted: false,
      inDate: { $gte: from, $lt: to },
      ...match,
    });
  }

  async accidentsBetween(
    from: Date,
    to: Date,
    match: Record<string, unknown>,
    limit: number,
  ): Promise<
    {
      _id: Types.ObjectId;
      vehicleId: Types.ObjectId;
      occurredAt: Date;
      culprit: string | null;
      status: string;
    }[]
  > {
    return FleetAccidentModel.find(
      { isDeleted: false, occurredAt: { $gte: from, $lt: to }, ...match },
      { vehicleId: 1, occurredAt: 1, culprit: 1, status: 1 },
    )
      .sort({ occurredAt: -1, _id: -1 })
      .limit(limit)
      .lean<
        {
          _id: Types.ObjectId;
          vehicleId: Types.ObjectId;
          occurredAt: Date;
          culprit: string | null;
          status: string;
        }[]
      >()
      .exec();
  }

  async countAccidentsBetween(
    from: Date,
    to: Date,
    match: Record<string, unknown>,
  ): Promise<number> {
    return FleetAccidentModel.countDocuments({
      isDeleted: false,
      occurredAt: { $gte: from, $lt: to },
      ...match,
    });
  }

  /** Active vehicles whose licence expires before `before`, soonest first. */
  async dueLicenses(
    before: Date,
    match: Record<string, unknown>,
    limit: number,
  ): Promise<
    {
      _id: Types.ObjectId;
      code: string;
      branchId: Types.ObjectId | null;
      licenseExpiresAt: Date;
    }[]
  > {
    return FleetVehicleModel.find(
      { isDeleted: false, status: 'active', licenseExpiresAt: { $lt: before }, ...match },
      { code: 1, branchId: 1, licenseExpiresAt: 1 },
    )
      .sort({ licenseExpiresAt: 1, _id: 1 })
      .limit(limit)
      .lean<
        {
          _id: Types.ObjectId;
          code: string;
          branchId: Types.ObjectId | null;
          licenseExpiresAt: Date;
        }[]
      >()
      .exec();
  }
}

export const fleetDashboardRepository = new FleetDashboardRepository();
