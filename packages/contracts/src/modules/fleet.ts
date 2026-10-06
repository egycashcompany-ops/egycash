// Fleet module contracts (docs/12-planning/fleet-module-design.md, FROZEN v1.0).
//
// The legacy system informed the DOMAIN here, never the shapes: everything derivable (km, alarm
// level, "in workshop", "current driver") is absent from stored DTOs on purpose — FR-12 makes
// derived facts query-time facts, and a field that does not exist cannot go stale.
import { z } from 'zod';
import { LocalizedStringSchema, type LocalizedString } from '../common/localized.js';
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
  // Three kinds for the DRIVERS registry, and they are catalogs for the reason the nine above
  // are: «سائق أ» and «صراف الى» are grades a house invents and renames, «سزوكى» is a vehicle
  // class somebody adds the week the first one arrives, and «اولى»/«تانيه» are the licence
  // classes the authority issues. Each of the three used to be — or was about to become — a
  // literal array inside the drivers screen, where adding a value needs a release.
  'driverJob',
  'driverSpecialization',
  'driverLicenseType',
] as const;
export const FleetCatalogKindSchema = z.enum(FLEET_CATALOG_KINDS);
export type FleetCatalogKind = z.infer<typeof FleetCatalogKindSchema>;

/**
 * Which half of the violations screen a violation TYPE belongs to.
 *
 * The two halves are two ledgers, not one filtered twice: «الانتظار في الممنوع» is something the
 * company pays and «سرعة» is something a driver pays, and neither belongs in the other's form.
 * That split used to live only as a comment beside the seed, so both entry forms offered all
 * seven types and nothing stopped a company fine being filed against a driver.
 *
 * It is a property of the TYPE, held in the admin's own catalog, because the house decides what
 * it fines drivers for — a list compiled into the client would need a release to change.
 */
export const FLEET_VIOLATION_SIDES = ['company', 'driver'] as const;
export const FleetViolationSideSchema = z.enum(FLEET_VIOLATION_SIDES);
export type FleetViolationSide = z.infer<typeof FleetViolationSideSchema>;

export interface FleetCatalogItemDto {
  id: string;
  kind: FleetCatalogKind;
  name: { ar: string; en: string };
  /** `workType` only: closing a visit of this type resets the maintenance-alarm baseline. */
  countsForAlarm: boolean;
  /** `violationType` only: which half of the violations screen offers it. Null elsewhere. */
  violationSide: FleetViolationSide | null;
  isActive: boolean;
  /**
   * Where the item sits in its list — «اقدر ارتبهم عن طريق الشد والترك». Every list of this kind,
   * on this screen and in every Fleet dropdown, reads in this order. `null` until the list has
   * been arranged once; such items read by name.
   */
  sortOrder: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * PUT /fleet/catalog-items/order — one list of one kind, in the order it was dragged into. Items
 * of the kind left out keep their relative order after the ones named.
 */
export const OrderFleetCatalogSchema = z
  .object({
    kind: FleetCatalogKindSchema,
    ids: z
      .array(objectId())
      .min(1)
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'An item is listed twice' }),
  })
  .strict();
export type OrderFleetCatalog = z.infer<typeof OrderFleetCatalogSchema>;

export const CreateFleetCatalogItemSchema = z
  .object({
    kind: FleetCatalogKindSchema,
    name: LocalizedStringSchema,
    countsForAlarm: z.boolean().default(false),
    violationSide: FleetViolationSideSchema.optional(),
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
    // A violation type with no side would be offered by neither form — invisible rather than
    // merely unclassified — so it is required exactly where it means something, and refused
    // everywhere else for the same reason `countsForAlarm` is.
    if (value.kind === 'violationType' && value.violationSide === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['violationSide'],
        message: 'a violationType must say which half of the screen files it',
      });
    }
    if (value.kind !== 'violationType' && value.violationSide !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['violationSide'],
        message: 'only a violationType has a side',
      });
    }
  });
export type CreateFleetCatalogItem = z.infer<typeof CreateFleetCatalogItemSchema>;

export const UpdateFleetCatalogItemSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    countsForAlarm: z.boolean().optional(),
    violationSide: FleetViolationSideSchema.optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFleetCatalogItem = z.infer<typeof UpdateFleetCatalogItemSchema>;

// ── Sorting by SEVERAL columns at once (Fleet tables) ───────────────────────
//
// «لو دوس على انتهاء الترخيص هيلغى اللى كنت عامله فى الكود ... انا عاوز اقدر اعمل الاتنين مع بعض».
// A registry of two hundred cars is read by more than one question at a time — the licences that
// lapse first, and within a day, by car code — and a sort that can only hold one column answers
// half of it and throws the other half away on the next click.
//
// ONE STRING, `code:asc,licenseExpiresAt:desc`, in the order the reader clicked. It is the same
// string the browser already keeps in `?sort=`, so the address bar, the request and the server's
// `.sort()` all say the same thing, and a link somebody sends a colleague carries the whole order
// rather than its first column.
//
// `sortBy` / `sortDir` stay exactly as they were, and every screen still sends them: they are the
// platform's pagination contract, every other module uses them, and a Fleet request that reached
// an older API would still come back sorted by the reader's FIRST column instead of by nothing.

/** As many columns as a table has room to show a precedence badge for. */
export const FLEET_SORT_MAX = 4;

export interface FleetSortEntry {
  by: string;
  dir: 'asc' | 'desc';
}

/** A field name, as the wire may spell it — `code`, `name.ar`. Nothing exotic reaches a query. */
const SORT_FIELD = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;

/** The `sort=` parameter itself. Bounded, because it is a string a stranger can type. */
export const fleetSortQuery = () => z.string().trim().max(200).optional();

/**
 * `code:asc,licenseExpiresAt:desc` → the columns, in order.
 *
 * FORGIVING, because this comes off an address bar a person can edit: junk entries are dropped
 * rather than failing the request, a missing direction reads as ascending, a column named twice
 * keeps its first place, and the list is capped. What survives is still checked against the
 * collection's own sortable fields on the way to the database — this only decides what is
 * well-formed, never what is allowed.
 */
export const parseFleetSort = (raw: string | null | undefined): FleetSortEntry[] => {
  if (raw === null || raw === undefined) return [];
  const entries: FleetSortEntry[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(',')) {
    const [field, direction] = piece.trim().split(':');
    const by = (field ?? '').trim();
    if (by === '' || !SORT_FIELD.test(by) || seen.has(by)) continue;
    seen.add(by);
    entries.push({ by, dir: direction?.trim() === 'desc' ? 'desc' : 'asc' });
    if (entries.length === FLEET_SORT_MAX) break;
  }
  return entries;
};

/** The columns, back into one parameter. Empty → `null`: nothing to put in the address bar. */
export const formatFleetSort = (entries: readonly FleetSortEntry[]): string | null =>
  entries.length === 0 ? null : entries.map((entry) => `${entry.by}:${entry.dir}`).join(',');

