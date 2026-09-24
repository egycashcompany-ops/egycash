import { Types, type ClientSession, type FilterQuery, type PipelineStage } from 'mongoose';
import {
  fleetAccidentRemaining,
  type FleetAccidentTotalsDto,
  type Paginated,
} from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { FleetAccidentModel, type FleetAccidentDoc } from './accident.model';
import { VEHICLE_CODE_SORT } from '../vehicles/vehicle.repository';
import { byVehicleOrBookCode } from '../odometer/odometer.repository';
import { bookRefFilter, groupByKey, type BookRef } from '../go-live/book-ref';

/** What `$group` hands back for one filter scope; absent entirely when nothing matched. */
interface TotalsRow {
  count: number;
  amountCollected: number;
  companyCost: number;
  paidAmount: number;
  transferredIn: number;
  transferredOut: number;
}

const NOTHING: TotalsRow = {
  count: 0,
  amountCollected: 0,
  companyCost: 0,
  paidAmount: 0,
  transferredIn: 0,
  transferredOut: 0,
};

/** A cached transfer figure, read as zero on a file written before transfers existed. */
const orZero = (path: string) => ({ $ifNull: [path, 0] });

/**
 * «إجمالي المتبقي», as a sort key — DERIVED, exactly as `fleetAccidentRemaining` derives it.
 *
 * The figure is never stored: it is «المحصَّل + تكلفة الشركة − المدفوع», and the contract owns that
 * formula because the column, the totals strip and the print sheet must all read it the same way.
 * Ordering by it therefore has to compute it in the database, before the page is cut — the same
 * arithmetic, spelled once more in the one language Mongo can sort by.
 *
 * The contract's rounding is deliberately NOT repeated: it exists so a display does not print
 * `-0` or `0.30000000000000004`, and neither changes which of two files owes more.
 */
export const REMAINING_SORT = {
  key: 'remaining',
  // What transfers moved in and out ride along, as the contract's formula has them. `$ifNull`
  // because a file written before transfers existed has neither field, and `$add` over a missing
  // field is null — which would sort every old file as though it owed nothing.
  expression: {
    $subtract: [
      { $add: ['$amountCollected', '$companyCost', orZero('$transferredIn')] },
      { $add: ['$paidAmount', orZero('$transferredOut')] },
    ],
  },
} as const;

/** To the piastre — a `$sum` of pounds carries binary residue the strip would print. */
const roundMoney = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

class FleetAccidentRepository extends BaseRepository<FleetAccidentDoc> {
  constructor() {
    super(FleetAccidentModel, {});
  }

  /**
   * How many live files of each shape one vehicle already holds — the go-live import's check
   * before writing, counted rather than set for the reason the violations give: two identical
   * files on one day are two files.
   */
  async existingByKey(
    ref: BookRef,
    keyOf: (row: FleetAccidentDoc) => string,
  ): Promise<Map<string, FleetAccidentDoc[]>> {
    const rows = await this.model
      .find(bookRefFilter<FleetAccidentDoc>(ref))
      .lean<FleetAccidentDoc[]>()
      .exec();
    return groupByKey(rows, keyOf);
  }

  /**
   * Several files in ONE insert — the go-live import's write, one call per vehicle. Stamps
   * `createdBy`/`updatedBy` exactly as `create` does; ordered, so a failure names the first file
   * that could not be written and leaves the ones before it for the take-over to find.
   */
  async createMany(
    rows: readonly Partial<FleetAccidentDoc>[],
    meta: { by: string | null; session?: ClientSession },
  ): Promise<FleetAccidentDoc[]> {
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    const docs = await FleetAccidentModel.create(
      rows.map((row) => ({ ...row, createdBy: by, updatedBy: by })),
      { session: meta.session ?? null, ordered: true },
    );
    return docs.map((doc) => doc.toObject() as FleetAccidentDoc);
  }

  async listAccidents(params: ListParams<FleetAccidentDoc>): Promise<Paginated<FleetAccidentDoc>> {
    return this.list({
      ...params,
      sortableFields: [
        'occurredAt',
        'createdAt',
        // The three stored figures, and the fourth the screen derives from them.
        'amountCollected',
        'companyCost',
        'paidAmount',
        REMAINING_SORT.key,
        VEHICLE_CODE_SORT.key,
      ],
      sortDerived: [VEHICLE_CODE_SORT, REMAINING_SORT],
    });
  }

