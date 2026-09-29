// The go-live VEHICLE CHANGES: a second export of the legacy `cars` collection, read against the
// first one, and the difference applied to the registry that the first one filled.
//
// «عاوزك تضيف التغيرات اللى هنا تحطها على ecms». The owner sent the cars again, two weeks after the
// registry went live from `cars.json` (`go-live:vehicles:v3`). Same 213 rows, same legacy ids — and
// 38 licence classes swapped between «برقاش م» and «برقاش ت», 36 licence expiry dates moved on,
// three cars moved branch, one car moved from «نقل اموال» to «ATM», and 31 cars now name a licence
// scan. That is what the old system recorded in the fortnight since, and it is what this applies.
// Importable and side-effect free until `applyVehicleChanges`; `vehicle-changes.ts` runs it at boot.
//
// WHY A DIFF AND NOT A RE-IMPORT. Re-running the vehicle import over the new file would write
// EVERY field of EVERY car — `applyImport` updates by code with the whole row — and so it would
// put the export's value back over every correction the company has typed on ECMS since go-live.
// The registry is live now; people edit it. So nothing is written that the new export does not
// CHANGE: the two files are compared field by field, car by car, and only a field whose value
// differs between them is even looked at.
//
// THE THREE-WAY RULE, for every field the new export changes. The OLD export is what the earlier
// import wrote; the registry is what ECMS holds now; the NEW export is what the old system says
// now. So:
//
//   ECMS = NEW  → the change is already there (a person made it, or an earlier attempt of this
//                 run did) — counted, not written again;
//   ECMS = OLD  → nobody has touched the field since the import wrote it — the NEW value is applied;
//   otherwise   → somebody changed it on ECMS since — THEIR value stays, and the field is listed
//                 with all three values, so whoever owns the car can decide which is right.
//
// A person's edit is never overwritten. That is the whole rule, and it is also what makes the
// run safe to take over: a field this run already applied reads as «already new» to the next.
//
// NAMES ARE MATCHED EXACTLY AS THE VEHICLE IMPORT MATCHED THEM, because the OLD side of the rule
// is only meaningful if it names the same row the import wrote. A licence class, an operation or
// an insurer is the catalog row with that exact Arabic name (`findByKindAndNameAr` — what
// `ensure` looked up when it wrote the car); a branch is `resolveBranches`, exact and then
// folded, the one resolver the import and its planner share; a vehicle type is the type
// registry's exact name. The NEW value is created where it does not exist yet, as the import
// created it — a catalog row by `ensure`, a vehicle type with no service interval — and only when
// the change is actually being applied: a field that is kept, or already there, adds nothing to
// any list.
//
// WHAT IS NOT DONE. A car only in the new export is REPORTED, not created; a car only in the old
// one is REPORTED, not deleted — the registry's own screen is where a car is added or removed,
// with a person's name on it. A car whose scan the new export names but whose file was not
// supplied is listed, not guessed at. A car that already has a scan on ECMS keeps it. A disposed
// car is read-only by the registry's own rule (`isVehicleWritable`) and is listed, not written: it
// is out of the fleet, and «bring it back first» is a person's decision.
//
// A LICENCE CLASS CHANGE VOIDS THE LICENSING BOARD'S MARKS for that car — `fleetVehicleService.
// update` does it, for every caller, because «a new licence is new paperwork». Going through the
// service rather than around it is the point: the change lands exactly as if somebody had made it
// on the car's own form, audited, evented, and with every rule the form is held to.
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { type FleetCatalogKind, type UpdateFleetVehicle } from '@ecms/contracts';
import { scopeSelector, type AuthContext } from '../../../shared/types';
// The vehicle import FIRST, and the branch registry after the Fleet modules, in the order
// `vehicles-import.ts` itself loads them. The organisation's models close an import cycle through
// the directory, and a module graph that enters it at `branch.repository` finds bindings still
// uninitialised (`addOrgUnitIndexes`, `localizedField`) and fails to load at all.
import { failureReason, MIME, resolveBranches, type ParsedCar } from './vehicles-import';
import { fleetCatalogItemRepository, fleetCatalogItemService } from '../catalogs';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { fleetVehicleTypeService } from '../vehicle-types/vehicle-type.service';
import { type FleetVehicleDoc } from '../vehicles/vehicle.model';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetVehicleService } from '../vehicles/vehicle.service';
import { isVehicleWritable } from '../vehicles/vehicle-status';
import { type BranchDoc } from '../../../platform/organization/branches/branch.model';
import { branchRepository } from '../../../platform/organization/branches/branch.repository';

