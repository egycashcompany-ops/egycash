import { Types, type ClientSession, type FilterQuery } from 'mongoose';
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
  /** The year the row belongs to: a statement row's own, a driver row's from its date. */
  year: number;
  vehicleCount: number;
  vehicleAmount: number;
  driverCount: number;
  driverAmount: number;
  /** Documents in the group, and how many of them are ticked — the board's group tick reads these. */
  rowCount: number;
  collectedCount: number;
}

class FleetViolationRepository extends BaseRepository<FleetViolationDoc> {
  constructor() {
    super(FleetViolationModel, {});
  }

  /**
   * Several rows in ONE insert, inside the caller's transaction.
   *
   * `create` one at a time would be several round trips and — worse — several separate writes:
   * the drivers' bar files a vehicle's fines as one act, so they land together or not at all.
   * Stamps `createdBy`/`updatedBy` exactly as `create` does; the model's own defaults fill the
   * rest, so a row written here is indistinguishable from one written singly.
   */
  async createMany(
    rows: readonly Partial<FleetViolationDoc>[],
    meta: { by: string | null; session?: ClientSession },
  ): Promise<FleetViolationDoc[]> {
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    const docs = await FleetViolationModel.create(
      rows.map((row) => ({ ...row, createdBy: by, updatedBy: by })),
      { session: meta.session ?? null, ordered: true },
    );
    return docs.map((doc) => doc.toObject() as FleetViolationDoc);
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
    /** Several drivers, ORed. `[]` narrows to nothing, exactly as `vehicleIds` does. */
    driverEmployeeId?: readonly string[] | undefined;
    /** The EXACT filed amount. `0` is a real answer, so this is checked against `undefined`. */
    amount?: number | undefined;
    /** Which catalog kinds of violation, ORed. `[]` narrows to nothing, as `vehicleIds` does. */
    violationTypeId?: readonly string[] | undefined;
    /** Settled or not. `false` is a real answer, so this is checked against `undefined`. */
    collected?: boolean | undefined;
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
      clauses.push({
        driverEmployeeId: { $in: query.driverEmployeeId.map((id) => new Types.ObjectId(id)) },
      });
    }
    if (query.amount !== undefined) clauses.push({ amount: query.amount });
    if (query.collected !== undefined) clauses.push({ collected: query.collected });
    if (query.violationTypeId !== undefined) {
      clauses.push({
        violationTypeId: { $in: query.violationTypeId.map((id) => new Types.ObjectId(id)) },
      });
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
  /**
   * Tick or untick EVERY row of one (vehicle, year).
   *
   * One statement rather than a loop of per-row writes: the board's tick is a single decision about
   * a single group, and a partial failure halfway through a loop would leave a group in exactly the
   * mixed state the tick exists to resolve.
   */
  async setCollectedForYear(vehicleId: string, year: number, collected: boolean): Promise<number> {
    const result = await this.model.updateMany(
      {
        isDeleted: false,
        vehicleId: new Types.ObjectId(vehicleId),
        ...FleetViolationRepository.yearClause(year),
      },
      { $set: { collected } },
    );
    return result.modifiedCount;
  }

  async yearSums(year: number | undefined, vehicleId?: string): Promise<ViolationYearSums[]> {
    const match: FilterQuery<FleetViolationDoc> = {
      isDeleted: false,
      ...(year === undefined ? {} : FleetViolationRepository.yearClause(year)),
    };
    if (vehicleId !== undefined) match['vehicleId'] = new Types.ObjectId(vehicleId);
    const rows = await this.model.aggregate<{
      _id: { vehicleId: Types.ObjectId; year: number };
      vehicleCount: number;
      vehicleAmount: number;
      driverCount: number;
      driverAmount: number;
      rowCount: number;
      collectedCount: number;
    }>([
      { $match: match },
      {
        $group: {
          // The two shapes carry their year differently — a statement row stores it, a driver row
          // implies it through the event date — so the grouping key derives one from the other.
          // UTC, the same boundary `yearClause` filters on, so narrowing and grouping agree.
          _id: {
            vehicleId: '$vehicleId',
            year: { $ifNull: ['$year', { $year: { date: '$date', timezone: 'UTC' } }] },
          },
          vehicleCount: {
            $sum: { $cond: [{ $eq: ['$kind', 'vehicle'] }, { $ifNull: ['$count', 0] }, 0] },
          },
          vehicleAmount: { $sum: { $cond: [{ $eq: ['$kind', 'vehicle'] }, '$amount', 0] } },
          driverCount: { $sum: { $cond: [{ $eq: ['$kind', 'driver'] }, 1, 0] } },
          driverAmount: { $sum: { $cond: [{ $eq: ['$kind', 'driver'] }, '$amount', 0] } },
          // ROWS, not fines: a statement row of «×5» is one row that is collected or not, so the
          // group's tick counts documents rather than the `count` on them.
          rowCount: { $sum: 1 },
          collectedCount: { $sum: { $cond: ['$collected', 1, 0] } },
        },
      },
    ]);
    return rows.map((row) => ({
      vehicleId: String(row._id.vehicleId),
      year: row._id.year,
      vehicleCount: row.vehicleCount,
      vehicleAmount: row.vehicleAmount,
      driverCount: row.driverCount,
      driverAmount: row.driverAmount,
      rowCount: row.rowCount,
      collectedCount: row.collectedCount,
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

  async forYear(year: number | undefined, vehicleId?: string): Promise<FleetGrievanceDoc[]> {
    const filter: FilterQuery<FleetGrievanceDoc> = {
      isDeleted: false,
      ...(year === undefined ? {} : { year }),
    };
    if (vehicleId !== undefined) filter.vehicleId = new Types.ObjectId(vehicleId);
    return this.model.find(filter).lean<FleetGrievanceDoc[]>().exec();
  }
}

export const fleetViolationRepository = new FleetViolationRepository();
export const fleetGrievanceRepository = new FleetGrievanceRepository();
