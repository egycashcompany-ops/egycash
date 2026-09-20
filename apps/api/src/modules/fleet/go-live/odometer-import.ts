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
// EVERY ROW OF THE BOOK IS BROUGHT ACROSS — «المهم تضيف كل الداتا ومتسبش داتا فاضيه». `added_by`,
// `added_date`, `deleted_by` and `__v` are legacy bookkeeping and do not travel; `deleted` does:
// a row the old system had deleted arrives ALREADY DELETED, carrying the day it was deleted on,
// and nothing else about it is changed — «عاوزها موجوده والdeleted 1 زى ما هى». `legacy-row.ts`
// says what that state is and why the model's invariants are safe around it.
//
// THE BOOK IS NOT A CHAIN, AND THE MODEL IS. `odometer.model.ts` says one reading closes a period
// and opens the next — `inReading` of entry k IS `outReading` of entry k+1 — and allows ONE open
// period per vehicle (`ux_open_period`). The book was a ledger somebody typed: 1,109 rows have no
// closing reading at all, 837 have no opening one, 458 links do not meet, a few closing readings
// are «0». So the rows are brought across AS THEY WERE WRITTEN, ordered by date, and the two ends
// the book left blank are filled from the chain itself — the SAME rule, read in both directions,
// both counted and both reported:
//
//   • A row with NO closing reading — or one below its own opening reading, which is no reading
//     — is closed with the NEXT row's opening reading. The last row of a vehicle has no next row
//     and stays open, which is the model's own open period, one per vehicle.
//   • A row with NO opening reading is opened at the LAST READING THE BOOK KNOWS for that car —
//     the running reading the rows before it left. That is not a number this invents: it is the
//     reading the model says the row carries, and it is why all 837 such rows land instead of
//     being dropped. A car's very first row, if it has no opening reading, opens at its own
//     closing one: a period of no distance, keeping its day, its driver and its note.
//
// A link that does not meet — row k closes at 1,000 and row k+1 opens at 1,050 — is left as it
// is: both readings were written down, and «which one was wrong» is not a question an import may
// answer. The correction flow exists for exactly that, one row at a time, with an audit trail.
//
// DRIVERS ARE NAMES. The book wrote the driver as a spelling, and «احتياطى» (a reserve, nobody in
// particular) and «التوكيل» (the car was at the dealer) as the driver's name when there was none.
// Those two are read as «no driver». Every other spelling is asked of the directory, which
// answers with HR's candidates: one is the driver; none, or several, and the NAME IS KEPT ON THE
// ROW AS TEXT — «عاوز يتحفظ كداتا زى ما يكون سواق كان موجود ومشى» — shown in the driver column
// in the employee's place, and listed on the run so HR can add the person if they are still
// here. Several candidates is never guessed between: «اكتب الاسم بس ومتكتبش كود موظف».
//
// CARS THE REGISTRY NEVER HAD — «194», «تويوتا1» — keep their rows too, carrying the book's code
// and no vehicle (`book-ref.ts`): the row is data the company refers back to; the car is not
// invented. Such rows are on no chain: nothing closes them and nothing measures from them.
import { Types } from 'mongoose';
import { findDirectoryEmployeesByNames } from '../../../platform/directory';
import { bookRefFields, bookRefOf, type BookRef } from './book-ref';
import {
  asWritten,
  deletedFields,
  deletionOf,
  legacyDateOf,
  liveFields,
  noteWith,
  type LegacyBookkeeping,
  type LegacyDeletion,
} from './legacy-row';
import { fleetOdometerRepository } from '../odometer/odometer.repository';
import { type FleetOdometerLogDoc } from '../odometer/odometer.model';
import { failureReason, fold } from './vehicles-import';

/** One legacy row, exactly as the export writes it. Everything is optional; nothing is trusted. */
interface LegacyLogRow extends LegacyBookkeeping {
  _id?: { $oid?: string } | string;
  car_code?: string;
  date?: { $date?: string } | string;
  added_date?: { $date?: string } | string;
  out_num?: string;
  in_num?: string;
  km?: string;
  driver?: string;
  driver2?: string;
  notes?: string;
}

