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

export const CreateOperationsShipmentSchema = z
  .object(shipmentCore)
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

export const ListOperationsShipmentsQuerySchema = PaginationQuerySchema.extend({
  shipmentType: OperationsShipmentTypeSchema.optional(),
  status: listQuery(OperationsShipmentStatusSchema),
  mainBankId: objectId().optional(),
  collectionDateFrom: z.coerce.date().optional(),
  collectionDateTo: z.coerce.date().optional(),
}).strict();
export type ListOperationsShipmentsQuery = z.infer<typeof ListOperationsShipmentsQuerySchema>;

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
// All three crew slots are nullable — the legacy save writes `row.spe1 || ""`
// (contad_app.js:2419) and enforces no minimum crew.

export interface OperationsCrewAssignmentDto {
  id: string;
  operationsDayId: string;
  vehicleId: string;
  fleetDutyAssignmentId: string;
  captainEmployeeId: string | null;
  specialist1EmployeeId: string | null;
  specialist2EmployeeId: string | null;
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
    captainEmployeeId: string | null;
    specialist1EmployeeId: string | null;
    specialist2EmployeeId: string | null;
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
  'captainEmployeeId',
  'specialist1EmployeeId',
  'specialist2EmployeeId',
] as const;

export const PlanOperationsCrewRowSchema = z
  .object({
    vehicleId: objectId(),
    captainEmployeeId: objectId().nullable().optional(),
    specialist1EmployeeId: objectId().nullable().optional(),
    specialist2EmployeeId: objectId().nullable().optional(),
    direction: z.string().min(1).nullable().optional(),
    plannedTime: z.string().min(1).nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const slot of crewEmployeeSlots) {
      const employee = value[slot];
      if (employee == null) continue;
      if (seen.has(employee)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [slot],
          message: 'the same person cannot fill two crew slots on one vehicle',
        });
      }
      seen.add(employee);
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
      for (const slot of crewEmployeeSlots) {
        const employee = row[slot];
        if (employee == null) continue;
        if (seenEmployees.has(employee)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rows', index, slot],
            // Q11 — the legacy duplicate-crew check lived only in the browser
            // (tashghela.ejs:1332); the domain enforces it now.
            message: 'a crew member may hold one vehicle per operating day (Q11)',
          });
        }
        seenEmployees.add(employee);
      }
    });
  });
export type PlanOperationsCrew = z.infer<typeof PlanOperationsCrewSchema>;

/** No `date` → the board answers for TOMORROW (verbatim legacy behaviour, contad_app.js:2239). */
export const OperationsCrewBoardQuerySchema = z
  .object({ date: z.coerce.date().optional() })
  .strict();
export type OperationsCrewBoardQuery = z.infer<typeof OperationsCrewBoardQuerySchema>;


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
    specialist1EmployeeId: string | null;
    specialist2EmployeeId: string | null;
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

  referenceNumber: string | null;
  packaging: { bags: number; cartons: number; boxes: number } | null;

  pickup: OperationsRouteStopLocationDto;
  delivery: OperationsRouteStopLocationDto;
}

export interface OperationsMobileDayDto {
  date: string;
  operationsDayId: string | null;
  dayStatus: OperationsDayStatus | null;
  captain: { employeeId: string; code: string; fullNameAr: string };
  /**
   * The vehicles and crews the captain is on today — resolved THROUGH the (day, vehicle) crew
   * assignment. Specialists belong to the crew row, never to a shipment: the mobile client reads
   * them from here, and a shipment payload above carries no specialist field at all.
   */
  assignments: {
    crewAssignmentId: string;
    vehicleId: string;
    specialist1EmployeeId: string | null;
    specialist2EmployeeId: string | null;
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
  VaultReceived: 'operations.custody.received',
  VaultReleased: 'operations.custody.released',
  SecuredLegAssigned: 'operations.shipmentAssignment.assigned',
  SecuredDispatched: 'operations.shipment.dispatched',
  ShipmentOrderReordered: 'operations.shipmentAssignment.reordered',
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

export const OperationsCrewAssignmentChangedPayloadV1 = z.object({
  dayId: objectId(),
  vehicleId: objectId(),
  date: z.date(),
  captainEmployeeId: objectId().nullable(),
  specialist1EmployeeId: objectId().nullable(),
  specialist2EmployeeId: objectId().nullable(),
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
