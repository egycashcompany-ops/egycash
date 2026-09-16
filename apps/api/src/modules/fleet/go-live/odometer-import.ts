// The go-live ODOMETER import: the legacy `cars_log` collection, turned into the odometer chain.
// Importable and side-effect free until `applyOdometerImport`; `odometer.ts` runs it at boot.
//
// WHAT THE LEGACY SHAPE IS, and what each field becomes:
//
//   car_code → the vehicle, by code        driver  → driver1EmployeeId, matched by NAME through
//   date     → date                                   the directory (HR's rule, HR's answer)
//   out_num  → outReading                  driver2 → driver2EmployeeId, the same way
//   in_num   → inReading                   notes   → notes
//   km       → recomputed: `in − out`, because the book's own figure disagrees with its own two
//              readings on 137 rows and the model derives it anyway
//
// `deleted`, `added_by`, `added_date`, `deleted_by`, `deleted_date` and `__v` are legacy
// bookkeeping and do not travel; a row flagged deleted is skipped and counted.
//
// THE BOOK IS NOT A CHAIN, AND THE MODEL IS. `odometer.model.ts` says one reading closes a period
// and opens the next — `inReading` of entry k IS `outReading` of entry k+1 — and allows ONE open
// period per vehicle (`ux_open_period`). The book was a ledger somebody typed: 1,109 rows have no
// closing reading at all, 458 links do not meet, a few closing readings are «0». So the rows are
// brought across AS THEY WERE WRITTEN, ordered by date, with exactly two repairs, both counted
// and both reported:
//
//   • A row with NO closing reading — or one below its own opening reading, which is no reading
//     — is closed with the NEXT row's opening reading, which is the reading the model says it
//     should have carried. The last row of a vehicle has no next row and stays open, which is
//     the model's own open period, and there is one of it per vehicle.
//   • A row with NO opening reading cannot be a period at all and is not invented; it is skipped
//     and listed by car and date, so whoever keeps the book can look it up.
//
// A link that does not meet — row k closes at 1,000 and row k+1 opens at 1,050 — is left as it
// is: both readings were written down, and «which one was wrong» is not a question an import may
// answer. The correction flow exists for exactly that, one row at a time, with an audit trail.
//
// DRIVERS ARE NAMES. The book wrote the driver as a spelling, and «احتياطى» (a reserve, nobody in
// particular) and «التوكيل» (the car was at the dealer) as the driver's name when there was none.
// Those two are read as «no driver». Every other spelling is asked of the directory, which
// answers with HR's candidates: one is the driver, none is reported by name so HR can add them,
// several is reported as an ambiguity rather than guessed — and the row is imported either way,
// with the driver left empty. A reading is a fact about the car; the driver is a label on it.
import { Types } from 'mongoose';
import { findDirectoryEmployeesByNames } from '../../../platform/directory';
import { fleetOdometerRepository } from '../odometer/odometer.repository';
import { type FleetOdometerLogDoc } from '../odometer/odometer.model';
import { failureReason, fold } from './vehicles-import';

/** One legacy row, exactly as the export writes it. Everything is optional; nothing is trusted. */
interface LegacyLogRow {
  _id?: { $oid?: string } | string;
  car_code?: string;
  date?: { $date?: string } | string;
  out_num?: string;
  in_num?: string;
  km?: string;
  driver?: string;
  driver2?: string;
  notes?: string;
  deleted?: number;
}

/** A row the import will act on: trimmed, typed, and still in the book's own terms. */
export interface ParsedLogRow {
  id: string;
  code: string;
  date: Date;
  /** `null` = the book has no opening reading — the row cannot be a period. */
  out: number | null;
  /** `null` = the book has no closing reading. */
  in: number | null;
  driver: string | null;
  driver2: string | null;
  notes: string | null;
}

