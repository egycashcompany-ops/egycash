import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import { type FleetDealershipSide, type FleetDealershipTotalsDto } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { VEHICLE_CODE_SORT } from '../vehicles/vehicle.repository';
import { byVehicleOrBookCode } from '../odometer/odometer.repository';
import { FleetDealershipInvoiceModel, type FleetDealershipInvoiceDoc } from './dealership.model';

interface TotalsRow {
  _id: FleetDealershipSide | null;
  count: number;
  amount: number;
}

class FleetDealershipRepository extends BaseRepository<FleetDealershipInvoiceDoc> {
  constructor() {
    // No org placement of its own: a bill is paperwork about a car, and who may read it is
    // decided by `fleetDealership.view` alone.
    super(FleetDealershipInvoiceModel, {});
  }

  /** The filter the list and the totals share — the rows behind the figures ARE the table's. */
  dealershipFilter(query: {
    /** Resolved from the typed codes; `[]` narrows to nothing, as every id list on this module does. */
    vehicleIds?: readonly string[] | undefined;
    vehicleCodes?: readonly string[] | undefined;
    side?: FleetDealershipSide | undefined;
    pending?: boolean | undefined;
    workKind?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }): FilterQuery<FleetDealershipInvoiceDoc> {
    const clauses: FilterQuery<FleetDealershipInvoiceDoc>[] = [];
    if (query.vehicleIds !== undefined) {
      clauses.push(byVehicleOrBookCode(query.vehicleIds, query.vehicleCodes));
    }
    if (query.side !== undefined) clauses.push({ side: query.side });
    if (query.pending !== undefined) {
      clauses.push({ invoiceAmount: query.pending ? null : { $ne: null } });
    }
    if (query.workKind !== undefined) clauses.push({ workKind: query.workKind });
    if (query.from !== undefined) clauses.push({ outDate: { $gte: query.from } });
    if (query.to !== undefined) clauses.push({ outDate: { $lte: query.to } });
    return clauses.length === 0 ? {} : { $and: clauses };
  }

  async listInvoices(
    params: ListParams<FleetDealershipInvoiceDoc>,
  ): Promise<ReturnType<BaseRepository<FleetDealershipInvoiceDoc>['list']>> {
    return this.list({
      ...params,
      sortableFields: [
        'outDate',
        'createdAt',
        'invoiceAmount',
        'invoiceNumber',
        'workTypeLabel',
        VEHICLE_CODE_SORT.key,
      ],
      sortDerived: [VEHICLE_CODE_SORT],
    });
  }

  /**
   * The figures over EVERY row `filter` matches — in the database, never over a page. `baseFilter`
   * is the same soft-delete gate the list passes through.
   */
  async totals(filter: FilterQuery<FleetDealershipInvoiceDoc>): Promise<FleetDealershipTotalsDto> {
    const pipeline: PipelineStage[] = [
      { $match: this.baseFilter(undefined, filter) },
      {
        $group: {
          _id: '$side',
          count: { $sum: 1 },
          amount: { $sum: { $ifNull: ['$invoiceAmount', 0] } },
        },
      },
    ];
    const rows = await this.model.aggregate<TotalsRow>(pipeline).exec();
    const of = (side: FleetDealershipSide | null): TotalsRow | undefined =>
      rows.find((row) => row._id === side);
    const round = (value: number): number => Math.round(value * 100) / 100;
    return {
      count: rows.reduce((sum, row) => sum + row.count, 0),
      pending: of(null)?.count ?? 0,
      dealershipTotal: round(of('dealership')?.amount ?? 0),
      custodyTotal: round(of('custody')?.amount ?? 0),
    };
  }

  /** The rows a visit opened that are still waiting for an invoice — what a reopen withdraws. */
  async pendingOfVisit(visitId: string): Promise<FleetDealershipInvoiceDoc[]> {
    return this.model
      .find({ visitId: new Types.ObjectId(visitId), invoiceAmount: null, isDeleted: false })
      .lean<FleetDealershipInvoiceDoc[]>()
      .exec();
  }

  /** Does this visit already have rows? A second check-out of the same visit must not double them. */
  async hasRowsForVisit(visitId: string): Promise<boolean> {
    const count = await this.model
      .countDocuments({ visitId: new Types.ObjectId(visitId), isDeleted: false })
      .exec();
    return count > 0;
  }
}

export const fleetDealershipRepository = new FleetDealershipRepository();
