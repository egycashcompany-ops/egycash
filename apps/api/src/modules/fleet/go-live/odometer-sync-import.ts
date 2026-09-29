// The go-live ODOMETER SYNC: a second export of the legacy `cars_log` book, read against the first
// one, and the difference brought onto the chain the first one wrote. Importable and side-effect
// free until `applyOdometerSync`; `odometer-sync.ts` runs it at boot.
//
// «صفحة الصيانات و صفحة قراءة العدادات دول الملفات بتاعتهم من السيستم القديم شوف لو فى داتا
// المفروض تتضاف او تتعدل اعمل كدا». The old system is still in use beside this one, so the book
// kept growing after `cars-log.json` was shipped and imported (`go-live:odometer:v4`). The owner's
// export of 29 September has 21,197 rows where the shipped one had 20,322, and read by the old
// system's own row id it holds exactly two kinds of news:
//
//   875 rows the first export did not have — readings from 27 August to 7 October (the last one
//       is dated ahead of today; it is brought across as the book wrote it), ten of them already
//       deleted in the old system;
//    87 rows the old system has CHANGED since — 75 closing readings written in (mostly the car's
//       last row of 16 September, which the next day's reading now closes), 72 km figures, 17 rows
//       the old system has DELETED since, four drivers spelled out in full and one note.
//
// No row of the first export is missing from the second. Had one been, it would be REPORTED and
// nothing deleted: an export that leaves a row out is not the old system deleting it — that one
// arrives with `deleted: 1`, and is treated as the change it is (below). The book's own `km` is
// never read — the import recomputes it as `in − out` (`odometer-import.ts`) — so its 72 changes
// are carried by the closing readings they belong to, and counted beside them.
//
// WHY BOTH BOOKS ARE PLANNED IN FULL — and neither «only the new rows» nor «the whole new book
// handed back to the import». A reading is not a row on its own the way a visit is: the import
// makes a CHAIN of every car's rows, and two of its rules reach across rows — a row the book left
// open is closed by the NEXT row's opening reading, and a row with no opening reading opens at the
// reading the rows BEFORE it left. Both directions cross the line between the two exports here:
//
//   • 153 of the new rows are dated BEFORE rows the first export already had. The old system's
//     clerks deleted a car's row of 16 September, went back and typed 4–15 September, then typed
//     the 16th again. Planned on their own, those rows would open and close against nothing.
//   • Eight rows the first export already had change only because of what now FOLLOWS them — the
//     book still gives them no closing reading, and the chain closes them with the new row after.
//     No field of theirs differs between the two exports; only their chain does.
//
// And the whole new book handed back to `applyOdometerImport` gets it wrong in the opposite way.
// Its per-row idempotency re-fills a closing reading only where the BOOK never gave one
// (`bookHadNoClose`). 66 cars' last rows, open until now, are closed by the new book's OWN reading;
// they would stay open, and the new last row of each of those cars would meet an open period that
// is already taken — and be buried as a conflict. It applies no deletion, no changed driver, no
// changed note. And it knows a row it wrote only by the car, the day and the opening reading:
// fifteen new rows share all three with a row the first export had — thirteen the old system
// deleted since and TYPED AGAIN, two repeating a row it had deleted before — and every one of them
// would read as «already there». For the thirteen, the deletion, applied, would then take the only
// copy of the reading with it.
//
// So both exports go through the import's OWN planner, unchanged (`planOdometerImport`): the OLD
// one reproduces, row for row, the chain the import wrote — it is the old side of every
// comparison below — and the NEW one is, row for row, the chain a fresh import of the new book
// would write. The two are joined by the old system's row id, which is what makes a re-typed row
// a new row and not an old one. Every row where the two chains differ is a change; every row
// only the new one has is an addition; every other row is left exactly as it is on ECMS.
//
// FINDING WHAT THE IMPORT WROTE, and never writing a reading twice. The import tells its rows
// apart by car, day and opening reading (`rowKey`), and so does this — with one more rule. The
// rows the OLD book accounts for CLAIM their ECMS rows first: for each key, the oldest rows by id
// are the ones the import wrote (it wrote them before anything this step or a later person
// writes), and among those the one in the state the import left it takes precedence. Only what is
// left over is there to be matched by a NEW row, and a new row that finds one is counted as
// already there — a person typed that reading on the new screen, or an earlier attempt of this
// step wrote it before it was cut off. The fifteen find nothing left over, and are written.
//
// THE THREE-WAY RULE, for every field the two chains disagree on. The OLD chain is what the import
// wrote; ECMS is what the row holds now; the NEW chain is what a fresh import would write now:
//
//   ECMS = NEW  → already there (a person made the same change here, or an earlier attempt of this
//                 step did) — counted, not written;
//   ECMS = OLD  → nobody has touched the field since the import wrote it — the NEW value is written;
//   otherwise   → somebody changed it on ECMS since — THEIR value stays, and the field is listed
//                 with all three values, the car's code and the row's day.
//
// A person's edit is never overwritten, and that is also what makes a take-over safe: a field an
// earlier attempt of this step wrote reads as «already there» to the next.
//
// A ROW THE OLD SYSTEM HAS DELETED SINCE is deleted here too — SOFTLY: `isDeleted`, the day the old
// system deleted it, no user (the legacy username names nobody here), and a new version. It stays
// in the database; it leaves every screen and every total. «لو فى صفوف كانت ممسوحه عاوزها موجوده
// والdeleted 1 زى ما هى»، «الداتا اللى ممسوحه متظهرش للمستخدم تبقى فى الداتا بيز فقط». Only a row
// nobody has changed on ECMS is deleted: if any field of it holds a value neither export gave it —
// a reading corrected, a driver put right — somebody decided about that row here, and it stays,
// listed, with its closing reading as ECMS has it: what the new chain gives a deleted row there
// is part of the deletion, and on a row kept live it would reopen the middle of the chain.
//
// THE CHAIN'S OWN RULES, unchanged, for everything that is written. Changes run first — the old
// tails the new book closes, the rows it deleted — and a change that would OPEN a row runs after
// them, so the car's one open period (`ux_open_period`) is free before anything asks for it. Then
// the new rows are written, each as the import would write it: a row the old system had deleted
// arrives deleted; one the model cannot read arrives deleted with the book's words in its notes;
// a driver is HR's employee for the spelling, or the spelling kept as text; a car the registry
// never had keeps its rows by code, on no chain. And the one row per car the new book leaves open
// meets what the company has typed since exactly as the import's tail does: if the car already
// has an open period, the row is closed against the earliest reading typed on the new screen when
// that reading comes after it and above it (`closedByExisting`), and otherwise it is written
// DELETED and the car is named (`openConflicts`) — the reading is kept and nothing is contested.
// A take-over that finds such a row already written names it again, as the import names its own.
// «The earliest reading typed on the new screen» is, here, the earliest live reading on the car
// that no row of either export accounts for; the import could ask for the chain's head because,
// on the day it ran, every reading on the car was one somebody had typed.
//
// A row an earlier run BURIED over a contested open period, and which the new book now closes —
// it is no longer the car's last reading, so it contests nothing — is brought back, as the import
// brings back its own buried rows (`restored`). And what a fresh import would have written but
// this step may not — a row whose DAY or opening reading the old system moved, which would move it
// along the chain — is listed rather than written; the real export has none.
import { Types } from 'mongoose';
import { getDirectoryEmployees } from '../../../platform/directory';
import { FleetOdometerLogModel, type FleetOdometerLogDoc } from '../odometer/odometer.model';
import { fleetOdometerRepository } from '../odometer/odometer.repository';
import { bookRefFields, groupByKey, type BookRef } from './book-ref';
import { deletedFields, liveFields } from './legacy-row';
import {
  day,
  driverRef,
  isPlaceholderDriver,
  planOdometerImport,
  type ChainRow,
  type DriverRef,
  type ParsedLogRow,
} from './odometer-import';
import { failureReason } from './vehicles-import';