export interface ParseLogResult {
  rows: ParsedLogRow[];
  skippedDeleted: number;
  rejected: { id: string; reason: string }[];
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** A reading as the book wrote it: digits, or nothing. Anything else is not a reading. */
const reading = (value: unknown): number | null | 'invalid' => {
  const raw = text(value);
  if (raw === null) return null;
  return /^\d+$/.test(raw) ? Number(raw) : 'invalid';
};

const legacyId = (value: LegacyLogRow['_id'], index: number): string => {
  if (typeof value === 'string') return value;
  if (value !== undefined && typeof value.$oid === 'string') return value.$oid;
  return `row ${index}`;
};

/**
 * The book's date, or nothing. One row carries a date before the year 0 — a typo the export
 * serialised faithfully — and a reading on that day belongs to no period anybody can name.
 */
const logDate = (value: LegacyLogRow['date']): Date | null => {
  const raw = typeof value === 'string' ? value : value?.$date;
  if (typeof raw !== 'string') return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return year < 2000 || year > 2100 ? null : date;
};

/**
 * Read the export. A row that cannot be read is REPORTED by its legacy id and the reason — not a
 * refusal, as it is for the cars: one unreadable date among twenty thousand readings is a note
 * for whoever keeps the book, not a reason to leave the other 19,999 in it.
 */
export const parseCarsLog = (raw: unknown): ParseLogResult => {
  const result: ParseLogResult = { rows: [], skippedDeleted: 0, rejected: [] };
  if (!Array.isArray(raw)) {
    result.rejected.push({ id: 'file', reason: 'the export is not a JSON array' });
    return result;
  }
  raw.forEach((entry: LegacyLogRow, index) => {
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
    const date = logDate(entry.date);
    if (date === null) {
      result.rejected.push({ id, reason: `${code}: the date cannot be read` });
      return;
    }
    const out = reading(entry.out_num);
    const inReading = reading(entry.in_num);
    if (out === 'invalid' || inReading === 'invalid') {
      result.rejected.push({ id, reason: `${code}: a reading is not a number` });
      return;
    }
    result.rows.push({
      id,
      code,
      date,
      out,
      in: inReading,
      driver: text(entry.driver),
      driver2: text(entry.driver2),
      notes: text(entry.notes),
    });
  });
  return result;
};

/**
 * The two spellings the book used for «no driver»: a reserve driver, and the car being at the
 * dealer. Folded, so «احتياطي» and «احتياطى» are the same word.
 */
const PLACEHOLDER_DRIVERS = new Set(['احتياطي', 'التوكيل', 'توكيل'].map(fold));

export const isPlaceholderDriver = (name: string): boolean => PLACEHOLDER_DRIVERS.has(fold(name));

export interface DriverResolution {
  /** Spelling → employee id, for every name the directory answered with exactly one person. */
  ids: Map<string, string>;
  /** Names the directory has nobody for — listed so HR can add them. */
  unmatched: string[];
  /** Names the directory has SEVERAL people for — «name — code, code» — never guessed. */
  ambiguous: string[];
  /** The «no driver» spellings the book used, as found. */
  placeholders: string[];
}

/**
 * Who the book's driver names are, asked ONCE of the directory for every distinct spelling.
 *
 * Distinct spellings, not rows: the book has 20,000 rows and 600 spellings, and HR's answer for
 * a spelling does not change between two rows that carry it. `isNobody` is the book's own rule
 * for a name that means «no driver» — this book's two spellings by default; the workshop book
 * has more of them.
 */
export const resolveDrivers = async (
  spellings: readonly (string | null)[],
  isNobody: (name: string) => boolean = isPlaceholderDriver,
): Promise<DriverResolution> => {
  const names = new Set<string>();
  const placeholders = new Set<string>();
  for (const name of spellings) {
    if (name === null) continue;
    if (isNobody(name)) placeholders.add(name);
    else names.add(name);
  }
  const asked = [...names].sort();
  const answers = await findDirectoryEmployeesByNames(asked);
  const resolution: DriverResolution = {
    ids: new Map(),
    unmatched: [],
    ambiguous: [],
    placeholders: [...placeholders].sort(),
  };
  for (const name of asked) {
    const candidates = answers.get(name) ?? [];
    if (candidates.length === 1) resolution.ids.set(name, candidates[0]!.employeeId);
    else if (candidates.length === 0) resolution.unmatched.push(name);
    else resolution.ambiguous.push(`${name} — ${candidates.map((c) => c.code).join(', ')}`);
  }
  return resolution;
};

/** One row of a vehicle's chain, as it will be written. */
export interface ChainRow {
  date: Date;
  out: number;
  in: number | null;
  driver1: string | null;
  driver2: string | null;
  notes: string | null;
}

export interface VehicleChain {
  code: string;
  vehicleId: string;
  rows: ChainRow[];
}

export interface OdometerPlan {
  vehicles: VehicleChain[];
  /** Codes the registry does not have, with how many rows the book holds for each. */
  unknownCars: string[];
  /** Rows without an opening reading: how many, and which («code date»). */
  noOutReading: number;
  noOutReadingRows: string[];
  /** Rows whose missing (or impossible) closing reading was taken from the next row. */
  closedByNext: number;
  badInReading: number;
}

/** `2025-11-25` — how a row is named in a report. */
export const day = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Turn the ledger into one chain per vehicle. Pure: the registry and the directory are handed in
 * as maps, so the rule can be tested on rows alone.
 */
export const planOdometerImport = (
  rows: readonly ParsedLogRow[],
  vehicleIdByCode: ReadonlyMap<string, string>,
  driverIdByName: ReadonlyMap<string, string>,
): OdometerPlan => {
  const plan: OdometerPlan = {
    vehicles: [],
    unknownCars: [],
    noOutReading: 0,
    noOutReadingRows: [],
    closedByNext: 0,
    badInReading: 0,
  };
  const byCode = new Map<string, ParsedLogRow[]>();
  const unknown = new Map<string, number>();
  for (const row of rows) {
    if (!vehicleIdByCode.has(row.code)) {
      unknown.set(row.code, (unknown.get(row.code) ?? 0) + 1);
      continue;
    }
    if (row.out === null) {
      plan.noOutReading += 1;
      plan.noOutReadingRows.push(`${row.code} ${day(row.date)}`);
      continue;
    }
    const list = byCode.get(row.code) ?? [];
    list.push(row);
    byCode.set(row.code, list);
  }
  plan.unknownCars = [...unknown].sort().map(([code, count]) => `${code} (${count})`);

  const driver = (name: string | null): string | null =>
    name === null ? null : (driverIdByName.get(name) ?? null);

  for (const [code, list] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    // Date first, then the reading: two rows on one day are the morning and the evening, and the
    // lower reading came first. The legacy id settles a tie the way the book was written.
    const ordered = [...list].sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() ||
        (a.out as number) - (b.out as number) ||
        a.id.localeCompare(b.id),
    );
    const chain: ChainRow[] = ordered.map((row, index) => {
      const out = row.out as number;
      const next = ordered[index + 1];
      let inReading = row.in;
      if (inReading !== null && inReading < out) {
        plan.badInReading += 1;
        inReading = null;
      }
      if (inReading === null && next !== undefined) {
        inReading = next.out as number;
        plan.closedByNext += 1;
      }
      return {
        date: row.date,
        out,
        in: inReading,
        driver1: driver(row.driver),
        driver2: driver(row.driver2),
        notes: row.notes,
      };
    });
    plan.vehicles.push({ code, vehicleId: vehicleIdByCode.get(code) as string, rows: chain });
  }
  return plan;
};

