// The custody ledger (العهدة): everything the fund paid, summed — «شاشه العهده اللى فيها التجميعه
// بتاعت مصروفات العهده».
//
// One collection feeds it and nothing is copied: the receipts whose source is the fund — «صيانة»,
// fuel from custody, tyres, washing. They are read with the board's filters and summed here — the
// ledger is a VIEW over the receipts screen that writes it, so it can never disagree with it. A
// dealership invoice («التوكيل») is saved as entered and moves nothing: it is never read here.
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
import { fleetReceiptRepository } from '../receipts/receipt.repository';
import { FleetReceiptModel } from '../receipts/receipt.model';
import { sortCustodyMovements } from './custody-sort';
import { custodyDashboard, custodyMemoStateOf } from './custody-dashboard';
import { readCustodyFundTerms, type CustodyFundTerms } from './custody-fund';
import { FleetCustodyMemoModel } from './custody-memo.model';

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * «إجمالي العهدة» and the two sums its card reads — «صُرف من إجمالي الشحن» is `fundSpent /
 * fundCharged`. The fund's, not the board's: no filter changes any of them.
 */
const fundFigures = (
  terms: CustodyFundTerms,
): Pick<FleetCustodySummaryDto, 'fundTotal' | 'fundCharged' | 'fundSpent'> => ({
  fundTotal: terms.fundTotal,
  fundCharged: terms.charged.amount,
  fundSpent: terms.spent.amount,
});

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
  /** «كل الحركات»'s detail column — a receipt has none, so always `null`. */
  detail: null;
  /** A fuel receipt's litres — the dashboard's, never on «كل الحركات». */
  litres: number | null;
  /** Whether a receipt has its photo — the dashboard's alert, never on «كل الحركات». */
  hasImage: boolean;
  amount: number;
  /** The memo holding the receipt, `null` when none — the dashboard's, never on «كل الحركات». */
  memoId: string | null;
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

/** Each movement with its car's code, from the registry — one read for all of them. */
const withCodes = async (rows: Movement[]): Promise<Movement[]> => {
  const codes = await fleetVehicleRepository.codesByIds([
    ...new Set(rows.flatMap((row) => (row.vehicleId === null ? [] : [row.vehicleId]))),
  ]);
  for (const row of rows) {
    if (row.vehicleId !== null) row.vehicleCode = codes.get(row.vehicleId) ?? null;
  }
  return rows;
};

/**
 * Which of the memos the movements name are replenished — where each movement stands against the
 * memos («تمت الاستعاضة» / «في مذكرات لم تُستعَض» / «خارج المذكرات»): ONE read of the live memos
 * the rows name, their `replenishmentId` only. The dashboard's alone: the figures and «كل الحركات»
 * never pay for it. It needs the rows' `memoId`s only, so it runs beside the cars' codes.
 */
const replenishedMemos = async (rows: readonly Movement[]): Promise<Map<string, boolean>> => {
  const ids = [...new Set(rows.flatMap((row) => (row.memoId === null ? [] : [row.memoId])))];
  const memos =
    ids.length === 0
      ? []
      : await FleetCustodyMemoModel.find({
          _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
          isDeleted: false,
        })
          .select({ replenishmentId: 1 })
          .lean<{ _id: Types.ObjectId; replenishmentId?: Types.ObjectId | null }[]>()
          .exec();
  return new Map(memos.map((memo) => [String(memo._id), memo.replenishmentId != null]));
};

/**
 * «السجل» of one line of «ملخص لكل سيارة»: the registry's car by its id. A code from the old book
 * (`bookCode`) is still read, so an older link answers — with nothing, as below.
 */
interface CustodyCar {
  vehicleId?: string | undefined;
  bookCode?: string | undefined;
}

/**
 * The car as one more clause over the board's filters — over, never instead of: the board's cars,
 * dates, kinds and driver still hold. A receipt is always on a registry car, so a book code
 * matches none; both given, both must hold, which nothing does.
 */
