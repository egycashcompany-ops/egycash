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

export const ListFleetVehiclesQuerySchema = PaginationQuerySchema.extend({
  status: FleetVehicleStatusSchema.optional(),
  /** The vehicle TYPE is the make/model the registry knows (اختر الماركة). */
  typeId: objectId().optional(),
  branchId: listQuery(objectId()),
  /** Substring match across code/plate/chassis/motor at once. */
  search: z.string().trim().min(1).max(100).optional(),
  // Per-identifier filters, ANDed with each other and with `search`: narrowing by plate AND
  // chassis is a different question from searching either, and the list page asks both.
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
}

export const FleetVehicleIdQuerySchema = z.object({ vehicleId: objectId() }).strict();
export type FleetVehicleIdQuery = z.infer<typeof FleetVehicleIdQuerySchema>;

export const ListFleetOdometerQuerySchema = PaginationQuerySchema.extend({
  /** Single vehicle — kept because the vehicle profile links here with it. */
  vehicleId: objectId().optional(),
  /**
   * Several vehicles at once, BY CODE, because the code is what the registry calls a car and what
   * a shared link should read as. Resolution to ids happens server-side against the live registry,
   * so a code that no longer exists narrows to nothing rather than being ignored.
   */
  vehicleCodes: listQuery(z.string().trim().min(1).max(20)),
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
export interface FleetMaintenanceAlarmDto {
  vehicleId: string;
  code: string;
  level: FleetAlarmLevel;
  /** interval − (latest reading − reading at last alarm-counting service); null = no rule/data. */
  remainingKm: number | null;
  sinceServiceKm: number | null;
  lastServiceAt: string | null;
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
  vehicleCodes: listQuery(z.string().trim().min(1).max(20)),
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
    vehicleId: objectId(),
    missionTypeId: objectId().nullish(),
    driver1EmployeeId: objectId().nullish(),
    driver2EmployeeId: objectId().nullish(),
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
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
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
    vehicleId: objectId(),
    driver1EmployeeId: objectId().nullish(),
    driver2EmployeeId: objectId().nullish(),
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

export const ListFleetAccidentsQuerySchema = PaginationQuerySchema.extend({
  vehicleId: objectId().optional(),
  status: FleetAccidentStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict();
export type ListFleetAccidentsQuery = z.infer<typeof ListFleetAccidentsQuerySchema>;

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