export const ListFleetCatalogQuerySchema = PaginationQuerySchema.extend({
  /** Several columns at once — see `parseFleetSort`. `sortBy`/`sortDir` still carry the first. */
  sort: fleetSortQuery(),
  kind: FleetCatalogKindSchema.optional(),
  /** Narrows `violationType` to one half's own list — the company form, or the drivers' bar. */
  violationSide: FleetViolationSideSchema.optional(),
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

/**
 * A licence class is a traffic unit and a letter — «برقاش م», «العجوزة ت» — and the letter moves
 * with the expiry date: «لو غير فئة الترخيص من ت ل م او م ل ت … لازم يعدل تاريخ انتهاء الترخيص».
 * The class's letter is its last word, «م» or «ت»; `null` for a class without one.
 */
/** A `YYYY-MM` month, as the vehicles screen's licence-expiry filter sends it. */
export const FLEET_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u;

/** A `YYYY-MM` month as its first and last instant (UTC, as the licence dates are stored). */
export const fleetMonthWindow = (month: string): { from: Date; before: Date } | null => {
  if (!FLEET_MONTH_PATTERN.test(month)) return null;
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  return {
    from: new Date(Date.UTC(year, index, 1)),
    before: new Date(Date.UTC(year, index + 1, 1) - 1),
  };
};

export const fleetLicenseLetter = (name: string): 'م' | 'ت' | null => {
  const last = name.trim().split(/\s+/u).at(-1);
  return last === 'م' || last === 'ت' ? last : null;
};

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

/** Lifecycle §4.1: reason is REQUIRED when leaving `active`; a `disposed` car returns to `active`. */
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
  const parts = Array.isArray(raw)
    ? (raw as readonly string[])
    : String(raw).split(CODE_SEPARATORS);
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

/**
 * The registry query a VEHICLE-CODE selector asks — code only, and nothing else.
 *
 * Every control in the application whose job is to pick or filter A CAR asks by the code: the
 * multi-select on the six filtered fleet screens, the pickers in the odometer and maintenance
 * dialogs, and Gold's receiving picker. They all send this, so "what does a vehicle-code box
 * search?" has ONE answer written down once, in the same file as the parser that reads the box.
 *
 * It is `code` and not `search` because those are different questions. `search` is the registry
 * page's own box, deliberately spanning code, plate, chassis and motor at once — right for
 * BROWSING the registry, wrong for a control labelled with the code, where a plate number matching
 * some other car offers that car under a heading that says its code. A reader who ticks it filters
 * by a car they never asked for and cannot see why it was offered.
 *
 * The trailing fragment of a typed list arrives here (`readTypedVehicleCodes` takes the completed
 * codes out first), so an empty or whitespace term is normal and asks for no narrowing at all.
 */
export const vehicleCodeSearchQuery = (term: string): { code?: string } => {
  const code = term.trim();
  return code === '' ? {} : { code };
};

export const ListFleetVehiclesQuerySchema = PaginationQuerySchema.extend({
  /** Several columns at once — see `parseFleetSort`. `sortBy`/`sortDir` still carry the first. */
  sort: fleetSortQuery(),
  /**
   * SEVERAL STATUSES AT ONCE, ORed — «اى فلتر ف الحركه زياده عن اتنين اختار ما بينهم».
   *
   * «المتاحة والمتوقفة، من غير المكهّنة» is one question about the fleet, and a single-value
   * parameter made the reader ask it twice and add the two pages up by hand. The list shape is
   * the platform's own (`listQuery` — a comma-separated string or a repeated parameter), so a
   * link carrying one status still means exactly one status and every saved link keeps working.
   */
  status: listQuery(FleetVehicleStatusSchema),
  /** The vehicle TYPE is the make/model the registry knows (اختر الماركة). Several, ORed. */
  typeId: listQuery(objectId()),
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
   * Substring over the CODE alone — what every vehicle-code selector searches.
   *
   * The sibling of `vehicleCodes` rather than a leftover of it: that one is the EXACT cars a set
   * of ticked checkboxes names, this one is the substring a half-typed code is still matching. A
   * picker needs both — it narrows the offered list with `code` as the operator types, and filters
   * the page with `vehicleCodes` once they tick. Build it with `vehicleCodeSearchQuery`.
   *
   * Distinct from `search`, which spans four identifiers at once and belongs to the registry page.
   */
  code: identifierFilter(),
  plateNumber: identifierFilter(),
  chassisNumber: identifierFilter(),
  motorNumber: identifierFilter(),
  // The three catalog references, each taking SEVERAL ids ORed within itself and ANDed with the
  // others: «فئة الرخصة: أ أو ب» narrows to two classes, and asking it beside «التشغيل» still
  // means both questions at once.
  licenseClassId: listQuery(objectId()),
  operationId: listQuery(objectId()),
  insuranceCompanyId: listQuery(objectId()),
  /**
   * The licence-expiry window — «تاريخ انتهاء الترخيص … أقدر أختار شهر فى سنه معينه». The screen
   * sends one month as its first instant (`From`) and its last (`Before`); either bound alone is
   * an ordinary question too.
   */
  licenseExpiresFrom: z.coerce.date().optional(),
  licenseExpiresBefore: z.coerce.date().optional(),
  /**
   * Several months at once — «أختار أكتر من شهر»: `?licenseExpiryMonths=2026-11,2027-01`. A car
   * matches when its licence runs out in ANY of them.
   */
  licenseExpiryMonths: listQuery(z.string().regex(FLEET_MONTH_PATTERN)),
}).strict();
export type ListFleetVehiclesQuery = z.infer<typeof ListFleetVehiclesQuerySchema>;

// ── Driver profiles (FR-11 — fleet-owned facts about an HR employee) ────────

/**
 * The LEGACY specialization enum, kept for the rows that carry it and for nothing else.
 *
 * «التخصص» is a `driverSpecialization` CATALOG now — «نقل اموال», «ملاكى», «ATM», «سزوكى», and
 * whatever else the house adds — because three values compiled into the client could not express
 * the fourth. The enum stays readable so no stored profile loses a fact and the dashboard's
 * cash/ATM split keeps answering for a profile nobody has re-classified yet; nothing writes it.
 */
export const FLEET_DRIVER_SPECIALIZATIONS = ['cashTransport', 'atm', 'both'] as const;
export const FleetDriverSpecializationSchema = z.enum(FLEET_DRIVER_SPECIALIZATIONS);
export type FleetDriverSpecialization = z.infer<typeof FleetDriverSpecializationSchema>;

export interface FleetDriverProfileDto {
  id: string;
  employeeId: string;
  /** null = not on file yet. See `CreateFleetDriverProfileSchema` for why that is a legal state. */
  licenseNumber: string | null;
  /** null = not on file yet — the profile is neither «expiring» nor «valid», it is unjudgeable. */
  licenseExpiresAt: string | null;
  /**
   * «الوظيفة» — a `driverJob` catalog reference (سائق أ / سائق ب / سائق ج / سائق صراف الى).
   *
   * FLEET'S OWN FACT, and not the HR job title: HR's seat says «سائق» and decides who is on this
   * registry at all (`requiresDrivingTest`); this says which driving grade the house runs them
   * as, which is a Fleet decision the house renames without an HR personnel action.
   */
  jobId: string | null;
  /** «التخصص» — a `driverSpecialization` catalog reference. Null until somebody classifies them. */
  specializationId: string | null;
  /** «الرخصة» — a `driverLicenseType` catalog reference (اولى / تانيه / …). */
  licenseTypeId: string | null;
  /** LEGACY. Read-only, never written; see `FLEET_DRIVER_SPECIALIZATIONS`. */
  specialization: FleetDriverSpecialization | null;
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

// The three catalog references are NULLISH rather than required, and deliberately so: a driver is
// on the registry because of their seat, and their licence gets written down long before anybody
// decides which grade they drive at. Refusing the record until all three are chosen would put the
// screen back where it started — a registry that stays empty because enrolment is too heavy.
export const CreateFleetDriverProfileSchema = z
  .object({
    employeeId: objectId(),
    /**
     * BOTH OPTIONAL — «عاوز كل البيانات الموجوده دى اختيارى».
     *
     * A driver reaches this registry because of their SEAT, not their licence: the person is on
     * the roster on their first day and the paperwork follows. Requiring the licence to enrol them
     * meant the clerk either waited — leaving a working driver off every board — or typed a
     * placeholder, which is worse, because a made-up number is indistinguishable from a real one.
     *
     * `null` is a fact here, not a gap in the record: it says «we have not been given this yet».
     * Every reader treats it that way — a profile with no expiry is not reported as expiring, and
     * not reported as valid either; it simply cannot be judged on a date nobody has.
     */
    licenseNumber: z.string().trim().min(1).max(60).nullish(),
    licenseExpiresAt: z.coerce.date().nullish(),
    jobId: objectId().nullish(),
    specializationId: objectId().nullish(),
    licenseTypeId: objectId().nullish(),
    area: z.string().trim().min(1).max(120).nullish(),
  })
  .strict();
export type CreateFleetDriverProfile = z.infer<typeof CreateFleetDriverProfileSchema>;

export const UpdateFleetDriverProfileSchema = z
  .object({
    licenseNumber: z.string().trim().min(1).max(60).optional(),
    licenseExpiresAt: z.coerce.date().optional(),
    jobId: objectId().nullish().optional(),
    specializationId: objectId().nullish().optional(),
    licenseTypeId: objectId().nullish().optional(),
    area: z.string().trim().min(1).max(120).nullish().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFleetDriverProfile = z.infer<typeof UpdateFleetDriverProfileSchema>;

// What is filterable here is what FLEET holds — its own profile fields, plus the two facts the
// directory seam already hands it about each driver (who they are, and their branch). Name,
// employee code, address, governorate and phone are HR's, read by the browser from HR's own API
// with HR's own permission and arriving here as `employeeIds`. Filtering a fleet-paginated list
// on them would mean Fleet querying HR's collection — the one thing the module hierarchy forbids.
/**
 * A row on the drivers registry: a DRIVER, and what Fleet knows about them so far.
 *
 * WHO IS A DRIVER IS THE ORG CHART, not a list Fleet keeps. It is every employed person whose job
 * title requires a driving test — `requiresDrivingTest`, the flag the job-title form calls "the
 * single place driver-ness is decided" and recruitment already reads to decide which documents a
 * candidate is asked for. Fleet asks the same flag, so a driver hired this morning is on the
 * registry this morning.
 *
 * Before this, membership WAS the profile: a row existed only if somebody had created one, and the
 * only thing that could create one was an endpoint no screen called. So the registry showed
 * nothing however many drivers the company hired — the failure this shape removes.
 *
 * `profile` is therefore nullable, and null means "nothing recorded yet", never "carries nothing":
 * the licence number and its expiry are facts Fleet is the authority on and nobody has filled in.
 * Inventing them would file three made-up facts about a real person, so the row says so instead.
 */
export interface FleetDriverRowDto {
  /** The person. HR's facts about them are read by the browser, under HR's own permission (FR-11). */
  employeeId: string;
  /** What Fleet knows: licence, expiry, specialization, area, scan. null until somebody records it. */
  profile: FleetDriverProfileDto | null;
}

export const ListFleetDriversQuerySchema = PaginationQuerySchema.extend({
  /** Several columns at once — see `parseFleetSort`. `sortBy`/`sortDir` still carry the first. */
  sort: fleetSortQuery(),
  /**
   * «الفرع» — filtered HERE, on the roster Fleet already holds.
   *
   * It used to be part of the HR two-step, and there it could not work. That step asks HR for the
   * matching employees and may carry ONE page of them (`MAX_PAGE_SIZE`) — but a branch's employees
   * are its whole payroll, drivers and everybody else, so any real branch matched more than a page
   * and the screen answered «narrow your filter» and filtered nothing. There was no narrowing that
   * would have helped: the filter's own subject was what overflowed.
   *
   * Fleet does not have to ask. The roster arrives from the directory seam with each driver's
   * branch already on it — the same seam, the same fact, and only drivers — so the branch is
   * matched against the rows in hand. No page limit is involved, because no page is fetched.
   */
  branchId: listQuery(objectId()),
  // The three catalog references, each SEVERAL ids ORed within itself — «سائق أ أو سائق ب» is one
  // question about the registry, and the single-value parameter made it two.
  /** «الوظيفة» — `driverJob` catalog ids. */
  jobId: listQuery(objectId()),
  /** «التخصص» — `driverSpecialization` catalog ids. */
  specializationId: listQuery(objectId()),
  /** «الرخصة» — `driverLicenseType` catalog ids. */
  licenseTypeId: listQuery(objectId()),
  /** LEGACY, for the rows still classified by the enum. No screen sends it. */
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
   * Address, governorate and phone are HR's facts, and HR's own list endpoint filters on them.
   * The browser asks HR first and hands the answer here — two server-side queries joined by id,
   * which is how the drivers table already reads HR names. The alternative, Fleet querying HR's
   * collection, is the one thing the module hierarchy forbids.
   *
   * It also carries the drivers a reader PICKED BY NAME from the filter bar's multi-select. That
   * needs no HR page at all: the selection is already a list of ids, and it is intersected with
   * the HR match rather than replacing it, so «سائق أحمد, in Maadi» asks both questions.
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
  /** Several columns at once — see `parseFleetSort`. `sortBy`/`sortDir` still carry the first. */
  sort: fleetSortQuery(),
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
  /**
   * `null` for a reading brought across from the old book on a car the registry never had —
   * «194», «تويوتا1». The row is kept because the company refers back to it; the car is not
   * invented. `vehicleCode` then carries the code the book wrote.
   */
  vehicleId: string | null;
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
   * history stays readable. For a row with no `vehicleId` it is the code the old book wrote.
   */
  vehicleCode: string | null;
  date: string;
  /**
   * `null` = A DAY RECORDED WITH NO READING — «سيبوا فاضى». A day missed between two readings can
   * be recorded for who drove it without a counter nobody wrote down. Such a row is on no chain:
   * `inReading` and `km` are null too, nothing is measured from it, and the maintenance alarm
   * counts it so the distance it reports is not read as the whole truth.
   */
  outReading: number | null;
  /** null = the OPEN period; closed by the vehicle's next reading. */
  inReading: number | null;
  /** SERVER-derived, never client-supplied. */
  km: number | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  /**
   * The driver's NAME as the old book wrote it, kept only where HR has no employee for the
   * spelling — a driver who was there and has gone, or a name typed differently. Shown in the
   * driver column in place of the employee; never set on a row that has an employee.
   */
  driver1Name: string | null;
  driver2Name: string | null;
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
    /**
     * SHAPE ONLY. Whether the reading may actually be left out depends on where the date sits in
     * THIS vehicle's chain — a day between two recorded readings may be logged for who drove it
     * without a counter nobody wrote down — and no schema can see a chain. `odometer.service`
     * decides it from the same bracket that already enforces FR-2, and refuses a missing reading
     * anywhere else.
     */
    reading: z.number().int().min(0).nullish(),
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
  /** Several columns at once — see `parseFleetSort`. `sortBy`/`sortDir` still carry the first. */
  sort: fleetSortQuery(),
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
  /**
   * Part of the reading's own NOTE, matched case-insensitively — «خلى في انبوت يسمح ان ابحث
   * بالملاحظات».
   *
   * The log already SHOWS «ملاحظات» as a column, which is where the things this screen has no
   * field for end up: why the counter jumped, which trip it was, who took the car out without
   * signing. A column you can read but not search is a column you scroll past — and this register
   * runs to thousands of rows. Bounded and matched exactly as the accidents file and the workshop
   * visit search their own notes, so the three read alike.
   */
  notes: z.string().trim().min(1).max(100).optional(),
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
  /**
   * DAYS THIS CAR RAN SINCE ITS LAST SERVICE WITH NOBODY WRITING THE COUNTER.
   *
   * «لا اما يسيبو فاضى ويدله انذار ان العربيه دى المفروض تدخل الرقم عشان احسب الصيانه». A day
   * recorded without a reading is on no chain, so it moves none of the figures above — and that
   * is the point: `sinceServiceKm` is the distance somebody MEASURED, and this is how many days
   * of the cycle nobody did. A non-zero figure means the real distance is at least what the
   * screen says, and the way to make it exact is to record the counter for those days.
   *
   * Counted since the last alarm-counting service; for a car with no such service, since ever.
   */
  daysWithoutReading: number;
  /**
   * The car's CURRENT odometer reading — «أعلى قراءة عدّاد وصلتها العربية».
   *
   * Already the number this projection measures `sinceServiceKm` from, so carrying it costs
   * nothing and saves the board a second question. It is here rather than computed on the screen
   * for the reason every other figure on this row is: the subtraction belongs to the server, and
   * a screen that re-derived it would be a second copy of the rule that could drift from the one
   * the alarm actually used.
   */
  latestReading: number | null;
}

// ── Maintenance visits (§4.2) ───────────────────────────────────────────────

export interface FleetMaintenanceVisitDto {
  id: string;
  /** `null` for a visit from the old book on a car the registry never had — see the odometer log. */
  vehicleId: string | null;
  /**
   * The registry's code for that vehicle, resolved SERVER-side for the row — the same reason the
   * odometer log carries one: a client cannot resolve a code for a car outside the page of the
   * registry it happens to hold, so every car past that page would print a dash.
   *
   * `null` only when the vehicle no longer exists at all; a soft-deleted one keeps its code.
   * For a row with no `vehicleId` it is the code the old book wrote.
   */
  vehicleCode: string | null;
  /**
   * The car's «التشغيل» (`operation` catalog id) — «ضيف عمود فى الجدول ب نوع التشغيل».
   *
   * A fact about the CAR, not the visit, read off the registry for the row like the code is — so
   * it names the car's operation TODAY. `null` when the car has none on file, and on a visit kept
   * from the old book for a car the registry never had.
   */
  operationId: string | null;
  /** The drivers' NAMES as the old book wrote them, where HR has no employee — see the odometer log. */
  driverInName: string | null;
  driverOutName: string | null;
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
   * Free-text parts, as visits recorded before the catalog existed carry them.
   *
   * `sparePartIds` replaced it and the web form does not send it — but it is still ACCEPTED on
   * check-in and on update, and stored verbatim, so a caller written before the catalog existed
   * is not refused outright. It is never matched against the catalog: guessing which part a
   * spelling meant is exactly the silent data loss the catalog replaced, which is also why these
   * words were kept rather than migrated.
   */
  spareParts: string[];
  /** Parts chosen from the `sparePart` catalog. The field new visits write. */
  sparePartIds: string[];
  /** The counter when the vehicle went IN — `null` when none was written. */
  odometerAtService: number | null;
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
    /**
     * The counter on arrival. OPTIONAL — «مش اجبارى … انه يكتب عداد بس لو كتب ميدخلش اقل من القيمة
     * اللى قبلها»: absent or null is a visit with no counter; a counter below the last reading
     * before the visit is refused by the server.
     */
    odometerAtService: z.number().int().min(0).nullish(),
    /**
     * Who drove the vehicle in. OPTIONAL — «سائق الدخول ميكونش اجبارى يكون اختيارى».
     *
     * It was required on the reasoning that the roster is a plan and a plan is not a record of who
     * actually arrived. That reasoning still holds for the VALUE: when it is given it is a record,
     * never inferred from the roster. What it does not justify is refusing the check-in outright,
     * because the car is in the workshop either way and a visit nobody can open is a visit nobody
     * records. The document has always stored `null` here.
     *
     * The check-OUT driver stays required: that write also sets the alarm's baseline, and it is
     * made by someone standing in front of the car.
     */
    driverInEmployeeId: objectId().nullish(),
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
     * The counter the vehicle leaves on. OPTIONAL, as on check-in; when given it becomes the
     * baseline later maintenance calculations measure from, and it may not be below the arrival
     * counter or the last reading before the check-out.
     */
    exitOdometer: z.number().int().min(0).nullish(),
    /** Who drove the vehicle away. REQUIRED — this write also sets the alarm's baseline. */
    driverOutEmployeeId: objectId(),
    /**
     * The parts fitted, REPLACING whatever the check-in recorded — «قطع الغيار دى بتكون لما باجى
     * اخرجه من الورشه برضو».
     *
     * They belong here because this is when they are known: a car goes in for a fault and the
     * workshop finds out what it needs while it has it. Absent means «leave the check-in list
     * alone», and an empty array means «there were none» — the two are different answers, and a
     * check-out that cannot express the first would quietly erase a list somebody typed.
     */
    sparePartIds: z.array(objectId()).max(50).optional(),
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
    odometerAtService: z.number().int().min(0).nullish(),
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
  /** Several columns at once — see `parseFleetSort`. `sortBy`/`sortDir` still carry the first. */
  sort: fleetSortQuery(),
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
  /**
   * «انا اقدر اعمل فلتر ب نوع التشغيل» — visits of cars whose «التشغيل» is one of these. Resolved
   * server-side against the registry, like `vehicleCodes`; a car the registry never had has no
   * operation and matches none.
   */
  operationIds: listQuery(objectId()),
  /**
   * «الفرع» — visits of cars registered to one of these branches. The branch is the registry's
   * fact, resolved server-side like `operationIds`; a car the registry never had has no branch.
   */
  branchIds: listQuery(objectId()),
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
  /** `null` for a file from the old book on a car the registry never had — see the odometer log. */
  vehicleId: string | null;
  /** The registry's code, resolved server-side; the old book's code for a row with no `vehicleId`. */
  vehicleCode: string | null;
  /** `null` only on a file from the old book that recorded no date. Nothing else may leave it out. */
  occurredAt: string | null;
  culprit: string;
  /** The DRIVER at fault, when it was one of ours. `null` for a third party. The first of `culpritEmployeeIds`. */
  culpritEmployeeId: string | null;
  /**
   * EVERY driver of ours at fault — «يقدر يختار اكتر من سواق فى المره الواحده». Empty for a third
   * party. A file from before several could be picked reads as its one driver.
   */
  culpritEmployeeIds: string[];
  statement: string;
  companyCost: number;
  amountCollected: number;
  paidAmount: number;
  /**
   * What this file has TAKEN from other cars' remaining — «المبلغ ده يضاف للعربيه اللى عامل عليه
   * تعديل». The sum of its live transfers; the detail is in the car's log.
   */
  transferredIn: number;
  /**
   * What other files have taken OUT of this one's remaining. A transfer names a CAR to take from,
   * and the amount is drawn from that car's files oldest first — this is this file's share.
   */
  transferredOut: number;
  /**
   * Does this file's CAR have at least one transfer in its log, in either direction? The row's
   * «السجل» button is yellow when it does — «لو السجل فى عمليه واحده على الاقل يخليه باللون الاصفر».
   */
  carHasTransfers: boolean;
  status: FleetAccidentStatus;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * «اختار عربيه و جمبها مبلغ» — take `amount` out of another car's remaining and add it to the file
 * being recorded or edited.
 *
 * The amount is capped by what that car has left over ALL its files (the server checks, inside
 * the same transaction as the write) and is drawn from those files oldest first.
 */
export const FleetAccidentTransferInputSchema = z
  .object({
    /**
     * The cars to take from, IN THE ORDER PICKED: the first gives all it has left before the
     * second gives anything — «لازم يوصل ل 0 فى العربيه اللى بينقص منها عشان يبدا ينقاص من
     * العربيه التانيه».
     */
    fromVehicleIds: z
      .array(objectId())
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'A car is listed twice' }),
    amount: egp()
      .positive()
      // Within a hair of a whole piastre, not EXACTLY one: `19.99 * 100` is 1998.9999999999998 in
      // binary floating point, and an exact comparison refused every ordinary amount like it.
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
        message: 'At most two decimal places',
      }),
  })
  .strict();
export type FleetAccidentTransferInput = z.infer<typeof FleetAccidentTransferInputSchema>;

const accidentCore = {
  vehicleId: objectId(),
  occurredAt: z.coerce.date(),
  /**
   * WHO was at fault, written down.
   *
   * Still a name, and still required: an accident is not always one of ours — a third party, an
   * unknown car, «سائق الطرف الآخر» — and a record that could only name an employee could not be
   * filed for the commonest kind of accident there is.
   */
  culprit: z.string().trim().min(1).max(200),
  /**
   * …and WHICH DRIVER, when it was one of ours.
   *
   * Beside the name rather than instead of it. The name is what the board, the export and the
   * print-out have always shown and is the historical fact — a driver renamed next year did not
   * change who caused this accident. The id is what makes «show me everything سائق X caused» a
   * question the server can answer exactly, instead of a substring search that matches two people
   * who share a first name.
   */
  culpritEmployeeId: objectId().nullish(),
  /**
   * …or SEVERAL drivers. Sent, it is the whole list and `culpritEmployeeId` becomes its first;
   * `culprit` then carries all their names.
   */
  culpritEmployeeIds: z.array(objectId()).max(20).optional(),
  statement: z.string().trim().min(1).max(2000),
  companyCost: egp(),
  amountCollected: egp(),
  paidAmount: egp(),
  notes: z.string().trim().min(1).max(1000).nullish(),
};

/** A car cannot take from itself — that would move nothing and log a transfer. */
const transferFromAnotherCar = (
  value: { vehicleId?: string | undefined; transfer?: FleetAccidentTransferInput | undefined },
  ctx: z.RefinementCtx,
): void => {
  if (
    value.transfer !== undefined &&
    value.vehicleId !== undefined &&
    value.transfer.fromVehicleIds.includes(value.vehicleId)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['transfer', 'fromVehicleIds'],
      message: 'Pick a car other than the accident’s own',
    });
  }
};

export const CreateFleetAccidentSchema = z
  .object({ ...accidentCore, transfer: FleetAccidentTransferInputSchema.optional() })
  .strict()
  .superRefine(transferFromAnotherCar);
export type CreateFleetAccident = z.infer<typeof CreateFleetAccidentSchema>;

/**
 * `transfer` on an edit ADDS one more transfer to the file; the ones already on it stay. A wrong
 * one is removed from the car's log, which puts the amount back where it came from.
 */
export const UpdateFleetAccidentSchema = z
  .object(accidentCore)
  .partial()
  .extend({
    version: z.number().int().min(0),
    transfer: FleetAccidentTransferInputSchema.optional(),
  })
  .strict()
  .superRefine(transferFromAnotherCar);
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
  /** Part of the at-fault name, matched case-insensitively — the only way to find a third party. */
  culprit: z.string().trim().min(1).max(200).optional(),
  /** The drivers asked about, ORed — exact, where the name search is a guess. */
  culpritEmployeeId: listQuery(objectId()),
  status: FleetAccidentStatusSchema.optional(),
  /**
   * Part of the file's own NOTE, matched case-insensitively — «عاوز اقدر ابحث فى الملاحظات».
   *
   * The note is where the things this screen has no column for end up: which garage, which
   * cheque, what the other side promised. Once a fleet has a few hundred files, the only way
   * back to one of them is the sentence somebody wrote on it. The workshop register searches
   * its own note the same way, with the same bound.
   */
  notes: z.string().trim().min(1).max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

export const ListFleetAccidentsQuerySchema = PaginationQuerySchema.extend({
  ...accidentFilters,
  /** Several columns at once — see `parseFleetSort`. */
  sort: fleetSortQuery(),
}).strict();
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
  /** Sums of the matched files' `transferredIn` / `transferredOut`. Equal over the whole fleet. */
  transferredIn: number;
  transferredOut: number;
  /** Derived, never stored: see `fleetAccidentRemaining`. */
  remaining: number;
}

