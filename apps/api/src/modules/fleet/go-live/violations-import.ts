// The go-live VIOLATIONS import: the legacy `car_violations` collection — two shapes in one
// bucket — turned into the two ledgers. Importable and side-effect free until
// `applyViolationsImport`; `violations.ts` runs it at boot.
//
// TWO SHAPES, told apart by which fields a row carries. The old screen wrote the company's
// statement rows and the drivers' fines into one collection with different keys:
//
//   COMPANY (kind `vehicle`)                    DRIVER (kind `driver`)
//   car_code           → the vehicle, by code   car_code         → the vehicle, by code
//   date_car           → year (its year only)   date_driver      → date
//   type               → the `violationType`    violation_driver → the `violationType` catalog,
//                        catalog, company side                     driver side; «ت» and «ح» are
//   num                → count                                     the old UI's shorthand for
//   value_violationCar → unitValue                                 «تليفون» and «حزام»
//   amount             → recomputed count × unitValue (FR-9 —      amount           → amount
//                        the model derives it; the book agrees)  driver           → driverEmployeeId,
//   done               → collected                                                   by NAME
//   total_before_grievance → the (vehicle, year) grievance row   done             → collected
//
// `added_by`, `violation_car` (a copy of `type`), `createdAt`, `updatedAt` and `__v` do not travel.
//
// THE YEAR IS THE FACT for a statement row — H8's fate, `violation.model.ts` — so `date_car` is
// read for its year and nothing else. THE GRIEVANCE is one figure per (vehicle, year) in its own
// collection — H9's fate — and the book stamped it on every row of that year; the rows agree,
// and the figure is written once.
//
// WHAT IS NOT WRITTEN, and listed instead: a statement row with a count of zero (eight of them,
// all blank), and a row whose type is blank or not in the catalog on that side — the violation
// types are the one catalog the owner asked to keep as it is («ما عدا أنواع المخالفات»), so
// nothing is added to it here. A row on a car the registry never had IS written, by the book's
// code (`book-ref.ts`); its grievance figure, keyed on a vehicle, cannot be and is listed.
//
// DRIVERS ARE NAMES, as in the other books, with the same answer: matched, or the NAME KEPT ON
// THE ROW AS TEXT and listed for HR. A fine is history; it is not less a fine for HR not knowing
// the spelling.
import { Types } from 'mongoose';
import { type FleetViolationSide } from '@ecms/contracts';
import { fleetCatalogItemRepository } from '../catalogs';
import { fleetGrievanceRepository, fleetViolationRepository } from '../violations/violation.repository';
import { type FleetViolationDoc } from '../violations/violation.model';
import { day, driverRef, isPlaceholderDriver } from './odometer-import';
import { bookRefFields, bookRefOf, type BookRef } from './book-ref';
import { failureReason, fold } from './vehicles-import';

/** One legacy row, exactly as the export writes it. Everything is optional; nothing is trusted. */
interface LegacyViolation {
  _id?: { $oid?: string } | string;
  car_code?: string;
  date_car?: { $date?: string } | string;
  type?: string;
  num?: string | number;
  value_violationCar?: string | number;
  amount?: string | number;
  done?: number | null;
  total_before_grievance?: string | number;
  date_driver?: { $date?: string } | string;
  driver?: string;
  violation_driver?: string;
  deleted?: number;
}

export interface ParsedCompanyViolation {
  id: string;
  code: string;
  year: number;
  type: string | null;
  count: number;
  unitValue: number;
  collected: boolean;
  /** The (vehicle, year) figure the book stamped on this row; 0 = none. */
  grievance: number;
}

export interface ParsedDriverViolation {
  id: string;
  code: string;
  date: Date;
  type: string;
  amount: number;
  driver: string | null;
  collected: boolean;
}

