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
// `deleted`, `added_by`, `added_date`, `out_by`, `deleted_by`, `deleted_date` and `__v` are legacy
// bookkeeping and do not travel: the two «by» fields are the old system's LOGIN names, not
// employees, and a custodian invented from a login would be a name against work they did not do.
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
// measures from, so a visit cannot be written without one. Where the book has it, it is used.
// Where it does not, the odometer book — imported by the step before this one — is asked for the
// car's highest reading on or before the day it went in, and failing that the earliest reading
// after; a visit with neither is skipped and listed, because a number invented here would move a
// real alarm.
//
// WHAT IS NOT REPAIRED. A visit that left before it arrived (15 rows) and a visit whose out-date
// is not a date (2) are skipped and listed: which of the two dates is wrong is not a question an
// import may answer. `exitOdometer` did not exist in the old system and stays empty.
//
// DRIVERS ARE NAMES, as in the odometer book — with more spellings for «nobody»: a dash, dots,
// zeros, and «ونش» (the tow truck) and «جراج» (the garage), none of which is an employee.
import { Types } from 'mongoose';
import { type FleetCatalogKind } from '@ecms/contracts';
import { fleetCatalogItemRepository, fleetCatalogItemService } from '../catalogs';
import { fleetMaintenanceRepository } from '../maintenance/maintenance.repository';
import { type FleetMaintenanceVisitDoc } from '../maintenance/maintenance.model';
import { fleetOdometerRepository } from '../odometer/odometer.repository';
import { day, isPlaceholderDriver } from './odometer-import';
import { failureReason, fold } from './vehicles-import';

/** One legacy row, exactly as the export writes it. Everything is optional; nothing is trusted. */
interface LegacyVisit {
  _id?: { $oid?: string } | string;
  car_code?: string;
  in_date?: string;
  out_date?: string | null;
  destination?: string;
  works?: string;
  spare_parts?: unknown;
  counter?: string | number;
  driver?: string;
  driver2?: string;
  notes?: string;
  deleted?: number;
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
}

