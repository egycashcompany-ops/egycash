// Fleet module contracts (docs/12-planning/fleet-module-design.md, FROZEN v1.0).
//
// The legacy system informed the DOMAIN here, never the shapes: everything derivable (km, alarm
// level, "in workshop", "current driver") is absent from stored DTOs on purpose — FR-12 makes
// derived facts query-time facts, and a field that does not exist cannot go stale.
import { z } from 'zod';
import { LocalizedStringSchema } from '../common/localized.js';
import {
  MAX_PAGE_SIZE,
  PaginationQuerySchema,
  booleanQuery,
  listQuery,
  objectId,
} from '../common/index.js';

/** Money in EGP. A plain nonnegative number — multi-currency is not a fleet fact. */
const egp = () => z.number().nonnegative();

// ── Vehicle types (catalog + the per-type maintenance rule) ─────────────────

export interface FleetVehicleTypeDto {
  id: string;
  name: { ar: string; en: string };
  /** Service interval in km; 0 = no periodic-maintenance rule for this type. */
  maintenanceIntervalKm: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateFleetVehicleTypeSchema = z
  .object({
    name: LocalizedStringSchema,
    maintenanceIntervalKm: z.number().int().min(0).default(0),
  })
  .strict();
export type CreateFleetVehicleType = z.infer<typeof CreateFleetVehicleTypeSchema>;

export const UpdateFleetVehicleTypeSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    maintenanceIntervalKm: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFleetVehicleType = z.infer<typeof UpdateFleetVehicleTypeSchema>;

// ── Catalogs ────────────────────────────────────────────────────────────────

export const FLEET_CATALOG_KINDS = [
  'workshop',
  'workType',
  'sparePart',
  'missionType',
  'violationType',
  'unavailabilityReason',
  // Three kinds added for the vehicle registry's typed references. They are catalogs for the same
  // reason the first six are: an admin-owned vocabulary the domain points AT, never a string the
  // domain carries. `licenseClass` is §13-Q7's answer arriving as data rather than an enum — the
  // admin names the classes, so no code change is needed when the authority renames one.
  'licenseClass',
  'operation',
  'insuranceCompany',
] as const;
export const FleetCatalogKindSchema = z.enum(FLEET_CATALOG_KINDS);
export type FleetCatalogKind = z.infer<typeof FleetCatalogKindSchema>;

export interface FleetCatalogItemDto {
  id: string;
  kind: FleetCatalogKind;
  name: { ar: string; en: string };
  /** `workType` only: closing a visit of this type resets the maintenance-alarm baseline. */
  countsForAlarm: boolean;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateFleetCatalogItemSchema = z
  .object({
    kind: FleetCatalogKindSchema,
    name: LocalizedStringSchema,
    countsForAlarm: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.countsForAlarm && value.kind !== 'workType') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['countsForAlarm'],
        message: 'only a workType can count for the maintenance alarm',
      });
    }
  });
export type CreateFleetCatalogItem = z.infer<typeof CreateFleetCatalogItemSchema>;

export const UpdateFleetCatalogItemSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    countsForAlarm: z.boolean().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFleetCatalogItem = z.infer<typeof UpdateFleetCatalogItemSchema>;

export const ListFleetCatalogQuerySchema = PaginationQuerySchema.extend({
  kind: FleetCatalogKindSchema.optional(),
  isActive: booleanQuery().optional(),
}).strict();
export type ListFleetCatalogQuery = z.infer<typeof ListFleetCatalogQuerySchema>;

// ── Vehicles ────────────────────────────────────────────────────────────────

export const FLEET_VEHICLE_STATUSES = ['active', 'outOfService', 'disposed'] as const;
export const FleetVehicleStatusSchema = z.enum(FLEET_VEHICLE_STATUSES);
export type FleetVehicleStatus = z.infer<typeof FleetVehicleStatusSchema>;

/**
 * The stored license-image reference — platform Files owns the bytes, the record owns the link.
 *
 * One shape, two owners: a VEHICLE's license (رخصة السيارة) and a DRIVER's license (رخصة
 * القيادة) are different documents about different subjects, but the link Fleet keeps to each is
 * the same five facts. The two aliases below exist so a reader of either DTO sees the name of the
 * thing being described rather than a shared type they have to go look up.
 */
export interface FleetLicenseImageDto {
  fileId: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: string;
}
export type FleetVehicleLicenseImageDto = FleetLicenseImageDto;
export type FleetDriverLicenseImageDto = FleetLicenseImageDto;

export interface FleetVehicleDto {
  id: string;
  code: string;
  typeId: string;
  plateNumber: string;
  chassisNumber: string;
  motorNumber: string;
  joinedAt: string;
  licenseExpiresAt: string;
  /** §13-Q7 answered as DATA: a `licenseClass` catalog reference, no longer a free string. */
  licenseClassId: string | null;
  /** `operation` catalog reference (التشغيل) — the operating group the vehicle runs under. */
  operationId: string | null;
  /** `insuranceCompany` catalog reference (شركة التأمين). */
  insuranceCompanyId: string | null;
  /**
   * REQUIRED since the catalogs slice: a vehicle belongs to a branch, and the branch is what data
   * scopes filter on. Nullable in the DTO only because vehicles created before the rule may still
   * carry null — those rows stay readable and editable, and an edit must name a branch.
   */
  branchId: string | null;
  departmentId: string | null;
  radio: { issi: string | null; motorolaSn: string | null };
  status: FleetVehicleStatus;
  statusReason: string | null;
  /** null = no license image on file; the UI offers the upload action instead of view/delete. */
  licenseImage: FleetVehicleLicenseImageDto | null;
  /** DERIVED (FR-12): an open maintenance visit exists. Never stored. */
  inWorkshop: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const vehicleCore = {
  code: z.string().trim().min(1).max(20),
  typeId: objectId(),
  plateNumber: z.string().trim().min(1).max(30),
  chassisNumber: z.string().trim().min(1).max(60),
  motorNumber: z.string().trim().min(1).max(60),
  joinedAt: z.coerce.date(),
  licenseExpiresAt: z.coerce.date(),
  // The three catalog references. Optional facts — a vehicle may legitimately have no insurer on
  // file — but when given they must name a LIVE catalog item of the right kind (service-enforced).
  licenseClassId: objectId().nullish(),
  operationId: objectId().nullish(),
  insuranceCompanyId: objectId().nullish(),
  // NOT nullish, unlike every other reference here: `null` is rejected by the schema, so neither a
  // create nor an update can leave a vehicle branchless. The service additionally proves the branch
  // exists and is active — a well-formed id for a deleted branch is still not a branch.
  branchId: objectId(),
  departmentId: objectId().nullish(),
  radio: z
    .object({
      issi: z.string().trim().min(1).max(60).nullish(),
      motorolaSn: z.string().trim().min(1).max(60).nullish(),
    })
    .strict()
    .default({}),
};

export const CreateFleetVehicleSchema = z.object(vehicleCore).strict();
export type CreateFleetVehicle = z.infer<typeof CreateFleetVehicleSchema>;

export const UpdateFleetVehicleSchema = z
  .object(vehicleCore)
  .partial()
  .extend({ version: z.number().int().min(0) })
  .strict();
export type UpdateFleetVehicle = z.infer<typeof UpdateFleetVehicleSchema>;

/** The create form's branch default (§16) — resolved from LIVE branch data, never a baked-in id. */
export interface FleetDefaultBranchDto {
  /** null = no branch matches the configured default name; the user must pick one. */
  branchId: string | null;
  name: { ar: string; en: string } | null;
  /** The name the lookup used, so the UI can say WHICH default was not found. */
  configuredName: string;
}

/** Lifecycle §4.1: reason is REQUIRED when leaving `active`; `disposed` is terminal. */
export const ChangeFleetVehicleStatusSchema = z
  .object({
    status: FleetVehicleStatusSchema,
    reason: z.string().trim().min(1).max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status !== 'active' && value.reason === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'a reason is required when a vehicle leaves active service',
      });
    }
  });