// ─── The two exports, as the old system wrote them ────────────────────────────────────────────

/** The old system's id for a row, or `null` for a row that carries none. */
export const legacyIdOf = (entry: unknown): string | null => {
  if (typeof entry !== 'object' || entry === null) return null;
  const value = (entry as { _id?: unknown })._id;
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'object' && value !== null) {
    const oid = (value as { $oid?: unknown }).$oid;
    if (typeof oid === 'string' && oid.trim() !== '') return oid;
  }
  return null;
};

/** Blank, absent and `null` are one value — «nothing» — in both exports. */
const legacyValue = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  return JSON.stringify(value);
};

export interface BookDiff {
  /** Ids only the new export has, in its order. */
  added: string[];
  /** Ids both exports have whose row differs, with the fields that differ — the book's own names. */
  changed: { id: string; fields: string[] }[];
  /** Ids only the old export has. Reported; a row an export leaves out is not a deleted row. */
  removed: string[];
  /** How many changed rows each field differs on. */
  fieldCounts: Record<string, number>;
  /** Rows either export writes with no id, or with an id another row of it already has. */
  unidentified: { file: 'old' | 'new'; row: number; reason: string }[];
}

/**
 * The two exports, compared field by field, by the old system's own id. Pure, and the book's
 * vocabulary throughout — this is what the owner's two files say, before any rule of the chain.
 * A trailing space is not a change, and neither is a field one export writes empty and the other
 * leaves out: the import reads both as nothing.
 */
export const diffBooks = (oldRaw: readonly unknown[], newRaw: readonly unknown[]): BookDiff => {
  const diff: BookDiff = { added: [], changed: [], removed: [], fieldCounts: {}, unidentified: [] };
  const index = (
    rows: readonly unknown[],
    file: 'old' | 'new',
  ): Map<string, Record<string, unknown>> => {
    const byId = new Map<string, Record<string, unknown>>();
    rows.forEach((entry, row) => {
      const id = legacyIdOf(entry);
      if (id === null) diff.unidentified.push({ file, row, reason: 'no _id' });
      else if (byId.has(id)) diff.unidentified.push({ file, row, reason: `_id ${id} twice` });
      else byId.set(id, entry as Record<string, unknown>);
    });
    return byId;
  };
  const before = index(oldRaw, 'old');
  const after = index(newRaw, 'new');
  for (const [id, row] of after) {
    const was = before.get(id);
    if (was === undefined) {
      diff.added.push(id);
      continue;
    }
    const keys = [...new Set([...Object.keys(was), ...Object.keys(row)])].filter(
      (key) => key !== '_id',
    );
    const fields = keys.filter((key) => legacyValue(was[key]) !== legacyValue(row[key])).sort();
    if (fields.length === 0) continue;
    diff.changed.push({ id, fields });
    for (const field of fields) diff.fieldCounts[field] = (diff.fieldCounts[field] ?? 0) + 1;
  }
  for (const id of before.keys()) if (!after.has(id)) diff.removed.push(id);
  return diff;
};

// ─── The two chains, joined by id ─────────────────────────────────────────────────────────────

/** A row of a planned chain, with the book row it came from. */
export interface PlannedRow {
  id: string;
  parsed: ParsedLogRow;
  chain: ChainRow;
}