const carClause = (car: CustodyCar | undefined): FilterQuery<unknown> => {
  if (car === undefined) return {};
  const clauses: FilterQuery<unknown>[] = [];
  if (car.vehicleId !== undefined) clauses.push({ vehicleId: new Types.ObjectId(car.vehicleId) });
  if (car.bookCode !== undefined) clauses.push({ vehicleId: null, vehicleCode: car.bookCode });
  return clauses.length === 0 ? {} : { $and: clauses };
};

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
    return withCodes(await this.receiptsFor(query, vehicleIds, car));
  }

  /** The movements as the receipts hold them — every car's code still to be named (`withCodes`). */
  private async receiptsFor(
    query: FleetCustodySummaryQuery,
    vehicleIds: readonly string[] | undefined,
    car?: CustodyCar,
  ): Promise<Movement[]> {
    const onCar = carClause(car);
    // Every custody kind IS a receipt kind: the chosen ones, or every kind when none is chosen.
    const filter = fleetReceiptRepository.receiptFilter({
      vehicleIds,
      kind: query.source,
      source: 'custody',
      driver: query.driver,
      from: query.from,
      to: query.to,
    });
    const docs = await FleetReceiptModel.find({ isDeleted: false, $and: [filter, onCar] })
      .sort({ date: -1, createdAt: -1 })
      .lean()
      .exec();
    return docs.map((doc) => ({
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
      memoId: doc.memoId == null ? null : String(doc.memoId),
    }));
  }

  /**
   * The figures and «ملخص لكل سيارة» — over the whole filtered set — and the fund they are drawn
   * from («إجمالي العهدة»), which no filter changes.
   */
  async summary(query: FleetCustodySummaryQuery): Promise<FleetCustodySummaryDto> {
    const [rows, terms] = await Promise.all([
      this.vehicleIdsFor(query).then((vehicleIds) => this.movementsFor(query, vehicleIds)),
      readCustodyFundTerms(),
    ]);
    return { ...this.fold(rows), ...fundFigures(terms) };
  }

  /**
   * «لوحة تحكم» — the figures, then everything else about the same movements. One read, one fold:
   * its summary fields ARE `/summary`'s for the same filters, by construction. The memos the rows
   * name are read once more, for `memoStates`.
   */
  async dashboard(query: FleetCustodyDashboardQuery): Promise<FleetCustodyDashboardDto> {
    const vehicleIds = await this.vehicleIdsFor(query);
    const [rows, terms] = await Promise.all([
      this.receiptsFor(query, vehicleIds).then(async (found) => {
        const [named, replenished] = await Promise.all([withCodes(found), replenishedMemos(found)]);
        return named.map((row) => ({
          ...row,
          memoState: custodyMemoStateOf(row.memoId, replenished),
        }));
      }),
      readCustodyFundTerms(),
    ]);
    return { ...this.fold(rows), ...fundFigures(terms), ...custodyDashboard(rows, query) };
  }

  /** The figures and the per-car lines of a set of movements — everything but the fund. */
  private fold(
    rows: readonly Movement[],
  ): Omit<FleetCustodySummaryDto, 'fundTotal' | 'fundCharged' | 'fundSpent'> {
    const perVehicle = new Map<string, FleetCustodyVehicleRowDto>();
    const totals = { maintenance: 0, fuel: 0, tyres: 0, wash: 0 };
    for (const row of rows) {
      totals[row.source] += row.amount;
      const key = row.vehicleId ?? `code:${row.vehicleCode ?? ''}`;
      const line = perVehicle.get(key) ?? {
        vehicleId: row.vehicleId,
        vehicleCode: row.vehicleCode,
        maintenance: 0,
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
        maintenance: round(line.maintenance),
        fuel: round(line.fuel),
        tyres: round(line.tyres),
        wash: round(line.wash),
        total: round(line.total),
      }))
      .sort((a, b) => compareFleetVehicleCodes(a.vehicleCode ?? '', b.vehicleCode ?? ''));
    return {
      count: rows.length,
      total: round(totals.maintenance + totals.fuel + totals.tyres + totals.wash),
      maintenance: round(totals.maintenance),
      fuel: round(totals.fuel),
      tyres: round(totals.tyres),
      wash: round(totals.wash),
      vehicles,
    };
  }

  /**
   * «كل الحركات» — one page of the ledger, in the arrows' order over the WHOLE filtered set
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
