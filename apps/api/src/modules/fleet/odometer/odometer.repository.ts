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

  /**
   * The list filter.
   *
   * `vehicleIds` arrives already RESOLVED by the service — from codes, from an alarm-level
   * narrowing, or from both intersected — because both of those need collections this repository
   * does not own. An EMPTY array is a real answer meaning "nothing matched", and it must produce
   * an empty page rather than an unfiltered one, so it is passed to `$in` as-is.
   */
  logFilter(query: {
    vehicleId?: string | undefined;
    vehicleIds?: readonly string[] | undefined;
    driverEmployeeIds?: readonly string[] | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): FilterQuery<FleetOdometerLogDoc> {
    const clauses: FilterQuery<FleetOdometerLogDoc>[] = [];
    if (query.vehicleId !== undefined) {
      clauses.push({ vehicleId: new Types.ObjectId(query.vehicleId) });
    }
    if (query.vehicleIds !== undefined) {
      clauses.push({ vehicleId: { $in: query.vehicleIds.map((id) => new Types.ObjectId(id)) } });
    }
    if (query.driverEmployeeIds !== undefined) {
      // EITHER slot. "Which days did this person drive?" is one question, and answering it only
      // for the morning shift would silently drop half the days they actually worked.
      const ids = query.driverEmployeeIds.map((id) => new Types.ObjectId(id));
      clauses.push({
        $or: [{ driver1EmployeeId: { $in: ids } }, { driver2EmployeeId: { $in: ids } }],
      });
    }
    if (query.from !== undefined) clauses.push({ date: { $gte: query.from } });
    if (query.to !== undefined) {
      // The WHOLE of that day. `to` arrives as a date and reads as one — "up to the 18th" — but
      // `$lte` against a bare date is midnight, so a reading stored with any time on the 18th
      // fell outside it. That also made the single-day case (from = to) match only readings
      // saved at exactly 00:00. Compared against the next midnight instead, so the bound covers
      // the day it names without depending on how precisely the reading was stamped.
      const dayAfter = new Date(query.to);
      dayAfter.setUTCHours(0, 0, 0, 0);
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      clauses.push({ date: { $lt: dayAfter } });
    }
    return clauses.length === 0 ? {} : { $and: clauses };
  }
}

export const fleetOdometerRepository = new FleetOdometerRepository();