/**
 * What can differ between the chain the import wrote and the one a fresh import would write.
 * `car`, `date` and `outReading` move a row along the chain, or onto another one; they are listed,
 * never written (see the header). The rest are applied by the three-way rule.
 */
export type SyncField =
  'car' | 'date' | 'outReading' | 'inReading' | 'driver1' | 'driver2' | 'notes' | 'deleted';

/** The fields a change is WRITTEN for — everything a row can change without moving. */
export const APPLIED_FIELDS = ['inReading', 'driver1', 'driver2', 'notes'] as const;
export type AppliedField = (typeof APPLIED_FIELDS)[number];

export interface RowChange {
  id: string;
  old: PlannedRow;
  next: PlannedRow;
  fields: SyncField[];
}

export interface CarSync {
  code: string;
  /** The car as the NEW plan names it — a registry vehicle, or the book's code alone. */
  ref: BookRef;
  /** Every row the import wrote for this car from the OLD book, in its chain order. */
  old: PlannedRow[];
  /** Rows both books have whose chain differs, in the NEW chain's order. */
  changes: RowChange[];
  /** Rows only the new book has, in the NEW chain's order. */
  added: PlannedRow[];
}

export interface OdometerSyncPlan {
  /** Only the cars with something to do — a change or a new row. */
  cars: CarSync[];
  /** How many rows each field of the chain changes on. */
  planned: Partial<Record<SyncField, number>>;
  /** Rows only the new book has. */
  addedRows: number;
  /** New rows the old system had already deleted — they arrive deleted. */
  keptDeleted: number;
  /** The ids of the new rows, for the reader's own notes on them. */
  addedIds: Set<string>;
  /** «code day: car old → new» — rows the old system moved to another car. Listed, not written. */
  movedCars: string[];
  /** New rows on codes the registry does not have — «code (rows)» — kept by code. */
  unknownCars: string[];
  /** New rows the book left with no opening reading, opened at the car's last known reading. */
  openedByPrevious: number;
  /** New rows whose missing (or impossible) closing reading is the next row's opening one. */
  closedByNext: number;
  /** New rows whose closing reading was below their own opening one. */
  badInReading: number;
  /** The driver spellings of what this step writes — the new rows, and the new drivers. */
  writtenSpellings: string[];
}

const sameRef = (a: DriverRef, b: DriverRef): boolean => a.id === b.id && a.name === b.name;

/** The fields on which two plans of one row differ. */
export const chainDifference = (old: PlannedRow, next: PlannedRow): SyncField[] => {
  const fields: SyncField[] = [];
  if (old.parsed.code !== next.parsed.code) fields.push('car');
  if (old.chain.date.getTime() !== next.chain.date.getTime()) fields.push('date');
  if (old.chain.out !== next.chain.out) fields.push('outReading');
  if (old.chain.in !== next.chain.in) fields.push('inReading');
  if (!sameRef(old.chain.driver1, next.chain.driver1)) fields.push('driver1');
  if (!sameRef(old.chain.driver2, next.chain.driver2)) fields.push('driver2');
  if (old.chain.notes !== next.chain.notes) fields.push('notes');
  if (old.chain.deleted !== next.chain.deleted) fields.push('deleted');
  return fields;
};

/** Every planned row, by the old system's id, with the book row it came from. */
const plannedById = (
  rows: readonly ParsedLogRow[],
  vehicleIdByCode: ReadonlyMap<string, string>,
  driverIdByName: ReadonlyMap<string, string>,
  isNobody: (name: string) => boolean,
): {
  byId: Map<string, PlannedRow>;
  byCode: Map<string, PlannedRow[]>;
  refs: Map<string, BookRef>;
} => {
  const parsedById = new Map(rows.map((row) => [row.id, row]));
  const plan = planOdometerImport(rows, vehicleIdByCode, driverIdByName, isNobody);
  const byId = new Map<string, PlannedRow>();
  const byCode = new Map<string, PlannedRow[]>();
  const refs = new Map<string, BookRef>();
  for (const vehicle of plan.vehicles) {
    refs.set(vehicle.code, vehicle.ref);
    const list: PlannedRow[] = [];
    for (const chain of vehicle.rows) {
      const parsed = chain.id === undefined ? undefined : parsedById.get(chain.id);
      if (parsed === undefined)
        throw new Error(`the planner returned a row with no book row behind it (${vehicle.code})`);
      const planned = { id: parsed.id, parsed, chain };
      byId.set(parsed.id, planned);
      list.push(planned);
    }
    byCode.set(vehicle.code, list);
  }
  return { byId, byCode, refs };
};

/**
 * The two books, each planned by the import's own planner, and joined by id. Pure: the registry
 * and the directory are handed in as maps, exactly as they are to `planOdometerImport`.
 *
 * The rows must carry the old system's ids — `runOdometerSyncGoLive` refuses an export whose rows
 * do not (`diffBooks.unidentified`) before anything is planned.
 */
