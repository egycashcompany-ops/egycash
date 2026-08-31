import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { FleetMaintenanceVisitModel, type FleetMaintenanceVisitDoc } from './maintenance.model';

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
const SORTABLE: readonly string[] = ['inDate', 'outDate', 'createdAt'];

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
      { $sort: { vehicleId: 1, outDate: -1 } },
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
          // the date were taken from — the sort has already decided which visit that is.
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
    // EITHER end of the visit: "which visits did this person drive" must not miss the one they
    // drove away. An EMPTY id list is a real answer — HR matched nobody — and `$in: []` matches
    // nothing, which is the honest result rather than an unfiltered page.
    const driverFilter: FilterQuery<FleetMaintenanceVisitDoc> | null =
      params.driverEmployeeIds === undefined
        ? null
        : {
            $or: [
              { driverInEmployeeId: { $in: params.driverEmployeeIds.map(oid) } },
              { driverOutEmployeeId: { $in: params.driverEmployeeIds.map(oid) } },
            ],
          };
    // Both drivers live on the visit, so this is one indexed query again — no join, and the page
    // is cut by the same filter the totals are counted from.
    const filter: FilterQuery<FleetMaintenanceVisitDoc> =
      driverFilter === null ? (params.filter ?? {}) : { $and: [params.filter ?? {}, driverFilter] };
    return this.list({ ...params, filter, sortableFields: SORTABLE });
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
  visitFilter(query: {
    vehicleId?: string | undefined;
    vehicleIds?: readonly string[] | undefined;
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
      clauses.push({ vehicleId: { $in: query.vehicleIds.map(oid) } });
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
