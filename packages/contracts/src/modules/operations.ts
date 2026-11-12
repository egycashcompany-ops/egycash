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
  asciiDigits,
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

// ── Secured stage (Round 8 — the محصنة row's colour) ───────────────────────────────────────────

/**
 * Where a SECURED shipment stands, as the secured screen, the vault's receive screen and the day
 * board colour its row. DERIVED on the server, never stored and never sent back: it reads the
 * shipment's own `status` and, while it is `draft`, the shipment's PICKUP RECORD — who confirmed
 * collecting it (`OperationsDayBoardShipmentDto.pickedUpBy`). The owner's words: «لما القائد هيستلم
 * من البنك ويعمل علامة صح هيبقى الصف باللون الاصفر … ولما الخزنة تدوس صح ساعتها هتبقى اخضر عند الخزنة
 * وعند العمليات وفى اللحظه دى المحصنة هتبقى موجوده فى صرف الخزينه», and in Round 10: «ممكن القائد اللى
 * يعمل صح انه استلم او العمليات ف لو قائد تم الاستلام من القائد و لو العمليات تم الاستلام من العمليات».
 *
 *   awaitingPickup  status `draft`, nobody has confirmed the pickup (`pickedUpBy` null) — «لم يتم
 *                   التسليم», a WHITE row. The vault cannot receive it (Round 10): it shows on the
 *                   vault's screen under «الكل» for viewing only.
 *   withCaptain     status `draft`, the pickup was confirmed by its CAPTAIN — his ✓ in the mobile
 *                   app on collecting it from the bank (`pickedUpBy: 'captain'`) — «تم الاستلام من
 *                   القائد», a YELLOW row. From this moment the vault's receive screen lists it by
 *                   default and may receive it.
 *   withOperations  (Round 10) status `draft`, the pickup was confirmed by the OPERATIONS desk
 *                   (`POST /operations/secured/:id/pickup` — `pickedUpBy: 'operations'`) — «تم
 *                   الاستلام من العمليات», a YELLOW row exactly like `withCaptain`: listed by default
 *                   on the vault's receive screen and receivable.
 *   inVault         status `inVault` — the vault's ✓ (the receive form) — «بالخزينة», a GREEN row,
 *                   on the secured screen and on the vault's alike; it is now on «صرف الخزينة»
 *                   (`GET /operations/secured/dispatch-board`). From here the shipment is LOCKED
 *                   (`isOperationsShipmentLocked`).
 *   dispatched      status `dispatched` — it left the vault for delivery — «خرجت للتسليم».
 *   completed       status `completed` — the desk confirmed the delivery — «تم التسليم».
 *
 * THE PICKUP IS ONE RECORD ON THE SHIPMENT (Round 10), written by whichever ✓ came first and read
 * by nothing else: the captain's ✓ in the app writes it (`by: 'captain'`) when the shipment is a
 * secured draft with no pickup recorded, the desk's ✓ writes it (`by: 'operations'`), and the desk's
 * undo (`DELETE /operations/secured/:id/pickup`) clears it — WHOEVER wrote it, until the vault
 * receives («لو القائد عمل صح ممكن العمليات تشيلها بس لو العمليات عملت صح القائد مينفعش يشيلها»: the
 * captain's app has no undo, and never overwrites the desk's ✓). The undo does not rewrite the
 * captain's pickup LEG — the leg stays his execution record; the stage reads the shipment's record.
 *
 * Daily shipments have no stage (`securedStage: null` on their rows).
 */
export const OPERATIONS_SECURED_STAGES = [
  'awaitingPickup',
  'withCaptain',
  'withOperations',
  'inVault',
  'dispatched',
  'completed',
] as const;
export const OperationsSecuredStageSchema = z.enum(OPERATIONS_SECURED_STAGES);
export type OperationsSecuredStage = z.infer<typeof OperationsSecuredStageSchema>;

/**
 * The stages the VAULT may receive from (Round 10 — «مش هيقدر يعمل صح الا لما القائد او العمليات
 * تبقى عامله صح»): the two yellow ones. `POST /operations/secured/:id/receive` refuses an
 * `awaitingPickup` shipment with 409 `OPERATIONS_SECURED_NOT_PICKED_UP`.
 */
export const OPERATIONS_SECURED_RECEIVABLE_STAGES: readonly OperationsSecuredStage[] = [
  'withCaptain',
  'withOperations',
];

/**
 * WHO confirmed collecting a secured shipment — the pickup record's `by` (Round 10):
 *   captain     his ✓ in the mobile app — «تم الاستلام من القائد» (stage `withCaptain`);
 *   operations  the Operations desk's ✓ — «تم الاستلام من العمليات» (stage `withOperations`).
 * See `OperationsDayBoardShipmentDto.pickedUpBy`.
 */
export const OPERATIONS_SECURED_PICKED_UP_BY = ['captain', 'operations'] as const;
export const OperationsSecuredPickedUpBySchema = z.enum(OPERATIONS_SECURED_PICKED_UP_BY);
export type OperationsSecuredPickedUpBy = (typeof OPERATIONS_SECURED_PICKED_UP_BY)[number];

/**
 * Is this shipment LOCKED (Round 10 — «الشاشه بتاعت استلام الخزينة لما تعمل صح ميقدر حد من القادة او
 * العمليات او الخزنه يعدل عليها»)? A SECURED shipment is locked from the vault's ✓ on — every status
 * but `draft` (`inVault`, `dispatched`, `completed`). Daily shipments are never locked.
 *
 * The server refuses, with 409 `OPERATIONS_SECURED_LOCKED`, every change of a locked shipment's
 * data: `PATCH /operations/shipments/:id`, `DELETE /operations/shipments/:id`, the receipt photo
 * (`POST`/`DELETE /operations/shipments/:id/receipt-image` — reading it stays open; the platform's
 * own file routes refuse replacing or deleting that photo with 403 too), the pickup crew
 * (`POST /operations/assignments/shipments/:id/assign-pickup`) and the desk's pickup ✓ and its undo
 * (`POST`/`DELETE /operations/secured/:id/pickup`). The FLOW acts stay open — they move the shipment
 * along, they do not rewrite it: the delivery crew (`assign-delivery`), the dispatch, both captains'
 * execution in the app, and the desk's completion ✓ and its undo. Restoring a deleted shipment is
 * unaffected (it was deleted while open). The one way back is `POST
 * /operations/secured/:id/cancel-receipt`, behind its own grant (`operationsVault.cancelReceipt`).
 */
export const isOperationsShipmentLocked = (shipment: {
  shipmentType: OperationsShipmentType;
  status: OperationsShipmentStatus;
}): boolean => shipment.shipmentType === 'secured' && shipment.status !== 'draft';

/** The pickup-leg execution states that mean the captain has the shipment in hand. */
export const OPERATIONS_PICKED_UP_EXECUTION_STATUSES: readonly OperationsExecutionStatus[] = [
  'pickedUp',
  'delivered',
  'completed',
];

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
  /**
   * The currency's place in the catalog's ARRANGED order — 0 first — or null while nobody has
   * arranged the list. «اعملى فى شاشة البيانات المرجعية ان اقدر اعدل زى شاشة الحركة بالظبط»: the
   * reference-data screen drags the currencies into order exactly as Fleet's catalogs are dragged
   * (`PUT /operations/currencies/order`), and every screen that lists currencies — a board row's
   * money lines, the «عملات أخرى» dialog, the shipment form's pickers — follows that order.
   *
   * THE ORDER THE LIST ENDPOINT ANSWERS IN when no `sortBy` is asked for: `sortOrder` ascending
   * (null after every placed one), then `code` NUMERIC-AWARE ('2' before '10', `EGP` before `USD`),
   * then `name`. A screen ordering money lines does the same: by this field, then by code.
   */
  sortOrder: number | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const currencyCore = {
  code: z.string().min(1).max(8),
  name: z.string().min(1),
  legacyAliases: z.array(z.string().min(1)).max(20).default([]),
  /**
   * Optional on create and edit — the drag order (`PUT /operations/currencies/order`) is the
   * usual way to set it. Left out on create, a new currency joins the END of a list somebody has
   * arranged, and stays null on a list nobody has (the Fleet catalogs' rule).
   */
  sortOrder: z.number().int().min(0).nullable().optional(),
};
export const CreateOperationsCurrencySchema = z.object(currencyCore).strict();
export type CreateOperationsCurrency = z.infer<typeof CreateOperationsCurrencySchema>;
export const UpdateOperationsCurrencySchema = z
  .object(currencyCore)
  .partial()
  .extend({ isActive: z.boolean().optional(), version: z.number().int().min(0) })
  .strict();
export type UpdateOperationsCurrency = z.infer<typeof UpdateOperationsCurrencySchema>;

/**
 * `PUT /operations/currencies/order` (`operationsCatalog.manage`) → 204 — save the catalog's
 * dragged order, the Fleet catalogs' `PUT /fleet/catalogs/order` exactly («زى شاشة الحركة
 * بالظبط»). The ids named come first, in the order given; every currency NOT named keeps its old
 * place after them, so a list filtered on screen cannot lose the order of what it was not showing.
 * An id that is not a live currency → 409 (code `DUPLICATE`, the generic conflict — what the Fleet
 * catalogs' order answers too); nothing is written. Versions are left alone (a place in a list
 * is not a fact the edit dialog carries, so reordering never makes the next edit stale). Audited
 * as one `update` with the field `order` (old → new, as codes).
 */
export const OrderOperationsCurrenciesSchema = z
  .object({
    ids: z
      .array(objectId())
      .min(1)
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'A currency is listed twice' }),
  })
  .strict();
export type OrderOperationsCurrencies = z.infer<typeof OrderOperationsCurrenciesSchema>;

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

