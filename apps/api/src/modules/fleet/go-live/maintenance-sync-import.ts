// The go-live WORKSHOP SYNC: a second export of the legacy `car_maintenance` book, read against
// the first one, and the difference brought onto the visits the first one filled. Importable and
// side-effect free until `applyMaintenanceSync`; `maintenance-sync.ts` runs it at boot.
//
// «صفحة الصيانات و صفحة قراءة العدادات دول الملفات بتاعتهم من السيستم القديم شوف لو فى داتا
// المفروض تتضاف او تتعدل اعمل كدا». The old system is still in use beside this one, so the book
// kept growing after `car-maintenance.json` was shipped and imported (`go-live:maintenance:v3`).
// The owner's export of 29 September has 1,981 rows where the shipped one had 1,938, and read by
// the old system's own row id it holds exactly two kinds of news:
//
//   43 rows the first export did not have — visits that went in from 16 to 29 September, one of
//      them already deleted in the old system;
//   10 rows the old system has CHANGED since — nine visits closed (or their day out moved), seven
//      of them with the driver who took the car out, three with the parts the workshop fitted,
//      one counter written in and one note extended.
//
// No row of the first export is missing from the second. Had one been, it would be REPORTED and
// nothing deleted: a row an export leaves out is not a row the old system deleted — that one
// arrives with `deleted: 1`, and is treated as the change it is (below).
//
// WHY ONLY THE NEW ROWS ARE PLANNED — and not the whole new book handed back to the import,
// relying on its per-row idempotency. The import recognises a visit it already wrote by four
// things: the car, the day in, the workshop and the work (`rowKey`). That is exactly right for a
// take-over minutes after a crash, and it is wrong two weeks after go-live, because all four are
// things a person can have changed on ECMS since: the visit form edits the day in, the workshop
// and the work; a car the registry did not have can have been added to it (its visits were
// written under the book's code, and would no longer be found under the car's id); a catalog word
// can have been renamed. Every one of those edits would make a re-planned row look NEW, and it
// would be written a second time — visibly, on the screen, beside the corrected one. The legacy
// id needs no such luck: the two exports say, by themselves, which 43 rows are new, and those are
// the only rows this step can write.
//
// Those 43 rows are then planned and written by the import ITSELF (`planMaintenanceImport`,
// `applyMaintenanceImport`), so they meet every rule the first 1,938 met and none can drift: the
// drivers resolved by name through HR, with the workshop book's spellings for «nobody»; a car the
// registry never had keeping its visit by code; a row the old system deleted arriving deleted,
// carrying the day of it — «لو فى صفوف كانت ممسوحه عاوزها موجوده والdeleted 1 زى ما هى»; the one
// open visit per car, a second one written deleted rather than dropped; the book's own words for
// the catalog, «غير محدد» for a blank; the counter from the book, or from the odometer chain, or
// 0 and listed. And the import's own match does what it did for the first book — a visit a person
// already TYPED on ECMS since go-live (the same car, day in, workshop and work) is counted as
// already there and not written twice, its driver's name filled in where it had none.
//
// The one thing the whole-book re-plan would have got right on its own is kept by hand: the rows
// both exports share have their visits on ECMS already, and they CLAIM them first (`claimed`, in
// `applyMaintenanceImport`), so a new row that happens to share a car, a day in, a workshop and a
// work with an old one is written, not mistaken for it. The real export has no such row; the rule
// is there so that a later one cannot quietly lose a visit that way.
//
// THE ORDER: changes first, then the new rows. A visit the new export closes frees its car's one
// open slot, and the visit the book opened on that car afterwards must find it free — the other
// way round it would be written deleted as a second open visit that no longer is one.
//
// THE THREE-WAY RULE, for every field the new export changes. The OLD export is what the import
// wrote; ECMS is what the visit holds now; the NEW export is what the old system says now:
//
//   ECMS = NEW  → already there (a person made the same change here, or an earlier attempt of this
//                 run did) — counted, not written;
//   ECMS = OLD  → nobody has touched the field since the import wrote it — the NEW value is written;
//   otherwise   → somebody changed it on ECMS since — THEIR value stays, and the field is listed
//                 with the car, the day and all three values, for whoever owns the visit to decide.
//
// A person's edit is never overwritten. That is also what makes a take-over safe: a field this run
// wrote reads as «already there» to the next attempt.
//
// FINDING THE VISIT the import wrote from the OLD row is done the way the import's take-over
// found it — the car (by the registry's id, or by the book's code for a car it never had), the
// key made of the day in, the workshop and the work as the OLD row names them, and, where the
// old book has several rows under one key (44 keys do — 43 pairs and one four; car 507 on 13
// September is one of the ten changes), its place among them in the planner's own order — the
// order the import wrote them in. The visits under a key are put in THAT order before the place
// is read, by id (an id is minted as the visit is written, and the import wrote a car's visits in
// the planner's order): the database's own order is not it. The car's visits are read through
// its index on the day out, so two visits under one key come back latest-out first, and 507's
// live visit would have been told apart from the deleted one beside it only by luck. A visit
// that cannot be found that way — a person has since changed one of those four things on ECMS,
// or deleted the catalog word — is not guessed at: every field of the change is listed as not
// applied.
//
// WHAT «EQUAL» MEANS, field by field, is what the import would have written, never the spelling:
// a date is a day; a workshop, a work type or a part is the catalog row its folded word files it
// under; the parts are a SET (the form does not keep the book's order, and a part named twice is
// one part); a driver is the employee HR knows by the spelling OR the spelling kept as text —
// whichever of the two the visit holds, since HR can have learned the name since; and the notes
// are the book's text with whatever the import appended to it.
//
// THE COUNTER THE OLD BOOK LEFT BLANK is the one old value the export cannot state: the import
// wrote a stand-in — the car's reading on or before the day it went in, or the first after, or 0 —
// and did not record which. Car 501's visit of 15 September is the one such change, and what
// its stand-in was is no longer on the chain: it came from the old book's readings of 13 and 14
// September, which the odometer book's own new export has since DELETED — and the odometer sync
// stamps such a reading with the book's day of it, 20 September at 08:29, which is very likely
// BEFORE the workshop import wrote the visit (`go-live:maintenance:v3` shipped later that day, and
// the step before it had been refusing). A chain «as it stood» read by `deletedAt` alone would
// then leave both readings out, find another stand-in, and call the import's own value a person's
// edit. So «untouched» is read three ways, any one of which is enough:
//
//   - the visit was written BY THE IMPORT and nobody has saved it since — `createdBy` is the
//     seeded admin and `__v` is still 0. Every write the visit form makes (edit, check-out,
//     reopen, delete) moves `__v`; the import's one repair, a driver's name, does not. Such a
//     visit holds exactly what the import wrote, whatever the chain says now. A visit a person
//     TYPED — which the import then matched as «already there» — was created by that person, and
//     its counter is theirs;
//   - the stand-in found again the way the import found it, against the chain as it stood when the
//     visit was written — the readings recorded by then that were still on it, a reading deleted
//     later counting as on it (by its `deletedAt`, or by its `updatedAt` for one a later step
//     deleted with the book's older day);
//   - the stand-in against the chain as it stands now.
//
// Any other value is a person's, and is kept.
//
// CLOSING A VISIT RESPECTS THE MODEL EXACTLY AS THE IMPORT DOES. A visit that leaves before it
// arrived is written with both of the book's dates and listed (`outBeforeIn`), not repaired; the
// exit reading is left as it is — the old system never had one; the driver who took it out comes
// from `driver2` like every other. The one invariant a change can break is the one-open-visit
// index, and only by REOPENING a visit (or by the old system restoring a deleted one) on a car
// already in a workshop on ECMS. The import writes such a visit deleted rather than refuse it; a
// visit already on the screen is not deleted for it — a reopening is simply not applied and is
// listed, and a restoring leaves the visit deleted, as the import would have written it, and
// lists it among the open conflicts. The service's own rule that the car cannot leave on a lower
// reading than it came in on is kept too: a counter above an exit reading ECMS recorded is listed.
//
// A VISIT THE IMPORT PARKED — written deleted as a car's second open visit — takes the book's
// changes and STAYS deleted even when the book now closes it. Parking it was the import's call,
// not the book's, and the car's other open visit on ECMS was very likely the same visit typed on
// the new screen; bringing it back would show it twice. It is listed, to be restored by hand if
// it is not.
//
// EVERY DELETION IS SOFT: «الداتا اللى ممسوحه متظهرش للمستخدم تبقى فى الداتا بيز فقط». A visit the
// old book has now deleted is deleted here by the same three-way rule — `isDeleted`, the book's
// day of it, `deletedBy` null because a boot did it, `__v` moved so a form still open on it is
// refused as stale — and stays in the collection.
//
// `out_by`, `added_by` and the other legacy bookkeeping still do not travel — the import's reason:
// they are the old system's login names, not employees. Seven of the ten changes carry an
// `out_by`; it is counted with the export's columns and written nowhere.
//
// Each changed visit is written in ONE update, guarded by the version it was decided against (a
// person saving the visit between the read and the write makes this visit fail, and the take-over
// decides it again against what they saved), and audited as the visit form's own edits are.
import { Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { getDirectoryEmployee } from '../../../platform/directory';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetCatalogItemRepository } from '../catalogs';
import {
  FleetMaintenanceVisitModel,
  type FleetMaintenanceVisitDoc,
} from '../maintenance/maintenance.model';
import { fleetMaintenanceRepository } from '../maintenance/maintenance.repository';
import { FleetOdometerLogModel } from '../odometer/odometer.model';
import { fleetOdometerRepository } from '../odometer/odometer.repository';
import { day, driverRef } from './odometer-import';
import { bookRefOf, type BookRef } from './book-ref';
import { deletedFields, liveFields } from './legacy-row';
import {
  applyMaintenanceImport,
  isNobodyInWorkshop,
  parseVisits,
  resolveCatalog,
  UNSPECIFIED,
  type CatalogIndex,
  type MaintenanceImportOutcome,
  type MaintenancePlan,
  type ParsedVisit,
} from './maintenance-import';
import { failureReason, fold } from './vehicles-import';

