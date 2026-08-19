// Operations / Cash Transfer — the domain vocabulary (OP-1, Domain Foundation).
//
// This file is the normalized form of the legacy status system reverse-engineered in
// docs/12-planning/operations-legacy-discovery.md. The legacy `transactions.status` ladder is
// NUMERIC and NON-ORDINAL — the literal value 1 is the TERMINAL "completed" state for both
// shipment types, not the first step (discovery §6, contad_app.js:564/1220/1737). That fact is
// pinned here as data, in one place, so every later slice (queries, migration, report parity)
// reads the same mapping instead of re-deriving it.
//
// Vocabulary only, by design: DTOs, input schemas and event payloads arrive WITH the slice that
// serves them (the IT precedent — "a grant is declared with its operation, never ahead of it"),
// and transition GUARDS are service logic (the fleet `vehicle-status.ts` precedent), not contract
// data. What lives here is what every slice must agree on before any of them exists.
import { z } from 'zod';
import { type AttendanceDayStatus } from './hr-attendance.js';
import {
  LocalizedStringSchema,
  PaginationQuerySchema,
  booleanQuery,
  listQuery,
  objectId,
} from '../common/index.js';
import { MoneyAmountSchema } from './hr-payroll-money.js';

// ── Shipment type ───────────────────────────────────────────────────────────────────────────────

/** `daily` = legacy "يومي" (same-day pickup run) · `secured` = legacy "محصنة" (vaulted shipment). */
export const OPERATIONS_SHIPMENT_TYPES = ['daily', 'secured'] as const;
export const OperationsShipmentTypeSchema = z.enum(OPERATIONS_SHIPMENT_TYPES);
export type OperationsShipmentType = z.infer<typeof OperationsShipmentTypeSchema>;

/**
 * The exact Arabic strings the legacy system stores in `transactions.type` (discovery §5.1,
 * contad_app.js:263-264). Migration and parity reports match on these verbatim.
 */
export const LEGACY_OPERATIONS_SHIPMENT_TYPE_LABELS: Record<OperationsShipmentType, string> = {
  daily: 'يومي',
  secured: 'محصنة',
};

// ── Shipment status ─────────────────────────────────────────────────────────────────────────────

/**
 * The normalized shipment lifecycle (discovery §6, quirk Q1: PRESERVE the meaning, NORMALIZE the
 * encoding). Daily shipments use only `draft` → `completed`; secured shipments walk
 * `draft` → `inVault` → `dispatched` → `completed`. `completed` is terminal for both.
 */
export const OPERATIONS_SHIPMENT_STATUSES = [
  'draft',
  'inVault',
  'dispatched',
  'completed',
] as const;
export const OperationsShipmentStatusSchema = z.enum(OPERATIONS_SHIPMENT_STATUSES);
export type OperationsShipmentStatus = z.infer<typeof OperationsShipmentStatusSchema>;

/**
 * Legacy numeric `transactions.status` → normalized status. NON-ORDINAL by observation:
 *
 *   0 = created, not yet received        → draft       (contad_app.js:316,406,744,831)
 *   2 = received into the vault          → inVault     (contad_app.js:1220,1275)
 *   3 = dispatched out for delivery      → dispatched  (contad_app.js:1737)
 *   1 = delivered/completed — TERMINAL   → completed   (contad_app.js:564)
 *
 * Every legacy report filters on status 1 + deleted 0 (discovery §12) — that is what makes 1 the
 * terminal state, and what this map exists to never let anyone forget.
 */
export const LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE: Record<number, OperationsShipmentStatus> = {
  0: 'draft',
  2: 'inVault',
  3: 'dispatched',
  1: 'completed',
};

/** Inverse of `LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE`, for parity checks against legacy data. */
export const LEGACY_OPERATIONS_SHIPMENT_CODE_BY_STATUS: Record<OperationsShipmentStatus, number> = {
  draft: 0,
  inVault: 2,
  dispatched: 3,
  completed: 1,
};

// ── Shipment leg ────────────────────────────────────────────────────────────────────────────────

/**
 * A shipment's two crew legs, replacing the legacy leader1/leader2 field duplication (discovery
 * §4.1): `pickup` = leg 1 (leader1/car_num1, attributed by rec_date), `delivery` = leg 2
 * (leader2/car_num2, secured shipments only, attributed by del_date — ops_report groups the daily
 * facet by leader1 and the secured facet by leader2, contad_app.js:4894/4931).
 */
export const OPERATIONS_SHIPMENT_LEGS = ['pickup', 'delivery'] as const;
export const OperationsShipmentLegSchema = z.enum(OPERATIONS_SHIPMENT_LEGS);
export type OperationsShipmentLeg = z.infer<typeof OperationsShipmentLegSchema>;

// ── Captain execution status (NEW — no legacy counterpart) ──────────────────────────────────────

/**
 * The captain mobile sequential-execution lifecycle (design §17 — NEW, marked as such; the legacy
 * system has no captain execution at all). Sequencing rules (shipment N+1 cannot start before N
 * completes) are service-enforced domain invariants, not schema facts, and arrive with OP-8.
 */
export const OPERATIONS_EXECUTION_STATUSES = [
  'pending',
  'active',
  'pickedUp',
  'delivered',
  'completed',
  'cancelled',
] as const;
export const OperationsExecutionStatusSchema = z.enum(OPERATIONS_EXECUTION_STATUSES);
export type OperationsExecutionStatus = z.infer<typeof OperationsExecutionStatusSchema>;

// ── Operations day (NEW — no legacy counterpart) ────────────────────────────────────────────────

/**
 * The explicit operating-day lifecycle (design §16 — NEW). Legacy has no day entity: "today" is
 * derived per-query by exact-equality date match (discovery §5.1, quirk Q15 NORMALIZE). The day
 * entity and its transitions arrive with OP-3.
 */
export const OPERATIONS_DAY_STATUSES = ['planning', 'open', 'closed'] as const;
export const OperationsDayStatusSchema = z.enum(OPERATIONS_DAY_STATUSES);
export type OperationsDayStatus = z.infer<typeof OperationsDayStatusSchema>;

// ── Reference data: banks, bank branches, currencies (OP-2) ─────────────────────────────────────
//
// The legacy "customer/location" model normalized (discovery §11): the customer IS the bank, the
// location IS the bank branch, and every legacy join is a verbatim Arabic string on `bank_name_ops`
// / `branche_name` (discovery §4). The string joins become ObjectId refs (approved NORMALIZE); the
// verbatim legacy strings survive as fields so migration and report parity can still match on them.