export const planOdometerSync = (
  oldRows: readonly ParsedLogRow[],
  newRows: readonly ParsedLogRow[],
  vehicleIdByCode: ReadonlyMap<string, string>,
  driverIdByName: ReadonlyMap<string, string>,
  isNobody: (name: string) => boolean = isPlaceholderDriver,
): OdometerSyncPlan => {
  const before = plannedById(oldRows, vehicleIdByCode, driverIdByName, isNobody);
  const after = plannedById(newRows, vehicleIdByCode, driverIdByName, isNobody);
  const plan: OdometerSyncPlan = {
    cars: [],
    planned: {},
    addedRows: 0,
    keptDeleted: 0,
    addedIds: new Set(),
    movedCars: [],
    unknownCars: [],
    openedByPrevious: 0,
    closedByNext: 0,
    badInReading: 0,
    writtenSpellings: [],
  };
  const spellings = new Set<string>();
  const unknown = new Map<string, number>();
  for (const [code, rows] of [...after.byCode].sort(([a], [b]) => a.localeCompare(b))) {
    const car: CarSync = {
      code,
      ref: after.refs.get(code) as BookRef,
      old: before.byCode.get(code) ?? [],
      changes: [],
      added: [],
    };
    for (const next of rows) {
      const old = before.byId.get(next.id);
      if (old === undefined) {
        car.added.push(next);
        continue;
      }
      const fields = chainDifference(old, next);
      if (fields.length === 0) continue;
      if (fields.includes('car')) {
        // Another car's row now. Its ECMS row is on the old car's chain, and moving it is moving a
        // reading between two odometers — a person's decision, with the correction flow's checks.
        plan.movedCars.push(`${old.parsed.code} ${day(old.chain.date)}: car → ${code}`);
        plan.planned.car = (plan.planned.car ?? 0) + 1;
        continue;
      }
      car.changes.push({ id: next.id, old, next, fields });
      for (const field of fields) plan.planned[field] = (plan.planned[field] ?? 0) + 1;
      if (fields.includes('driver1') && next.parsed.driver !== null)
        spellings.add(next.parsed.driver);
      if (fields.includes('driver2') && next.parsed.driver2 !== null)
        spellings.add(next.parsed.driver2);
    }
    // What the new rows needed from the chain — the import's own counts, for these rows alone.
    for (const row of car.added) {
      const { parsed, chain } = row;
      plan.addedRows += 1;
      plan.addedIds.add(parsed.id);
      if (parsed.deletion.isDeleted) plan.keptDeleted += 1;
      if (car.ref.vehicleId === null) unknown.set(code, (unknown.get(code) ?? 0) + 1);
      if (parsed.out === null && !chain.deleted) plan.openedByPrevious += 1;
      const bad = parsed.in !== null && parsed.in < chain.out;
      if (bad) plan.badInReading += 1;
      if (!chain.deleted && chain.in !== null && (parsed.in === null || bad))
        plan.closedByNext += 1;
      for (const name of [parsed.driver, parsed.driver2]) if (name !== null) spellings.add(name);
    }
    if (car.changes.length > 0 || car.added.length > 0) plan.cars.push(car);
  }
  plan.unknownCars = [...unknown].sort().map(([code, count]) => `${code} (${count})`);
  plan.writtenSpellings = [...spellings].sort();
  return plan;
};

// ─── One car, decided against what ECMS holds ────────────────────────────────────────────────

/** A row as ECMS holds it — the lean document, the fields this step reads. */
export type EcmsRow = Pick<
  FleetOdometerLogDoc,
  | '_id'
  | '__v'
  | 'vehicleId'
  | 'date'
  | 'outReading'
  | 'inReading'
  | 'driver1EmployeeId'
  | 'driver2EmployeeId'
  | 'driver1Name'
  | 'driver2Name'
  | 'notes'
  | 'isDeleted'
  | 'deletedBy'
>;

/** A field somebody changed on ECMS since the import — kept, with all three values. */
export interface KeptEdit {
  code: string;
  date: string;
  field: AppliedField | 'deleted';
  ecms: string | null;
  old: string | null;
  new: string | null;
}

/** One write to a row that is already there — conditional on the version the rule was decided on. */
export interface RowUpdate {
  id: Types.ObjectId;
  version: number;
  set: Record<string, unknown>;
}

export interface CarDecision {
  /** In the order they must run: everything that closes or deletes, then whatever opens a row. */
  updates: RowUpdate[];
  /** The new rows, in chain order — one insert. */
  inserts: Partial<FleetOdometerLogDoc>[];
  /** New rows ECMS already had. */
  alreadyThere: number;
  /** Changes ECMS already had. */
  changesAlreadyThere: number;
  /** Changes written, by field. */
  changed: Partial<Record<AppliedField, number>>;
  /** Rows the old system has deleted since, soft-deleted here. */
  deletedByBook: number;
  /** Rows the old system had deleted and has brought back since, brought back here. */
  restoredByBook: number;
  /** Tails an earlier run buried over a contested open period, brought back now they are closed. */
  restored: number;
  closedByExisting: number;
  /** New rows written deleted — the book's own deletions, the unreadable, the contested. */
  writtenDeleted: number;
  keptEcmsEdits: KeptEdit[];
  /**
   * «code day: …» — what could not be brought across: a change to a row ECMS no longer has where
   * the import wrote it, or one that would move a row along the chain.
   */
  unapplied: string[];
  /** «code day» — rows that would have contested the car's one open period. */
  openConflicts: string[];
}

export type SyncDecision = 'apply' | 'alreadyNew' | 'keptEcmsEdit';

/**
 * THE THREE-WAY RULE — see the header. «Already new» is asked first, so a field that equals both
 * sides is counted and never written.
 */
export const decideField = (ecmsIsNew: boolean, ecmsIsOld: boolean): SyncDecision => {
  if (ecmsIsNew) return 'alreadyNew';
  if (ecmsIsOld) return 'apply';
  return 'keptEcmsEdit';
};

const textOrNull = (value: string | null | undefined): string | null =>
  value == null || value.trim() === '' ? null : value.trim();

/**
 * Does ECMS hold this spelling of the driver? The employee HR knows by it, or the spelling kept as
 * text — either is how the import could have written it, depending on whether HR knew the name on
 * the day it ran — or no driver at all, for the book's words for «nobody».
 */