/**
 * Every fact of a visit a later export can change, in the visit form's order. `car` is here to be
 * REPORTED: a visit is not moved from one car to another by an import.
 */
export const SYNC_FIELDS = [
  'car',
  'inDate',
  'outDate',
  'workshop',
  'workType',
  'spareParts',
  'counter',
  'driverIn',
  'driverOut',
  'notes',
  'deleted',
] as const;
export type SyncField = (typeof SYNC_FIELDS)[number];

/** One row both exports carry, which the new one changes. */
export interface VisitChange {
  /** The old system's row id — what the two exports are joined on. */
  id: string;
  /** The car and the day in as the OLD export has them: how the visit is found, and named. */
  code: string;
  date: string;
  old: ParsedVisit;
  next: ParsedVisit;
  /** What changes on the visit, in the model's terms. */
  fields: SyncField[];
  /** What changed in the export, in the old system's own column names — `out_by` among them. */
  columns: string[];
  /**
   * Which of the OLD book's rows with this car, day in, workshop and work this one is, in the
   * planner's order — the place its visit took among the import's rows under that key.
   */
  slot: number;
}

export interface MaintenanceSyncPlan {
  /** Rows in the NEW export. */
  rows: number;
  /** Rows only the new export has, in its order — written by the import's own planner. */
  added: ParsedVisit[];
  /** Rows the new export changes something on the visit of. */
  changes: VisitChange[];
  /** How many rows each export column changed on — the old system's own account of the diff. */
  columnsChanged: Record<string, number>;
  /** How many visits each field changes on. */
  inExport: Partial<Record<SyncField, number>>;
  /** «code in-date» — rows only the OLD export had. Reported; nothing is deleted for it. */
  goneFromExport: string[];
  /**
   * Every row both exports carry, as the NEW export has it, by the car its visit is filed under —
   * the visits those rows already have on ECMS, which a new row must not be matched against.
   */
  claimed: Map<string, ParsedVisit[]>;
  /** Among the new rows: the ones the old system had already deleted — they arrive deleted. */
  keptDeleted: number;
  /** Among the new rows: the ones it could not read cleanly — kept, written deleted, listed. */
  unreadable: { id: string; reason: string }[];
  /** A file that is not a list of rows, or names one row twice — the diff cannot be made. */
  rejected: { file: 'old' | 'new'; id: string; reason: string }[];
}