export interface OperationsBankDto {
  id: string;
  /** Legacy `bank_code` — numeric, drives the pickers' sort (contad_app.js:271). */
  code: number;
  /** Legacy `bank_name` (en) + `bank_name_arabic` (ar). */
  name: { ar: string; en: string };
  /** Legacy `bank_name_ops` — THE operational join key every legacy screen matches on. Unique. */
  opsName: string;
  /** Legacy `bank_slogan` / `bank_slogan_arabic`, preserved for migration. */
  slogan: { ar: string; en: string } | null;
  /** Q31 NORMALIZE: replaces the hardcoded 22-name `$switch` sort in /vault1 (contad_app.js:1449). */
  sortOrder: number | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const bankCore = {
  code: z.number().int().min(0),
  name: LocalizedStringSchema,
  opsName: z.string().min(1),
  slogan: LocalizedStringSchema.nullable().default(null),
  sortOrder: z.number().int().min(0).nullable().default(null),
};
export const CreateOperationsBankSchema = z.object(bankCore).strict();
export type CreateOperationsBank = z.infer<typeof CreateOperationsBankSchema>;
export const UpdateOperationsBankSchema = z
  .object(bankCore)
  .partial()
  .extend({ isActive: z.boolean().optional(), version: z.number().int().min(0) })
  .strict();
export type UpdateOperationsBank = z.infer<typeof UpdateOperationsBankSchema>;

/**
 * A branch's physical location (design §17.4). OPTIONAL end to end: the legacy system carries no
 * coordinates, no street addresses and no branch phones anywhere (discovery §11.2 — verified by
 * repo-wide grep), so day one this is null everywhere and the captain screen degrades to
 * branch/bank/area names. Backfilling coordinates later lights the map up with no contract change.
 */
export const OperationsLocationSchema = z
  .object({
    addressLine: z.string().min(1).nullable().default(null),
    coordinates: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export type OperationsLocation = z.infer<typeof OperationsLocationSchema>;

export interface OperationsBankBranchDto {
  id: string;
  bankId: string;
  /** Legacy `branche_name` — plain string, Arabic-only in legacy data. Unique per bank. */
  name: string;
  /** Legacy `branche_code` — a string in legacy. Unique per bank. */
  code: string;
  /** Legacy `area` — the OPERATIONS area label (schema comment "للعمليات"). */
  opsAreaName: string | null;
  /** Legacy `area2` — the FINANCE area label ("للحسابات"), defaulted to `area` on add (Q24). */
  financeAreaName: string | null;
  location: OperationsLocation | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const bankBranchCore = {
  bankId: objectId(),
  name: z.string().min(1),
  code: z.string().min(1),
  opsAreaName: z.string().min(1).nullable().default(null),
  financeAreaName: z.string().min(1).nullable().default(null),
  location: OperationsLocationSchema.nullable().default(null),
};
export const CreateOperationsBankBranchSchema = z.object(bankBranchCore).strict();
export type CreateOperationsBankBranch = z.infer<typeof CreateOperationsBankBranchSchema>;
export const UpdateOperationsBankBranchSchema = z
  .object(bankBranchCore)
  .partial()
  .extend({ isActive: z.boolean().optional(), version: z.number().int().min(0) })
  .strict();
export type UpdateOperationsBankBranch = z.infer<typeof UpdateOperationsBankBranchSchema>;

export interface OperationsCurrencyDto {
  id: string;
  /** ISO-ish short code, e.g. `EGP`, `USD`. Unique. */
  code: string;
  /** The display name — in legacy, the verbatim string stored per shipment line (e.g. `مصري`). */
  name: string;
  /**
   * Every legacy spelling that means this currency. The legacy reports classify money by literal
   * synonym lists — EGP is `['مصري','جنيه','EGP','جنيه مصري']`, USD `['دولار','USD']`
   * (contad_app.js:1409, 5029-5057) — so parity matching needs the full alias set as data.
   */
  legacyAliases: string[];
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const currencyCore = {
  code: z.string().min(1).max(8),
  name: z.string().min(1),
  legacyAliases: z.array(z.string().min(1)).max(20).default([]),
};
export const CreateOperationsCurrencySchema = z.object(currencyCore).strict();
export type CreateOperationsCurrency = z.infer<typeof CreateOperationsCurrencySchema>;
export const UpdateOperationsCurrencySchema = z
  .object(currencyCore)
  .partial()
  .extend({ isActive: z.boolean().optional(), version: z.number().int().min(0) })
  .strict();
export type UpdateOperationsCurrency = z.infer<typeof UpdateOperationsCurrencySchema>;

export const ListOperationsBankBranchesQuerySchema = PaginationQuerySchema.extend({
  bankId: objectId().optional(),
  isActive: booleanQuery().optional(),
  search: z.string().optional(),
}).strict();
export type ListOperationsBankBranchesQuery = z.infer<typeof ListOperationsBankBranchesQuerySchema>;

export const ListOperationsReferenceQuerySchema = PaginationQuerySchema.extend({
  isActive: booleanQuery().optional(),
  search: z.string().optional(),
}).strict();
export type ListOperationsReferenceQuery = z.infer<typeof ListOperationsReferenceQuerySchema>;

// ── Operational areas (B6 — the legacy /data_edit city list) ────────────────────────────────────
//
// WHAT THE LEGACY CITY LIST ACTUALLY IS, which is smaller than its name (discovery §F,
// contad_app.js:2033-2227): the suggestion source behind the branch form's `area` field.
// `data_edit.ejs:924` renders it into a `<datalist>` and the branch stores the STRING that was
// picked or typed — there is no foreign key anywhere. `/tashghela` also loads the list (:2367)
// and hands it to a template that never reads it. Nothing else in 6,144 lines consumes a city.
//
// So it is modelled as a NAME SUGGESTION for `bankBranch.opsAreaName`, not as a location entity.
// Promoting it to a foreign key would be a NEW rule: legacy branches carry free text, Q24 copies
// `area` into `area2` verbatim, and existing branch rows have no id to point at.
//
// The legacy governorate link is kept as a plain NAME. It existed only to group the dropdown, and
// ECMS has no governorate entity to reference — `EGYPT_GOVERNORATE_CODES` is a national-ID
// decoding table, not org structure.

export interface OperationsAreaDto {
  id: string;
  /** Legacy `city_name_ar` — the exact string a branch's `opsAreaName` stores. */
  name: string;
  /** Legacy `city_name_en`. Optional here: legacy required it and many rows just repeat Arabic. */
  nameEn: string | null;
  /** Legacy `governorate_id`, as the governorate's name. Grouping only; nothing joins on it. */
  governorate: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const areaCore = {
  name: z.string().min(1),
  nameEn: z.string().min(1).nullable().default(null),
  governorate: z.string().min(1).nullable().default(null),
};
export const CreateOperationsAreaSchema = z.object(areaCore).strict();
export type CreateOperationsArea = z.infer<typeof CreateOperationsAreaSchema>;
export const UpdateOperationsAreaSchema = z
  .object(areaCore)
  .partial()
  .extend({ isActive: z.boolean().optional(), version: z.number().int().min(0) })
  .strict();
export type UpdateOperationsArea = z.infer<typeof UpdateOperationsAreaSchema>;

// ── Cash shipments (OP-2) ───────────────────────────────────────────────────────────────────────
//
// The legacy `transactions` document normalized per the approved SPLIT (design §15): this entity
// carries the shipment itself; crew legs, sequencing and vault custody are separate entities in
// later slices. The legacy parallel arrays `currencies[]`/`values[]` (string amounts) become
// `lines[{currencyId, amount}]` (Q5-Q8 NORMALIZE); amounts ride the platform money convention
// (integer minor units in storage, `MoneyAmountSchema` majors on the wire) rather than the
// design's Decimal128 sketch — the repo already has one money discipline and two would be worse.

export interface OperationsShipmentLineDto {
  currencyId: string;
  /** Major units. Non-negative by parity: the legacy input strips `-` (contad_app.js:327). */
  amount: number;
}

export interface OperationsShipmentDto {
  id: string;
  shipmentType: OperationsShipmentType;
  status: OperationsShipmentStatus;
  /** Legacy `main_bank` (the FROM side's bank; legacy requires it — contad_app.js:313). */
  mainBankId: string;
  /** Legacy `sec_bank` via `toBankSelect`; never server-validated in legacy, so nullable. */
  secondaryBankId: string | null;
  /** Legacy `from_name`/`from_code` — required in legacy (contad_app.js:313). */
  originBranchId: string;
  /** Legacy `to_name`/`to_code` — required in legacy (contad_app.js:313). */
  destinationBranchId: string;
  /** Legacy `area` — a free-text area label picked from the branches' areas. */
  areaName: string | null;
  lines: OperationsShipmentLineDto[];
  /** Legacy `rec_date` — the operating date of a daily shipment; required at create. */
  collectionDate: string;
  /** Legacy `del_date` — secured only (daily writes `""`→null); never server-validated in legacy. */
  deliveryDate: string | null;
  /** Legacy `receipt_num` / `vault_receipt_num` — stamped by the vault flow (later slice). */
  receiptNumber: string | null;
  vaultReceiptNumber: string | null;
  /** Legacy `serial` — whether banknote serials are tracked for this shipment. */
  serialTracked: boolean;
  notes: string | null;
  /** Legacy `received_user`/`received_date`, stamped on completion, cleared on reopen. */
  receivedById: string | null;
  receivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const OperationsShipmentLineSchema = z
  .object({
    currencyId: objectId(),
    amount: MoneyAmountSchema.refine((v) => v >= 0, {
      message: 'amount must be non-negative (legacy strips the sign)',
    }),
  })
  .strict();

const shipmentCore = {
  shipmentType: OperationsShipmentTypeSchema,
  mainBankId: objectId(),
  secondaryBankId: objectId().nullable().default(null),
  originBranchId: objectId(),
  destinationBranchId: objectId(),
  areaName: z.string().min(1).nullable().default(null),
  lines: z.array(OperationsShipmentLineSchema).min(1).max(17),
  collectionDate: z.coerce.date(),
  deliveryDate: z.coerce.date().nullable().default(null),
  serialTracked: z.boolean().default(false),
  notes: z.string().nullable().default(null),
};

/** A daily shipment never carries a delivery date — legacy hardcodes `del_date: ""` (:353). */
const forbidDailyDeliveryDate = (
  value: { shipmentType: OperationsShipmentType; deliveryDate?: Date | null },
  ctx: z.RefinementCtx,
): void => {
  if (value.shipmentType === 'daily' && value.deliveryDate != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['deliveryDate'],
      message: 'a daily shipment has no delivery date (legacy parity)',
    });
  }
};

/**
 * The collection crew, named at creation — RESTORED legacy behaviour, not a new capability.
 *
 * Legacy wrote `leader1` + `car_num1` on the create handler itself, for daily shipments
 * (contad_app.js:330/336) and محصنة alike (:725/:733): naming who collects the money was part of
 * booking the collection, not a second trip to another screen. ECMS had split it out; this puts it
 * back where the operator already is.
 *
 * THE VEHICLE IS NOT ON THE WIRE, deliberately. `crewAssignmentId` IS a (operating day, vehicle)
 * row, so the vehicle is a FACT of the crew the server reads — not a claim the client makes. A
 * payload carrying its own vehicleId could assert a captain was on a van he was never planned
 * onto, and the server would have to disbelieve it; not accepting it is simpler and cannot drift.
 *
 * Which is also why the FORM can offer the vehicle as an editable field while the wire carries
 * none: picking a captain and picking a vehicle are two ways of choosing the same crew row.
 */
export const CreateOperationsShipmentPickupSchema = z
  .object({ crewAssignmentId: objectId(), captainEmployeeId: objectId() })
  .strict();
export type CreateOperationsShipmentPickup = z.infer<typeof CreateOperationsShipmentPickupSchema>;

export const CreateOperationsShipmentSchema = z
  .object({
    ...shipmentCore,
    /** Absent means "book it now, crew it later" — the backlog path, unchanged. */
    pickup: CreateOperationsShipmentPickupSchema.nullable().optional(),
  })
  .strict()
  .superRefine(forbidDailyDeliveryDate);
export type CreateOperationsShipment = z.infer<typeof CreateOperationsShipmentSchema>;

/** `shipmentType` is immutable — legacy has no path that turns a يومي into a محصنة or back. */
export const UpdateOperationsShipmentSchema = z
  .object({
    mainBankId: objectId().optional(),
    secondaryBankId: objectId().nullable().optional(),
    originBranchId: objectId().optional(),
    destinationBranchId: objectId().optional(),
    areaName: z.string().min(1).nullable().optional(),
    lines: z.array(OperationsShipmentLineSchema).min(1).max(17).optional(),
    collectionDate: z.coerce.date().optional(),
    deliveryDate: z.coerce.date().nullable().optional(),
    serialTracked: z.boolean().optional(),
    notes: z.string().nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateOperationsShipment = z.infer<typeof UpdateOperationsShipmentSchema>;

export const CompleteOperationsShipmentSchema = z
  .object({ version: z.number().int().min(0) })
  .strict();
export type CompleteOperationsShipment = z.infer<typeof CompleteOperationsShipmentSchema>;

export const ReopenOperationsShipmentSchema = CompleteOperationsShipmentSchema;
export type ReopenOperationsShipment = CompleteOperationsShipment;

/**
 * The daily operations board (legacy `/main_ops`) — one day's working set.
 *
 * No pagination: this is a day's work for one desk, and the legacy screen showed it whole. No
 * filters either; the board IS the filter. `date` defaults to today, exactly as the legacy screen
 * did with no picker at all.
 */
export const OperationsDayBoardQuerySchema = z
  .object({ date: z.coerce.date().optional() })
  .strict();
export type OperationsDayBoardQuery = z.infer<typeof OperationsDayBoardQuerySchema>;

export interface OperationsDayBoardDto {
  /** The resolved day, so a client never has to guess what "today" the server meant. */
  date: string;
  /**
   * The union the legacy board showed: daily shipments collected on the day, plus secured
   * shipments DELIVERED on the day that have left the vault. Newest created first.
   */
  shipments: OperationsShipmentDto[];
}

export const ListOperationsShipmentsQuerySchema = PaginationQuerySchema.extend({
  shipmentType: OperationsShipmentTypeSchema.optional(),
  status: listQuery(OperationsShipmentStatusSchema),
  mainBankId: objectId().optional(),
  collectionDateFrom: z.coerce.date().optional(),
  collectionDateTo: z.coerce.date().optional(),
}).strict();
export type ListOperationsShipmentsQuery = z.infer<typeof ListOperationsShipmentsQuerySchema>;

// ── Reports (B5 — the legacy /ops_report and /ops_bank_report screens) ──────────────────────────
//
// WHAT THE LEGACY REPORTS DID (discovery §D, contad_app.js:4837-5440): two structurally identical
// `$facet` aggregations over completed shipments in a date range — one keyed on the captain, one
// on the bank. Daily shipments are attributed by COLLECTION date and secured ones by DELIVERY
// date, which is the same two-date split the whole module turns on.
//
// THREE REGISTERED NORMALIZATIONS, each of which changes a NUMBER a user has seen before, so each
// is stated here rather than discovered later:
//
//   · Q26 — PACKAGE COUNTS WERE MULTIPLIED. After `$unwind` over currency pairs, every row still
//     carried the document's full bag/carton/box counts, and the next `$group` summed them all.
//     A three-currency shipment with 10 bags reported 30. Counted once per shipment here, so
//     package totals will be LOWER than the legacy report for multi-currency shipments — and
//     correct.
//   · Q27 — the grand total was appended INTO the results array, so any consumer that summed the
//     rows double-counted everything. It is a separate field here.
//   · Q28 — a completed shipment with an empty currency list was dropped ENTIRELY, taking its
//     document count with it. Such a shipment is counted here, with zero money.
//
// One more difference, not a quirk but an architecture change: the captain comes from the
// ASSIGNMENT entity (pickup leg for daily, delivery leg for secured), because that is where the
// approved SPLIT put the legacy `leader1`/`leader2` fields. A shipment with no assignment has no
// captain to group under and is reported under the unassigned bucket rather than silently dropped.

export const OperationsReportQuerySchema = z
  .object({
    /** Inclusive. Defaults to the first day of the current month — the legacy default (:4862). */
    from: z.coerce.date().optional(),
    /** Inclusive. Defaults to the last day of the current month. */
    to: z.coerce.date().optional(),
  })
  .strict();
export type OperationsReportQuery = z.infer<typeof OperationsReportQuerySchema>;

/** One currency's total within a report row. */
export interface OperationsReportCurrencyTotalDto {
  currencyId: string | null;
  /** The currency's display name, resolved once by the server so every client agrees. */
  currencyName: string;
  amount: number;
}

/** The figures every report row carries, whatever it is keyed on. */
export interface OperationsReportTotalsDto {
  shipmentCount: number;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  /** Per-currency breakdown. The legacy `total_egp`/`total_usd`/`total_other` buckets are a VIEW
   *  of this, not a storage format — a client that wants them groups by currency itself. */
  currencies: OperationsReportCurrencyTotalDto[];
}

export interface OperationsCaptainReportRowDto {
  /** Null for shipments with no assignment on the relevant leg — reported, never dropped. */
  captainEmployeeId: string | null;
  captainName: string;
  totals: OperationsReportTotalsDto;
}

export interface OperationsBankReportRowDto {
  bankId: string | null;
  bankName: string;
  totals: OperationsReportTotalsDto;
}

export interface OperationsCaptainReportDto {
  from: string;
  to: string;
  rows: OperationsCaptainReportRowDto[];
  /** Q27 NORMALIZE — separate from `rows`, so summing the rows cannot double-count. */
  grandTotal: OperationsReportTotalsDto;
}

export interface OperationsBankReportDto {
  from: string;
  to: string;
  rows: OperationsBankReportRowDto[];
  grandTotal: OperationsReportTotalsDto;
}

// ── Vault roll-up (B6 — the legacy /vault1_reports + /vault1 aggregations) ───────────────────────
//
// WHAT `/vault1_reports` ACTUALLY WAS (discovery §C, contad_app.js:1311-1333): a SHELL. It loaded
// `DataLists`, discarded it, and rendered a template with nothing but the session. Every figure on
// it came from the client re-hitting `/vault1`, which ran TWO aggregations over the same document
// set (`type:محصنة, status:2, deleted:0`, no dates):
//
//   · dataTransaction1 (:1368) — per-BANK roll-up: shipment count, EGP total, non-EGP total, and
//     bags/boxes/cartons. Packages were computed per DOCUMENT here, before any currency unwind,
//     so this one was NOT inflated — unlike the captain/bank reports (Q26). The two screens
//     therefore disagreed with each other about the same packages.
//   · dataTransaction2 (:1524) — the non-EGP breakdown of that same set, with EGP excluded by a
//     literal synonym list `['EGP','مصري','جنيه','جنيه مصري']` (:1409).
//
// ONE QUESTION, ASKED ONCE. Both are views of one roll-up here, and it runs through the SAME code
// path as the bank report — which is what makes it impossible for two screens to report different
// package counts for the same shipments. `foreignCurrencies` is computed server-side rather than
// filtered in a browser, because "which currency is domestic" is a system fact (ECMS's base
// currency, EGP everywhere else in the platform) and not a list a screen should carry.
//
// NO DATE RANGE, deliberately (Q32 PRESERVE): the legacy screen had a date picker whose filters
// were commented out in BOTH aggregations, so it was always all-time — which is the right answer
// for a question about what is in the vault NOW.

export interface OperationsVaultReportDto {
  /** Per-bank roll-up of everything currently held. */
  rows: OperationsBankReportRowDto[];
  grandTotal: OperationsReportTotalsDto;
  /** The system's domestic currency, so no client has to know which one that is. */
  baseCurrencyCode: string;
  /** The legacy second aggregation: the same grand total with the base currency taken out. */
  foreignCurrencies: OperationsReportCurrencyTotalDto[];
}
// ── Crew requirements (B3 — the legacy /requirement screen) ─────────────────────────────────────
//
// WHAT THE LEGACY SCREEN WAS (discovery §9, contad_app.js:4324-4372): a matrix of NINE checkboxes
// written onto the employee document, keyed by `employee_id`. Only ONE of them — `leader` — was
// ever read by a server query (it filtered the captain pickers on /main_ops:274 and /mohsana:667).
// The other eight were pool decoration and browser-side filters on the crew board.
//
// TWO APPROVED DECISIONS SHAPE THIS, and both are load-bearing:
//   1. Requirements gate NOTHING server-side. They are metadata, visual indicators and filters.
//      No slot on the crew board checks them; an employee missing a weapon or a signature can be
//      assigned exactly as in legacy. (Owner decision, carried since PR 1.)
//   2. The record is OPERATIONS-OWNED, not a set of extra columns on the HR employee. Legacy wrote
//      them onto `employees` because it had one database and no module boundary; ECMS does. HR
//      owns the person, Operations owns "what this person is to Operations", and the two meet
//      through the platform directory seam.
//
// A consequence worth stating: holding a requirements record IS what makes someone operations
// crew. That replaces the legacy `department:'نقل الاموال' + sub_department:'التشغيل'` query
// (contad_app.js:2296) with an explicit roster Operations maintains, rather than Operations
// reaching into another module's org structure to infer it.

/**
 * The nine legacy flags, renamed to say what they mean. The legacy Arabic field name is on each,
 * because migration matches on those and a reader needs to find them.
 */
export interface OperationsCrewRequirementsDto {
  id: string;
  employeeId: string;
  /** Legacy `leader` — THE flag legacy actually queried on; marks who may take a captain slot. */
  isCaptain: boolean;
  /**
   * Q17 NORMALIZE. Legacy decided "is a specialist" in the BROWSER by substring-matching the job
   * title against `اخص` (tashghela.ejs:861-863). An explicit flag is the registered replacement.
   */
  isSpecialist: boolean;
  /** Legacy `selah` — carries a weapon. */
  hasWeapon: boolean;
  /** Legacy `tawqe3` — signature on file. */
  hasSignature: boolean;
  /** Legacy `mozawla` — professional practice licence. */
  hasLicense: boolean;
  /** Legacy `mozawla_mo` — temporary licence. Write-only in legacy (Q25); kept, still ungated. */
  hasTemporaryLicense: boolean;
  /** Legacy `ops_emp` — flagged as operations administration staff. Write-only in legacy (Q25). */
  isOpsAdmin: boolean;
  /**
   * Legacy `new` — recently joined; the crew board showed a badge. Named `isNewJoiner` because
   * `isNew` is a reserved Mongoose document property that a schema path of that name would shadow.
   */
  isNewJoiner: boolean;
  /** Legacy `mohema` — earmarked for a specific task. Write-only in legacy (Q25). */
  isAssignedSpecialTask: boolean;
  /** Legacy `priority` — ordering hint. Write-only in legacy (Q25). */
  isPriority: boolean;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const crewRequirementFlags = {
  isCaptain: z.boolean().default(false),
  isSpecialist: z.boolean().default(false),
  hasWeapon: z.boolean().default(false),
  hasSignature: z.boolean().default(false),
  hasLicense: z.boolean().default(false),
  hasTemporaryLicense: z.boolean().default(false),
  isOpsAdmin: z.boolean().default(false),
  isNewJoiner: z.boolean().default(false),
  isAssignedSpecialTask: z.boolean().default(false),
  isPriority: z.boolean().default(false),
  notes: z.string().max(500).nullable().default(null),
};

/** Upsert by employee — the legacy screen had no "create" vs "edit", only a saved checkbox row. */
export const SetOperationsCrewRequirementsSchema = z.object(crewRequirementFlags).strict();
export type SetOperationsCrewRequirements = z.infer<typeof SetOperationsCrewRequirementsSchema>;

export const ListOperationsCrewRequirementsQuerySchema = PaginationQuerySchema.extend({
  /** Free text over the employee's name and code, resolved through the directory seam. */
  search: z.string().min(1).optional(),
  isCaptain: booleanQuery().optional(),
  isSpecialist: booleanQuery().optional(),
}).strict();
export type ListOperationsCrewRequirementsQuery = z.infer<
  typeof ListOperationsCrewRequirementsQuerySchema
>;

/** A crew member as the board's pool shows them: who they are, plus their flags. */
export interface OperationsCrewMemberDto {
  employeeId: string;
  code: string;
  fullNameAr: string;
  /** HR employment status, read through the seam — an exited employee is never offered. */
  status: string;
  requirements: OperationsCrewRequirementsDto | null;
  /**
   * The vehicle this member already holds on the requested day, or null. Legacy computed the same
   * thing in the browser to grey out a taken card (tashghela.ejs:1332) — here it is a server fact,
   * because the SAME rule is enforced server-side as Q11.
   */
  assignedVehicleId: string | null;
}

export interface OperationsCrewDirectoryDto {
  date: string;
  members: OperationsCrewMemberDto[];
  /**
   * Whether the roster came from the ORG CHART rather than the fallback.
   *
   * `false` means no operations department is configured, so this is whoever already holds a
   * requirements row — a frozen list nobody can add to, since adding by hand is gone. It looks
   * identical to a correctly configured roster, which is why the screen has to be told.
   */
  rosterIsDerived: boolean;
}

export const OperationsCrewDirectoryQuerySchema = z
  .object({ date: z.coerce.date().optional() })
  .strict();
export type OperationsCrewDirectoryQuery = z.infer<typeof OperationsCrewDirectoryQuerySchema>;

// ── Crew attendance (B5 — read-only, non-gating) ────────────────────────────────────────────────
//
// THERE IS NO LEGACY `/ops_attendance` ROUTE. Discovery §2.2 checked: it does not exist. The only
// attendance screen in the legacy system is `/fleet_attendance` (contad_app.js:3569), it belongs to
// the DRIVERS department (`الحركة`), it is Fleet's, and ECMS shipped it already in FW-5.
//
// What legacy did for cash-transfer crew was nothing at all: `AbsenceEvent` is queried in six
// places and not one of them asks about `نقل الاموال` or `التشغيل` (discovery §10.2), so
// `/tashghela` would happily assign a captain who was absent. That is recorded as a REAL GAP.
//
// This surface closes the VISIBILITY half of that gap and deliberately not the other half:
//   · it READS attendance HR already computed, through the platform directory seam;
//   · it stores nothing, and adds no attendance write path to Operations;
//   · it GATES NOTHING. An absent crew member is still fully assignable, exactly as in legacy.
//     Attendance is an indicator here, on the same footing as the requirement flags (owner
//     decision, carried since PR 1). Turning it into an eligibility rule would be a new rule.
//
// `attendance: null` means HR has NO answer for that employee and day — not "present". A screen
// must render the difference, because "unknown" and "fine" are not the same fact.

/** One crew member's day, as attendance already computed it. */
export interface OperationsCrewAttendanceDto {
  employeeId: string;
  code: string;
  fullNameAr: string;
  attendance: { status: AttendanceDayStatus; onLeave: boolean } | null;
  /** Whether this member holds a vehicle on the day — the planner's reason for looking. */
  assignedVehicleId: string | null;
}

export interface OperationsCrewAttendanceDayDto {
  date: string;
  members: OperationsCrewAttendanceDto[];
  /**
   * Counts for the header, computed server-side so two screens cannot disagree.
   *
   * FIVE buckets, not three, because HR's ten statuses genuinely mean five different things to a
   * planner and collapsing them would lie: `present` is at-work (including late and early-leave),
   * `notScheduled` is weekend/holiday/day-off, and `unknown` covers both "no record at all" and
   * `incomplete` — attendance itself could not decide, which is not the same as being fine.
   */
  summary: {
    total: number;
    present: number;
    absent: number;
    onLeave: number;
    notScheduled: number;
    unknown: number;
  };
}

export const OperationsCrewAttendanceQuerySchema = z
  .object({ date: z.coerce.date() })
  .strict();
export type OperationsCrewAttendanceQuery = z.infer<typeof OperationsCrewAttendanceQuerySchema>;

// ── Operating day (OP-3) ────────────────────────────────────────────────────────────────────────
//
// NEW — the legacy system has no day entity: "today" is derived per-query by exact-equality date
// match (discovery §5.1, quirk Q15). The explicit day is the approved normalization (design §16.1)
// and the anchor later slices (execution, vault, reports) hang on. It carries NO gating rules in
// OP-3: legacy planning is free of any day lock, and inventing one here would be a new rule.

export interface OperationsDayDto {
  id: string;
  /** UTC midnight — the day IS the identity; unique. */
  date: string;
  status: OperationsDayStatus;
  openedById: string | null;
  openedAt: string | null;
  closedById: string | null;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateOperationsDaySchema = z.object({ date: z.coerce.date() }).strict();
export type CreateOperationsDay = z.infer<typeof CreateOperationsDaySchema>;

export const TransitionOperationsDaySchema = z
  .object({ version: z.number().int().min(0) })
  .strict();
export type TransitionOperationsDay = z.infer<typeof TransitionOperationsDaySchema>;

export const GetOperationsDayQuerySchema = z.object({ date: z.coerce.date() }).strict();
export type GetOperationsDayQuery = z.infer<typeof GetOperationsDayQuerySchema>;

// ── Cash-transfer crew assignment (OP-3) ────────────────────────────────────────────────────────
//
// The legacy tashghela row normalized (discovery §8): one row per (operating day, vehicle) holding
// the CASH crew — captain (قائد) + specialist 1/2 (أخصائي) — plus direction/time/notes. The row
// anchors on the Fleet duty assignment for the same (vehicle, date), per the frozen §9.4 boundary:
// Fleet owns (vehicle, drivers, mission type)/day — the legacy `tybe` maps to Fleet's
// missionTypeId, and the legacy car_lock gate maps to "the vehicle is on the Fleet roster".
// All three crew slots may be EMPTY — the legacy save writes `row.spe1 || ""`
// (contad_app.js:2419) and enforces no minimum crew. Each slot now holds up to
// `CREW_SLOT_CAPACITY` people (see below): the slot structure is legacy, the arity is new.

/**
 * How many people one crew slot holds.
 *
 * Legacy held exactly ONE person per slot — three Strings on the tashghela row
 * (models/tash4ela.js:10-12), one card per cell (tashghela.ejs:914-916), three single values on
 * save (contad_app.js:2416-2418). Two-per-slot is therefore a NEW capability and not a legacy
 * behaviour being restored: nothing was dropped, the ceiling was raised. A crew is now at most
 * two captains + two specialist-1 + two specialist-2 = six people on one vehicle.
 *
 * The slot STRUCTURE is unchanged — still three named slots, because the three mean different
 * things (a captain is not an interchangeable head-count). Only each slot's arity moved.
 */
export const CREW_SLOT_CAPACITY = 2;

export interface OperationsCrewAssignmentDto {
  id: string;
  operationsDayId: string;
  vehicleId: string;
  fleetDutyAssignmentId: string;
  /**
   * The slot's occupants, in the order Operations entered them — at most `CREW_SLOT_CAPACITY`.
   *
   * PLURAL AND RENAMED, not widened in place. The singular `captainEmployeeId` was a scalar
   * ObjectId; had the name stayed, Mongo would have kept matching `{ captainEmployeeId: x }`
   * against an ARRAY containing `x` (its implicit array semantics), so every query would have
   * silently kept working while every `=== employeeId` comparison in JS silently stopped. The
   * rename is what forces the compiler to surface all of them.
   */
  captainEmployeeIds: string[];
  specialist1EmployeeIds: string[];
  specialist2EmployeeIds: string[];
  /** Legacy `direction` — free-text destination label from the fleet destinations list. */
  direction: string | null;
  /** Legacy `time` — free-text planned departure label. */
  plannedTime: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** One board row: the Fleet duty facts (read-only here, §9.4) joined with the cash-crew facts. */
export interface OperationsCrewBoardRowDto {
  vehicleId: string;
  vehicleCode: string;
  fleetDutyAssignmentId: string;
  /** Fleet-owned facts, displayed not edited: the legacy tashghela board showed the drivers too. */
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  missionTypeId: string | null;
  crew: {
    /**
     * The crew row's OWN id — the `crewAssignmentId` every downstream act is addressed by.
     *
     * Its absence was a live defect: the vault dispatch screen had no crew id to send, so it sent
     * `fleetDutyAssignmentId` instead, which is an id from a DIFFERENT collection. Both of that
     * screen's actions therefore 404'd at
     * `operationsCrewAssignmentRepository.findById` (secured.service.ts:185, :274).
     */
    id: string;
    /** Up to `CREW_SLOT_CAPACITY` per slot; `[]` means the slot is empty, never `null`. */
    captainEmployeeIds: string[];
    specialist1EmployeeIds: string[];
    specialist2EmployeeIds: string[];
    direction: string | null;
    plannedTime: string | null;
    notes: string | null;
  } | null;
}

export interface OperationsCrewBoardDto {
  /** The resolved board date — tomorrow when the caller sent none (legacy parity, :2239-2247). */
  date: string;
  day: OperationsDayDto | null;
  rows: OperationsCrewBoardRowDto[];
}

const crewEmployeeSlots = [
  'captainEmployeeIds',
  'specialist1EmployeeIds',
  'specialist2EmployeeIds',
] as const;

/**
 * A slot as it arrives. An omitted slot and an empty one mean the SAME thing — nobody — because
 * `plan()` replaces a whole row: `row.captainEmployeeIds ?? []`. There is no partial-update
 * dialect here and never was, and the board has always sent whole rows.
 *
 * This comment previously claimed absent meant "leave it alone", which is the opposite of what
 * the service does and of what the integration suite pins. A doc that lies about a clearing
 * operation is worse than no doc: the next author reads it, omits a slot to preserve it, and
 * silently wipes a crew.
 */
const crewSlot = (): z.ZodOptional<z.ZodArray<z.ZodString>> =>
  z.array(objectId()).max(CREW_SLOT_CAPACITY).optional();

export const PlanOperationsCrewRowSchema = z
  .object({
    vehicleId: objectId(),
    captainEmployeeIds: crewSlot(),
    specialist1EmployeeIds: crewSlot(),
    specialist2EmployeeIds: crewSlot(),
    direction: z.string().min(1).nullable().optional(),
    plannedTime: z.string().min(1).nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Two rules, one pass. Cross-slot: a person cannot be both captain and specialist on the same
    // vehicle (unchanged in meaning from when each slot held one person). Intra-slot: NEW with
    // capacity 2 — the same person cannot be listed twice inside one slot, which was impossible to
    // express while a slot was a single value and is trivially expressible now.
    const seen = new Set<string>();
    for (const slot of crewEmployeeSlots) {
      const employees = value[slot];
      if (employees === undefined) continue;
      const withinSlot = new Set<string>();
      employees.forEach((employee, position) => {
        if (withinSlot.has(employee)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [slot, position],
            message: 'the same person cannot be listed twice in one crew slot',
          });
        } else if (seen.has(employee)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [slot, position],
            message: 'the same person cannot fill two crew slots on one vehicle',
          });
        }
        withinSlot.add(employee);
        seen.add(employee);
      });
    }
  });
export type PlanOperationsCrewRow = z.infer<typeof PlanOperationsCrewRowSchema>;

/** Upsert per (day, vehicle) — only CHANGED rows are sent (the fleet roster H4 shape). */
export const PlanOperationsCrewSchema = z
  .object({
    date: z.coerce.date(),
    rows: z.array(PlanOperationsCrewRowSchema).min(1).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seenVehicles = new Set<string>();
    const seenEmployees = new Set<string>();
    value.rows.forEach((row, index) => {
      if (seenVehicles.has(row.vehicleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', index, 'vehicleId'],
          message: 'a vehicle appears twice in one plan',
        });
      }
      seenVehicles.add(row.vehicleId);
      // Q11 is UNCHANGED in meaning — one person, one vehicle per operating day. Only the
      // traversal widened: each slot is now a list, so the check flattens it. Three
      // implementations of this rule exist and must move together — here, the service's
      // end-state check, and the repository's `takenCrew`.
      for (const slot of crewEmployeeSlots) {
        const employees = row[slot];
        if (employees === undefined) continue;
        employees.forEach((employee, position) => {
          if (seenEmployees.has(employee)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['rows', index, slot, position],
              // Q11 — the legacy duplicate-crew check lived only in the browser
              // (tashghela.ejs:1332); the domain enforces it now.
              message: 'a crew member may hold one vehicle per operating day (Q11)',
            });
          }
          seenEmployees.add(employee);
        });
      }
    });
  });
export type PlanOperationsCrew = z.infer<typeof PlanOperationsCrewSchema>;

/** No `date` → the board answers for TOMORROW (verbatim legacy behaviour, contad_app.js:2239). */
export const OperationsCrewBoardQuerySchema = z
  .object({ date: z.coerce.date().optional() })
  .strict();
export type OperationsCrewBoardQuery = z.infer<typeof OperationsCrewBoardQuerySchema>;


export const OperationsSettingKeys = {
  /**
   * Which Fleet `operation` (التشغيل) catalog items mark a vehicle as a CASH-TRANSFER vehicle.
   *
   * This is configuration, not a constant, because the catalog is named by the administrator and
   * is deliberately never seeded (fleet.seed.ts:40-43) — the code cannot know what this house
   * called it. Matching the Arabic text "نقل أموال" would be exactly legacy bug H5, which the
   * frozen fleet design records as misspelled, "never matches real data", and explicitly not
   * carried; a mis-set catalog name must not silently empty the standing-crew picker.
   *
   * DEFAULT EMPTY, meaning NO FILTER — every vehicle is offered. An unconfigured install shows
   * more than it should rather than less, because a filter nobody set up must not hide the fleet.
   */
  CashTransferOperationIds: 'operations.cashTransferOperationIds',
  /**
   * Which HR departments hold the operations crew.
   *
   * MEMBERSHIP IS THE ORG CHART, not a list Operations keeps. Legacy found its pool exactly this
   * way — `department:'نقل الاموال', sub_department:'التشغيل'` (contad_app.js:2296) — and ECMS had
   * replaced it with an explicit roster you added people to. That roster is a second list of who
   * works here, and a second list is a list that goes stale: a new hire is invisible to Operations
   * until somebody remembers to add them.
   *
   * Which departments those are is configuration for the same reason the cash-transfer التشغيل is:
   * departments are named by the organization and the code cannot know what this house called
   * them. Matching the Arabic text is the mistake legacy made and the fleet design refused to
   * carry forward.
   *
   * EMPTY means "fall back to whoever already has a requirements row" — the behaviour before this
   * setting existed. An unconfigured install keeps the people it has rather than showing an empty
   * roster with no way to fill it, since adding by hand is no longer possible.
   */
  CrewDepartmentIds: 'operations.crewDepartmentIds',
} as const;

// ── The standing crew (الطاقم الثابت) ───────────────────────────────────────────────────────────
//
// NEW ECMS CAPABILITY. Legacy had NO standing crew: `/tashghela` rendered `t.leader || ""`
// (contad_app.js:2305-2311) and the board started empty every single day, which is why the whole
// crew had to be dragged again each morning. This is the permanent answer to "who normally crews
// this vehicle", from which each day's board is seeded.
//
// WHERE THE VEHICLE LIST COMES FROM, and why it is not derived.
//
// There is no day-independent "this is a cash-transfer vehicle" marker anywhere in ECMS. The
// vehicle record carries make/model (`typeId`), org placement (`branchId`) and a nullable
// `operationId` (التشغيل) — and `operationId` is deliberately never seeded and never migrated
// (fleet.seed.ts:40-43), so it is null on every real row. The one field that does say "نقل أموال"
// is `missionTypeId`, and it lives on the Fleet DUTY row, whose identity is (vehicle, date) — a
// per-day fact, useless to a row that has no day.
//
// Legacy did have a per-vehicle marker: `cars.department == 'نقل اموال'` gated the mission
// dropdown. It lived only in an EJS template, never in a server query, and the frozen fleet design
// records it as bug H5 — misspelled, "never matches real data", explicitly not carried. Reviving
// it as `operationId` would re-import a bug that was deliberately dropped.
//
// So membership is EXPLICIT, exactly as it is for the crew roster next door: HOLDING A ROW IS
// MEMBERSHIP (crew-requirements.model.ts states the same rule for people). A vehicle is a
// cash-transfer vehicle because Operations added it here, and stops being one when the row goes.

/** One vehicle's permanent crew. No date, and deliberately no `notes` and no `isActive`. */
export interface OperationsStandingCrewRowDto {
  id: string;
  vehicleId: string;
  vehicleCode: string;
  /** Same shape and same ceiling as a day's crew — this is the template that day is seeded from. */
  captainEmployeeIds: string[];
  specialist1EmployeeIds: string[];
  specialist2EmployeeIds: string[];
  direction: string | null;
  plannedTime: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OperationsStandingCrewBoardDto {
  rows: OperationsStandingCrewRowDto[];
  /**
   * Fleet vehicles that are NOT in the standing crew yet — what the "add a vehicle" picker offers.
   *
   * Served from here rather than from a Fleet endpoint the browser calls itself, because the web
   * app forbids cross-module imports and the §9.4 boundary puts every Fleet read on the server
   * side of `fleet-boundary.ts`. One request, one boundary, no second module on the client.
   */
  available: { vehicleId: string; vehicleCode: string }[];
  /**
   * Whether `available` was narrowed to the Fleet-designated cash-transfer vehicles.
   *
   * `false` means no التشغيل has been configured yet, so EVERY vehicle is being offered — which
   * the screen must say out loud. Silently offering the whole registry looks identical to
   * offering a correctly filtered one, and the operator would never learn the setting exists.
   */
  availableIsFiltered: boolean;
}

const standingCrewSlot = (): z.ZodOptional<z.ZodArray<z.ZodString>> =>
  z.array(objectId()).max(CREW_SLOT_CAPACITY).optional();

export const SetOperationsStandingCrewRowSchema = z
  .object({
    vehicleId: objectId(),
    captainEmployeeIds: standingCrewSlot(),
    specialist1EmployeeIds: standingCrewSlot(),
    specialist2EmployeeIds: standingCrewSlot(),
    direction: z.string().min(1).nullable().optional(),
    plannedTime: z.string().min(1).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // The same two rules the daily row carries, for the same reasons. They are restated rather
    // than shared because the two schemas are free to diverge and a shared refinement would hide
    // the day the business wants them to.
    const seen = new Set<string>();
    for (const slot of crewEmployeeSlots) {
      const employees = value[slot];
      if (employees === undefined) continue;
      const withinSlot = new Set<string>();
      employees.forEach((employee, position) => {
        if (withinSlot.has(employee)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [slot, position],
            message: 'the same person cannot be listed twice in one crew slot',
          });
        } else if (seen.has(employee)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [slot, position],
            message: 'the same person cannot fill two crew slots on one vehicle',
          });
        }
        withinSlot.add(employee);
        seen.add(employee);
      });
    }
  });