export type ChangeFleetVehicleStatus = z.infer<typeof ChangeFleetVehicleStatusSchema>;

/** One identifier filter: substring, case-insensitive — the list page's per-column search boxes. */
const identifierFilter = () => z.string().trim().min(1).max(60).optional();

// ── Vehicle codes, as a filter (one control, six screens) ───────────────────
//
// Every screen that filters by car asks the same question — "which cars?" — so they ask it in one
// vocabulary: `vehicleCodes=215,216,217`, exact, ORed. One parser reads it, and the filter box and
// the query schema both run that one, so what a person types and what the server matches cannot
// drift.
//
// THE HYPHEN, and the rule that settles it without guessing. A vehicle code is free text
// (`z.string().max(20)`), so `A-15` and `FLT-210` are legal codes and `215-216-217` is three cars
// written together. Nothing about the characters tells them apart.
//
// So the separator is not the dash — it is the SPACE around it. `215 - 216 - 217` is three, because
// a code cannot contain a space; `215-216` is one code, because it might genuinely be one. That
// keeps every real hyphenated code intact, costs the reader one space when they mean a list, and
// has no second interpretation to be surprised by: the same text always parses the same way, here,
// on the URL, and on the server.
//
// The alternative — asking the registry whether the whole run happens to be a code — reads better
// in the easy cases and worse in the hard one: the same string would split or not depending on what
// the search had answered a moment earlier, so a reader who typed the same thing twice could get
// two different filters.

/** Separators no vehicle code contains: commas, semicolons, newlines, whitespace, a spaced dash. */
const CODE_SEPARATORS = /\s*[,;\n\r]\s*|\s+-\s+|\s+/;

/**
 * The vehicle codes a piece of text names — deduplicated, in the order first written.
 *
 * Used for what a person types into the filter box AND for what arrives on the URL, deliberately:
 * one function means `?vehicleCodes=A-15` reloads as the code the reader picked, rather than as two
 * codes nobody has.
 */
export const splitVehicleCodeList = (raw: string | readonly string[]): string[] => {
  const parts = Array.isArray(raw) ? (raw as readonly string[]) : String(raw).split(CODE_SEPARATORS);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const code = part.trim();
    if (code === '') continue;
    // A lone dash is punctuation the reader is in the middle of typing (`150 -`), not a car. No
    // code is only dashes, so dropping it costs nothing and stops `-` becoming a search term.
    if (/^-+$/.test(code)) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(code);
  }
  return out;
};

/**
 * `vehicleCodes` as a query field.
 *
 * Deliberately NOT `listQuery()`: that helper splits on commas alone and keeps duplicates, and it
 * is shared by branch, status, level and alert filters whose meaning must not move for this.
 */
export const vehicleCodesQuery = (max = 50) =>
  z.preprocess(
    (raw) => {
      if (raw === undefined || raw === null) return undefined;
      const codes = splitVehicleCodeList(raw as string | readonly string[]);
      return codes.length === 0 ? undefined : codes;
    },
    z.array(z.string().trim().min(1).max(20)).min(1).max(max).optional(),
  );

export const ListFleetVehiclesQuerySchema = PaginationQuerySchema.extend({
  status: FleetVehicleStatusSchema.optional(),
  /** The vehicle TYPE is the make/model the registry knows (اختر الماركة). */
  typeId: objectId().optional(),
  branchId: listQuery(objectId()),
  /** Substring match across code/plate/chassis/motor at once. */
  search: z.string().trim().min(1).max(100).optional(),
  /**
   * The cars named EXACTLY, ORed — the filter bar's vehicle-code picker (one control, six screens).
   *
   * Exact, where `search` stays substring: they answer different questions, and the picker's
   * checkboxes can only mean the codes they tick. A code no car carries narrows to NOTHING rather
   * than being dropped, so an unrecognized pick is reported honestly instead of widening the page.
   */
  vehicleCodes: vehicleCodesQuery(),
  // Per-identifier filters, ANDed with each other and with `search`: narrowing by plate AND
  // chassis is a different question from searching either, and the list page asks both.
  /**
   * @deprecated Superseded by `vehicleCodes`. Substring, single-valued — the shape the list page
   * used before the picker. Still honoured so a saved link or a direct API caller keeps working;
   * the UI no longer writes it.
   */
  code: identifierFilter(),
  plateNumber: identifierFilter(),
  chassisNumber: identifierFilter(),
  motorNumber: identifierFilter(),
  licenseClassId: objectId().optional(),
  operationId: objectId().optional(),
  insuranceCompanyId: objectId().optional(),
  licenseExpiresBefore: z.coerce.date().optional(),
}).strict();
export type ListFleetVehiclesQuery = z.infer<typeof ListFleetVehiclesQuerySchema>;

// ── Driver profiles (FR-11 — fleet-owned facts about an HR employee) ────────

export const FLEET_DRIVER_SPECIALIZATIONS = ['cashTransport', 'atm', 'both'] as const;
export const FleetDriverSpecializationSchema = z.enum(FLEET_DRIVER_SPECIALIZATIONS);
export type FleetDriverSpecialization = z.infer<typeof FleetDriverSpecializationSchema>;

