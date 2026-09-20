// The go-live WORKSHOP import: the legacy `car_maintenance` collection, turned into workshop
// visits. Importable and side-effect free until `applyMaintenanceImport`; `maintenance.ts` runs
// it at boot.
//
// WHAT THE LEGACY SHAPE IS, and what each field becomes:
//
//   car_code    → the vehicle, by code       driver      → driverInEmployeeId, by NAME through
//   in_date     → inDate                                    the directory (HR's rule, HR's answer)
//   out_date    → outDate (null = still in)  driver2     → driverOutEmployeeId, the same way
//   destination → the `workshop` catalog     spare_parts → the `sparePart` catalog, by name
//   works       → the `workType` catalog     counter     → odometerAtService
//   notes       → notes
//
// `added_by`, `added_date`, `out_by`, `deleted_by` and `__v` are legacy bookkeeping and do not
// travel: the two «by» fields are the old system's LOGIN names, not employees, and a custodian
// invented from a login would be a name against work they did not do. `deleted` DOES travel — a
// visit the old system had deleted arrives already deleted, carrying the day of it, and EVERY
// row of the book lands: «المهم تضيف كل الداتا ومتسبش داتا فاضيه». `legacy-row.ts` says what
// that state is and why the model's one-open-visit invariant is safe around it.
//
// THE CATALOGS ARE THE BOOK'S OWN WORDS. Every workshop, work type and spare part the book names
// is matched to the catalog by folded spelling — «صيانه» is «صيانة» — and the seeded vocabulary
// (`vocabulary.ts`) already holds all but two of them. The two it does not («تويوتا 2»,
// «تكنو بوش») are real places the company sent cars to, so they are ADDED to the catalog as
// written rather than dropped or guessed at. A visit with NO workshop or NO work type — 137 and 5
// of them — is filed under «غير محدد», a catalog row this step adds for exactly that purpose,
// because the model requires both and the visit happened.
//
// THE COUNTER IS REQUIRED AND THE BOOK OFTEN LEFT IT OUT. `odometerAtService` is what the alarm
// measures from. Where the book has it, it is used. Where it does not, the odometer book —
// imported by the step before this one — is asked for the car's highest reading on or before the
// day it went in, and failing that the earliest reading after. A visit with neither is written
// with a counter of 0 and LISTED, exactly as a visit on a car the registry never had is: the
// visit happened and the book says so, and a zero is visibly not a reading, where leaving the
// visit out would have been invisible.
//
// WHAT IS NOT REPAIRED — but is still written. A visit that left before it arrived (14 rows) is
// kept with both of the book's dates and listed: which of the two is wrong is not a question an
// import may answer, and the person who can answer it needs to see the visit to do so. A visit
// whose out-date is not a date at all (2 rows) keeps the book's text in its notes and is written
// deleted, so a car is never shown as being in two workshops over a word nobody can read.
// `exitOdometer` did not exist in the old system and stays empty.
//
// DRIVERS ARE NAMES, as in the odometer book, and kept as text where HR has no employee for the
// spelling — with more spellings for «nobody»: a dash, dots, zeros, and «ونش» (the tow truck)
// and «جراج» (the garage), none of which is an employee. CARS THE REGISTRY NEVER HAD keep their
// visits too, by the book's code (`book-ref.ts`); a visit on such a car has no chain to take a
// counter from, so where the book has none the counter is written as 0 and the visit listed —
// nothing measures from a car that does not exist. A name HR has several employees for is never
// guessed between: «اكتب الاسم بس ومتكتبش كود موظف».
import { Types } from 'mongoose';
import { type FleetCatalogKind } from '@ecms/contracts';
import { fleetCatalogItemRepository, fleetCatalogItemService } from '../catalogs';
import { fleetMaintenanceRepository } from '../maintenance/maintenance.repository';
import { type FleetMaintenanceVisitDoc } from '../maintenance/maintenance.model';
import { fleetOdometerRepository } from '../odometer/odometer.repository';
import { day, driverRef, isPlaceholderDriver, type DriverRef } from './odometer-import';
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
import { NO_CODE } from './odometer-import';
import { failureReason, fold } from './vehicles-import';