/**
 * Every field `parseCars` yields that a later export can change, in the order the car's form
 * shows them. `code` is not among them — it is what the two exports are joined on — and `photo`
 * is handled on its own, because a scan is a file and not a value.
 */
export const VEHICLE_CHANGE_FIELDS = [
  'type',
  'plateNumber',
  'chassisNumber',
  'motorNumber',
  'joinedAt',
  'licenseExpiresAt',
  'licenseClass',
  'branch',
  'operation',
  'insurer',
  'issi',
  'motorolaSn',
] as const;
export type VehicleChangeField = (typeof VEHICLE_CHANGE_FIELDS)[number];

/** A value as an export writes it — trimmed text, a day, or nothing. */
export type ExportValue = string | Date | null;

export interface FieldChange {
  field: VehicleChangeField;
  /** What the OLD export said — what the earlier import wrote. */
  old: ExportValue;
  /** What the NEW export says. */
  next: ExportValue;
}

/** The licence scan the two exports name, by file name. `next: null` = the new one names none. */
export interface PhotoChange {
  old: string | null;
  next: string | null;
}

export interface CarChanges {
  code: string;
  fields: FieldChange[];
  photo: PhotoChange | null;
}

export interface VehicleChangesPlan {
  /** Live cars in the NEW export. */
  cars: number;
  /** Every car the new export changes anything on, in the new export's order. */
  changes: CarChanges[];
  /** How many cars the new export changes each field on — `photo` included. */
  inExport: Partial<Record<VehicleChangeField | 'photo', number>>;
  /** Codes only the new export has. Reported; a car is added on the registry's own screen. */
  newCars: string[];
  /** Codes only the old export had. Reported; nothing is deleted because an export left it out. */
  goneFromExport: string[];
}

/** A day, as the facts are days: the UTC calendar date, which is what the car's form sends. */
export const dayKey = (value: Date): string => value.toISOString().slice(0, 10);

const sameExportValue = (a: ExportValue, b: ExportValue): boolean => {
  if (a === null || b === null) return a === b;
  if (a instanceof Date && b instanceof Date) return dayKey(a) === dayKey(b);
  return a === b;
};

/**
 * The two exports, compared. Pure: both sides are `parseCars` output, so every string is already
 * trimmed — «برقاش م » and «برقاش م» are one value here, exactly as they became one catalog row
 * when the import wrote them, and a trailing space the old system dropped is not a change.
 */
export const planVehicleChanges = (
  oldCars: readonly ParsedCar[],
  newCars: readonly ParsedCar[],
): VehicleChangesPlan => {
  const oldByCode = new Map(oldCars.map((car) => [car.code, car]));
  const newCodes = new Set(newCars.map((car) => car.code));
  const plan: VehicleChangesPlan = {
    cars: newCars.length,
    changes: [],
    inExport: {},
    newCars: [],
    goneFromExport: oldCars.filter((car) => !newCodes.has(car.code)).map((car) => car.code),
  };
  const count = (key: VehicleChangeField | 'photo'): void => {
    plan.inExport[key] = (plan.inExport[key] ?? 0) + 1;
  };
  for (const car of newCars) {
    const before = oldByCode.get(car.code);
    if (before === undefined) {
      plan.newCars.push(car.code);
      continue;
    }
    const fields: FieldChange[] = [];
    for (const field of VEHICLE_CHANGE_FIELDS) {
      if (sameExportValue(before[field], car[field])) continue;
      fields.push({ field, old: before[field], next: car[field] });
      count(field);
    }
    const photo = before.photo === car.photo ? null : { old: before.photo, next: car.photo };
    if (photo !== null) count('photo');
    if (fields.length > 0 || photo !== null) plan.changes.push({ code: car.code, fields, photo });
  }
  return plan;
};

/**
 * A value in the one shape the rule compares: text as written, a day as `YYYY-MM-DD`, a catalog
 * row / branch / type as its id, nothing as `null`. `undefined` is «this name is nothing on ECMS»
 * — an old catalog name somebody has since renamed, a new one not created yet — and it equals
 * NOTHING, not even another `undefined`: a value nobody can name cannot prove a field untouched.
 */