/**
 * GET /fleet/accidents/car-balances — every car with MORE THAN ZERO remaining over its files, the
 * list the «كود السيارة المأخوذ منها» picker offers: a car with nothing left has nothing to give.
 */
export interface FleetAccidentCarBalanceDto {
  vehicleId: string;
  vehicleCode: string;
  /** Always > 0 — the same figure a transfer from this car is capped by. */
  remaining: number;
}

/** GET /fleet/accidents/transfers — one car's log, both directions. */
export const FleetAccidentTransfersQuerySchema = z.object({ vehicleId: objectId() }).strict();
export type FleetAccidentTransfersQuery = z.infer<typeof FleetAccidentTransfersQuerySchema>;

/** One transfer, as the car the log is about sees it. */
export interface FleetAccidentTransferEntryDto {
  /** The transfer itself — what «حذف» names. */
  transferId: string;
  /** The file that RECEIVED the amount; the transfer lives on it. */
  accidentId: string;
  /** `in` — this car's file was paid from `otherVehicleCode`; `out` — this car paid `otherVehicleCode`. */
  direction: 'in' | 'out';
  otherVehicleId: string | null;
  otherVehicleCode: string | null;
  amount: number;
  at: string;
  byName: string | null;
}

export interface FleetAccidentCarTransfersDto {
  vehicleId: string;
  vehicleCode: string;
  /**
   * The car's «إجمالي المتبقي» over ALL its files, open and closed, transfers included — the
   * figure a new transfer from this car is capped by, computed by the same code that checks it.
   */
  remaining: number;
  /** Newest first. */
  entries: FleetAccidentTransferEntryDto[];
}
/**
 * What an accident file still owes: «إجمالي المتبقي».
 *
 *   remaining = amountCollected + companyCost − paidAmount + transferredIn − transferredOut
 *
 * The last two are what other cars' files moved in and out (see `FleetAccidentTransferInputSchema`);
 * both are zero on a file no transfer has touched, so its figure is the three facts alone.
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
  /**
   * Moved in from, and out to, other cars' files (see `FleetAccidentTransferInputSchema`). Optional
   * so a caller holding only the three facts still gets their figure; absent means none.
   */
  transferredIn?: number | undefined;
  transferredOut?: number | undefined;
}): number => {
  const rounded =
    Math.round(
      (of.amountCollected +
        of.companyCost -
        of.paidAmount +
        (of.transferredIn ?? 0) -
        (of.transferredOut ?? 0)) *
        100,
    ) / 100;
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
  /** `null` for a row from the old book on a car the registry never had — see the odometer log. */
  vehicleId: string | null;
  /** The registry's code, resolved server-side; the old book's code for a row with no `vehicleId`. */
  vehicleCode: string | null;
  violationTypeId: string;
  /** SERVER-computed for `vehicle` rows (count × unitValue); entered for `driver` rows. */
  amount: number;
  /** vehicle shape */
  year: number | null;
  count: number | null;
  unitValue: number | null;
  /** driver shape */
  date: string | null;
  /**
   * WHICH YEAR-BLOCK THIS ROW IS COUNTED IN, when that is not the one its own date says.
   *
   * «فى عربيات بتخلص مخالفاتها ٢٠٢٦ وفى سواقين عاملين مخالفاتها سنة ٢٥ ... عاوز يبقوا تبع العربيه
   * دى». A driver's fine from an earlier year turns up late, after the car's current year has been
   * worked through; the clerk closing that car needs it in front of them, in that car's block.
   *
   * IT IS NOT THE DATE, AND IT NEVER REWRITES IT. `date` is when the fine happened and stays true:
   * the drivers' board still lists the row on its own day, and the audit trail still has the day it
   * was filed against. This is an administrative answer to a different question — «which statement
   * is this being carried on» — and it is `null` for every row nobody has moved, which is almost
   * all of them.
   *
   * On a `vehicle` row it is always `null`: a statement row already STORES its year, so it has
   * nothing to override and the board's tick reads that stored year directly.
   */
  filedYear: number | null;
  /**
   * THE CAR THIS FINE CAME FROM, while it is being carried on another one's statement.
   *
   * «لو كانت على 150 واتنقلت ف الكود هيكون بتاع العربيه الجديدة ... طب لو رجعتها هتكون 150 زى ما
   * كانت». Carrying a fine DOES move it onto the other car — `vehicleId` becomes 151 and the board
   * lists it there, which is the whole point. But the move has to be undoable, and an overwrite
   * with nothing kept is not: pressing «محمولة على» cleared the year and left the fine stranded on
   * a car it was never committed on.
   *
   * So this holds where it came from, for exactly as long as it is away. It is `null` on every row
   * that is not carried, and it is written ONLY on the first carry — a fine carried 150 → 151 and
   * then 151 → 152 still remembers 150, because home is where it started, not the last stop.
   */
  homeVehicleId: string | null;
  driverEmployeeId: string | null;
  /** The driver's NAME as the old book wrote it, where HR has no employee — see the odometer log. */
  driverName: string | null;
  /**
   * Has this fine's money actually been taken in?
   *
   * A recorded violation and a collected one are different facts, and the screen colours the row
   * on the second. Recording says the authority fined us; collecting says the amount left the
   * driver's dues or reached the authority. Nothing derives it — a person marks it, and the
   * board shows that state to whoever opens it next.
   */
  collected: boolean;
  /**
   * THIS ROW CAME FROM THE OLD SYSTEM'S BOOK, not from somebody typing it here.
   *
   * «وكل اللى فى الملف ضيفه ويكون الصف لونه اخضر». The violations recorded on this system up to
   * 23 September were cleared and the old book's `car_violations` export was written again in
   * their place (`go-live/violations-reload.ts`); every row that reload writes carries `true`, and
   * the two boards paint it green so a reader can tell the book's history from what was filed
   * here since. A row somebody records on the screen is `false`, and so is every row stored before
   * the field existed — the server answers `false` for a row that has no value, never «unknown».
   *
   * Set ONLY by the import. No form sends it and the update schema does not accept it: where a
   * row came from is a fact about its history, not something a correction can change.
   */
  fromOldBook: boolean;
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

/**
 * «مجهول» — the driver of a fine nobody could name. «يقدر يسجل اسم سواق مجهول»: a driver fine may
 * be filed with `driverEmployeeId: null`, and it is stored with no employee and this as its name —
 * the same spelling the old book used for the same thing, so the two read as one.
 */
export const FLEET_UNKNOWN_DRIVER_NAME = 'مجهول';

/** Is this fine's driver «مجهول» — no employee, and either this name or none at all? */
export const isUnknownFleetDriver = (row: {
  driverEmployeeId: string | null;
  driverName: string | null;
}): boolean => {
  if (row.driverEmployeeId !== null) return false;
  const name = (row.driverName ?? '').trim();
  return name === '' || name === FLEET_UNKNOWN_DRIVER_NAME;
};

export const RecordFleetDriverViolationSchema = z
  .object({
    vehicleId: objectId(),
    date: z.coerce.date(),
    /** `null` is «مجهول» — see `FLEET_UNKNOWN_DRIVER_NAME`. */
    driverEmployeeId: objectId().nullable(),
    violationTypeId: objectId(),
    amount: egp(),
  })
  .strict();
export type RecordFleetDriverViolation = z.infer<typeof RecordFleetDriverViolationSchema>;

export const UpdateFleetViolationSchema = z
  .object({
    /**
     * The car a filed fine belongs to, and — for a statement row — the year it belongs in.
     *
     * Both were once fixed at recording time and shown read-only afterwards, on the argument that
     * moving a fine is a different act from correcting one. In practice the commonest correction
     * IS the car or the year: a statement arrives naming one plate, is keyed against another, and
     * the only way back was to delete the row and re-file it — which loses the row's history to
     * fix a typo. The service still owns which of the two each shape may carry.
     */
    vehicleId: objectId().optional(),
    year: z.number().int().min(2000).max(2100).optional(),
    violationTypeId: objectId().optional(),
    count: z.number().int().min(1).optional(),
    unitValue: egp().optional(),
    date: z.coerce.date().optional(),
    /** `null` sets the driver to «مجهول». */
    driverEmployeeId: objectId().nullable().optional(),
    amount: egp().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFleetViolation = z.infer<typeof UpdateFleetViolationSchema>;

/**
 * MOVE SEVERAL DRIVER FINES INTO ONE CAR'S YEAR-BLOCK — one act, one request.
 *
 * The board is worked a car at a time, and the fines that belong with a car arrive in a handful:
 * a reader ticks four of them and drops them on the group. Sending four `PATCH /:id` calls, each
 * carrying its own `version`, would let a stale version anywhere leave the move half-applied —
 * some fines carried onto the statement and some not, with nothing on screen saying which.
 *
 * So the ids travel together and the service writes them in ONE transaction: all of them land, or
 * none does and the reader tries again with the same selection.
 *
 * NO `version` HERE, deliberately. Optimistic locking guards a field two people might be editing
 * at the same moment; this changes only which block a row is counted in, and the row's own facts —
 * its date, its driver, its amount, whether it is collected — are untouched. Refusing the move
 * because somebody ticked one of the fines a second ago would be refusing for no reason.
 */
export const MoveFleetViolationsSchema = z
  .object({
    /** The fines being carried over. Driver rows only — the service refuses a statement row. */
    ids: z.array(objectId()).min(1).max(MAX_PAGE_SIZE),
    /**
     * The car whose block they are carried onto — CARRYING ONLY.
     *
     * A return has no target to name: each fine goes back to the car it came from, which the row
     * itself remembers in `homeVehicleId`, and a caller passing one could only be guessing. So
     * this is required when `filedYear` is a year and refused when it is `null`, rather than
     * accepted and ignored — a field the server ignores is a field that lies to whoever reads it.
     */
    vehicleId: objectId().optional(),
    /** The year of that block. `null` puts each fine back on its own car, under its own date. */
    filedYear: z.number().int().min(2000).max(2100).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.filedYear === null && value.vehicleId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicleId'],
        message: 'a return takes no vehicle — each fine goes back to the car it came from',
      });
    }
    if (value.filedYear !== null && value.vehicleId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicleId'],
        message: 'name the car whose block these fines are carried onto',
      });
    }
  });