/** The file category a shipment's receipt photo is stored under (platform Files). */
export const OPERATIONS_SHIPMENT_RECEIPT_FILE_CATEGORY = 'operations-shipment-receipts';

/** A shipment's receipt photo — the file is read through the shipment, never by its id alone. */
export interface OperationsShipmentReceiptImageDto {
  fileId: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: string;
}

export interface OperationsShipmentDto {
  id: string;
  shipmentType: OperationsShipmentType;
  status: OperationsShipmentStatus;
  /**
   * Legacy `main_bank` — البنك الرئيسي, the bank BILLED for the shipment (legacy requires it —
   * contad_app.js:313). Every per-bank roll-up keys on it, in legacy (/ops_bank_report, /vault1)
   * and here. It is NOT necessarily the bank the money is collected from: that is the origin
   * branch's own bank, which legacy never stored and this DTO does not either.
   */
  mainBankId: string;
  /**
   * Legacy `sec_bank` via `toBankSelect` — the DESTINATION branch's bank when it differs from the
   * main bank; null means "the main bank". Never server-validated in legacy, so nullable.
   */
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
  /**
   * «صورة الإيصال» — a photo of the shipment's paper receipt, uploaded from the day board's row
   * (`POST/GET/DELETE /operations/shipments/:id/receipt-image`), or null. No legacy counterpart.
   */
  receiptImage: OperationsShipmentReceiptImageDto | null;
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
 * did with no picker at all — TODAY ON THE CAIRO CALENDAR, the same "today" the date rules below
 * hold a new shipment to, so a shipment booked for today is on the board that opens with no date
 * («هنشيل التاريخ لان هو هيجيب بتاعت اليوم»), even in the hours after Cairo midnight when UTC is
 * still on yesterday.
 */
export const OperationsDayBoardQuerySchema = z
  .object({ date: z.coerce.date().optional() })
  .strict();
export type OperationsDayBoardQuery = z.infer<typeof OperationsDayBoardQuerySchema>;

/**
 * THE SHIPMENTS HISTORY — the day board over a RANGE of days: «عاوز اعمل dublicat للشاشة دى بس
 * التاريخ هيكون من الى … عشان اقدر امسك الhistory بتاع الشحنات».
 *
 * «المفروض الشاشة اللى احنا عملينها history تكون شحنات ومحصنات» — shipments AND secured ones, over
 * every day from `from` to `to` (both inclusive):
 *   · daily shipments COLLECTED in the range;
 *   · secured shipments whose COLLECTION date OR DELIVERY date falls in the range — whatever their
 *     stage, so a محصنة is found on the day it was collected and on the day it goes out, from
 *     «لم يتم التسليم» to «تم التسليم». Listed once even when both dates are in the range.
 * So a history day is the day board of that day PLUS the secured shipments collected on it (the
 * day board lists a secured shipment on its delivery day only). Bounded twice so a history read
 * stays a screen and not an export: at most `OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS` days, and a
 * range holding more than `OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS` shipments is REFUSED with 422
 * `OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE` (never cut short — totals over a silently truncated list
 * would be wrong figures).
 */
export const OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS = 366;
export const OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS = 5000;

/**
 * The UTC day an instant falls on, as a whole day number. The two rules below are checked on the
 * DAYS the server resolves `from` and `to` to (it serves whole UTC days), not on the instants
 * sent: on instants, `2026-08-01T18:00Z → 2026-08-01T06:00Z` (one day) read as backwards, and a
 * pair of times a few hours either side of midnight slipped a 367th day past the cap.
 */
const historyDay = (d: Date): number => Math.floor(d.getTime() / 86_400_000);

export const OperationsShipmentHistoryQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    /**
     * Round 12 — OPTIONAL, one shipment type only. «سجل الخزينة» is «سجل الشحنات» for the محصنات
     * alone («شاشة جرد الخزينة تكون سجل الخزينه المحصنات زى شاشة سجل الشحنات بالظبط»), so it asks
     * `type=secured`: the secured half of the union exactly as it stands (collected OR delivered in
     * the range, any stage), no dailies. `type=daily` is the other half (collected in the range).
     * Left out → both, as before. The row cap is counted AFTER the filter, so a range too large for
     * the whole history may still be served for one type. The answer's shape does not change.
     */
    type: OperationsShipmentTypeSchema.optional(),
  })
  .strict()
  .refine((q) => historyDay(q.from) <= historyDay(q.to), {
    message: 'from must not be after to',
    path: ['from'],
  })
  .refine(
    (q) => historyDay(q.to) - historyDay(q.from) + 1 <= OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS,
    {
      message: `the range is longer than ${OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS} days`,
      path: ['to'],
    },
  );
export type OperationsShipmentHistoryQuery = z.infer<typeof OperationsShipmentHistoryQuerySchema>;

/** The history answer: the day board's rows and crews, over the range. */
export interface OperationsShipmentHistoryDto {
  /** The resolved first and last day (UTC midnight ISO strings), both inclusive. */
  from: string;
  to: string;
  /** Newest created first, as the day board. */
  shipments: OperationsDayBoardShipmentDto[];
  /** As `OperationsDayBoardDto.crews` — empty without `operationsCrew.view`. */
  crews: OperationsDayBoardVehicleCrewDto[];
}

export interface OperationsDayBoardDto {
  /** The resolved day, so a client never has to guess what "today" the server meant. */
  date: string;
  /**
   * The day's work: daily shipments COLLECTED on the day, plus secured shipments due for DELIVERY
   * on the day — WHATEVER their stage («اليوم التشغيلى هيظهر فيها اليومى والمحصنة اللى اليوم بتاعها
   * فى اليوم اللى هتخرج فيه»). Round 8 dropped the legacy `status: [1,3]` filter (dispatched or
   * completed only): a محصنة due today is on today's board from the moment it is booked, coloured
   * by its `securedStage`. Newest created first.
   */
  shipments: OperationsDayBoardShipmentDto[];
  /**
   * The crews the rows ride, for the van's card. Empty for a reader without
   * `operationsCrew.view` — the crew plan is that grant's.
   */
  crews: OperationsDayBoardVehicleCrewDto[];
}

/**
 * A branch as the board prints it — the name and code legacy showed, and the bank it belongs to.
 *
 * Resolved on the server because the board's own branch lookups were capped at one page: past the
 * hundredth branch, the screen printed a blank where a name belonged. The bank matters too — the
 * main bank is the BILLED bank, so the bank the money came from is only known through its branch.
 */
export interface OperationsDayBoardBranchDto {
  id: string;
  name: string;
  code: string;
  bankId: string;
  /** The bank's operational name (`opsName`), as every Operations screen labels a bank. */
  bankName: string;
}

/**
 * The crew this shipment rides with on the board — the leg the row is about RIGHT NOW:
 *   · daily   → the PICKUP leg (legacy `car_num1/leader1`, main_ops.ejs:858-881);
 *   · secured → the PICKUP leg while the shipment is still `draft` (awaitingPickup / withCaptain:
 *               the captain going to the bank, or carrying it to the vault), then the DELIVERY leg
 *               from `inVault` on (legacy `car_num2/leader2` — the leg the captain report attributes
 *               it to). An `inVault` shipment whose delivery leg is not crewed yet has `crew: null`.
 */
export interface OperationsDayBoardCrewDto {
  /** The crew row this leg rides — the key into `OperationsDayBoardDto.crews`. */
  crewAssignmentId: string;
  vehicleId: string;
  /** Null when Fleet no longer answers for the vehicle — shown as missing, never as blank. */
  vehicleCode: string | null;
  captainEmployeeId: string;
  /** Null when the directory cannot name the employee. */
  captainName: string | null;
  /**
   * The captain's card on the board («زى ما عاملين فى الحركه» — the Fleet driver card's facts):
   * his employee code and branch, and his phone. Null where the directory has none; the phone is
   * also null for a reader without `operationsCrew.view`.
   */
  captainCode: string | null;
  captainPhone: string | null;
  captainBranchId: string | null;
}

/** A person on a board crew card — named from the HR directory, null where it cannot. */
export interface OperationsDayBoardPersonDto {
  employeeId: string;
  code: string | null;
  fullNameAr: string | null;
}

/**
 * A DRIVER on a board crew card: the name, and nothing else. «انا وقفت العربية، انا هعرف مين
 * السواقين اللي عليها، لكن مش عايز اعرف بياناتهم» — a driver's details (code, phone, branch) are
 * Fleet's, kept apart from HR, so Operations names the driver and stops there.
 */
export interface OperationsDayBoardDriverDto {
  employeeId: string;
  fullNameAr: string | null;
}

/**
 * WHO RIDES ONE VAN on the board's legs — «لما اقف على العربيه تجيب مين اللى متعين عليها من سواقيين
 * واخصائيين». One per crew row the day's legs ride (not per shipment): the Fleet duty row's two
 * drivers, and the crew row's captains and specialists, in their slots.
 */
export interface OperationsDayBoardVehicleCrewDto {
  crewAssignmentId: string;
  vehicleId: string;
  vehicleCode: string | null;
  /** By name only — see `OperationsDayBoardDriverDto`. */
  drivers: OperationsDayBoardDriverDto[];
  captains: OperationsDayBoardPersonDto[];
  specialist1: OperationsDayBoardPersonDto[];
  specialist2: OperationsDayBoardPersonDto[];
  direction: string | null;
  plannedTime: string | null;
}

/**
 * A board row: the shipment itself, plus what the legacy table printed beside it. EXTENDS the
 * shipment DTO, so a reader that only knows a shipment reads it exactly as before.
 */