export const holdsDriver = (
  ecms: { id: Types.ObjectId | null | undefined; name: string | null | undefined },
  spelling: string | null,
  driverIdByName: ReadonlyMap<string, string>,
  isNobody: (name: string) => boolean,
): boolean => {
  const ref = driverRef(spelling, driverIdByName, isNobody);
  const name = textOrNull(ecms.name);
  if (ref.id === null && ref.name === null) return ecms.id == null && name === null;
  if (ecms.id != null) return ref.id !== null && String(ecms.id) === ref.id;
  return name === spelling;
};

const driverOf = (row: EcmsRow, slot: 'driver1' | 'driver2') =>
  slot === 'driver1'
    ? { id: row.driver1EmployeeId, name: row.driver1Name }
    : { id: row.driver2EmployeeId, name: row.driver2Name };

const spellingOf = (row: PlannedRow, slot: 'driver1' | 'driver2'): string | null =>
  slot === 'driver1' ? row.parsed.driver : row.parsed.driver2;

/** How a value is read out on the run. An employee id is replaced by the name after the run. */
const shown = (value: number | string | null | undefined): string | null =>
  value == null ? null : String(value);

const shownDriver = (ecms: {
  id: Types.ObjectId | null | undefined;
  name: string | null | undefined;
}): string | null => (ecms.id != null ? `employee:${String(ecms.id)}` : textOrNull(ecms.name));

/** Oldest first. An ObjectId's hex begins with the second it was made, so text order is time order. */
const idOrder = (a: EcmsRow, b: EcmsRow): number => {
  const [x, y] = [String(a._id), String(b._id)];
  return x < y ? -1 : x > y ? 1 : 0;
};

const keyOfRow = (row: EcmsRow): string =>
  fleetOdometerRepository.rowKey(row.date, row.outReading as number);
const keyOfPlan = (row: PlannedRow): string =>
  fleetOdometerRepository.rowKey(row.chain.date, row.chain.out);

/**
 * Pair planned rows with ECMS rows of the same key, most alike first: the same deletion and the
 * same closing reading, then the same deletion, then whichever is oldest. Two passes before the
 * last so a row the book deleted and its live twin — the book writes both for one car and day —
 * each find their own, and neither takes the other's.
 */
const pairUp = (
  planned: readonly PlannedRow[],
  candidates: readonly EcmsRow[],
): Map<string, EcmsRow> => {
  const pairs = new Map<string, EcmsRow>();
  const free = [...candidates];
  const passes: ((p: PlannedRow, c: EcmsRow) => boolean)[] = [
    (p, c) => c.isDeleted === p.chain.deleted && (c.inReading ?? null) === p.chain.in,
    (p, c) => c.isDeleted === p.chain.deleted,
    () => true,
  ];
  for (const pass of passes) {
    for (const row of planned) {
      if (pairs.has(row.id)) continue;
      const at = free.findIndex((candidate) => pass(row, candidate));
      if (at === -1) continue;
      pairs.set(row.id, free[at] as EcmsRow);
      free.splice(at, 1);
    }
  }
  return pairs;
};

interface Pending {
  change: RowChange;
  row: EcmsRow;
  set: Record<string, unknown>;
  applied: AppliedField[];
  deleting: boolean;
  /** Brought back: because the book did (`byBook`), or because it no longer contests (`buried`). */
  restoring: 'byBook' | 'buried' | null;
  /** After it runs, the row is the car's open period — and was not before. */
  opens: boolean;
}

const isOpen = (row: {
  vehicleId: unknown;
  isDeleted: boolean;
  inReading: number | null | undefined;
}): boolean => row.vehicleId != null && !row.isDeleted && row.inReading == null;

/**
 * One car: what to write, decided against what ECMS holds now. Pure — the rows are handed in, the
 * writes are handed back — so every rule is proved on rows alone, and the apply only executes it.
 */
