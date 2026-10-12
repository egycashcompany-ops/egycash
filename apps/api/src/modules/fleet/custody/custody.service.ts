// The custody ledger (العهدة): everything the fund paid, summed — «شاشه العهده اللى فيها التجميعه
// بتاعت مصروفات العهده».
//
// Two collections feed it and nothing is copied: the receipts whose source is the fund (fuel from
// custody, tyres, washing) and the dealership rows on the custody side (a private car's bill with
// no invoice number). Both are read with the same filters, merged, and summed here — the ledger is
// a VIEW over the two screens that write it, so it can never disagree with either.
import { type FilterQuery } from 'mongoose';
import {
  compareFleetVehicleCodes,
  parseFleetSort,
  type FleetCustodyDashboardDto,
  type FleetCustodyDashboardQuery,
  type FleetCustodyMovementDto,
  type FleetCustodySource,
  type FleetCustodySummaryDto,
  type FleetCustodySummaryQuery,
  type FleetCustodyVehicleRowDto,
  type FleetFuelType,
  type ListFleetCustodyMovementsQuery,
  type Paginated,
} from '@ecms/contracts';

import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetDealershipRepository } from '../dealership/dealership.repository';
import { FleetDealershipInvoiceModel } from '../dealership/dealership.model';
import { fleetReceiptRepository } from '../receipts/receipt.repository';
import { FleetReceiptModel } from '../receipts/receipt.model';
import { sortCustodyMovements } from './custody-sort';
import { custodyDashboard } from './custody-dashboard';

const round = (value: number): number => Math.round(value * 100) / 100;

/** One line before the car's code is joined in. */
interface Movement {
  id: string;
  ref: FleetCustodyMovementDto['ref'];
  source: FleetCustodySource;
  date: Date;
  vehicleId: string | null;
  vehicleCode: string | null;
  driverEmployeeId: string | null;
  driverName: string | null;
  fuelType: FleetFuelType | null;
  detail: string | null;
  /** A fuel receipt's litres — the dashboard's, never on «كل الحركات». */
  litres: number | null;
  amount: number;
}

/** A movement as «كل الحركات» lists it — field by field, so nothing the dashboard reads leaks out. */
const toMovementDto = (row: Movement): FleetCustodyMovementDto => ({
  id: row.id,
  ref: row.ref,
  source: row.source,
  date: row.date.toISOString(),
  vehicleId: row.vehicleId,
  vehicleCode: row.vehicleCode,
  driverEmployeeId: row.driverEmployeeId,
  driverName: row.driverName,
  fuelType: row.fuelType,
  detail: row.detail,
  amount: row.amount,
});

const RECEIPT_SOURCES: readonly FleetCustodySource[] = ['fuel', 'tyres', 'wash'];

class FleetCustodyService {
  /** Every movement the filters match, newest first — the set both the figures and the page cut. */
  private async movementsFor(query: FleetCustodySummaryQuery): Promise<Movement[]> {
    const vehicleIds =
      query.vehicleCodes === undefined
        ? undefined
        : await fleetVehicleRepository.idsByCodes(query.vehicleCodes);
    // The receipt kinds among the chosen sources — or every kind when no source is chosen.
    const receiptKinds =
      query.source === undefined
        ? undefined
        : (query.source.filter((source) => RECEIPT_SOURCES.includes(source)) as (
            'fuel' | 'tyres' | 'wash'
          )[]);
    const wantsReceipts = receiptKinds === undefined || receiptKinds.length > 0;
    // A dealership bill names no driver, so a driver filter leaves the bills out.
    const wantsDealership =
      (query.source === undefined || query.source.includes('dealership')) &&
      query.driver === undefined;

    const receipts: Movement[] = [];
    if (wantsReceipts) {
      const filter = fleetReceiptRepository.receiptFilter({
        vehicleIds,
        kind: receiptKinds,
        source: 'custody',
        driver: query.driver,
        from: query.from,
        to: query.to,
      });
      const docs = await FleetReceiptModel.find({ isDeleted: false, ...filter })
        .sort({ date: -1, createdAt: -1 })
        .lean()
        .exec();
      for (const doc of docs) {
        receipts.push({
          id: String(doc._id),
          ref: 'receipt',
          source: doc.kind,
          date: doc.date,
          vehicleId: String(doc.vehicleId),
          vehicleCode: null,
          driverEmployeeId: doc.driverEmployeeId == null ? null : String(doc.driverEmployeeId),
          driverName: doc.driverName ?? null,
          fuelType: doc.fuelType ?? null,
          detail: null,
          litres: doc.litres ?? null,
          amount: doc.amount,
        });
      }
    }

    const bills: Movement[] = [];
    if (wantsDealership) {
      const filter: FilterQuery<unknown> = fleetDealershipRepository.dealershipFilter({
        vehicleIds,
        vehicleCodes: query.vehicleCodes,
        side: 'custody',
        from: query.from,
        to: query.to,
      });
      const docs = await FleetDealershipInvoiceModel.find({ isDeleted: false, ...filter })
        .sort({ outDate: -1, createdAt: -1 })
        .lean()
        .exec();
      for (const doc of docs) {
        bills.push({
          id: String(doc._id),
          ref: 'dealershipInvoice',
          source: 'dealership',
          date: doc.outDate,
          vehicleId: doc.vehicleId == null ? null : String(doc.vehicleId),
          vehicleCode: doc.vehicleId == null ? (doc.vehicleCode ?? null) : null,
          driverEmployeeId: null,
          driverName: null,
          fuelType: null,
          detail: doc.workTypeLabel,
          litres: null,
          amount: doc.invoiceAmount ?? 0,
        });
      }
    }

    const all = [...receipts, ...bills].sort((a, b) => b.date.getTime() - a.date.getTime());
    const codes = await fleetVehicleRepository.codesByIds([
      ...new Set(all.flatMap((row) => (row.vehicleId === null ? [] : [row.vehicleId]))),
    ]);
    for (const row of all) {
      if (row.vehicleId !== null) row.vehicleCode = codes.get(row.vehicleId) ?? null;
    }
    return all;
  }