export interface OperationsDayBoardShipmentDto extends OperationsShipmentDto {
  /** Null only when the branch record itself is gone. */
  origin: OperationsDayBoardBranchDto | null;
  destination: OperationsDayBoardBranchDto | null;
  /**
   * Null until the shipment is crewed on its leg — "book now, crew later" is a normal state. Which
   * leg: see `OperationsDayBoardCrewDto`.
   */
  crew: OperationsDayBoardCrewDto | null;
  /**
   * When the crew captain confirmed DELIVERY to the destination from the mobile app, or null: the
   * PICKUP leg's for a daily shipment, the DELIVERY leg's for a secured one — always, whichever
   * leg `crew` shows (a secured pickup leg "delivers" to the vault, never to the branch). Read from
   * the leg's `executionStatus` reaching `delivered` or `completed`, and its `deliveredAt`.
   * Separate from the shipment's own `status`: the captain's act never completes the shipment —
   * the desk's ✓ does. The day board shows the first as «تم التسليم» on a yellow row, the second
   * on a green one.
   */
  captainDeliveredAt: string | null;
  /**
   * SECURED rows only (null on a daily row): where the محصنة stands — see
   * `OPERATIONS_SECURED_STAGES` for the five stages, their Arabic labels and their row colours.
   */
  securedStage: OperationsSecuredStage | null;
  /**
   * Round 10 — SECURED rows only (null on a daily row): WHO confirmed collecting the shipment, as
   * the yellow row's label says it — `'captain'` («تم الاستلام من القائد», his ✓ in the mobile app)
   * or `'operations'` («تم الاستلام من العمليات», the desk's ✓ — `POST /operations/secured/:id/pickup`)
   * — or null while nobody has (`awaitingPickup`, white). It is the shipment's ONE pickup record
   * (see `OPERATIONS_SECURED_STAGES`), and `securedStage` is read from it. It stays set through the
   * later stages (a row in the vault still says who brought it) and through a cancelled receipt.
   *
   * A row from before Round 10 whose record was never written reads `'captain'` when its pickup
   * leg was already picked up in the app — exactly what its stage said before.
   *
   * What a screen offers from it, on a DRAFT row (`status === 'draft'`):
   *   · the desk's ✓ when it is null (grant `operationsShipment.complete`);
   *   · the desk's undo when it is set — `'captain'` OR `'operations'`: the desk may take back the
   *     captain's ✓ too (grant `operationsShipment.complete`). The captain's app has no undo;
   *   · the vault's ✓ when it is set (`OPERATIONS_SECURED_RECEIVABLE_STAGES`, grant
   *     `operationsVault.receive`).
   * None of them once the row is not draft (`isOperationsShipmentLocked`).
   *
   * Replaces Round 8's `captainPickedUpAt` (removed): the leg's own stamp could disagree with the
   * record once the desk takes a captain's ✓ back, and the board must say one thing.
   */
  pickedUpBy: OperationsSecuredPickedUpBy | null;
  /**
   * When the pickup in `pickedUpBy` was confirmed (ISO instant) — the captain's ✓ or the desk's;
   * null with it. On a pre-Round-10 row read as the captain's, his leg's `pickedUpAt`.
   */
  pickedUpAt: string | null;
}

// ── The dates a person may give a shipment ──────────────────────────────────────────────────────
//
// «مينفعش لما يجى يضيف شحنه يختار تاريخ فات» and «ميقدرش يحدد يوم قبل يوم اللى كانت عليه الشحنة».
// Enforced by the server on `POST /operations/shipments` and `PATCH /operations/shipments/:id`
// (every screen that books or edits a shipment goes through those two):
//
//   · CREATE — `collectionDate`, and a secured shipment's `deliveryDate` when it is given, may not
//     fall before TODAY on the Cairo calendar → 422 `OPERATIONS_SHIPMENT_DATE_IN_PAST`. A secured
//     shipment's board day IS its delivery date, so a past one would book it onto a past board.
//   · EDIT — a new `collectionDate` may not fall before the day the shipment is on now, and a new
//     `deliveryDate` not before the one it has → 422 `OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL`.
//     Moving a date LATER, or sending it unchanged, is always accepted. A delivery date set for the
//     first time on an edit is a fresh pick, so it follows the create rule (not before today).
//   · DELIVERY NOT BEFORE COLLECTION (Round 8, the secured form: «تاريخ التسليم تانى يوم الاستلام
//     افتراضى وممكن يغير») — a secured shipment's `deliveryDate` may not fall before its
//     `collectionDate` (the same day is allowed) → 422 `OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION`.
//     Checked on create, and on an edit that CHANGES either date (the two dates the shipment would
//     have after the edit are compared), so a row already stored the wrong way round still takes an
//     edit that leaves both dates alone. The past-day rules above are checked first.
//     The default «collection + 1 day» is the FORM's (the server stores what it is sent).
//
// All three refusals carry one detail: `field` = the date field refused, `code` = 'MIN_DATE',
// `message` = the earliest day it may take, as 'YYYY-MM-DD' (for the third: the collection day) —
// so a form can say «أقرب تاريخ مسموح». The comparison is on calendar days ('YYYY-MM-DD'): the
// stored date is the UTC day the client sent; "today" is the Cairo day of the server's clock.
//
// `serialTracked` («تتبّع أرقام الأوراق النقدية») is no longer on either screen's form (Round 8,
// «ومحتاج اشيل دا»). The API keeps the field: optional on create (defaults to false) and on edit
// (left out → the stored value is untouched).

// ── The shipment's action log («سجل بالاكشنز اللى حصلت على الشحنة») ─────────────────────────────
//
// `GET /operations/shipments/:id/log` (`operationsShipment.view`) — every recorded act on ONE
// shipment, oldest first, on the day board and on the history alike. It answers for a deleted
// shipment too, so the deleted list can show why a row is there.
//
// A VIEW OVER THE AUDIT TRAIL, not a store of its own (ADR-012: the audit stream is the system's
// memory). It reads the audit rows of the shipment itself AND of the entities that record acts on
// it — its legs (`shipmentAssignment`: the crew, the route order, the captain's execution on the
// mobile app) and its vault custody — and resolves every value on the server into what a person
// reads: banks and branches by name, captains by name, vans by code, dates as 'YYYY-MM-DD', money as
// «currency amount». The screen translates only the entry's `kind` and each change's `field`.
//
// The vault custody's own record (receipt number, counts, seals, the receiving treasurers) is the
// treasury's, read only for a caller holding `operationsVault.view` — the grant of the vault
// screens. Without it the log still says the shipment entered the vault and was dispatched (its
// own status moves), with no custody details.

/**
 * What one log entry reports — a CLOSED list, every member labelled by the screen.
 *
 *   created              the shipment was booked; `changes` carry its first values (`old` = null).
 *   edited               the edit form changed fields; `changes` carry each one, old → new.
 *   deleted              it was deleted («حذف»).
 *   restored             it was brought back from the deleted shipments.
 *   received             the desk's ✓ — the shipment was received and completed.
 *   receiveUndone        the ✓ was taken back (completed → draft for daily, → dispatched for secured).
 *   receiptImageAdded    a receipt photo was attached where there was none.
 *   receiptImageReplaced a new receipt photo replaced the one there.
 *   receiptImageRemoved  the receipt photo was removed.
 *   crewAssigned         a leg was crewed for the first time (`leg` says which; captain and van).
 *   crewChanged          a leg's captain or van changed.
 *   reordered            the leg's place on its captain's route changed (`sequence`).
 *   executionStarted     the captain started the leg on the mobile app (pending → active).
 *   executionPickedUp    he confirmed the pickup (active → pickedUp).
 *   executionDelivered   he confirmed the delivery — «تم التسليم» (pickedUp → delivered).
 *   executionCompleted   he closed the leg (delivered → completed).
 *   vaultReceived        a secured shipment entered the vault; `changes` carry the receipt number,
 *                        the package counts, the seals and the two receiving treasurers — for a
 *                        reader with `operationsVault.view`; empty for anyone else.
 *   dispatched           a secured shipment left the vault for delivery.
 *   pickupConfirmed      (Round 10) the Operations desk confirmed it collected a secured shipment —
 *                        «تم الاستلام من العمليات» (`POST /operations/secured/:id/pickup`). `changes`
 *                        carry ONE change, `pickedUpBy` (old = null, new = 'operations'). The
 *                        captain's own ✓ in the app writes the same record (`new = 'captain'`), but
 *                        it is ONE act with his `executionPickedUp`, so the log shows that entry
 *                        alone; a `pickupConfirmed` by 'captain' stands only if its leg row is
 *                        missing.
 *   pickupUndone         (Round 10) the desk took the pickup ✓ back (`DELETE
 *                        /operations/secured/:id/pickup`), the captain's or its own. `changes`
 *                        carry ONE change, `pickedUpBy` (old = whose ✓ was removed: 'captain' or
 *                        'operations', new = null).
 *   receiptCancelled     (Round 10) the vault's receipt was cancelled under
 *                        `operationsVault.cancelReceipt` — the shipment went back from the vault to
 *                        draft. `changes` carry ONE change, `reason` (old = null, new = the reason
 *                        typed), for every reader of the log.
 *   crewRemoved          (Round 12) a leg's crew was taken off — «توزيع المحصنات» dragged the
 *                        shipment off its van (or «إزالة»), so the DELIVERY leg has no captain and no
 *                        van any more (`leg` = 'delivery'). `changes` carry `captain` and `vehicle`
 *                        (old = who / which van it was on, new = null). The leg's earlier
 *                        `crewAssigned` / `crewChanged` entries stay in the log.
 *   deliveryRescheduled  (Round 12) placing an OVERDUE shipment still in the vault on a van of the
 *                        distribution day moved its delivery date to that day, as part of the same
 *                        save. `changes` carry ONE change, `deliveryDate` (old → new, 'YYYY-MM-DD').
 *                        The one change a received (locked) محصنة may take: a FLOW act — it goes out
 *                        on a later day than planned — not an edit of what the vault signed for. The
 *                        screen says so in the entry's sentence.
 *   other                an audited act this list does not name yet — shown plainly, never hidden.
 */