export interface FleetDriverProfileDto {
  id: string;
  employeeId: string;
  licenseNumber: string;
  licenseExpiresAt: string;
  specialization: FleetDriverSpecialization;
  area: string | null;
  isActive: boolean;
  /**
   * The driver's own licence scan (صورة الرخصة). null = nothing on file, and the registry offers
   * the upload action instead of view/delete.
   *
   * FR-11 holds: this is a FLEET-owned fact. HR's `drivingLicenses` records that a person is
   * licensed; the scan Fleet keeps is the operational document the dispatcher checks, and it
   * lives on the profile Fleet owns rather than on the employee record Fleet may not write.
   */
  licenseImage: FleetDriverLicenseImageDto | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateFleetDriverProfileSchema = z
  .object({
    employeeId: objectId(),
    licenseNumber: z.string().trim().min(1).max(60),
    licenseExpiresAt: z.coerce.date(),
    specialization: FleetDriverSpecializationSchema,
    area: z.string().trim().min(1).max(120).nullish(),
  })
  .strict();
export type CreateFleetDriverProfile = z.infer<typeof CreateFleetDriverProfileSchema>;

export const UpdateFleetDriverProfileSchema = z
  .object({
    licenseNumber: z.string().trim().min(1).max(60).optional(),
    licenseExpiresAt: z.coerce.date().optional(),
    specialization: FleetDriverSpecializationSchema.optional(),
    area: z.string().trim().min(1).max(120).nullish().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFleetDriverProfile = z.infer<typeof UpdateFleetDriverProfileSchema>;

// Only FLEET-owned columns are filterable here, and that is a boundary rather than an omission:
// name, employee code, job title, governorate, phone and branch are HR's facts, read by the
// browser from HR's own API with HR's own permission. Filtering a fleet-paginated list on them
// would mean Fleet querying HR's collection — the one thing the module hierarchy forbids.
export const ListFleetDriversQuerySchema = PaginationQuerySchema.extend({
  specialization: FleetDriverSpecializationSchema.optional(),
  isActive: booleanQuery().optional(),
  licenseExpiresBefore: z.coerce.date().optional(),
  /** Substring match on the licence number (المنطقة has its own parameter). */
  search: z.string().trim().min(1).max(100).optional(),
  /** Substring match on the fleet-owned area (المنطقة). */
  area: z.string().trim().min(1).max(120).optional(),
  /** true → only drivers WITH a licence scan on file; false → only those without. */
  hasLicenseImage: booleanQuery().optional(),
  /**
   * The HR half of the filter bar, already resolved to ids.
   *
   * Name, employee code, job title, governorate, phone and branch are HR's facts, and HR's own
   * list endpoint filters on them. The browser asks HR first and hands the answer here — two
   * server-side queries joined by id, which is how the drivers table already reads HR names. The
   * alternative, Fleet querying HR's collection, is the one thing the module hierarchy forbids.
   *
   * The cap is 100 because that is `MAX_PAGE_SIZE`: this parameter carries exactly ONE page of HR
   * results and no more. A wider HR match cannot be expressed here, and the caller must say so
   * rather than send the first hundred — a truncated `$in` is a filter that lies.
   */
  employeeIds: listQuery(objectId(), MAX_PAGE_SIZE),
}).strict();
export type ListFleetDriversQuery = z.infer<typeof ListFleetDriversQuerySchema>;

// ── Driver unavailability (التمامات — the operational overlay over HR leave) ─

export interface FleetDriverUnavailabilityDto {
  id: string;
  employeeId: string;
  from: string;
  to: string;
  reason: string;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateFleetUnavailabilitySchema = z
  .object({
    employeeId: objectId(),
    from: z.coerce.date(),
    to: z.coerce.date(),
    reason: z.string().trim().min(1).max(200),
    notes: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.to < value.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'unavailability cannot end before it starts',
      });
    }
  });
export type CreateFleetUnavailability = z.infer<typeof CreateFleetUnavailabilitySchema>;

export const UpdateFleetUnavailabilitySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    reason: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().min(1).max(1000).nullish().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFleetUnavailability = z.infer<typeof UpdateFleetUnavailabilitySchema>;

export const ListFleetUnavailabilityQuerySchema = PaginationQuerySchema.extend({
  employeeId: objectId().optional(),
  /** Rows whose [from, to] covers this date. */
  coversDate: z.coerce.date().optional(),
}).strict();
export type ListFleetUnavailabilityQuery = z.infer<typeof ListFleetUnavailabilityQuerySchema>;

// The alarm's vocabulary lives here, above BOTH its consumers: the odometer list filters on a
// level and the maintenance projection reports one, and a `const` used before its declaration is
// a TDZ error at import time, not a compile-time complaint.
export const FLEET_ALARM_LEVELS = ['none', 'yellow', 'red'] as const;
export const FleetAlarmLevelSchema = z.enum(FLEET_ALARM_LEVELS);
export type FleetAlarmLevel = z.infer<typeof FleetAlarmLevelSchema>;

// ── Odometer (FR-2 — continuity: one reading closes the previous period) ────

export interface FleetOdometerLogDto {
  id: string;
  vehicleId: string;
  /**
   * The registry's code for that vehicle, resolved SERVER-side for the row.
   *
   * A reader calls a car "150", not by its id, so every screen showing a reading has to show a
   * code — and a client cannot resolve one it has not got. Reading the registry a page at a time
   * to build the map bounds the answer at `MAX_PAGE_SIZE` vehicles and leaves every car past that
   * page nameless, which is why the roster and the violations rollup already carry the code on the
   * row rather than asking the client to join for it.
   *
   * `null` only when the vehicle no longer exists at all — a soft-deleted one keeps its code, so
   * history stays readable.
   */
  vehicleCode: string | null;
  date: string;
  outReading: number;
  /** null = the OPEN period; closed by the vehicle's next reading. */
  inReading: number | null;
  /** SERVER-derived, never client-supplied. */
  km: number | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Recording carries ONE reading (§4.3): it closes the previous open period and opens the next.
 * There is deliberately no `km` and no `inReading` input — both are derived.
 */
export const RecordFleetOdometerSchema = z
  .object({
    vehicleId: objectId(),
    date: z.coerce.date(),
    reading: z.number().int().min(0),
    driver1EmployeeId: objectId().nullish(),
    driver2EmployeeId: objectId().nullish(),
    notes: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict();
export type RecordFleetOdometer = z.infer<typeof RecordFleetOdometerSchema>;

/** `fleetOdometer.correct` only — an audited exception to the monotonic guard, not an edit. */
export const CorrectFleetOdometerSchema = z
  .object({
    outReading: z.number().int().min(0).optional(),
    inReading: z.number().int().min(0).nullish().optional(),
    date: z.coerce.date().optional(),
    driver1EmployeeId: objectId().nullish().optional(),
    driver2EmployeeId: objectId().nullish().optional(),
    notes: z.string().trim().min(1).max(1000).nullish().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type CorrectFleetOdometer = z.infer<typeof CorrectFleetOdometerSchema>;

/** H2's fate — the server, not the client, computes the next expected reading. */
export interface FleetExpectedReadingDto {
  vehicleId: string;
  /** null = the vehicle has no readings yet. */
  expectedReading: number | null;
  /**
   * The date of the READING THAT SET `expectedReading` — the same document, never another.
   *
   * Without it "this counter is below the chain" cannot be told apart from "this visit is being
   * entered for a date before the chain got there", and a workshop counter legitimately sits
   * below the floor on a back-dated visit. `null` exactly when `expectedReading` is null.
   *
   * Note it is the date of the highest reading, which is how the floor is chosen — not
   * necessarily the most recent one by date. That is the honest description of the value.
   */
  asOf: string | null;
}

export const FleetVehicleIdQuerySchema = z.object({ vehicleId: objectId() }).strict();
export type FleetVehicleIdQuery = z.infer<typeof FleetVehicleIdQuerySchema>;

/**
 * Where a workshop counter dated `on` would have to sit to be a point on the odometer chain.
 *
 * The maintenance visit's counters and `fleet_odometer_logs` are written by different endpoints
 * into different collections, and nothing links them — so "is this counter a reading of the same
 * instrument?" has never been answerable. It is answerable in ONE way that needs no new data: a
 * reading is monotonic in time, so a counter measured on day D must sit at or above everything
 * recorded on or before D, and at or below everything recorded after it.
 *
 *     lowerBound ≤ counter ≤ upperBound
 *
 * Both sides are `null` when that side of the chain is empty, and a `null` side simply does not
 * constrain — a car whose first ever reading comes after its service has no lower bound, and one
 * that has not been read since has no upper bound. Neither absence is suspicious.
 *
 * The dates come back beside the numbers because a bound without its date cannot be explained to
 * the person typing: "below the 59,800 recorded on 20 August" is actionable, "below 59,800" is a
 * riddle. Each date belongs to the very row its number came from.
 */
export interface FleetOdometerBracketDto {
  vehicleId: string;
  /** The date the bracket was computed FOR — echoed back, so a stale answer is recognisable. */
  on: string;
  /** Highest reading dated on or before `on`; `null` when the chain has none that early. */
  lowerBound: number | null;
  lowerBoundAt: string | null;
  /** Lowest reading dated after `on`; `null` when the chain has none that late. */
  upperBound: number | null;
  upperBoundAt: string | null;
}

/**
 * The bracket asks about a DATE as well as a vehicle: the same car has a different bracket for a
 * visit closed last month than for one closed today, which is exactly why a back-dated visit may
 * legitimately carry a counter far below where the chain has since reached.
 */
export const FleetOdometerBracketQuerySchema = z
  .object({ vehicleId: objectId(), on: z.coerce.date() })
  .strict();
export type FleetOdometerBracketQuery = z.infer<typeof FleetOdometerBracketQuerySchema>;

export const ListFleetOdometerQuerySchema = PaginationQuerySchema.extend({
  /** Single vehicle — kept because the vehicle profile links here with it. */
  vehicleId: objectId().optional(),
  /**
   * Several vehicles at once, BY CODE, because the code is what the registry calls a car and what
   * a shared link should read as. Resolution to ids happens server-side against the live registry,
   * so a code that no longer exists narrows to nothing rather than being ignored.
   */
  vehicleCodes: vehicleCodesQuery(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /**
   * The driver half of the filter bar, already resolved to ids.
   *
   * A driver's NAME is HR's fact, so the browser asks HR first and hands the answer here — the
   * same two-step join the drivers registry uses. A reading matches when the employee sits in
   * EITHER slot: asking "which days did this person drive?" must not miss the evening shift.
   */
  driverEmployeeIds: listQuery(objectId(), MAX_PAGE_SIZE),
  /**
   * Maintenance-alarm levels to keep. The level is DERIVED per vehicle (FR-3), so this narrows
   * the vehicles first and then the readings — the thresholds stay in settings, never here.
   */
  alerts: listQuery(FleetAlarmLevelSchema),
}).strict();
export type ListFleetOdometerQuery = z.infer<typeof ListFleetOdometerQuerySchema>;

// ── Maintenance alarm (FR-3 — derived, never stored) ────────────────────────

/** Query-time projection per vehicle; attached to odometer lists and the vehicle profile. */
/**
 * WHY a vehicle has no alarm figure — the guard that stopped `computeAlarm`, named.
 *
 * `level: 'none'` means two entirely different things: a car whose cycle was measured and found
 * healthy, and a car whose cycle could not be measured at all. Five separate conditions produce
 * the second, and every one of them used to reach the reader as the same word. This says which.
 *
 * `null` means the alarm WAS computed — including a computed `none`, which is a healthy car and
 * not a missing answer.
 */
export type FleetNoAlarmReason =
  /** The vehicle's TYPE has no maintenance interval, so there is no cycle to measure against. */
  | 'noInterval'
  /** The vehicle has no odometer reading at all. */
  | 'noReading'
  /** No closed, alarm-counting workshop visit yet — nothing to measure FROM. */
  | 'noService'
  /**
   * There is a service and a reading, but the reading predates the service: it describes the
   * cycle BEFORE the last one and says nothing about distance since.
   */
  | 'readingOlderThanService'
  /**
   * The reading is eligible in every other way, yet it sits BELOW the baseline it would be
   * measured from — so the subtraction would produce a negative distance travelled.
   *
   * That is not a distance; it is a sign that the two numbers are not readings of the same
   * counter (a mistyped exit reading, a replaced instrument, a workshop that wrote a trip meter).
   * A defensive integrity guard, and nothing more: it does NOT say which of the two is wrong, and
   * it does not make the baseline trustworthy — that remains a separate domain question.
   */
  | 'baselineAboveReading'
  /**
   * The baseline sits BELOW a reading the odometer chain already held on the service date.
   *
   * A counter measured when the car left the workshop cannot be lower than one recorded before it
   * left — an odometer does not run backwards. So this pair is not two readings of one instrument,
   * and the distance between them is not a distance. Reported ahead of `readingOlderThanService`
   * deliberately: waiting for a newer reading is a state that heals itself, and this one does not
   * — a fresh reading would only be subtracted from the same unusable baseline.
   *
   * It says the two numbers do not line up. It does NOT say which of them is untrue: the workshop
   * counter stays the authoritative record of what the workshop measured, and no rule here
   * replaces it with a chain reading.
   */
  | 'baselineBelowChain';

export interface FleetMaintenanceAlarmDto {
  vehicleId: string;
  code: string;
  level: FleetAlarmLevel;
  /** interval − (latest reading − reading at last alarm-counting service); null = no rule/data. */
  remainingKm: number | null;
  sinceServiceKm: number | null;
  lastServiceAt: string | null;
  /**
   * The VISIT that set the baseline — the last closed, alarm-counting workshop visit.
   *
   * `null` for exactly the reason `lastServiceAt` is: no such visit exists, so there is no cycle
   * to measure and no record to point at. Present so a reader looking at a remaining-km figure can
   * reach the service it is counted from, on any screen that shows the alarm.
   */
  lastServiceVisitId: string | null;
  /**
   * The guard that stopped the calculation, or `null` when it ran.
   *
   * The FIRST guard in `computeAlarm`'s own order, not every condition that happens to hold: it
   * names what actually stopped the arithmetic. Fixing it can reveal the next one, which is the
   * honest behaviour — the answer was never "one thing is missing", only "this is what stopped it".
   */
  noAlarmReason: FleetNoAlarmReason | null;
}

// ── Maintenance visits (§4.2) ───────────────────────────────────────────────

export interface FleetMaintenanceVisitDto {
  id: string;
  vehicleId: string;
  /**
   * The registry's code for that vehicle, resolved SERVER-side for the row — the same reason the
   * odometer log carries one: a client cannot resolve a code for a car outside the page of the
   * registry it happens to hold, so every car past that page would print a dash.
   *
   * `null` only when the vehicle no longer exists at all; a soft-deleted one keeps its code.
   */
  vehicleCode: string | null;
  /**
   * The DRIVER the vehicle came in with, chosen explicitly at check-in and STORED on the visit.
   *
   * Not read from the duty roster: the roster says who was planned to drive that day, which is a
   * different claim from who actually brought the car to the workshop, and it can be re-planned
   * afterwards. A visit records what happened.
   *
   * Required on every new visit; `null` only on visits written before the field existed.
   */
  driverInEmployeeId: string | null;
  /**
   * The DRIVER who took the vehicle away, chosen explicitly at check-out and stored.
   *
   * `null` while the visit is open — nobody has driven it away yet — and on visits closed before
   * the field existed. Reopening a visit clears it, as it clears the rest of the exit.
   */
  driverOutEmployeeId: string | null;
  inDate: string;
  /** null = in workshop (the open state). */
  outDate: string | null;
  workshopId: string;
  workTypeId: string;
  /**
   * Free-text parts, as visits recorded before the catalog existed carry them. READ-ONLY now:
   * nothing writes to it any more, and it is kept because those words are the only record of
   * what was fitted — a migration could only have matched them by name and dropped the rest.
   */
  spareParts: string[];
  /** Parts chosen from the `sparePart` catalog. The field new visits write. */
  sparePartIds: string[];
  /** The counter when the vehicle went IN. */
  odometerAtService: number;
  /**
   * The counter when it came OUT, recorded at check-out. `null` while the visit is open, and on
   * visits closed before this was collected.
   *
   * This is the maintenance BASELINE for a closed visit: the distance since a service is measured
   * from the reading the car left the workshop on, not the one it arrived on — the two differ by
   * whatever the workshop drove, and counting that against the next service shortens it.
   */
  exitOdometer: number | null;
  takenInByEmployeeId: string | null;
  takenOutByEmployeeId: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CheckInFleetMaintenanceSchema = z
  .object({
    vehicleId: objectId(),
    inDate: z.coerce.date(),
    workshopId: objectId(),
    workTypeId: objectId(),
    sparePartIds: z.array(objectId()).max(50).default([]),
    /**
     * DEPRECATED free text, still accepted so a caller written before the catalog existed is not
     * refused outright. Stored VERBATIM in the legacy field — never matched against the catalog,
     * because guessing which part a spelling meant is exactly the silent data loss this replaces.
     * The web form does not send it.
     */
    spareParts: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    odometerAtService: z.number().int().min(0),
    /**
     * Who drove the vehicle in. REQUIRED and explicit — the roster is a plan, and a plan is not
     * a record of who actually arrived.
     */
    driverInEmployeeId: objectId(),
    /**
     * Custody, and normally NOT sent: the server records whoever is logged in. Kept accepted for
     * the case the seam cannot answer — a platform account with no employee behind it — so the
     * fact stays recordable rather than silently lost. NOT the driver above.
     */
    takenInByEmployeeId: objectId().nullish(),
    notes: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict();
export type CheckInFleetMaintenance = z.infer<typeof CheckInFleetMaintenanceSchema>;

export const CheckOutFleetMaintenanceSchema = z
  .object({
    outDate: z.coerce.date(),
    /**
     * The counter the vehicle leaves on. REQUIRED, because it becomes the baseline every later
     * maintenance calculation measures from — a check-out without it would leave the next service
     * being counted from the arrival reading and falling due early.
     */
    exitOdometer: z.number().int().min(0),
    /** Who drove the vehicle away. REQUIRED, for the same reason the check-in driver is. */
    driverOutEmployeeId: objectId(),
    /** As on check-in: the server records the logged-in user; this is the fallback. */
    takenOutByEmployeeId: objectId().nullish(),
    version: z.number().int().min(0),
  })
  .strict();
export type CheckOutFleetMaintenance = z.infer<typeof CheckOutFleetMaintenanceSchema>;

/** Undo a mistaken check-out (legacy deleted_dock=5) — version-aware like every mutation. */
export const ReopenFleetMaintenanceSchema = z.object({ version: z.number().int().min(0) }).strict();
export type ReopenFleetMaintenance = z.infer<typeof ReopenFleetMaintenanceSchema>;

export const UpdateFleetMaintenanceSchema = z
  .object({
    inDate: z.coerce.date().optional(),
    workshopId: objectId().optional(),
    workTypeId: objectId().optional(),
    sparePartIds: z.array(objectId()).max(50).optional(),
    /** DEPRECATED, as on check-in — accepted, stored verbatim, never interpreted. */
    spareParts: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    odometerAtService: z.number().int().min(0).optional(),
    exitOdometer: z.number().int().min(0).nullish().optional(),
    /**
     * Correctable, like the rest of the check-in facts this endpoint edits. A required field with
     * no correction path turns one mistyped driver into a permanent one; the check-OUT driver is
     * deliberately not here, because changing it belongs to reopening and closing the visit again.
     */
    driverInEmployeeId: objectId().optional(),
    takenInByEmployeeId: objectId().nullish().optional(),
    notes: z.string().trim().min(1).max(1000).nullish().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFleetMaintenance = z.infer<typeof UpdateFleetMaintenanceSchema>;

export const ListFleetMaintenanceQuerySchema = PaginationQuerySchema.extend({
  vehicleId: objectId().optional(),
  /**
   * «حالة الصيانة» — the visit's ONE state: `true` = in the workshop (`outDate` null), `false` =
   * out of it.
   *
   * §4.2 gives the visit exactly two states, `open` ↔ `closed`, and §2.6 stores no status field
   * beside them — the legacy `deleted_dock` codes were deliberately left behind (§11). So "which
   * cars are in the workshop" and "which have come out" are the two halves of THIS field, not two
   * filters, and nothing here invents a third state.
   *
   * The derived ALARM level (FR-3) is a different subject entirely — a property of the VEHICLE,
   * not of a visit — and is deliberately not offered here as a maintenance "status".
   */
  open: booleanQuery().optional(),
  /** Several vehicles at once, BY CODE — resolved server-side against the live registry. */
  vehicleCodes: vehicleCodesQuery(),
  /**
   * Drivers, already resolved to employee ids by the caller — the same two-step join the odometer
   * uses, because a driver's NAME is HR's fact. A visit matches when the employee drove it in OR
   * drove it out: asking "which visits did this person drive" must not miss either end.
   */
  driverEmployeeIds: listQuery(objectId(), MAX_PAGE_SIZE),
  workshopId: objectId().optional(),
  workshopIds: listQuery(objectId()),
  workTypeId: objectId().optional(),
  workTypeIds: listQuery(objectId()),
  sparePartIds: listQuery(objectId()),
  /** Substring over the visit's own note. */
  notes: z.string().trim().min(1).max(100).optional(),
  /** Inclusive bounds on the counter the vehicle went in on. */
  odometerFrom: z.coerce.number().int().min(0).optional(),
  odometerTo: z.coerce.number().int().min(0).optional(),
  /** Check-IN date window. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Check-OUT date window — a different question from the one above, so a different pair. */
  outFrom: z.coerce.date().optional(),
  outTo: z.coerce.date().optional(),
}).strict();
export type ListFleetMaintenanceQuery = z.infer<typeof ListFleetMaintenanceQuerySchema>;

/**
 * An id, settled to its CANONICAL spelling at the boundary — shared by both assignment boards.
 *
 * An ObjectId is a NUMBER written in hex, and `objectId()` accepts either case. But every key the
 * services build from a document is `String(doc.field)`, which mongo always renders lowercase, so
 * the uppercase spelling of a vehicle is the SAME row to the database and a DIFFERENT string to a
 * `Map` key, a `Set`, or the duplicate checks below.
 *
 * That mismatch is not cosmetic. On the daily board it makes the existing-assignment lookup miss
 * (so an edit takes the insert branch), the FR-5 workshop guard miss (so an in-workshop vehicle
 * becomes assignable), and the FR-7 occupancy check miss (so one driver can be planned onto two
 * vehicles for one date). On the fixed board it produced a second crew row for one vehicle.
 *
 * Settling the spelling once, here, is what makes every string comparison after it sound. It is
 * declared above the first schema that uses it because a `const` read before its declaration is a
 * TDZ error at import time, not a compile-time complaint.
 */
const canonicalId = () => objectId().transform((id) => id.toLowerCase());

// ── Daily duty roster (§4.5) ────────────────────────────────────────────────

export interface FleetDutyAssignmentDto {
  id: string;
  vehicleId: string;
  date: string;
  missionTypeId: string | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** One board row: the assignment merged with the DERIVED vehicle-side facts. */
export interface FleetRosterRowDto {
  vehicleId: string;
  code: string;
  plateNumber: string;
  typeId: string;
  /** Derived §2.7/H5: an open maintenance visit covers the date — unassignable. */
  inMaintenance: boolean;
  /**
   * Does a `fleet_duty_assignment` EXIST for this (vehicle, date)?
   *
   * The one fact that says where the rest of this row came from. `true` — the stored day, read
   * back verbatim. `false` — nothing has been written for this vehicle on this date, so the row
   * is DERIVED from the standing crew and exists only in this response.
   *
   * It is on the wire because the difference is not cosmetic downstream: `operations/crew-board`
   * lists the day by iterating the duty documents, so a vehicle whose mission was only ever
   * derived is absent from it entirely. The board needs to know which of its rows are still
   * only a projection in order to offer to MATERIALISE them — otherwise "the dispatcher changed
   * nothing" and "there is nothing to save" look identical, and the operation quietly never
   * reaches Operations.
   */
  planned: boolean;
  missionTypeId: string | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  notes: string | null;
}

export interface FleetRosterDayDto {
  date: string;
  rows: FleetRosterRowDto[];
  /** Active driver profiles, split by availability on the date (§4.5 pool). */
  availableDrivers: { employeeId: string; assignedVehicleId: string | null }[];
  unavailableDrivers: { employeeId: string; reason: string }[];
}

export const PlanFleetRosterRowSchema = z
  .object({
    vehicleId: canonicalId(),
    missionTypeId: canonicalId().nullish(),
    driver1EmployeeId: canonicalId().nullish(),
    driver2EmployeeId: canonicalId().nullish(),
    notes: z.string().trim().min(1).max(500).nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.driver1EmployeeId != null &&
      value.driver2EmployeeId != null &&
      value.driver1EmployeeId === value.driver2EmployeeId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['driver2EmployeeId'],
        message: 'the two driver slots cannot hold the same person',
      });
    }
    // A second driver needs a first — the same rule the standing crew carries, for the same
    // reason. The slots are ORDERED: slot 1 is the crew's driver, slot 2 the second man beside
    // them, and `operations/crew-board` reads slot 1 as "the driver" of the day. A day holding
    // only a second driver therefore reaches Operations as a crewless vehicle with a real person
    // committed to it.
    //
    // Applied here as well as on the fixed crew because the daily row is what Operations
    // actually reads: leaving the rule on the standing crew alone would mean the record it
    // protects can still be created one day at a time.
    if (value.driver1EmployeeId == null && value.driver2EmployeeId != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['driver2EmployeeId'],
        message: 'a second driver needs a first — assign driver 1 before driver 2',
      });
    }
  });
export type PlanFleetRosterRow = z.infer<typeof PlanFleetRosterRowSchema>;

/** Upsert per (vehicle, date) — only CHANGED rows are sent (H4's fate). */
export const PlanFleetRosterSchema = z
  .object({
    date: z.coerce.date(),
    rows: z.array(PlanFleetRosterRowSchema).min(1).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seenVehicles = new Set<string>();
    const seenDrivers = new Set<string>();
    value.rows.forEach((row, index) => {
      if (seenVehicles.has(row.vehicleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', index, 'vehicleId'],
          message: 'a vehicle appears twice in one plan',
        });
      }
      seenVehicles.add(row.vehicleId);
      for (const driver of [row.driver1EmployeeId, row.driver2EmployeeId]) {
        if (driver == null) continue;
        if (seenDrivers.has(driver)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rows', index],
            message: 'a driver may hold one assignment per date (FR-7)',
          });
        }
        seenDrivers.add(driver);
      }
    });
  });
export type PlanFleetRoster = z.infer<typeof PlanFleetRosterSchema>;

export const FleetRosterQuerySchema = z.object({ date: z.coerce.date() }).strict();
export type FleetRosterQuery = z.infer<typeof FleetRosterQuerySchema>;

// ── Fixed crew (الطقم الثابت) ───────────────────────────────────────────────
//
// A DIFFERENT question from the daily roster above, and deliberately a different shape.
//
// The roster answers "who was planned on this vehicle on day D": its identity is the pair
// (vehicle, date), a driver's eligibility is `driverAvailabilityOn(D)`, and an open workshop
// visit covering D makes the vehicle unassignable. Every one of those facts is a fact ABOUT A
// DAY. The fixed crew answers "who is this vehicle's standing crew" — a fact about the vehicle,
// true until somebody changes it. So there is no date here, no mission, no notes, and no
// availability verdict: a driver on leave next Tuesday is still the car's fixed driver.
//
// The two exclusivity rules ARE shared, because they are not about days: the same person cannot
// hold both slots of one vehicle, and one driver belongs to one crew. They are re-stated below
// rather than imported, because a rule that reads the same in two places must be readable in
// both — but they are the same rules the roster enforces, not new ones.

/** One board row: the vehicle, plus whatever standing crew it carries. */
export interface FleetFixedCrewRowDto {
  vehicleId: string;
  code: string;
  plateNumber: string;
  typeId: string;
  /** Derived, shown for context only — a car in the workshop still HAS a fixed crew. */
  inMaintenance: boolean;
  /**
   * A `missionType` catalog item (أنواع المهمات), or null. The NAME is resolved by the client.
   *
   * The SAME vocabulary the daily roster's «نوع المهمة» points at — this is the dateless half of
   * that question ("what does this car normally run"), so it must not be a second list. It is
   * deliberately NOT `workType` (أنواع الأعمال), which is the workshop's vocabulary: that catalog
   * carries `countsForAlarm` and feeds maintenance visits, and a maintenance work type is not a
   * mission a crew is sent on.
   */
  missionTypeId: string | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  notes: string | null;
}

export interface FleetFixedRosterDto {
  rows: FleetFixedCrewRowDto[];
  /**
   * The pool: every ACTIVE driver profile, undivided.
   *
   * There is no unavailable half. `driverAvailabilityOn` answers a question about a DATE, and
   * this screen has none — so the pool is exactly the drivers the fleet has, each carrying the
   * vehicle it is already fixed to (or `null`), which is what a board needs to show a move.
   */
  drivers: { employeeId: string; assignedVehicleId: string | null }[];
}

export const SaveFleetFixedCrewRowSchema = z
  .object({
    vehicleId: canonicalId(),
    missionTypeId: canonicalId().nullish(),
    driver1EmployeeId: canonicalId().nullish(),
    driver2EmployeeId: canonicalId().nullish(),
    // `.min(1)` rather than allowing '': a note is either something or nothing, and nothing is
    // spelled `null` — the same shape every other note in this module uses, so "cleared" and
    // "never written" cannot drift apart into two different empty values.
    notes: z.string().trim().min(1).max(500).nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.driver1EmployeeId != null &&
      value.driver2EmployeeId != null &&
      value.driver1EmployeeId === value.driver2EmployeeId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['driver2EmployeeId'],
        message: 'the two driver slots cannot hold the same person',
      });
    }
    // The slots are ORDERED, not interchangeable. Slot 1 is the crew's driver and slot 2 is the
    // second man beside them, so a car carrying a second driver and no first is not a small
    // inconsistency — it is a crew that does not exist. It also reads as data corruption
    // downstream: every screen that shows "the driver" reads slot 1, so such a row appears
    // crewless while a real person is committed to it.
    //
    // Enforced HERE rather than only in the page because the rule is about the record, not the
    // form: an API client, an import, or a future screen must not be able to write the state the
    // board refuses to draw. Rows already stored this way keep parsing — nothing re-validates
    // them on read; the rule binds what is WRITTEN from here on.
    if (value.driver1EmployeeId == null && value.driver2EmployeeId != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['driver2EmployeeId'],
        message: 'a second driver needs a first — assign driver 1 before driver 2',
      });
    }
  });