export const decideCarSync = (
  car: CarSync,
  ecms: readonly EcmsRow[],
  driverIdByName: ReadonlyMap<string, string>,
  at: Date,
  isNobody: (name: string) => boolean = isPlaceholderDriver,
): CarDecision => {
  const decision: CarDecision = {
    updates: [],
    inserts: [],
    alreadyThere: 0,
    changesAlreadyThere: 0,
    changed: {},
    deletedByBook: 0,
    restoredByBook: 0,
    restored: 0,
    closedByExisting: 0,
    writtenDeleted: 0,
    keptEcmsEdits: [],
    unapplied: [],
    openConflicts: [],
  };
  const registered = car.ref.vehicleId !== null;

  // ── Claims: the import's rows first, oldest first; what is left over is there to be matched ──
  const rows = [...ecms].filter((row) => row.outReading != null).sort(idOrder);
  const byKey = groupByKey(rows, keyOfRow);
  const oldByKey = groupByKey(car.old, keyOfPlan);
  const claimedOld = new Map<string, EcmsRow>();
  const leftOver = new Map<string, EcmsRow[]>();
  for (const [key, candidates] of byKey) {
    const planned = oldByKey.get(key) ?? [];
    for (const [id, row] of pairUp(planned, candidates.slice(0, planned.length)))
      claimedOld.set(id, row);
    leftOver.set(key, candidates.slice(planned.length));
  }
  const claimedNew = new Map<string, EcmsRow>();
  for (const [key, planned] of groupByKey(car.added, keyOfPlan)) {
    for (const [id, row] of pairUp(planned, leftOver.get(key) ?? [])) claimedNew.set(id, row);
  }
  const claimed = new Set(
    [...claimedOld.values(), ...claimedNew.values()].map((row) => String(row._id)),
  );

  // «The earliest reading typed on the new screen»: the earliest live reading on the car that no
  // row of either export accounts for — see the header.
  const typed = rows
    .filter(
      (row) =>
        registered && row.vehicleId != null && !row.isDeleted && !claimed.has(String(row._id)),
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime() || idOrder(a, b));
  const head = typed[0] ?? null;

  // ── Changes, by the three-way rule ──
  const pending: Pending[] = [];
  for (const change of car.changes) {
    const { old, next } = change;
    const label = `${car.code} ${day(old.chain.date)}`;
    const row = claimedOld.get(change.id);
    if (row === undefined) {
      decision.unapplied.push(
        `${label}: ${change.fields.join(', ')} — the reading is not where the import wrote it`,
      );
      continue;
    }
    // A row the old system moved along the chain — to another day, or another opening reading —
    // is listed WHOLE, and nothing of it is written. Its other changes belong to the place it
    // moved to: a closing reading measured from an opening reading ECMS does not hold would write
    // a distance nobody drove, and a deletion would take away a reading the chain still leans on
    // where ECMS has it. Moving it is a person's decision, made with the correction flow's checks.
    const moves = [
      ...(change.fields.includes('date') ? [`date → ${day(next.chain.date)}`] : []),
      ...(change.fields.includes('outReading')
        ? [`outReading ${old.chain.out} → ${next.chain.out}`]
        : []),
    ];
    if (moves.length > 0) {
      decision.unapplied.push(
        `${label}: ${moves.join(', ')} — the row would move along the chain, so none of ${change.fields.join(', ')} is written`,
      );
      continue;
    }

    // Every field this step compares, as ECMS holds it against both chains — a change is decided
    // by it, and a deletion needs ALL of them to be one side or the other.
    const inReading = row.inReading ?? null;
    const notes = textOrNull(row.notes);
    const holds = {
      inReading: { old: inReading === old.chain.in, next: inReading === next.chain.in },
      driver1: {
        old: holdsDriver(
          driverOf(row, 'driver1'),
          spellingOf(old, 'driver1'),
          driverIdByName,
          isNobody,
        ),
        next: holdsDriver(
          driverOf(row, 'driver1'),
          spellingOf(next, 'driver1'),
          driverIdByName,
          isNobody,
        ),
      },
      driver2: {
        old: holdsDriver(
          driverOf(row, 'driver2'),
          spellingOf(old, 'driver2'),
          driverIdByName,
          isNobody,
        ),
        next: holdsDriver(
          driverOf(row, 'driver2'),
          spellingOf(next, 'driver2'),
          driverIdByName,
          isNobody,
        ),
      },
      notes: { old: notes === old.chain.notes, next: notes === next.chain.notes },
    } satisfies Record<AppliedField, { old: boolean; next: boolean }>;

    // The old system's deletion, decided BEFORE the fields: it is applied only to a row nobody
    // decided anything about on ECMS — every field still what one export or the other gave it.
    const deletedSince = change.fields.includes('deleted') && next.chain.deleted;
    const edited = APPLIED_FIELDS.filter((field) => !holds[field].old && !holds[field].next);
    const deleting = deletedSince && !row.isDeleted && edited.length === 0;

    const set: Record<string, unknown> = {};
    const applied: AppliedField[] = [];
    let keptIn = false;
    for (const field of APPLIED_FIELDS) {
      if (!change.fields.includes(field)) continue;
      // The closing reading of a row the old system deleted since belongs to that deletion: the
      // planner stops closing a deleted row by the next one, so the new chain may give it none.
      // Where the deletion is kept off (a person changed the row), the row is still a live link
      // on ECMS, and emptying — or moving — its closing reading would reopen or tear the middle
      // of the car's history. The deletion's own line on the run says why nothing was written.
      if (field === 'inReading' && deletedSince && !row.isDeleted && !deleting) continue;
      const verdict = decideField(holds[field].next, holds[field].old);
      if (verdict === 'alreadyNew') {
        decision.changesAlreadyThere += 1;
        continue;
      }
      if (verdict === 'keptEcmsEdit') {
        if (field === 'inReading') keptIn = true;
        decision.keptEcmsEdits.push({
          code: car.code,
          date: day(old.chain.date),
          field,
          ecms:
            field === 'inReading'
              ? shown(inReading)
              : field === 'notes'
                ? notes
                : shownDriver(driverOf(row, field)),
          old:
            field === 'inReading'
              ? shown(old.chain.in)
              : field === 'notes'
                ? old.chain.notes
                : spellingOf(old, field),
          new:
            field === 'inReading'
              ? shown(next.chain.in)
              : field === 'notes'
                ? next.chain.notes
                : spellingOf(next, field),
        });
        continue;
      }
      applied.push(field);
      if (field === 'inReading') {
        set['inReading'] = next.chain.in;
        set['km'] = next.chain.in === null ? null : next.chain.in - (row.outReading as number);
      } else if (field === 'notes') {
        set['notes'] = next.chain.notes;
      } else {
        const ref = next.chain[field];
        set[`${field}EmployeeId`] = ref.id === null ? null : new Types.ObjectId(ref.id);
        set[`${field}Name`] = ref.name;
      }
    }

    let restoring: Pending['restoring'] = null;
    if (change.fields.includes('deleted')) {
      if (next.chain.deleted) {
        // The old system deleted the row since — decided above.
        if (row.isDeleted) {
          decision.changesAlreadyThere += 1;
        } else if (edited.length > 0) {
          decision.keptEcmsEdits.push({
            code: car.code,
            date: day(old.chain.date),
            field: 'deleted',
            ecms: `live — ${edited.join(', ')} changed on ECMS`,
            old: 'live',
            new: 'deleted',
          });
        } else {
          Object.assign(set, deletedFields(next.chain.deletion, at));
        }
      } else if (!row.isDeleted) {
        decision.changesAlreadyThere += 1;
      } else if (row.deletedBy == null) {
        // The book brought a row back that it had deleted, and ECMS still has it as the import
        // wrote it. A row a PERSON deleted carries their id, and stays deleted.
        restoring = 'byBook';
        Object.assign(set, liveFields());
      } else {
        decision.keptEcmsEdits.push({
          code: car.code,
          date: day(old.chain.date),
          field: 'deleted',
          ecms: 'deleted on ECMS',
          old: 'deleted',
          new: 'live',
        });
      }
    } else if (
      row.isDeleted &&
      row.deletedBy == null &&
      !old.chain.deleted &&
      !next.chain.deleted &&
      old.chain.in === null &&
      next.chain.in !== null &&
      !keptIn
    ) {
      // A tail an earlier run BURIED over a contested open period, which the new book now closes:
      // it is no longer the car's last reading, so it contests nothing — it comes back, as the
      // import brings back its own (`restored`).
      restoring = 'buried';
      Object.assign(set, liveFields());
    }

    if (Object.keys(set).length === 0) continue;
    const after = {
      vehicleId: row.vehicleId,
      isDeleted: (set['isDeleted'] as boolean | undefined) ?? row.isDeleted,
      inReading: 'inReading' in set ? (set['inReading'] as number | null) : inReading,
    };
    pending.push({
      change,
      row,
      set,
      applied,
      deleting,
      restoring,
      opens: isOpen(after) && !isOpen(row),
    });
  }

  // ── The car's one open period, after everything that closes or deletes has run ──
  const openIds = new Set(rows.filter(isOpen).map((row) => String(row._id)));
  const closing = pending.filter((entry) => !entry.opens);
  for (const entry of closing) {
    const isDeleted = (entry.set['isDeleted'] as boolean | undefined) ?? entry.row.isDeleted;
    const inReading = 'inReading' in entry.set ? entry.set['inReading'] : entry.row.inReading;
    if (isDeleted || inReading != null) openIds.delete(String(entry.row._id));
  }
  /** The head a row would be closed against — the import's rule for its own tail. */
  const joinable = (date: Date, out: number): number | null =>
    head !== null && head.date >= date && (head.outReading as number) >= out
      ? (head.outReading as number)
      : null;

  const done: Pending[] = [...closing];
  for (const entry of pending.filter((candidate) => candidate.opens)) {
    const label = `${car.code} ${day(entry.change.next.chain.date)}`;
    if (openIds.size === 0) {
      openIds.add(String(entry.row._id));
      done.push(entry);
      continue;
    }
    const out = entry.row.outReading as number;
    const join = joinable(entry.row.date, out);
    if (join !== null) {
      entry.set['inReading'] = join;
      entry.set['km'] = join - out;
      if (!entry.applied.includes('inReading')) entry.applied.push('inReading');
      decision.closedByExisting += 1;
      done.push(entry);
      continue;
    }
    // It would be a second open period. What it would open stays as ECMS has it, and is named.
    decision.openConflicts.push(label);
    if (entry.restoring !== null) {
      entry.restoring = null;
      for (const key of ['isDeleted', 'deletedAt', 'deletedBy']) delete entry.set[key];
    }
    if ('inReading' in entry.set && entry.set['inReading'] === null) {
      delete entry.set['inReading'];
      delete entry.set['km'];
      entry.applied = entry.applied.filter((field) => field !== 'inReading');
    }
    if (Object.keys(entry.set).length > 0) done.push(entry);
  }
  for (const entry of done) {
    decision.updates.push({ id: entry.row._id, version: entry.row.__v, set: entry.set });
    for (const field of entry.applied) decision.changed[field] = (decision.changed[field] ?? 0) + 1;
    if (entry.deleting) decision.deletedByBook += 1;
    if (entry.restoring === 'byBook') decision.restoredByBook += 1;
    if (entry.restoring === 'buried') decision.restored += 1;
  }

  // ── The new rows, as the import writes them ──
  for (const planned of car.added) {
    const found = claimedNew.get(planned.id);
    if (found !== undefined) {
      decision.alreadyThere += 1;
      // A tail an earlier attempt of this step PARKED — written deleted over a contested open
      // period, by nobody — is still parked, and is named again: the take-over's outcome replaces
      // the first attempt's, and a reading kept deleted that no line names is one nobody looks at.
      // The import names its own buried rows on every run the same way.
      if (
        registered &&
        !planned.chain.deleted &&
        planned.chain.in === null &&
        found.isDeleted &&
        found.deletedBy == null
      ) {
        decision.openConflicts.push(`${car.code} ${day(planned.chain.date)}`);
      }
      continue;
    }
    const { chain } = planned;
    let inReading = chain.in;
    let deleted = chain.deleted;
    if (inReading === null && !deleted && registered && openIds.size > 0) {
      const join = joinable(chain.date, chain.out);
      if (join !== null) {
        inReading = join;
        decision.closedByExisting += 1;
      } else {
        decision.openConflicts.push(`${car.code} ${day(chain.date)}`);
        deleted = true;
      }
    }
    if (inReading === null && !deleted && registered) openIds.add(`new:${planned.id}`);
    if (deleted) decision.writtenDeleted += 1;
    decision.inserts.push({
      ...bookRefFields(car.ref),
      date: chain.date,
      outReading: chain.out,
      inReading,
      km: inReading === null ? null : inReading - chain.out,
      driver1EmployeeId: chain.driver1.id === null ? null : new Types.ObjectId(chain.driver1.id),
      driver2EmployeeId: chain.driver2.id === null ? null : new Types.ObjectId(chain.driver2.id),
      driver1Name: chain.driver1.name,
      driver2Name: chain.driver2.name,
      notes: chain.notes,
      ...(deleted ? deletedFields(chain.deletion, at) : liveFields()),
    });
  }
  return decision;
};