/** One legacy row, exactly as the export writes it. Everything is optional; nothing is trusted. */
interface LegacyVisit extends LegacyBookkeeping {
  _id?: { $oid?: string } | string;
  car_code?: string;
  in_date?: string;
  out_date?: string | null;
  added_date?: { $date?: string } | string;
  destination?: string;
  works?: string;
  spare_parts?: unknown;
  counter?: string | number;
  driver?: string;
  driver2?: string;
  notes?: string;
}

export interface ParsedVisit {
  id: string;
  code: string;
  inDate: Date;
  /** `null` = the car is still in — the model's own open state. */
  outDate: Date | null;
  /** The book's words, or nothing. Matched to the catalog by `applyMaintenanceImport`. */
  workshop: string | null;
  workType: string | null;
  parts: string[];
  /** The counter the book recorded, or nothing. */
  counter: number | null;
  driver: string | null;
  driver2: string | null;
  notes: string | null;
  /** The old system's own deletion, carried through untouched. */
  deletion: LegacyDeletion;
  /** The book says something the model cannot hold — the visit is kept, and written deleted. */
  unreadable: boolean;
}

export interface ParseVisitsResult {
  visits: ParsedVisit[];
  /** Visits the old system had deleted — kept, deleted, and counted. */
  keptDeleted: number;
  /** Visits kept but unreadable — «id · what could not be read». */
  unreadable: { id: string; reason: string }[];
  /** Only a file that is not a list of rows at all. */
  rejected: { id: string; reason: string }[];
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** `2025-01-06` and nothing else — the one shape the old screen wrote. */
const visitDate = (value: unknown): Date | null | 'invalid' => {
  const raw = text(value);
  if (raw === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'invalid';
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? 'invalid' : date;
};

const counter = (value: unknown): number | null | 'invalid' => {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : 'invalid';
  const raw = text(value);
  if (raw === null) return null;
  return /^\d+$/.test(raw) ? Number(raw) : 'invalid';
};

const legacyId = (value: LegacyVisit['_id'], index: number): string => {
  if (typeof value === 'string') return value;
  if (value !== undefined && typeof value.$oid === 'string') return value.$oid;
  return `row ${index}`;
};

/**
 * Read the export. NOTHING IS DROPPED: a visit the book wrote badly is kept, marked, and carries
 * the book's own words for whatever could not be read, so the visit still says what it said.
 */
export const parseVisits = (raw: unknown): ParseVisitsResult => {
  const result: ParseVisitsResult = { visits: [], keptDeleted: 0, unreadable: [], rejected: [] };
  if (!Array.isArray(raw)) {
    result.rejected.push({ id: 'file', reason: 'the export is not a JSON array' });
    return result;
  }
  raw.forEach((entry: LegacyVisit, index) => {
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

    // The day it went in. Where that is not a date, the day the row was ADDED is the nearest
    // thing the export has to it, and the book's own text goes on the visit.
    const written = visitDate(entry.in_date);
    let inDate = written === 'invalid' ? null : written;
    if (inDate === null) {
      unreadable = true;
      result.unreadable.push({ id, reason: `${code ?? NO_CODE}: the in-date cannot be read` });
      notes = noteWith(notes, asWritten('تاريخ الدخول', entry.in_date));
      inDate = legacyDateOf(entry.added_date) ?? deletion.deletedAt ?? new Date(0);
    }

    const parsedOut = visitDate(entry.out_date);
    let outDate = parsedOut === 'invalid' ? null : parsedOut;
    if (parsedOut === 'invalid') {
      unreadable = true;
      result.unreadable.push({ id, reason: `${code ?? NO_CODE} ${day(inDate)}: the out-date cannot be read` });
      notes = noteWith(notes, asWritten('تاريخ الخروج', entry.out_date));
      outDate = null;
    }

    const reading = counter(entry.counter);
    if (reading === 'invalid') {
      result.unreadable.push({ id, reason: `${code ?? NO_CODE} ${day(inDate)}: the counter is not a number` });
      notes = noteWith(notes, asWritten('العداد', entry.counter));
    }

    const parts = Array.isArray(entry.spare_parts)
      ? entry.spare_parts.map(text).filter((part): part is string => part !== null)
      : [];
    result.visits.push({
      id,
      code: code ?? NO_CODE,
      inDate,
      outDate,
      workshop: text(entry.destination),
      workType: text(entry.works),
      parts,
      counter: reading === 'invalid' ? null : reading,
      driver: text(entry.driver),
      driver2: text(entry.driver2),
      notes,
      deletion,
      unreadable,
    });
  });
  return result;
};

const ARABIC_LETTER = /[؀-ۿ]/;
const NOT_A_DRIVER = new Set(['ونش', 'جراج'].map(fold));

/**
 * The workshop book's spellings for «nobody»: the odometer book's two, anything with no Arabic
 * letter in it (a dash, dots, zeros), the tow truck and the garage.
 */
export const isNobodyInWorkshop = (name: string): boolean =>
  isPlaceholderDriver(name) || !ARABIC_LETTER.test(name) || NOT_A_DRIVER.has(fold(name));

/** The catalog row a visit with no workshop, or no work type, is filed under. */
export const UNSPECIFIED = { ar: 'غير محدد', en: 'Unspecified' };

export interface PlannedVisit extends ParsedVisit {
  driverIn: DriverRef;
  driverOut: DriverRef;
  /** Written deleted: the book had deleted it, or the model could not hold it alive. */
  deleted: boolean;
}

export interface VehicleVisits {
  code: string;
  /** The registry's car, or the book's code alone for a car the registry never had. */
  ref: BookRef;
  visits: PlannedVisit[];
}

export interface MaintenancePlan {
  vehicles: VehicleVisits[];
  /** Codes the registry does not have — their visits are KEPT by code — with how many rows each. */
  unknownCars: string[];
  /** Visits that left before they arrived — «code in-date → out-date» — kept as the book wrote them. */
  outBeforeIn: string[];
  /** Visits written deleted: the book's own deletions, and the ones it could not say readably. */
  deleted: number;
  /** The book's own words the catalog will be asked for, distinct, in order of first use. */
  names: { workshop: string[]; workType: string[]; sparePart: string[] };
  /** Visits with NO workshop, and with NO work type — the ones filed under «غير محدد». */
  blanks: { workshop: number; workType: number };
}

/**
 * Turn the ledger into visits per car. Pure: the registry and the drivers are handed in as
 * maps, so the rule can be tested on rows alone. The catalog is resolved at write time, because
 * resolving it may ADD to it.
 */
export const planMaintenanceImport = (
  visits: readonly ParsedVisit[],
  vehicleIdByCode: ReadonlyMap<string, string>,
  driverIdByName: ReadonlyMap<string, string>,
  isNobody: (name: string) => boolean = isNobodyInWorkshop,
): MaintenancePlan => {
  const plan: MaintenancePlan = {
    vehicles: [],
    unknownCars: [],
    outBeforeIn: [],
    deleted: 0,
    names: { workshop: [], workType: [], sparePart: [] },
    blanks: { workshop: 0, workType: 0 },
  };
  const seen = { workshop: new Set<string>(), workType: new Set<string>(), sparePart: new Set<string>() };
  const remember = (kind: keyof typeof seen, name: string | null): void => {
    if (name === null || seen[kind].has(name)) return;
    seen[kind].add(name);
    plan.names[kind].push(name);
  };
  const byCode = new Map<string, PlannedVisit[]>();
  const unknown = new Map<string, number>();

  for (const visit of visits) {
    if (!vehicleIdByCode.has(visit.code)) unknown.set(visit.code, (unknown.get(visit.code) ?? 0) + 1);
    // A visit that left before it arrived is kept with BOTH of the book's dates: one of the two
    // is a typo, and the only person who can say which needs to see the visit on the screen.
    if (visit.outDate !== null && visit.outDate < visit.inDate) {
      plan.outBeforeIn.push(`${visit.code} ${day(visit.inDate)} → ${day(visit.outDate)}`);
    }
    const deleted = visit.deletion.isDeleted || visit.unreadable;
    if (deleted) plan.deleted += 1;
    remember('workshop', visit.workshop);
    remember('workType', visit.workType);
    if (visit.workshop === null) plan.blanks.workshop += 1;
    if (visit.workType === null) plan.blanks.workType += 1;
    for (const part of visit.parts) remember('sparePart', part);
    const list = byCode.get(visit.code) ?? [];
    list.push({
      ...visit,
      driverIn: driverRef(visit.driver, driverIdByName, isNobody),
      driverOut: driverRef(visit.driver2, driverIdByName, isNobody),
      deleted,
    });
    byCode.set(visit.code, list);
  }
  plan.unknownCars = [...unknown].sort().map(([code, count]) => `${code} (${count})`);
  for (const [code, list] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    plan.vehicles.push({
      code,
      ref: bookRefOf(code, vehicleIdByCode),
      visits: [...list].sort((a, b) => a.inDate.getTime() - b.inDate.getTime() || a.id.localeCompare(b.id)),
    });
  }
  return plan;
};

export interface CatalogIndex {
  /** Folded spelling → catalog id, for every name the book uses. */
  ids: Map<string, string>;
  /** The id of «غير محدد» for this kind — only when a visit needs it. */
  unspecified: string | null;
  /** Names this run added to the catalog, as written in the book. */
  created: string[];
}

/**
 * The catalog, as the book's words. Matched by folded spelling against every live row of the
 * kind, archived ones included — a visit made under a retired name keeps its meaning. A name the
 * catalog does not have is ADDED as written, authored by the run; «غير محدد» is added once, and
 * only for a kind some visit actually left blank.
 */
export const resolveCatalog = async (
  kind: FleetCatalogKind,
  names: readonly string[],
  by: string,
  withUnspecified: boolean,
): Promise<CatalogIndex> => {
  const index: CatalogIndex = { ids: new Map(), unspecified: null, created: [] };
  for (const item of await fleetCatalogItemRepository.listKind(kind)) {
    if (!index.ids.has(fold(item.name.ar))) index.ids.set(fold(item.name.ar), String(item._id));
  }
  const add = async (name: { ar: string; en: string }): Promise<string> => {
    const item = await fleetCatalogItemService.ensure({ kind, name, countsForAlarm: false }, by);
    index.ids.set(fold(name.ar), String(item._id));
    index.created.push(name.ar);
    return String(item._id);
  };
  for (const name of names) {
    if (!index.ids.has(fold(name))) await add({ ar: name, en: name });
  }
  if (withUnspecified) {
    index.unspecified = index.ids.get(fold(UNSPECIFIED.ar)) ?? (await add(UNSPECIFIED));
  }
  return index;
};

export interface MaintenanceImportOutcome {
  imported: number;
  /** Visits a take-over found already written — the same car, day in, workshop and work. */
  alreadyThere: number;
  /** Visits already written whose driver was empty and now carries the book's name. */
  namesFilled: number;
  /** Visits whose counter came from the odometer book rather than this one. */
  counterFromOdometer: number;
  /** Visits with no counter anywhere on a car the registry has — «code in-date» — written as 0. */
  noCounter: string[];
  /** Visits on a car the registry never had, with no counter in the book — written as 0 and listed. */
  counterUnknown: string[];
  /** Visits still open in the book on a car already in a workshop — written DELETED, not dropped. */
  openConflicts: string[];
  /** Catalog rows this run added, by kind. */
  catalogCreated: string[];
  failures: { code: string; reason: string }[];
}

/**
 * Write every car's visits. One car failing does not stop the next; the run reports them all and
 * is left unfinished, and the take-over that follows skips what did land.
 *
 * IDEMPOTENT PER VISIT: a visit is «the same» as one already written when it is the same car,
 * the same day in, the same workshop and the same work — and such a visit is counted and not
 * written again, but a driver's NAME is filled into it where an earlier run left the driver
 * empty, which is the one repair a later run makes.
 */
export const applyMaintenanceImport = async (
  plan: MaintenancePlan,
  by: string,
): Promise<MaintenanceImportOutcome> => {
  const outcome: MaintenanceImportOutcome = {
    imported: 0,
    alreadyThere: 0,
    namesFilled: 0,
    counterFromOdometer: 0,
    noCounter: [],
    counterUnknown: [],
    openConflicts: [],
    catalogCreated: [],
    failures: [],
  };
  const catalog = {
    workshop: await resolveCatalog('workshop', plan.names.workshop, by, plan.blanks.workshop > 0),
    workType: await resolveCatalog('workType', plan.names.workType, by, plan.blanks.workType > 0),
    sparePart: await resolveCatalog('sparePart', plan.names.sparePart, by, false),
  };
  for (const kind of ['workshop', 'workType', 'sparePart'] as const) {
    outcome.catalogCreated.push(...catalog[kind].created.map((name) => `${kind}: ${name}`));
  }
  const id = (kind: 'workshop' | 'workType', name: string | null): string =>
    name === null
      ? (catalog[kind].unspecified as string)
      : (catalog[kind].ids.get(fold(name)) as string);

  const at = new Date();
  for (const vehicle of plan.vehicles) {
    try {
      const existing = await fleetMaintenanceRepository.existingByKey(vehicle.ref);
      const vehicleId = vehicle.ref.vehicleId;
      const open = vehicleId === null ? null : await fleetMaintenanceRepository.findOpen(vehicleId);
      // Whether THIS run has already written the car's one open visit — the book left a handful
      // of cars with two, and the index would refuse the second.
      let openWritten = false;
      const docs: Partial<FleetMaintenanceVisitDoc>[] = [];
      for (const visit of vehicle.visits) {
        const workshopId = id('workshop', visit.workshop);
        const workTypeId = id('workType', visit.workType);
        const written = existing
          .get(fleetMaintenanceRepository.rowKey(visit.inDate, workshopId, workTypeId))
          ?.shift();
        if (written !== undefined) {
          outcome.alreadyThere += 1;
          const names: { driverInName?: string; driverOutName?: string } = {};
          if (visit.driverIn.name !== null && written.driverInEmployeeId == null && !written.driverInName) {
            names.driverInName = visit.driverIn.name;
          }
          if (visit.driverOut.name !== null && written.driverOutEmployeeId == null && !written.driverOutName) {
            names.driverOutName = visit.driverOut.name;
          }
          if (Object.keys(names).length > 0) {
            await fleetMaintenanceRepository.setDriverNames(written._id, names);
            outcome.namesFilled += 1;
          }
          continue;
        }
        let odometerAtService = visit.counter;
        if (odometerAtService === null) {
          const bounds =
            vehicleId === null ? null : await fleetOdometerRepository.chainBounds(vehicleId, visit.inDate);
          odometerAtService = bounds === null ? null : (bounds.lower?.reading ?? bounds.upper?.reading ?? null);
          if (odometerAtService === null) {
            // Nothing to measure — no car, or a car with no reading anywhere near the day. The
            // visit is kept, the counter is written 0, and the run names it: a zero is visibly
            // not a reading, where leaving the visit out would have been invisible.
            odometerAtService = 0;
            (vehicleId === null ? outcome.counterUnknown : outcome.noCounter).push(
              `${vehicle.code} ${day(visit.inDate)}`,
            );
          } else {
            outcome.counterFromOdometer += 1;
          }
        }
        // ONE OPEN VISIT PER CAR is the database's own statement (`ux_open_visit`). A second one
        // — the car already had an open visit, or the book itself left two open — is written
        // DELETED rather than dropped: «بس ميحصلش تعارض».
        let deleted = visit.deleted;
        if (visit.outDate === null && !deleted) {
          if (open !== null || openWritten) {
            outcome.openConflicts.push(`${vehicle.code} ${day(visit.inDate)}`);
            deleted = true;
          } else {
            openWritten = true;
          }
        }
        docs.push({
          ...bookRefFields(vehicle.ref),
          inDate: visit.inDate,
          outDate: visit.outDate,
          workshopId: new Types.ObjectId(workshopId),
          workTypeId: new Types.ObjectId(workTypeId),
          spareParts: [],
          sparePartIds: visit.parts.map((part) => new Types.ObjectId(catalog.sparePart.ids.get(fold(part)) as string)),
          odometerAtService,
          exitOdometer: null,
          driverInEmployeeId: visit.driverIn.id === null ? null : new Types.ObjectId(visit.driverIn.id),
          driverOutEmployeeId: visit.driverOut.id === null ? null : new Types.ObjectId(visit.driverOut.id),
          driverInName: visit.driverIn.name,
          driverOutName: visit.driverOut.name,
          takenInByEmployeeId: null,
          takenOutByEmployeeId: null,
          notes: visit.notes,
          ...(deleted ? deletedFields(visit.deletion, at) : liveFields()),
        });
      }
      if (docs.length > 0) await fleetMaintenanceRepository.createMany(docs, { by });
      outcome.imported += docs.length;
    } catch (error) {
      outcome.failures.push({ code: vehicle.code, reason: failureReason(error) });
    }
  }
  return outcome;
};