/** A row the import will act on: trimmed, typed, and still in the book's own terms. */
export interface ParsedLogRow {
  id: string;
  code: string;
  date: Date;
  /** `null` = the book has no opening reading — the chain supplies one. */
  out: number | null;
  /** `null` = the book has no closing reading. */
  in: number | null;
  driver: string | null;
  driver2: string | null;
  notes: string | null;
  /** The old system's own deletion, carried through untouched. */
  deletion: LegacyDeletion;
  /**
   * The row says something the new model cannot hold as written — a date that is not a date, a
   * car with no code. It is kept, with the book's words in its notes, and written DELETED: off
   * the screens and off the chain until somebody fixes it, and still there to be fixed.
   */
  unreadable: boolean;
}

export interface ParseLogResult {
  rows: ParsedLogRow[];
  /** Rows the old system had deleted — kept, deleted, and counted. */
  keptDeleted: number;
  /** Rows kept but unreadable — «id · what could not be read». */
  unreadable: { id: string; reason: string }[];
  /** Only a file that is not a list of rows at all. */
  rejected: { id: string; reason: string }[];
}

/** The code a row carries when the book named no car at all — never an empty column. */
export const NO_CODE = 'بدون كود';

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

/** A day the company could have worked on. One row carries a date before the year 0. */
const inRange = (date: Date): boolean => {
  const year = date.getUTCFullYear();
  return year >= 2000 && year <= 2100;
};

/**
 * Read the export. NOTHING IS DROPPED: a row the book wrote badly is kept, marked, and carries
 * the book's own words for whatever could not be read, so the row still says what it said.
 */
