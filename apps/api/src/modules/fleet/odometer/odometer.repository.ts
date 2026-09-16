import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { FleetOdometerLogModel, type FleetOdometerLogDoc } from './odometer.model';
import { VEHICLE_CODE_SORT } from '../vehicles/vehicle.repository';
import { driverNameSorts } from '../fleet-sort-keys';
import { bookRefFilter, groupByKey, type BookRef } from '../go-live/book-ref';

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

/**
 * «One of these cars»: by registry id, or — for a row kept from the old book on a car the
 * registry never had — by the code the book wrote. Shared by every register that keeps such rows.
 * An empty id list with no codes still narrows to NOTHING, as the callers' comments promise.
 */
export const byVehicleOrBookCode = <T>(
  vehicleIds: readonly string[],
  vehicleCodes: readonly string[] | undefined,
): FilterQuery<T> => {
  const ids = { vehicleId: { $in: vehicleIds.map((id) => new Types.ObjectId(id)) } };
  if (vehicleCodes === undefined || vehicleCodes.length === 0) return ids as FilterQuery<T>;
  return { $or: [ids, { vehicleCode: { $in: [...vehicleCodes] } }] } as FilterQuery<T>;
};

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

  /** How a row is told from another for the go-live import: the car, the day, the opening reading. */
  rowKey(date: Date, outReading: number): string {
    return `${date.toISOString()}|${outReading}`;
  }

  /**
   * Every live row for one car — by registry id, or by the old book's code for a car the registry
   * never had — grouped by key: what the go-live import checks before writing, so a run taken
   * over after a lapsed lease skips the rows the first attempt already wrote, and what it fills
   * a driver's NAME into where an earlier run left the driver empty.
   */
  async existingByKey(ref: BookRef): Promise<Map<string, FleetOdometerLogDoc[]>> {
    const rows = await this.model
      .find(bookRefFilter<FleetOdometerLogDoc>(ref))
      .lean<FleetOdometerLogDoc[]>()
      .exec();
    return groupByKey(rows, (row) => this.rowKey(row.date, row.outReading));
  }

  /** The go-live import's one repair on a row already written: the driver's name, where it had none. */
  async setDriverNames(
    id: Types.ObjectId,
    names: { driver1Name?: string; driver2Name?: string },
  ): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: names }).exec();
  }

  /**
   * Several rows in ONE insert — the go-live import's write, one call per vehicle rather than
   * one per reading. Stamps `createdBy`/`updatedBy` exactly as `create` does, so a row written
   * here is indistinguishable from one recorded on the screen. Ordered, so a failure names the
   * first row that could not be written and leaves the rows before it in place for the take-over
   * to find.
   */
  async createMany(
    rows: readonly Partial<FleetOdometerLogDoc>[],
    meta: { by: string | null; session?: ClientSession },
  ): Promise<FleetOdometerLogDoc[]> {
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    const docs = await FleetOdometerLogModel.create(
      rows.map((row) => ({ ...row, createdBy: by, updatedBy: by })),
      { session: meta.session ?? null, ordered: true },
    );
    return docs.map((doc) => doc.toObject() as FleetOdometerLogDoc);
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

  /**
   * The row a reading taken on `on` would FOLLOW in the chain: the latest-dated entry on or before
   * that day, newest insert first among several on the same day.
   *
   * BY DATE, AND DELIBERATELY NOT BY READING. Reading order is the chain's order only while the
   * two agree, and they can tie: FR-2 accepts a reading equal to the one before it (a car that did
   * not move), so three equal readings order by `_id` — by the order somebody typed them — and a
   * day entered late would splice itself in after a day that comes later in the calendar. The
   * chain would then hold its open period in the middle of its own history.
   *
   * Splicing by date cannot break the model's invariant. The new row takes over whatever this row
   * was closing with, so `inReading` of entry k is still `outReading` of entry k+1 wherever the
   * new row lands — that holds for any choice of predecessor, which is what makes it safe to
   * choose the one that is also correct.
   *
   * `null` = nothing on or before that day, which makes the new reading the chain's head.
   */
  async findPriorByDate(
    vehicleId: string,
    on: Date,
    session?: ClientSession,
  ): Promise<FleetOdometerLogDoc | null> {
    return this.model
      .findOne({
        vehicleId: new Types.ObjectId(vehicleId),
        isDeleted: false,
        date: { $lt: FleetOdometerRepository.dayAfter(on) },
      })
      .sort({ date: -1, _id: -1 })
      .session(session ?? null)
      .lean<FleetOdometerLogDoc>()
      .exec();
  }

  /** The chain's earliest-dated entry — the row a new head has to hand its reading on to. */
  async findChainHead(
    vehicleId: string,
    session?: ClientSession,
  ): Promise<FleetOdometerLogDoc | null> {
    return this.model
      .findOne({ vehicleId: new Types.ObjectId(vehicleId), isDeleted: false })
      .sort({ date: 1, _id: 1 })
      .session(session ?? null)
      .lean<FleetOdometerLogDoc>()
      .exec();
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
    session?: ClientSession,
  ): Promise<{ lower: ChainBound | null; upper: ChainBound | null }> {
    const end = FleetOdometerRepository.dayAfter(on);
    const base = { vehicleId: new Types.ObjectId(vehicleId), isDeleted: false };
    const [early, late] = await Promise.all([
      this.model
        .findOne({ ...base, date: { $lt: end } })
        .sort(NEWEST_FIRST)
        .session(session ?? null)
        .lean<FleetOdometerLogDoc>()
        .exec(),
      this.model
        .findOne({ ...base, date: { $gte: end } })
        .sort({ outReading: 1, _id: 1 })
        .session(session ?? null)
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
    // The keys this register publishes beyond its own stored columns: the car's code, the two
    // shift drivers' names — «تفصل الصباحى عن المسائى كل واحد فى عمود» — and whichever per-vehicle
    // maintenance figure the reader actually asked for, which the service computes and hands down.
    // Each one is a key AND its derivation, declared together so a published column cannot end up
    // with nothing to sort by: `sortableFields` is built FROM the list.
    const derived = [
      VEHICLE_CODE_SORT,
      ...driverNameSorts([
        ['driver1Name', 'driver1EmployeeId'],
        ['driver2Name', 'driver2EmployeeId'],
      ]),
      ...(params.sortDerived ?? []),
    ];
    return this.list({
      ...params,
      sortableFields: ['date', 'outReading', 'createdAt', ...derived.map((entry) => entry.key)],
      sortDerived: derived,
    });
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
    /**
     * The codes the reader typed, as typed — matched against the code a row kept from the old
     * book carries when its car is not in the registry, so «كوستر» finds its readings too. Only
     * the service knows whether the ids were narrowed by something else (an alarm level) that
     * such a row cannot satisfy, so it passes these only when they may stand on their own.
     */
    vehicleCodes?: readonly string[] | undefined;
    driverEmployeeIds?: readonly string[] | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): FilterQuery<FleetOdometerLogDoc> {
    const clauses: FilterQuery<FleetOdometerLogDoc>[] = [];
    if (query.vehicleId !== undefined) {
      clauses.push({ vehicleId: new Types.ObjectId(query.vehicleId) });
    }
    if (query.vehicleIds !== undefined) {
      clauses.push(byVehicleOrBookCode(query.vehicleIds, query.vehicleCodes));
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