export type SetOperationsStandingCrewRow = z.infer<typeof SetOperationsStandingCrewRowSchema>;

/**
 * Upsert per vehicle — only CHANGED rows are sent, the same shape the daily board saves in.
 *
 * TWO DELIBERATE DIVERGENCES from `PlanOperationsCrewSchema`:
 *
 *   · `rows` may be EMPTY. A save that only removes vehicles has nothing to upsert, and refusing
 *     it would force the client to invent a no-op row.
 *   · An empty row is MEANINGFUL here and is not skipped. On the daily board "no crew and no
 *     annotations" means nothing happened; here it means "this vehicle is in the cash-transfer
 *     fleet and has no standing crew yet", which is a fact worth storing. Membership is the row.
 */
export const SetOperationsStandingCrewSchema = z
  .object({ rows: z.array(SetOperationsStandingCrewRowSchema).max(500) })
  .strict()
  .superRefine((value, ctx) => {
    const seenVehicles = new Set<string>();
    const seenEmployees = new Set<string>();
    value.rows.forEach((row, index) => {
      if (seenVehicles.has(row.vehicleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', index, 'vehicleId'],
          message: 'a vehicle appears twice in one standing crew',
        });
      }
      seenVehicles.add(row.vehicleId);
      // Q11'S DAY-INDEPENDENT SHADOW, and not decoration. A standing crew that puts one person on
      // two vehicles produces a seed that breaks Q11 the moment both vehicles are rostered on the
      // same day — so the seed could never be trusted to author a valid plan. Enforcing it here is
      // what makes the descent safe.
      for (const slot of crewEmployeeSlots) {
        const employees = row[slot];
        if (employees === undefined) continue;
        employees.forEach((employee, position) => {
          if (seenEmployees.has(employee)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['rows', index, slot, position],
              message: 'a crew member may hold one vehicle in the standing crew',
            });
          }
          seenEmployees.add(employee);
        });
      }
    });
  });
