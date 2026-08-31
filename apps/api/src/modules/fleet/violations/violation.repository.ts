import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import {
  FleetGrievanceModel,
  FleetViolationModel,
  type FleetGrievanceDoc,
  type FleetViolationDoc,
} from './violation.model';

/** Per-vehicle sums for one year — the aggregate half of the FR-9 rollup. */
export interface ViolationYearSums {
  vehicleId: string;
  vehicleCount: number;
  vehicleAmount: number;
  driverCount: number;
  driverAmount: number;
}

class FleetViolationRepository extends BaseRepository<FleetViolationDoc> {
  constructor() {
    super(FleetViolationModel, {});
  }

  async listViolations(
    params: ListParams<FleetViolationDoc>,
  ): Promise<Paginated<FleetViolationDoc>> {
    return this.list({ ...params, sortableFields: ['year', 'date', 'createdAt'] });
  }

  violationFilter(query: {
    kind?: string | undefined;
    vehicleId?: string | undefined;
    /**
     * What the vehicle-code picker resolved to — see `accident.repository`, which draws the same
     * line for the same reason. `[]` is a real answer (codes no car carries) and narrows to
     * NOTHING; it is never dropped, or an impossible search would return every violation.
     */
    vehicleIds?: readonly string[] | undefined;
    driverEmployeeId?: string | undefined;
    year?: number | undefined;
  }): FilterQuery<FleetViolationDoc> {
    const clauses: FilterQuery<FleetViolationDoc>[] = [];
    if (query.kind !== undefined) clauses.push({ kind: query.kind });
    if (query.vehicleId !== undefined) {
      clauses.push({ vehicleId: new Types.ObjectId(query.vehicleId) });
    }
    if (query.vehicleIds !== undefined) {
      clauses.push({ vehicleId: { $in: query.vehicleIds.map((id) => new Types.ObjectId(id)) } });
    }
    if (query.driverEmployeeId !== undefined) {
      clauses.push({ driverEmployeeId: new Types.ObjectId(query.driverEmployeeId) });
    }
    if (query.year !== undefined) {
      // The year filter means the same thing for BOTH shapes: vehicle rows carry it stored,
      // driver rows carry it as the year of their event date (§2.9 — no synthesized dates).
      clauses.push(FleetViolationRepository.yearClause(query.year));
    }
    return clauses.length === 0 ? {} : { $and: clauses };
  }

  private static yearClause(year: number): FilterQuery<FleetViolationDoc> {
    return {
      $or: [
        { kind: 'vehicle', year },
        {
          kind: 'driver',
          date: { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) },
        },
      ],
    };
  }

  /**
   * The §2.9 annual rollup's aggregate half: per-vehicle sums of both shapes for one year.
   * `vehicleCount` sums the statement rows' `count` (a row saying 5 × 100 IS five violations);
   * `driverCount` counts events. Derived at query time — nothing here is ever stored.
   */
  async yearSums(year: number, vehicleId?: string): Promise<ViolationYearSums[]> {
    const match: FilterQuery<FleetViolationDoc> = {
      isDeleted: false,
      ...FleetViolationRepository.yearClause(year),
    };
    if (vehicleId !== undefined) match['vehicleId'] = new Types.ObjectId(vehicleId);
    const rows = await this.model.aggregate<{
      _id: Types.ObjectId;
      vehicleCount: number;
      vehicleAmount: number;
      driverCount: number;
      driverAmount: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: '$vehicleId',
          vehicleCount: {
            $sum: { $cond: [{ $eq: ['$kind', 'vehicle'] }, { $ifNull: ['$count', 0] }, 0] },
          },
          vehicleAmount: { $sum: { $cond: [{ $eq: ['$kind', 'vehicle'] }, '$amount', 0] } },
          driverCount: { $sum: { $cond: [{ $eq: ['$kind', 'driver'] }, 1, 0] } },
          driverAmount: { $sum: { $cond: [{ $eq: ['$kind', 'driver'] }, '$amount', 0] } },
        },
      },
    ]);
    return rows.map((row) => ({
      vehicleId: String(row._id),
      vehicleCount: row.vehicleCount,
      vehicleAmount: row.vehicleAmount,
      driverCount: row.driverCount,
      driverAmount: row.driverAmount,
    }));
  }
}

class FleetGrievanceRepository extends BaseRepository<FleetGrievanceDoc> {
  constructor() {
    super(FleetGrievanceModel, {});
  }

  async findByVehicleAndYear(vehicleId: string, year: number): Promise<FleetGrievanceDoc | null> {
    return this.model
      .findOne({ vehicleId: new Types.ObjectId(vehicleId), year, isDeleted: false })
      .lean<FleetGrievanceDoc>()
      .exec();
  }

  async forYear(year: number, vehicleId?: string): Promise<FleetGrievanceDoc[]> {
    const filter: FilterQuery<FleetGrievanceDoc> = { year, isDeleted: false };
    if (vehicleId !== undefined) filter.vehicleId = new Types.ObjectId(vehicleId);
    return this.model.find(filter).lean<FleetGrievanceDoc[]>().exec();
  }
}

export const fleetViolationRepository = new FleetViolationRepository();
export const fleetGrievanceRepository = new FleetGrievanceRepository();