export type ValueKey = string | null | undefined;

export type ChangeDecision = 'apply' | 'alreadyNew' | 'keptEcmsEdit';

/**
 * THE THREE-WAY RULE — see the header. «Already new» is asked first, so a field that equals both
 * sides (a change and its reversal, say) is counted and never written.
 */
export const decideChange = (ecms: ValueKey, old: ValueKey, next: ValueKey): ChangeDecision => {
  const same = (a: ValueKey, b: ValueKey): boolean => a !== undefined && b !== undefined && a === b;
  if (same(ecms, next)) return 'alreadyNew';
  if (same(ecms, old)) return 'apply';
  return 'keptEcmsEdit';
};

const idOrNull = (value: unknown): string | null => (value == null ? null : String(value));
const textOrNull = (value: string | null | undefined): string | null =>
  value == null || value.trim() === '' ? null : value.trim();

/**
 * What ECMS holds for a field, as a key. `== null` throughout because this reads a `.lean()`
 * document, where a field added after the row was written is absent rather than null.
 */
export const ecmsKeyOf = (
  vehicle: Pick<
    FleetVehicleDoc,
    | 'typeId'
    | 'plateNumber'
    | 'chassisNumber'
    | 'motorNumber'
    | 'joinedAt'
    | 'licenseExpiresAt'
    | 'licenseClassId'
    | 'branchId'
    | 'operationId'
    | 'insuranceCompanyId'
    | 'radio'
  >,
  field: VehicleChangeField,
): string | null => {
  switch (field) {
    case 'type':
      return idOrNull(vehicle.typeId);
    case 'plateNumber':
    case 'chassisNumber':
    case 'motorNumber':
      return textOrNull(vehicle[field]);
    case 'joinedAt':
    case 'licenseExpiresAt':
      return vehicle[field] == null ? null : dayKey(new Date(vehicle[field]));
    case 'licenseClass':
      return idOrNull(vehicle.licenseClassId);
    case 'branch':
      return idOrNull(vehicle.branchId);
    case 'operation':
      return idOrNull(vehicle.operationId);
    case 'insurer':
      return idOrNull(vehicle.insuranceCompanyId);
    case 'issi':
      return textOrNull(vehicle.radio?.issi);
    case 'motorolaSn':
      return textOrNull(vehicle.radio?.motorolaSn);
  }
};

/** A change about to be written, its NEW value already turned into what the model stores. */
export interface AppliedChange {
  field: VehicleChangeField;
  /** Text, a day, or an id — the NEW export's value in the model's own terms. */
  value: string | Date | null;
}

/**
 * The update body for one car: the changed fields ONLY, so every other field — and every other
 * correction a person made — is left exactly as it is.
 *
 * The radio is the one pair that is written together: the service sets both of its halves from
 * whatever the body carries, so a change to the ISSI alone carries the car's CURRENT Motorola
 * serial beside it rather than blanking it.
 */
export const updateBodyFor = (
  applied: readonly AppliedChange[],
  vehicle: Pick<FleetVehicleDoc, 'radio'>,
): Omit<UpdateFleetVehicle, 'version'> => {
  const body: Omit<UpdateFleetVehicle, 'version'> = {};
  const text = (value: AppliedChange['value']): string | null =>
    value === null ? null : value instanceof Date ? dayKey(value) : value;
  const radio = {
    issi: textOrNull(vehicle.radio?.issi),
    motorolaSn: textOrNull(vehicle.radio?.motorolaSn),
  };
  let radioChanged = false;
  for (const { field, value } of applied) {
    switch (field) {
      case 'type':
        if (value !== null) body.typeId = text(value) as string;
        break;
      case 'plateNumber':
      case 'chassisNumber':
      case 'motorNumber':
        if (value !== null) body[field] = text(value) as string;
        break;
      case 'joinedAt':
      case 'licenseExpiresAt':
        if (value instanceof Date) body[field] = value;
        break;
      case 'licenseClass':
        body.licenseClassId = text(value);
        break;
      case 'branch':
        if (value !== null) body.branchId = text(value) as string;
        break;
      case 'operation':
        body.operationId = text(value);
        break;
      case 'insurer':
        body.insuranceCompanyId = text(value);
        break;
      case 'issi':
      case 'motorolaSn':
        radio[field] = text(value);
        radioChanged = true;
        break;
    }
  }
  if (radioChanged) body.radio = radio;
  return body;
};