export type SetOperationsStandingCrew = z.infer<typeof SetOperationsStandingCrewSchema>;

// ── Vault custody + secured dispatch (OP-4) ─────────────────────────────────────────────────────
//
// The legacy secured (محصنة) lifecycle, normalized. The status ladder stays NON-ORDINAL in
// meaning — it is the legacy codes 0→2→3→1 that the mapping at the top of this file preserves —
// and the custody record below carries the facts the vault stamps at each hand-off.

/**
 * Custody of a secured shipment while it sits with the treasury.
 * `held` = received into the vault (legacy status 2); `released` = handed back out for delivery
 * (legacy status 3). Custody is a SEPARATE dimension from the shipment status: the shipment goes
 * on to `completed` (legacy 1) at the destination, long after custody ended.
 */
export const OPERATIONS_CUSTODY_STATES = ['held', 'released'] as const;
export const OperationsCustodyStateSchema = z.enum(OPERATIONS_CUSTODY_STATES);
export type OperationsCustodyState = z.infer<typeof OperationsCustodyStateSchema>;

export interface OperationsVaultCustodyDto {
  id: string;
  shipmentId: string;
  state: OperationsCustodyState;
  /** Legacy `receipt_num` — typed by the treasurer at receive. */
  receiptNumber: string;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  /** Legacy `bag_seals` / `box_seals` — barcode arrays. */
  bagSeals: string[];
  boxSeals: string[];
  /**
   * Legacy `treasurer_receive` + `treasurer_receive2`. Legacy wrote the FIRST one as `""` on
   * every save (contad_app.js:1211/1266) so the two-man rule never actually recorded two people;
   * here both are required — Q2 NORMALIZE, an explicit decision, not a silent fix.
   */
  receivedByPrimaryId: string;
  receivedBySecondaryId: string;
  receivedAt: string;
  /** Legacy `treasurer_delivery` / `treasurer_delivery_date` — declared but NEVER written (Q3). */
  releasedById: string | null;
  releasedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const ReceiveIntoVaultSchema = z
  .object({
    receiptNumber: z.string().min(1),
    bagCount: z.number().int().min(0).default(0),
    cartonCount: z.number().int().min(0).default(0),
    boxCount: z.number().int().min(0).default(0),
    bagSeals: z.array(z.string().min(1)).max(500).default([]),
    boxSeals: z.array(z.string().min(1)).max(500).default([]),
    receivedByPrimaryId: objectId(),
    receivedBySecondaryId: objectId(),
    /** The shipment's `serial` flag, settable at receive exactly as the legacy edit form did. */
    serialTracked: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Q2's whole point: two DIFFERENT people. One person twice is one person.
    if (value.receivedByPrimaryId === value.receivedBySecondaryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receivedBySecondaryId'],
        message: 'the two receiving treasurers must be different people (dual control)',
      });
    }
  });