/** Written deleted by the import: the book deleted it, or the model could not hold it alive. */
export const plannedDeleted = (visit: ParsedVisit): boolean =>
  visit.deletion.isDeleted || visit.unreadable;

/** A catalog word as the import matched it — folded, and a blank being «غير محدد». */
export const catalogWord = (name: string | null): string => fold(name ?? UNSPECIFIED.ar);

/** The parts as a SET of folded words — the order the book listed them in is not a fact. */
const partsWord = (parts: readonly string[]): string =>
  [...new Set(parts.map((part) => fold(part)))].sort().join('|');

/** A driver spelling, or nothing for the workshop book's words for «nobody». */
const driverWord = (name: string | null): string | null =>
  name === null || isNobodyInWorkshop(name) ? null : name;

const dayOrNull = (date: Date | null): string | null => (date === null ? null : day(date));

/**
 * What the new export changes on a visit, compared as the import would have WRITTEN each side: a
 * date as a day, a catalog word folded, the parts as a set, «nobody» as nobody. A spelling the
 * old system tidied is not a change.
 */
export const changedFields = (old: ParsedVisit, next: ParsedVisit): SyncField[] => {
  const differs: Record<SyncField, boolean> = {
    car: old.code !== next.code,
    inDate: day(old.inDate) !== day(next.inDate),
    outDate: dayOrNull(old.outDate) !== dayOrNull(next.outDate),
    workshop: catalogWord(old.workshop) !== catalogWord(next.workshop),
    workType: catalogWord(old.workType) !== catalogWord(next.workType),
    spareParts: partsWord(old.parts) !== partsWord(next.parts),
    counter: old.counter !== next.counter,
    driverIn: driverWord(old.driver) !== driverWord(next.driver),
    driverOut: driverWord(old.driver2) !== driverWord(next.driver2),
    notes: old.notes !== next.notes,
    deleted: plannedDeleted(old) !== plannedDeleted(next),
  };
  return SYNC_FIELDS.filter((field) => differs[field]);
};

/** The key a visit was matched by in the import — `rowKey`'s, with the catalog as words. */
const slotKeyOf = (visit: ParsedVisit): string =>
  [
    visit.code,
    visit.inDate.toISOString(),
    catalogWord(visit.workshop),
    catalogWord(visit.workType),
  ].join('|');

/** The planner's order within a car — `planMaintenanceImport` sorts exactly so. */
const plannerOrder = (a: ParsedVisit, b: ParsedVisit): number =>
  a.inDate.getTime() - b.inDate.getTime() || a.id.localeCompare(b.id);

/** The export's columns that differ between two versions of one row — `_id` is the join. */
const columnsOf = (before: unknown, after: unknown): string[] => {
  const a = (typeof before === 'object' && before !== null ? before : {}) as Record<
    string,
    unknown
  >;
  const b = (typeof after === 'object' && after !== null ? after : {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => key !== '_id')
    .filter((key) => JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null));
};

/**
 * The two exports, compared by the old system's row id. Pure: both are read by the import's own
 * `parseVisits`, so every value is already what the import would have made of it.
 */
export const planMaintenanceSync = (oldRaw: unknown, newRaw: unknown): MaintenanceSyncPlan => {
  const oldBook = parseVisits(oldRaw);
  const newBook = parseVisits(newRaw);
  const plan: MaintenanceSyncPlan = {
    rows: newBook.visits.length,
    added: [],
    changes: [],
    columnsChanged: {},
    inExport: {},
    goneFromExport: [],
    claimed: new Map(),
    keptDeleted: 0,
    unreadable: [],
    rejected: [],
  };
  for (const [file, book, raw] of [
    ['old', oldBook, oldRaw],
    ['new', newBook, newRaw],
  ] as const) {
    plan.rejected.push(...book.rejected.map((row) => ({ file, ...row })));
    // A row with no id of its own is named by its PLACE in its file (`row 12`), and the same place
    // in the other file is another row — joined on that, it would be read as a change to a row it
    // is not. So it is refused, as the odometer sync refuses one.
    if (Array.isArray(raw)) {
      raw.forEach((entry: unknown, index) => {
        const id = (entry as { _id?: unknown } | null)?._id;
        const named =
          typeof id === 'string' ||
          (typeof id === 'object' &&
            id !== null &&
            typeof (id as { $oid?: unknown }).$oid === 'string');
        if (!named) {
          plan.rejected.push({
            file,
            id: `row ${index}`,
            reason: 'no row id — the two exports are compared by it',
          });
        }
      });
    }
    const seen = new Set<string>();
    for (const visit of book.visits) {
      if (seen.has(visit.id)) {
        plan.rejected.push({
          file,
          id: visit.id,
          reason: 'the same row id twice — the two exports are compared by it',
        });
      }
      seen.add(visit.id);
    }
  }
  if (plan.rejected.length > 0) return plan;

  // `parseVisits` yields one visit per row, in the file's order — so the raw row is beside it.
  const oldRows = oldRaw as unknown[];
  const newRows = newRaw as unknown[];
  const before = new Map(
    oldBook.visits.map((visit, index) => [visit.id, { visit, raw: oldRows[index] }]),
  );

  const slots = new Map<string, number>();
  const groups = new Map<string, ParsedVisit[]>();
  for (const visit of oldBook.visits) {
    const key = slotKeyOf(visit);
    groups.set(key, [...(groups.get(key) ?? []), visit]);
  }
  for (const group of groups.values()) {
    [...group].sort(plannerOrder).forEach((visit, index) => slots.set(visit.id, index));
  }

  const inNew = new Set<string>();
  newBook.visits.forEach((next, index) => {
    inNew.add(next.id);
    const was = before.get(next.id);
    if (was === undefined) {
      plan.added.push(next);
      if (next.deletion.isDeleted) plan.keptDeleted += 1;
      return;
    }
    const columns = columnsOf(was.raw, newRows[index]);
    for (const column of columns) {
      plan.columnsChanged[column] = (plan.columnsChanged[column] ?? 0) + 1;
    }
    const fields = changedFields(was.visit, next);
    for (const field of fields) plan.inExport[field] = (plan.inExport[field] ?? 0) + 1;
    // The visit stays on the car the import filed it under — a car change is reported, not made.
    const claim = fields.includes('car') ? { ...next, code: was.visit.code } : next;
    plan.claimed.set(claim.code, [...(plan.claimed.get(claim.code) ?? []), claim]);
    if (fields.length === 0) return;
    plan.changes.push({
      id: next.id,
      code: was.visit.code,
      date: day(was.visit.inDate),
      old: was.visit,
      next,
      fields,
      columns,
      slot: slots.get(next.id) ?? 0,
    });
  });
  const addedIds = new Set(plan.added.map((visit) => visit.id));
  plan.unreadable = newBook.unreadable.filter((row) => addedIds.has(row.id));
  plan.goneFromExport = oldBook.visits
    .filter((visit) => !inNew.has(visit.id))
    .map((visit) => `${visit.code} ${day(visit.inDate)}`);
  return plan;
};

