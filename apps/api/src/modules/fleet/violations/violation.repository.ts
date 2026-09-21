import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { VEHICLE_CODE_SORT } from '../vehicles/vehicle.repository';
import { byVehicleOrBookCode } from '../odometer/odometer.repository';
import { bookRefFilter, groupByKey, type BookRef } from '../go-live/book-ref';
import {
  FleetGrievanceModel,
  FleetViolationModel,
  type FleetGrievanceDoc,
  type FleetViolationDoc,
} from './violation.model';

/** Per-vehicle sums for one year — the aggregate half of the FR-9 rollup. */
export interface ViolationYearSums {
  /** `null` for rows kept from the old book on a car the registry never had — `vehicleCode` names it. */
  vehicleId: string | null;
  vehicleCode: string | null;
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

  /**
   * How many live rows of each SHAPE one vehicle already holds — the go-live import's check
   * before writing. A count per key rather than a set, because the old statement legitimately
   * holds two identical rows for one car (two «رسوم خدمة» entries of the same value in one
   * year), and a set would let a take-over write the second one twice.
   */
  async existingByKey(
    ref: BookRef,
    keyOf: (row: FleetViolationDoc) => string,
  ): Promise<Map<string, FleetViolationDoc[]>> {
    const rows = await this.model
      .find(bookRefFilter<FleetViolationDoc>(ref))
      .lean<FleetViolationDoc[]>()
      .exec();
    return groupByKey(rows, keyOf);
  }