// ─── The apply ────────────────────────────────────────────────────────────────────────────────

export interface OdometerSyncOutcome {
  /** Cars the step wrote to, or found already written. */
  vehicles: number;
  added: number;
  alreadyThere: number;
  changesAlreadyThere: number;
  changed: Partial<Record<AppliedField, number>>;
  deletedByBook: number;
  restoredByBook: number;
  restored: number;
  closedByExisting: number;
  writtenDeleted: number;
  keptEcmsEdits: KeptEdit[];
  unapplied: string[];
  openConflicts: string[];
  failures: { code: string; reason: string }[];
}

/**
 * Every row ECMS has for this car that the import could have written — by registry id, and by the
 * book's code too: a car the registry did not have when the import ran, and has now, still has
 * its old rows under the code, and they are still the rows the import wrote.
 */
const ecmsRowsOf = async (car: CarSync): Promise<EcmsRow[]> => {
  const refs: BookRef[] =
    car.ref.vehicleId === null ? [car.ref] : [car.ref, { vehicleId: null, vehicleCode: car.code }];
  const rows: EcmsRow[] = [];
  for (const ref of refs) {
    for (const group of (await fleetOdometerRepository.existingByKey(ref)).values())
      rows.push(...group);
  }
  return rows;
};

/**
 * One write, conditional on the version the rule was decided against. A person who saves the row
 * in between makes it miss — the car fails, the run is left unfinished, and the take-over decides
 * again against what they saved. Every write moves the version, a deletion included.
 */