export type ReceiveIntoVault = z.infer<typeof ReceiveIntoVaultSchema>;

// ── Shipment assignment: the two legs (OP-4) ────────────────────────────────────────────────────
//
// Replaces the legacy leader1/car_num1 vs leader2/car_num2 field duplication with one entity
// carrying `leg` (discovery §4.1). OP-4 writes the DELIVERY leg — the legacy /tash4ela_mohasana
// step (contad_app.js:4491 sets exactly leader2 + car_num2 and nothing else). Specialists are
// NOT here: they stay resolved through the (day, vehicle) crew assignment, as in legacy.

export interface OperationsShipmentAssignmentDto {
  id: string;
  shipmentId: string;
  leg: OperationsShipmentLeg;
  operationsDayId: string;
  /** Legacy `leader2` for the delivery leg (`leader1` for pickup). */
  captainEmployeeId: string;
  /** Legacy `car_num2` for the delivery leg (`car_num1` for pickup). */
  vehicleId: string;
  /** The (day, vehicle) crew row this leg rides — how specialists are resolved, never copied. */
  crewAssignmentId: string;
  /** 1-based execution order within (operating day, captain). Unique per captain-day. */
  sequence: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Assign the secured delivery leg — the legacy /tash4ela_mohasana bulk save.
 * The captain and vehicle must match a crew assignment on the shipment's delivery day, which is
 * how `day + vehicle + leg → crew` resolves without duplicating the crew onto the shipment.
 */
export const AssignSecuredDeliveryLegSchema = z
  .object({
    crewAssignmentId: objectId(),
    captainEmployeeId: objectId(),
    version: z.number().int().min(0),
  })
  .strict();
export type AssignSecuredDeliveryLeg = z.infer<typeof AssignSecuredDeliveryLegSchema>;

/**
 * Release from the vault and dispatch — the legacy /deliver_mohsana/data call, which posts a
 * tashghela row id (`car_id`) plus the shipment ids it is carrying (deliver_mohsana.ejs:1258).
 * The crew assignment IS that tashghela row.
 */
export const DispatchSecuredShipmentsSchema = z
  .object({
    crewAssignmentId: objectId(),
    shipmentIds: z.array(objectId()).min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.shipmentIds).size !== value.shipmentIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shipmentIds'],
        message: 'a shipment appears twice in one dispatch',
      });
    }
  });