export const OPERATIONS_SHIPMENT_LOG_KINDS = [
  'created',
  'edited',
  'deleted',
  'restored',
  'received',
  'receiveUndone',
  'receiptImageAdded',
  'receiptImageReplaced',
  'receiptImageRemoved',
  'crewAssigned',
  'crewChanged',
  'reordered',
  'executionStarted',
  'executionPickedUp',
  'executionDelivered',
  'executionCompleted',
  'vaultReceived',
  'dispatched',
  'pickupConfirmed',
  'pickupUndone',
  'receiptCancelled',
  'crewRemoved',
  'deliveryRescheduled',
  'other',
] as const;
export type OperationsShipmentLogKind = (typeof OPERATIONS_SHIPMENT_LOG_KINDS)[number];

/**
 * Every `field` a log change can carry — a CLOSED list, so the screen can label each one. Values
 * are display strings resolved on the server; `null` means empty (or a record that no longer
 * resolves). No raw id is ever sent where a name exists.
 *
 * The shipment (on `created` / `edited`):
 *   mainBank, secondaryBank      the bank's operational name (`opsName`)
 *   originBranch, destinationBranch  «name (code)»
 *   areaName, notes              as typed
 *   lines                        every money line as «currency name amount», joined by «، » —
 *                                the amount in major units, Latin digits, grouped («مصري 1,500.5»)
 *   collectionDate, deliveryDate 'YYYY-MM-DD' (also on `deliveryRescheduled`, Round 12)
 *   serialTracked                'true' / 'false' (see OPERATIONS_SHIPMENT_LOG_BOOLEAN_FIELDS)
 * A leg (on `crewAssigned` / `crewChanged` / `crewRemoved` / `reordered`):
 *   captain                      the captain's full Arabic name
 *   vehicle                      the van's code
 *   sequence                     the leg's 1-based place on its captain's route
 * The vault custody (on `vaultReceived`) — ONLY for a reader with `operationsVault.view`, the
 * treasury's grant; anyone else gets the `vaultReceived` entry with no changes:
 *   receiptNumber                the vault receipt number
 *   bagCount, cartonCount, boxCount  whole numbers, as digits
 *   bagSeals, boxSeals           the seal numbers, joined by «، »
 *   receivedByPrimary, receivedBySecondary  the two treasurers' full Arabic names
 * The pickup record (on `pickupConfirmed` / `pickupUndone`, Round 10) — for every reader:
 *   pickedUpBy                   'captain' or 'operations' (`OPERATIONS_SECURED_PICKED_UP_BY`) —
 *                                a code, not a name: the screen says «القائد» / «العمليات»
 *                                (see OPERATIONS_SHIPMENT_LOG_PICKED_UP_BY_FIELDS)
 * A cancelled vault receipt (on `receiptCancelled`, Round 10) — for every reader:
 *   reason                       the reason typed when the receipt was cancelled, as typed
 */
export const OPERATIONS_SHIPMENT_LOG_FIELDS = [
  'mainBank',
  'secondaryBank',
  'originBranch',
  'destinationBranch',
  'areaName',
  'lines',
  'collectionDate',
  'deliveryDate',
  'serialTracked',
  'notes',
  'captain',
  'vehicle',
  'sequence',
  'receiptNumber',
  'bagCount',
  'cartonCount',
  'boxCount',
  'bagSeals',
  'boxSeals',
  'receivedByPrimary',
  'receivedBySecondary',
  'pickedUpBy',
  'reason',
] as const;
export type OperationsShipmentLogField = (typeof OPERATIONS_SHIPMENT_LOG_FIELDS)[number];

/** The fields whose values are 'true' / 'false' — the screen says yes / no in its own language. */
export const OPERATIONS_SHIPMENT_LOG_BOOLEAN_FIELDS: readonly OperationsShipmentLogField[] = [
  'serialTracked',
];

/**
 * The fields whose values are an `OperationsSecuredPickedUpBy` code ('captain' / 'operations') —
 * the screen says «القائد» / «العمليات» in its own language (Round 10).
 */
export const OPERATIONS_SHIPMENT_LOG_PICKED_UP_BY_FIELDS: readonly OperationsShipmentLogField[] = [
  'pickedUpBy',
];

/**
 * At most this many audit rows are read for one log — far beyond any real shipment's story. Past
 * it, the NEWEST rows are kept and `truncated` says that older ones were left out.
 */
export const OPERATIONS_SHIPMENT_LOG_MAX_ENTRIES = 500;

/** One field of one log entry, old → new, both already display values. */
export interface OperationsShipmentLogChangeDto {
  field: OperationsShipmentLogField;
  old: string | null;
  new: string | null;
}

export interface OperationsShipmentLogEntryDto {
  /** The audit row's id — stable, for a React key. */
  id: string;
  /** When it happened (ISO instant). */
  at: string;
  /**
   * Who did it, as the audit row recorded them AT THE TIME (the Arabic display name, the English
   * one when there is no Arabic). Null for a system act or a row written before names were kept.
   */
  actorName: string | null;
  kind: OperationsShipmentLogKind;
  /** Which leg a crew, order or execution entry is about; null for the shipment's own acts. */
  leg: OperationsShipmentLeg | null;
  /** What changed, in display values — empty when the `kind` says it all. */
  changes: OperationsShipmentLogChangeDto[];
}

export interface OperationsShipmentLogDto {
  shipmentId: string;
  /** Oldest first. */
  entries: OperationsShipmentLogEntryDto[];
  /** True when more than `OPERATIONS_SHIPMENT_LOG_MAX_ENTRIES` rows exist and the oldest were left out. */
  truncated: boolean;
}

// ── The deleted shipments, and bringing one back («اعملى ايقون اقدر اجيب منه اللى اتمسح») ────────
//
// `GET /operations/shipments/deleted?from=&to=[&type=]` (`operationsShipment.view`): the shipments
// that were DELETED from the history of the range — the history's own union (daily by collection
// day; secured by collection OR delivery day, any stage) over deleted rows, so every row listed is
// one that comes back onto that history when restored. Same range rules, the same optional `type`
// (Round 12 — «سجل الخزينة» lists the deleted محصنات only) and the same row cap as the history,
// counted after the type filter (a range holding more is refused with
// `OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE`). Newest deleted first; rows enriched exactly as board
// rows are, crew facts gated the same way.
//
// `POST /operations/shipments/:id/restore` (`operationsShipment.delete` — the grant that deletes a
// shipment brings it back), no body → the restored `OperationsShipmentDto`. It returns to its day's
// board and to the history with its legs as they were. 404 when no such shipment exists; 409
// `OPERATIONS_SHIPMENT_NOT_DELETED` when it is not deleted. Audited as `restore`; emits
// `operations.shipment.restored`.

export const OperationsDeletedShipmentsQuerySchema = OperationsShipmentHistoryQuerySchema;
export type OperationsDeletedShipmentsQuery = OperationsShipmentHistoryQuery;

/** A deleted shipment: its board row, plus when and by whom it was deleted. */
export interface OperationsDeletedShipmentDto extends OperationsDayBoardShipmentDto {
  /** ISO instant. */
  deletedAt: string;
  /** The deleting user's Arabic display name (English when there is none); null when unknown. */
  deletedByName: string | null;
}