  /**
   * The sums over EVERY accident `filter` matches — computed by the database, over the whole
   * scope, never over a page.
   *
   * `page` and `pageSize` are not parameters here and cannot be: the pipeline has no `$skip` and
   * no `$limit`, so the figures are a property of the FILTERS alone. That is the point — a total
   * that shifted when the reader turned the page would be describing the page, not the search.
   *
   * `baseFilter` is the same soft-delete and scope gate the list itself passes through, so the
   * rows behind the number are exactly the rows behind the table.
   */
  async totals(filter: FilterQuery<FleetAccidentDoc>): Promise<FleetAccidentTotalsDto> {
    const pipeline: PipelineStage[] = [
      { $match: this.baseFilter(undefined, filter) },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          amountCollected: { $sum: '$amountCollected' },
          companyCost: { $sum: '$companyCost' },
          paidAmount: { $sum: '$paidAmount' },
          transferredIn: { $sum: orZero('$transferredIn') },
          transferredOut: { $sum: orZero('$transferredOut') },
        },
      },
    ];
    const [row] = await this.model.aggregate<TotalsRow>(pipeline).exec();
    // No matching accident is not a missing answer: every figure is genuinely zero.
    const sums = row ?? NOTHING;
    return {
      count: sums.count,
      amountCollected: sums.amountCollected,
      companyCost: sums.companyCost,
      paidAmount: sums.paidAmount,
      transferredIn: roundMoney(sums.transferredIn ?? 0),
      transferredOut: roundMoney(sums.transferredOut ?? 0),
      // The contract's formula, not a second copy of it — the total and the rows above it are
      // then arithmetically the same statement. Transfers included: over the whole fleet what went
      // in equals what came out, so only a narrowed strip moves.
      remaining: fleetAccidentRemaining(sums),
    };
  }

  // ── transfers: reads and writes that run INSIDE a transaction ─────────────
  //
  // `BaseRepository`'s reads take no session, and a transfer's check has to read the very state
  // it then writes, in the same transaction — otherwise two clerks taking from one car at once
  // could each see the whole remaining and both take it.

  /** One live file, read inside `session`. */
  async findLive(
    id: string | Types.ObjectId,
    session: ClientSession,
  ): Promise<FleetAccidentDoc | null> {
    return this.model
      .findOne({ _id: new Types.ObjectId(String(id)), isDeleted: false })
      .session(session)
      .lean<FleetAccidentDoc>()
      .exec();
  }

  /** The live files among `ids`, read inside `session`. */
  async findLiveByIds(
    ids: readonly (string | Types.ObjectId)[],
    session: ClientSession,
  ): Promise<FleetAccidentDoc[]> {
    if (ids.length === 0) return [];
    return this.model
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(String(id))) }, isDeleted: false })
      .session(session)
      .lean<FleetAccidentDoc[]>()
      .exec();
  }

  /**
   * Every live file of one car, open and closed — by id, or by the code a file kept from the old
   * book wrote. The same scope the strip sums when the table is filtered to that one car, so the
   * figure the clerk is shown and the figure the table shows are one figure.
   */
  async liveOfCar(
    vehicleId: string,
    code: string,
    session?: ClientSession,
  ): Promise<FleetAccidentDoc[]> {
    return this.model
      .find(this.baseFilter(undefined, byVehicleOrBookCode<FleetAccidentDoc>([vehicleId], [code])))
      .session(session ?? null)
      .lean<FleetAccidentDoc[]>()
      .exec();
  }

  /**
   * Which of these cars have ANY transfer on their log — a live file of theirs that took or gave.
   * Answered as the registry ids and the old-book codes of those files, for one page at a time.
   */
  async carsWithTransfers(
    vehicleIds: readonly string[],
    codes: readonly string[],
  ): Promise<{ ids: Set<string>; codes: Set<string> }> {
    if (vehicleIds.length === 0 && codes.length === 0) return { ids: new Set(), codes: new Set() };
    const rows = await this.model
      .find({
        isDeleted: false,
        $and: [
          byVehicleOrBookCode<FleetAccidentDoc>([...vehicleIds], [...codes]),
          { $or: [{ transferredIn: { $gt: 0 } }, { transferredOut: { $gt: 0 } }] },
        ],
      })
      .select({ vehicleId: 1, vehicleCode: 1 })
      .lean<Pick<FleetAccidentDoc, 'vehicleId' | 'vehicleCode'>[]>()
      .exec();
    const ids = new Set<string>();
    const found = new Set<string>();
    for (const row of rows) {
      if (row.vehicleId !== null) ids.add(String(row.vehicleId));
      if (row.vehicleCode !== null) found.add(row.vehicleCode);
    }
    return { ids, codes: found };
  }

  /** Live files holding a live transfer FROM this car — «ادت ل مين». */
  async takersFrom(vehicleId: string): Promise<FleetAccidentDoc[]> {
    return this.model
      .find({
        isDeleted: false,
        transfersIn: {
          $elemMatch: { fromVehicleId: new Types.ObjectId(vehicleId), voidedAt: null },
        },
      })
      .lean<FleetAccidentDoc[]>()
      .exec();
  }

  /** Live files holding a live transfer that drew on `accidentId`. */
  async takersOf(accidentId: string, session: ClientSession): Promise<FleetAccidentDoc[]> {
    return this.model
      .find({
        isDeleted: false,
        transfersIn: {
          $elemMatch: { voidedAt: null, 'lines.accidentId': new Types.ObjectId(accidentId) },
        },
      })
      .session(session)
      .lean<FleetAccidentDoc[]>()
      .exec();
  }

  /**
   * Write one file's transfer figures, as computed from what was read in the same transaction.
   *
   * Absolute values rather than `$inc`: the caller read this file inside the session, and any
   * other write to it before commit is a write conflict that re-runs the whole transaction — so a
   * value computed from the read is still the right one when it lands. `bumpVersion` for the file
   * whose transfer LIST changed; a file that only gave some of its remaining keeps its version, so
   * a clerk editing its facts is not refused for a figure their form does not carry.
   */
  async setTransferState(
    id: Types.ObjectId,
    set: Pick<Partial<FleetAccidentDoc>, 'transfersIn' | 'transferredIn' | 'transferredOut'>,
    meta: { by: string | null; session: ClientSession; bumpVersion: boolean },
  ): Promise<void> {
    const by = meta.by === null ? null : new Types.ObjectId(meta.by);
    await this.model
      .updateOne(
        { _id: id, isDeleted: false },
        {
          $set: { ...set, updatedBy: by },
          ...(meta.bumpVersion ? { $inc: { __v: 1 } } : {}),
        },
        { session: meta.session },
      )
      .exec();
  }

  /**
   * The mongo filter for one set of accident filters. Every narrowing is its own clause in one
   * `$and`, which is what makes them combine rather than compete.
   *
   * `vehicleId` and `vehicleIds` are BOTH about the vehicle and are still two clauses on purpose:
   * the first is the dropdown's pick, the second is what a typed code resolved to. Sent together
   * they intersect. Folding them into one `$or`, or letting either win, would show the reader a
   * result their own filter bar says is impossible.
   *
   * `vehicleIds: []` — a code that matched no vehicle — narrows to NOTHING. It is not dropped:
   * the reader asked about a code the registry does not have, and the honest answer is an empty
   * page, not every accident in the fleet.
   */
  accidentFilter(query: {
    vehicleId?: string | undefined;
    vehicleIds?: readonly string[] | undefined;
    /** The typed codes, for files kept from the old book on a car the registry never had. */
    vehicleCodes?: readonly string[] | undefined;
    culprit?: string | undefined;
    /** Which drivers, ORed. `[]` narrows to nothing, as every id list on this module does. */
    culpritEmployeeId?: readonly string[] | undefined;
    /** Part of the file's own note. */
    notes?: string | undefined;
    status?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): FilterQuery<FleetAccidentDoc> {
    const clauses: FilterQuery<FleetAccidentDoc>[] = [];
    if (query.vehicleId !== undefined) {
      clauses.push({ vehicleId: new Types.ObjectId(query.vehicleId) });
    }
    if (query.vehicleIds !== undefined) {
      clauses.push(byVehicleOrBookCode(query.vehicleIds, query.vehicleCodes));
    }
    // Escaped, so `.` and `*` are the characters the reader typed rather than a pattern they did
    // not write — a search box is not a regex console, and an unescaped `.*` would match all.
    if (query.culpritEmployeeId !== undefined) {
      const ids = query.culpritEmployeeId.map((id) => new Types.ObjectId(id));
      // Either field: a file names its drivers in the list, an older one in the single id.
      clauses.push({
        $or: [{ culpritEmployeeId: { $in: ids } }, { culpritEmployeeIds: { $in: ids } }],
      });
    }
    if (query.culprit !== undefined) {
      clauses.push({
        culprit: new RegExp(query.culprit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      });
    }
    // Escaped for the same reason the name search is: what the reader typed, not a pattern they
    // did not write. A file with no note simply does not match — `null` is not a substring.
    if (query.notes !== undefined) {
      clauses.push({ notes: new RegExp(query.notes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
    }
    if (query.status !== undefined) clauses.push({ status: query.status });
    if (query.from !== undefined) clauses.push({ occurredAt: { $gte: query.from } });
    if (query.to !== undefined) clauses.push({ occurredAt: { $lte: query.to } });
    return clauses.length === 0 ? {} : { $and: clauses };
  }
}

export const fleetAccidentRepository = new FleetAccidentRepository();