/** The catalog kind behind each catalog field — the three the vehicle import `ensure`s. */
const CATALOG_KIND: Partial<Record<VehicleChangeField, FleetCatalogKind>> = {
  licenseClass: 'licenseClass',
  operation: 'operation',
  insurer: 'insuranceCompany',
};

/** How a changed field is read out on the run — a day as a day, anything else as written. */
const shown = (value: ExportValue): string | null =>
  value === null ? null : value instanceof Date ? dayKey(value) : value;

export interface VehicleChangesOutcome {
  /** Fields written, by field. */
  changed: Partial<Record<VehicleChangeField, number>>;
  /** Fields — and scans — ECMS already had the new value of. */
  alreadyNew: number;
  /** Scans attached by this run. */
  photos: number;
  /** Fields somebody changed on ECMS since the import — kept, with all three values. */
  keptEcmsEdits: {
    code: string;
    field: VehicleChangeField;
    ecms: string | null;
    old: string | null;
    new: string | null;
  }[];
  /** Codes the registry has no live car for. */
  notInRegistry: string[];
  /** Disposed cars the new export changes — «code: fields», not written. */
  disposedCars: string[];
  /** «code: file» — the new export names a scan this build does not carry. */
  photosNotInBuild: string[];
  /** «code: file ← ECMS: file» — the car already has a scan on ECMS; it is kept. */
  photoAlreadyThere: string[];
  /** «code: file» — the new export names no scan where the old one named this one; ECMS keeps it. */
  photoDropped: string[];
  /** Catalog rows this run added for a new value — «kind: name». */
  catalogCreated: string[];
  /** Vehicle types this run added for a new value. */
  vehicleTypesCreated: string[];
  failures: { code: string; reason: string }[];
}

/**
 * Names on both sides of the rule, turned into ids the way the vehicle import turned them — see
 * the header. Cached per run: 213 cars name a handful of catalog rows between them.
 */
const vocabularyResolver = (
  by: string,
  branches: ReadonlyMap<string, BranchDoc | null>,
  outcome: VehicleChangesOutcome,
) => {
  const catalogIds = new Map<string, string | undefined>();
  const typeIds = new Map<string, string | undefined>();
  const keyOf = (kind: string, name: string): string => `${kind}::${name}`;

  const catalogLookup = async (
    kind: FleetCatalogKind,
    name: string,
  ): Promise<string | undefined> => {
    const key = keyOf(kind, name);
    if (!catalogIds.has(key)) {
      const found = await fleetCatalogItemRepository.findByKindAndNameAr(kind, name);
      catalogIds.set(key, found === null ? undefined : String(found._id));
    }
    return catalogIds.get(key);
  };
  const typeLookup = async (name: string): Promise<string | undefined> => {
    if (!typeIds.has(name)) {
      const found = await fleetVehicleTypeRepository.findByNameAr(name);
      typeIds.set(name, found === null ? undefined : String(found._id));
    }
    return typeIds.get(name);
  };

  return {
    /** An export value as a key — looked up, never created. */
    async lookup(field: VehicleChangeField, value: ExportValue): Promise<ValueKey> {
      if (value === null) return null;
      if (value instanceof Date) return dayKey(value);
      const kind = CATALOG_KIND[field];
      if (kind !== undefined) return catalogLookup(kind, value);
      if (field === 'type') return typeLookup(value);
      if (field === 'branch') {
        const branch = branches.get(value);
        return branch == null ? undefined : String(branch._id);
      }
      return value;
    },

    /**
     * The NEW export's value in the model's terms, CREATED where it is missing — a catalog row
     * by `ensure`, a type with no service interval — exactly as the vehicle import created them.
     * Only ever asked for a change that is being applied.
     */
    async ensure(field: VehicleChangeField, value: ExportValue): Promise<string | Date | null> {
      if (value === null || value instanceof Date) return value;
      const kind = CATALOG_KIND[field];
      if (kind !== undefined) {
        const existing = await catalogLookup(kind, value);
        if (existing !== undefined) return existing;
        const doc = await fleetCatalogItemService.ensure(
          { kind, name: { ar: value, en: value }, countsForAlarm: false },
          by,
        );
        catalogIds.set(keyOf(kind, value), String(doc._id));
        outcome.catalogCreated.push(`${kind}: ${value}`);
        return String(doc._id);
      }
      if (field === 'type') {
        const existing = await typeLookup(value);
        if (existing !== undefined) return existing;
        // `maintenanceIntervalKm: 0` for the vehicle import's reason: the owner has not given the
        // interval, and 0 is how the alarm engine says «no service distance for this type».
        const made = await fleetVehicleTypeService.create(
          { name: { ar: value, en: value }, maintenanceIntervalKm: 0 },
          by,
        );
        typeIds.set(value, String(made._id));
        outcome.vehicleTypesCreated.push(value);
        return String(made._id);
      }
      if (field === 'branch') {
        // Never created — a branch is the organisation's, and the step refuses before its claim
        // when a new branch is missing. Reaching here means the branch went away mid-run.
        const branch = branches.get(value);
        if (branch == null) throw new Error(`branch «${value}» is not in the system`);
        return String(branch._id);
      }
      return value;
    },

    /** ECMS's value read out BY NAME for the run — an id means nothing to whoever reads it. */
    async show(field: VehicleChangeField, key: string | null): Promise<string | null> {
      if (key === null) return null;
      const kind = CATALOG_KIND[field];
      if (kind !== undefined) {
        return (await fleetCatalogItemRepository.findById(key))?.name.ar ?? key;
      }
      if (field === 'type') return (await fleetVehicleTypeRepository.findById(key))?.name.ar ?? key;
      if (field === 'branch') return (await branchRepository.findById(key))?.name.ar ?? key;
      return key;
    },
  };
};

