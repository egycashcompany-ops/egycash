import { Types, type ClientSession, type FilterQuery, type PipelineStage } from 'mongoose';
import {
  type FleetReceiptKind,
  type FleetReceiptSource,
  type FleetReceiptTotalsDto,
} from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { VEHICLE_CODE_SORT } from '../vehicles/vehicle.repository';
import { FleetReceiptModel, type FleetReceiptDoc } from './receipt.model';

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const round = (value: number): number => Math.round(value * 100) / 100;

interface TotalsRow {
  _id: { kind: FleetReceiptKind; source: FleetReceiptSource };
  count: number;
  amount: number;
  litres: number;
}

export interface ReceiptFilterInput {
  /** Resolved from the typed codes; `[]` narrows to nothing, as every id list on this module does. */
  vehicleIds?: readonly string[] | undefined;
  kind?: FleetReceiptKind | undefined;
  source?: FleetReceiptSource | undefined;
  driver?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

class FleetReceiptRepository extends BaseRepository<FleetReceiptDoc> {
  constructor() {
    // No org placement of its own: a receipt is paperwork about a car, and who may read it is
    // decided by `fleetReceipt.view` alone.
    super(FleetReceiptModel, {});
  }

  /** The filter the list and the totals share — the rows behind the figures ARE the table's. */
  receiptFilter(query: ReceiptFilterInput): FilterQuery<FleetReceiptDoc> {
    const clauses: FilterQuery<FleetReceiptDoc>[] = [];
    if (query.vehicleIds !== undefined) {
      clauses.push({ vehicleId: { $in: query.vehicleIds.map((id) => new Types.ObjectId(id)) } });
    }
    if (query.kind !== undefined) clauses.push({ kind: query.kind });
    if (query.source !== undefined) clauses.push({ source: query.source });
    if (query.driver !== undefined) {
      clauses.push({ driverName: { $regex: escapeRegex(query.driver), $options: 'i' } });
    }
    if (query.from !== undefined) clauses.push({ date: { $gte: query.from } });
    if (query.to !== undefined) clauses.push({ date: { $lte: query.to } });
    return clauses.length === 0 ? {} : { $and: clauses };
  }

  async listReceipts(params: ListParams<FleetReceiptDoc>) {
    return this.list({
      ...params,
      sortableFields: [
        'date',
        'createdAt',
        'amount',
        'litres',
        'kind',
        'source',
        'driverName',
        VEHICLE_CODE_SORT.key,
      ],
      sortDerived: [VEHICLE_CODE_SORT],
    });
  }

  /** One live receipt, read inside `session` — its card is credited against what it IS now. */
  async findLive(id: string, session: ClientSession): Promise<FleetReceiptDoc | null> {
    return this.model
      .findOne({ _id: new Types.ObjectId(id), isDeleted: false })
      .session(session)
      .lean<FleetReceiptDoc>()
      .exec();
  }

  /** The figures over EVERY row `filter` matches — in the database, never over a page. */
  async totals(filter: FilterQuery<FleetReceiptDoc>): Promise<FleetReceiptTotalsDto> {
    const pipeline: PipelineStage[] = [
      { $match: this.baseFilter(undefined, filter) },
      {
        $group: {
          _id: { kind: '$kind', source: '$source' },
          count: { $sum: 1 },
          amount: { $sum: '$amount' },
          litres: { $sum: { $ifNull: ['$litres', 0] } },
        },
      },
    ];
    const rows = await this.model.aggregate<TotalsRow>(pipeline).exec();
    const sum = (pick: (row: TotalsRow) => boolean, of: (row: TotalsRow) => number): number =>
      round(rows.filter(pick).reduce((total, row) => total + of(row), 0));
    return {
      count: rows.reduce((total, row) => total + row.count, 0),
      custodyTotal: sum(
        (row) => row._id.source === 'custody',
        (row) => row.amount,
      ),
      cardTotal: sum(
        (row) => row._id.source === 'card',
        (row) => row.amount,
      ),
      fuelTotal: sum(
        (row) => row._id.kind === 'fuel',
        (row) => row.amount,
      ),
      fuelLitres: sum(
        (row) => row._id.kind === 'fuel',
        (row) => row.litres,
      ),
      tyresTotal: sum(
        (row) => row._id.kind === 'tyres',
        (row) => row.amount,
      ),
      washTotal: sum(
        (row) => row._id.kind === 'wash',
        (row) => row.amount,
      ),
    };
  }
}

export const fleetReceiptRepository = new FleetReceiptRepository();
