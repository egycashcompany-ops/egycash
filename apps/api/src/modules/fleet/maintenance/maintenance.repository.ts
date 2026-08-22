import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import { MAX_PAGE_SIZE, type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { FleetDutyAssignmentModel } from '../roster/duty-assignment.model';
import { FleetMaintenanceVisitModel, type FleetMaintenanceVisitDoc } from './maintenance.model';

export interface AlarmBaseline {
  vehicleId: string;
  odometerAtService: number;
  serviceDate: Date;
}

/**
 * A visit plus the roster crew of the day it went in.
 *
 * The crew is not stored on the visit — the roster owns it — so it is joined at read time and
 * carried on the row, the way the vehicle code is: a screen showing "who was driving" cannot
 * resolve it from a page of the roster it has not got.
 */
export interface FleetMaintenanceVisitRow extends FleetMaintenanceVisitDoc {
  driver1EmployeeId: Types.ObjectId | null;
  driver2EmployeeId: Types.ObjectId | null;
}

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

  /**
   * The filtered page, with the CREW the vehicle carried the day it went in attached to each row.
   *
   * Done as one aggregation rather than a query plus a per-row lookup, because the crew is not
   * only shown — it is FILTERED on, and a filter applied after the page is cut answers "which of
   * these twenty-five", not "which". Cutting the page after the join is what makes the totals and
   * the page count describe the same set the reader is looking at.
   *
   * The crew is the roster's fact, joined on (vehicle, DAY): the roster stamps its date at UTC
   * midnight and a visit's `inDate` normally arrives the same way, but an equality join would
   * answer "no crew" for any visit whose date carries a time, so the day is truncated on both
   * sides.
   */
  async listVisits(
    params: ListParams<FleetMaintenanceVisitDoc> & {
      driverEmployeeIds?: readonly string[] | undefined;
    },
  ): Promise<Paginated<FleetMaintenanceVisitRow>> {
    const pageSize = Math.min(params.pageSize, MAX_PAGE_SIZE);
    const page = Math.max(1, params.page);
    const sortField = SORTABLE.includes(params.sortBy ?? '')
      ? (params.sortBy as string)
      : 'createdAt';
    const sortDir = params.sortDir === 'asc' ? 1 : -1;

    const crewJoin: PipelineStage[] = [
      {
        $lookup: {
          from: FleetDutyAssignmentModel.collection.name,
          let: { vehicle: '$vehicleId', day: { $dateTrunc: { date: '$inDate', unit: 'day' } } },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$vehicleId', '$$vehicle'] },
                    { $eq: ['$isDeleted', false] },
                    { $eq: [{ $dateTrunc: { date: '$date', unit: 'day' } }, '$$day'] },
                  ],
                },
              },
            },
            { $limit: 1 },
            { $project: { driver1EmployeeId: 1, driver2EmployeeId: 1 } },
          ],
          as: 'crew',
        },
      },
      {
        $addFields: {
          // `$ifNull` so an unrostered day yields an explicit null rather than an ABSENT field —
          // the driver `$match` below and the row type both read it as a value either way.
          driver1EmployeeId: { $ifNull: [{ $arrayElemAt: ['$crew.driver1EmployeeId', 0] }, null] },
          driver2EmployeeId: { $ifNull: [{ $arrayElemAt: ['$crew.driver2EmployeeId', 0] }, null] },
        },
      },
      { $project: { crew: 0 } },
    ];

    // EITHER slot, as everywhere else a driver is asked for: "which visits did this person's car
    // go in on" must not miss the evening shift. An EMPTY id list is a real answer — HR matched
    // nobody — and `$in: []` correctly matches nothing.
    const driverMatch: PipelineStage[] =
      params.driverEmployeeIds === undefined
        ? []
        : [
            {
              $match: {
                $or: [
                  { driver1EmployeeId: { $in: params.driverEmployeeIds.map(oid) } },
                  { driver2EmployeeId: { $in: params.driverEmployeeIds.map(oid) } },
                ],
              },
            },
          ];

    const [result] = await this.model
      .aggregate<{ items: FleetMaintenanceVisitRow[]; total: { n: number }[] }>([
        { $match: this.baseFilter(params.scope, params.filter) },
        ...crewJoin,
        ...driverMatch,
        {
          $facet: {
            items: [
              { $sort: { [sortField]: sortDir, _id: sortDir } },
              { $skip: (page - 1) * pageSize },
              { $limit: pageSize },
            ],
            total: [{ $count: 'n' }],
          },
        },
      ])
      .exec();

    const totalItems = result?.total[0]?.n ?? 0;
    return {
      items: result?.items ?? [],
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      },
    };
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