export type SaveFleetFixedCrewRow = z.infer<typeof SaveFleetFixedCrewRowSchema>;

/**
 * Upsert per vehicle — only CHANGED rows are sent, exactly as a plan save does.
 *
 * That matters for moves: taking a driver off vehicle A and onto vehicle B changes BOTH rows,
 * so both travel, and the server sees a payload that is internally consistent. A payload that
 * claims a driver another row still holds is refused rather than silently duplicating them.
 */
export const SaveFleetFixedRosterSchema = z
  .object({ rows: z.array(SaveFleetFixedCrewRowSchema).min(1).max(500) })
  .strict()
  .superRefine((value, ctx) => {
    const seenVehicles = new Set<string>();
    const seenDrivers = new Set<string>();
    value.rows.forEach((row, index) => {
      if (seenVehicles.has(row.vehicleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', index, 'vehicleId'],
          message: 'a vehicle appears twice in one save',
        });
      }
      seenVehicles.add(row.vehicleId);
      for (const driver of [row.driver1EmployeeId, row.driver2EmployeeId]) {
        if (driver == null) continue;
        if (seenDrivers.has(driver)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rows', index],
            message: 'a driver belongs to one fixed crew',
          });
        }
        seenDrivers.add(driver);
      }
    });
  });
export type SaveFleetFixedRoster = z.infer<typeof SaveFleetFixedRosterSchema>;