export interface OperationsDeletedShipmentsDto {
  /** The resolved first and last day (UTC midnight ISO strings), both inclusive. */
  from: string;
  to: string;
  /** Newest deleted first. */
  shipments: OperationsDeletedShipmentDto[];
  /** As `OperationsDayBoardDto.crews` — empty without `operationsCrew.view`. */
  crews: OperationsDayBoardVehicleCrewDto[];
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

/**
 * The period of all three reports — the captain and bank reports here, and the vault roll-up below
 * (which judges it on the vault receipt's Cairo day rather than a shipment date). One schema, so the
 * three screens' «من» / «إلى» mean the same days and refuse the same malformed ones.
 */
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
// package counts for the same shipments.
//
// THE PERIOD IS THE OWNER'S, NOT LEGACY'S. Legacy's picker filtered nothing (Q32: its date filters
// were commented out in both aggregations), so the screen was always "what is held now" under two
// dates that meant nothing. The owner gave them a meaning: «يجيب اللى اتسلم واللى متسلمش ويجيب
// البداية كل اول شهر». The roll-up is every secured shipment that ENTERED THE VAULT in [from, to] —
// judged on the vault receipt's Cairo calendar day — whether it is still held, has gone out for
// delivery or has been delivered since; the period opens on the first of the current month by
// default, exactly as the captain and bank reports' does (`OperationsReportQuerySchema`). A receipt
// that was CANCELLED (Round 10) never entered the vault for this purpose; a shipment received again
// counts once, on its new receipt's day. Deleted shipments are left out, as in the other reports.
// What the vault holds right now is still the inventory's question (`ListVaultInventoryQuerySchema`).
//
// NO "WHICH CURRENCY IS THE POUND" FIELDS. An earlier version sent `baseCurrencyCode` and a
// `foreignCurrencies` list that told the pound by `code === 'EGP'` — wrong on the production
// catalog, whose codes are the legacy numbers «1», «2», «3», where it counted the pound as foreign.
// No client read them: the screen splits `grandTotal.currencies` with the boards' own classifier
// (code, name or legacy alias), so the pound/dollar/other split is a VIEW in exactly one place.

export interface OperationsVaultReportDto {
  /** The first day of the period (UTC midnight of the Cairo calendar day), inclusive. */
  from: string;
  /** The last day of the period, inclusive — the day asked for, not the query's exclusive bound. */
  to: string;
  /** Per-bank roll-up of every shipment received into the vault in the period. */
  rows: OperationsBankReportRowDto[];
  /** Q27 NORMALIZE — separate from `rows`, so summing the rows cannot double-count. */
  grandTotal: OperationsReportTotalsDto;
}

/**
 * «تقرير الخزينة» — WHAT THE VAULT HOLDS NOW, per bank (Round 12): «اعمل فوق تقرير الخزينة يكون نفس
 * الداتا اللى فى بيان الشحنات لكل بنك ونفس الشكل وكل حاجه بس مفيش فتر من الى هيكون لحظى على ف
 * الخزينة». On top of «سجل الخزينة» (`/operations/vault`).
 *
 * `GET /operations/reports/vault/held` (`operationsVault.view` — the vault screens' grant, as the
 * roll-up's). NO parameters (any query key → 400): it is live, not a period.
 *
 * WHICH SHIPMENTS: every secured shipment IN THE VAULT right now — status `inVault`, not deleted —
 * which is exactly the set «محصنات الخزينة» lists (`GET /operations/secured/dispatch-board` with no
 * `date`), so the report and the list beside it cannot disagree. Received and not yet dispatched:
 * a dispatched one has left («هتتسلم ساعتها وخلاص مش هتبقى ف الخزنة»), a cancelled receipt put it
 * back to draft — neither is held. Packages come from the live custody, counted once per shipment.
 *
 * THE SAME ROLL-UP as «تجميع الخزينة» (`OperationsVaultReportDto`) and the bank report — the same
 * `bankReportRows`, the same rows keyed on the MAIN (billed) bank, the same `grandTotal` (Q27) — so
 * a screen prints it with the very table «بيان الشحنات لكل بنك» uses; only the period is gone.
 * Unpaged, like the reports.
 */
export const OperationsVaultHeldReportQuerySchema = z.object({}).strict();
export type OperationsVaultHeldReportQuery = z.infer<typeof OperationsVaultHeldReportQuerySchema>;

export interface OperationsVaultHeldReportDto {
  /** When the roll-up was read (ISO instant) — the screen may print «حتى الآن» against it. */
  asOf: string;
  /** Per main bank, every shipment held now; bank name ascending (as the other reports). */
  rows: OperationsBankReportRowDto[];
  /** Q27 NORMALIZE — separate from `rows`, so summing the rows cannot double-count. */
  grandTotal: OperationsReportTotalsDto;
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

/**
 * The vault's ✓ — `POST /operations/secured/:id/receive` (`operationsVault.receive`): custody taken,
 * the shipment `draft` → `inVault`, and from then on LOCKED (`isOperationsShipmentLocked`). Answers
 * 200 with the updated `OperationsShipmentDto` (not a custody record).
 *
 * Round 10: only a shipment somebody has picked up — stage `withCaptain` or `withOperations`
 * (`OPERATIONS_SECURED_RECEIVABLE_STAGES`). A white `awaitingPickup` one is refused with 409
 * `OPERATIONS_SECURED_NOT_PICKED_UP` («مش هيقدر يعمل صح الا لما القائد او العمليات تبقى عامله صح»).
 * The custody and the shipment's move are ONE transaction since Round 10: a receive refused at
 * either leaves nothing behind. The other refusals are unchanged: 422
 * `OPERATIONS_NOT_A_SECURED_SHIPMENT`, 422 `OPERATIONS_INVALID_SHIPMENT_TRANSITION` (not `draft`),
 * 409 `STALE_DOCUMENT`, 409 when custody is already held.
 *
 * A receipt cancelled later (`POST /operations/secured/:id/cancel-receipt`) VOIDS its custody: the
 * row is kept (receipt, counts, seals, treasurers, plus when / who / why it was cancelled) but no
 * list reads it again — the shipment's «السجل» still shows it, as `vaultReceived` then
 * `receiptCancelled`.
 */
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

/**
 * The `/tash4ela_mohasana` + `/deliver_mohsana` list: held, due for delivery on a date (:4447).
 *
 * `GET /operations/secured/due?date=` (`operationsShipment.view`) — the legacy one-day list, a
 * plain `OperationsShipmentDto[]`. KEPT, unchanged, for parity; Round 10 moved «صرف الخزينة» onto
 * `GET /operations/secured/dispatch-board` (below), which lists EVERY shipment in the vault as board
 * rows with an optional delivery-date filter («كله يبقى موجود فى تاريخ يتفلتر»).
 */
export const ListSecuredDueQuerySchema = z.object({ date: z.coerce.date() }).strict();
export type ListSecuredDueQuery = z.infer<typeof ListSecuredDueQuerySchema>;

// ── Round 10: the pickup ✓, the lock, the cancelled receipt, «صرف الخزينة» ─────────────────────
//
// The owner: «فى شاشة المحصنات ممكن القائد اللى يعمل صح انه استلم او العمليات ف لو قائد تم الاستلام من
// القائد و لو العمليات تم الاستلام من العمليات وهتبقى صفر بس وهتكون ظاهره ل شاشة استلام الخزينة بس مش
// هيقدر يعمل صح الا لما القائد او العمليات تبقى عامله صح ،الشاشه بتاعت استلام الخزينة لما تعمل صح
// ميقدر حد من القادة او العمليات او الخزنه يعدل عليها والمحصنة دى بتروح تلقائى ل صرف الخزنة».

/**
 * THE DESK'S PICKUP ✓ — «تم الاستلام من العمليات» — AND ITS UNDO.
 *
 * `POST /operations/secured/:id/pickup` and `DELETE /operations/secured/:id/pickup`, both with this
 * body and both on `operationsShipment.complete` (the desk's ✓ grant, one grant both directions —
 * the complete/reopen precedent). Each answers 200 with the updated `OperationsShipmentDto` (its
 * new `version`; the board rows carry the pickup itself — `pickedUpBy` / `pickedUpAt`), is
 * audited on the shipment, shows in «السجل» (`pickupConfirmed` / `pickupUndone`, with
 * `pickedUpBy`), emits `operations.shipment.pickupConfirmed` / `operations.shipment.pickupUndone`
 * (`OperationsShipmentPickupPayloadV1`), and refreshes every board (realtime topic
 * `operations.shipment`).
 *
 * POST writes the shipment's pickup record as the desk's (`pickedUpBy: 'operations'`) — the row
 * turns yellow (`withOperations`) and the vault may receive it. DELETE CLEARS the record, whoever
 * wrote it — the captain's ✓ from the app included («لو القائد عمل صح ممكن العمليات تشيلها») — and
 * the row turns white again; the desk may then ✓ it again (as Operations). The undo never rewrites
 * the captain's pickup leg: that stays his execution record.
 *
 * Refusals, in the order they are checked:
 *   · 403 — without `operationsShipment.complete`;
 *   · 404 — no such shipment (or deleted);
 *   · 422 `OPERATIONS_NOT_A_SECURED_SHIPMENT` — a daily shipment;
 *   · 409 `OPERATIONS_SECURED_LOCKED` — the vault has received it (status is not `draft`): the ✓
 *     can be taken back only UNTIL the vault receives;
 *   · 409 `OPERATIONS_SECURED_ALREADY_PICKED_UP` (POST) — a pickup is already recorded, the
 *     captain's or the desk's (the desk never stamps over the captain's ✓, nor twice);
 *     409 `OPERATIONS_SECURED_NOT_PICKED_UP` (DELETE) — nobody has confirmed the pickup, there is
 *     nothing to take back;
 *   · 409 `STALE_DOCUMENT` — `version` is not the shipment's current version (the captain's ✓ in
 *     the app moves the shipment's version too, so a screen read before it is refused as stale).
 */
export const ConfirmSecuredPickupSchema = z
  .object({ version: z.number().int().min(0) })
  .strict();
export type ConfirmSecuredPickup = z.infer<typeof ConfirmSecuredPickupSchema>;
export const UndoSecuredPickupSchema = ConfirmSecuredPickupSchema;
export type UndoSecuredPickup = ConfirmSecuredPickup;

/** The shortest and longest reason a cancelled vault receipt takes, after trimming. */
export const OPERATIONS_RECEIPT_CANCEL_REASON_MIN = 3;
export const OPERATIONS_RECEIPT_CANCEL_REASON_MAX = 500;

/**
 * CANCEL THE VAULT'S RECEIPT — the owner's answer: after the vault receives nobody edits, «بس
 * صلاحية خاصة تقدر تلغى استلام الخزينة».
 *
 * `POST /operations/secured/:id/cancel-receipt` on `operationsVault.cancelReceipt` («إلغاء استلام
 * الخزينة» — a special grant held by NO role by default; `super-admin` holds every key by design).
 * Only while the shipment is `inVault` (received, not yet dispatched). In one transaction:
 *   · the vault custody is VOIDED, never erased: the custody row keeps its receipt, counts, seals
 *     and treasurers, gains `cancelledAt` / `cancelledById` / `cancelReason`, and leaves every live
 *     read (the vault inventory, the roll-up, the reports, today's receipts on the receive queue) —
 *     so a fresh receipt can be taken later;
 *   · the shipment returns to `draft`, its `receiptNumber` cleared, its pickup record INTACT — so
 *     it is YELLOW again (`withCaptain` / `withOperations`), editable again, and receivable again.
 *     A delivery crew already assigned while it was in the vault stays assigned (dispatch still
 *     needs it back in the vault first).
 * Answers 200 with the updated `OperationsShipmentDto`. Audited on the shipment (status, receipt
 * number and the reason) and on the custody; «السجل» shows ONE `receiptCancelled` entry with the
 * `reason`, for every reader; emits `operations.custody.receiptCancelled`
 * (`OperationsCustodyReceiptCancelledPayloadV1`) and `operations.shipment.updated`; realtime topics
 * `operations.shipment` and `operations.vaultCustody`.
 *
 * Refusals: 400 `VALIDATION_FAILED` — `reason` missing, or shorter than
 * `OPERATIONS_RECEIPT_CANCEL_REASON_MIN` / longer than `OPERATIONS_RECEIPT_CANCEL_REASON_MAX`
 * characters once trimmed, or `version` missing; 403 without the grant; 404; 422
 * `OPERATIONS_NOT_A_SECURED_SHIPMENT`; 409 `OPERATIONS_SECURED_NOT_IN_VAULT` — not received yet
 * (`draft`), or already dispatched or completed (a shipment that left the vault is past
 * cancelling); 409 `STALE_DOCUMENT`.
 */
export const CancelVaultReceiptSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(OPERATIONS_RECEIPT_CANCEL_REASON_MIN)
      .max(OPERATIONS_RECEIPT_CANCEL_REASON_MAX),
    version: z.number().int().min(0),
  })
  .strict();