/**
 * Apply a plan.
 *
 * One car at a time and NOT in a transaction, for the vehicle import's reason: a scan is a
 * separate write to the Files service, and a failure on one car must not undo the cars already
 * right. Every failure is collected with its code; the run is then left unfinished, and the
 * take-over that follows finds every field this run wrote already new.
 */
export const applyVehicleChanges = async (
  plan: VehicleChangesPlan,
  photoDir: string,
  photoNames: ReadonlySet<string>,
  ctx: AuthContext,
): Promise<VehicleChangesOutcome> => {
  const outcome: VehicleChangesOutcome = {
    changed: {},
    alreadyNew: 0,
    photos: 0,
    keptEcmsEdits: [],
    notInRegistry: [],
    disposedCars: [],
    photosNotInBuild: [],
    photoAlreadyThere: [],
    photoDropped: [],
    catalogCreated: [],
    vehicleTypesCreated: [],
    failures: [],
  };
  // Every field the export changes is on the count, a zero included — «licenseClass: 36» beside
  // an export that changed 38 says, on its own, that two were kept or already there.
  for (const field of VEHICLE_CHANGE_FIELDS) {
    if ((plan.inExport[field] ?? 0) > 0) outcome.changed[field] = 0;
  }
  const by = ctx.userId;
  // The importer's own data scope, derived from the context exactly as a request would derive it
  // — the vehicle import's rule, under the grant every write here is made under.
  const scope = scopeSelector(ctx, 'fleetVehicle.edit');
  // Both sides of every branch change, in one read of the list — the resolver the import used.
  const branchNames = new Set<string>();
  for (const car of plan.changes) {
    for (const change of car.fields) {
      if (change.field !== 'branch') continue;
      for (const name of [change.old, change.next]) {
        if (typeof name === 'string') branchNames.add(name);
      }
    }
  }
  const names = vocabularyResolver(by, await resolveBranches([...branchNames]), outcome);

  for (const car of plan.changes) {
    try {
      const vehicle = await fleetVehicleRepository.findByCode(car.code);
      if (vehicle === null) {
        outcome.notInRegistry.push(car.code);
        continue;
      }

      const toApply: FieldChange[] = [];
      for (const change of car.fields) {
        const ecms = ecmsKeyOf(vehicle, change.field);
        const decision = decideChange(
          ecms,
          await names.lookup(change.field, change.old),
          await names.lookup(change.field, change.next),
        );
        if (decision === 'alreadyNew') {
          outcome.alreadyNew += 1;
        } else if (decision === 'keptEcmsEdit') {
          outcome.keptEcmsEdits.push({
            code: car.code,
            field: change.field,
            ecms: await names.show(change.field, ecms),
            old: shown(change.old),
            new: shown(change.next),
          });
        } else {
          toApply.push(change);
        }
      }

      // The scan, by the same rule: a car with no scan on ECMS is what the import left, and takes
      // the new one if this build carries it; a car WITH one keeps it — the same file is «already
      // new», any other is a person's upload or the import's own.
      let attach: string | null = null;
      if (car.photo !== null) {
        const { next } = car.photo;
        const current = vehicle.licenseImage?.fileName ?? null;
        if (next === null) {
          outcome.photoDropped.push(`${car.code}: ${car.photo.old ?? ''}`);
        } else if (current === next) {
          outcome.alreadyNew += 1;
        } else if (current !== null) {
          outcome.photoAlreadyThere.push(`${car.code}: ${next} ← ECMS: ${current}`);
        } else if (!photoNames.has(next)) {
          outcome.photosNotInBuild.push(`${car.code}: ${next}`);
        } else {
          attach = next;
        }
      }

      if (toApply.length === 0 && attach === null) continue;
      if (!isVehicleWritable(vehicle.status)) {
        const what = [
          ...toApply.map((change) => change.field),
          ...(attach === null ? [] : ['photo']),
        ];
        outcome.disposedCars.push(`${car.code}: ${what.join(', ')}`);
        continue;
      }

      const id = String(vehicle._id);
      if (toApply.length > 0) {
        const applied: AppliedChange[] = [];
        for (const change of toApply) {
          applied.push({
            field: change.field,
            value: await names.ensure(change.field, change.next),
          });
        }
        // The version the rule was decided against: a person who saves the car between that read
        // and this write makes it a stale write, which fails this car, and the take-over decides
        // again against what they saved.
        await fleetVehicleService.update(
          id,
          { ...updateBodyFor(applied, vehicle), version: vehicle.__v },
          by,
          scope,
        );
        for (const change of toApply) {
          outcome.changed[change.field] = (outcome.changed[change.field] ?? 0) + 1;
        }
      }

      if (attach !== null) {
        const buffer = await readFile(join(photoDir, attach));
        const mime = MIME[extname(attach).toLowerCase()];
        if (mime === undefined) throw new Error(`«${attach}» is not an image this registry takes`);
        await fleetVehicleService.setLicenseImage(
          ctx,
          id,
          { originalName: attach, mime, size: buffer.byteLength, buffer },
          scope,
        );
        outcome.photos += 1;
      }
    } catch (error) {
      outcome.failures.push({ code: car.code, reason: failureReason(error) });
    }
  }
  return outcome;
};