// ── Accidents (§4.6) ────────────────────────────────────────────────────────

export const FLEET_ACCIDENT_STATUSES = ['open', 'closed'] as const;
export const FleetAccidentStatusSchema = z.enum(FLEET_ACCIDENT_STATUSES);
export type FleetAccidentStatus = z.infer<typeof FleetAccidentStatusSchema>;

export interface FleetAccidentDto {
  id: string;
  vehicleId: string;
  occurredAt: string;
  culprit: string;
  statement: string;
  companyCost: number;
  amountCollected: number;
  paidAmount: number;
  status: FleetAccidentStatus;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const accidentCore = {
  vehicleId: objectId(),
  occurredAt: z.coerce.date(),
  culprit: z.string().trim().min(1).max(200),
  statement: z.string().trim().min(1).max(2000),
  companyCost: egp(),
  amountCollected: egp(),
  paidAmount: egp(),
  notes: z.string().trim().min(1).max(1000).nullish(),
};

export const CreateFleetAccidentSchema = z.object(accidentCore).strict();
export type CreateFleetAccident = z.infer<typeof CreateFleetAccidentSchema>;

export const UpdateFleetAccidentSchema = z
  .object(accidentCore)
  .partial()
  .extend({ version: z.number().int().min(0) })
  .strict();
export type UpdateFleetAccident = z.infer<typeof UpdateFleetAccidentSchema>;

/** Open↔closed, both directions (legacy toggles; both audited + published). */
export const SetFleetAccidentStatusSchema = z
  .object({ status: FleetAccidentStatusSchema, version: z.number().int().min(0) })
  .strict();
export type SetFleetAccidentStatus = z.infer<typeof SetFleetAccidentStatusSchema>;

/**
 * The filters an accident list answers to — stated ONCE, so the page and its totals cannot drift.
 *
 * `code` and `vehicleId` are two independent narrowings of the same axis and are deliberately NOT
 * folded into one: a reader types part of a code to sweep, and picks one from the list to pin.
 * Sending both means BOTH apply (an AND) — picking `213` while searching `21` shows `213`, and
 * picking `213` while searching `15` shows nothing at all. Neither may override or silently
 * cancel the other, because a filter the screen shows as active and the server ignores is a lie
 * about what the reader is looking at.
 */
const accidentFilters = {
  /**
   * The cars named EXACTLY, ORed — resolved to ids against the registry, since an accident stores
   * its vehicle by id and never carries the code.
   *
   * This is the whole vehicle question on this screen. It replaced two controls that could ask
   * contradictory things at once: a dropdown naming one car AND a typed code naming another, which
   * intersected to an empty page the filter bar itself said was possible.
   */
  vehicleCodes: vehicleCodesQuery(),
  /** @deprecated Superseded by `vehicleCodes`; still honoured for saved links. */
  vehicleId: objectId().optional(),
  /**
   * Part of a vehicle CODE, matched case-insensitively. Resolved against the registry.
   *
   * @deprecated Superseded by `vehicleCodes`, which is exact. Still honoured for saved links.
   */
  code: z.string().trim().min(1).max(50).optional(),
  /** Part of the at-fault name, matched case-insensitively. */
  culprit: z.string().trim().min(1).max(200).optional(),
  status: FleetAccidentStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

export const ListFleetAccidentsQuerySchema = PaginationQuerySchema.extend(accidentFilters).strict();
export type ListFleetAccidentsQuery = z.infer<typeof ListFleetAccidentsQuerySchema>;

/**
 * The same filters, WITHOUT pagination — and that absence is the guarantee, not an omission.
 *
 * The totals below describe every accident the filters match, not the page in front of the
 * reader: a figure that changed when you turned the page would be a figure that means nothing.
 * Because this schema is `.strict()` and has no `page` or `pageSize`, paging cannot reach the
 * sum even by accident — the request carrying it would be refused.
 */
export const FleetAccidentSummaryQuerySchema = z.object(accidentFilters).strict();
export type FleetAccidentSummaryQuery = z.infer<typeof FleetAccidentSummaryQuerySchema>;

/** Sums over EVERY accident the filters match — never over one page. */
export interface FleetAccidentTotalsDto {
  count: number;
  amountCollected: number;
  companyCost: number;
  paidAmount: number;
  /** Derived, never stored: see `fleetAccidentRemaining`. */
  remaining: number;
}

/**
 * What an accident file still owes: «إجمالي المتبقي».
 *
 *   remaining = amountCollected + companyCost − paidAmount
 *
 * Derived on READ and stored NOWHERE. There is no column for it, no migration behind it, and no
 * second copy to fall out of step with the three facts it is made of — change one of them and the
 * figure follows on the next read.
 *
 * It lives in the contract because two places compute it — the row in the table and the sum under
 * it — and a formula written twice is a formula that will eventually be written two ways.
 *
 * ROUNDING IS PART OF THE ANSWER, not presentation. Money entered to the piastre still adds up in
 * binary floating point, where `0.1 + 0.2 - 0.3` is not zero, and a two-decimal rendering of that
 * residue is `-0.00` — a debt of nothing, printed with a minus sign. Rounding to the piastre here
 * settles it once, for the row and the total alike; and a result of zero is returned as POSITIVE
 * zero, because `Intl.NumberFormat` faithfully prints `-0` as "-0" and no reader has ever been
 * helped by that.
 */
export const fleetAccidentRemaining = (of: {
  amountCollected: number;
  companyCost: number;
  paidAmount: number;
}): number => {
  const rounded = Math.round((of.amountCollected + of.companyCost - of.paidAmount) * 100) / 100;
  // `=== 0` is true of -0 as well, so this is the one place negative zero is turned back.
  return rounded === 0 ? 0 : rounded;
};

// ── Violations (§4.7 — one collection, two shapes) ──────────────────────────

export const FLEET_VIOLATION_KINDS = ['vehicle', 'driver'] as const;
export const FleetViolationKindSchema = z.enum(FLEET_VIOLATION_KINDS);
export type FleetViolationKind = z.infer<typeof FleetViolationKindSchema>;

export interface FleetViolationDto {
  id: string;
  kind: FleetViolationKind;
  vehicleId: string;
  violationTypeId: string;
  /** SERVER-computed for `vehicle` rows (count × unitValue); entered for `driver` rows. */
  amount: number;
  /** vehicle shape */
  year: number | null;
  count: number | null;
  unitValue: number | null;
  /** driver shape */
  date: string | null;
  driverEmployeeId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Bulk yearly statement row (H8's fate: the YEAR is the fact — no synthesized date). */
export const RecordFleetVehicleViolationSchema = z
  .object({
    vehicleId: objectId(),
    year: z.number().int().min(2000).max(2100),
    violationTypeId: objectId(),
    count: z.number().int().min(1),
    unitValue: egp(),
    // no `amount`: FR-9 computes it server-side
  })
  .strict();
export type RecordFleetVehicleViolation = z.infer<typeof RecordFleetVehicleViolationSchema>;

export const RecordFleetDriverViolationSchema = z
  .object({
    vehicleId: objectId(),
    date: z.coerce.date(),
    driverEmployeeId: objectId(),
    violationTypeId: objectId(),
    amount: egp(),
  })
  .strict();
export type RecordFleetDriverViolation = z.infer<typeof RecordFleetDriverViolationSchema>;

export const UpdateFleetViolationSchema = z
  .object({
    violationTypeId: objectId().optional(),
    count: z.number().int().min(1).optional(),
    unitValue: egp().optional(),
    date: z.coerce.date().optional(),
    driverEmployeeId: objectId().optional(),
    amount: egp().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFleetViolation = z.infer<typeof UpdateFleetViolationSchema>;

/** One figure per (vehicle, year) — H9's fate: stored once, not stamped on every row. */
export const SetFleetGrievanceSchema = z
  .object({
    vehicleId: objectId(),
    year: z.number().int().min(2000).max(2100),
    totalBeforeGrievance: egp(),
  })
  .strict();
export type SetFleetGrievance = z.infer<typeof SetFleetGrievanceSchema>;

/** FL-6 additive: the stored grievance row, as the set/update endpoint answers. */
export interface FleetGrievanceDto {
  id: string;
  vehicleId: string;
  year: number;
  totalBeforeGrievance: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const ListFleetViolationsQuerySchema = PaginationQuerySchema.extend({
  kind: FleetViolationKindSchema.optional(),
  /**
   * The cars named EXACTLY, ORed — resolved to ids, as on accidents: a violation stores its
   * vehicle by id. A code no car carries narrows to nothing.
   */
  vehicleCodes: vehicleCodesQuery(),
  /** @deprecated Superseded by `vehicleCodes`; still honoured for saved links. */
  vehicleId: objectId().optional(),
  driverEmployeeId: objectId().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
}).strict();
export type ListFleetViolationsQuery = z.infer<typeof ListFleetViolationsQuerySchema>;

/** FL-6 additive: the rollup's axis is the YEAR; one vehicle optionally narrows it. */
export const FleetViolationRollupQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    vehicleId: objectId().optional(),
  })
  .strict();
export type FleetViolationRollupQuery = z.infer<typeof FleetViolationRollupQuerySchema>;

/** Annual rollup per (vehicle, year) — derived at query time (§2.9). */
export interface FleetViolationRollupDto {
  vehicleId: string;
  code: string;
  year: number;
  vehicleCount: number;
  vehicleAmount: number;
  driverCount: number;
  driverAmount: number;
  totalCount: number;
  totalAmount: number;
  totalBeforeGrievance: number;
}

// ── Events (ADR-008 `<module>.<entity>.<event>`) ────────────────────────────

export const FleetEvents = {
  VehicleCreated: 'fleet.vehicle.created',
  VehicleUpdated: 'fleet.vehicle.updated',
  VehicleStatusChanged: 'fleet.vehicle.statusChanged',

  // The license image is its own subject, not a vehicle field: its two facts are "a document
  // arrived" and "a document was withdrawn", and an automation wanting either would otherwise have
  // to diff `fleet.vehicle.updated` payloads to find them.
  VehicleLicenseImageUploaded: 'fleet.vehicleLicenseImage.uploaded',
  VehicleLicenseImageDeleted: 'fleet.vehicleLicenseImage.deleted',

  // The driver's licence scan, for the same reason: "a licence document arrived / was withdrawn"
  // is a fact a compliance automation wants without diffing profile updates.
  DriverLicenseImageUploaded: 'fleet.driverLicenseImage.uploaded',
  DriverLicenseImageDeleted: 'fleet.driverLicenseImage.deleted',

  OdometerRecorded: 'fleet.odometer.recorded',
  OdometerCorrected: 'fleet.odometer.corrected',

  MaintenanceCheckedIn: 'fleet.maintenance.checkedIn',
  MaintenanceCheckedOut: 'fleet.maintenance.checkedOut',
  MaintenanceReopened: 'fleet.maintenance.reopened',
  MaintenanceAlarmRaised: 'fleet.maintenanceAlarm.raised',

  VehicleLicenseExpiring: 'fleet.vehicleLicense.expiring',
  VehicleLicenseExpired: 'fleet.vehicleLicense.expired',
  DriverLicenseExpiring: 'fleet.driverLicense.expiring',
  DriverLicenseExpired: 'fleet.driverLicense.expired',

  RosterPlanned: 'fleet.roster.planned',
  AssignmentChanged: 'fleet.assignment.changed',

  UnavailabilityRecorded: 'fleet.driverUnavailability.recorded',
  UnavailabilityEnded: 'fleet.driverUnavailability.ended',

  AccidentRecorded: 'fleet.accident.recorded',
  AccidentClosed: 'fleet.accident.closed',
  AccidentReopened: 'fleet.accident.reopened',

  ViolationRecorded: 'fleet.violation.recorded',
  GrievanceApplied: 'fleet.violation.grievanceApplied',
} as const;
export type FleetEventName = (typeof FleetEvents)[keyof typeof FleetEvents];

export const FleetVehicleEventPayloadV1 = z.object({
  vehicleId: objectId(),
  code: z.string(),
  typeId: objectId(),
});

export const FleetVehicleLicenseImagePayloadV1 = z.object({
  vehicleId: objectId(),
  code: z.string(),
  /** null on deletion — the file is gone, and the event says which vehicle lost it. */
  fileId: objectId().nullable(),
});

export const FleetDriverLicenseImagePayloadV1 = z.object({
  driverProfileId: objectId(),
  /** The HR employee the profile extends — the join key every consumer already speaks. */
  employeeId: objectId(),
  /** null on deletion — the file is gone, and the event says which driver lost it. */
  fileId: objectId().nullable(),
});

export const FleetVehicleStatusChangedPayloadV1 = z.object({
  vehicleId: objectId(),
  code: z.string(),
  from: FleetVehicleStatusSchema,
  to: FleetVehicleStatusSchema,
  reason: z.string().nullable(),
});

export const FleetOdometerRecordedPayloadV1 = z.object({
  vehicleId: objectId(),
  code: z.string(),
  logId: objectId(),
  outReading: z.number().int(),
  /** km of the period this reading CLOSED; null when it opened the vehicle's first period. */
  closedKm: z.number().int().nullable(),
});

export const FleetOdometerCorrectedPayloadV1 = z.object({
  vehicleId: objectId(),
  logId: objectId(),
  field: z.string(),
  old: z.string().nullable(),
  new: z.string().nullable(),
});

export const FleetMaintenancePayloadV1 = z.object({
  visitId: objectId(),
  vehicleId: objectId(),
  code: z.string(),
  workshopId: objectId(),
  workTypeId: objectId(),
  odometerAtService: z.number().int(),
});

export const FleetMaintenanceAlarmPayloadV1 = z.object({
  vehicleId: objectId(),
  code: z.string(),
  level: z.enum(['yellow', 'red']),
  remainingKm: z.number().int(),
});

export const FleetLicenseExpiryPayloadV1 = z.object({
  /** vehicleId for vehicle-license events, employeeId for driver-license events. */
  subjectId: objectId(),
  code: z.string(),
  expiresAt: z.coerce.date(),
});

export const FleetRosterPlannedPayloadV1 = z.object({
  date: z.coerce.date(),
  changedCount: z.number().int().min(0),
});

export const FleetAssignmentChangedPayloadV1 = z.object({
  vehicleId: objectId(),
  code: z.string(),
  date: z.coerce.date(),
  missionTypeId: objectId().nullable(),
  driver1EmployeeId: objectId().nullable(),
  driver2EmployeeId: objectId().nullable(),
});

export const FleetUnavailabilityPayloadV1 = z.object({
  employeeId: objectId(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  reason: z.string(),
});

export const FleetAccidentPayloadV1 = z.object({
  accidentId: objectId(),
  vehicleId: objectId(),
  code: z.string(),
  companyCost: z.number(),
  amountCollected: z.number(),
  paidAmount: z.number(),
});

export const FleetViolationRecordedPayloadV1 = z.object({
  violationId: objectId(),
  kind: FleetViolationKindSchema,
  vehicleId: objectId(),
  driverEmployeeId: objectId().nullable(),
  year: z.number().int().nullable(),
  amount: z.number(),
});

export const FleetGrievanceAppliedPayloadV1 = z.object({
  vehicleId: objectId(),
  year: z.number().int(),
  totalBeforeGrievance: z.number(),
});

// ── Files categories (platform Files; additive over legacy) ─────────────────

export const FLEET_VEHICLE_FILE_CATEGORY = 'fleet-vehicle-documents';
export const FLEET_DRIVER_FILE_CATEGORY = 'fleet-driver-documents';
export const FLEET_ACCIDENT_FILE_CATEGORY = 'fleet-accident-attachments';
export const FLEET_VIOLATION_FILE_CATEGORY = 'fleet-violation-attachments';

// ── Declared settings (owner principle 4 — nothing threshold-like hardcoded) ─

export const FleetSettingKeys = {
  /** Remaining-km threshold that turns the maintenance alarm yellow. */
  AlarmYellowKm: 'fleet.alarm.yellowKm',
  /** Remaining-km threshold that turns it red. */
  AlarmRedKm: 'fleet.alarm.redKm',
  /** Availability also consults HR leave (§13-Q1 — owner: yes; fleet adds only the daily operational overlay). */
  UseHrLeave: 'fleet.availability.useHrLeave',
  /** Days before vehicle-license expiry that `fleet.vehicleLicense.expiring` fires. */
  VehicleLicenseWarnDays: 'fleet.license.vehicleWarnDays',
  /** Days before driver-license expiry that `fleet.driverLicense.expiring` fires. */
  DriverLicenseWarnDays: 'fleet.license.driverWarnDays',
  /**
   * The branch the new-vehicle form preselects, BY NAME — resolved against live branch data on
   * every request. A name rather than an id because ids are environment-specific: the same default
   * has to work in dev, staging and production without a per-environment code change.
   */
  DefaultBranchName: 'fleet.vehicle.defaultBranchName',
} as const;
export type FleetSettingKey = (typeof FleetSettingKeys)[keyof typeof FleetSettingKeys];

// ── Notification template keys (seeded at boot by the module) ───────────────

export const FleetTemplates = {
  MaintenanceDue: 'fleet.maintenanceDue',
  VehicleLicenseExpiring: 'fleet.vehicleLicenseExpiring',
  DriverLicenseExpiring: 'fleet.driverLicenseExpiring',
  RosterPlanned: 'fleet.rosterPlanned',
} as const;
export type FleetTemplateKey = (typeof FleetTemplates)[keyof typeof FleetTemplates];