export type CancelVaultReceipt = z.infer<typeof CancelVaultReceiptSchema>;

/**
 * «صرف الخزينة» — THE VAULT'S DISPATCH BOARD (Round 10): «كله يبقى موجود فى تاريخ يتفلتر», in the
 * shared board look («اعملها بقى بشكل الجديد للشاشات اللى احنا عملناها»).
 *
 * ROUND 12 RENAMED THE SCREEN «محصنات الخزينة» and made it VIEW ONLY: «وعاوز اغير اسم صرف الخزينة ل
 * محصنات الخزينة وتكون وظيفتها انها بتعرض اللى موجود دلوقتى فى الخزنة». The endpoint below is
 * unchanged and still answers it (route `/operations/vault/dispatch` kept). Placing a shipment on a
 * van moved to «توزيع المحصنات» (`GET`/`POST /operations/secured/distribution`), and handing a van's
 * load over to «تسليم المحصنات» (which calls the dispatch below) — so the screen offers neither the
 * assign dialog nor the dispatch any more. Both endpoints stay, unchanged, for those screens and for
 * parity.
 *
 * `GET /operations/secured/dispatch-board?date=` (`operationsVault.view` — the grant the
 * `/operations/vault/dispatch` page already rides): EVERY secured shipment in the vault right now
 * (status `inVault`), whatever its delivery date, as BOARD ROWS (`boardForReader`: the same row as
 * every board, its `crew` the DELIVERY leg's, the van cards behind `operationsCrew.view`).
 *
 *   · `date` — OPTIONAL, a whole day: only the shipments whose delivery date is that day. Leave it
 *     out for all of them (an empty `date=` is a 400 — omit the key). A shipment with no delivery
 *     date is listed only without `date`.
 *   · Order: delivery date ascending — so the OVERDUE ones (delivery day before today, Cairo) lead —
 *     then oldest created; a shipment with no delivery date last.
 *   · Counted before it is read: more than `OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS` matching
 *     shipments is refused with 422 `OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE` (details `count`,
 *     `max`), never cut short.
 *
 * ASSIGNING THE DELIVERY CREW from this board: a row's crew must be planned on THAT ROW'S
 * `deliveryDate`, not on the filter's — `POST /operations/secured/:id/assign-delivery` refuses any
 * other day with 422 `OPERATIONS_CREW_DAY_MISMATCH`. So the assign dialog reads the crew board of
 * the SHIPMENT's delivery day (`GET /operations/crew-board?date=<row.deliveryDate>` and
 * `…/crew-board/directory?date=`), and sends the row's `deliveryLegVersion` as `version` when a
 * delivery leg already exists (re-assignment), 0 when it is null (first assignment) — never the
 * shipment's own `version`. A shipment with no delivery date cannot be assigned (422
 * `OPERATIONS_INVALID_SHIPMENT_TRANSITION`). Assignment needs `operationsShipment.edit`, as before.
 *
 * DISPATCH is unchanged: `POST /operations/secured/dispatch` (`operationsVault.dispatch`) with ONE
 * crew row (`crewAssignmentId`) and the shipments it carries — every one of them assigned to that
 * crew row (each row's `crew.crewAssignmentId`), else 409. Rows of different crews go out in
 * separate calls.
 */
export const OperationsSecuredDispatchBoardQuerySchema = z
  .object({ date: z.coerce.date().optional() })
  .strict();
export type OperationsSecuredDispatchBoardQuery = z.infer<
  typeof OperationsSecuredDispatchBoardQuerySchema
>;

/** A row of «صرف الخزينة»: a board row (its `crew` is the DELIVERY leg's), plus what the screen needs. */
export interface OperationsSecuredDispatchRowDto extends OperationsDayBoardShipmentDto {
  /** When the treasury took it in (the custody's `receivedAt`, ISO instant). */
  vaultReceivedAt: string | null;
  /**
   * True when its delivery date is before TODAY on the Cairo calendar
   * (`OperationsSecuredDispatchBoardDto.today`) — late leaving the vault. False with no delivery
   * date.
   */
  overdue: boolean;
  /**
   * The version of its DELIVERY leg, to send as `version` when re-assigning it
   * (`AssignSecuredDeliveryLegSchema`); null while no delivery crew is assigned (send 0).
   */
  deliveryLegVersion: number | null;
}

export interface OperationsSecuredDispatchBoardDto {
  /** The delivery day filtered on (its UTC midnight, ISO), or null when every day is listed. */
  date: string | null;
  /** TODAY on the Cairo calendar, as its UTC midnight ISO string — what `overdue` was judged by. */
  today: string;
  /** Delivery date ascending (overdue first), then oldest created; no delivery date last. */
  shipments: OperationsSecuredDispatchRowDto[];
  /** As `OperationsDayBoardDto.crews` — empty without `operationsCrew.view`. */
  crews: OperationsDayBoardVehicleCrewDto[];
}

// ── Round 12: «توزيع المحصنات» and «تسليم المحصنات» ─────────────────────────────────────────────
//
// The owner: «المحصنة اللى يومها هتخرج هتظهر تلقائى فى شاشة توزيع المحصنات هيكون فيها العربيه اللى
// اتحط عليها القادة والاخصائين والاتجاه هتبقى العربيات على اليمين والمحصنات على الشمال وهشد المحصنة
// احطها على العربيه او المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى ولما يحفظ نفس الشاشة هنعمل
// زيها للخزنة هيكون فوق كل عربيه تسليم وطباعه … بس لما يدوس تسليم المحصنات هتتسلم ساعتها وخلاص مش
// هتبقى ف الخزنة».
//
// ONE READ FOR BOTH SCREENS — `GET /operations/secured/distribution?date=` — and two ways to act on
// it: Operations places shipments on the day's vans and saves them in ONE request (`POST
// /operations/secured/distribution`), and the vault hands each van's load over with the dispatch
// that already exists (`POST /operations/secured/dispatch`, `operationsVault.dispatch`).
//
// WHERE A SHIPMENT IS "ON A VAN" — its DELIVERY leg (`OperationsShipmentAssignmentDto`, leg
// 'delivery'), the same row «صرف الخزينة»'s assign dialog wrote and the dispatch checks: the leg's
// crew row is the van, its captain the captain. Distribution writes nothing else, so a van's load
// as the vault sees it, as the captain's phone sees it, and as the reports attribute it are the
// same fact.

/** The most changes one distribution save may carry — far above a day's محصنات, a bound, not a quota. */
export const OPERATIONS_DISTRIBUTION_MAX_CHANGES = 500;

/**
 * `GET /operations/secured/distribution?date=` — `operationsShipment.view` OR `operationsVault.view`
 * (Operations distributes, the vault hands over: one read for both screens).
 *
 *   · `date` — OPTIONAL, a whole day; left out → TODAY on the Cairo calendar. A day before today is
 *     refused with 422 `OPERATIONS_DISTRIBUTION_DAY_IN_PAST` (detail: `field` 'date', `code`
 *     'MIN_DATE', `message` = today as 'YYYY-MM-DD') — the boards' «no past day» rule: a past day's
 *     vans have left. An empty `date=` is a 400 (omit the key).
 */
export const OperationsSecuredDistributionQuerySchema = z
  .object({ date: z.coerce.date().optional() })
  .strict();
export type OperationsSecuredDistributionQuery = z.infer<
  typeof OperationsSecuredDistributionQuerySchema
>;

/** A shipment's delivery leg as it stands — on whatever day it is planned. */
export interface OperationsSecuredDistributionLegDto {
  /** The crew row (the van of that day) the leg rides. */
  crewAssignmentId: string;
  captainEmployeeId: string;
  vehicleId: string;
  /**
   * The captain's progress on it in the app. Anything but `pending` means he has started it: the
   * leg is his now and the save refuses to move or clear it (409
   * `OPERATIONS_DISTRIBUTION_LEG_STARTED`) — the screen shows the card as fixed.
   */
  executionStatus: OperationsExecutionStatus;
}

/**
 * A shipment on the distribution screen: a BOARD ROW (`OperationsDayBoardShipmentDto` — bank,
 * branches with their banks, area, the money lines, `securedStage` and its colour; its `crew` is the
 * leg the board prints NOW, which for a draft is still the PICKUP leg — read `delivery` for the van),
 * plus the distribution's own facts.
 */