export type MoveFleetViolations = z.infer<typeof MoveFleetViolationsSchema>;

/**
 * Mark one violation collected, or put it back. Its own write, not part of the edit dialog:
 * collecting is a different act from correcting, done by different people at different times,
 * and folding it into `UpdateFleetViolation` would let a mis-click on a row's amount silently
 * change whether the money is in.
 */
export const SetFleetViolationCollectedSchema = z
  .object({ collected: z.boolean(), version: z.number().int().min(0) })
  .strict();
export type SetFleetViolationCollected = z.infer<typeof SetFleetViolationCollectedSchema>;

/**
 * One vehicle's driver fines, filed together.
 *
 * The drivers' bar is a counting exercise — how many speeding, how many seatbelt — and it opens
 * one card per fine to name the driver, the date and the amount. Those cards are ONE act of
 * data entry, so they are one request: a per-row POST that fails on card six leaves the reader
 * with five stored fines and no way to tell which five without re-reading the board.
 */
export const RecordFleetDriverViolationsSchema = z
  .object({
    vehicleId: objectId(),
    rows: z
      .array(
        z
          .object({
            date: z.coerce.date(),
            /** `null` is «مجهول». */
            driverEmployeeId: objectId().nullable(),
            violationTypeId: objectId(),
            amount: egp(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_PAGE_SIZE),
  })
  .strict();
export type RecordFleetDriverViolations = z.infer<typeof RecordFleetDriverViolationsSchema>;

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
  /** Several columns at once — see `parseFleetSort`. `sortBy`/`sortDir` still carry the first. */
  sort: fleetSortQuery(),
  kind: FleetViolationKindSchema.optional(),
  /**
   * The cars named EXACTLY, ORed — resolved to ids, as on accidents: a violation stores its
   * vehicle by id. A code no car carries narrows to nothing.
   */
  vehicleCodes: vehicleCodesQuery(),
  /** @deprecated Superseded by `vehicleCodes`; still honoured for saved links. */
  vehicleId: objectId().optional(),
  /**
   * The drivers asked about, ORed. A LIST because a supervisor asks about a crew, not one person —
   * and because the screen was already sending several and getting a 400 for it: the bar offered a
   * driver filter whose every use broke the list.
   *
   * A single id still parses, as a one-item list, so every saved link keeps working.
   */
  driverEmployeeId: listQuery(objectId()),
  /**
   * «مجهول» in the drivers filter — the fines with no named driver. ORed with `driverEmployeeId`:
   * a reader may ask for «مجهول» and two drivers at once.
   */
  unknownDriver: z.enum(['true', 'false']).optional(),
  /**
   * «قيمة المخالفة» — the EXACT amount as filed, not a range.
   *
   * Exact because that is how these are looked up: a clerk reconciling a batch has the figure off
   * the notice in front of them and wants the rows carrying it. A range would be a different
   * question, and one nobody on this screen has asked for.
   */
  amount: z.coerce.number().min(0).optional(),
  /**
   * WHICH KINDS of violation — «سرعة», «حزام», «رسوم قضائية» — by catalog id, ORed.
   *
   * A LIST, like `driverEmployeeId` above and for the same reason: a clerk reconciling a stack
   * asks «speeding and seatbelt», not one kind at a time, and a single-value filter made them
   * look twice and add the answers up by hand.
   *
   * A single id still parses, as a one-item list, so every saved link keeps working.
   */
  violationTypeId: listQuery(objectId()),
  /**
   * SETTLED or not — «الحالة» on the bar.
   *
   * The tick is the commonest thing a clerk changes on this board and the commonest question they
   * ask of it: «what is still outstanding». It was answerable only by reading every row's tick,
   * which on a paged board means reading every page.
   */
  collected: booleanQuery().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
}).strict();
export type ListFleetViolationsQuery = z.infer<typeof ListFleetViolationsQuerySchema>;

/** FL-6 additive: the rollup's axis is the YEAR; one vehicle optionally narrows it. */
export const FleetViolationRollupQuerySchema = z
  .object({
    /**
     * Omit for EVERY year, one row per (vehicle, year).
     *
     * The board is read as a history — a vehicle's 2025 beside its 2026 — and a rollup that could
     * only answer about a single year forced the screen either to hide the past or to ask once
     * per year and stitch the answers together.
     */
    /**
     * SEVERAL years, ORed — «اى فلتر ف الحركه زياده عن اتنين اختار ما بينهم».
     *
     * The board compares years («٢٠٢٥ جنب ٢٠٢٦»), and one year at a time made the comparison a
     * thing the reader held in their head between two loads. Capped well under the platform's
     * default: a fleet's whole history is a handful of years, and a longer list is a filter that
     * has stopped narrowing anything.
     */
    year: listQuery(z.coerce.number().int().min(2000).max(2100), 20),
    /**
     * SEVERAL cars, BY CODE — what the board's picker has always written, and what it could not
     * send.
     *
     * The rollup used to take ONE `vehicleId`, so the screen resolved a single picked code and
     * sent nothing at all when the reader picked two or more. The chips said «١٥٠، ١٥١ +٢» and
     * the table quietly answered for the whole fleet — the filter reading as broken rather than
     * as absent, which is the worse of the two failures.
     *
     * Codes rather than ids, as on every other board: the code is what a reader calls a car, and
     * resolving it server-side is what lets a (code, year) kept from the old book — on a car the
     * registry never had — still be found by the code the book wrote.
     */
    vehicleCodes: vehicleCodesQuery(),
    /** @deprecated One car, by id — still honoured for links saved before the codes existed. */
    vehicleId: objectId().optional(),
  })
  .strict();
export type FleetViolationRollupQuery = z.infer<typeof FleetViolationRollupQuerySchema>;

/** Annual rollup per (vehicle, year) — derived at query time (§2.9). */
export interface FleetViolationRollupDto {
  /** `null` for a (code, year) whose rows came from the old book on a car the registry never had. */
  vehicleId: string | null;
  code: string;
  year: number;
  vehicleCount: number;
  vehicleAmount: number;
  driverCount: number;
  driverAmount: number;
  totalCount: number;
  totalAmount: number;
  /**
   * THE SAME THREE HALVES, MINUS WHAT HAS BEEN TICKED — what is still owed.
   *
   * «عاوز لما اعمل على عربيه صح كل الارقام بتاعت العربيه تفضل موجوده متتحولش ل صفر بس الاجماليات
   * بتاعت الجدول العربيه اللى خلصت تتطرح من الجدول».
   *
   * The figures above are what the year CAME TO and do not move when a row is settled — a tick is
   * a statement about payment, not a delete, and a line that zeroed itself took away the figures
   * the reader had just agreed. These three are what the board's FOOTER adds up, so settling a car
   * takes its money out of the running totals while its own line goes on saying what it was.
   *
   * Per ROW, not per group: a car half-settled contributes the half it still owes. That is the
   * drivers' half's own behaviour, which is where the rule comes from — «المبلغ موجود عادى ٤٠٠ او
   * ٧٠٠ ... بس الخلفية خضرا والاجمالى بتاع السواقيين بينقص».
   */
  outstandingVehicleAmount: number;
  outstandingDriverAmount: number;
  outstandingTotalAmount: number;
  /**
   * …AND HOW MANY FINES THAT IS. The counts beside the outstanding money, for the same reason the
   * full figures carry counts: they sit in the same row, and a line reading «٠ مخالفات · ٥٢٣٫٧٠»
   * contradicts itself.
   *
   * The PRINTED sheet is what needs them. «لما باجى اطبع بيجيب اللى خلص واللى مخلصش ف الجدول لا
   * انا عاوز الجدول يجيب اللى مخلصش بس يعنى هيبقوا 3 كدا مش 8» — the signed document reports what
   * is still owed, so its table has to count what is still owed too, and the screen goes on
   * showing both halves.
   */
  outstandingVehicleCount: number;
  outstandingDriverCount: number;
  outstandingTotalCount: number;
  totalBeforeGrievance: number;
  /**
   * How many of this (vehicle, year)'s COMPANY rows exist, and how many have been collected.
   *
   * The board's tick is a GROUP's state, and a group is only «collected» when every row in it is.
   * Two numbers rather than a boolean because the third state — some collected, some not — is the
   * one a reader most needs to see, and a boolean cannot carry it.
   *
   * EVERY ROW OF THE GROUP IS IN THESE — the statement rows and the drivers' fines alike, because
   * «عاوز لما اعمل علامه صح على عربيه يعملى صح برضو على كل السواقيين» and the tick now settles the
   * whole block. They must count exactly what that tick sets: counting less would leave a settled
   * group reporting «بعضها» for ever, counting more one that can never turn green.
   */
  rowCount: number;
  collectedCount: number;
}

/** Tick or untick every row of one (vehicle, year) at once — what the board's own tick does. */
export const SetRollupCollectedSchema = z
  .object({
    vehicleId: objectId(),
    year: z.coerce.number().int().min(2000).max(2100),
    collected: z.boolean(),
  })
  .strict();
export type SetRollupCollected = z.infer<typeof SetRollupCollectedSchema>;

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
  odometerAtService: z.number().int().nullable(),
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
/** The scanned invoices the dealership screen (التوكيل) attaches to a workshop exit. */
export const FLEET_DEALERSHIP_FILE_CATEGORY = 'fleet-dealership-invoices';

// ── Declared settings (owner principle 4 — nothing threshold-like hardcoded) ─

// ── The module's landing surface (FW-2): one read, one screen ───────────────
//
// The dashboard asks a dozen questions about the same fleet — how many cars of each type sit in
// each branch, who drives them, how far they ran, what is due, what happened today — and every
// one of them is an AGGREGATE over a collection the page cannot hold. Answering them from the
// list endpoints would mean a request per branch per type and a page cap in front of a fleet of
// two hundred, so the server answers them, once.
//
// Every section is NULLABLE, and that is the permission model rather than an accident: a reader
// who may see the workshop but not the registry gets the maintenance sections and `null` where
// the vehicle ones would be. The client renders what it was given and nothing where it was given
// nothing — it never has to know which permission produced which section.

/** A branch, named once and referred to by id everywhere below. */
export interface FleetDashboardBranchDto {
  id: string;
  name: LocalizedString;
}

/** One row of «توزيع الأسطول»: a vehicle TYPE, its count per branch, and its total. */
export interface FleetDashboardTypeRowDto {
  typeId: string;
  name: LocalizedString;
  /** Branch id → how many active vehicles of this type it holds. Absent branch = zero. */
  counts: Record<string, number>;
  total: number;
}

/**
 * «إحصائيات الفرع» for ONE branch, or for the whole company when `branchId` is null.
 *
 * The operation split (نقل أموال / ATM) is the vehicle's `operation` catalog reference, which is
 * what the registry already stores; the driver split is the profile's own `specialization`. Both
 * are read, never inferred from a name.
 */
export interface FleetDashboardBranchStatsDto {
  branchId: string | null;
  vehicles: number;
  drivers: number;
  /** Vehicles whose operation names the cash run, and the drivers specialised in it. */
  cashVehicles: number;
  cashDrivers: number;
  atmVehicles: number;
  atmDrivers: number;
}

/** Distance recorded per branch, and the cars at either end of it. */
export interface FleetDashboardVehicleKmDto {
  vehicleId: string;
  code: string;
  km: number;
}

export interface FleetDashboardBranchKmDto {
  branchId: string;
  km: number;
}

/** A licence coming due, with the branch that has to renew it. */
export interface FleetDashboardDueLicenseDto {
  vehicleId: string;
  code: string;
  branchId: string | null;
  licenseExpiresAt: string;
}

/** A workshop visit that started today, as the strip under the board lists it. */
export interface FleetDashboardVisitDto {
  visitId: string;
  code: string;
  workshop: LocalizedString | null;
  workType: LocalizedString | null;
  spareParts: LocalizedString[];
  notes: string | null;
}

/** An accident recorded today. */
export interface FleetDashboardAccidentDto {
  accidentId: string;
  code: string;
  occurredAt: string;
  culprit: string | null;
  status: FleetAccidentStatus;
}

export interface FleetDashboardDto {
  /** Every branch that holds a vehicle, in the order the matrix's columns run. */
  branches: FleetDashboardBranchDto[];
  /** `null` = the caller may not read the registry. */
  fleet: {
    types: FleetDashboardTypeRowDto[];
    /** The whole company first, then one entry per branch. */
    stats: FleetDashboardBranchStatsDto[];
    dueLicenses: FleetDashboardDueLicenseDto[];
  } | null;
  /** `null` = the caller may not read the odometer log. */
  odometer: {
    byBranch: FleetDashboardBranchKmDto[];
    top: FleetDashboardVehicleKmDto[];
    bottom: FleetDashboardVehicleKmDto[];
  } | null;
  /** `null` = the caller may not read the workshop. */
  maintenance: { today: FleetDashboardVisitDto[]; monthCount: number } | null;
  /** `null` = the caller may not read accidents. */
  accidents: { today: FleetDashboardAccidentDto[]; monthCount: number } | null;
}

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
  /**
   * THE SIGNATURE BLOCK every Fleet report is printed with — six lines, all admin-editable.
   *
   * A printed Fleet table is not a screenshot: it is a company document that goes up for signature
   * and into a binder, so it carries who prepared it, who approves it and who endorses the totals.
   * Those are PEOPLE, and people move — «في إعدادات الحركة» is where they belong, because the
   * alternative is a code change and a release every time somebody is promoted.
   *
   * Titles are settings too, not literals beside them: «مدير إدارة الحركة» is an office whose name
   * the company may restructure, and a title frozen in source beside an editable name would drift
   * apart from it the first time that happened.
   */
  ReportPreparedByTitle: 'fleet.report.preparedByTitle',
  ReportPreparedByName: 'fleet.report.preparedByName',
  ReportApprovedByTitle: 'fleet.report.approvedByTitle',
  ReportApprovedByName: 'fleet.report.approvedByName',
  /** The line asking for endorsement, above the executive who gives it. */
  ReportEndorsementNote: 'fleet.report.endorsementNote',
  ReportEndorsedByName: 'fleet.report.endorsedByName',
  /**
   * Fuel prices, EGP per litre — what the receipts screen turns an amount into litres with:
   * «يظهر جامبه عدد اللترات على اساس القيم اللى حاططها فى شاشه /fleet/settings».
   */
  FuelPricePetrol80: 'fleet.fuel.price.petrol80',
  FuelPricePetrol92: 'fleet.fuel.price.petrol92',
  FuelPricePetrol95: 'fleet.fuel.price.petrol95',
  FuelPriceDiesel: 'fleet.fuel.price.diesel',
  /** Days before a fuel card's expiry that the cards screen flags it. */
  FuelCardExpiryWarnDays: 'fleet.fuelCard.expiryWarnDays',
  /** A card balance below this reads yellow on the charging screen; below `BalanceRed`, red. */
  FuelCardBalanceYellow: 'fleet.fuelCard.balanceYellow',
  FuelCardBalanceRed: 'fleet.fuelCard.balanceRed',
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

// ── Go-live runs ──────────────────────────────────────────────────────────────
//
// The boot-time go-live steps (the vehicle registry, the drivers' licence scans) record what
// they did — or why they refused, or what failed — on a row per step. This is that row, read-only,
// for whoever may create vehicles or manage drivers: the owner cannot read the server log, and
// two production imports failed with nobody able to say why.

export type FleetGoLiveRunStatus = 'running' | 'done';

export interface FleetGoLiveRunDto {
  /** `go-live:vehicles:v3`, `go-live:driver-photos:v1` — versioned, see the api's `go-live/`. */
  key: string;
  status: FleetGoLiveRunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** While `running`: the instant after which another boot may take the job over. */
  leaseUntil: string;
  /**
   * What the step reported. Free-form by design — counts on success (`created`, `attached`…),
   * `refused: true` plus the reasons when the step would not start, `failed` plus `failures`
   * when it started and could not finish. The screen prints it as it is.
   */
  outcome: Record<string, unknown> | null;
}

export interface FleetGoLiveRunsDto {
  runs: FleetGoLiveRunDto[];
}

// ── Licensing board (التراخيص) ────────────────────────────────────────────────
//
// The paperwork half of a licence renewal: the insurance papers and the tax papers, each handed
// in and then collected back. The board carries no money and no dates — it is a checklist a clerk
// works down, and «تسليم/استلام» is the whole of what it records.
//
// WHICH CARS ARE ON IT IS NOT A CHOICE ANYBODY MAKES HERE. A vehicle appears because its licence
// class is one whose name ends «ت» — «برقاش ت», «العجوزة ت» — and disappears the moment that
// class becomes «برقاش م». «لما العربيه تبقى اخرها م زى برقاش م تتشال من الجدول خالص ... اخرها ت
// تتحط ت من جديد». So membership is DERIVED at read time from the registry, never stored here:
// a stored copy would be a second answer to «هل العربية دى بتترخص؟» and would go stale the first
// time an admin renamed a class.
//
// A CAR THAT LEAVES THE BOARD LOSES ITS TICKS — «لو رجعت كل العلامات تتشال». The ticks record
// papers handed to a particular office for a particular licence, so once the licence has moved
// they describe an errand that no longer applies, and a car coming back to «ت» that arrived
// already half-done would be telling the clerk work was finished that nobody did.
//
// They are retired rather than erased: the row is soft-deleted, so what was done stays in the
// database and simply leaves the screen, and the returning car starts on a fresh row.

/** The four ticks a row carries — two papers, each handed in and collected back. */
export const FLEET_LICENSING_MARKS = [
  'insuranceHandover',
  'insuranceReceipt',
  'taxHandover',
  'taxReceipt',
] as const;
export const FleetLicensingMarkSchema = z.enum(FLEET_LICENSING_MARKS);
export type FleetLicensingMark = z.infer<typeof FleetLicensingMarkSchema>;

export interface FleetLicensingRowDto {
  vehicleId: string;
  code: string;
  plateNumber: string;
  chassisNumber: string;
  /**
   * The licence class the car is on the board FOR, as the admin named it («برقاش ت»). Shown
   * because a board whose membership rule is invisible is a board whose absences cannot be
   * explained — a clerk looking for a car that is not there needs to see what the others have.
   */
  licenseClass: string | null;
  /**
   * WHEN THE LICENCE RUNS OUT — the registry's own `licenseExpiresAt`, carried here rather than
   * looked up per row.
   *
   * It is the date the whole errand exists for: «تسليم» and «استلام» are steps towards a renewal,
   * and a board that showed the steps without the deadline could not be read in the order the work
   * is actually done. Filtering by a period over it is what turns the board into a worklist.
   */
  licenseExpiresAt: string;
  insuranceHandover: boolean;
  insuranceReceipt: boolean;
  taxHandover: boolean;
  taxReceipt: boolean;
}

/**
 * One tick, named. No `version`: a tick is a statement about a single square that the clerk can
 * make and unmake at will, and the row it lands on may not exist yet — there is nothing for two
 * writers to disagree about, and an optimistic check would only refuse the second clerk for no
 * gain. It is the same reasoning the violations board's group tick is written under.
 */
export const SetFleetLicensingMarkSchema = z
  .object({
    vehicleId: objectId(),
    mark: FleetLicensingMarkSchema,
    value: z.boolean(),
  })
  .strict();
export type SetFleetLicensingMark = z.infer<typeof SetFleetLicensingMarkSchema>;

// ── How a fleet is ORDERED by its car codes ──────────────────────────────────

/**
 * THE FIRST CODE OF THE WORKING FLEET. Below it a car is «ملاكى» — privately owned, driven by its
 * owner, and not what anybody opens a Fleet screen to look at.
 *
 * A number rather than a flag because that is how the company numbers its cars: the working fleet
 * was issued 150 upward and the private ones kept the old low numbers, so the code IS the fact.
 * Naming it here keeps the boundary in one place; nothing else in the code may spell 150.
 */
export const FLEET_FIRST_WORKING_CODE = 150;

/** Wide enough that no real code is truncated — the registry caps a code at twenty characters. */
const CODE_PAD = 20;

/**
 * ONE SORTABLE KEY FOR A CAR CODE, so every Fleet screen and every list orders its cars the same
 * way — «اى عربيات تتعرض من اول 150 وانت طالع ... وبعدين الملاكى».
 *
 * Three groups, in this order:
 *
 *   0. the working fleet — a numeric code of 150 or more, counting up: 150, 151, 152 …
 *   1. the cars written in WORDS — «العربيات اللى متسجله بالكلام», any code that is not a number,
 *      alphabetically among themselves;
 *   2. «الملاكى» — a numeric code below 150, counting up: 61, 62 …
 *
 * The key is a STRING, not a number, because the three groups have to be ordered together and the
 * middle one has no numeric value at all. The digits are LEFT-PADDED so that text order and
 * numeric order agree: without it «9» sorts after «150», which is the bug this whole helper is
 * here to end.
 *
 * `null`/empty answers `null`, which every caller already treats as "missing, sorts last" — a
 * reading kept from the old book on a car the registry never had has no code to order by.
 */
export const fleetVehicleCodeOrderKey = (code: string | null | undefined): string | null => {
  if (typeof code !== 'string' || code.trim() === '') return null;
  const trimmed = code.trim();
  if (!/^\d+$/u.test(trimmed)) return `1${trimmed}`;
  const group = Number(trimmed) >= FLEET_FIRST_WORKING_CODE ? '0' : '2';
  return `${group}${trimmed.padStart(CODE_PAD, '0')}`;
};

/** Compare two car codes by the fleet's own order. Missing codes sort last, either direction. */
export const compareFleetVehicleCodes = (a: string | null, b: string | null): number => {
  const [ka, kb] = [fleetVehicleCodeOrderKey(a), fleetVehicleCodeOrderKey(b)];
  if (ka === null) return kb === null ? 0 : 1;
  if (kb === null) return -1;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

// ── Fleet's own people ───────────────────────────────────────────────────────
//
// «انا عاوز اعرض السواقيين بتوع الحركه للناس اللى واخده موديول الحركه بس ... عشان يظهر لازم اخش
// اديله من الاتش ار صفحه الموظفون ف بيعرض ... كل المواظفين بتوع الشركه لا انا عاوز الحركه يظهر
// الناس بتاعت الحركه بس».
//
// Every Fleet screen that prints a driver's name used to read HR's employee endpoint under HR's
// own `employee.view`. That grant is the whole HR directory: to let a dispatcher see who drove
// car 150 yesterday, somebody had to hand them «الموظفون» and with it every employee in the
// company, which is a far larger thing than the job needs.
//
// So Fleet answers it itself, for ITS OWN PEOPLE and nobody else. The roster is the same one the
// drivers registry is built from — every employee whose job title requires a driving test — and
// it arrives through the directory seam, which is a read the org chart already offers and which
// grants nothing. What this endpoint publishes is exactly the facts a Fleet screen prints; it is
// read-only, stores nothing, and cannot reach a person who does not hold a driving seat.
//
// FR-11 IS UNTOUCHED. Fleet still does not OWN people: it does not write these facts, does not
// keep them, and every one of them is HR's. What changes is which grant a reader needs to see the
// ones Fleet already shows.

/**
 * GET /fleet/people. `includeExited=true` adds the drivers who have LEFT — asked by the violations
 * screen only, where a fine from before someone resigned is still theirs.
 */
export const FleetPeopleQuerySchema = z
  .object({ includeExited: z.enum(['true', 'false']).optional() })
  .strict();
export type FleetPeopleQuery = z.infer<typeof FleetPeopleQuerySchema>;

export interface FleetPersonDto {
  employeeId: string;
  code: string;
  fullNameAr: string;
  /** HR employment status — the registry already grays an exited driver, and so may a cell. */
  status: 'probation' | 'active' | 'onLeave' | 'suspended' | 'exited';
  branchId: string | null;
  /** The official address where there is one, the current one behind it; null when neither. */
  address: string | null;
  governorate: string | null;
  phone: string | null;
  hiredAt: string | null;
}

// ── Notices (الإخطارات) ──────────────────────────────────────────────────────
//
// «عاوز اعمل شاشه جديده للاخطارات ... كل اخطار هيكون فيه داتا مختلفه وشكل الاخطار فى الطباعه
// مختلف». Each insurer has its own printed form, with its own boxes; a notice is one filled copy
// of one of them. WHICH boxes a form has is the web client's (it draws the form), so the server
// stores the answers as a plain map of box → text, and the ticks as box → chosen options.
//
// «ومش عاوز اى داتا اجبارى» — nothing on a notice is required. An empty notice is a valid one.

/** The printed forms the screen knows how to fill. */
export const FLEET_NOTICE_TEMPLATES = ['misrInsurance', 'deltaInsurance'] as const;
export const FleetNoticeTemplateSchema = z.enum(FLEET_NOTICE_TEMPLATES);
export type FleetNoticeTemplate = z.infer<typeof FleetNoticeTemplateSchema>;

/**
 * A box's name — letters and digits only, starting with a letter. It becomes a key inside a stored
 * document, so nothing Mongo reads as an operator or a path (`$`, `.`) can get in.
 */
const noticeKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,59}$/u);

