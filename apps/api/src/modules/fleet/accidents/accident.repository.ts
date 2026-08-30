import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import {
  fleetAccidentRemaining,
  type FleetAccidentTotalsDto,
  type Paginated,
} from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { FleetAccidentModel, type FleetAccidentDoc } from './accident.model';

/** What `$group` hands back for one filter scope; absent entirely when nothing matched. */
interface TotalsRow {
  count: number;
  amountCollected: number;
  companyCost: number;
  paidAmount: number;
}

const NOTHING: TotalsRow = { count: 0, amountCollected: 0, companyCost: 0, paidAmount: 0 };

class FleetAccidentRepository extends BaseRepository<FleetAccidentDoc> {
  constructor() {
    super(FleetAccidentModel, {});
  }

  async listAccidents(params: ListParams<FleetAccidentDoc>): Promise<Paginated<FleetAccidentDoc>> {
    return this.list({ ...params, sortableFields: ['occurredAt', 'createdAt'] });
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
    culprit?: string | undefined;
    status?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): FilterQuery<FleetAccidentDoc> {
    const clauses: FilterQuery<FleetAccidentDoc>[] = [];
    if (query.vehicleId !== undefined) {
      clauses.push({ vehicleId: new Types.ObjectId(query.vehicleId) });
    }
    if (query.vehicleIds !== undefined) {
      clauses.push({ vehicleId: { $in: query.vehicleIds.map((id) => new Types.ObjectId(id)) } });
    }
    // Escaped, so `.` and `*` are the characters the reader typed rather than a pattern they did
    // not write — a search box is not a regex console, and an unescaped `.*` would match all.
    if (query.culprit !== undefined) {
      clauses.push({
        culprit: new RegExp(query.culprit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      });
    }
    if (query.status !== undefined) clauses.push({ status: query.status });
    if (query.from !== undefined) clauses.push({ occurredAt: { $gte: query.from } });
    if (query.to !== undefined) clauses.push({ occurredAt: { $lte: query.to } });
    return clauses.length === 0 ? {} : { $and: clauses };
  }
}

export const fleetAccidentRepository = new FleetAccidentRepository();
