import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { FleetOdometerLogModel, type FleetOdometerLogDoc } from './odometer.model';

export interface LatestReading {
  vehicleId: string;
  /** max(outReading, inReading) of the newest entry — the vehicle's latest known reading. */
  reading: number;
  date: Date;
}

class FleetOdometerRepository extends BaseRepository<FleetOdometerLogDoc> {
  constructor() {
    super(FleetOdometerLogModel, {});
  }

  async findOpen(vehicleId: string, session?: ClientSession): Promise<FleetOdometerLogDoc | null> {
    return this.model
      .findOne({ vehicleId: new Types.ObjectId(vehicleId), inReading: null, isDeleted: false })
      .session(session ?? null)
      .lean<FleetOdometerLogDoc>()
      .exec();
  }

  async findLatest(
    vehicleId: string,
    session?: ClientSession,
  ): Promise<FleetOdometerLogDoc | null> {
    return this.model
      .findOne({ vehicleId: new Types.ObjectId(vehicleId), isDeleted: false })
      .sort({ outReading: -1 })
      .session(session ?? null)
      .lean<FleetOdometerLogDoc>()
      .exec();
  }

  /** Chain neighbors of an entry, by reading order (correction flow, §4.3). */
  async findNeighbors(
    entry: FleetOdometerLogDoc,
    session?: ClientSession,
  ): Promise<{ prev: FleetOdometerLogDoc | null; next: FleetOdometerLogDoc | null }> {
    const base = { vehicleId: entry.vehicleId, isDeleted: false, _id: { $ne: entry._id } };
    const [prev, next] = await Promise.all([
      this.model
        .findOne({ ...base, outReading: { $lt: entry.outReading } })
        .sort({ outReading: -1 })
        .session(session ?? null)
        .lean<FleetOdometerLogDoc>()
        .exec(),
      this.model
        .findOne({ ...base, outReading: { $gt: entry.outReading } })
        .sort({ outReading: 1 })
        .session(session ?? null)
        .lean<FleetOdometerLogDoc>()
        .exec(),
    ]);
    return { prev, next };
  }

  /** Newest entry per vehicle in one pass — the alarm engine's read (§4.4). */
  async latestReadings(vehicleIds: readonly string[]): Promise<Map<string, LatestReading>> {
    if (vehicleIds.length === 0) return new Map();
    const rows = await this.model.aggregate<{
      _id: Types.ObjectId;
      outReading: number;
      inReading: number | null;
      date: Date;
    }>([
      {
        $match: {
          vehicleId: { $in: vehicleIds.map((id) => new Types.ObjectId(id)) },
          isDeleted: false,
        },
      },
      { $sort: { vehicleId: 1, outReading: -1 } },
      {
        $group: {
          _id: '$vehicleId',
          outReading: { $first: '$outReading' },
          inReading: { $first: '$inReading' },
          date: { $first: '$date' },
        },
      },
    ]);
    return new Map(
      rows.map((row) => [
        String(row._id),
        {
          vehicleId: String(row._id),
          reading: Math.max(row.outReading, row.inReading ?? row.outReading),
          date: row.date,
        },
      ]),
    );
  }

  async listLogs(params: ListParams<FleetOdometerLogDoc>): Promise<Paginated<FleetOdometerLogDoc>> {
    return this.list({ ...params, sortableFields: ['date', 'outReading', 'createdAt'] });
  }

  logFilter(query: {
    vehicleId?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): FilterQuery<FleetOdometerLogDoc> {
    const clauses: FilterQuery<FleetOdometerLogDoc>[] = [];
    if (query.vehicleId !== undefined) {
      clauses.push({ vehicleId: new Types.ObjectId(query.vehicleId) });
    }
    if (query.from !== undefined) clauses.push({ date: { $gte: query.from } });
    if (query.to !== undefined) clauses.push({ date: { $lte: query.to } });
    return clauses.length === 0 ? {} : { $and: clauses };
  }
}

export const fleetOdometerRepository = new FleetOdometerRepository();