export type DispatchSecuredShipments = z.infer<typeof DispatchSecuredShipmentsSchema>;

/** The `/mohsana` open backlog: every secured shipment not yet completed, NO date filter (:657). */
export const ListSecuredBacklogQuerySchema = PaginationQuerySchema.extend({
  status: listQuery(OperationsShipmentStatusSchema),
}).strict();
export type ListSecuredBacklogQuery = z.infer<typeof ListSecuredBacklogQuerySchema>;

/** The `/vault1` inventory: everything currently held, NO date filter (:1370, Q32 PRESERVE). */
export const ListVaultInventoryQuerySchema = PaginationQuerySchema.strict();
export type ListVaultInventoryQuery = z.infer<typeof ListVaultInventoryQuerySchema>;

/**
 * What the OPERATIONS-facing `/vault1` list returns — deliberately NOT `OperationsVaultCustodyDto`.
 *
 * The custody record above is the treasury's own; this row is the subset the Treasury port hands
 * across the boundary (`VaultCustodyView`). It carries the packaging counts, because the legacy
 * screen totalled bags/boxes/cartons per bank (contad_app.js:1437-1447), and both receiving
 * treasurers, because dual control is only meaningful if both names are visible (Q2). It carries
 * NO seal barcodes: no legacy Operations screen or report read them, so they stay behind the port.
 */
