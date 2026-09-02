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

/** One end of the bracket: a reading and the date it was taken on. */
export interface ChainBound {
  reading: number;
  date: Date;
}

/**
 * The chain's order, as a TOTAL order.
 *
 * `outReading` alone does not order the chain: FR-2 refuses a new reading BELOW the floor and
 * accepts one equal to it, so two rows can legitimately share a value. MongoDB's sort is not
 * stable, so at that point "the latest reading" — and the DATE that travels with it — became
 * whichever row the server happened to return. `_id` is monotonic per insert, so it settles the
 * tie the way the chain was actually written, and every query that picks "the highest" uses this
 * same order rather than a private one.
 */
const NEWEST_FIRST = { outReading: -1, _id: -1 } as const;

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
      .sort(NEWEST_FIRST)
      .session(session ?? null)
      .lean<FleetOdometerLogDoc>()
      .exec();
  }

  /** Chain neighbors of an entry, by reading order (correction flow, §4.3). */
  async findNeighbors(
    entry: FleetOdometerLogDoc,
    session?: ClientSession,
  ): Promise<{ prev: FleetOdometerLogDoc | null; next: FleetOdometerLogDoc | null }> {
    // Strictly-lower / strictly-higher WOULD skip a row that ties this one's value, leaving a
    // tied pair with no relationship in either direction — so the comparison falls back to `_id`
    // at equal readings, which is the same total order `NEWEST_FIRST` imposes.
    const base = { vehicleId: entry.vehicleId, isDeleted: false };
    const lower = {
      $or: [
        { outReading: { $lt: entry.outReading } },
        { outReading: entry.outReading, _id: { $lt: entry._id } },
      ],
    };
    const higher = {
      $or: [
        { outReading: { $gt: entry.outReading } },
        { outReading: entry.outReading, _id: { $gt: entry._id } },
      ],
    };
    const [prev, next] = await Promise.all([
      this.model
        .findOne({ ...base, ...lower })
        .sort({ outReading: -1, _id: -1 })
        .session(session ?? null)
        .lean<FleetOdometerLogDoc>()
        .exec(),
      this.model
        .findOne({ ...base, ...higher })
        .sort({ outReading: 1, _id: 1 })
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
      { $sort: { vehicleId: 1, outReading: -1, _id: -1 } },
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

  /**
   * Midnight UTC of the day AFTER `on` — the exclusive end of the day `on` names.
   *
   * Both a visit date and a reading date arrive as `<input type="date">` → midnight UTC, so a
   * bare `$lte` would already cover them; the next midnight is used for the same reason
   * `logFilter`'s `to` bound is, so a reading stamped with a TIME on that day still counts as
   * that day rather than falling through to the following one and reading as "later".
   */
  private static dayAfter(on: Date): Date {
    const end = new Date(on);
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + 1);
    return end;
  }

  /**
   * The two bounds a counter measured on `on` would have to sit between to be a point on this
   * vehicle's chain: the highest reading dated on or before that day, and the lowest dated after
   * it. Either may be absent, and an absent bound constrains nothing — a car whose first reading
   * comes after its service has no lower bound, one not read since has no upper bound.
   *
   * Two indexed look-ups rather than one aggregate, because the two questions are not symmetric.
   *
   * BOTH SIDES READ `outReading` ONLY, AND THAT IS THE WHOLE SUBTLETY. A row's `inReading` is not
   * a reading taken on that row's date — it is the SHARED reading that opens the next period, so
   * it was measured on the NEXT row's date. `latestReadings` is right to take `max(out, in)`,
   * because it asks "how far has this car got?" and has no date bound at all. Here the question
   * is bounded BY a date, and folding in `inReading` would import a future reading into the past:
   * a car read at 100,000 on the 1st and 400,000 on the 1st of next month has one row dated the
   * 1st carrying both numbers, and asking for the bracket mid-month must answer 100,000.
   *
   * Nothing is lost by dropping it. That shared reading belongs to the row that opens with it,
   * and that row is dated after the boundary — so the upper look-up finds the very same number.
   */
  async chainBounds(
    vehicleId: string,
    on: Date,
  ): Promise<{ lower: ChainBound | null; upper: ChainBound | null }> {
    const end = FleetOdometerRepository.dayAfter(on);
    const base = { vehicleId: new Types.ObjectId(vehicleId), isDeleted: false };
    const [early, late] = await Promise.all([
      this.model
        .findOne({ ...base, date: { $lt: end } })
        .sort(NEWEST_FIRST)
        .lean<FleetOdometerLogDoc>()
        .exec(),
      this.model
        .findOne({ ...base, date: { $gte: end } })
        .sort({ outReading: 1, _id: 1 })
        .lean<FleetOdometerLogDoc>()
        .exec(),
    ]);
    return {
      lower: early === null ? null : { reading: early.outReading, date: early.date },
      upper: late === null ? null : { reading: late.outReading, date: late.date },
    };
  }

  /**
   * The LOWER bound for many vehicles at once, each against its OWN date — the alarm projection's
   * read, where a per-vehicle round trip would be one query per car in the fleet.
   *
   * Only the lower side: the projection already holds each vehicle's latest reading, which is the
   * tightest upper bound available to it without a second pass.
   */
  async lowerBoundsAt(
    pairs: readonly { vehicleId: string; on: Date }[],
  ): Promise<Map<string, ChainBound>> {
    if (pairs.length === 0) return new Map();
    const rows = await this.model.aggregate<{
      _id: Types.ObjectId;
      outReading: number;
      date: Date;
    }>([
      {
        $match: {
          isDeleted: false,
          $or: pairs.map((pair) => ({
            vehicleId: new Types.ObjectId(pair.vehicleId),
            date: { $lt: FleetOdometerRepository.dayAfter(pair.on) },
          })),
        },
      },
      { $sort: { vehicleId: 1, outReading: -1, _id: -1 } },
      {
        $group: {
          _id: '$vehicleId',
          outReading: { $first: '$outReading' },
          date: { $first: '$date' },
        },
      },
    ]);
    // The opening reading only, for the reason spelled out on `chainBounds` — the closing one was
    // measured on the NEXT row's date and does not belong to a bound cut at this one.
    return new Map(rows.map((row) => [String(row._id), { reading: row.outReading, date: row.date }]));
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