/**
 * What must be true BEFORE the run may claim — the vehicle import's two refusals, asked of the
 * new values only.
 *
 * A NEW BRANCH that /system does not have, or has deactivated, fails `assertBranch` inside the
 * loop on every car moving to it — after the claim, as «Validation failed». A NEW plate, chassis
 * or motor number another live car already holds fails the unique index the same way. Both are
 * the operator's to fix, so both are asked here, where nothing has been written.
 */
export interface VehicleChangesBlockers {
  missingBranches: string[];
  inactiveBranches: string[];
  identifierClashes: { code: string; field: string; value: string; heldBy: string }[];
}

export const findBlockers = async (plan: VehicleChangesPlan): Promise<VehicleChangesBlockers> => {
  const blockers: VehicleChangesBlockers = {
    missingBranches: [],
    inactiveBranches: [],
    identifierClashes: [],
  };
  const newBranches = new Set<string>();
  for (const car of plan.changes) {
    for (const change of car.fields) {
      if (change.field === 'branch' && typeof change.next === 'string') {
        newBranches.add(change.next);
      }
      if (
        (change.field === 'plateNumber' ||
          change.field === 'chassisNumber' ||
          change.field === 'motorNumber') &&
        typeof change.next === 'string'
      ) {
        const holder = await fleetVehicleRepository.findOneBy({ [change.field]: change.next });
        if (holder !== null && holder.code !== car.code) {
          blockers.identifierClashes.push({
            code: car.code,
            field: change.field,
            value: change.next,
            heldBy: holder.code,
          });
        }
      }
    }
  }
  for (const [name, found] of await resolveBranches([...newBranches])) {
    if (found === null) blockers.missingBranches.push(name);
    else if (found.status !== 'active') blockers.inactiveBranches.push(name);
  }
  return blockers;
};
