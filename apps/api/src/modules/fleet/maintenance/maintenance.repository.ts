import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { FleetMaintenanceVisitModel, type FleetMaintenanceVisitDoc } from './maintenance.model';
import { VEHICLE_CODE_SORT } from '../vehicles/vehicle.repository';
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
  odometerAtService: number;
  serviceDate: Date;
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

  /**
   * WHICH CARS the visits matching this filter belong to — distinct, over the WHOLE filtered set.
   * The odometer register does the same, for the same figure; see `vehicleIdsMatching` there.
   */
  async vehicleIdsMatching(filter: FilterQuery<FleetMaintenanceVisitDoc>): Promise<string[]> {
    const rows = await this.model.aggregate<{ _id: Types.ObjectId | null }>([
      { $match: this.baseFilter(undefined, filter) },
      { $group: { _id: '$vehicleId' } },
    ]);
    return rows.filter((row) => row._id !== null).map((row) => String(row._id));
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
}

export const fleetMaintenanceRepository = new FleetMaintenanceRepository();
