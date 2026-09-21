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
}

const NOTHING: TotalsRow = { count: 0, amountCollected: 0, companyCost: 0, paidAmount: 0 };

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
  expression: { $subtract: [{ $add: ['$amountCollected', '$companyCost'] }, '$paidAmount'] },
} as const;

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
      // The contract's formula, not a second copy of it — the total and the rows above it are
      // then arithmetically the same statement.
      remaining: fleetAccidentRemaining(sums),
    };
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
      clauses.push({
        culpritEmployeeId: {
          $in: query.culpritEmployeeId.map((id) => new Types.ObjectId(id)),
        },
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