export interface OperationsVaultInventoryRowDto {
  id: string;
  shipmentId: string;
  state: OperationsCustodyState;
  receiptNumber: string;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  receivedByPrimaryId: string;
  receivedBySecondaryId: string;
  receivedAt: string;
  releasedAt: string | null;
}

/** The `/tash4ela_mohasana` + `/deliver_mohsana` list: held, due for delivery on a date (:4447). */
export const ListSecuredDueQuerySchema = z.object({ date: z.coerce.date() }).strict();
export type ListSecuredDueQuery = z.infer<typeof ListSecuredDueQuerySchema>;


// ── Assignment & sequencing (OP-5) ──────────────────────────────────────────────────────────────
//
// The PICKUP leg exists on BOTH shipment types: legacy writes leader1 + car_num1 at creation for
// يومي (contad_app.js:330/336) and for محصنة alike (:725/:733) — the collection run that brings the
// money in. The DELIVERY leg is secured-only (OP-4). Assigning a leg never changes shipment status.

/** Assign the collection (leg 1) crew — the legacy leader1 + car_num1 pair, normalized. */
export const AssignShipmentPickupLegSchema = z
  .object({
    crewAssignmentId: objectId(),
    captainEmployeeId: objectId(),
    version: z.number().int().min(0),
  })
  .strict();
export type AssignShipmentPickupLeg = z.infer<typeof AssignShipmentPickupLegSchema>;

/**
 * Replace a captain's execution order for one operating day, atomically.
 *
 * The payload is the COMPLETE desired order — the fleet-roster "send the whole shape" principle.
 * Positions are derived from the array index, so a duplicate position cannot even be expressed;
 * what the schema guards is a duplicate *assignment*, and what the service guards is completeness
 * (every one of that captain-day's assignments must appear, or the reorder is refused rather than
 * silently dropping work). Each entry carries its own `version`, so a concurrent edit loses with
 * STALE_DOCUMENT exactly as every other ECMS mutation does.
 */
export const ReorderCaptainShipmentsSchema = z
  .object({
    date: z.coerce.date(),
    captainEmployeeId: objectId(),
    leg: OperationsShipmentLegSchema,
    order: z
      .array(
        z
          .object({ assignmentId: objectId(), version: z.number().int().min(0) })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.order.forEach((entry, index) => {
      if (seen.has(entry.assignmentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['order', index, 'assignmentId'],
          message: 'an assignment appears twice in one order',
        });
      }
      seen.add(entry.assignmentId);
    });
  });
export type ReorderCaptainShipments = z.infer<typeof ReorderCaptainShipmentsSchema>;

// ── The captain's route (read model — OP-5 prepares it, the mobile slice consumes it) ───────────
//
// Everything the future mobile screen needs to render an ordered day, and nothing it does not.
// Locations come from the branch reference data's OPTIONAL `location` (design §17.4) — there is no
// second location system, and coordinates stay null until somebody backfills them.

export interface OperationsRouteStopLocationDto {
  branchId: string;
  branchName: string;
  branchCode: string;
  bankName: string;
  areaName: string | null;
  location: OperationsLocation | null;
}

export interface OperationsRouteStopDto {
  assignmentId: string;
  shipmentId: string;
  sequence: number;
  leg: OperationsShipmentLeg;
  shipmentType: OperationsShipmentType;
  /** The shipment's own lifecycle status — NOT an execution state (that arrives with OP-8). */
  status: OperationsShipmentStatus;
  pickup: OperationsRouteStopLocationDto;
  delivery: OperationsRouteStopLocationDto;
  vehicleId: string;
  crewAssignmentId: string;
}

export interface OperationsCaptainRouteDto {
  date: string;
  operationsDayId: string | null;
  captainEmployeeId: string;
  /** The crew behind the wheel, resolved through (day, vehicle) — never copied onto a shipment. */
  crew: {
    crewAssignmentId: string;
    vehicleId: string;
    specialist1EmployeeIds: string[];
    specialist2EmployeeIds: string[];
  }[];
  stops: OperationsRouteStopDto[];
}

export const OperationsCaptainRouteQuerySchema = z
  .object({ date: z.coerce.date(), captainEmployeeId: objectId(), leg: OperationsShipmentLegSchema.optional() })
  .strict();
export type OperationsCaptainRouteQuery = z.infer<typeof OperationsCaptainRouteQuerySchema>;


// ── Captain mobile read model (OP-6) ────────────────────────────────────────────────────────────
//
// NEW ECMS CAPABILITY — there is NO legacy counterpart. The legacy system has no captain-facing
// surface of any kind: a captain never logged in, never saw a route, and never recorded anything.
// Everything up to OP-5 was legacy parity; this is the first slice that adds a capability the
// business did not previously have, so nothing here is measured against legacy behaviour.
//
// READ ONLY. This slice exposes the shape the mobile client needs and NOT the mutations — no
// start, no pickup, no deliver, no unlock. The execution state machine lands in the next slice and
// must be able to do so without changing these contracts, which is why every identifier the
// mutations will need (day, shipment, assignment, sequence, leg, vehicle, both locations) is
// already carried here.
//
// ── IDENTITY MODEL — AN ARCHITECTURAL CONSTRAINT, NOT A UI DETAIL ───────────────────────────────
//
// Captain Mobile is NOT a separate user, account or entity. The captain is an ordinary ECMS
// EMPLOYEE with the ordinary authenticated employee identity. The mobile experience is a
// captain-specific CAPABILITY exposed inside that employee's authenticated profile — the same
// identity that serves Desktop ECMS, with no second identity model anywhere behind it.
//
//   authenticated user → employee → captain assignment for the operating day → ordered shipments
//
// Binding consequences, each enforced rather than merely intended:
//   • There is NO `MobileUser`, no mobile account, no captain login, no mobile-side identity table.
//     The type below carries an `employeeId` — the SAME id the desktop surfaces use — and nothing
//     mobile-specific stands in for it.
//   • The client NEVER supplies a captain id. `OperationsMobileDayQuerySchema` is `.strict()` and
//     has no such field, so identity cannot be asserted by the caller even by accident. The server
//     resolves the employee from the token through the platform directory seam.
//   • CAPABILITY (may this employee open the captain surface at all?) is RBAC — `operationsExecution.own`.
//   • CAPTAINCY (is this employee a captain today, on which vehicles?) is DATA — the (day, vehicle)
//     crew assignment. It is a property of the day's plan, never of the account: `isCaptainOnDay`
//     below is answered from that row, which is why an employee can hold the capability
//     permanently and still not be a captain on a given day.
//   • The day's shipment list therefore hangs off that assignment, never off anything the client
//     sends.
//
// A future surface that needs a second identity model for mobile is a design change requiring its
// own decision — it is not an implementation detail some later slice may quietly introduce.

/**
 * Where a stop sits in the captain's day, as the READ surface can currently know it.
 *
 * DERIVED, never stored: `completed` comes from the shipment's own lifecycle status, `current` is
 * the first stop that is not completed, and everything after it is `locked`. When the execution
 * slice adds real per-assignment execution state, this field keeps its meaning and gains precision
 * — the mobile client's branching does not change.
 */
export const OPERATIONS_STOP_PROGRESS = ['completed', 'current', 'locked'] as const;
export const OperationsStopProgressSchema = z.enum(OPERATIONS_STOP_PROGRESS);
export type OperationsStopProgress = z.infer<typeof OperationsStopProgressSchema>;

export interface OperationsMobileStopDto {
  /** Stable identifiers the execution slice will POST against — all present from OP-6. */
  assignmentId: string;
  shipmentId: string;
  operationsDayId: string;
  sequence: number;
  leg: OperationsShipmentLeg;
  vehicleId: string;
  crewAssignmentId: string;