/**
 * A value in the one shape the rule compares: a day, a catalog id, a set of ids, a number, a
 * driver as `employee:<id>` or `name:<spelling>`, text, `deleted`/`live` — or `null` for nothing.
 * `undefined` is «this is nothing ECMS can name» — a catalog word with no row — and it equals
 * NOTHING: a value nobody can name cannot prove a field untouched.
 */
export type ValueKey = string | null | undefined;

export type SyncDecision = 'unchanged' | 'alreadyThere' | 'apply' | 'keptEcmsEdit';

/**
 * THE THREE-WAY RULE — see the header. Each side is a LIST of keys: the forms ECMS could hold one
 * book value in (a driver HR knows is either the employee or the spelling). Two questions come
 * before the rule itself: whether the change is a change at all once both sides are in the
 * model's terms (two spellings of one employee are not), and «already there» before «apply», so a
 * field equal to both sides is counted and never written.
 *
 * `oneValue` says what a side's LIST is. For every field but one it is several forms of ONE value,
 * and a form both sides share means both sides are that value. For a counter the book left blank
 * it is not: the old side is every stand-in the import MIGHT have written, only one of which it
 * did — so the new counter matching one of the others says nothing about the visit, and the rule
 * must still read ECMS. `decideVisitChange` passes `false` for the counter.
 */
export const decideSyncChange = (
  ecms: ValueKey,
  old: readonly ValueKey[],
  next: readonly ValueKey[],
  oneValue = true,
): SyncDecision => {
  const named = (keys: readonly ValueKey[]): (string | null)[] =>
    keys.filter((key): key is string | null => key !== undefined);
  const olds = named(old);
  const nexts = named(next);
  if (oneValue && olds.some((key) => nexts.includes(key))) return 'unchanged';
  if (ecms === undefined) return 'keptEcmsEdit';
  if (nexts.includes(ecms)) return 'alreadyThere';
  if (olds.includes(ecms)) return 'apply';
  return 'keptEcmsEdit';
};

/** The visit as ECMS holds it — what the rule reads. */
export type EcmsVisit = Pick<
  FleetMaintenanceVisitDoc,
  | 'vehicleId'
  | 'vehicleCode'
  | 'inDate'
  | 'outDate'
  | 'workshopId'
  | 'workTypeId'
  | 'sparePartIds'
  | 'odometerAtService'
  | 'driverInEmployeeId'
  | 'driverInName'
  | 'driverOutEmployeeId'
  | 'driverOutName'
  | 'notes'
  | 'isDeleted'
>;

const text = (value: string | null | undefined): string | null =>
  value == null || value.trim() === '' ? null : value.trim();

/** A set of catalog ids as one key — sorted and distinct. */
export const partsKey = (ids: readonly string[]): string => [...new Set(ids)].sort().join(',');

const driverKey = (id: unknown, name: string | null | undefined): string | null => {
  if (id != null) return `employee:${String(id)}`;
  const spelled = text(name);
  return spelled === null ? null : `name:${spelled}`;
};

/**
 * What ECMS holds for a field, as a key. `== null` throughout because this reads a `.lean()`
 * document, where a field added after the row was written is absent rather than null.
 */
export const ecmsKeyOf = (visit: EcmsVisit, field: SyncField): ValueKey => {
  switch (field) {
    case 'car':
      return visit.vehicleId == null ? `code:${visit.vehicleCode ?? ''}` : String(visit.vehicleId);
    case 'inDate':
      return day(new Date(visit.inDate));
    case 'outDate':
      return visit.outDate == null ? null : day(new Date(visit.outDate));
    case 'workshop':
      return String(visit.workshopId);
    case 'workType':
      return String(visit.workTypeId);
    case 'spareParts':
      return partsKey((visit.sparePartIds ?? []).map(String));
    case 'counter':
      return String(visit.odometerAtService);
    case 'driverIn':
      return driverKey(visit.driverInEmployeeId, visit.driverInName);
    case 'driverOut':
      return driverKey(visit.driverOutEmployeeId, visit.driverOutName);
    case 'notes':
      return text(visit.notes);
    case 'deleted':
      return visit.isDeleted ? 'deleted' : 'live';
  }
};

export type CatalogKind = 'workshop' | 'workType' | 'sparePart';

/** How the book's words become ECMS's — answered from the catalog and HR, never created here. */
export interface SyncNames {
  /** The catalog row a word is filed under — `undefined` where ECMS has none. */
  catalogId: (kind: CatalogKind, name: string | null) => string | undefined;
  /** HR's answer per driver spelling — `resolveDrivers`'s map. */
  driverIds: ReadonlyMap<string, string>;
}