export interface ParseVisitsResult {
  visits: ParsedVisit[];
  skippedDeleted: number;
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
 * Read the export. A row that cannot be read is REPORTED by legacy id and reason, not refused:
 * two out-dates that are not dates are a note for whoever keeps the book, not a reason to leave
 * 1,800 visits in it.
 */
export const parseVisits = (raw: unknown): ParseVisitsResult => {
  const result: ParseVisitsResult = { visits: [], skippedDeleted: 0, rejected: [] };
  if (!Array.isArray(raw)) {
    result.rejected.push({ id: 'file', reason: 'the export is not a JSON array' });
    return result;
  }
  raw.forEach((entry: LegacyVisit, index) => {
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
    const inDate = visitDate(entry.in_date);
    if (inDate === null || inDate === 'invalid') {
      result.rejected.push({ id, reason: `${code}: the in-date cannot be read` });
      return;
    }
    const outDate = visitDate(entry.out_date);
    if (outDate === 'invalid') {
      result.rejected.push({ id, reason: `${code} ${day(inDate)}: the out-date «${String(entry.out_date)}» cannot be read` });
      return;
    }
    const reading = counter(entry.counter);
    if (reading === 'invalid') {
      result.rejected.push({ id, reason: `${code} ${day(inDate)}: the counter is not a number` });
      return;
    }
    const parts = Array.isArray(entry.spare_parts)
      ? entry.spare_parts.map(text).filter((part): part is string => part !== null)
      : [];
    result.visits.push({
      id,
      code,
      inDate,
      outDate,
      workshop: text(entry.destination),
      workType: text(entry.works),
      parts,
      counter: reading,
      driver: text(entry.driver),
      driver2: text(entry.driver2),
      notes: text(entry.notes),
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
  driver1Id: string | null;
  driver2Id: string | null;
}

export interface VehicleVisits {
  code: string;
  vehicleId: string;
  visits: PlannedVisit[];
}

export interface MaintenancePlan {
  vehicles: VehicleVisits[];
  /** Codes the registry does not have, with how many rows the book holds for each. */
  unknownCars: string[];
  /** Visits that left before they arrived — «code in-date → out-date» — skipped. */
  outBeforeIn: string[];
  /** The book's own words the catalog will be asked for, distinct, in order of first use. */
  names: { workshop: string[]; workType: string[]; sparePart: string[] };
  /** Visits with NO workshop, and with NO work type — the ones filed under «غير محدد». */
  blanks: { workshop: number; workType: number };
}

/**
 * Turn the ledger into visits per vehicle. Pure: the registry and the drivers are handed in as
 * maps, so the rule can be tested on rows alone. The catalog is resolved at write time, because
 * resolving it may ADD to it.
 */
export const planMaintenanceImport = (
  visits: readonly ParsedVisit[],
  vehicleIdByCode: ReadonlyMap<string, string>,
  driverIdByName: ReadonlyMap<string, string>,
): MaintenancePlan => {
  const plan: MaintenancePlan = {
    vehicles: [],
    unknownCars: [],
    outBeforeIn: [],
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
  const driver = (name: string | null): string | null =>
    name === null ? null : (driverIdByName.get(name) ?? null);

  for (const visit of visits) {
    if (!vehicleIdByCode.has(visit.code)) {
      unknown.set(visit.code, (unknown.get(visit.code) ?? 0) + 1);
      continue;
    }
    if (visit.outDate !== null && visit.outDate < visit.inDate) {
      plan.outBeforeIn.push(`${visit.code} ${day(visit.inDate)} → ${day(visit.outDate)}`);
      continue;
    }
    remember('workshop', visit.workshop);
    remember('workType', visit.workType);
    if (visit.workshop === null) plan.blanks.workshop += 1;
    if (visit.workType === null) plan.blanks.workType += 1;
    for (const part of visit.parts) remember('sparePart', part);
    const list = byCode.get(visit.code) ?? [];
    list.push({ ...visit, driver1Id: driver(visit.driver), driver2Id: driver(visit.driver2) });
    byCode.set(visit.code, list);
  }
  plan.unknownCars = [...unknown].sort().map(([code, count]) => `${code} (${count})`);
  for (const [code, list] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    plan.vehicles.push({
      code,
      vehicleId: vehicleIdByCode.get(code) as string,
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
  /** Visits whose counter came from the odometer book rather than this one. */
  counterFromOdometer: number;
  /** Visits with no counter anywhere — «code in-date» — skipped. */
  noCounter: string[];
  /** Visits that are still open in the book, for a car that is already in a workshop today. */
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
 * written again.
 */
export const applyMaintenanceImport = async (
  plan: MaintenancePlan,
  by: string,
): Promise<MaintenanceImportOutcome> => {
  const outcome: MaintenanceImportOutcome = {
    imported: 0,
    alreadyThere: 0,
    counterFromOdometer: 0,
    noCounter: [],
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

  for (const vehicle of plan.vehicles) {
    try {
      const existing = await fleetMaintenanceRepository.existingKeys(vehicle.vehicleId);
      const open = await fleetMaintenanceRepository.findOpen(vehicle.vehicleId);
      const docs: Partial<FleetMaintenanceVisitDoc>[] = [];
      for (const visit of vehicle.visits) {
        const workshopId = id('workshop', visit.workshop);
        const workTypeId = id('workType', visit.workType);
        if (existing.has(fleetMaintenanceRepository.rowKey(visit.inDate, workshopId, workTypeId))) {
          outcome.alreadyThere += 1;
          continue;
        }
        let odometerAtService = visit.counter;
        if (odometerAtService === null) {
          const bounds = await fleetOdometerRepository.chainBounds(vehicle.vehicleId, visit.inDate);
          odometerAtService = bounds.lower?.reading ?? bounds.upper?.reading ?? null;
          if (odometerAtService === null) {
            outcome.noCounter.push(`${vehicle.code} ${day(visit.inDate)}`);
            continue;
          }
          outcome.counterFromOdometer += 1;
        }
        if (visit.outDate === null && open !== null) {
          outcome.openConflicts.push(`${vehicle.code} ${day(visit.inDate)}`);
          continue;
        }
        docs.push({
          vehicleId: new Types.ObjectId(vehicle.vehicleId),
          inDate: visit.inDate,
          outDate: visit.outDate,
          workshopId: new Types.ObjectId(workshopId),
          workTypeId: new Types.ObjectId(workTypeId),
          spareParts: [],
          sparePartIds: visit.parts.map((part) => new Types.ObjectId(catalog.sparePart.ids.get(fold(part)) as string)),
          odometerAtService,
          exitOdometer: null,
          driverInEmployeeId: visit.driver1Id === null ? null : new Types.ObjectId(visit.driver1Id),
          driverOutEmployeeId: visit.driver2Id === null ? null : new Types.ObjectId(visit.driver2Id),
          takenInByEmployeeId: null,
          takenOutByEmployeeId: null,
          notes: visit.notes,
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
