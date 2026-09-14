// The go-live vehicle import: the legacy `cars` collection and its licence scans, turned into
// Fleet registry rows. Importable and side-effect free; `fleet-vehicles-import.cli.ts` runs it.
//
// WHAT THE LEGACY SHAPE IS, and what each field becomes:
//
//   car_code → code            car_type   → the vehicle TYPE registry (not a catalog)
//   plate_num → plateNumber    licens     → `licenseClass` catalog  («فئة الترخيص»)
//   chassis_num → chassisNumber  department → `operation` catalog   («التشغيل»)
//   motor_num → motorNumber    insurance_company → `insuranceCompany` catalog
//   joining_date → joinedAt    branch     → the ORGANISATION's branch registry
//   expiry_date → licenseExpiresAt   issi / sn_motorola → radio.{issi,motorolaSn}
//   license_photo → the licence scan, uploaded from the photo folder
//
// `deleted`, `status`, `driver` and `__v` are legacy bookkeeping and do not travel.
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { MAX_PAGE_SIZE, type CreateFleetVehicle, type FleetCatalogKind } from '@ecms/contracts';
import { scopeSelector, type AuthContext } from './shared/types';
import { fleetCatalogItemRepository, fleetCatalogItemService } from './modules/fleet/catalogs';
import { fleetVehicleTypeRepository } from './modules/fleet/vehicle-types/vehicle-type.repository';
import { fleetVehicleTypeService } from './modules/fleet/vehicle-types/vehicle-type.service';
import { fleetVehicleRepository } from './modules/fleet/vehicles/vehicle.repository';
import { fleetVehicleService } from './modules/fleet/vehicles/vehicle.service';
import { branchRepository } from './platform/organization/branches/branch.repository';

/** One legacy row, exactly as the export writes it. Everything is optional; nothing is trusted. */
interface LegacyCar {
  car_code?: string;
  car_type?: string;
  plate_num?: string;
  chassis_num?: string;
  motor_num?: string;
  joining_date?: { $date?: string } | string;
  expiry_date?: { $date?: string } | string;
  licens?: string;
  branch?: string;
  department?: string;
  insurance_company?: string;
  issi?: string;
  sn_motorola?: string;
  license_photo?: string;
  deleted?: number;
}

/** A row the import will act on, with every string already trimmed. */
export interface ParsedCar {
  code: string;
  type: string;
  plateNumber: string;
  chassisNumber: string;
  motorNumber: string;
  joinedAt: Date;
  licenseExpiresAt: Date;
  licenseClass: string | null;
  branch: string;
  operation: string | null;
  insurer: string | null;
  issi: string | null;
  motorolaSn: string | null;
  /** The photo file's base name, as it appears in the folder. `null` = no scan on file. */
  photo: string | null;
}