const driverKeys = (name: string | null, driverIds: ReadonlyMap<string, string>): ValueKey[] => {
  const spelled = driverWord(name);
  if (spelled === null) return [null];
  const id = driverIds.get(spelled);
  return id === undefined ? [`name:${spelled}`] : [`employee:${id}`, `name:${spelled}`];
};

/**
 * What the import writes — or wrote — for a book value, as every key ECMS could hold it under.
 * `counters` are the stand-ins for a counter the book left blank (see the header); a counter the
 * book wrote is its own and only key.
 */
export const bookKeysOf = (
  visit: ParsedVisit,
  field: SyncField,
  names: SyncNames,
  counters: readonly number[],
): ValueKey[] => {
  switch (field) {
    case 'car':
      return [visit.code];
    case 'inDate':
      return [day(visit.inDate)];
    case 'outDate':
      return [dayOrNull(visit.outDate)];
    case 'workshop':
      return [names.catalogId('workshop', visit.workshop)];
    case 'workType':
      return [names.catalogId('workType', visit.workType)];
    case 'spareParts': {
      const ids = visit.parts.map((part) => names.catalogId('sparePart', part));
      return [ids.every((id): id is string => id !== undefined) ? partsKey(ids) : undefined];
    }
    case 'counter':
      return visit.counter !== null ? [String(visit.counter)] : [...new Set(counters)].map(String);
    case 'driverIn':
      return driverKeys(visit.driver, names.driverIds);
    case 'driverOut':
      return driverKeys(visit.driver2, names.driverIds);
    case 'notes':
      return [visit.notes];
    case 'deleted':
      return [plannedDeleted(visit) ? 'deleted' : 'live'];
  }
};

export interface FieldDecision {
  field: SyncField;
  /** `cannotMove` — the car changed; a visit is not moved between cars by an import. */
  decision: SyncDecision | 'cannotMove';
  ecms: ValueKey;
  old: ValueKey[];
  next: ValueKey[];
}

/**
 * Every field of one change, decided against the visit ECMS holds. Pure: the catalog, HR and the
 * counter stand-ins are handed in, so the rule can be tested on the real rows alone.
 */
export const decideVisitChange = (
  change: Pick<VisitChange, 'old' | 'next' | 'fields'>,
  visit: EcmsVisit,
  names: SyncNames,
  standIns: { old: readonly number[]; next: readonly number[] },
): FieldDecision[] =>
  change.fields.map((field) => {
    const ecms = ecmsKeyOf(visit, field);
    if (field === 'car') {
      return {
        field,
        decision: 'cannotMove',
        ecms,
        old: [change.old.code],
        next: [change.next.code],
      };
    }
    const old = bookKeysOf(change.old, field, names, standIns.old);
    const next = bookKeysOf(change.next, field, names, standIns.next);
    const decision = decideSyncChange(ecms, old, next, field !== 'counter');
    return { field, decision, ecms, old, next };
  });

/** The NEW values a write needs that only the catalog and the chain can supply. */
export interface ResolvedNext {
  workshopId?: string;
  workTypeId?: string;
  sparePartIds?: string[];
  /** The stand-in for a counter the NEW export leaves blank. */
  counter?: number;
}

/**
 * The `$set` for the fields being applied — those ONLY, each written exactly as the import writes
 * it from the new row. Pure.
 */
export const updateFor = (
  fields: readonly SyncField[],
  next: ParsedVisit,
  resolved: ResolvedNext,
  driverIds: ReadonlyMap<string, string>,
  at: Date,
): Partial<FleetMaintenanceVisitDoc> => {
  const set: Partial<FleetMaintenanceVisitDoc> = {};
  const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);
  for (const field of fields) {
    switch (field) {
      case 'car':
        break;
      case 'inDate':
        set.inDate = next.inDate;
        break;
      case 'outDate':
        set.outDate = next.outDate;
        break;
      case 'workshop':
        set.workshopId = oid(resolved.workshopId as string);
        break;
      case 'workType':
        set.workTypeId = oid(resolved.workTypeId as string);
        break;
      case 'spareParts':
        set.sparePartIds = (resolved.sparePartIds ?? []).map(oid);
        break;
      case 'counter':
        set.odometerAtService = next.counter ?? resolved.counter ?? 0;
        break;
      case 'driverIn': {
        const ref = driverRef(next.driver, driverIds, isNobodyInWorkshop);
        set.driverInEmployeeId = ref.id === null ? null : oid(ref.id);
        set.driverInName = ref.name;
        break;
      }
      case 'driverOut': {
        const ref = driverRef(next.driver2, driverIds, isNobodyInWorkshop);
        set.driverOutEmployeeId = ref.id === null ? null : oid(ref.id);
        set.driverOutName = ref.name;
        break;
      }
      case 'notes':
        set.notes = next.notes;
        break;
      case 'deleted':
        Object.assign(set, plannedDeleted(next) ? deletedFields(next.deletion, at) : liveFields());
        break;
    }
  }
  return set;
};

/** A field somebody changed on ECMS since the import — kept, with all three values. */
export interface KeptEcmsEdit {
  code: string;
  date: string;
  field: SyncField;
  ecms: string | null;
  old: string | null;
  new: string | null;
}

/** A change that could not be applied, and why. */
export interface UnappliedChange {
  code: string;
  date: string;
  field: SyncField;
  reason: string;
}

export interface MaintenanceSyncOutcome {
  /** New rows written as visits. */
  added: number;
  /** New rows ECMS already had — a person typed the visit, or an earlier attempt wrote it. */
  alreadyThere: number;
  /** Changed fields written, by field — every field the export changes, a zero included. */
  changed: Partial<Record<SyncField, number>>;
  /** Changed fields ECMS already carried the new value of, by field. */
  changesAlreadyThere: Partial<Record<SyncField, number>>;
  /** Fields changed on ECMS since the import — the ECMS value kept. */
  keptEcmsEdits: KeptEcmsEdit[];
  /** «code in-date» — visits the old book has now deleted, soft-deleted here. */
  deletedByBook: string[];
  /** «code in-date» — visits the old book had deleted and has now restored, restored here. */
  restoredByBook: string[];
  /** Changes that could not be applied — not found, a car change, a second open visit. */
  unapplied: UnappliedChange[];
  /** «code in-date» — visits the import parked as a second open visit, changed and still deleted. */
  parkedChanged: string[];
  /** The import's own notes for the new rows, and this step's for the changes, side by side. */
  namesFilled: number;
  counterFromOdometer: number;
  noCounter: string[];
  counterUnknown: string[];
  openConflicts: string[];
  outBeforeIn: string[];
  catalogCreated: string[];
  failures: { code: string; reason: string }[];
}

