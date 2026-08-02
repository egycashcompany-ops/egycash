import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { FleetMaintenanceVisitModel, type FleetMaintenanceVisitDoc } from './maintenance.model';

export interface AlarmBaseline {
  vehicleId: string;
  odometerAtService: number;
  serviceDate: Date;
}

class FleetMaintenanceRepository extends BaseRepository<FleetMaintenanceVisitDoc> {
  constructor() {
    super(FleetMaintenanceVisitModel, {});
  }

  async findOpen(vehicleId: string): Promise<FleetMaintenanceVisitDoc | null> {
    return this.model
      .findOne({ vehicleId: new Types.ObjectId(vehicleId), outDate: null, isDeleted: false })
      .lean<FleetMaintenanceVisitDoc>()
      .exec();
  }

  /** Vehicles with an OPEN visit — FR-12's derived `inWorkshop`, FR-5's roster exclusion. */
  async openVisitVehicleIds(vehicleIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (vehicleIds.length === 0) return new Set();
    const rows = await this.model
      .find(
        {
          vehicleId: { $in: vehicleIds.map((id) => new Types.ObjectId(id)) },
          outDate: null,
          isDeleted: false,
        },
        { vehicleId: 1 },
      )
      .lean<{ vehicleId: Types.ObjectId }[]>()
      .exec();
    return new Set(rows.map((row) => String(row.vehicleId)));
  }

  /**
   * The alarm baseline per vehicle (owner FL-4 point 5): the latest CLOSED visit whose work type
   * counts for the alarm. An open visit is not a baseline — the cycle resets when the car comes
   * BACK, with the counter that was recorded for the service.
   */
  async alarmBaselines(
    vehicleIds: readonly string[],
    countingWorkTypeIds: readonly string[],
  ): Promise<Map<string, AlarmBaseline>> {
    if (vehicleIds.length === 0 || countingWorkTypeIds.length === 0) return new Map();
    const rows = await this.model.aggregate<{
      _id: Types.ObjectId;
      odometerAtService: number;
      outDate: Date;
    }>([
      {
        $match: {
          vehicleId: { $in: vehicleIds.map((id) => new Types.ObjectId(id)) },
          workTypeId: { $in: countingWorkTypeIds.map((id) => new Types.ObjectId(id)) },
          outDate: { $ne: null },
          isDeleted: false,
        },
      },
      { $sort: { vehicleId: 1, outDate: -1 } },
      {
        $group: {
          _id: '$vehicleId',
          odometerAtService: { $first: '$odometerAtService' },
          outDate: { $first: '$outDate' },
        },
      },
    ]);
    return new Map(
      rows.map((row) => [
        String(row._id),
        {
          vehicleId: String(row._id),
          odometerAtService: row.odometerAtService,
          serviceDate: row.outDate,
        },
      ]),
    );
  }

  async listVisits(
    params: ListParams<FleetMaintenanceVisitDoc>,
  ): Promise<Paginated<FleetMaintenanceVisitDoc>> {
    return this.list({ ...params, sortableFields: ['inDate', 'outDate', 'createdAt'] });
  }

  visitFilter(query: {
    vehicleId?: string | undefined;
    open?: boolean | undefined;
    workshopId?: string | undefined;
    workTypeId?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): FilterQuery<FleetMaintenanceVisitDoc> {
    const clauses: FilterQuery<FleetMaintenanceVisitDoc>[] = [];
    if (query.vehicleId !== undefined) {
      clauses.push({ vehicleId: new Types.ObjectId(query.vehicleId) });
    }
    if (query.open !== undefined) {
      clauses.push(query.open ? { outDate: null } : { outDate: { $ne: null } });
    }
    if (query.workshopId !== undefined) {
      clauses.push({ workshopId: new Types.ObjectId(query.workshopId) });
    }
    if (query.workTypeId !== undefined) {
      clauses.push({ workTypeId: new Types.ObjectId(query.workTypeId) });
    }
    if (query.from !== undefined) clauses.push({ inDate: { $gte: query.from } });
    if (query.to !== undefined) clauses.push({ inDate: { $lte: query.to } });
    return clauses.length === 0 ? {} : { $and: clauses };
  }
}

export const fleetMaintenanceRepository = new FleetMaintenanceRepository();