  shipmentType: OperationsShipmentType;
  /** The shipment's own lifecycle status (legacy-derived ladder), NOT an execution state. */
  status: OperationsShipmentStatus;
  progress: OperationsStopProgress;

  /**
   * How far the CAPTAIN has got on this leg (OP-7). A separate lifecycle from `status` above,
   * owned by a different actor: `status` is the back office's business ladder, this is the
   * captain's execution. They are never written from one another.
   */
  executionStatus: OperationsExecutionStatus;
  startedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  /** The row's `__v`, so a client may send it back as an extra transition precondition. */
  version: number;

  referenceNumber: string | null;
  packaging: { bags: number; cartons: number; boxes: number } | null;

  pickup: OperationsRouteStopLocationDto;
  delivery: OperationsRouteStopLocationDto;
}

export interface OperationsMobileDayDto {
  date: string;
  operationsDayId: string | null;
  dayStatus: OperationsDayStatus | null;
  /**
   * The authenticated EMPLOYEE — the same identity and the same `employeeId` the desktop surfaces
   * use for this person. There is no mobile-specific identity; this is the employee profile viewed
   * through the captain capability.
   */
  captain: { employeeId: string; code: string; fullNameAr: string };
  /**
   * Is this employee a captain ON THIS DAY? Answered from the (day, vehicle) crew assignment, not
   * from the account and not from RBAC.
   *
   * This exists because "planned today with no stops assigned yet" and "not a captain today" are
   * different facts that both yield an empty `stops`, and a client that conflates them tells a
   * rostered captain he has no duty. `assignments` is non-empty exactly when this is true.
   */
  isCaptainOnDay: boolean;
  /**
   * The vehicles and crews the captain is on today — resolved THROUGH the (day, vehicle) crew
   * assignment. Specialists belong to the crew row, never to a shipment: the mobile client reads
   * them from here, and a shipment payload above carries no specialist field at all.
   */
  assignments: {
    crewAssignmentId: string;
    vehicleId: string;
    /**
     * BOTH captains on this vehicle, the reader included. A crew may now carry two captains, and a
     * captain who cannot see his co-captain has an incomplete picture of who is in the van with
     * him — the same reason the specialists are here.
     */
    captainEmployeeIds: string[];
    specialist1EmployeeIds: string[];
    specialist2EmployeeIds: string[];
    direction: string | null;
    plannedTime: string | null;
  }[];
  stops: OperationsMobileStopDto[];
  /** Convenience for the client's headline — the same id as the first non-completed stop. */
  currentAssignmentId: string | null;
}

/** No date → today. The captain is ALWAYS the authenticated user; there is no captain parameter. */
export const OperationsMobileDayQuerySchema = z
  .object({ date: z.coerce.date().optional() })
  .strict();
export type OperationsMobileDayQuery = z.infer<typeof OperationsMobileDayQuerySchema>;

// ── Captain execution (OP-7) ────────────────────────────────────────────────────────────────────
//
// NEW ECMS CAPABILITY. Captain-driven execution, the sequential lock, pickup/delivery confirmation
// from a phone and server-enforced progression have NO legacy counterpart — the legacy system had
// no captain surface to execute anything from.
//
// The stop is addressed by its ASSIGNMENT id, never by a captain id: which stops are the caller's
// is decided by the server from the token (the identity constraint, design §20-هـ). Nothing in
// these shapes lets a client nominate a captain, a sequence or an order.

/** The stop being acted on. There is no captain field here, by design. */
export const OperationsExecutionParamsSchema = z
  .object({ assignmentId: objectId() })
  .strict();
export type OperationsExecutionParams = z.infer<typeof OperationsExecutionParamsSchema>;

/**
 * Execution transitions carry no business input — the ACT is the whole message.
 *
 * `version` is optional: the authoritative concurrency guard is the compare-and-swap on the
 * execution state itself (a transition is legal from exactly one state, so a racing caller's
 * precondition is already gone), and a phone should not have to track document versions to make a
 * legal move. When a client does send it, it is enforced as an additional precondition.
 *
 * Deliberately empty otherwise: no coordinates, no GPS, no free text. Location data stays the
 * READ-ONLY branch reference data PR 6 exposes.
 */
export const OperationsExecutionBodySchema = z
  .object({ version: z.number().int().min(0).optional() })
  .strict();
export type OperationsExecutionBody = z.infer<typeof OperationsExecutionBodySchema>;

/** What a transition returns: the stop's new execution truth, and where the route now stands. */
export interface OperationsExecutionResultDto {
  assignmentId: string;
  shipmentId: string;
  leg: OperationsShipmentLeg;
  sequence: number;
  from: OperationsExecutionStatus;
  executionStatus: OperationsExecutionStatus;
  startedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  version: number;
  /** The stop that is actionable now — the SAME derivation the day read uses. */
  currentAssignmentId: string | null;
}

// ── Events (ADR-008 `<module>.<entity>.<event>`) ────────────────────────────────────────────────

export const OperationsEvents = {
  ShipmentCreated: 'operations.shipment.created',
  ShipmentUpdated: 'operations.shipment.updated',
  ShipmentCompleted: 'operations.shipment.completed',
  ShipmentReopened: 'operations.shipment.reopened',
  ShipmentDeleted: 'operations.shipment.deleted',
  DayCreated: 'operations.day.created',
  DayOpened: 'operations.day.opened',
  DayClosed: 'operations.day.closed',
  CrewPlanned: 'operations.crew.planned',
  CrewAssignmentChanged: 'operations.crewAssignment.changed',
  StandingCrewChanged: 'operations.standingCrew.changed',
  VaultReceived: 'operations.custody.received',
  VaultReleased: 'operations.custody.released',
  SecuredLegAssigned: 'operations.shipmentAssignment.assigned',
  SecuredDispatched: 'operations.shipment.dispatched',
  ShipmentOrderReordered: 'operations.shipmentAssignment.reordered',
  // Captain execution (OP-7, NEW). The entity is `shipmentAssignment` because that is the row the
  // execution state lives on — the same entity the planning facts above describe, now also
  // reporting what the captain did to it. `operations.shipmentAssignment.completed` is therefore
  // distinct from `operations.shipment.completed`: the first is "the captain finished this leg",
  // the second is "the back office closed the shipment". Two different facts, two different names.
  ExecutionStarted: 'operations.shipmentAssignment.started',
  ExecutionPickupConfirmed: 'operations.shipmentAssignment.pickedUp',
  ExecutionDeliveryConfirmed: 'operations.shipmentAssignment.delivered',
  ExecutionCompleted: 'operations.shipmentAssignment.completed',
} as const;
export type OperationsEventName = (typeof OperationsEvents)[keyof typeof OperationsEvents];

export const OperationsShipmentEventPayloadV1 = z.object({
  shipmentId: objectId(),
  shipmentType: OperationsShipmentTypeSchema,
  status: OperationsShipmentStatusSchema,
});

export const OperationsDayEventPayloadV1 = z.object({
  dayId: objectId(),
  date: z.date(),
  status: OperationsDayStatusSchema,
});

export const OperationsCrewPlannedPayloadV1 = z.object({
  dayId: objectId(),
  date: z.date(),
  changedCount: z.number().int().min(0),
});

/**
 * The permanent crew of one vehicle changed, or the vehicle left the cash-transfer fleet.
 *
 * `removed` is what tells the two apart, and it carries the emptied slots rather than omitting
 * them: a subscriber that only ever sees "captains: []" cannot distinguish a vehicle whose crew
 * was cleared from one that is gone.
 */
export const OperationsStandingCrewChangedPayloadV1 = z.object({
  standingCrewId: objectId(),
  vehicleId: objectId(),
  removed: z.boolean(),
  captainEmployeeIds: z.array(objectId()),
  specialist1EmployeeIds: z.array(objectId()),
  specialist2EmployeeIds: z.array(objectId()),
});

export const OperationsCrewAssignmentChangedPayloadV1 = z.object({
  dayId: objectId(),
  vehicleId: objectId(),
  date: z.date(),
  captainEmployeeIds: z.array(objectId()),
  specialist1EmployeeIds: z.array(objectId()),
  specialist2EmployeeIds: z.array(objectId()),
});

export const OperationsCustodyEventPayloadV1 = z.object({
  custodyId: objectId(),
  shipmentId: objectId(),
  state: OperationsCustodyStateSchema,
});

export const OperationsShipmentAssignmentPayloadV1 = z.object({
  assignmentId: objectId(),
  shipmentId: objectId(),
  leg: OperationsShipmentLegSchema,
  captainEmployeeId: objectId(),
  vehicleId: objectId(),
});

export const OperationsShipmentReorderedPayloadV1 = z.object({
  operationsDayId: objectId(),
  captainEmployeeId: objectId(),
  leg: OperationsShipmentLegSchema,
  count: z.number().int().min(0),
});

/**
 * One captain execution transition (OP-7). Carries `from`/`to` so a subscriber can tell WHICH step
 * happened without re-deriving it from the event name, and the day + sequence so a consumer can
 * place the stop on the route without a second read.
 */
export const OperationsShipmentExecutionPayloadV1 = z.object({
  assignmentId: objectId(),
  shipmentId: objectId(),
  operationsDayId: objectId(),
  captainEmployeeId: objectId(),
  vehicleId: objectId(),
  leg: OperationsShipmentLegSchema,
  sequence: z.number().int().min(1),
  from: OperationsExecutionStatusSchema,
  to: OperationsExecutionStatusSchema,
});
