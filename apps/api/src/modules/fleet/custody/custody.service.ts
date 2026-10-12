// The custody ledger (العهدة): everything the fund paid, summed — «شاشه العهده اللى فيها التجميعه
// بتاعت مصروفات العهده».
//
// Two collections feed it and nothing is copied: the receipts whose source is the fund (fuel from
// custody, tyres, washing) and the dealership rows on the custody side (a private car's bill with
// no invoice number). Both are read with the same filters, merged, and summed here — the ledger is
// a VIEW over the two screens that write it, so it can never disagree with either.
import { Types, type FilterQuery } from 'mongoose';
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
  type FleetFuelCardCompany,
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
import { custodyDashboard, type CustodyPendingPrivateBills } from './custody-dashboard';

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
  /** A fuel receipt's «الشركة» — the company badge on «كل الحركات» and the dashboard's split. */
  company: FleetFuelCardCompany | null;
  detail: string | null;
  /** A fuel receipt's litres — the dashboard's, never on «كل الحركات». */
  litres: number | null;
  /** Whether a receipt has its photo — the dashboard's alert, never on «كل الحركات». */
  hasImage: boolean;
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
  company: row.company,
  detail: row.detail,
  amount: row.amount,
});

const RECEIPT_SOURCES: readonly FleetCustodySource[] = ['fuel', 'tyres', 'wash'];

/**
 * «السجل» of one line of «ملخص لكل سيارة»: the registry's car by its id, or a line kept from the
 * old book on a car the registry never had by its code — whole, as the line was keyed.
 */
interface CustodyCar {
  vehicleId?: string | undefined;
  bookCode?: string | undefined;
}

/**
 * The car as one more clause over the board's filters — over, never instead of: the board's cars,
 * dates, kinds and driver still hold. A book code is a bill's alone (a receipt is always on a
 * registry car), so it matches no receipt; both given, both must hold, which nothing does.
 */
const carClause = (car: CustodyCar | undefined): FilterQuery<unknown> => {
  if (car === undefined) return {};
  const clauses: FilterQuery<unknown>[] = [];
  if (car.vehicleId !== undefined) clauses.push({ vehicleId: new Types.ObjectId(car.vehicleId) });
  if (car.bookCode !== undefined) clauses.push({ vehicleId: null, vehicleCode: car.bookCode });
  return clauses.length === 0 ? {} : { $and: clauses };
};

/** A dealership bill names no driver, so a driver filter leaves the bills out — as a source does. */
const wantsDealership = (query: FleetCustodySummaryQuery): boolean =>
  (query.source === undefined || query.source.includes('dealership')) && query.driver === undefined;

class FleetCustodyService {
  /** The typed car codes as ids — `undefined` when no car is chosen, `[]` when none matches. */
  private async vehicleIdsFor(
    query: FleetCustodySummaryQuery,
  ): Promise<readonly string[] | undefined> {
    return query.vehicleCodes === undefined
      ? undefined
      : fleetVehicleRepository.idsByCodes(query.vehicleCodes);
  }

  /**
   * Every movement the filters match, newest first — the set both the figures and the page cut.
   * `car` narrows it to one line of «ملخص لكل سيارة» («السجل»); the figures never pass one.
   */
  private async movementsFor(
    query: FleetCustodySummaryQuery,
    vehicleIds: readonly string[] | undefined,
    car?: CustodyCar,
  ): Promise<Movement[]> {
    const onCar = carClause(car);
    // The receipt kinds among the chosen sources — or every kind when no source is chosen.
    const receiptKinds =
      query.source === undefined
        ? undefined
        : (query.source.filter((source) => RECEIPT_SOURCES.includes(source)) as (
            'fuel' | 'tyres' | 'wash'
          )[]);
    const wantsReceipts = receiptKinds === undefined || receiptKinds.length > 0;

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
      const docs = await FleetReceiptModel.find({ isDeleted: false, $and: [filter, onCar] })
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
          company: doc.company ?? null,
          detail: null,
          litres: doc.litres ?? null,
          hasImage: doc.image != null,
          amount: doc.amount,
        });
      }
    }

    const bills: Movement[] = [];
    if (wantsDealership(query)) {
      const filter: FilterQuery<unknown> = fleetDealershipRepository.dealershipFilter({
        vehicleIds,
        vehicleCodes: query.vehicleCodes,
        side: 'custody',
        from: query.from,
        to: query.to,
      });
      const docs = await FleetDealershipInvoiceModel.find({
        isDeleted: false,
        $and: [filter, onCar],
      })
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
          company: null,
          detail: doc.workTypeLabel,
          litres: null,
          hasImage: doc.image != null,
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
    return this.fold(await this.movementsFor(query, await this.vehicleIdsFor(query)));
  }

  /**
   * «لوحة تحكم» — the figures, then everything else about the same movements. One read, one fold:
   * its summary fields ARE `/summary`'s for the same filters, by construction.
   */
  async dashboard(query: FleetCustodyDashboardQuery): Promise<FleetCustodyDashboardDto> {
    const vehicleIds = await this.vehicleIdsFor(query);
    const [rows, pending] = await Promise.all([
      this.movementsFor(query, vehicleIds),
      this.pendingPrivateBills(query, vehicleIds),
    ]);
    return { ...this.fold(rows), ...custodyDashboard(rows, query, pending) };
  }

  /**
   * «2 فواتير ملاكي بانتظار الفاتورة — أقدمها من 4 أيام»: a private car's («ملاكي») dealership bill
   * whose invoice has not come yet — no amount, so no side, and so not a movement of the fund. Only
   * how many and the oldest exit: «تكلفة معلقة» has no amount to show until the invoice is written.
   * Read by exit date over the board's dates and cars, the deleted ones never; a driver filter, or
   * a source filter without the dealership, leaves them out exactly as it leaves the bills out.
   */
  private async pendingPrivateBills(
    query: FleetCustodySummaryQuery,
    vehicleIds: readonly string[] | undefined,
  ): Promise<CustodyPendingPrivateBills> {
    if (!wantsDealership(query)) return { count: 0, oldestOutDate: null };
    const filter: FilterQuery<unknown> = fleetDealershipRepository.dealershipFilter({
      vehicleIds,
      vehicleCodes: query.vehicleCodes,
      pending: true,
      from: query.from,
      to: query.to,
    });
    const [row] = await FleetDealershipInvoiceModel.aggregate<{ count: number; oldest: Date }>([
      { $match: { isDeleted: false, privateCar: true, ...filter } },
      { $group: { _id: null, count: { $sum: 1 }, oldest: { $min: '$outDate' } } },
    ]).exec();
    return { count: row?.count ?? 0, oldestOutDate: row?.oldest ?? null };
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
    const { page, pageSize, sortBy, sortDir, sort, vehicleId, bookCode, ...filters } = query;
    // The whole order when the request carries one; else the platform's single column, which an
    // older client still sends.
    const chosen = parseFleetSort(sort);
    const sorts =
      chosen.length > 0 ? chosen : sortBy !== undefined ? [{ by: sortBy, dir: sortDir }] : [];
    const rows = sortCustodyMovements(
      await this.movementsFor(filters, await this.vehicleIdsFor(filters), { vehicleId, bookCode }),
      sorts,
    );
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
