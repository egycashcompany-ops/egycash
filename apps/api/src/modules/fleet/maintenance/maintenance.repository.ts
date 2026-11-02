import { Types, type ClientSession, type FilterQuery, type PipelineStage } from 'mongoose';
import { addDaysYmd, ymdToUtcDate, type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { FleetMaintenanceVisitModel, type FleetMaintenanceVisitDoc } from './maintenance.model';
import { VEHICLE_CODE_SORT } from '../vehicles/vehicle.repository';
import { FleetVehicleModel } from '../vehicles/vehicle.model';
import { byVehicleOrBookCode } from '../odometer/odometer.repository';
import { bookRefFilter, groupByKey, type BookRef } from '../go-live/book-ref';
import { driverNameSorts } from '../fleet-sort-keys';

export interface AlarmBaseline {
  vehicleId: string;
  /**
   * The VISIT this baseline came from.
   *
   * The alarm has always known the date of the last counting service and nothing about which
   * visit that was, which left a reader looking at «متأخر ٢٠٠ كم» with no way back to the record
   * that started the cycle. Carried here rather than looked up again later: the aggregate has
   * already picked the winning row, and a second query could pick a different one.
   */
  visitId: string;
  /** `null` — the service was recorded with no counter (it is optional). */
  odometerAtService: number | null;
  serviceDate: Date;
  /**
   * The day the counter the alarm measures from was TAKEN — the check-out day for an exit counter,
   * the check-in day for an entry counter, and the check-out day when there is none (the stand-in
   * is then the reading the car left on).
   *
   * The baseline is checked against the chain on THIS day, not on `serviceDate`. An entry counter
   * was read when the car went in, so a car that drove between check-in and check-out had a
   * higher reading on the chain by the day it left — and the check against that day refused a
   * counter that was true when it was written (car 219: 84,080 on 25 June, 84,189 by the 28th).
   */
  counterDate: Date;
  /** The visit's check-in day — the day an entry counter is judged on. */
  inDate: Date;
  /**
   * The visit's two counters EXACTLY as stored — «العداد عند الصيانة» and «عداد الخروج من الصيانة»;
   * `null` where not written (an absent field included). `odometerAtService` above is the one of
   * them the baseline picks first; these two let the alarm say which, and fall back (R3).
   */
  entryCounter: number | null;
  exitCounter: number | null;
}

/** A car's newest visit by check-in day, whatever its state — see `newestVisits`. */
export interface NewestVisit {
  visitId: string;
  inDate: Date;
  /** `null` while the visit is open. */
  outDate: Date | null;
  workTypeId: string;
}

/** A visit as the list answers with it. The drivers are stored on the document itself now. */
export type FleetMaintenanceVisitRow = FleetMaintenanceVisitDoc;

/** Whitelist — unchanged, and an unknown field falls back to `createdAt` (API Standards §4). */
/** The visit's OWN columns. The joined and computed keys are added per request — see below. */
const SORTABLE: readonly string[] = [
  'inDate',
  'outDate',
  'createdAt',
  // «العداد عند الخدمة» — a stored figure, so ordering by it costs nothing extra.
  'odometerAtService',
];

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

/**
 * The midnight AFTER the day a bound names — so `to` covers the whole of its day however
 * precisely the visit was stamped. The odometer log bounds its `to` the same way.
 */
const dayAfter = (date: Date): Date => {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
};

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

  /** How a visit is told from another for the go-live import: the car, the day in, the workshop, the work. */
  rowKey(inDate: Date, workshopId: string, workTypeId: string): string {
    return `${inDate.toISOString()}|${workshopId}|${workTypeId}`;
  }

  /**
   * Every live visit for one car — by registry id, or by the old book's code for a car the
   * registry never had — grouped by key: what the go-live import checks before writing, and what
   * it fills a driver's NAME into where an earlier run left the driver empty.
   */
  async existingByKey(ref: BookRef): Promise<Map<string, FleetMaintenanceVisitDoc[]>> {
    const rows = await this.model
      .find(bookRefFilter<FleetMaintenanceVisitDoc>(ref))
      .lean<FleetMaintenanceVisitDoc[]>()
      .exec();
    return groupByKey(rows, (row) =>
      this.rowKey(row.inDate, String(row.workshopId), String(row.workTypeId)),
    );
  }

  /** The go-live import's one repair on a visit already written: a driver's name, where it had none. */
  async setDriverNames(
    id: Types.ObjectId,
    names: { driverInName?: string; driverOutName?: string },
  ): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: names }).exec();
  }

  /**
   * Several visits in ONE insert — the go-live import's write, one call per vehicle. Stamps
   * `createdBy`/`updatedBy` exactly as `create` does; ordered, so a failure names the first visit
   * that could not be written and leaves the ones before it for the take-over to find.
   */
  async createMany(
    rows: readonly Partial<FleetMaintenanceVisitDoc>[],
    meta: { by: string | null; session?: ClientSession },
  ): Promise<FleetMaintenanceVisitDoc[]> {
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    const docs = await FleetMaintenanceVisitModel.create(
      rows.map((row) => ({ ...row, createdBy: by, updatedBy: by })),
      { session: meta.session ?? null, ordered: true },
    );
    return docs.map((doc) => doc.toObject() as FleetMaintenanceVisitDoc);
  }

  /**
   * Vehicles with an OPEN visit — FR-12's derived `inWorkshop`, FR-5's roster exclusion. With
   * `coveringDate`, only visits already open by the end of that day count: a car that enters
   * the workshop AFTER day D was not in the workshop ON day D.
   */
  async openVisitVehicleIds(
    vehicleIds: readonly string[],
    coveringDate?: Date,
  ): Promise<ReadonlySet<string>> {
    if (vehicleIds.length === 0) return new Set();
    const filter: FilterQuery<FleetMaintenanceVisitDoc> = {
      vehicleId: { $in: vehicleIds.map((id) => new Types.ObjectId(id)) },
      outDate: null,
      isDeleted: false,
    };
    if (coveringDate !== undefined) {
      const d = coveringDate;
      filter.inDate = {
        $lt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 86_400_000),
      };
    }
    const rows = await this.model
      .find(filter, { vehicleId: 1 })
      .lean<{ vehicleId: Types.ObjectId }[]>()
      .exec();
    return new Set(rows.map((row) => String(row.vehicleId)));
  }

  /**
   * The visits that held a car from the first day of [from, to] to the last: checked in on or
   * before `from`, and still open or checked out on or after `to`. R-16 (d) is asked of the period
   * itself, so ANY visit answers it — an older one that covered the period is not hidden by a later
   * one, which is what reading the car's newest visit did. Bounded by `ix_vehicle_in`.
   */
  workshopThroughoutFilter(
    vehicleIds: readonly string[],
    range: { from: string; to: string },
  ): FilterQuery<FleetMaintenanceVisitDoc> {
    return {
      vehicleId: { $in: vehicleIds.map((id) => new Types.ObjectId(id)) },
      isDeleted: false,
      inDate: { $lt: ymdToUtcDate(addDaysYmd(range.from, 1)) },
      // `outDate: null` also matches an old row without the field — open, as everywhere here.
      $or: [{ outDate: null }, { outDate: { $gte: ymdToUtcDate(range.to) } }],
    };
  }

  /** The cars `workshopThroughoutFilter` answers for — R-16 (d), «في الورشة طوال الفترة». */
  async vehicleIdsInWorkshopThroughout(
    vehicleIds: readonly string[],
    range: { from: string; to: string },
  ): Promise<ReadonlySet<string>> {
    if (vehicleIds.length === 0) return new Set();
    const ids = await this.model
      .distinct('vehicleId', this.workshopThroughoutFilter(vehicleIds, range))
      .exec();
    return new Set(ids.map(String));
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
      visitId: Types.ObjectId;
      odometerAtService: number | null;
      outDate: Date;
      inDate: Date;
      exitOdometer?: number | null;
      entryOdometer?: number | null;
    }>([
      {
        $match: {
          vehicleId: { $in: vehicleIds.map((id) => new Types.ObjectId(id)) },
          workTypeId: { $in: countingWorkTypeIds.map((id) => new Types.ObjectId(id)) },
          outDate: { $ne: null },
          isDeleted: false,
        },
      },
      // `_id` breaks the tie, and a tie is ordinary here. `outDate` is stored at midnight UTC by
      // every write path, so two counting visits closed on the same day sort EQUAL — and mongo's
      // sort is not stable, which made `$first` below pick one of them arbitrarily. The same
      // request could answer with a different baseline counter, a different date and a different
      // `visitId` on a refresh.
      //
      // Descending `_id`, so the later-recorded of two same-day services wins: the same order
      // `NEWEST_FIRST` imposes on the odometer chain, for the same reason.
      { $sort: { vehicleId: 1, outDate: -1, _id: -1 } },
      {
        $group: {
          _id: '$vehicleId',
          // The counter the car LEFT on, falling back to the one it arrived on.
          //
          // The baseline is what "since the last service" is measured from, and the honest zero is
          // the reading the car drove away on: whatever the workshop itself put on the clock is
          // not distance since the service, and counting it would bring the next one forward.
          //
          // `$ifNull` covers both shapes a row can have: visits closed before this was collected
          // carry `null`, and visits written before the field existed carry nothing at all —
          // a mongoose `default` applies on WRITE, so it never reached the rows already there.
          odometerAtService: { $first: { $ifNull: ['$exitOdometer', '$odometerAtService'] } },
          outDate: { $first: '$outDate' },
          // The same `$first` as the two above, so the id belongs to the very row the counter and
          // the date were taken from — and the sort above is a TOTAL order, so which row that is
          // does not change between two identical requests.
          visitId: { $first: '$_id' },
          // Which of the two counters won, and the day the other one was read on — so the check
          // against the chain is asked on the day the counter was TAKEN (see `counterDate`).
          inDate: { $first: '$inDate' },
          exitOdometer: { $first: '$exitOdometer' },
          // The entry counter as stored, beside the exit one — so the alarm can say which of the two
          // it measured from, and fall back to this one when the exit counter is contradicted (R3).
          entryOdometer: { $first: '$odometerAtService' },
        },
      },
    ]);
    return new Map(
      rows.map((row) => [
        String(row._id),
        {
          vehicleId: String(row._id),
          visitId: String(row.visitId),
          odometerAtService: row.odometerAtService,
          serviceDate: row.outDate,
          // `!= null`: a visit written before the exit counter existed carries no field at all.
          counterDate:
            row.exitOdometer != null
              ? row.outDate
              : row.odometerAtService != null
                ? row.inDate
                : row.outDate,
          inDate: row.inDate,
          entryCounter: row.entryOdometer ?? null,
          exitCounter: row.exitOdometer ?? null,
        },
      ]),
    );
  }

  /**
   * Each car's NEWEST live visit by check-in day, open or closed, counting or not — so the alarm can
   * say when the visit a reader expects to be measured from is not the one it uses (still open, or
   * of a work type that does not count). Read-only; a soft-deleted visit is never answered.
   *
   * ONE visit per car, whatever its history: the pipeline runs over the REGISTRY (one document per
   * asked id) and takes each car's newest visit through `ix_vehicle_in` with `$limit: 1` — the
   * alarm board and the period km ask this for every car on every read.
   */
  newestVisitsPipeline(vehicleIds: readonly string[]): PipelineStage[] {
    return [
      { $match: { _id: { $in: vehicleIds.map((id) => new Types.ObjectId(id)) } } },
      {
        $lookup: {
          from: this.model.collection.name,
          localField: '_id',
          foreignField: 'vehicleId',
          pipeline: [
            { $match: { isDeleted: false } },
            // A total order, as every `$sort` here: two visits in on one day are told apart by
            // `_id`, the later-recorded first.
            { $sort: { inDate: -1, _id: -1 } },
            { $limit: 1 },
            { $project: { _id: 1, inDate: 1, outDate: 1, workTypeId: 1 } },
          ],
          as: 'newest',
        },
      },
      { $unwind: '$newest' },
      {
        $project: {
          _id: 1,
          visitId: '$newest._id',
          inDate: '$newest.inDate',
          outDate: '$newest.outDate',
          workTypeId: '$newest.workTypeId',
        },
      },
    ];
  }

  async newestVisits(vehicleIds: readonly string[]): Promise<Map<string, NewestVisit>> {
    if (vehicleIds.length === 0) return new Map();
    const rows = await FleetVehicleModel.aggregate<{
      _id: Types.ObjectId;
      visitId: Types.ObjectId;
      inDate: Date;
      outDate: Date | null;
      workTypeId: Types.ObjectId;
    }>(this.newestVisitsPipeline(vehicleIds));
    return new Map(
      rows.map((row) => [
        String(row._id),
        {
          visitId: String(row.visitId),
          inDate: row.inDate,
          outDate: row.outDate ?? null,
          workTypeId: String(row.workTypeId),
        },
      ]),
    );
  }

  /**
   * The filtered page.
   *
   * Both drivers are stored ON the visit, so this is a plain indexed query: the filter that cuts
   * the page is the same one the totals are counted from, with no join in between. It used to
   * reach into the duty roster for the crew of the check-in day — that join went when the visit
   * started recording who actually drove it, which is a different claim from who was planned to.
   */
  async listVisits(
    params: ListParams<FleetMaintenanceVisitDoc> & {
      driverEmployeeIds?: readonly string[] | undefined;
    },
  ): Promise<Paginated<FleetMaintenanceVisitRow>> {
    // Both drivers live on the visit, so this is one indexed query again — no join, and the page
    // is cut by the SAME filter the summary is measured over, because both build it here.
    const filter = this.withDriverFilter(params.filter ?? {}, params.driverEmployeeIds);
    // The keys published beyond the visit's own columns — the car's code, the entry and exit
    // drivers' names, and whichever per-vehicle figure the reader asked for. See the odometer
    // register for why the two are declared together.
    const derived = [
      VEHICLE_CODE_SORT,
      ...driverNameSorts([
        ['driverInName', 'driverInEmployeeId'],
        ['driverOutName', 'driverOutEmployeeId'],
      ]),
      ...(params.sortDerived ?? []),
    ];
    return this.list({
      ...params,
      filter,
      sortableFields: [...SORTABLE, ...derived.map((entry) => entry.key)],
      sortDerived: derived,
    });
  }

  /**
   * The list filter.
   *
   * `vehicleIds` arrives already RESOLVED by the service — from the codes the filter bar carries
   * — because the registry is a collection this repository does not own. An EMPTY array is a real
   * answer meaning "nothing matched", and it must produce an empty page rather than an unfiltered
   * one.
   *
   * The DRIVER filter is not here: it needs the roster join, which happens in `listVisits`.
   */
  /**
   * The driver half of the filter, folded onto the rest — EITHER end of the visit, because
   * "which visits did this person drive" must not miss the one they drove away.
   *
   * It is not part of `visitFilter` because it is not a clause about the visit's own columns in
   * the way the others are; it is here, as its own step, so the PAGE and the SUMMARY compose the
   * identical filter instead of one of them quietly leaving the drivers out.
   *
   * An EMPTY id list is a real answer — HR matched nobody — and `$in: []` matches nothing, which
   * is the honest result rather than an unfiltered page.
   */
  withDriverFilter(
    filter: FilterQuery<FleetMaintenanceVisitDoc>,
    driverEmployeeIds: readonly string[] | undefined,
  ): FilterQuery<FleetMaintenanceVisitDoc> {
    if (driverEmployeeIds === undefined) return filter;
    return {
      $and: [
        filter,
        {
          $or: [
            { driverInEmployeeId: { $in: driverEmployeeIds.map(oid) } },
            { driverOutEmployeeId: { $in: driverEmployeeIds.map(oid) } },
          ],
        },
      ],
    };
  }

  visitFilter(query: {
    vehicleId?: string | undefined;
    vehicleIds?: readonly string[] | undefined;
    /** The typed codes, for rows kept from the old book on a car the registry never had. */
    vehicleCodes?: readonly string[] | undefined;
    open?: boolean | undefined;
    workshopId?: string | undefined;
    workshopIds?: readonly string[] | undefined;
    workTypeId?: string | undefined;
    workTypeIds?: readonly string[] | undefined;
    sparePartIds?: readonly string[] | undefined;
    notes?: string | undefined;
    odometerFrom?: number | undefined;
    odometerTo?: number | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
    outFrom?: Date | undefined;
    outTo?: Date | undefined;
  }): FilterQuery<FleetMaintenanceVisitDoc> {
    const clauses: FilterQuery<FleetMaintenanceVisitDoc>[] = [];
    if (query.vehicleId !== undefined) clauses.push({ vehicleId: oid(query.vehicleId) });
    if (query.vehicleIds !== undefined) {
      clauses.push(byVehicleOrBookCode(query.vehicleIds, query.vehicleCodes));
    }
    if (query.open !== undefined) {
      clauses.push(query.open ? { outDate: null } : { outDate: { $ne: null } });
    }
    if (query.workshopId !== undefined) clauses.push({ workshopId: oid(query.workshopId) });
    if (query.workshopIds !== undefined) {
      clauses.push({ workshopId: { $in: query.workshopIds.map(oid) } });
    }
    if (query.workTypeId !== undefined) clauses.push({ workTypeId: oid(query.workTypeId) });
    if (query.workTypeIds !== undefined) {
      clauses.push({ workTypeId: { $in: query.workTypeIds.map(oid) } });
    }
    // ANY of the chosen parts — "show me the visits that used this part" is an OR question.
    if (query.sparePartIds !== undefined) {
      clauses.push({ sparePartIds: { $in: query.sparePartIds.map(oid) } });
    }
    if (query.notes !== undefined) {
      clauses.push({ notes: new RegExp(query.notes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
    }
    if (query.odometerFrom !== undefined) {
      clauses.push({ odometerAtService: { $gte: query.odometerFrom } });
    }
    if (query.odometerTo !== undefined) {
      clauses.push({ odometerAtService: { $lte: query.odometerTo } });
    }
    if (query.from !== undefined) clauses.push({ inDate: { $gte: query.from } });
    if (query.to !== undefined) clauses.push({ inDate: { $lt: dayAfter(query.to) } });
    if (query.outFrom !== undefined) clauses.push({ outDate: { $gte: query.outFrom } });
    if (query.outTo !== undefined) clauses.push({ outDate: { $lt: dayAfter(query.outTo) } });
    return clauses.length === 0 ? {} : { $and: clauses };
  }

  // ── The fleet dashboard's reads (P1-05, R-09, R-12, R-18) ───────────────────────────────────
  //
  // Each one is handed the filter the SERVICE built for the list — `visitFilter` with the vehicle
  // scope and the driver clause folded in — and adds only the soft delete the list's own base
  // filter adds. So a figure is counted from exactly the rows its link lists, by construction.

  /**
   * R-09 — the open visits the filter matches: how many, the oldest by check-in day (the earlier
   * recorded of two on one day), and the registry cars among them. A car has at most one open
   * visit (`ux_open_visit`), so the per-car list is bounded by the fleet.
   */
  async openFacts(filter: FilterQuery<FleetMaintenanceVisitDoc>): Promise<OpenVisitFacts> {
    const [facets] = await this.model.aggregate<{
      total: { n: number }[];
      oldest: { vehicleId?: Types.ObjectId | null; vehicleCode?: string | null; inDate: Date }[];
      cars: { _id: Types.ObjectId; visits: number }[];
    }>([
      { $match: this.baseFilter(undefined, filter) },
      {
        $facet: {
          total: [{ $count: 'n' }],
          oldest: [
            { $sort: { inDate: 1, _id: 1 } },
            { $limit: 1 },
            { $project: { _id: 0, vehicleId: 1, vehicleCode: 1, inDate: 1 } },
          ],
          cars: [
            { $match: { vehicleId: { $type: 'objectId' } } },
            { $group: { _id: '$vehicleId', visits: { $sum: 1 } } },
          ],
        },
      },
    ]);
    const oldest = facets?.oldest[0];
    return {
      count: facets?.total[0]?.n ?? 0,
      oldest:
        oldest === undefined
          ? null
          : {
              vehicleId: oldest.vehicleId == null ? null : String(oldest.vehicleId),
              vehicleCode: oldest.vehicleCode ?? null,
              inDate: oldest.inDate,
            },
      cars: (facets?.cars ?? []).map((row) => ({
        vehicleId: String(row._id),
        visits: row.visits,
      })),
    };
  }

  /**
   * R-12 — the most recently WRITTEN visits (`createdAt` desc, then `_id` desc) whose business date
   * — the check-in day, or the check-out day when later — is on or after `since`. That is «either
   * day on or after it», which is what the `$or` asks.
   *
   * A visit of a car since DELETED from the registry is left out: each row opens the register on
   * its car's code, and the register resolves a code through the live registry only, so that row
   * would open an empty list (§8.11 «every figure has a link that reproduces it»). Its visit still
   * counts in every total. A visit kept from the old book, with no car at all, stays.
   */
  async recentWritten(
    filter: FilterQuery<FleetMaintenanceVisitDoc>,
    since: Date,
    limit: number,
  ): Promise<FleetMaintenanceVisitDoc[]> {
    // `$limit: 0` is refused by Mongo, so a request for no rows is answered without asking.
    if (limit <= 0) return [];
    return this.model.aggregate<FleetMaintenanceVisitDoc>([
      {
        $match: this.baseFilter(undefined, {
          $and: [filter, { $or: [{ inDate: { $gte: since } }, { outDate: { $gte: since } }] }],
        } as FilterQuery<FleetMaintenanceVisitDoc>),
      },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $lookup: {
          from: FleetVehicleModel.collection.name,
          localField: 'vehicleId',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 0, isDeleted: 1 } }],
          as: 'registryCar',
        },
      },
      { $match: { 'registryCar.isDeleted': { $ne: true } } },
      { $limit: limit },
      { $project: { registryCar: 0 } },
    ]);
  }

  /**
   * R-18 — the visits the filter matches, broken down in ONE `$facet`: the state each is in NOW,
   * per work type, per workshop and per car. Every facet partitions the same matched rows, so each
   * one sums to `count`. A row kept from the old book for a car the registry never had is grouped
   * under the code the book wrote.
   */
  async breakdown(filter: FilterQuery<FleetMaintenanceVisitDoc>): Promise<VisitBreakdownFacts> {
    // `$ifNull` so a field ABSENT on an old row reads as the `null` the list's `outDate: null`
    // matches — an aggregation `$eq` would tell missing and null apart, the find filter does not.
    const isNull = (field: string) => ({ $eq: [{ $ifNull: [field, null] }, null] });
    const [facets] = await this.model.aggregate<{
      state: { count: number; open: number; unregistered: number }[];
      byWorkType: { _id: Types.ObjectId; count: number }[];
      byWorkshop: { _id: Types.ObjectId; count: number }[];
      byVehicle: {
        _id: { vehicleId: Types.ObjectId | null; vehicleCode: string | null };
        visits: number;
        lastInDate: Date;
      }[];
    }>([
      { $match: this.baseFilter(undefined, filter) },
      {
        $facet: {
          state: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                open: { $sum: { $cond: [isNull('$outDate'), 1, 0] } },
                unregistered: { $sum: { $cond: [isNull('$vehicleId'), 1, 0] } },
              },
            },
          ],
          byWorkType: [{ $group: { _id: '$workTypeId', count: { $sum: 1 } } }],
          byWorkshop: [{ $group: { _id: '$workshopId', count: { $sum: 1 } } }],
          byVehicle: [
            {
              $group: {
                _id: {
                  vehicleId: { $ifNull: ['$vehicleId', null] },
                  vehicleCode: {
                    $cond: [isNull('$vehicleId'), { $ifNull: ['$vehicleCode', null] }, null],
                  },
                },
                visits: { $sum: 1 },
                lastInDate: { $max: '$inDate' },
              },
            },
          ],
        },
      },
    ]);
    const state = facets?.state[0];
    return {
      count: state?.count ?? 0,
      open: state?.open ?? 0,
      unregistered: state?.unregistered ?? 0,
      byWorkType: (facets?.byWorkType ?? []).map((row) => ({
        id: String(row._id),
        count: row.count,
      })),
      byWorkshop: (facets?.byWorkshop ?? []).map((row) => ({
        id: String(row._id),
        count: row.count,
      })),
      byVehicle: (facets?.byVehicle ?? []).map((row) => ({
        vehicleId: row._id.vehicleId == null ? null : String(row._id.vehicleId),
        vehicleCode: row._id.vehicleCode ?? null,
        visits: row.visits,
        lastInDate: row.lastInDate,
      })),
    };
  }
}

/** R-09's facts, before the service names the cars. */
export interface OpenVisitFacts {
  count: number;
  /** The oldest open visit by check-in day; `null` when none is open. */
  oldest: { vehicleId: string | null; vehicleCode: string | null; inDate: Date } | null;
  /** The registry cars among the open visits, with how many each has (one, by `ux_open_visit`). */
  cars: { vehicleId: string; visits: number }[];
}

/** R-18's facets, before the service names the work types, workshops and cars. */
export interface VisitBreakdownFacts {
  count: number;
  /** Visits still open NOW (`outDate` null). */
  open: number;
  /** Visits with no registry car (kept from the old book). */
  unregistered: number;
  byWorkType: { id: string; count: number }[];
  byWorkshop: { id: string; count: number }[];
  /** Per registry car, or per book code for a visit without one. */
  byVehicle: {
    vehicleId: string | null;
    vehicleCode: string | null;
    visits: number;
    lastInDate: Date;
  }[];
}

export const fleetMaintenanceRepository = new FleetMaintenanceRepository();