export interface OperationsSecuredDistributionRowDto extends OperationsDayBoardShipmentDto {
  /** When the vault took it in (custody `receivedAt`, ISO instant); null while it is not in the vault. */
  vaultReceivedAt: string | null;
  /**
   * «متأخرة» — an IN-VAULT shipment whose delivery date is BEFORE the screen's day. Placing it on a
   * van of the day moves its delivery date to the day (see the save). False for every shipment due
   * on the day.
   */
  overdue: boolean;
  /** Its DELIVERY leg as it stands (any day), or null when it has none. */
  delivery: OperationsSecuredDistributionLegDto | null;
  /**
   * The delivery leg's version, to send back as the change's `version`; null when it has no
   * delivery leg (send null). Never the shipment's own `version`.
   */
  deliveryLegVersion: number | null;
  /**
   * The van of THIS DAY it is on: `delivery.crewAssignmentId` when that crew row is one of `crews`,
   * else null — UNPLACED (the left column). An overdue shipment whose leg is still on its old day's
   * van is unplaced here.
   */
  placedCrewAssignmentId: string | null;
  /**
   * AUTO BY DIRECTION — «المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى»: the crew rows of `crews`
   * that have at least one captain and whose `direction` names this shipment's `areaName`
   * (`operationsDirectionMatchesArea`), in `crews` order. The screen PROPOSES the shipment onto the
   * van when it is unplaced and this holds EXACTLY ONE id — on load, and again on «توزيع تلقائي»;
   * with none or several it is left for the person. A proposal is the screen's until «حفظ».
   */
  directionCrewAssignmentIds: string[];
}

export interface OperationsSecuredDistributionDto {
  /** The day distributed (its UTC midnight, ISO) — today in Cairo when none was asked for. */
  date: string;
  /** TODAY on the Cairo calendar (UTC midnight, ISO) — the earliest day the screen may pick. */
  today: string;
  /**
   * Whether the reader holds `operationsCrew.view` — the crew plan's grant. Without it every van is
   * still listed (the vans ARE this screen: number, captains, direction, time — what every board
   * prints beside a row), but its `drivers`, `specialist1` and `specialist2` come back EMPTY; this
   * says so, so an empty slot is not read as «no specialist».
   */
  crewPlanVisible: boolean;
  /**
   * THE VANS OF THE DAY (the right column): EVERY crew row of the day's crew board (`GET
   * /operations/crew-board?date=`), one card each — van code, captains, both specialists, drivers by
   * name, `direction`, `plannedTime` — ordered by van code (numbers in number order). A van with no
   * captain is listed but cannot take a shipment (the save answers `OPERATIONS_CREW_CAPTAIN_MISMATCH`).
   * Empty when nothing is planned for the day.
   */
  crews: OperationsDayBoardVehicleCrewDto[];
  /**
   * THE MAHSANAT (the left column, and each van's load): every SECURED shipment, not deleted, that is
   *   · due on the day (`deliveryDate` = `date`) and not yet out — status `draft` (any stage:
   *     awaitingPickup / withCaptain / withOperations — placeable now, handed over only once the
   *     vault has it) or `inVault`; or
   *   · OVERDUE in the vault — status `inVault` with a delivery date before `date` (`overdue`).
   * Never one dispatched or completed (gone from the vault), never a draft due another day.
   * Order: delivery date ascending (the overdue first), then oldest booked. Counted before it is
   * read: more than `OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS` → 422
   * `OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE` (details `count`, `max`), never cut short.
   * The row's `crew.captainPhone` is null without `operationsCrew.view`, as on every board.
   */
  shipments: OperationsSecuredDistributionRowDto[];
}

/**
 * One shipment's place after the save — the van (crew row of `date`) and the captain it goes with,
 * or both null to take it OFF its van («إزالة», or dragged back to the left).
 *
 * `version` is the row's `deliveryLegVersion` AS THE SCREEN READ IT — null when it had no delivery
 * leg. Checked against the leg as it is now: a leg created, moved or cleared by someone else since
 * (another desk, or the assign dialog) makes the WHOLE save stale.
 */
export const SecuredDistributionChangeSchema = z
  .object({
    shipmentId: objectId(),
    crewAssignmentId: objectId().nullable(),
    captainEmployeeId: objectId().nullable(),
    version: z.number().int().min(0).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // A van without a captain carries nothing, and a captain without a van is no place at all.
    if ((value.crewAssignmentId === null) !== (value.captainEmployeeId === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['captainEmployeeId'],
        message: 'a van and its captain are given together — both, or neither to take it off',
      });
    }
  });
export type SecuredDistributionChange = z.infer<typeof SecuredDistributionChangeSchema>;

/**
 * `POST /operations/secured/distribution` (`operationsShipment.edit` — assign-delivery's grant) —
 * «ولما يحفظ»: EVERY change on the screen in ONE request, ALL OR NOTHING (one transaction: a single
 * refusal writes nothing at all). Send only the shipments whose place changed (a proposal the person
 * kept is a change like any other).
 *
 * Per change, in this order:
 *   · the shipment: 404 when there is none (or it is deleted); 422 `OPERATIONS_NOT_A_SECURED_SHIPMENT`;
 *     409 `OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED` when it is `dispatched` or `completed` — it has
 *     left the vault, its van is history; 422 `OPERATIONS_DISTRIBUTION_NOT_ON_DAY` unless it is due
 *     on `date` (draft or in the vault) or is OVERDUE in the vault (in the vault, delivery date
 *     before `date`) — a draft due another day, or one with no delivery date, is not this day's;
 *   · the version: 409 `STALE_DOCUMENT` unless `version` is its delivery leg's current version
 *     (null ⇔ no leg);
 *   · the leg: 409 `OPERATIONS_DISTRIBUTION_LEG_STARTED` when the captain has started it in the app
 *     (its `executionStatus` is not `pending`) and the change would move or clear it;
 *   · the van: 404 when the crew row does not exist; 422 `OPERATIONS_CREW_DAY_MISMATCH` when it is a
 *     crew row of another day; 422 `OPERATIONS_CREW_CAPTAIN_MISMATCH` when the captain is not one of
 *     its captains (a van with two captains takes either — the screen sends the one chosen on the
 *     van card, the first by default).
 * Every refusal names the shipment: `details` = [{ field: 'shipmentId', code: 'SHIPMENT', message:
 * <its id> }] (the 404 of a missing crew row and `STALE_DOCUMENT` included), so the screen can mark
 * its card. Then the day itself: 422 `OPERATIONS_DISTRIBUTION_DAY_IN_PAST` for a day before today
 * (Cairo), checked before any shipment.
 *
 * What a change WRITES (only when it changes something — a change that names the place the shipment
 * already has writes nothing and is not counted):
 *   · onto a van — the delivery leg is created (`crewAssigned` in «السجل», leg 'delivery') or moved
 *     (`crewChanged`): its crew row, captain and van, on the day's operating day; a stop that changes
 *     captain lands at the END of the new captain's delivery route (the assign-delivery rule).
 *     Events `operations.shipmentAssignment.assigned` (`OperationsShipmentAssignmentPayloadV1`).
 *   · OVERDUE — placing an overdue in-vault shipment on a van of `date` also moves its DELIVERY DATE
 *     to `date`, in the same transaction: the ONE change a received (locked, `isOperationsShipmentLocked`)
 *     محصنة may take, because it is a FLOW act — it goes out later than planned, nothing the vault
 *     signed for changes. Audited on the shipment, shown in «السجل» as `deliveryRescheduled`
 *     (old → new delivery day); event `operations.shipment.updated`. Taking an overdue shipment OFF
 *     a van moves no date.
 *   · off the van — the delivery leg is CLEARED (no captain, no van; the leg row is retired, its
 *     history kept): `crewRemoved` in «السجل»; event `operations.shipmentAssignment.removed`
 *     (`OperationsShipmentAssignmentPayloadV1`, the captain and van it was on). Off a van it was not
 *     on (no leg, `version` null) is no change.
 * Realtime: topics `operations.shipmentAssignment` and `operations.shipment` (the boards' sweep).
 *
 * Answers 200 with `OperationsSecuredDistributionSaveDto`; read the screen again
 * (`GET …/distribution?date=`) for the new versions.
 *
 * THEN «تسليم المحصنات» (the vault, `operationsVault.dispatch`): per van, `POST
 * /operations/secured/dispatch` with that van's `crewAssignmentId` and the ids of ITS shipments that
 * are IN THE VAULT (`status === 'inVault'` and `placedCrewAssignmentId` = the van). They leave the
 * vault at once (`dispatched` — «هتتسلم ساعتها وخلاص مش هتبقى ف الخزنة»). A shipment on the van that
 * the vault has not received yet (draft) is not sent: the dispatch would refuse it (422
 * `OPERATIONS_INVALID_SHIPMENT_TRANSITION`) — the vault cannot hand over what it does not hold.
 */
export const SaveSecuredDistributionSchema = z
  .object({
    date: z.coerce.date(),
    changes: z
      .array(SecuredDistributionChangeSchema)
      .min(1)
      .max(OPERATIONS_DISTRIBUTION_MAX_CHANGES),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.changes.forEach((change, index) => {
      if (seen.has(change.shipmentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['changes', index, 'shipmentId'],
          message: 'a shipment appears twice in one distribution',
        });
      }
      seen.add(change.shipmentId);
    });
  });
export type SaveSecuredDistribution = z.infer<typeof SaveSecuredDistributionSchema>;

export interface OperationsSecuredDistributionSaveDto {
  /** The day saved (UTC midnight, ISO). */
  date: string;
  /**
   * How many shipments the save changed — placed on a van, moved to another, taken off, or (an
   * overdue one already on a van of the day) only re-dated. A change naming the place a shipment
   * already had is not counted.
   */
  changed: number;
  /** Of them, the overdue ones whose delivery date moved to `date`. */
  rescheduled: number;
}