/**
 * The catalog, as the book's words: LOOKED UP for the rule, and ADDED only for a change that is
 * being written — the import's own `resolveCatalog`, so a word is matched and created exactly as
 * it was for the first book.
 */
const syncCatalog = async (by: string, created: string[]) => {
  const index: Record<CatalogKind, CatalogIndex> = {
    workshop: await resolveCatalog('workshop', [], by, false),
    workType: await resolveCatalog('workType', [], by, false),
    sparePart: await resolveCatalog('sparePart', [], by, false),
  };
  const lookup = (kind: CatalogKind, name: string | null): string | undefined =>
    index[kind].ids.get(catalogWord(name));
  return {
    lookup,
    async ensure(kind: CatalogKind, name: string | null): Promise<string> {
      const found = lookup(kind, name);
      if (found !== undefined) return found;
      const made = await resolveCatalog(kind, name === null ? [] : [name], by, name === null);
      const id = name === null ? made.unspecified : made.ids.get(fold(name));
      if (id == null) throw new Error(`«${name ?? UNSPECIFIED.ar}» could not be added to ${kind}`);
      index[kind].ids.set(catalogWord(name), id);
      created.push(...made.created.map((word) => `${kind}: ${word}`));
      return id;
    },
    async name(id: string): Promise<string> {
      return (await fleetCatalogItemRepository.findById(id))?.name.ar ?? id;
    },
  };
};

/** Midnight UTC after the day — the odometer chain's own bound (`chainBounds`). */
const dayAfter = (date: Date): Date => {
  const end = new Date(date);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
};

/**
 * The counter the import writes for a visit the book gave none: the car's highest reading on or
 * before the day, else its lowest after, else 0 — against the chain as it stands, or, with
 * `asOf`, against the readings the chain held at that instant.
 */
const standInCounter = async (
  vehicleId: string | null,
  inDate: Date,
  asOf?: Date,
): Promise<number> => {
  if (vehicleId === null) return 0;
  if (asOf === undefined) {
    const bounds = await fleetOdometerRepository.chainBounds(vehicleId, inDate);
    return bounds.lower?.reading ?? bounds.upper?.reading ?? 0;
  }
  // On the chain at `asOf`: recorded by then, and not deleted by then. A deletion is dated by
  // `deletedAt` — except that a later go-live step deleting a reading the book deleted stamps the
  // BOOK's day there, which can be older than `asOf` though the reading was live on ECMS at it;
  // its `updatedAt` is the moment ECMS actually deleted it. See the header.
  const then = {
    vehicleId: new Types.ObjectId(vehicleId),
    outReading: { $ne: null },
    createdAt: { $lte: asOf },
    $or: [{ isDeleted: false }, { deletedAt: { $gt: asOf } }, { updatedAt: { $gt: asOf } }],
  };
  const end = dayAfter(inDate);
  const lower = await FleetOdometerLogModel.findOne({ ...then, date: { $lt: end } })
    .sort({ outReading: -1, _id: -1 })
    .lean<{ outReading: number }>()
    .exec();
  if (lower !== null) return lower.outReading;
  const upper = await FleetOdometerLogModel.findOne({ ...then, date: { $gte: end } })
    .sort({ outReading: 1, _id: 1 })
    .lean<{ outReading: number }>()
    .exec();
  return upper?.outReading ?? 0;
};

/**
 * The visit the import wrote from the OLD row — see the header. By the car's registry id, or by
 * the book's code where the import filed it under the code (a car the registry did not have then).
 */
const findWritten = async (
  change: VisitChange,
  catalogId: SyncNames['catalogId'],
  vehicleIdByCode: ReadonlyMap<string, string>,
): Promise<FleetMaintenanceVisitDoc | null> => {
  const workshopId = catalogId('workshop', change.old.workshop);
  const workTypeId = catalogId('workType', change.old.workType);
  if (workshopId === undefined || workTypeId === undefined) return null;
  const key = fleetMaintenanceRepository.rowKey(change.old.inDate, workshopId, workTypeId);
  const byCode: BookRef = { vehicleId: null, vehicleCode: change.old.code };
  const ref = bookRefOf(change.old.code, vehicleIdByCode);
  for (const candidate of ref.vehicleId === null ? [ref] : [byCode, ref]) {
    const group = (await fleetMaintenanceRepository.existingByKey(candidate)).get(key) ?? [];
    // In the order they were WRITTEN — see the header: the database hands them back in its
    // index's order, latest day out first, which is not the planner's.
    if (group.length > 0) return inWrittenOrder(group)[change.slot] ?? null;
  }
  return null;
};

/**
 * Visits in the order they were written: by id, which is minted as the visit is written — the
 * import's one insert per car mints its ids in the planner's order.
 */
export const inWrittenOrder = <T extends { _id: Types.ObjectId }>(visits: readonly T[]): T[] =>
  [...visits].sort((a, b) => a._id.toHexString().localeCompare(b._id.toHexString()));

/**
 * The counters that prove a counter the OLD book left blank untouched — see the header. The
 * stand-ins found again against the chain, and — for a visit the import wrote (`createdBy`, the
 * seeded admin) that nobody has saved since (`__v` 0) — the visit's own counter, which is then
 * exactly what the import wrote.
 */