  /** The figures and «ملخص لكل سيارة» — over the whole filtered set. */
  async summary(query: FleetCustodySummaryQuery): Promise<FleetCustodySummaryDto> {
    return this.fold(await this.movementsFor(query));
  }

  /**
   * «لوحة تحكم» — the figures, then everything else about the same movements. One read, one fold:
   * its summary fields ARE `/summary`'s for the same filters, by construction.
   */
  async dashboard(query: FleetCustodyDashboardQuery): Promise<FleetCustodyDashboardDto> {
    const rows = await this.movementsFor(query);
    return { ...this.fold(rows), ...custodyDashboard(rows, query) };
  }

  /** The figures and the per-car lines of a set of movements. */
  private fold(rows: readonly Movement[]): FleetCustodySummaryDto {
    const perVehicle = new Map<string, FleetCustodyVehicleRowDto>();
    const totals = { dealership: 0, fuel: 0, tyres: 0, wash: 0 };
    for (const row of rows) {
      totals[row.source] += row.amount;
      const key = row.vehicleId ?? `code:${row.vehicleCode ?? ''}`;
      const line = perVehicle.get(key) ?? {
        vehicleId: row.vehicleId,
        vehicleCode: row.vehicleCode,
        dealership: 0,
        fuel: 0,
        tyres: 0,
        wash: 0,
        total: 0,
      };
      line[row.source] += row.amount;
      line.total += row.amount;
      perVehicle.set(key, line);
    }
    const vehicles = [...perVehicle.values()]
      .map((line) => ({
        ...line,
        dealership: round(line.dealership),
        fuel: round(line.fuel),
        tyres: round(line.tyres),
        wash: round(line.wash),
        total: round(line.total),
      }))
      .sort((a, b) => compareFleetVehicleCodes(a.vehicleCode ?? '', b.vehicleCode ?? ''));
    return {
      count: rows.length,
      total: round(totals.dealership + totals.fuel + totals.tyres + totals.wash),
      dealership: round(totals.dealership),
      fuel: round(totals.fuel),
      tyres: round(totals.tyres),
      wash: round(totals.wash),
      vehicles,
    };
  }

  /**
   * «كل الحركات» — one page of the merged list, in the arrows' order over the WHOLE filtered set
   * (newest first when none is chosen). The order never changes which rows are counted.
   */
  async movements(
    query: ListFleetCustodyMovementsQuery,
  ): Promise<Paginated<FleetCustodyMovementDto>> {
    const { page, pageSize, sortBy, sortDir, sort, ...filters } = query;
    // The whole order when the request carries one; else the platform's single column, which an
    // older client still sends.
    const chosen = parseFleetSort(sort);
    const sorts =
      chosen.length > 0 ? chosen : sortBy !== undefined ? [{ by: sortBy, dir: sortDir }] : [];
    const rows = sortCustodyMovements(await this.movementsFor(filters), sorts);
    const start = (page - 1) * pageSize;
    return {
      items: rows.slice(start, start + pageSize).map(toMovementDto),
      meta: {
        page,
        pageSize,
        totalItems: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / pageSize)),
      },
    };
  }
}

export const fleetCustodyService = new FleetCustodyService();