export interface OdometerImportOutcome {
  imported: number;
  /** Rows a take-over found already written — the same car, day and opening reading. */
  alreadyThere: number;
  /** Open tails closed against a reading the company had already recorded after the book ends. */
  closedByExisting: number;
  /** Cars whose open tail could not be written because the car already has an open period. */
  openConflicts: string[];
  failures: { code: string; reason: string }[];
}

/**
 * Write every chain. One car failing does not stop the next; the run reports them all and is
 * left unfinished, and the take-over that follows skips what did land.
 *
 * IDEMPOTENT PER ROW, which is what makes the lease's take-over safe here: a row is «the same»
 * as one already written when it is the same car, the same day and the same opening reading,
 * and such a row is counted and not written again.
 *
 * THE OPEN TAIL IS THE ONE PLACE THE BOOK MEETS WHAT THE COMPANY HAS TYPED SINCE. The model
 * allows one open period per car. If the car already has one — readings recorded on the new
 * screen after the book stopped — the book's last row is closed against the earliest of those,
 * which is the reading the model says it hands on to; and if that earliest reading is dated
 * before the book's last row, or below it, the two histories cannot be joined without inventing
 * a number, so the tail is left out and the car is reported.
 */
export const applyOdometerImport = async (
  plan: OdometerPlan,
  by: string,
): Promise<OdometerImportOutcome> => {
  const outcome: OdometerImportOutcome = {
    imported: 0,
    alreadyThere: 0,
    closedByExisting: 0,
    openConflicts: [],
    failures: [],
  };
  for (const vehicle of plan.vehicles) {
    try {
      const existing = await fleetOdometerRepository.existingKeys(vehicle.vehicleId);
      const open = await fleetOdometerRepository.findOpen(vehicle.vehicleId);
      const head = open === null ? null : await fleetOdometerRepository.findChainHead(vehicle.vehicleId);
      const docs: Partial<FleetOdometerLogDoc>[] = [];
      for (const row of vehicle.rows) {
        if (existing.has(fleetOdometerRepository.rowKey(row.date, row.out))) {
          outcome.alreadyThere += 1;
          continue;
        }
        let inReading = row.in;
        if (inReading === null && open !== null) {
          if (head !== null && head.date >= row.date && head.outReading >= row.out) {
            inReading = head.outReading;
            outcome.closedByExisting += 1;
          } else {
            outcome.openConflicts.push(`${vehicle.code} ${day(row.date)}`);
            continue;
          }
        }
        docs.push({
          vehicleId: new Types.ObjectId(vehicle.vehicleId),
          date: row.date,
          outReading: row.out,
          inReading,
          km: inReading === null ? null : inReading - row.out,
          driver1EmployeeId: row.driver1 === null ? null : new Types.ObjectId(row.driver1),
          driver2EmployeeId: row.driver2 === null ? null : new Types.ObjectId(row.driver2),
          notes: row.notes,
        });
      }
      if (docs.length > 0) await fleetOdometerRepository.createMany(docs, { by });
      outcome.imported += docs.length;
    } catch (error) {
      outcome.failures.push({ code: vehicle.code, reason: failureReason(error) });
    }
  }
  return outcome;
};