// ── Matching a shipment's area to a van's direction (pure, shared by the server and the screen) ──
//
// «المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى». A van's DIRECTION is free text on its crew row
// («الاتجاه» on the crew board) and may name several areas; a shipment's AREA is its `areaName` (the
// destination branch's operations area). The rule, precisely:
//
//   1. The direction is split into areas at «-» «–» «—» «/» «\» «|» «،» «,» «؛» «;» «+» «&», and at a
//      standalone «و» between spaces («المعادي و حلوان»). A «و» joined to the next word is part of
//      that word («وسط البلد» stays whole).
//   2. Each area, and the shipment's area, is FOLDED: Arabic-Indic digits to Latin; lower case;
//      tashkeel, tatweel and invisible marks dropped; «أ إ آ ٱ» → «ا», «ى» → «ي», «ة» → «ه»; every
//      other character that is not a letter, a digit or a space dropped; a leading «ال» taken off
//      each word longer than three letters («المعادي» = «معادي», «ال» alone stays); spaces made one.
//   3. The shipment matches the van when its folded area EQUALS one folded area of the direction —
//      equal, never "contains": «مصر» does not match «مصر الجديدة».
//   4. No area, or no direction, or either folding to nothing → no match.

/** Where a direction is split into its areas (rule 1). */
const DIRECTION_SEPARATOR = /\s*[-–—/\\|،,؛;+&]\s*|\s+و\s+/u;

/** One area name, folded (rule 2) — exported so a screen can show what was compared. */
export const foldOperationsAreaName = (value: string): string =>
  asciiDigits(value)
    .toLowerCase()
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/gu, '')
    .replace(/\p{Cf}/gu, '')
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/ة/gu, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .split(/\s+/u)
    .map((word) => ([...word].length > 3 && word.startsWith('ال') ? word.slice(2) : word))
    .join(' ');

/** The areas a van's direction names, folded and without repeats (rules 1-2); [] for none. */
export const operationsDirectionAreas = (direction: string | null | undefined): string[] => {
  if (direction == null) return [];
  return [
    ...new Set(
      direction
        .split(DIRECTION_SEPARATOR)
        .map(foldOperationsAreaName)
        .filter((area) => area !== ''),
    ),
  ];
};

/** Does this van's direction name this shipment's area (rules 3-4)? */
export const operationsDirectionMatchesArea = (
  direction: string | null | undefined,
  areaName: string | null | undefined,
): boolean => {
  if (areaName == null) return false;
  const area = foldOperationsAreaName(areaName);
  return area !== '' && operationsDirectionAreas(direction).includes(area);
};

/**
 * The vans a shipment's area points at: those with at least one captain whose direction matches
 * (`operationsDirectionMatchesArea`), in the order given. EXACTLY ONE → the screen proposes it.
 */
export const operationsDirectionVanIds = (
  areaName: string | null | undefined,
  vans: readonly {
    crewAssignmentId: string;
    direction: string | null;
    captains: readonly unknown[];
  }[],
): string[] =>
  vans
    .filter((van) => van.captains.length > 0 && operationsDirectionMatchesArea(van.direction, areaName))
    .map((van) => van.crewAssignmentId);

// ── The secured screen and the vault's receive queue (Round 8) ─────────────────────────────────
//
// «شاشة الشحنات المحصنة عاوز شكلها يكون زى شاشة اليوم التشغيلى»: the secured screen and the vault's
// receive screen both print BOARD ROWS (`OperationsDayBoardShipmentDto`) — the same branches with
// their banks, the same crew, the same van cards behind `operationsCrew.view` (a reader without it
// gets `crews: []` and no captain phone, exactly as on the day board) — plus each row's
// `securedStage`, which is what colours it.

/**
 * `GET /operations/secured/board` (`operationsShipment.view`) — THE SECURED SCREEN: every secured
 * shipment not yet completed, NO date filter (the legacy `/mohsana` backlog, :657 — a shipment
 * booked weeks ago and still open stays on it), newest created first. Takes no parameters.
 *
 * Counted before it is read, like the history: more than `OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS`
 * open secured shipments is refused with 422 `OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE` (details
 * `count` and `max`), never cut short.
 */
export const OperationsSecuredBoardQuerySchema = z.object({}).strict();
export type OperationsSecuredBoardQuery = z.infer<typeof OperationsSecuredBoardQuerySchema>;

export interface OperationsSecuredBoardDto {
  /** Every open secured shipment (stage awaitingPickup … dispatched), newest created first. */
  shipments: OperationsDayBoardShipmentDto[];
  /** As `OperationsDayBoardDto.crews` — empty without `operationsCrew.view`. */
  crews: OperationsDayBoardVehicleCrewDto[];
}

/**
 * `GET /operations/secured/vault-queue?all=` (`operationsVault.view`, the vault screens' grant) —
 * «شاشة استلام الخزينه», what the treasury receives:
 *
 *   · by default (`all` absent or false): the YELLOW secured shipments — `withCaptain` (the captain
 *     collected it in the app) and, since Round 10, `withOperations` (the desk confirmed it) — on
 *     their way to the vault, plus those RECEIVED into the vault TODAY on the Cairo calendar (GREEN
 *     — by the custody's `receivedAt`; listed whatever their stage now, so one received and
 *     dispatched the same day still shows as today's receipt; a receipt CANCELLED since is not
 *     today's receipt any more, and the shipment is back among the yellow ones);
 *   · with `all=true`: the same, plus every `awaitingPickup` one (WHITE) — FOR VIEWING ONLY since
 *     Round 10: the vault cannot receive a white row (`POST …/receive` answers 409
 *     `OPERATIONS_SECURED_NOT_PICKED_UP`); the captain's or the desk's ✓ comes first.
 *
 * Receiving stays `POST /operations/secured/:id/receive` (`operationsVault.receive` — the receive
 * form with the packaging, the seals and the two treasurers): that is the vault's ✓, and from it the
 * shipment is locked (`isOperationsShipmentLocked`). Newest created first. Counted before it is
 * read: more than `OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS` candidates (open drafts plus today's
 * receipts) is refused with 422 `OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE`.
 */
export const OperationsVaultQueueQuerySchema = z
  .object({ all: booleanQuery().optional() })
  .strict();
export type OperationsVaultQueueQuery = z.infer<typeof OperationsVaultQueueQuerySchema>;

/** A vault-queue row: a board row, plus when the vault received it. */
export interface OperationsVaultQueueShipmentDto extends OperationsDayBoardShipmentDto {
  /**
   * When the treasury took it into the vault (the custody's `receivedAt`, ISO instant) — set on
   * the green rows received today, null on the rows still to be received.
   */
  vaultReceivedAt: string | null;
}

export interface OperationsVaultQueueDto {
  /** The Cairo day "received today" was read for, as its UTC midnight ISO string. */
  date: string;
  /** Echoes the `all` the rows were read with (false when it was left out). */
  all: boolean;
  shipments: OperationsVaultQueueShipmentDto[];
  /** As `OperationsDayBoardDto.crews` — empty without `operationsCrew.view`. */
  crews: OperationsDayBoardVehicleCrewDto[];
}


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
  /** A deleted shipment brought back («اجيب منه اللى اتمسح») — the counterpart of `deleted`. */
  ShipmentRestored: 'operations.shipment.restored',
  DayCreated: 'operations.day.created',
  DayOpened: 'operations.day.opened',
  DayClosed: 'operations.day.closed',
  CrewPlanned: 'operations.crew.planned',
  CrewAssignmentChanged: 'operations.crewAssignment.changed',
  StandingCrewChanged: 'operations.standingCrew.changed',
  VaultReceived: 'operations.custody.received',
  VaultReleased: 'operations.custody.released',
  /**
   * Round 10 — a vault receipt CANCELLED under `operationsVault.cancelReceipt`: the custody voided
   * (kept as history), the shipment back to draft. Carries the reason typed.
   */
  VaultReceiptCancelled: 'operations.custody.receiptCancelled',
  /**
   * Round 10 — a secured shipment's pickup was confirmed: by its captain in the app («تم الاستلام من
   * القائد», alongside his `shipmentAssignment.pickedUp`) or by the Operations desk («تم الاستلام من
   * العمليات»). `OperationsShipmentPickupPayloadV1.by` says which.
   */
  ShipmentPickupConfirmed: 'operations.shipment.pickupConfirmed',
  /**
   * Round 10 — the desk took a pickup ✓ back (the captain's or its own), before the vault received
   * the shipment. `OperationsShipmentPickupPayloadV1.by` is whose ✓ was removed.
   */
  ShipmentPickupUndone: 'operations.shipment.pickupUndone',
  SecuredLegAssigned: 'operations.shipmentAssignment.assigned',
  /**
   * Round 12 — a secured shipment taken OFF its van on «توزيع المحصنات»: its delivery leg cleared.
   * `OperationsShipmentAssignmentPayloadV1` carries the leg that was retired — the captain and van it
   * was on — the counterpart of `assigned`.
   */
  SecuredLegRemoved: 'operations.shipmentAssignment.removed',
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

/**
 * Round 10 — a secured shipment's pickup record written or cleared: the shipment event's fields,
 * plus WHO — on `pickupConfirmed` who confirmed it, on `pickupUndone` whose ✓ was removed.
 */
export const OperationsShipmentPickupPayloadV1 = OperationsShipmentEventPayloadV1.extend({
  by: OperationsSecuredPickedUpBySchema,
});

/** Round 10 — a cancelled vault receipt: the voided custody, its shipment, and why. */
export const OperationsCustodyReceiptCancelledPayloadV1 = z.object({
  custodyId: objectId(),
  shipmentId: objectId(),
  reason: z.string(),
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