const writeRow = async (update: RowUpdate, by: string): Promise<void> => {
  const result = await FleetOdometerLogModel.updateOne(
    { _id: update.id, __v: update.version },
    { $set: { ...update.set, updatedBy: new Types.ObjectId(by) }, $inc: { __v: 1 } },
  ).exec();
  if (result.matchedCount !== 1) {
    throw new Error(
      `reading ${String(update.id)} changed on ECMS while this step ran — the next boot decides again`,
    );
  }
};

/**
 * Apply a plan, one car at a time. One car failing does not stop the next; the run reports them
 * all and is left unfinished, and the take-over that follows finds every change already there
 * and every row already written.
 */
export const applyOdometerSync = async (
  plan: OdometerSyncPlan,
  driverIdByName: ReadonlyMap<string, string>,
  by: string,
  isNobody: (name: string) => boolean = isPlaceholderDriver,
): Promise<OdometerSyncOutcome> => {
  const outcome: OdometerSyncOutcome = {
    vehicles: 0,
    added: 0,
    alreadyThere: 0,
    changesAlreadyThere: 0,
    changed: {},
    deletedByBook: 0,
    restoredByBook: 0,
    restored: 0,
    closedByExisting: 0,
    writtenDeleted: 0,
    keptEcmsEdits: [],
    unapplied: [],
    openConflicts: [],
    failures: [],
  };
  // Every field the new book changes is on the count, a zero included — «inReading: 72» beside a
  // plan of 74 says, on its own, that two were kept or already there.
  for (const field of APPLIED_FIELDS) {
    if ((plan.planned[field] ?? 0) > 0) outcome.changed[field] = 0;
  }
  const at = new Date();
  for (const car of plan.cars) {
    try {
      const decided = decideCarSync(car, await ecmsRowsOf(car), driverIdByName, at, isNobody);
      for (const update of decided.updates) await writeRow(update, by);
      if (decided.inserts.length > 0)
        await fleetOdometerRepository.createMany(decided.inserts, { by });
      outcome.vehicles += 1;
      outcome.added += decided.inserts.length;
      outcome.alreadyThere += decided.alreadyThere;
      outcome.changesAlreadyThere += decided.changesAlreadyThere;
      for (const [field, count] of Object.entries(decided.changed) as [AppliedField, number][]) {
        outcome.changed[field] = (outcome.changed[field] ?? 0) + count;
      }
      outcome.deletedByBook += decided.deletedByBook;
      outcome.restoredByBook += decided.restoredByBook;
      outcome.restored += decided.restored;
      outcome.closedByExisting += decided.closedByExisting;
      outcome.writtenDeleted += decided.writtenDeleted;
      outcome.keptEcmsEdits.push(...decided.keptEcmsEdits);
      outcome.unapplied.push(...decided.unapplied);
      outcome.openConflicts.push(...decided.openConflicts);
    } catch (error) {
      outcome.failures.push({ code: car.code, reason: failureReason(error) });
    }
  }
  await nameKeptDrivers(outcome.keptEcmsEdits);
  return outcome;
};

/** A kept driver read out BY NAME — an employee id means nothing to whoever reads the run. */
const nameKeptDrivers = async (kept: KeptEdit[]): Promise<void> => {
  const prefix = 'employee:';
  const ids = kept.flatMap((edit) =>
    edit.ecms?.startsWith(prefix) ? [edit.ecms.slice(prefix.length)] : [],
  );
  if (ids.length === 0) return;
  const names = await getDirectoryEmployees([...new Set(ids)]);
  for (const edit of kept) {
    if (!edit.ecms?.startsWith(prefix)) continue;
    const id = edit.ecms.slice(prefix.length);
    edit.ecms = names.get(id)?.fullNameAr ?? id;
  }
};