const noticeValues = z
  .record(noticeKey, z.string().max(2000))
  .refine((values) => Object.keys(values).length <= 200, 'too many boxes');
const noticeChecks = z
  .record(noticeKey, z.array(z.string().trim().min(1).max(60)).max(20))
  .refine((checks) => Object.keys(checks).length <= 50, 'too many choices');

export const CreateFleetNoticeSchema = z
  .object({
    template: FleetNoticeTemplateSchema,
    values: noticeValues.default({}),
    checks: noticeChecks.default({}),
    /** What «املأ من السيستم» was pointed at — kept so the notice can be found again by car. */
    vehicleId: objectId().nullish(),
    driverEmployeeId: objectId().nullish(),
    accidentId: objectId().nullish(),
    /** «رقم الإخطار» and its date — the two the notices table lists a notice by. */
    noticeNumber: z.string().trim().max(60).nullish(),
    noticeDate: z.coerce.date().nullish(),
  })
  .strict();
export type CreateFleetNotice = z.infer<typeof CreateFleetNoticeSchema>;

export const UpdateFleetNoticeSchema = z
  .object({
    values: noticeValues.optional(),
    checks: noticeChecks.optional(),
    vehicleId: objectId().nullish(),
    driverEmployeeId: objectId().nullish(),
    accidentId: objectId().nullish(),
    noticeNumber: z.string().trim().max(60).nullish(),
    noticeDate: z.coerce.date().nullish(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFleetNotice = z.infer<typeof UpdateFleetNoticeSchema>;

export const ListFleetNoticesQuerySchema = PaginationQuerySchema.extend({
  template: FleetNoticeTemplateSchema.optional(),
});
export type ListFleetNoticesQuery = z.infer<typeof ListFleetNoticesQuerySchema>;

export interface FleetNoticeDto {
  id: string;
  template: FleetNoticeTemplate;
  values: Record<string, string>;
  checks: Record<string, string[]>;
  vehicleId: string | null;
  /** The car's code, read from the registry — what the notices table lists first. */
  vehicleCode: string | null;
  driverEmployeeId: string | null;
  accidentId: string | null;
  noticeNumber: string | null;
  noticeDate: string | null;
  /** The signed paper, scanned — «صورة الإخطار». */
  noticeImage: FleetLicenseImageDto | null;
  /** The insurer's cheque — «صورة الشيك». A notice is closed only once it is in. */
  checkImage: FleetLicenseImageDto | null;
  /** «✓» — when the notice was closed; `null` while it is open. */
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** The two scans a notice carries: the signed paper and the insurer's cheque. */
export const FLEET_NOTICE_IMAGE_KINDS = ['notice', 'check'] as const;
export const FleetNoticeImageKindSchema = z.enum(FLEET_NOTICE_IMAGE_KINDS);
export type FleetNoticeImageKind = z.infer<typeof FleetNoticeImageKindSchema>;

/** The Files category both scans write into. */
export const FLEET_NOTICE_FILE_CATEGORY = 'fleet-notices';

/** «✓» on the notices table — close a notice, or open it again. */
export const SetFleetNoticeDoneSchema = z
  .object({ done: z.boolean(), version: z.number().int().min(0) })
  .strict();
export type SetFleetNoticeDone = z.infer<typeof SetFleetNoticeDoneSchema>;

// ── A form's set-up (إعداد النماذج) ────────────────────────────────────────
//
// «ادوس عليه اختار النموذج واحط قيم افتراضيه ... قيم بتتكرر فى اكتر من مكان زى كود العربيه و
// تواريخ معينه ف انا عاوز احدد دى برضو». One per form: what each box starts with on a new notice,
// and which boxes share one answer — typed once, written in all of them.

/**
 * What a box starts with. `fixed` — the same words every time. `today` — the day the notice is
 * filled. `system` — what «املأ من السيستم» brings from the car, the driver or the accident.
 * `empty` — typed by hand every time (and never filled by the system).
 */
export const FLEET_NOTICE_DEFAULT_MODES = ['fixed', 'today', 'system', 'empty'] as const;
export const FleetNoticeDefaultModeSchema = z.enum(FLEET_NOTICE_DEFAULT_MODES);
export type FleetNoticeDefaultMode = z.infer<typeof FleetNoticeDefaultModeSchema>;

const noticeDefault = z
  .object({ mode: FleetNoticeDefaultModeSchema, value: z.string().max(2000).default('') })
  .strict();

const noticeLink = z
  .object({
    name: z.string().trim().min(1).max(60),
    keys: z.array(noticeKey).min(2).max(20),
  })
  .strict();

export const SaveFleetNoticeSettingsSchema = z
  .object({
    defaults: z
      .record(noticeKey, noticeDefault)
      .refine((values) => Object.keys(values).length <= 200, 'too many boxes')
      .default({}),
    links: z.array(noticeLink).max(30).default([]),
    /** The version read, or absent for a form never set up. */
    version: z.number().int().min(0).optional(),
  })
  .strict();
export type SaveFleetNoticeSettings = z.infer<typeof SaveFleetNoticeSettingsSchema>;

export interface FleetNoticeSettingsDto {
  template: FleetNoticeTemplate;
  defaults: Record<string, { mode: FleetNoticeDefaultMode; value: string }>;
  links: { name: string; keys: string[] }[];
  /** `null` — the form has never been set up. */
  version: number | null;
  updatedAt: string | null;
}

// ── Dealership invoices (التوكيل) ─────────────────────────────────────────────
//
// «دى العربيه اللى بتخرج من الصيانه بتظهر فى الشاشه دى بس الصف بيكون باللون الاصفر». Every
// workshop exit opens one row here (two, when the visit's work type was «صيانة + إصلاح» — each
// half carries its own invoice). The row is PENDING, and yellow, until its invoice is recorded.
//
// WHO PAYS is the row's `side`: a row with an invoice number is the dealership's (التوكيل); a
// private car (ملاكي) may be recorded with no invoice number, and then the amount comes out of the
// custody fund (العهدة). The side is stored, not re-derived on every read, because the custody
// screen sums it in the database.

/** The two sides the invoice's money is on. */
export const FLEET_DEALERSHIP_SIDES = ['dealership', 'custody'] as const;
export const FleetDealershipSideSchema = z.enum(FLEET_DEALERSHIP_SIDES);
export type FleetDealershipSide = z.infer<typeof FleetDealershipSideSchema>;

/** Which half of a workshop exit a row is — one of the two a «صيانة + إصلاح» visit splits into. */
export const FLEET_DEALERSHIP_WORK_KINDS = ['maintenance', 'repair'] as const;
export const FleetDealershipWorkKindSchema = z.enum(FLEET_DEALERSHIP_WORK_KINDS);
export type FleetDealershipWorkKind = z.infer<typeof FleetDealershipWorkKindSchema>;

/**
 * Record (or correct) the invoice on a row. Nothing but the version is required: a row is edited
 * piece by piece, and the rule that a non-private car needs an invoice number is checked by the
 * service when an amount is written, where the car is known.
 */
export const UpdateFleetDealershipInvoiceSchema = z
  .object({
    invoiceNumber: z.string().trim().min(1).max(60).nullish(),
    invoiceAmount: egp().nullish(),
    /** «ملاكي» — preset from the car's operation, and the clerk's to change. */
    privateCar: z.boolean().optional(),
    /** The insurer, when the car has one or the clerk names one. `null` clears it. */
    insuranceCompanyId: objectId().nullish(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateFleetDealershipInvoice = z.infer<typeof UpdateFleetDealershipInvoiceSchema>;

const dealershipFilters = {
  /** The cars named exactly, ORed — resolved to ids against the registry. */
  vehicleCodes: vehicleCodesQuery(),
  /** The workshop EXIT date the row carries. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  side: FleetDealershipSideSchema.optional(),
  /** `true` — only rows still waiting for their invoice; `false` — only recorded ones. */
  pending: booleanQuery().optional(),
  workKind: FleetDealershipWorkKindSchema.optional(),
};

export const ListFleetDealershipInvoicesQuerySchema = PaginationQuerySchema.extend({
  ...dealershipFilters,
  sort: fleetSortQuery(),
}).strict();
export type ListFleetDealershipInvoicesQuery = z.infer<
  typeof ListFleetDealershipInvoicesQuerySchema
>;

/** The same filters, without paging — the totals describe every row the filters match. */
export const FleetDealershipSummaryQuerySchema = z.object(dealershipFilters).strict();
export type FleetDealershipSummaryQuery = z.infer<typeof FleetDealershipSummaryQuerySchema>;

export interface FleetDealershipInvoiceDto {
  id: string;
  /** The workshop visit this row came from. */
  visitId: string;
  vehicleId: string | null;
  /** The registry's code, resolved server-side; the old book's code for a visit with no `vehicleId`. */
  vehicleCode: string | null;
  /** The workshop exit date — the row's date. */
  outDate: string;
  workKind: FleetDealershipWorkKind;
  /** «صيانة», «إصلاح», or «إصلاح (كهرباء)» — what the row says in the work-type column. */
  workTypeLabel: string;
  privateCar: boolean;
  insuranceCompanyId: string | null;
  /** The insurer's name, resolved server-side — `null` when the car has none. */
  insuranceCompanyName: string | null;
  invoiceNumber: string | null;
  invoiceAmount: number | null;
  image: FleetLicenseImageDto | null;
  /** `null` while the row waits for its invoice. */
  side: FleetDealershipSide | null;
  /** No invoice recorded yet — the yellow row. */
  pending: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** The figures between the filters and the table. */
export interface FleetDealershipTotalsDto {
  /** Every row the filters match. */
  count: number;
  /** …of which still waiting for an invoice. */
  pending: number;
  /** Recorded invoices on the dealership's side, summed. */
  dealershipTotal: number;
  /** Recorded amounts taken from the custody fund, summed. */
  custodyTotal: number;
}

// ── Fuel cards (الفيز) and their charging ────────────────────────────────────
//
// «فى شاشه للفيز هيكون فيها اسم الكارت رقم الكارت وتاريخ الانتهاء و كود العربيه والباسورد و اسم
// الشركه بالشعار». Every car carries up to two cards, one per company, and each card holds a
// BALANCE that charging adds to, a transfer moves between two cards, and a fuel receipt (the
// receipts screen) takes from. The balance is stored on the card and every change is a movement
// in the card's own log, so «كان كام وبقى كام» is always answerable.

/** The two fuel companies the fleet buys from. Their logos ship with the web client. */
export const FLEET_FUEL_CARD_COMPANIES = ['wataniya', 'chillout'] as const;
/** The Files category the card photos are stored under. */
export const FLEET_FUEL_CARD_FILE_CATEGORY = 'fleet-fuel-cards';
export const FleetFuelCardCompanySchema = z.enum(FLEET_FUEL_CARD_COMPANIES);
export type FleetFuelCardCompany = z.infer<typeof FleetFuelCardCompanySchema>;

/** What the pump sells, each priced in settings. */
export const FLEET_FUEL_TYPES = ['petrol80', 'petrol92', 'petrol95', 'diesel'] as const;
export const FleetFuelTypeSchema = z.enum(FLEET_FUEL_TYPES);
export type FleetFuelType = z.infer<typeof FleetFuelTypeSchema>;

/** The setting that prices one fuel type, per litre. */
export const FLEET_FUEL_PRICE_KEY: Record<FleetFuelType, string> = {
  petrol80: FleetSettingKeys.FuelPricePetrol80,
  petrol92: FleetSettingKeys.FuelPricePetrol92,
  petrol95: FleetSettingKeys.FuelPricePetrol95,
  diesel: FleetSettingKeys.FuelPriceDiesel,
};

const fuelCardCore = {
  /**
   * The car the card is on — or `null` for a card that is on none («كروت زيادة ملهمش عربيات»: the
   * travel cards, the spare). Such a card is named by its `label` instead.
   */
  vehicleId: objectId().nullable(),
  /** What a card on no car is called on the fuel screens («سفر 1», «اسبير»). */
  label: z.string().trim().min(1).max(60).nullish(),
  company: FleetFuelCardCompanySchema,
  name: z.string().trim().min(1).max(120),
  number: z.string().trim().min(4).max(40),
  /**
   * REQUIRED — «تاريخ انتهاء الكارت اجبارى». The DTO still reads `null` for the few imported cards
   * neither the photos nor the sheets dated; any save of such a card must give it one.
   */
  // `null` and '' are refused, not coerced: `z.coerce.date()` alone reads null as 1 January 1970.
  expiresAt: z.preprocess(
    (value) => (value === null || value === '' ? undefined : value),
    z.coerce.date(),
  ),
  /**
   * REQUIRED on a new card — «الباسورد اجبارى». Kept, shown only to a reader holding
   * `fleetFuelCard.reveal`.
   */
  password: z.string().trim().min(1).max(120),
};

/** A card on no car still needs a name to be found by. */
const cardOnACarOrNamed = (
  card: { vehicleId?: string | null | undefined; label?: string | null | undefined },
  ctx: z.RefinementCtx,
): void => {
  if (card.vehicleId === null && (card.label ?? '') === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['label'],
      message: 'a card on no car needs a label',
    });
  }
};

export const CreateFleetFuelCardSchema = z
  .object(fuelCardCore)
  .strict()
  .superRefine(cardOnACarOrNamed);
export type CreateFleetFuelCard = z.infer<typeof CreateFleetFuelCardSchema>;

export const UpdateFleetFuelCardSchema = z
  .object({
    vehicleId: fuelCardCore.vehicleId.optional(),
    label: fuelCardCore.label,
    company: fuelCardCore.company.optional(),
    name: fuelCardCore.name.optional(),
    number: fuelCardCore.number.optional(),
    expiresAt: fuelCardCore.expiresAt.optional(),
    /** Absent leaves it as it is; it can be changed, never removed. */
    password: fuelCardCore.password.optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine(cardOnACarOrNamed);
export type UpdateFleetFuelCard = z.infer<typeof UpdateFleetFuelCardSchema>;

const fuelCardFilters = {
  vehicleCodes: vehicleCodesQuery(),
  company: FleetFuelCardCompanySchema.optional(),
  /** Part of the card number. */
  number: z.string().trim().min(1).max(40).optional(),
  expiresBefore: z.coerce.date().optional(),
  /** `true` — only cards with a charge request waiting. */
  requested: booleanQuery().optional(),
  /** Only cards whose balance is below this. */
  balanceBelow: z.coerce.number().nonnegative().optional(),
};
export const ListFleetFuelCardsQuerySchema = PaginationQuerySchema.extend({
  ...fuelCardFilters,
  sort: fleetSortQuery(),
}).strict();
export type ListFleetFuelCardsQuery = z.infer<typeof ListFleetFuelCardsQuerySchema>;
export const FleetFuelCardSummaryQuerySchema = z.object(fuelCardFilters).strict();
export type FleetFuelCardSummaryQuery = z.infer<typeof FleetFuelCardSummaryQuerySchema>;

export interface FleetFuelCardDto {
  id: string;
  /** `null` — a card on no car, named by `label`. */
  vehicleId: string | null;
  /** The registry's code, resolved server-side. */
  vehicleCode: string | null;
  /** What a card on no car is called («سفر 1», «اسبير»); `null` on a card that is on a car. */
  label: string | null;
  company: FleetFuelCardCompany;
  name: string;
  number: string;
  /** `null` until it is known. */
  expiresAt: string | null;
  /** Whether a password is on file — the password itself is fetched separately, under its grant. */
  hasPassword: boolean;
  balance: number;
  /** «طلب رصيد» written and not yet approved; `null` when none. */
  requestedAmount: number | null;
  requestedAt: string | null;
  /** When the balance was last added to — the green row for a day. */
  lastChargedAt: string | null;
  /** The photo of the card («صوره كل فيزا»); the bytes are fetched on their own, under the grant. */
  image: FleetLicenseImageDto | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FleetFuelCardSecretDto {
  password: string | null;
}

/** The figures between the filters and the cards on the charging screen. */
export interface FleetFuelCardTotalsDto {
  wataniyaBalance: number;
  chilloutBalance: number;
  requestedCount: number;
  requestedAmount: number;
  /** Added to balances within the last 24 hours. */
  chargedTodayAmount: number;
  cardCount: number;
}

/** «طلب رصيد» — write the amount; `null` takes the request back (the ✕). */
export const RequestFleetFuelChargeSchema = z
  .object({ amount: egp().positive().nullable(), version: z.number().int().min(0) })
  .strict();
export type RequestFleetFuelCharge = z.infer<typeof RequestFleetFuelChargeSchema>;

/** The ✓ — the requested amount joins the balance. */
export const ApproveFleetFuelChargeSchema = z.object({ version: z.number().int().min(0) }).strict();
export type ApproveFleetFuelCharge = z.infer<typeof ApproveFleetFuelChargeSchema>;

export const TransferFleetFuelBalanceSchema = z
  .object({
    fromCardId: objectId(),
    toCardId: objectId(),
    amount: egp().positive(),
  })
  .strict()
  .refine((value) => value.fromCardId !== value.toCardId, {
    message: 'a card cannot transfer to itself',
    path: ['toCardId'],
  });
export type TransferFleetFuelBalance = z.infer<typeof TransferFleetFuelBalanceSchema>;

/** What a transfer did to both cards — «اللى انا اخدت منها كانت كام وبقت كام». */
export interface FleetFuelTransferResultDto {
  from: FleetFuelCardDto;
  to: FleetFuelCardDto;
  amount: number;
}

export const FLEET_FUEL_MOVEMENT_KINDS = [
  'charge',
  'transferIn',
  'transferOut',
  'receipt',
] as const;
export const FleetFuelMovementKindSchema = z.enum(FLEET_FUEL_MOVEMENT_KINDS);
export type FleetFuelMovementKind = z.infer<typeof FleetFuelMovementKindSchema>;

/** One line of a card's log. `amount` is signed: what the balance moved by. */
export interface FleetFuelCardMovementDto {
  id: string;
  cardId: string;
  kind: FleetFuelMovementKind;
  amount: number;
  balanceAfter: number;
  /** The other card of a transfer. */
  counterpartCardId: string | null;
  counterpartNumber: string | null;
  at: string;
  createdAt: string;
}

export const ListFleetFuelCardMovementsQuerySchema = PaginationQuerySchema.extend({
  cardId: objectId(),
}).strict();
export type ListFleetFuelCardMovementsQuery = z.infer<typeof ListFleetFuelCardMovementsQuerySchema>;

/**
 * «لو اديت ل كارت او اخدت من كارت او زود كارت ك رصيد اقدر اعدل او امسح»: a charge or a transfer
 * on a card's log takes a new amount. A transfer is ONE operation on two cards, so its new amount
 * moves both. Receipt lines are the receipts screen's to change, not the log's.
 */
export const UpdateFleetFuelCardMovementSchema = z
  .object({
    amount: egp().positive(),
  })
  .strict();
export type UpdateFleetFuelCardMovement = z.infer<typeof UpdateFleetFuelCardMovementSchema>;

// ── Receipts (خصم الإيصالات) and the custody ledger (العهدة) ───────────────────
//
// «وفى شاشه خصم الايصالات بيكون فوق اختار وقود او كاوتش او غسيل». A receipt is one paper the
// driver brought back: fuel paid with the car's card OR from the custody fund, tyres and washing
// always from the fund. A fuel receipt taken off a card is a `receipt` movement on that card,
// written with the receipt in one transaction. What the fund paid — these receipts and the
// dealership rows on the custody side — is the ledger the custody screen sums.

export const FLEET_RECEIPT_FILE_CATEGORY = 'fleet-receipts';

export const FLEET_RECEIPT_KINDS = ['fuel', 'tyres', 'wash'] as const;
export const FleetReceiptKindSchema = z.enum(FLEET_RECEIPT_KINDS);
export type FleetReceiptKind = z.infer<typeof FleetReceiptKindSchema>;

/** Where the money came from: the car's fuel card, or the custody fund. */
export const FLEET_RECEIPT_SOURCES = ['card', 'custody'] as const;
export const FleetReceiptSourceSchema = z.enum(FLEET_RECEIPT_SOURCES);
export type FleetReceiptSource = z.infer<typeof FleetReceiptSourceSchema>;

const receiptCore = {
  date: z.coerce.date(),
  vehicleId: objectId(),
  /** The driver, when one of Fleet's people; `null` for a name typed by hand. */
  driverEmployeeId: objectId().nullish(),
  /** The driver's name as shown — a snapshot for a known driver, the typed text otherwise. */
  driverName: z.string().trim().min(1).max(200).nullish(),
  kind: FleetReceiptKindSchema,
  /** The fuel card charged — fuel only; `null` means the custody fund paid. */
  cardId: objectId().nullish(),
  /** Fuel only — prices the litres from the fleet settings. */
  fuelType: FleetFuelTypeSchema.nullish(),
  amount: egp().positive(),
};

const receiptRules = (
  value: {
    kind: FleetReceiptKind;
    cardId?: string | null | undefined;
    fuelType?: FleetFuelType | null | undefined;
  },
  ctx: z.RefinementCtx,
): void => {
  if (value.kind !== 'fuel' && value.cardId != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cardId'],
      message: 'only a fuel receipt is taken off a card — tyres and washing come from the fund',
    });
  }
  if (value.kind !== 'fuel' && value.fuelType != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fuelType'],
      message: 'only a fuel receipt names a fuel type',
    });
  }
  if (value.kind === 'fuel' && value.fuelType == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fuelType'],
      message: 'a fuel receipt needs its fuel type to price the litres',
    });
  }
};

export const CreateFleetReceiptSchema = z.object(receiptCore).strict().superRefine(receiptRules);
export type CreateFleetReceipt = z.infer<typeof CreateFleetReceiptSchema>;

export const UpdateFleetReceiptSchema = z
  .object({
    date: receiptCore.date.optional(),
    vehicleId: receiptCore.vehicleId.optional(),
    driverEmployeeId: receiptCore.driverEmployeeId,
    driverName: receiptCore.driverName,
    kind: receiptCore.kind,
    cardId: receiptCore.cardId,
    fuelType: receiptCore.fuelType,
    amount: receiptCore.amount.optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine(receiptRules);
export type UpdateFleetReceipt = z.infer<typeof UpdateFleetReceiptSchema>;

const receiptFilters = {
  vehicleCodes: vehicleCodesQuery(),
  /** One kind or several — `?kind=tyres,wash`. A link with one kind still reads as before. */
  kind: listQuery(FleetReceiptKindSchema),
  source: FleetReceiptSourceSchema.optional(),
  /** Part of the driver's name. */
  driver: z.string().trim().min(1).max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};
export const ListFleetReceiptsQuerySchema = PaginationQuerySchema.extend({
  ...receiptFilters,
  sort: fleetSortQuery(),
}).strict();
export type ListFleetReceiptsQuery = z.infer<typeof ListFleetReceiptsQuerySchema>;
export const FleetReceiptSummaryQuerySchema = z.object(receiptFilters).strict();
export type FleetReceiptSummaryQuery = z.infer<typeof FleetReceiptSummaryQuerySchema>;

export interface FleetReceiptDto {
  id: string;
  date: string;
  vehicleId: string;
  vehicleCode: string | null;
  driverEmployeeId: string | null;
  driverName: string | null;
  kind: FleetReceiptKind;
  source: FleetReceiptSource;
  cardId: string | null;
  cardCompany: FleetFuelCardCompany | null;
  cardNumber: string | null;
  fuelType: FleetFuelType | null;
  /** The price the litres were computed with — the setting's value on the day. */
  pricePerLitre: number | null;
  litres: number | null;
  amount: number;
  image: FleetLicenseImageDto | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** The figures between the filters and the table on the receipts screen. */
export interface FleetReceiptTotalsDto {
  count: number;
  custodyTotal: number;
  cardTotal: number;
  fuelTotal: number;
  fuelLitres: number;
  tyresTotal: number;
  washTotal: number;
}

/** What the custody fund paid for — the dealership (private cars), fuel, tyres, washing. */
export const FLEET_CUSTODY_SOURCES = ['dealership', 'fuel', 'tyres', 'wash'] as const;
export const FleetCustodySourceSchema = z.enum(FLEET_CUSTODY_SOURCES);
export type FleetCustodySource = z.infer<typeof FleetCustodySourceSchema>;

const custodyFilters = {
  vehicleCodes: vehicleCodesQuery(),
  /** One source or several — `?source=dealership,fuel`. A link with one still reads as before. */
  source: listQuery(FleetCustodySourceSchema),
  driver: z.string().trim().min(1).max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};
export const FleetCustodySummaryQuerySchema = z.object(custodyFilters).strict();
export type FleetCustodySummaryQuery = z.infer<typeof FleetCustodySummaryQuerySchema>;
export const ListFleetCustodyMovementsQuerySchema =
  PaginationQuerySchema.extend(custodyFilters).strict();
export type ListFleetCustodyMovementsQuery = z.infer<typeof ListFleetCustodyMovementsQuerySchema>;

/** One car's line in «ملخص لكل سيارة». */
export interface FleetCustodyVehicleRowDto {
  vehicleId: string | null;
  vehicleCode: string | null;
  dealership: number;
  fuel: number;
  tyres: number;
  wash: number;
  total: number;
}

export interface FleetCustodySummaryDto {
  count: number;
  total: number;
  dealership: number;
  fuel: number;
  tyres: number;
  wash: number;
  vehicles: FleetCustodyVehicleRowDto[];
}

/** One line of «كل الحركات» — a receipt from the fund, or a private car's dealership bill. */
export interface FleetCustodyMovementDto {
  id: string;
  ref: 'receipt' | 'dealershipInvoice';
  source: FleetCustodySource;
  date: string;
  vehicleId: string | null;
  vehicleCode: string | null;
  driverEmployeeId: string | null;
  driverName: string | null;
  /** The fuel type of a fuel receipt, the work of a dealership bill. */
  fuelType: FleetFuelType | null;
  detail: string | null;
  amount: number;
}