export const untouchedCounters = (
  visit: Pick<FleetMaintenanceVisitDoc, 'odometerAtService' | 'createdBy'> & { __v?: number },
  standIns: readonly number[],
  importedBy: string,
): number[] => {
  const unsaved =
    (visit.__v ?? 0) === 0 && visit.createdBy != null && String(visit.createdBy) === importedBy;
  return unsaved ? [...standIns, visit.odometerAtService] : [...standIns];
};

/** How a book value is read out on the run — the book's own words. */
const shownBook = (visit: ParsedVisit, field: SyncField): string | null => {
  switch (field) {
    case 'car':
      return visit.code;
    case 'inDate':
      return day(visit.inDate);
    case 'outDate':
      return dayOrNull(visit.outDate);
    case 'workshop':
      return visit.workshop ?? UNSPECIFIED.ar;
    case 'workType':
      return visit.workType ?? UNSPECIFIED.ar;
    case 'spareParts':
      return visit.parts.length === 0 ? null : visit.parts.join('، ');
    case 'counter':
      return visit.counter === null ? null : String(visit.counter);
    case 'driverIn':
      return driverWord(visit.driver);
    case 'driverOut':
      return driverWord(visit.driver2);
    case 'notes':
      return visit.notes;
    case 'deleted':
      return plannedDeleted(visit) ? 'deleted' : 'live';
  }
};

export interface MaintenanceSyncContext {
  /** The seeded admin — the author of every write, as it was of the import's. */
  by: string;
  vehicleIdByCode: ReadonlyMap<string, string>;
  /** HR's answer for every driver spelling on either side of the diff. */
  driverIds: ReadonlyMap<string, string>;
  /** «Now» — the day stamped on a visit the book deleted without saying when. */
  at?: Date;
}

/**
 * Apply a plan: the changes, visit by visit, and then the new rows through the import.
 *
 * One visit failing does not stop the next; every failure is collected with its car and day, and
 * the run is left unfinished. The take-over that follows finds every field this run wrote already
 * there, and every visit it added already written.
 */