export interface ParseResult {
  cars: ParsedCar[];
  /** Rows the export marks deleted — test data, and they carry duplicate codes. */
  skippedDeleted: number;
  /** Rows that could not be read at all, with why. Nothing is imported while any of these stand. */
  rejected: { code: string; reason: string }[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const orNull = (value: unknown): string | null => {
  const trimmed = text(value);
  return trimmed === '' ? null : trimmed;
};
const date = (value: LegacyCar['joining_date']): Date | null => {
  const raw = typeof value === 'string' ? value : (value?.$date ?? '');
  if (raw === '') return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * EVERY STRING IS TRIMMED, and that is load-bearing rather than tidy.
 *
 * The catalogs' duplicate guard matches `name.ar` exactly, so «برقاش ت » and «برقاش ت» — eleven
 * rows arrived with the trailing space — would become two licence classes that look identical in
 * the dropdown and split every filter that uses one. The same holds for the vehicle type registry
 * and for the branch lookup, where a padded name simply finds nothing.
 */
export const parseCars = (raw: unknown): ParseResult => {
  if (!Array.isArray(raw)) throw new Error('the cars file is not a JSON array');
  const cars: ParsedCar[] = [];
  const rejected: { code: string; reason: string }[] = [];
  let skippedDeleted = 0;

  for (const row of raw as LegacyCar[]) {
    // THE FOUR DELETED ROWS ARE THE FIRST THING DROPPED. They all carry code «3333» with plates
    // like «255555555555555» — somebody's tests — and the registry's unique index on `code` would
    // reject three of the four anyway, mid-run, after real rows had already been written.
    if (row.deleted === 1) {
      skippedDeleted += 1;
      continue;
    }
    const code = text(row.car_code);
    const joinedAt = date(row.joining_date);
    const licenseExpiresAt = date(row.expiry_date);
    const missing: string[] = [];
    if (code === '') missing.push('car_code');
    if (text(row.car_type) === '') missing.push('car_type');
    if (text(row.plate_num) === '') missing.push('plate_num');
    if (text(row.chassis_num) === '') missing.push('chassis_num');
    if (text(row.motor_num) === '') missing.push('motor_num');
    if (text(row.branch) === '') missing.push('branch');
    if (joinedAt === null) missing.push('joining_date');
    if (licenseExpiresAt === null) missing.push('expiry_date');
    if (missing.length > 0 || joinedAt === null || licenseExpiresAt === null) {
      rejected.push({ code: code === '' ? '(no code)' : code, reason: missing.join(', ') });
      continue;
    }
    cars.push({
      code,
      type: text(row.car_type),
      plateNumber: text(row.plate_num),
      chassisNumber: text(row.chassis_num),
      motorNumber: text(row.motor_num),
      joinedAt,
      licenseExpiresAt,
      licenseClass: orNull(row.licens),
      branch: text(row.branch),
      operation: orNull(row.department),
      insurer: orNull(row.insurance_company),
      issi: orNull(row.issi),
      motorolaSn: orNull(row.sn_motorola),
      // The legacy path is «/uploads/cars_license_photos/150.jpg»; only the base name matters,
      // because the folder it points into is the one handed to `--photos`.
      photo: orNull(row.license_photo) === null ? null : basename(text(row.license_photo)),
    });
  }
  // A DUPLICATE CODE AMONG THE LIVE ROWS would be caught by the registry's unique index halfway
  // through, leaving a half-written import. Finding it here means nothing is written at all.
  const seen = new Map<string, number>();
  for (const car of cars) seen.set(car.code, (seen.get(car.code) ?? 0) + 1);
  for (const [code, n] of seen) {
    if (n > 1) rejected.push({ code, reason: `appears ${n} times among the live rows` });
  }
  return { cars, skippedDeleted, rejected };
};

export interface ImportPlan {
  cars: ParsedCar[];
  /** Vocabulary that is not in the system yet, by what it would go into. */
  newTypes: string[];
  newCatalog: { kind: FleetCatalogKind; name: string }[];
  /**
   * A name about to be created that is ONE ORTHOGRAPHIC HAIR from one already there.
   *
   * «نقل اموال» in the export against «نقل أموال» in the catalog: same words, one hamza apart,
   * and the catalog's exact-match guard sees two different values. Nothing is merged here — a
   * script deciding that two Arabic spellings are «the same word» is exactly the guess that turns
   * an import into a data-quality incident — but it is reported, because the alternative is a
   * silently split vocabulary that nobody notices until a filter comes back half empty.
   */
  nearMatches: { kind: FleetCatalogKind; incoming: string; existing: string }[];
  /** Branches named by the data that the organisation does not have. Blocks the run. */
  missingBranches: string[];
  toCreate: string[];
  toUpdate: string[];
  /** Cars whose scan is named in the data but absent from the photo folder. */
  missingPhotos: string[];
  withPhoto: string[];
}

const uniq = (values: readonly (string | null)[]): string[] => [
  ...new Set(values.filter((v): v is string => v !== null)),
];

/**
 * A comparison key, used ONLY to spot near-matches — never to store or to match on.
 *
 * Folds the hamza family onto a bare alef, drops the Arabic diacritics a typist may or may not
 * have used, and collapses whitespace. Two names with the same key are almost certainly the same
 * word; they are reported, not merged.
 */
const fold = (name: string): string =>
  name
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\u0649]/g, '\u064A')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();

/**
 * What the import WOULD do, read against the live system.
 *
 * Computed rather than assumed, because this runs against a database somebody may already have
 * been using: a car that is already there is an update, not a duplicate, and the only honest
 * report is the one that says which is which.
 */
export const planImport = async (
  parsed: ParseResult,
  photoNames: ReadonlySet<string>,
): Promise<ImportPlan> => {
  const { cars } = parsed;

  const newTypes: string[] = [];
  for (const name of uniq(cars.map((c) => c.type))) {
    if ((await fleetVehicleTypeRepository.findByNameAr(name)) === null) newTypes.push(name);
  }

  const newCatalog: { kind: FleetCatalogKind; name: string }[] = [];
  const nearMatches: { kind: FleetCatalogKind; incoming: string; existing: string }[] = [];
  const kinds: [FleetCatalogKind, (c: ParsedCar) => string | null][] = [
    ['licenseClass', (c) => c.licenseClass],
    ['operation', (c) => c.operation],
    ['insuranceCompany', (c) => c.insurer],
  ];
  for (const [kind, pick] of kinds) {
    const wanted = uniq(cars.map(pick));
    if (wanted.length === 0) continue;
    const live = await fleetCatalogItemRepository.list({
      filter: { kind, isDeleted: false },
      page: 1,
      pageSize: MAX_PAGE_SIZE,
    });
    const byFold = new Map(live.items.map((item) => [fold(item.name.ar), item.name.ar]));
    for (const name of wanted) {
      if ((await fleetCatalogItemRepository.findByKindAndNameAr(kind, name)) !== null) continue;
      newCatalog.push({ kind, name });
      const close = byFold.get(fold(name));
      if (close !== undefined) nearMatches.push({ kind, incoming: name, existing: close });
    }
  }

  // BRANCHES ARE MATCHED, NEVER CREATED, and that is a deliberate refusal rather than a gap.
  //
  // A branch is not a Fleet fact: HR, Gold and every user's data scope point at the same registry,
  // and creating one needs a COMPANY CODE (`^[A-Z0-9][A-Z0-9-]{0,19}$`) that only the company can
  // decide. Inventing «BR-1» for «المهندسين» when the real branch already exists under the real
  // code would split the organisation in two — employees on one, a hundred cars on the other —
  // and that is a far harder thing to undo than adding seven rows by hand beforehand.
  const missingBranches: string[] = [];
  for (const name of uniq(cars.map((c) => c.branch))) {
    const found = await branchRepository.findByName({ ar: name, en: name });
    if (found === null) missingBranches.push(name);
  }

  const toCreate: string[] = [];
  const toUpdate: string[] = [];
  for (const car of cars) {
    const existing = await fleetVehicleRepository.findByCode(car.code);
    (existing === null ? toCreate : toUpdate).push(car.code);
  }

  const missingPhotos: string[] = [];
  const withPhoto: string[] = [];
  for (const car of cars) {
    if (car.photo === null) continue;
    (photoNames.has(car.photo) ? withPhoto : missingPhotos).push(car.code);
  }

  return {
    cars,
    newTypes,
    newCatalog,
    nearMatches,
    missingBranches,
    toCreate,
    toUpdate,
    missingPhotos,
    withPhoto,
  };
};

export interface ImportOutcome {
  created: number;
  updated: number;
  photos: number;
  failures: { code: string; reason: string }[];
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/**
 * Apply a plan.
 *
 * One car at a time and NOT in a transaction, deliberately: a licence upload is a separate write
 * to the Files service, and a failure on car 140 must not undo the 139 that are already correct.
 * Every failure is collected and reported at the end instead, with the code it belongs to, so a
 * re-run — which is an update for everything already in — can finish the job.
 */
export const applyImport = async (
  plan: ImportPlan,
  photoDir: string,
  photoNames: ReadonlySet<string>,
  ctx: AuthContext,
): Promise<ImportOutcome> => {
  const outcome: ImportOutcome = { created: 0, updated: 0, photos: 0, failures: [] };
  const by = ctx.userId;
  // The importer's own data scope, derived from the context exactly as a request would derive it —
  // never a hand-built «see everything». `fleetVehicle.edit` is the grant every write here is made
  // under, including the licence upload's own authorizer, so the scope is taken from the same one.
  const scope = scopeSelector(ctx, 'fleetVehicle.edit');

  const typeIds = new Map<string, string>();
  for (const name of uniq(plan.cars.map((c) => c.type))) {
    const existing = await fleetVehicleTypeRepository.findByNameAr(name);
    if (existing !== null) {
      typeIds.set(name, String(existing._id));
      continue;
    }
    // `maintenanceIntervalKm: 0` — the owner has not given the intervals yet, and 0 is how the
    // alarm engine says «this type has no service distance» (`noInterval`). The cars import
    // cleanly and the alarm stays quiet until somebody fills the number in on /fleet/settings;
    // inventing a service interval for a fleet is not a thing this script may do.
    const made = await fleetVehicleTypeService.create(
      { name: { ar: name, en: name }, maintenanceIntervalKm: 0 },
      by,
    );
    typeIds.set(name, String(made._id));
  }

  const catalogIds = new Map<string, string>();
  const key = (kind: string, name: string): string => `${kind}::${name}`;
  const ensureCatalog = async (kind: FleetCatalogKind, name: string): Promise<string> => {
    const cached = catalogIds.get(key(kind, name));
    if (cached !== undefined) return cached;
    const doc = await fleetCatalogItemService.ensure({
      kind,
      name: { ar: name, en: name },
      countsForAlarm: false,
    });
    catalogIds.set(key(kind, name), String(doc._id));
    return String(doc._id);
  };

  const branchIds = new Map<string, string>();
  for (const name of uniq(plan.cars.map((c) => c.branch))) {
    const found = await branchRepository.findByName({ ar: name, en: name });
    if (found !== null) branchIds.set(name, String(found._id));
  }

  for (const car of plan.cars) {
    try {
      const branchId = branchIds.get(car.branch);
      if (branchId === undefined) throw new Error(`branch «${car.branch}» is not in the system`);
      const typeId = typeIds.get(car.type);
      if (typeId === undefined) throw new Error(`vehicle type «${car.type}» was not resolved`);

      const body: CreateFleetVehicle = {
        code: car.code,
        typeId,
        plateNumber: car.plateNumber,
        chassisNumber: car.chassisNumber,
        motorNumber: car.motorNumber,
        joinedAt: car.joinedAt,
        licenseExpiresAt: car.licenseExpiresAt,
        branchId,
        licenseClassId:
          car.licenseClass === null ? null : await ensureCatalog('licenseClass', car.licenseClass),
        operationId:
          car.operation === null ? null : await ensureCatalog('operation', car.operation),
        insuranceCompanyId:
          car.insurer === null ? null : await ensureCatalog('insuranceCompany', car.insurer),
        radio: { issi: car.issi, motorolaSn: car.motorolaSn },
      };

      const existing = await fleetVehicleRepository.findByCode(car.code);
      const id =
        existing === null
          ? String((await fleetVehicleService.create(body, by))._id)
          : String(existing._id);
      if (existing === null) {
        outcome.created += 1;
      } else {
        // A RE-RUN IS AN UPDATE, which is what makes this safe to run twice — and what lets a run
        // that failed halfway be finished by running it again rather than unpicked by hand.
        await fleetVehicleService.update(id, { ...body, version: existing.__v }, by, scope);
        outcome.updated += 1;
      }

      if (car.photo !== null && photoNames.has(car.photo)) {
        const buffer = await readFile(join(photoDir, car.photo));
        const mime = MIME[extname(car.photo).toLowerCase()];
        if (mime === undefined)
          throw new Error(`«${car.photo}» is not an image this registry takes`);
        await fleetVehicleService.setLicenseImage(
          ctx,
          id,
          { originalName: car.photo, mime, size: buffer.byteLength, buffer },
          scope,
        );
        outcome.photos += 1;
      }
    } catch (error) {
      outcome.failures.push({
        code: car.code,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcome;
};