  /** The go-live import's one repair on a fine already written: the driver's name, where it had none. */
  async setDriverName(id: Types.ObjectId, driverName: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { driverName } }).exec();
  }

  async listViolations(
    params: ListParams<FleetViolationDoc>,
  ): Promise<Paginated<FleetViolationDoc>> {
    return this.list({
      ...params,
      sortableFields: ['year', 'date', 'createdAt', VEHICLE_CODE_SORT.key],
      sortDerived: [VEHICLE_CODE_SORT],
    });
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
    /** The typed codes, for rows kept from the old book on a car the registry never had. */
    vehicleCodes?: readonly string[] | undefined;
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
      clauses.push(byVehicleOrBookCode(query.vehicleIds, query.vehicleCodes));
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

  /**
   * SEVERAL years at once, ORed — «اى فلتر ف الحركه زياده عن اتنين اختار ما بينهم».
   *
   * One clause per year rather than a range, because the two shapes answer «which year am I in?»
   * differently and only the per-year clause can ask both: a statement row stores the year, a
   * driver row implies it through its event date. The years a reader ticks need not be adjacent
   * either — «٢٠٢٤ و٢٠٢٦» is a perfectly ordinary comparison — so a `$gte`/`$lt` span would
   * quietly widen the question to include the year between them.
   */
  private static yearsClause(years: readonly number[]): FilterQuery<FleetViolationDoc> {
    return { $or: violationYearBranches(years) };
  }

  private static yearClause(year: number): FilterQuery<FleetViolationDoc> {
    return { $or: violationYearBranches([year]) };
  }

  /**
   * The §2.9 annual rollup's aggregate half: per-vehicle sums of both shapes for one year.
   * `vehicleCount` sums the statement rows' `count` (a row saying 5 × 100 IS five violations);
   * `driverCount` counts events. Derived at query time — nothing here is ever stored.
   */
  /**
   * Tick or untick the COMPANY's rows of one (vehicle, year) — and only those.
   *
   * «لما اعمل علامه صح فى الصف بتاع الشركه ملوش علاقه بالسواقيين». This used to set every row of
   * the group, so ticking the company's statement for a car settled that car's DRIVERS' fines for
   * the same year in the same click — money owed by a person, marked as received because somebody
   * closed off a different account. The two halves of the screen are two accounts and are settled
   * separately: this one, from the company board's group tick, and the drivers' one row at a time
   * on the board that lists them.
   *
   * `kind: 'vehicle'` is the whole of the fix, and it is also why the year needs no `$or` any
   * more: a statement row STORES its year. The driver branch of `yearClause` existed only to
   * reach the rows this must never touch.
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
        kind: 'vehicle',
        year,
      },
      { $set: { collected } },
    );
    return result.modifiedCount;
  }

  /**
   * CARRY SEVERAL DRIVER FINES ONTO ONE CAR'S STATEMENT — one write, inside the caller's
   * transaction.
   *
   * `kind: 'driver'` is in the filter and not merely in the service's guard: a statement row
   * stores its own year, and setting `filedYear` on one would leave two answers to the same
   * question with nothing to say which wins. Ids that name a statement row simply do not match,
   * and the service compares what it asked to move with what moved.
   *
   * `null` puts them back under their own dates, which is what makes the gesture undoable.
   */
  async fileUnder(
    ids: readonly string[],
    vehicleId: string,
    filedYear: number,
    meta: { by: string | null; session?: ClientSession },
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.model.updateMany(
      {
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        isDeleted: false,
        kind: 'driver',
      },
      // AN AGGREGATION PIPELINE, not a plain `$set`, because one of these values is computed from
      // the row's own current state: `homeVehicleId` takes the car the fine is leaving, and only
      // when it is not already set. `$ifNull` says that in one atomic write; reading each row
      // first and writing it back would race with a second clerk dragging the same fine.
      [
        {
          $set: {
            // KEEP THE FIRST HOME. A fine carried 150 → 151 and then 151 → 152 goes back to 150,
            // not to 151: home is where it started, not where it last stopped. Without this guard
            // the second carry would overwrite 150 with 151 and the way back would stop halfway.
            homeVehicleId: { $ifNull: ['$homeVehicleId', '$vehicleId'] },
            vehicleId: new Types.ObjectId(vehicleId),
            filedYear,
            updatedBy: meta.by === null ? null : new Types.ObjectId(meta.by),
            __v: { $add: ['$__v', 1] },
          },
        },
      ],
      // OMITTED rather than passed as undefined — `exactOptionalPropertyTypes` draws that
      // distinction and mongoose's update options take a session or no key at all.
      meta.session === undefined ? {} : { session: meta.session },
    );
    return result.modifiedCount;
  }

  /**
   * Put carried fines BACK: onto the car each came from, under its own date again.
   *
   * The way out of a drop, and the reason `homeVehicleId` exists. It takes no target car — every
   * row names its own, which is what makes this an undo rather than a second move to a guess.
   *
   * `$ifNull` on the way home covers the rows carried BEFORE this field existed: they have no
   * home recorded, so they stay where they are rather than being sent to `null` and falling off
   * every car's board. The backfill script is what gives those rows their home back.
   */
  async fileBackHome(
    ids: readonly string[],
    meta: { by: string | null; session?: ClientSession },
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.model.updateMany(
      {
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        isDeleted: false,
        kind: 'driver',
      },
      [
        {
          $set: {
            vehicleId: { $ifNull: ['$homeVehicleId', '$vehicleId'] },
            filedYear: null,
            homeVehicleId: null,
            updatedBy: meta.by === null ? null : new Types.ObjectId(meta.by),
            __v: { $add: ['$__v', 1] },
          },
        },
      ],
      meta.session === undefined ? {} : { session: meta.session },
    );
    return result.modifiedCount;
  }

  /** The fines named, as they stand — what the move audits against and checks the shape of. */
  async findByIds(
    ids: readonly string[],
    session?: ClientSession,
  ): Promise<FleetViolationDoc[]> {
    if (ids.length === 0) return [];
    return this.model
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, isDeleted: false })
      .session(session ?? null)
      .lean<FleetViolationDoc[]>()
      .exec();
  }

  async yearSums(
    years: readonly number[] | undefined,
    /**
     * WHICH CARS, if any. `vehicleIds: undefined` means every car; `[]` means the codes the
     * reader typed matched none of the registry's, which narrows to nothing but the old book's
     * own rows — `byVehicleOrBookCode` keeps those reachable by the code the book wrote.
     */
    scope?: {
      vehicleIds?: readonly string[] | undefined;
      vehicleCodes?: readonly string[] | undefined;
    },
  ): Promise<ViolationYearSums[]> {
    /*
     * ONE CLAUSE EACH, UNDER `$and` — never merged into one object.
     *
     * Both narrowings speak `$or`: the years ask each shape its own way, and the cars ask the
     * registry's ids OR the old book's codes. Written as two keys on one object the second would
     * overwrite the first, and the board would answer for every year the moment a car was picked
     * — a filter silently widening, which is the failure this whole endpoint has just had.
     */
    const clauses: FilterQuery<FleetViolationDoc>[] = [];
    // No years asked for means EVERY year — the board is read as a history, and «all of them»
    // is the answer an absent clause gives, not an empty `$or` that would match nothing.
    if (years !== undefined && years.length > 0) {
      clauses.push(FleetViolationRepository.yearsClause(years));
    }
    if (scope?.vehicleIds !== undefined) {
      clauses.push(byVehicleOrBookCode(scope.vehicleIds, scope.vehicleCodes));
    }
    const match: FilterQuery<FleetViolationDoc> = {
      isDeleted: false,
      ...(clauses.length === 0 ? {} : { $and: clauses }),
    };
    const rows = await this.model.aggregate<{
      _id: { vehicleId: Types.ObjectId | null; vehicleCode: string | null; year: number };
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
            // The old book's code, for rows whose car the registry never had — so two such cars
            // are two groups and not one group keyed on the value `null`.
            vehicleCode: { $ifNull: ['$vehicleCode', null] },
            // WHICH BLOCK THIS ROW IS COUNTED IN, in the order the answer is owed: the year it was
            // carried onto, else a statement row's own stored year, else the year a driver's event
            // date falls in. The same order `violationYearBranches` narrows by — a row that
            // filtered into one block and grouped under another would go missing from both.
            year: {
              $ifNull: [
                '$filedYear',
                { $ifNull: ['$year', { $year: { date: '$date', timezone: 'UTC' } }] },
              ],
            },
          },
          // WHAT IS STILL OWED, not what was ever fined. A row that has been ticked as collected
          // is settled, and the owner reads these four figures as the outstanding balance —
          // «تخرج من إجمالى الشركة و إجمالى السائقين و إجمالى المخالفات». So the tick takes the
          // row out of all four here, at the one place violation money is summed; every other
          // consumer (the group lines, the panel footers, the CSV and the print sheet) is a
          // re-rendering of these fields and follows for free, which is what keeps screen, export
          // and print from disagreeing.
          //
          // MONEY AND COUNTS MOVE TOGETHER, deliberately: they sit in the same table row, so
          // excluding only the amount would print «٣ مخالفات · ٠٫٠٠ ج.م» — a line that contradicts
          // itself.
          //
          // The exclusion is a $cond INSIDE the group, never a `collected: false` in the $match.
          // Matching would have been the shorter edit and would take the settled rows out of
          // `rowCount`/`collectedCount` too — and those two are what the board's three-state tick,
          // its green tint and the «الحالة» filter are all computed from, so a fully-collected
          // group would stop reporting that it is collected at all.
          vehicleCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$kind', 'vehicle'] }, { $not: ['$collected'] }] },
                { $ifNull: ['$count', 0] },
                0,
              ],
            },
          },
          vehicleAmount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$kind', 'vehicle'] }, { $not: ['$collected'] }] },
                '$amount',
                0,
              ],
            },
          },
          driverCount: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$kind', 'driver'] }, { $not: ['$collected'] }] }, 1, 0],
            },
          },
          driverAmount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$kind', 'driver'] }, { $not: ['$collected'] }] },
                '$amount',
                0,
              ],
            },
          },
          // ROWS, not fines: a statement row of «×5» is one row that is collected or not, so the
          // group's tick counts documents rather than the `count` on them — and it counts them
          // whether they are collected or not, because «٣ من ٥ محصَّلة» is exactly the question
          // these two answer.
          //
          // THE COMPANY'S ROWS ONLY. These two are what the board's tick sets, what its colour is
          // read from and what the «الحالة» filter sorts on — and that tick now sets the company's
          // statement rows alone. Counting the drivers' fines here would leave the tick describing
          // rows it cannot change: a car whose statement is fully settled would still show as
          // «بعضها» because a driver has not paid, and clicking it again would never turn it green.
          rowCount: { $sum: { $cond: [{ $eq: ['$kind', 'vehicle'] }, 1, 0] } },
          collectedCount: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$kind', 'vehicle'] }, '$collected'] }, 1, 0],
            },
          },
        },
      },
    ]);
    return rows.map((row) => ({
      vehicleId: row._id.vehicleId == null ? null : String(row._id.vehicleId),
      vehicleCode: row._id.vehicleCode ?? null,
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

  /** The grievances of SEVERAL years, ORed — the rollup's other half, narrowed the same way. */
  async forYears(
    years: readonly number[] | undefined,
    vehicleIds?: readonly string[] | undefined,
  ): Promise<FleetGrievanceDoc[]> {
    const filter: FilterQuery<FleetGrievanceDoc> = {
      isDeleted: false,
      // Nothing ticked is every year, exactly as it is for the sums beside it.
      ...(years === undefined || years.length === 0 ? {} : { year: { $in: [...years] } }),
    };
    // A grievance is a figure about a car the REGISTRY has — it carries no book code — so an
    // empty list is an honest "none of them", not a filter to drop.
    if (vehicleIds !== undefined) {
      filter.vehicleId = { $in: vehicleIds.map((id) => new Types.ObjectId(id)) };
    }
    return this.model.find(filter).lean<FleetGrievanceDoc[]>().exec();
  }
}

/**
 * The `$or` branches that mean «this row belongs to one of these years».
 *
 * TWO BRANCHES PER YEAR, because the collection holds two shapes and they answer «which year?»
 * differently: a vehicle statement row STORES the year, a driver event row implies it through its
 * date. A single date range would miss every statement row; a single `year` equality would miss
 * every driver row.
 *
 * One branch pair PER YEAR rather than one widened range, because the years a reader ticks need
 * not be adjacent — «٢٠٢٤ و٢٠٢٦» is an ordinary comparison, and a `$gte`/`$lt` span across it
 * would silently include the year between them.
 *
 * A MOVED ROW ANSWERS WITH `filedYear` AND WITH NOTHING ELSE. A driver's fine carried onto another
 * year's statement belongs to THAT year and must stop belonging to its date's — so the date branch
 * is guarded by `filedYear: null` rather than simply joined by a third. Left additive, a fine moved
 * from 2025 into 2026 would match both years at once, and «٢٠٢٤ و٢٠٢٦» — the very comparison this
 * helper exists for — would count it twice and sum its money twice.
 *
 * Exported for its own test: it is pure, and it is where a multi-year filter goes wrong quietly.
 */
export const violationYearBranches = (
  years: readonly number[],
): FilterQuery<FleetViolationDoc>[] =>
  years.flatMap((year) => [
    { kind: 'vehicle', year } as FilterQuery<FleetViolationDoc>,
    // Carried onto this year's statement, whatever day it happened on.
    { kind: 'driver', filedYear: year } as FilterQuery<FleetViolationDoc>,
    // …and the ordinary case: nobody moved it, so its own date says which year it is in.
    {
      kind: 'driver',
      filedYear: null,
      date: { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) },
    } as FilterQuery<FleetViolationDoc>,
  ]);

export const fleetViolationRepository = new FleetViolationRepository();
export const fleetGrievanceRepository = new FleetGrievanceRepository();