export const applyMaintenanceSync = async (
  plan: MaintenanceSyncPlan,
  addedPlan: MaintenancePlan,
  ctx: MaintenanceSyncContext,
): Promise<MaintenanceSyncOutcome> => {
  const at = ctx.at ?? new Date();
  const outcome: MaintenanceSyncOutcome = {
    added: 0,
    alreadyThere: 0,
    changed: {},
    changesAlreadyThere: {},
    keptEcmsEdits: [],
    deletedByBook: [],
    restoredByBook: [],
    unapplied: [],
    parkedChanged: [],
    namesFilled: 0,
    counterFromOdometer: 0,
    noCounter: [],
    counterUnknown: [],
    openConflicts: [],
    outBeforeIn: [],
    catalogCreated: [],
    failures: [],
  };
  // Every field the export changes is on the count, a zero included — «outDate: 7» beside an
  // export that changed 9 says, on its own, that two were kept or already there.
  for (const field of SYNC_FIELDS) {
    if (field !== 'car' && (plan.inExport[field] ?? 0) > 0) outcome.changed[field] = 0;
  }
  const catalog = await syncCatalog(ctx.by, outcome.catalogCreated);
  const names: SyncNames = { catalogId: catalog.lookup, driverIds: ctx.driverIds };
  const actor = { userId: ctx.by, ip: null, userAgent: null };
  const count = (tally: Partial<Record<SyncField, number>>, field: SyncField): void => {
    tally[field] = (tally[field] ?? 0) + 1;
  };

  // (a) THE CHANGES — before the new rows; see the header for why the order matters.
  for (const change of plan.changes) {
    const { code, date, next } = change;
    const unapplied = (field: SyncField, reason: string): void => {
      outcome.unapplied.push({ code, date, field, reason });
    };
    try {
      const visit = await findWritten(change, catalog.lookup, ctx.vehicleIdByCode);
      if (visit === null) {
        for (const field of change.fields) {
          unapplied(
            field,
            'the visit the workshop import wrote from this row is not on ECMS under its car, day in, workshop and work — changed or deleted there since',
          );
        }
        continue;
      }
      const vehicleId = visit.vehicleId == null ? null : String(visit.vehicleId);
      const counterChanges = change.fields.includes('counter');
      // The visit's own counter where the import wrote it and nobody has saved it since; the chain
      // as it stood when THIS visit was written — its own `createdAt` — and as it stands.
      const standIns = {
        old:
          counterChanges && change.old.counter === null
            ? untouchedCounters(
                visit,
                [
                  ...(visit.createdAt == null
                    ? []
                    : [
                        await standInCounter(
                          vehicleId,
                          change.old.inDate,
                          new Date(visit.createdAt),
                        ),
                      ]),
                  await standInCounter(vehicleId, change.old.inDate),
                ],
                ctx.by,
              )
            : [],
        next:
          counterChanges && next.counter === null
            ? [await standInCounter(vehicleId, next.inDate)]
            : [],
      };

      let apply: SyncField[] = [];
      for (const decided of decideVisitChange(change, visit, names, standIns)) {
        switch (decided.decision) {
          case 'unchanged':
            break;
          case 'alreadyThere':
            count(outcome.changesAlreadyThere, decided.field);
            break;
          case 'cannotMove':
            unapplied(
              'car',
              `the new export files it under car ${next.code} — a visit is not moved between cars by an import`,
            );
            break;
          case 'keptEcmsEdit':
            outcome.keptEcmsEdits.push({
              code,
              date,
              field: decided.field,
              ecms: await shownEcms(visit, decided.field, catalog.name),
              old: shownBook(change.old, decided.field),
              new: shownBook(next, decided.field),
            });
            break;
          case 'apply':
            apply.push(decided.field);
            break;
        }
      }

      // The service's rule: the car does not leave on a lower reading than it came in on.
      const counter = next.counter ?? standIns.next[0] ?? 0;
      if (apply.includes('counter') && visit.exitOdometer != null && counter > visit.exitOdometer) {
        apply = apply.filter((field) => field !== 'counter');
        unapplied(
          'counter',
          `${counter} is above the exit reading ${visit.exitOdometer} recorded on ECMS`,
        );
      }

      // ONE OPEN VISIT PER CAR — see the header. Only a reopening or a restoring can break it.
      const deletedAfter = (): boolean =>
        apply.includes('deleted') ? plannedDeleted(next) : visit.isDeleted;
      const outDateAfter = (): Date | null =>
        apply.includes('outDate') ? next.outDate : visit.outDate;
      const wasLiveOpen = !visit.isDeleted && visit.outDate == null;
      if (!deletedAfter() && outDateAfter() == null && !wasLiveOpen && vehicleId !== null) {
        const open = await fleetMaintenanceRepository.findOpen(vehicleId);
        if (open !== null && String(open._id) !== String(visit._id)) {
          if (apply.includes('deleted')) {
            // The import's own rule for a second open visit: it stays deleted, and is named.
            apply = apply.filter((field) => field !== 'deleted');
            outcome.openConflicts.push(`${code} ${date}`);
          } else {
            apply = apply.filter((field) => field !== 'outDate');
            unapplied(
              'outDate',
              'reopening it would put the car in two workshops — ECMS keeps it closed',
            );
          }
        }
      }
      if (apply.length === 0) continue;

      const resolved: ResolvedNext = {};
      if (apply.includes('workshop')) {
        resolved.workshopId = await catalog.ensure('workshop', next.workshop);
      }
      if (apply.includes('workType')) {
        resolved.workTypeId = await catalog.ensure('workType', next.workType);
      }
      if (apply.includes('spareParts')) {
        resolved.sparePartIds = [];
        for (const part of next.parts) {
          resolved.sparePartIds.push(await catalog.ensure('sparePart', part));
        }
      }
      if (apply.includes('counter') && next.counter === null) resolved.counter = counter;

      const set = updateFor(apply, next, resolved, ctx.driverIds, at);
      const written = await FleetMaintenanceVisitModel.updateOne(
        { _id: visit._id, ...(visit.__v === undefined ? {} : { __v: visit.__v }) },
        { $set: { ...set, updatedBy: new Types.ObjectId(ctx.by) }, $inc: { __v: 1 } },
      ).exec();
      if (written.matchedCount === 0) {
        throw new Error(
          'the visit was saved on ECMS while this ran — the next attempt decides it again',
        );
      }

      for (const field of apply) count(outcome.changed, field);
      if (apply.includes('deleted')) {
        (plannedDeleted(next) ? outcome.deletedByBook : outcome.restoredByBook).push(
          `${code} ${date}`,
        );
      }
      if (apply.includes('counter') && next.counter === null && counter === 0) {
        (vehicleId === null ? outcome.counterUnknown : outcome.noCounter).push(`${code} ${date}`);
      }
      // Left before it arrived: kept with both dates and named, as the import does.
      const inDate = apply.includes('inDate') ? next.inDate : new Date(visit.inDate);
      const outDate = outDateAfter();
      if (
        (apply.includes('outDate') || apply.includes('inDate')) &&
        outDate != null &&
        new Date(outDate) < inDate
      ) {
        outcome.outBeforeIn.push(`${code} ${day(inDate)} → ${day(new Date(outDate))}`);
      }
      // Parked by the import — deleted by nobody, live and open in the old book, live in the new
      // one — and still deleted after this write.
      if (
        visit.isDeleted &&
        visit.deletedBy == null &&
        change.old.outDate === null &&
        !plannedDeleted(change.old) &&
        !plannedDeleted(next) &&
        deletedAfter()
      ) {
        outcome.parkedChanged.push(`${code} ${date}`);
      }
      const before = Object.fromEntries(
        Object.keys(set).map((key) => [key, visit[key as keyof FleetMaintenanceVisitDoc]]),
      );
      await auditService.record({
        entityRef: {
          moduleId: 'fleet',
          entityType: 'maintenanceVisit',
          entityId: String(visit._id),
        },
        action: apply.includes('deleted') && plannedDeleted(next) ? 'delete' : 'update',
        changes: diffChanges(before, set as Record<string, unknown>),
        actor,
      });
    } catch (error) {
      outcome.failures.push({ code, reason: `${date}: ${failureReason(error)}` });
    }
  }

  // (b) THE NEW ROWS, by the import itself — with every shared row's visit claimed first.
  const imported: MaintenanceImportOutcome = await applyMaintenanceImport(
    addedPlan,
    ctx.by,
    plan.claimed,
  );
  outcome.added = imported.imported;
  outcome.alreadyThere = imported.alreadyThere;
  outcome.namesFilled = imported.namesFilled;
  outcome.counterFromOdometer = imported.counterFromOdometer;
  outcome.noCounter.push(...imported.noCounter);
  outcome.counterUnknown.push(...imported.counterUnknown);
  outcome.openConflicts.push(...imported.openConflicts);
  outcome.catalogCreated.push(...imported.catalogCreated);
  outcome.failures.push(...imported.failures);
  return outcome;
};

/** ECMS's value read out BY NAME for the run — an id means nothing to whoever reads it. */
const shownEcms = async (
  visit: FleetMaintenanceVisitDoc,
  field: SyncField,
  catalogName: (id: string) => Promise<string>,
): Promise<string | null> => {
  // A name to READ, never a reason to fail the visit: HR not answering leaves the id on the line.
  const driver = async (id: unknown, name: string | null | undefined): Promise<string | null> => {
    if (id == null) return text(name);
    try {
      return (await getDirectoryEmployee(String(id)))?.fullNameAr ?? String(id);
    } catch {
      return String(id);
    }
  };
  switch (field) {
    case 'workshop':
      return catalogName(String(visit.workshopId));
    case 'workType':
      return catalogName(String(visit.workTypeId));
    case 'spareParts': {
      const ids = (visit.sparePartIds ?? []).map(String);
      if (ids.length === 0) return null;
      return (await Promise.all(ids.map(catalogName))).join('، ');
    }
    case 'driverIn':
      return driver(visit.driverInEmployeeId, visit.driverInName);
    case 'driverOut':
      return driver(visit.driverOutEmployeeId, visit.driverOutName);
    default: {
      const key = ecmsKeyOf(visit, field);
      return key === undefined ? null : key;
    }
  }
};