export interface ParseViolationsResult {
  company: ParsedCompanyViolation[];
  driver: ParsedDriverViolation[];
  skippedDeleted: number;
  rejected: { id: string; reason: string }[];
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Money or a count as the book wrote it: a number, or digits with an optional fraction. */
const figure = (value: unknown): number | 'invalid' => {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : 'invalid';
  const raw = text(value);
  if (raw === null) return 'invalid';
  return /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : 'invalid';
};

const legacyDate = (value: LegacyViolation['date_car']): Date | null => {
  const raw = typeof value === 'string' ? value : value?.$date;
  if (typeof raw !== 'string') return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return year < 2000 || year > 2100 ? null : date;
};

const legacyId = (value: LegacyViolation['_id'], index: number): string => {
  if (typeof value === 'string') return value;
  if (value !== undefined && typeof value.$oid === 'string') return value.$oid;
  return `row ${index}`;
};

/**
 * Read the export into its two shapes. A row that cannot be read is REPORTED by legacy id and
 * reason, not refused.
 */
export const parseViolations = (raw: unknown): ParseViolationsResult => {
  const result: ParseViolationsResult = { company: [], driver: [], skippedDeleted: 0, rejected: [] };
  if (!Array.isArray(raw)) {
    result.rejected.push({ id: 'file', reason: 'the export is not a JSON array' });
    return result;
  }
  raw.forEach((entry: LegacyViolation, index) => {
    const id = legacyId(entry._id, index);
    if (entry.deleted === 1) {
      result.skippedDeleted += 1;
      return;
    }
    const code = text(entry.car_code);
    if (code === null) {
      result.rejected.push({ id, reason: 'no car code' });
      return;
    }
    if (entry.violation_driver !== undefined) {
      const date = legacyDate(entry.date_driver);
      if (date === null) {
        result.rejected.push({ id, reason: `${code}: the date cannot be read` });
        return;
      }
      const amount = figure(entry.amount);
      if (amount === 'invalid') {
        result.rejected.push({ id, reason: `${code} ${day(date)}: the amount is not a number` });
        return;
      }
      result.driver.push({
        id,
        code,
        date,
        type: text(entry.violation_driver) ?? '',
        amount,
        driver: text(entry.driver),
        collected: entry.done === 1,
      });
      return;
    }
    const date = legacyDate(entry.date_car);
    if (date === null) {
      result.rejected.push({ id, reason: `${code}: the date cannot be read` });
      return;
    }
    const count = figure(entry.num);
    const unitValue = figure(entry.value_violationCar);
    if (count === 'invalid' || unitValue === 'invalid' || !Number.isInteger(count)) {
      result.rejected.push({ id, reason: `${code} ${date.getUTCFullYear()}: the count or the value is not a number` });
      return;
    }
    const grievance = figure(entry.total_before_grievance ?? 0);
    result.company.push({
      id,
      code,
      year: date.getUTCFullYear(),
      type: text(entry.type),
      count,
      unitValue,
      collected: entry.done === 1,
      grievance: grievance === 'invalid' ? 0 : grievance,
    });
  });
  return result;
};

/** The old UI's one-letter shorthand for two driver-side types, written out as the seed did. */
export const DRIVER_TYPE_ALIASES: Readonly<Record<string, string>> = { ت: 'تليفون', ح: 'حزام' };

/** One violation type as the catalog holds it: which ledger it belongs to, and its id. */
export interface ViolationTypeIndex {
  /** Folded name → { id, side }. */
  byName: Map<string, { id: string; side: FleetViolationSide | null }>;
}

export const loadViolationTypes = async (): Promise<ViolationTypeIndex> => {
  const byName = new Map<string, { id: string; side: FleetViolationSide | null }>();
  for (const item of await fleetCatalogItemRepository.listKind('violationType')) {
    if (!byName.has(fold(item.name.ar))) {
      byName.set(fold(item.name.ar), { id: String(item._id), side: item.violationSide });
    }
  }
  return { byName };
};

export interface PlannedViolation {
  doc: Partial<FleetViolationDoc>;
  key: string;
}

export interface PlannedGrievance {
  vehicleId: string;
  code: string;
  year: number;
  totalBeforeGrievance: number;
}

export interface ViolationsPlan {
  vehicles: { code: string; ref: BookRef; rows: PlannedViolation[] }[];
  grievances: PlannedGrievance[];
  /** Codes the registry does not have — their rows are KEPT by code — with how many rows each. */
  unknownCars: string[];
  /** Grievance figures on such a car — «code year: figure» — which need a vehicle and are not written. */
  grievancesUnplaced: string[];
  /** Statement rows with a count of zero — nothing to file. */
  zeroCount: string[];
  /** Rows whose type is blank, or not in the catalog on that side — «code year/date: type». */
  unknownTypes: string[];
  /** A (vehicle, year) the book stamped with two different grievance figures — the first is kept. */
  grievanceConflicts: string[];
}

/** How a row is told from another: its shape and its facts, never `collected` (a person may tick it later). */
export const violationKey = (doc: Pick<FleetViolationDoc, 'kind' | 'violationTypeId' | 'year' | 'count' | 'unitValue' | 'date' | 'amount' | 'driverEmployeeId'>): string =>
  doc.kind === 'vehicle'
    ? `v|${doc.year}|${String(doc.violationTypeId)}|${doc.count}|${doc.unitValue}`
    : `d|${doc.date?.toISOString() ?? ''}|${String(doc.violationTypeId)}|${doc.amount}|${doc.driverEmployeeId == null ? '' : String(doc.driverEmployeeId)}`;

/** Money to the piastre: `1 × 117.85` must come out as `117.85`, not `117.85000000000001`. */
const egp = (value: number): number => Math.round(value * 100) / 100;

/**
 * Turn both shapes into rows per car, plus the grievance figures. Pure: the registry, the types
 * and the drivers are handed in as maps, so the rule can be tested on rows alone.
 */
export const planViolationsImport = (
  parsed: ParseViolationsResult,
  vehicleIdByCode: ReadonlyMap<string, string>,
  types: ViolationTypeIndex,
  driverIdByName: ReadonlyMap<string, string>,
  isNobody: (name: string) => boolean = isPlaceholderDriver,
): ViolationsPlan => {
  const plan: ViolationsPlan = {
    vehicles: [],
    grievances: [],
    unknownCars: [],
    grievancesUnplaced: [],
    zeroCount: [],
    unknownTypes: [],
    grievanceConflicts: [],
  };
  const byCode = new Map<string, PlannedViolation[]>();
  const unknown = new Map<string, number>();
  const grievances = new Map<string, PlannedGrievance>();
  const push = (code: string, row: PlannedViolation): void => {
    const list = byCode.get(code) ?? [];
    list.push(row);
    byCode.set(code, list);
  };
  const typeOn = (name: string, side: FleetViolationSide): string | null => {
    const found = types.byName.get(fold(name));
    return found !== undefined && found.side === side ? found.id : null;
  };
  const noteUnknown = (code: string): void => {
    if (!vehicleIdByCode.has(code)) unknown.set(code, (unknown.get(code) ?? 0) + 1);
  };

  for (const row of parsed.company) {
    noteUnknown(row.code);
    if (row.count === 0) {
      plan.zeroCount.push(`${row.code} ${row.year}`);
      continue;
    }
    const typeId = row.type === null ? null : typeOn(row.type, 'company');
    if (typeId === null) {
      plan.unknownTypes.push(`${row.code} ${row.year}: ${row.type ?? '—'}`);
      continue;
    }
    const ref = bookRefOf(row.code, vehicleIdByCode);
    const doc: Partial<FleetViolationDoc> = {
      kind: 'vehicle',
      ...bookRefFields(ref),
      violationTypeId: new Types.ObjectId(typeId),
      amount: egp(row.count * row.unitValue),
      year: row.year,
      count: row.count,
      unitValue: row.unitValue,
      date: null,
      driverEmployeeId: null,
      driverName: null,
      collected: row.collected,
    };
    push(row.code, { doc, key: violationKey(doc as FleetViolationDoc) });
    if (row.grievance > 0) {
      if (ref.vehicleId === null) {
        plan.grievancesUnplaced.push(`${row.code} ${row.year}: ${row.grievance}`);
        continue;
      }
      const key = `${ref.vehicleId}|${row.year}`;
      const existing = grievances.get(key);
      if (existing === undefined) {
        grievances.set(key, { vehicleId: ref.vehicleId, code: row.code, year: row.year, totalBeforeGrievance: row.grievance });
      } else if (existing.totalBeforeGrievance !== row.grievance) {
        plan.grievanceConflicts.push(`${row.code} ${row.year}: ${existing.totalBeforeGrievance} / ${row.grievance}`);
      }
    }
  }

  for (const row of parsed.driver) {
    noteUnknown(row.code);
    const typeName = DRIVER_TYPE_ALIASES[row.type] ?? row.type;
    const typeId = typeName === '' ? null : typeOn(typeName, 'driver');
    if (typeId === null) {
      plan.unknownTypes.push(`${row.code} ${day(row.date)}: ${row.type === '' ? '—' : row.type}`);
      continue;
    }
    const driver = driverRef(row.driver, driverIdByName, isNobody);
    const doc: Partial<FleetViolationDoc> = {
      kind: 'driver',
      ...bookRefFields(bookRefOf(row.code, vehicleIdByCode)),
      violationTypeId: new Types.ObjectId(typeId),
      amount: egp(row.amount),
      year: null,
      count: null,
      unitValue: null,
      date: row.date,
      driverEmployeeId: driver.id === null ? null : new Types.ObjectId(driver.id),
      driverName: driver.name,
      collected: row.collected,
    };
    push(row.code, { doc, key: violationKey(doc as FleetViolationDoc) });
  }

  plan.unknownCars = [...unknown].sort().map(([code, count]) => `${code} (${count})`);
  plan.grievances = [...grievances.values()];
  for (const [code, rows] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    plan.vehicles.push({ code, ref: bookRefOf(code, vehicleIdByCode), rows });
  }
  return plan;
};

export interface ViolationsImportOutcome {
  imported: number;
  alreadyThere: number;
  /** Fines already written whose driver was empty and now carries the book's name. */
  namesFilled: number;
  grievancesWritten: number;
  /** A (vehicle, year) that already had a DIFFERENT grievance figure on the new screen — kept. */
  grievancesKept: string[];
  failures: { code: string; reason: string }[];
}

/**
 * Write every car's rows and the grievance figures. Idempotent per row AS A MULTISET: a car that
 * already holds N rows of a shape gets only the rows beyond N, so a take-over neither duplicates
 * a row nor drops the second of two identical, legitimate ones — and a fine already written gets
 * the driver's NAME filled in where an earlier run left the driver empty.
 */
export const applyViolationsImport = async (
  plan: ViolationsPlan,
  by: string,
): Promise<ViolationsImportOutcome> => {
  const outcome: ViolationsImportOutcome = {
    imported: 0,
    alreadyThere: 0,
    namesFilled: 0,
    grievancesWritten: 0,
    grievancesKept: [],
    failures: [],
  };
  for (const vehicle of plan.vehicles) {
    try {
      const existing = await fleetViolationRepository.existingByKey(vehicle.ref, violationKey);
      const docs: Partial<FleetViolationDoc>[] = [];
      for (const row of vehicle.rows) {
        const written = existing.get(row.key)?.shift();
        if (written !== undefined) {
          outcome.alreadyThere += 1;
          const name = row.doc.driverName ?? null;
          if (name !== null && written.driverEmployeeId == null && !written.driverName) {
            await fleetViolationRepository.setDriverName(written._id, name);
            outcome.namesFilled += 1;
          }
          continue;
        }
        docs.push(row.doc);
      }
      if (docs.length > 0) await fleetViolationRepository.createMany(docs, { by });
      outcome.imported += docs.length;
    } catch (error) {
      outcome.failures.push({ code: vehicle.code, reason: failureReason(error) });
    }
  }
  for (const grievance of plan.grievances) {
    try {
      const existing = await fleetGrievanceRepository.findByVehicleAndYear(grievance.vehicleId, grievance.year);
      if (existing !== null) {
        if (existing.totalBeforeGrievance !== grievance.totalBeforeGrievance) {
          outcome.grievancesKept.push(`${grievance.code} ${grievance.year}: ${existing.totalBeforeGrievance}`);
        }
        continue;
      }
      await fleetGrievanceRepository.create(
        {
          vehicleId: new Types.ObjectId(grievance.vehicleId),
          year: grievance.year,
          totalBeforeGrievance: grievance.totalBeforeGrievance,
        },
        { by },
      );
      outcome.grievancesWritten += 1;
    } catch (error) {
      outcome.failures.push({ code: `${grievance.code} ${grievance.year}`, reason: failureReason(error) });
    }
  }
  return outcome;
};