export const parseCarsLog = (raw: unknown): ParseLogResult => {
  const result: ParseLogResult = { rows: [], keptDeleted: 0, unreadable: [], rejected: [] };
  if (!Array.isArray(raw)) {
    result.rejected.push({ id: 'file', reason: 'the export is not a JSON array' });
    return result;
  }
  raw.forEach((entry: LegacyLogRow, index) => {
    const id = legacyId(entry._id, index);
    const deletion = deletionOf(entry);
    if (deletion.isDeleted) result.keptDeleted += 1;
    let unreadable = false;
    let notes = text(entry.notes);

    const code = text(entry.car_code);
    if (code === null) {
      unreadable = true;
      result.unreadable.push({ id, reason: 'no car code' });
    }

    // The book's date, as written. One that is not a date at all — or a year nobody worked in —
    // keeps the row: the day the row was ADDED is the nearest thing the export has to it, and
    // what the book wrote is quoted in the notes for whoever comes to correct it.
    const written = legacyDateOf(entry.date);
    let date = written;
    if (date === null || !inRange(date)) {
      unreadable = true;
      result.unreadable.push({ id, reason: `${code ?? NO_CODE}: the date cannot be read` });
      notes = noteWith(notes, asWritten('التاريخ', entry.date));
      date = legacyDateOf(entry.added_date) ?? deletion.deletedAt ?? written ?? new Date(0);
    }

    const out = reading(entry.out_num);
    const inReading = reading(entry.in_num);
    if (out === 'invalid') notes = noteWith(notes, asWritten('قراءة الخروج', entry.out_num));
    if (inReading === 'invalid') notes = noteWith(notes, asWritten('قراءة الدخول', entry.in_num));
    if (out === 'invalid' || inReading === 'invalid') {
      result.unreadable.push({ id, reason: `${code ?? NO_CODE}: a reading is not a number` });
    }

    result.rows.push({
      id,
      code: code ?? NO_CODE,
      date,
      out: out === 'invalid' ? null : out,
      in: inReading === 'invalid' ? null : inReading,
      driver: text(entry.driver),
      driver2: text(entry.driver2),
      notes,
      deletion,
      unreadable,
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

/**
 * What a book's driver spelling becomes on the row: the employee HR knows by that spelling, or
 * the spelling itself kept as text, or nothing at all for the book's words for «nobody».
 */
export interface DriverRef {
  id: string | null;
  name: string | null;
}

export const driverRef = (
  name: string | null,
  driverIdByName: ReadonlyMap<string, string>,
  isNobody: (name: string) => boolean,
): DriverRef => {
  if (name === null || isNobody(name)) return { id: null, name: null };
  const id = driverIdByName.get(name);
  return id === undefined ? { id: null, name } : { id, name: null };
};

/** One row of a vehicle's chain, as it will be written. */
export interface ChainRow {
  date: Date;
  out: number;
  in: number | null;
  driver1: DriverRef;
  driver2: DriverRef;
  notes: string | null;
  /** Written deleted: the book had deleted it, or the model could not hold it alive. */
  deletion: LegacyDeletion;
  deleted: boolean;
  /** The book gave this row no closing reading — the one field a later run may still fill. */
  bookHadNoClose: boolean;
}

export interface VehicleChain {
  code: string;
  /** The registry's car, or the book's code alone for a car the registry never had. */
  ref: BookRef;
  rows: ChainRow[];
}

export interface OdometerPlan {
  vehicles: VehicleChain[];
  /** Codes the registry does not have — their rows are KEPT by code — with how many rows each. */
  unknownCars: string[];
  /** Rows the book left with no opening reading, opened at the car's last known reading. */
  openedByPrevious: number;
  /** Rows whose missing (or impossible) closing reading was taken from the next row. */
  closedByNext: number;
  badInReading: number;
  /** Rows written deleted: the book's own deletions, and the ones it could not say readably. */
  deleted: number;
}

/** `2025-11-25` — how a row is named in a report. */
export const day = (date: Date): string => date.toISOString().slice(0, 10);

/** Date first, then the reading: two rows on one day are the morning and the evening. */
const chainOrder = (a: ParsedLogRow, b: ParsedLogRow): number =>
  a.date.getTime() - b.date.getTime() ||
  (a.out ?? a.in ?? 0) - (b.out ?? b.in ?? 0) ||
  a.id.localeCompare(b.id);

/**
 * Turn the ledger into one chain per car. Pure: the registry and the directory are handed in as
 * maps, so the rule can be tested on rows alone.
 *
 * A DELETED ROW IS NOT ON THE CHAIN. It keeps the readings the book gave it and takes no part in
 * what the live rows hand one another: the old system deleted it, so it is not a period of the
 * car's life any more — it is a record of one. Where the book gave it no opening reading either,
 * it opens at whatever the live chain had reached by then, purely so the row has the reading the
 * model requires; nothing is measured from it and nothing is closed by it.
 */
export const planOdometerImport = (
  rows: readonly ParsedLogRow[],
  vehicleIdByCode: ReadonlyMap<string, string>,
  driverIdByName: ReadonlyMap<string, string>,
  isNobody: (name: string) => boolean = isPlaceholderDriver,
): OdometerPlan => {
  const plan: OdometerPlan = {
    vehicles: [],
    unknownCars: [],
    openedByPrevious: 0,
    closedByNext: 0,
    badInReading: 0,
    deleted: 0,
  };
  const byCode = new Map<string, ParsedLogRow[]>();
  const unknown = new Map<string, number>();
  for (const row of rows) {
    if (!vehicleIdByCode.has(row.code)) unknown.set(row.code, (unknown.get(row.code) ?? 0) + 1);
    const list = byCode.get(row.code) ?? [];
    list.push(row);
    byCode.set(row.code, list);
  }
  plan.unknownCars = [...unknown].sort().map(([code, count]) => `${code} (${count})`);

  for (const [code, list] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...list].sort(chainOrder);
    // The car's last known reading, walking forward. Only live rows move it: a deleted row is a
    // record of a period, not one the next row carries on from.
    let cursor: number | null = null;
    const opened = ordered.map((row) => {
      const deleted = row.deletion.isDeleted || row.unreadable;
      const out = row.out ?? cursor ?? row.in ?? 0;
      if (row.out === null && !deleted) plan.openedByPrevious += 1;
      let inReading = row.in;
      if (inReading !== null && inReading < out) {
        plan.badInReading += 1;
        inReading = null;
      }
      if (!deleted) cursor = inReading ?? out;
      if (deleted) plan.deleted += 1;
      return { row, out, in: inReading, deleted };
    });
    // A live row the book left open is closed by the next LIVE row's opening reading — the
    // reading the model says it hands on. The last live row stays open: the car's open period.
    const chain: ChainRow[] = opened.map((entry, index) => {
      let inReading = entry.in;
      if (inReading === null && !entry.deleted) {
        const next = opened.slice(index + 1).find((later) => !later.deleted);
        if (next !== undefined) {
          inReading = next.out;
          plan.closedByNext += 1;
        }
      }
      return {
        date: entry.row.date,
        out: entry.out,
        in: inReading,
        driver1: driverRef(entry.row.driver, driverIdByName, isNobody),
        driver2: driverRef(entry.row.driver2, driverIdByName, isNobody),
        notes: entry.row.notes,
        deletion: entry.row.deletion,
        deleted: entry.deleted,
        bookHadNoClose: entry.row.in === null || entry.in === null,
      };
    });
    plan.vehicles.push({ code, ref: bookRefOf(code, vehicleIdByCode), rows: chain });
  }
  return plan;
};

export interface OdometerImportOutcome {
  imported: number;
  /** Rows a take-over found already written — the same car, day and opening reading. */
  alreadyThere: number;
  /** Rows already written whose driver was empty and now carries the book's name. */
  namesFilled: number;
  /** Rows already written whose import-filled closing reading now meets the row after it. */
  relinked: number;
  /** Rows an earlier run wrote deleted over a contested open period, brought back now it is free. */
  restored: number;
  /** Open tails closed against a reading the company had already recorded after the book ends. */
  closedByExisting: number;
  /** Rows written DELETED so the car's one open period is not contested — «ميحصلش تعارض». */
  openConflicts: string[];
  failures: { code: string; reason: string }[];
}

/**
 * Write every chain. One car failing does not stop the next; the run reports them all and is
 * left unfinished, and the take-over that follows skips what did land.
 *
 * IDEMPOTENT PER ROW, which is what makes the lease's take-over safe here: a row is «the same»
 * as one already written when it is the same car, the same day and the same opening reading —
 * DELETED ROWS INCLUDED, or a second run would write every one of them again. Such a row is
 * counted and not written twice, and two repairs are made to it:
 *
 *   • a driver's NAME is filled in where an earlier run left the driver empty;
 *   • a closing reading the BOOK never gave, and which no person has touched since the import
 *     wrote it, is re-filled from the row that now follows — so inserting a row between two the
 *     last run wrote leaves the chain meeting, instead of a step nobody typed;
 *   • a row an EARLIER run wrote deleted only because the car's one open period was taken is
 *     brought back, now that it is free. The book calls it a reading like any other and nobody
 *     has touched it since; it was buried by a bookkeeping mistake, not by anybody's decision.
 *
 * A reading a person entered or corrected is never touched: `updatedAt` moves the moment anybody
 * does, and a row whose `updatedAt` has moved is left exactly as they left it.
 *
 * THE OPEN TAIL IS THE ONE PLACE THE BOOK MEETS WHAT THE COMPANY HAS TYPED SINCE. The model
 * allows one open period per car. If the car already has one — readings recorded on the new
 * screen after the book stopped — the book's last row is closed against the earliest of those,
 * which is the reading the model says it hands on to; and if that earliest reading is dated
 * before the book's last row, or below it, the two histories cannot be joined without inventing
 * a number, so the row is written DELETED instead of dropped: the data is kept, the index is not
 * contested, and the run names the car. A car the registry never had has no chain to meet: its
 * rows are written as the book had them.
 *
 * THE OPEN ROW A RUN CLOSES IS NO LONGER OPEN. The car's one open row is read once, before the
 * rows are walked — and the relink above may CLOSE it a moment later, when this run has a row to
 * put after it. That is the ordinary shape of a second run over a book the first one only partly
 * kept: the earlier run left the book's last row open, and this one has the row that follows it.
 * Reading «is there an open row?» from a value taken before that happened made the new tail look
 * like a second open period and buried it as a conflict — seventeen real readings, deleted for a
 * row that had already been closed. The open row is tracked as the loop closes it.
 */
export const applyOdometerImport = async (
  plan: OdometerPlan,
  by: string,
): Promise<OdometerImportOutcome> => {
  const outcome: OdometerImportOutcome = {
    imported: 0,
    alreadyThere: 0,
    namesFilled: 0,
    relinked: 0,
    restored: 0,
    closedByExisting: 0,
    openConflicts: [],
    failures: [],
  };
  const at = new Date();
  for (const vehicle of plan.vehicles) {
    try {
      const existing = await fleetOdometerRepository.existingByKey(vehicle.ref);
      const registered = vehicle.ref.vehicleId !== null;
      // The car's one open row, as the database has it — and `null` again the moment this run
      // closes it, which the relink below may do.
      let open = registered ? await fleetOdometerRepository.findOpen(vehicle.ref.vehicleId as string) : null;
      const head =
        open === null ? null : await fleetOdometerRepository.findChainHead(vehicle.ref.vehicleId as string);
      const docs: Partial<FleetOdometerLogDoc>[] = [];
      for (const row of vehicle.rows) {
        const written = existing.get(fleetOdometerRepository.rowKey(row.date, row.out))?.shift();
        if (written !== undefined) {
          outcome.alreadyThere += 1;
          const names: { driver1Name?: string; driver2Name?: string } = {};
          if (row.driver1.name !== null && written.driver1EmployeeId == null && !written.driver1Name) {
            names.driver1Name = row.driver1.name;
          }
          if (row.driver2.name !== null && written.driver2EmployeeId == null && !written.driver2Name) {
            names.driver2Name = row.driver2.name;
          }
          if (Object.keys(names).length > 0) {
            await fleetOdometerRepository.setDriverNames(written._id, names);
            outcome.namesFilled += 1;
          }
          const untouched = written.updatedAt.getTime() === written.createdAt.getTime();
          if (row.bookHadNoClose && untouched && row.in !== null && written.inReading !== row.in && row.in >= written.outReading) {
            await fleetOdometerRepository.setClosing(written._id, row.in, row.in - written.outReading);
            outcome.relinked += 1;
            // That row WAS the car's open period. It is not any more, and the row this run has
            // to put after it is free to be the open one.
            if (open !== null && String(open._id) === String(written._id)) open = null;
          }
          // A row an EARLIER run buried over a contested open period — the book says it is a
          // reading like any other, and nobody has touched it since that run wrote it. If the
          // open period is free now, it comes back.
          if (written.isDeleted && !row.deleted && untouched) {
            if (row.in !== null || open === null) {
              await fleetOdometerRepository.restore(
                written._id,
                row.in,
                row.in === null ? null : row.in - written.outReading,
              );
              outcome.restored += 1;
              if (row.in === null) open = { ...written, isDeleted: false, inReading: null };
            } else {
              outcome.openConflicts.push(`${vehicle.code} ${day(row.date)}`);
            }
          }
          continue;
        }
        let inReading = row.in;
        let deleted = row.deleted;
        if (inReading === null && !deleted && open !== null) {
          if (head !== null && head.date >= row.date && head.outReading >= row.out) {
            inReading = head.outReading;
            outcome.closedByExisting += 1;
          } else {
            outcome.openConflicts.push(`${vehicle.code} ${day(row.date)}`);
            deleted = true;
          }
        }
        docs.push({
          ...bookRefFields(vehicle.ref),
          date: row.date,
          outReading: row.out,
          inReading,
          km: inReading === null ? null : inReading - row.out,
          driver1EmployeeId: row.driver1.id === null ? null : new Types.ObjectId(row.driver1.id),
          driver2EmployeeId: row.driver2.id === null ? null : new Types.ObjectId(row.driver2.id),
          driver1Name: row.driver1.name,
          driver2Name: row.driver2.name,
          notes: row.notes,
          ...(deleted ? deletedFields(row.deletion, at) : liveFields()),
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
