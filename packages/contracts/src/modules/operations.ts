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
 *                   التسليم», a WHITE row. Since Round 13 the vault MAY receive it («والخزنه تستلم
 *                   عادي»); its receive screen lists it by default once its collection day has come
 *                   (see `GET /operations/secured/vault-queue`).
 *   withCaptain     status `draft`, the pickup was confirmed by its CAPTAIN — his ✓ in the mobile
 *                   app on collecting it from the bank (`pickedUpBy: 'captain'`) — «تم الاستلام من
 *                   القائد», a YELLOW row. The vault's receive screen lists it by default, whatever
 *                   its collection day.
 *   withOperations  (Round 10) status `draft`, the pickup was confirmed by the OPERATIONS desk
 *                   (`POST /operations/secured/:id/pickup` — `pickedUpBy: 'operations'`) — «تم
 *                   الاستلام من العمليات», a YELLOW row exactly like `withCaptain`: listed by default
 *                   on the vault's receive screen.
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
 * THE VAULT NEVER WRITES IT (Round 13). The vault may receive a draft nobody recorded collecting —
 * «واستلام الخزينه ممكن تستلم يكون القائد معلمش التسليم، او ان العمليات معملتش التسليم والخزنه تستلم
 * عادي» — and such a receipt leaves the record empty for good: the row is `inVault` with
 * `pickedUpBy: null`, so the vault's screen says «لم يتم الاستلام» in its pickup column and
 * «بالخزينة» in its vault column — two facts, two columns. A captain finishing a pickup leg he had
 * started before that receipt records his leg only (the record is written from a draft alone).
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
 * The stages the VAULT may receive from: EVERY stage of a draft — white or yellow — since Round 13
 * («والخزنه تستلم عادي»). Round 10 had allowed the two yellow ones only («مش هيقدر يعمل صح الا لما
 * القائد او العمليات تبقى عامله صح»); the owner lifted that. `POST /operations/secured/:id/receive`
 * refuses only what has left `draft` (422 `OPERATIONS_INVALID_SHIPMENT_TRANSITION`).
 *
 * NOT "picked up": a screen that colours or labels a row by its pickup reads
 * `OPERATIONS_SECURED_PICKED_UP_STAGES` (or `pickedUpBy`), never this list.
 */
export const OPERATIONS_SECURED_RECEIVABLE_STAGES: readonly OperationsSecuredStage[] = [
  'awaitingPickup',
  'withCaptain',
  'withOperations',
];

/**
 * The stages in which somebody has confirmed collecting a DRAFT from the bank — the two yellow
 * ones (`withCaptain`, `withOperations`): «تم الاستلام من القائد» / «تم الاستلام من العمليات». What
 * the vault's pickup column («حالة الاستلام») and its yellow tint read while the row is a draft.
 * Past `draft` the stage is the shipment's own status, and `pickedUpBy` alone still says who
 * collected it (null for a receipt nobody handed over).
 */
export const OPERATIONS_SECURED_PICKED_UP_STAGES: readonly OperationsSecuredStage[] = [
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

// ── Shift types «أنواع التشغيل» (Round 20 — the crew board's «النوع») ──────────────────────────
//
// The legacy crew board's «النوع» column (يومي، احتياطي، احتياطي سفر، أسوان، إيباج، سفر، شلاتين، محصنة،
// مسائي) was a fixed list in the template. The owner approved the board with one change to it: «انا
// عاوز النوع يكون بيضاف من البيانات المرجعيه» — so it is a CATALOG on the reference-data screen, built
// the way the currencies are (dragged order, archived never deleted, audited, no events), and a
// crew row points at one by id (`shiftTypeId`). The legacy nine are seeded on boot, once.

/**
 * The colours a type may wear — a small fixed palette the screen maps to its tag colours, so a
 * type added on the reference screen still reads as a coloured tag on the board without anybody
 * picking a hex value. Names, never CSS: the screen owns how each looks in light and dark.
 *
 * Round 24b — ONE PALETTE, for the types AND the crew rows: «عاوز pallett الالوان يكون على عدد الالوان
 * يكون نفس عدد النوع … اقدر ادى كل نوع لون من الالوان». An ORDERED, curated list of well-separated
 * colours: the board offers its FIRST N, N being the number of live types (all of it past twenty), so
 * the order is the order colours join as types are added — each prefix as far apart as the list
 * allows. The eleven names of Round 20 stay and stay first (a saved type keeps its colour by name),
 * re-ordered among themselves so the first nine are the nine the boot seeds the legacy types with —
 * on a fresh catalog every type's colour is among the swatches shown. The nine after them are new
 * and deliberately share no name with Round 20's six row colours (yellow, green, blue, red, purple):
 * those are now legacy names the boundary maps (`OPERATIONS_LEGACY_CREW_ROW_COLOURS`), and a palette
 * name equal to one would make the mapping ambiguous.
 */
export const OPERATIONS_SHIFT_TYPE_COLOURS = [
  'rose',
  'emerald',
  'indigo',
  'amber',
  'violet',
  'teal',
  'orange',
  'fuchsia',
  'slate',
  'lime',
  'sky',
  'crimson',
  'navy',
  'forest',
  'gold',
  'plum',
  'brown',
  'cyan',
  'pink',
  'olive',
] as const;
export const OperationsShiftTypeColourSchema = z.enum(OPERATIONS_SHIFT_TYPE_COLOURS);
export type OperationsShiftTypeColour = z.infer<typeof OperationsShiftTypeColourSchema>;

export interface OperationsShiftTypeDto {
  id: string;
  /** The Arabic name the board shows («يومي»). Unique among the live types. */
  name: string;
  /** The English name, or null — the areas' rule: optional, the board reads Arabic. */
  nameEn: string | null;
  colour: OperationsShiftTypeColour;
  /**
   * The type's place in the catalog's ARRANGED order — 0 first — or null while nobody has arranged
   * the list (`PUT /operations/shift-types/order`, the currencies' drag exactly). THE ORDER THE LIST
   * ANSWERS IN when no `sortBy` is asked for: `sortOrder` ascending (null after every placed one),
   * then the Arabic name. The board's type picker and its counts strip follow it.
   */
  sortOrder: number | null;
  /**
   * An archived type is offered for no new row, and a row that already carries it keeps it: the
   * save refuses an inactive type only when it is newly chosen (`PlanOperationsCrewRowSchema`).
   */
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const shiftTypeCore = {
  name: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().min(1).max(60).nullable().default(null),
  colour: OperationsShiftTypeColourSchema,
  /** Optional, as the currencies': left out on create, a new type joins the END of an arranged list. */
  sortOrder: z.number().int().min(0).nullable().optional(),
};
/** `POST /operations/shift-types` (`operationsCatalog.manage`) → 201. A taken name → 409. */
export const CreateOperationsShiftTypeSchema = z.object(shiftTypeCore).strict();
export type CreateOperationsShiftType = z.infer<typeof CreateOperationsShiftTypeSchema>;
/** `PATCH /operations/shift-types/:id` (`operationsCatalog.manage`). No DELETE: `isActive: false`. */
export const UpdateOperationsShiftTypeSchema = z
  .object(shiftTypeCore)
  .partial()
  .extend({ isActive: z.boolean().optional(), version: z.number().int().min(0) })
  .strict();
export type UpdateOperationsShiftType = z.infer<typeof UpdateOperationsShiftTypeSchema>;

/**
 * `PUT /operations/shift-types/order` (`operationsCatalog.manage`) → 204 — the dragged order, the
 * currencies' `PUT /operations/currencies/order` exactly: the ids named first, in the order given,
 * every type not named after them in its old place; an id that is not a type → 409, nothing
 * written; versions untouched; audited as one `update` with the field `order` (old → new, names).
 */
export const OrderOperationsShiftTypesSchema = z
  .object({
    ids: z
      .array(objectId())
      .min(1)
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'A type is listed twice' }),
  })
  .strict();
export type OrderOperationsShiftTypes = z.infer<typeof OrderOperationsShiftTypesSchema>;

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

/**
 * `PATCH /operations/shipments/:id`. `shipmentType` is immutable — legacy has no path that turns a
 * يومي into a محصنة or back.
 *
 * A secured shipment's DELIVERY LEG rides a van of its delivery day (since Round 12 a draft can be on
 * one, placed by «توزيع المحصنات»). An edit that moves `deliveryDate` to another day, or clears it,
 * takes it off that van in the same transaction: the leg is retired exactly as the distribution's
 * «إزالة» retires it — `crewRemoved` in «السجل» (after the edit's own entry), event
 * `operations.shipmentAssignment.removed`. Refused with 409 `OPERATIONS_DISTRIBUTION_LEG_STARTED`
 * (detail `field` 'shipmentId', `message` its id), nothing written, when the captain has started
 * that leg in the app. An edit that keeps the delivery day keeps the van. The pickup leg (the
 * collection date's) is not touched by an edit.
 */
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
  /** Null (Round 24) when the leg rides a crew row WITHOUT A VAN — «بدون سيارة». */
  vehicleId: string | null;
  /**
   * Null when Fleet no longer answers for the vehicle — shown as missing, never as blank — and
   * (Round 24) when there is no vehicle at all (`vehicleId` null): the screen says «بدون سيارة».
   */
  vehicleCode: string | null;
  /**
   * Round 24 — a crew WITHOUT A VAN (`vehicleId` null): its number among its day's live rows
   * without a van, from 1, in the order they were added — «بدون سيارة (n)» exactly as «لوحة
   * التشغيلة», «توزيع المحصنات» and «تسليم المحصنات» number it, so two such crews are told apart on
   * every board, whichever of them carries the legs shown. Null on a van.
   */
  looseNumber: number | null;
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
  /**
   * Null (Round 24) for a crew row WITHOUT A VAN — «بدون سيارة» on «لوحة التشغيلة», which may now
   * carry محصنات like a van («عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات»). Its
   * `vehicleCode` and `drivers` are then null and empty; tell such cards apart by
   * `crewAssignmentId`, never by the van.
   */
  vehicleId: string | null;
  /** Null when Fleet cannot name the van, and always when `vehicleId` is null. */
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
   * It is NULL on a later stage too when the vault received the shipment with nobody's ✓ (Round 13:
   * «والخزنه تستلم عادي») — and stays null for good: the vault never writes it.
   *
   * A row from before Round 10 whose record was never written reads `'captain'` when its pickup
   * leg was already picked up in the app — exactly what its stage said before.
   *
   * What a screen offers from it, on a DRAFT row (`status === 'draft'`):
   *   · the desk's ✓ when it is null (grant `operationsShipment.complete`);
   *   · the desk's undo when it is set — `'captain'` OR `'operations'`: the desk may take back the
   *     captain's ✓ too (grant `operationsShipment.complete`). The captain's app has no undo;
   *   · the vault's ✓ — set or null since Round 13 (`OPERATIONS_SECURED_RECEIVABLE_STAGES` is every
   *     draft stage; grant `operationsVault.receive`).
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
// The vault custody's own record (receipt number, counts, seals, the note counts — and on a
// receipt taken before Round 18, the two receiving treasurers) is the
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
 *                        the package counts, the seals and the note counts — for a reader with
 *                        `operationsVault.view` — and, for every reader, `serialTracked` when the
 *                        vault changed it at the receipt (Round 18, «بتتعرف عند الاستلام اذا كان
 *                        سيريال او لا»). WHO received it is the entry's `actorName` since Round 18 —
 *                        the signed-in user who pressed «إستلام» («انا مش عاوز اى اسماء»); a receipt
 *                        taken before it also carries the two treasurers it named. When the vault
 *                        corrected the shipment's data in the same form (Round 18, «تعدّلها عادي»),
 *                        an `edited` entry by the same person comes just before this one.
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
 *                        shipment off its van (or «إزالة»), or an edit moved its delivery date off
 *                        its van's day or cleared it (that `edited` entry comes just before), so the
 *                        DELIVERY leg has no captain and no van any more (`leg` = 'delivery').
 *                        `changes` carry `captain` and `vehicle` (old = who / which van it was on,
 *                        new = null). The leg's earlier `crewAssigned` / `crewChanged` entries stay
 *                        in the log.
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
 *   receiptNumber                the vault receipt number (optional since Round 18 — a receipt
 *                                taken without one carries no such change)
 *   bagCount, cartonCount, boxCount  whole numbers, as digits
 *   bagSealsPerBag               '2' or '3' — the seals on each bag (Round 18, «2×» / «3×»)
 *   bagSeals, boxSeals           the seal numbers, joined by «، »
 *   denominations                the notes counted of each pound denomination (Round 18, «عدد
 *                                الورق من كل فئة»), as «denomination × count», smallest first,
 *                                joined by «، » («0.5 × 40، 200 × 15»)
 *   receivedByPrimary, receivedBySecondary  the two treasurers' full Arabic names — ONLY on a
 *                                receipt taken before Round 18, which named two; since then the
 *                                receiver is the entry's `actorName`
 * A custody value that prints as nothing on both sides (an empty seal list, no notes counted) is
 * left out: a receipt with most fields blank reads as its entry, not as a column of dashes.
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
  'bagSealsPerBag',
  'denominations',
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
//
// ROUND 14 — THE BANK REPORT IS NO LONGER THE CAPTAIN REPORT'S TWIN. The owner: «انا كنت قلت لك اعمل
// لي شاشه تقرير بنوك … انت فعلا عملتها بس حطيتها في شاشه تجميع خزينه». What he had asked for as «تقرير
// البنوك» was the per-bank roll-up of what the VAULT received — the screen that shipped as «تجميع
// الخزينة» — so that content is the bank report now (`OperationsBankReportDto` below), and the
// completed-shipments-per-bank answer it used to give is gone. The captain report keeps the
// completed-shipment set described above.

/**
 * The period of both reports — the captain report's completed shipments, and the bank report's
 * vault receipts (judged on the receipt's Cairo day rather than a shipment date). One schema, so the
 * two screens' «من» / «إلى» mean the same days and refuse the same malformed ones.
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

// ── Bank report (Round 14) — the vault roll-up of B6 (the legacy /vault1_reports + /vault1) ──────
//
// «خلي المحتوى بتاع تجميع خزينه ده يبقى اسمه تقرير بنوك، وتجميع خزينه كشاشه مفيش حاجه اسمها تجميع
// خزينه، شيلها خالص». Asked which shipments it counts, the owner chose the roll-up exactly as it
// was: SECURED shipments only, every one RECEIVED INTO THE VAULT in the period, delivered since or
// not. So `GET /operations/reports/banks` answers what `GET /operations/reports/vault` used to (that
// path is gone — one endpoint for one report), and the history below is still this report's.
//
// WHAT `/vault1_reports` ACTUALLY WAS (discovery §C, contad_app.js:1311-1333): a SHELL. It loaded
// `DataLists`, discarded it, and rendered a template with nothing but the session. Every figure on
// it came from the client re-hitting `/vault1`, which ran TWO aggregations over the same document
// set (`type:محصنة, status:2, deleted:0`, no dates):
//
//   · dataTransaction1 (:1368) — per-BANK roll-up: shipment count, EGP total, non-EGP total, and
//     bags/boxes/cartons. Packages were computed per DOCUMENT here, before any currency unwind,
//     so this one was NOT inflated — unlike legacy's captain and bank reports (Q26). The screens
//     therefore disagreed with each other about the same packages.
//   · dataTransaction2 (:1524) — the non-EGP breakdown of that same set, with EGP excluded by a
//     literal synonym list `['EGP','مصري','جنيه','جنيه مصري']` (:1409).
//
// ONE QUESTION, ASKED ONCE. Both are views of one roll-up here, and it runs through the SAME code
// path as the captain report and «تقرير الخزينة» (the API's `report-aggregation.ts`) — which is what
// makes it impossible for two screens to report different package counts for the same shipments.
//
// THE PERIOD IS THE OWNER'S, NOT LEGACY'S. Legacy's picker filtered nothing (Q32: its date filters
// were commented out in both aggregations), so the screen was always "what is held now" under two
// dates that meant nothing. The owner gave them a meaning: «يجيب اللى اتسلم واللى متسلمش ويجيب
// البداية كل اول شهر». The roll-up is every secured shipment that ENTERED THE VAULT in [from, to] —
// judged on the vault receipt's Cairo calendar day — whether it is still held, has gone out for
// delivery or has been delivered since; the period opens on the first of the current month by
// default, exactly as the captain report's does (`OperationsReportQuerySchema`). A receipt
// that was CANCELLED (Round 10) never entered the vault for this purpose; a shipment received again
// counts once, on its new receipt's day. Deleted shipments are left out, as in the captain report.
// What the vault holds right now is «تقرير الخزينة»'s question (`OperationsVaultHeldReportDto`).
//
// NO "WHICH CURRENCY IS THE POUND" FIELDS. An earlier version sent `baseCurrencyCode` and a
// `foreignCurrencies` list that told the pound by `code === 'EGP'` — wrong on the production
// catalog, whose codes are the legacy numbers «1», «2», «3», where it counted the pound as foreign.
// No client read them: the screen splits `grandTotal.currencies` with the boards' own classifier
// (code, name or legacy alias), so the pound/dollar/other split is a VIEW in exactly one place.

// Who may read the bank report is `OPERATIONS_BANK_REPORT_KEYS` (platform/navigation-hubs.ts), the
// shipments' readers and the vault's. It is declared beside the sidebar's shared row rather than
// here so the platform contracts never import a module's (the HR hub's keys live there the same way).

export interface OperationsBankReportDto {
  /** The first day of the period (UTC midnight of the Cairo calendar day), inclusive. */
  from: string;
  /** The last day of the period, inclusive — the day asked for, not the query's exclusive bound. */
  to: string;
  /** Per-bank roll-up of every shipment received into the vault in the period. */
  rows: OperationsBankReportRowDto[];
  /** Q27 NORMALIZE — separate from `rows`, so summing the rows cannot double-count. */
  grandTotal: OperationsReportTotalsDto;
}

// ── «لوحة البنك بفروعه» (Round 25) — one bank of «تقرير البنوك», broken down by its branches ──────
//
// THE OWNER: «صفحة تقرير البنوك عاوز فى الجدول عند البنك فى الاخر بعد الصناديق يكون فيه سهم ادوس عليه
// يفتح زى داش برود كدا للبنك بالفروع بتاعته». The arrow at the end of a bank's row opens that bank's
// dashboard over the SAME period the page shows; this is what it reads.
//
// `GET /operations/reports/banks/:bankId/branches?from=&to=&side=` — the bank report's own readers
// (`OPERATIONS_BANK_REPORT_KEYS`) and its own period (`from` / `to`, each falling back on its own to
// Cairo's current month, judged on the vault receipt's Cairo day). The same shipments as the bank's
// row of `GET /operations/reports/banks`: every محصنة billed to the bank (its MAIN bank) that the
// vault received in the period and kept (a cancelled receipt is not one), delivered since or not,
// deleted shipments left out — each filed under exactly ONE branch, so the branches add up to the
// bank's row figure for figure (`total` IS that row).
//
// WHICH BRANCH (`side`). A shipment names two: «من فرع», where it was collected and so where the
// vault's محصنة came from (`origin`, the default), and «إلى فرع», where it is delivered
// (`destination`). The billed bank's own branch is the destination unless a second bank was named,
// while the origin may be a branch of any bank (shipment.service.ts) — so a row whose branch belongs
// to ANOTHER bank says which (`otherBankName`), and is still this bank's money.
//
// A bank id that names no bank → 404. A bank with nothing received in the period → 200, no rows and
// a zero total. The dashboard's figures are this answer and nothing else.
export const OPERATIONS_BANK_BRANCH_REPORT_SIDES = ['origin', 'destination'] as const;
export type OperationsBankBranchReportSide = (typeof OPERATIONS_BANK_BRANCH_REPORT_SIDES)[number];

export const OperationsBankBranchReportParamsSchema = z.object({ bankId: objectId() }).strict();
export type OperationsBankBranchReportParams = z.infer<
  typeof OperationsBankBranchReportParamsSchema
>;

export const OperationsBankBranchReportQuerySchema = OperationsReportQuerySchema.extend({
  /** Which of the shipment's two branches files it — «من فرع» by default. */
  side: z.enum(OPERATIONS_BANK_BRANCH_REPORT_SIDES).default('origin'),
}).strict();
export type OperationsBankBranchReportQuery = z.infer<typeof OperationsBankBranchReportQuerySchema>;

export interface OperationsBankBranchReportRowDto {
  /** Null only for shipments whose branch no longer resolves — reported, never dropped. */
  branchId: string | null;
  branchName: string;
  branchCode: string | null;
  /** The branch's operations area («المنطقة», legacy `area`) as the catalog holds it. */
  areaName: string | null;
  /** The branch's own bank when it is NOT this bank (an origin may be any bank's); else null. */
  otherBankName: string | null;
  totals: OperationsReportTotalsDto;
}

export interface OperationsBankBranchReportDto {
  /** The first day of the period (UTC midnight of the Cairo calendar day), inclusive. */
  from: string;
  /** The last day of the period, inclusive. */
  to: string;
  side: OperationsBankBranchReportSide;
  bankId: string;
  /** The bank's operations name — the bank report's own `bankName` for it. */
  bankName: string;
  /** One per branch, branch name ascending (a screen orders them its own way). */
  rows: OperationsBankBranchReportRowDto[];
  /**
   * The bank's own figures — exactly its row of `GET /operations/reports/banks` for the same period
   * (the same shipments through the same roll-up), kept apart from `rows` as every report's total is.
   */
  total: OperationsReportTotalsDto;
}

/**
 * «تقرير الخزينة» — WHAT THE VAULT HOLDS NOW, per bank (Round 12): «اعمل فوق تقرير الخزينة يكون نفس
 * الداتا اللى فى بيان الشحنات لكل بنك ونفس الشكل وكل حاجه بس مفيش فتر من الى هيكون لحظى على ف
 * الخزينة». On top of «سجل الخزينة» (`/operations/vault`).
 *
 * `GET /operations/reports/vault/held` (`operationsVault.view` — the vault screens' grant). NO
 * parameters (any query key → 400): it is live, not a period.
 *
 * WHICH SHIPMENTS: every secured shipment IN THE VAULT right now — status `inVault`, not deleted —
 * which is exactly the set «محصنات الخزينة» lists (`GET /operations/secured/dispatch-board` with no
 * `date`), so the report and the list beside it cannot disagree. Received and not yet dispatched:
 * a dispatched one has left («هتتسلم ساعتها وخلاص مش هتبقى ف الخزنة»), a cancelled receipt put it
 * back to draft — neither is held. Packages come from the live custody, counted once per shipment.
 *
 * THE SAME ROLL-UP as the bank report (`OperationsBankReportDto`) — the same `bankReportRows`, the
 * same rows keyed on the MAIN (billed) bank, the same `grandTotal` (Q27) — so a screen prints it
 * with the very table «بيان الشحنات لكل بنك» uses; only the period is gone.
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
//      ROUND 23 — the owner reversed it for the two role flags, and only those: «ممنوع ان اعين قائد
//      مكان اخصائى والعكس الا فى حالة انه قائد اخصائى». «قائد» and «أخصائي» now decide which SLOT a
//      person may newly take (`crewRoleOf`, `fitsCrewSlot`); the other eight still gate nothing.
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

/**
 * Round 22 — who is AWAY on the board's day, as HR has it: «وعاوز لو القائد غايب يظهر تحت الكل
 * بقى فى الاخر يبقى باللون الباهت ومقدرش احطه على العربيه و كذلك الاخصائيين». Two answers only —
 * HR's `absent` and `onLeave` buckets. Anything else (at work, a weekend, no record) is not «away».
 */
export const OPERATIONS_CREW_AVAILABILITIES = ['absent', 'onLeave'] as const;
export type OperationsCrewAvailability = (typeof OPERATIONS_CREW_AVAILABILITIES)[number];

/** A crew member as the board's pool shows them: who they are, plus their flags. */
export interface OperationsCrewMemberDto {
  employeeId: string;
  code: string;
  fullNameAr: string;
  /** HR employment status, read through the seam — an exited employee is never offered. */
  status: string;
  /**
   * Round 19 — «الوظيفة»: the seat HR placed this member in, by id, named from the organization's
   * job-title catalogue. The legacy roster printed it beside the name and filtered by it («اختر
   * الوظيفة»), and «كشف طاقم العمليات» does the same.
   *
   * It travels the way the name and the code already do — through the platform directory seam, HR
   * answering — so it is read under the roster's own grant (`operationsCrew.view`), not HR's: a
   * colleague's title on the crew roster is no more an HR read than their name is. Null when HR
   * has no seat on file, or the title is no longer in the catalogue.
   */
  jobTitle: { id: string; name: { ar: string; en: string } } | null;
  /**
   * Round 19b — the member's card on «كشف طاقم العمليات»: «ولما اقف على القائد يجيب بياناته زى
   * السواق». The Fleet driver card's facts, so the mobile number and the branch travel with the
   * roster too — through the same directory seam and under the same grant as the name, the code
   * and «الوظيفة» (`operationsCrew.view`, the one the day board's captain card already reads the
   * captain's phone under). HR's primary phone as HR keeps it; null when HR has none on file.
   */
  phone: string | null;
  /**
   * The branch HR placed the member in, by id — a screen names it from the shared branch list, as
   * the captain card does. Null when HR has none on file.
   */
  branchId: string | null;
  requirements: OperationsCrewRequirementsDto | null;
  /**
   * The vehicle this member already holds on the requested day, or null. Legacy computed the same
   * thing in the browser to grey out a taken card (tashghela.ejs:1332) — here it is a server fact,
   * because the SAME rule is enforced server-side as Q11.
   */
  assignedVehicleId: string | null;
  /**
   * Round 22 — whether HR has this member AWAY on the requested day: 'absent', 'onLeave', or null.
   * The board lists an away member last in his pool, faded, and does not let him onto a row; the
   * save refuses the same (422 `OPERATIONS_CREW_MEMBER_ABSENT`), so the pool and the save cannot
   * disagree.
   *
   * WHERE IT COMES FROM: HR's day record for that day (the directory seam the attendance page
   * reads), `absent` → 'absent', `onLeave` → 'onLeave'. Where HR has NO record for the day — every
   * day it has not computed yet, which is normally every future day, the board's tomorrow included
   * — an approved or active leave covering the day answers 'onLeave'. Null otherwise: at work, a
   * weekend or holiday, «incomplete», or no record at all. An UNKNOWN IS NOT ABSENT — nobody is
   * kept off a van because attendance has not answered.
   *
   * Only the bucket travels, never HR's punches or the leave itself, and it is served under the
   * roster's grant (`operationsCrew.view`) like the rest of the member. Who may see what is the
   * owner's to decide later («موضوع مين يشوف ايه ومين يعمل ايه دا مش دلوقتي»).
   *
   * Optional only for a server that predates the field (a deploy in flight) and the board's own
   * stand-in for somebody the roster no longer names: missing means the same as null.
   */
  availability?: OperationsCrewAvailability | null;
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
//   · ROUND 22 — the owner made that new rule, for the crew BOARD: «لو القائد غايب ... مقدرش احطه
//     على العربيه و كذلك الاخصائيين». The pool's member carries `availability` and the save refuses
//     to newly place somebody HR has absent or on leave that day (`OPERATIONS_CREW_MEMBER_ABSENT`).
//     This page still refuses nothing itself, and an unknown is still not an absence.
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
  /**
   * Whether this member holds a place on ANY of the day's crew rows — a van's row or a row with
   * no van (Round 20). The page asks "is this person crewed today?", and a row without a van
   * holds its people under Q11 all the same, though `assignedVehicleId` has no vehicle to name.
   */
  isCrewed: boolean;
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

/**
 * The three slots of a crew row, by name — the board's columns «قائد الطاقم» | «أخصائي 1» |
 * «أخصائي 2», and the save's `captainEmployeeIds` / `specialist1EmployeeIds` / `specialist2EmployeeIds`.
 */
export const OPERATIONS_CREW_SLOTS = ['captain', 'specialist1', 'specialist2'] as const;
export type OperationsCrewSlot = (typeof OPERATIONS_CREW_SLOTS)[number];

/**
 * What the requirements («متطلبات الطاقم») make somebody on a crew — ONE definition, so the board
 * that colours and offers him and the server that refuses him cannot disagree (Round 23):
 *
 *   · `captain`    — «قائد» ticked and «أخصائي» not (green on the board);
 *   · `dual`       — BOTH ticked (blue): «قائد اخصائى», the one kind the owner lets sit anywhere —
 *                    «اقدر اوظفهم ك قائد او اخصائى»;
 *   · `specialist` — everybody else: «أخصائي» alone, NEITHER ticked, or NO requirements row at all
 *                    (red) — the answer legacy gave an employee nobody had ticked.
 */
export type OperationsCrewRole = 'captain' | 'dual' | 'specialist';

export const crewRoleOf = (
  requirements: { isCaptain: boolean; isSpecialist: boolean } | null | undefined,
): OperationsCrewRole =>
  requirements?.isCaptain === true
    ? requirements.isSpecialist === true
      ? 'dual'
      : 'captain'
    : 'specialist';

/**
 * May somebody of this role take this slot? Round 23, the owner: «ممنوع ان اعين قائد مكان اخصائى
 * والعكس الا فى حالة انه قائد اخصائى» — forbidden to put a captain in a specialist's slot, or a
 * specialist in the captain's, EXCEPT a captain-specialist, who fits every slot:
 *   · «قائد الطاقم» ← a captain, or a dual;
 *   · «أخصائي 1» / «أخصائي 2» ← a specialist, or a dual.
 * It replaces the Round-20 «a specialist in a captain's slot is marked, not refused».
 */
export const fitsCrewSlot = (role: OperationsCrewRole, slot: OperationsCrewSlot): boolean =>
  role === 'dual' || (slot === 'captain' ? role === 'captain' : role === 'specialist');

/**
 * Round 20 — the row's tint on the crew board: «وعاوز زرا يبقى فى كذا لون اقدر الون به الصف». A
 * planner's mark, nothing more: no rule reads it.
 *
 * Round 24b — THE TYPES' PALETTE, and an OVERRIDE: «تلقائي ويتغيّر يدوي». A row wears its type's
 * colour by itself; `rowColour` is the colour picked by hand over it, null meaning «لون النوع» (the
 * type's, or none for a row with no type). Its names ARE the palette's
 * (`OPERATIONS_SHIFT_TYPE_COLOURS`) — Round 20's own six (yellow, green, blue, red, purple, orange)
 * are gone from what the server answers: the boot migrates the stored ones
 * (`migrateCrewRowColoursToPalette`) and the boundary still TAKES them, mapped
 * (`OPERATIONS_LEGACY_CREW_ROW_COLOURS`), so an old client, or a row the migration has not reached,
 * never meets a 400.
 */
export const OPERATIONS_CREW_ROW_COLOURS = OPERATIONS_SHIFT_TYPE_COLOURS;
export type OperationsCrewRowColour = OperationsShiftTypeColour;

/**
 * Round 20's six row colours → the palette's names, each the palette's colour Round 20 drew it in:
 * its swatch was the palette's dot exactly — `yellow` bg-yellow-400 (the palette's `gold`, NOT
 * `amber`, an orange-brown amber-600 that would have read as one with `orange`), `green`
 * emerald-500, `blue` sky-500, `red` rose-500, `purple` violet-500. `orange` is a palette name too
 * and maps to itself.
 */
export const OPERATIONS_LEGACY_CREW_ROW_COLOURS = {
  yellow: 'gold',
  green: 'emerald',
  blue: 'sky',
  red: 'rose',
  purple: 'violet',
  orange: 'orange',
} as const satisfies Record<string, OperationsShiftTypeColour>;
export type OperationsLegacyCrewRowColour = keyof typeof OPERATIONS_LEGACY_CREW_ROW_COLOURS;

/** The legacy names that are NOT palette names — the ones the boundary has to translate. */
const LEGACY_ONLY_ROW_COLOURS = ['yellow', 'green', 'blue', 'red', 'purple'] as const satisfies
  readonly Exclude<OperationsLegacyCrewRowColour, OperationsShiftTypeColour>[];

/**
 * A stored or sent row colour → the palette's name, or null: a palette name as it is, a Round-20
 * name mapped, anything else (null, absent, a name no build of this contract knows) none. The one
 * reading every reader of a STORED colour goes through — a row the boot's migration has not reached
 * yet reads as it will after.
 */
export const canonicalCrewRowColour = (value: unknown): OperationsCrewRowColour | null => {
  if (typeof value !== 'string') return null;
  if ((OPERATIONS_SHIFT_TYPE_COLOURS as readonly string[]).includes(value)) {
    return value as OperationsCrewRowColour;
  }
  return Object.prototype.hasOwnProperty.call(OPERATIONS_LEGACY_CREW_ROW_COLOURS, value)
    ? OPERATIONS_LEGACY_CREW_ROW_COLOURS[value as OperationsLegacyCrewRowColour]
    : null;
};

/**
 * What the save takes for `rowColour`: a palette name, or a Round-20 name MAPPED to one (the parsed
 * value is always a palette name — the service never sees a legacy one). Anything else → 400.
 */
export const OperationsCrewRowColourSchema = z.union([
  OperationsShiftTypeColourSchema,
  z
    .enum(LEGACY_ONLY_ROW_COLOURS)
    .transform((legacy): OperationsCrewRowColour => OPERATIONS_LEGACY_CREW_ROW_COLOURS[legacy]),
]);

export interface OperationsCrewAssignmentDto {
  id: string;
  operationsDayId: string;
  /**
   * Null for a row WITHOUT A VAN (Round 20): «وعاوز اقدر اضيف صف ميكونش ليه عربيه واضيف كل البيانات
   * برضو». Such a row carries a crew and every field of a van's row, and no Fleet duty row.
   */
  vehicleId: string | null;
  fleetDutyAssignmentId: string | null;
  /** «النوع» — a type of the `أنواع التشغيل` catalog, or null («اختر»). */
  shiftTypeId: string | null;
  rowColour: OperationsCrewRowColour | null;
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

/**
 * A crew row's own facts, as the board reads them — a van's (`OperationsCrewBoardRowDto.crew`) and
 * a row without a van (`OperationsCrewBoardDto.vehiclelessRows`) alike.
 */
export interface OperationsCrewBoardCrewDto {
  /**
   * The crew row's OWN id — the `crewAssignmentId` every downstream act is addressed by, and what
   * the save names a row without a van by (`PlanOperationsCrewRowSchema.crewAssignmentId`,
   * `PlanOperationsCrewSchema.removeCrewAssignmentIds`).
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
  /**
   * «الاتجاه». A direction that names ACTIVE operations areas is saved in their own spelling (see
   * `canonicalOperationsDirection`); since Round 28 anything else is saved as the desk typed it
   * (`normalizeOperationsDirection`) — and a value saved before Round 20 may be any text, kept.
   * The distribution's proposals read the areas a direction names (`operationsDirectionAreas`),
   * so a hand-typed one proposes nothing unless it names an area.
   */
  direction: string | null;
  plannedTime: string | null;
  notes: string | null;
  /** «النوع» — a type of the `أنواع التشغيل` catalog (`GET /operations/shift-types`), or null. */
  shiftTypeId: string | null;
  rowColour: OperationsCrewRowColour | null;
}

/**
 * One board row of a VAN: the Fleet duty facts (read-only here, §9.4) joined with the cash-crew
 * facts.
 *
 * Round 24 — TWO KINDS OF VAN ROW. A van on the Fleet roster of the day («تعيين السيارات») is listed
 * whether or not a crew row holds it (`crew` null when none), exactly as before. And a van the
 * roster does NOT have that day is listed too when a crew row holds it — given on this board from
 * `freeVehicles` («بدون سيارة … يجيب كل السيارات اللى مش عليها طاقم»). Such a row has
 * `fleetDutyAssignmentId` null, no drivers and no mission type, and — unlike a roster van's row,
 * which is only ever emptied — it may be REMOVED (`removeCrewAssignmentIds`), freeing the van. If
 * Fleet rosters that van later the same day, the row reads as a roster van's (its drivers show):
 * the join is by (vehicle, day), not by the id stored on the crew row.
 */
export interface OperationsCrewBoardRowDto {
  vehicleId: string;
  vehicleCode: string;
  /**
   * The Fleet roster row of this van and day, or NULL (Round 24) when the roster does not have the
   * van that day — the row then exists only because a crew row holds the van, and may be removed.
   */
  fleetDutyAssignmentId: string | null;
  /** Fleet-owned facts, displayed not edited: the legacy tashghela board showed the drivers too. */
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  /**
   * Round 20 — the same two drivers BY NAME ONLY, for the van's hover card («ولما اعمل هوفر على
   * العربيه يظهر السواقيين اللى عليها»): the round-5 rule, a driver's details are Fleet's. Driver 1
   * then driver 2, the empty seats left out; a name the directory cannot give is null.
   */
  drivers: OperationsDayBoardDriverDto[];
  missionTypeId: string | null;
  crew: OperationsCrewBoardCrewDto | null;
}

/** Round 20 — a van Fleet's workshop holds on the board's day («صيانة» on the legacy strip). */
export interface OperationsCrewBoardWorkshopVehicleDto {
  vehicleId: string;
  vehicleCode: string;
}

/**
 * Why a free vehicle sits where it does in `OperationsCrewBoardDto.freeVehicles` — the four groups,
 * in the order they are listed:
 *   · `roster`       — on the Fleet roster of the day («تعيين السيارات»), with no crew row yet;
 *   · `cashTransfer` — a vehicle of the Fleet operations the setting
 *                      `OperationsSettingKeys.CashTransferOperationIds` names (none when unset);
 *   · `standing`     — a vehicle of «الطاقم الثابت» (the standing crew);
 *   · `other`        — every other active vehicle of the fleet.
 * A vehicle in more than one is listed once, in the first.
 */
export const OPERATIONS_CREW_FREE_VEHICLE_GROUPS = [
  'roster',
  'cashTransfer',
  'standing',
  'other',
] as const;
export type OperationsCrewFreeVehicleGroup = (typeof OPERATIONS_CREW_FREE_VEHICLE_GROUPS)[number];

/**
 * Round 24 — a vehicle with no crew on the board's day: «مكان بدون سيارة دا لما ادوس عليه يجيب كل
 * السيارات اللى مش عليها طاقم واقدر اختار منهم». What the «بدون سيارة» cell of a row offers.
 */
export interface OperationsCrewBoardFreeVehicleDto {
  vehicleId: string;
  /** Fleet's code («كود السيارة»). */
  vehicleCode: string;
  group: OperationsCrewFreeVehicleGroup;
  /** On the Fleet roster of the day — `group === 'roster'`. */
  onRoster: boolean;
  /**
   * In a Fleet workshop visit that day (Fleet's open-visit seam, the «صيانة» figure's). Listed so
   * the screen can say so; the save REFUSES such a van unless the Fleet roster has it that day
   * (422 `OPERATIONS_CREW_VEHICLE_IN_WORKSHOP`).
   */
  inWorkshop: boolean;
  /** Its drivers by name when the roster has it (`onRoster`), else empty — Fleet's round-5 rule. */
  drivers: OperationsDayBoardDriverDto[];
}

export interface OperationsCrewBoardDto {
  /** The resolved board date — tomorrow when the caller sent none (legacy parity, :2239-2247). */
  date: string;
  day: OperationsDayDto | null;
  /**
   * The VANS of the day — Fleet's duty rows, each with its crew row or null, in the roster's order;
   * then (Round 24) the vans the roster does NOT have that day but a crew row holds
   * (`fleetDutyAssignmentId` null), in the order they were added. Never a row without a van.
   */
  rows: OperationsCrewBoardRowDto[];
  /**
   * Round 20 — the day's crew rows WITHOUT A VAN («إضافة صف بدون سيارة»), in the order they were
   * added. Apart from `rows` because they have no van to show.
   *
   * Round 24 — such a row is a crew like any other to the screens after the board: «توزيع
   * المحصنات» lists it and places محصنات on it, «تسليم المحصنات» hands its load over, and its
   * captain sees his route in the app. A row that holds محصنات (live delivery legs) cannot be
   * removed (409 `OPERATIONS_CREW_ROW_HAS_SHIPMENTS`); given a van, it keeps its id and its
   * محصنات follow it (see `PlanOperationsCrewRowSchema`).
   */
  vehiclelessRows: OperationsCrewBoardCrewDto[];
  /**
   * Round 20 — the vans in a Fleet workshop visit on the day, by code: the day's duty-row vans, the
   * standing crew's vans and (when configured) the cash-transfer vans, asked of Fleet's own
   * open-visit seam. A figure on the board («صيانة ٣», the codes on hover), not rows.
   */
  workshopVehicles: OperationsCrewBoardWorkshopVehicleDto[];
  /**
   * Round 24 — «بدون سيارة … يجيب كل السيارات اللى مش عليها طاقم»: EVERY ACTIVE vehicle of the fleet
   * (Fleet status `active`, not deleted — never one out of service or disposed) that holds NO live
   * crew row on the day. A roster van with no crew row is in it (and in `rows`, `crew` null), and so
   * is a roster van whose crew row was emptied to NOTHING (no people, no direction, time, notes,
   * type or colour) and carries no shipment leg — on the board that van has no crew. Any other van
   * a crew row holds — roster or not — is not.
   *
   * Order: the four `group`s in `OPERATIONS_CREW_FREE_VEHICLE_GROUPS` order (on the roster, then the
   * cash-transfer operations' vehicles, then the standing crew's, then the rest), each by code with
   * numbers in number order («9» before «150»).
   */
  freeVehicles: OperationsCrewBoardFreeVehicleDto[];
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

/**
 * Round 28 — the longest «الاتجاه» a desk may type BY HAND, counted once its spaces are tidied. The
 * save holds the text it stores as typed to it (400 `VALIDATION_FAILED` on the row's `direction`);
 * a direction of areas, stored in their spelling, and one a row already holds are not held to it —
 * ten areas typed in 78 characters are 120 stored, and a direction of many areas saved since Round
 * 20 must stay savable. The board's box takes no more than this as it is typed.
 */
export const OPERATIONS_DIRECTION_MAX_LENGTH = 80;

/**
 * Round 28 — a direction as typed, tidied: the invisible format marks dropped (a zero-width space,
 * the bidi marks a paste brings — `\p{Cf}`), then trimmed, and every run of spaces inside it (a tab,
 * a line break, a non-breaking space) made one space. Nothing else is touched — the letters stay as
 * typed. The save stores a hand-typed direction in this form, and the board's box sends it so.
 */
export const normalizeOperationsDirection = (value: string): string =>
  value
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

/**
 * Round 28 critic — does a direction name anything: a letter or a digit? «-», «!!!» or a zero-width
 * space name nothing — the board's filters already count such a row «بدون اتجاه». The save stores
 * no NEW such direction (400 on the row's `direction`), and the board's box never offers one.
 */
export const operationsDirectionNamesSomething = (value: string): boolean =>
  /[\p{L}\p{N}]/u.test(value);

/**
 * «الاتجاه» as a save carries it (the day's row and the standing crew's alike): any text but the
 * empty string, tidied (`normalizeOperationsDirection`); `null` clears it. What the tidied text may
 * be is NOT the shape's to judge, only the save's — it alone knows whether the text is the row's own
 * (kept exactly, Round 28 critic: a blank or long one saved before the box existed included, or the
 * row could never be saved again), names areas (respelled, however long), or is typed by hand
 * (named something, at most `OPERATIONS_DIRECTION_MAX_LENGTH` characters).
 */
const crewDirection = () =>
  z.string().min(1).transform(normalizeOperationsDirection).nullable().optional();

/**
 * One row of the save. Four shapes, by its two addresses:
 *
 *   `vehicleId` | `crewAssignmentId` | what the row is
 *   ------------|--------------------|-------------------------------------------------------------
 *   V           | —                  | V ON THE FLEET ROSTER: THE VAN'S ROW, upserted by (day, V), as
 *               |                    | it always was — the live crew row holding V that day, or a new
 *               |                    | one. V OFF THE ROSTER (Round 24): always a NEW row — such a
 *               |                    | van has a row only because some desk gave it one, and a saved
 *               |                    | row is named by its id; held by a live row → 409
 *               |                    | `OPERATIONS_CREW_VEHICLE_TAKEN`, never that row overwritten.
 *   null        | —                  | a NEW row without a van (Round 20).
 *   null        | X                  | the saved row X, which has no van, edited (Round 20).
 *   V           | X                  | Round 24 — the saved row X, edited, and holding van V: «X
 *               |                    | TAKES V» when X has no van (or the same row's plain edit when
 *               |                    | X already holds V). X keeps its id; its live محصنات (delivery
 *               |                    | legs) take V in the same transaction («السجل» shows the van
 *               |                    | change on each). A row holding ANOTHER van cannot change van
 *               |                    | → 422 `BUSINESS_RULE_VIOLATION`.
 *
 * A VAN, NEW TO A ROW (a new van row, or «X takes V»), is either on the Fleet roster of the day —
 * the row then anchors on that roster row, as before — or (Round 24) NOT on it: then V must be an
 * ACTIVE Fleet vehicle (else 422 `OPERATIONS_CREW_VEHICLE_NOT_ACTIVE`) and not in a Fleet workshop
 * visit that day (else 422 `OPERATIONS_CREW_VEHICLE_IN_WORKSHOP`); the row stores no roster row.
 * Either way V must hold no OTHER live crew row that day at the end of the save (else 409
 * `OPERATIONS_CREW_VEHICLE_TAKEN` — remove that row in the same save to free it) — except a ROSTER
 * van's row emptied to nothing that carries no leg (see `OperationsCrewBoardDto.freeVehicles`): that
 * one is released (deleted) in the same save, and the row taking the van takes its place. A row
 * that already holds its van is not asked again (it keeps it, workshop or not).
 *
 * A NEW van row off the roster with nothing else on it IS saved: the van is its content (a roster
 * van's blank row is still nothing, as before).
 *
 * «X takes V» is a NEW SEAT for everybody on X, exactly as when a row without a van was given a
 * van by moving its crew onto the van's row: the round-22 absence rule and the round-23 slot rule
 * judge X's people against an empty row. Its type and direction are X's own and stay unchecked
 * while unchanged.
 *
 * Whole rows, as ever: an omitted slot or field CLEARS it — `shiftTypeId` and `rowColour` included.
 *
 * WHAT THE SERVER CHECKS BEYOND THE SHAPE (each refused with nothing written):
 *   · `shiftTypeId`, when NEWLY chosen for the row, must be an ACTIVE type → else 422
 *     `OPERATIONS_UNKNOWN_SHIFT_TYPE`. A type the row already holds stays, archived or not.
 *   · `direction` is NOT REFUSED for what it names (Round 28 — «عاوز الاتجاه اقدر اكتبه بايدى لو مش
 *     موجود فى الليست», reversing Round 20's «لازم اختار من الاتجاهات اللى موجوده بتاعت البنوك»). When
 *     NEW or CHANGED, a direction that names ACTIVE operations areas (`canonicalOperationsDirection`)
 *     is STORED as their own names, however long; anything else is stored AS TYPED, tidied
 *     (`normalizeOperationsDirection`): it must name something (`operationsDirectionNamesSomething`
 *     — not blank, not «-») and be at most `OPERATIONS_DIRECTION_MAX_LENGTH` characters → else 400
 *     `VALIDATION_FAILED` on `body.rows.<index>.direction` (`TOO_SMALL` / `TOO_BIG`). A direction
 *     the row already holds — hand-typed or legacy, blank or however long — stays exactly as
 *     written while it is sent unchanged (spaces and invisible marks aside).
 *     `OPERATIONS_DIRECTION_NOT_AN_AREA` is no longer sent.
 *   · A person NEWLY put on the row must not be away that day (the pool's `availability`: HR has
 *     them absent, or on leave) → else 422 `OPERATIONS_CREW_MEMBER_ABSENT`. Somebody already on the
 *     row stays, so a planner can still save the row's other changes.
 *   · Round 23 — a person NEWLY put in a slot must fit it (`fitsCrewSlot`: «قائد الطاقم» a captain
 *     or a dual, «أخصائي 1/2» a specialist or a dual) → else 422 `OPERATIONS_CREW_MEMBER_WRONG_SLOT`.
 *     Somebody already in that same slot of that same row stays.
 *   · Up to `CREW_SLOT_CAPACITY` people per slot (here). «من 1 ل 2 قادة و من 2 ل 4 اخصائيين» — the
 *     MINIMUMS are the board's warning (⚠), never a refusal: legacy enforced none (:2419), and a
 *     van is planned in steps.
 */
export const PlanOperationsCrewRowSchema = z
  .object({
    vehicleId: objectId().nullable(),
    crewAssignmentId: objectId().optional(),
    captainEmployeeIds: crewSlot(),
    specialist1EmployeeIds: crewSlot(),
    specialist2EmployeeIds: crewSlot(),
    direction: crewDirection(),
    plannedTime: z.string().min(1).nullable().optional(),
    notes: z.string().nullable().optional(),
    shiftTypeId: objectId().nullable().optional(),
    rowColour: OperationsCrewRowColourSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Round 24 lifted the rule that a row carrying a van may not name a crew row: that pair is now
    // how a SAVED row is given a van and keeps its id (and its محصنات) — see the table above.
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

/**
 * Upsert per (day, vehicle) — only CHANGED rows are sent (the fleet roster H4 shape) — plus, since
 * Round 20, the rows without a van: new ones created, saved ones edited by id, and
 * `removeCrewAssignmentIds` DELETING saved ones. A ROSTER van's row is never deleted here — the van
 * is Fleet's roster for the day; the board empties it instead. Round 24: a van row whose van is NOT
 * on the Fleet roster that day (the board's `fleetDutyAssignmentId` null) IS removed like a row
 * without a van, which frees the van.
 *
 * The whole save is ONE end state, judged as one (Q11 included): a row removed here releases its
 * crew — and its van — for the rows of the same save.
 *
 * GIVING A SAVED ROW WITHOUT A VAN A VAN (Round 24): send the row with BOTH its `crewAssignmentId`
 * and the van's `vehicleId` (see `PlanOperationsCrewRowSchema`). The row keeps its id and its
 * محصنات follow it onto the van. The Round-20 way — the van's row with the crew, and the old row's
 * id in `removeCrewAssignmentIds` — still works for a row that holds no محصنات, and is refused for
 * one that does (below), because removing it would strand them.
 *
 * Refused (400): nothing to save (no row and no removal), a van twice, a row id twice, a row both
 * edited and removed, a removal listed twice. Refused by the server: a `crewAssignmentId` or a
 * removal that is not a live row of this day → 404 (`NOT_FOUND`); a removal of a ROSTER van's row,
 * or a `crewAssignmentId` with `vehicleId: null` naming a row that has a van → 422
 * (`BUSINESS_RULE_VIOLATION`); a removal of a row that holds محصنات — live shipment legs, delivered
 * or not — → 409 `OPERATIONS_CREW_ROW_HAS_SHIPMENTS` (take them off it on «توزيع المحصنات» first, or
 * give the row a van instead; legs that have LEFT THE VAULT — handed over, delivered — are moved by
 * no screen, so a row holding such legs stays for the day). Emptying a row that holds محصنات is
 * NOT refused — van or not, as a van's row always was: its legs stay on the row with the captain
 * they name.
 */
export const PlanOperationsCrewSchema = z
  .object({
    date: z.coerce.date(),
    rows: z.array(PlanOperationsCrewRowSchema).max(500),
    removeCrewAssignmentIds: z.array(objectId()).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const removals = value.removeCrewAssignmentIds ?? [];
    if (value.rows.length === 0 && removals.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows'],
        message: 'a plan names at least one row or one removal',
      });
    }
    const removed = new Set<string>();
    removals.forEach((id, index) => {
      if (removed.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['removeCrewAssignmentIds', index],
          message: 'a row is removed twice in one plan',
        });
      }
      removed.add(id);
    });
    const seenVehicles = new Set<string>();
    const seenRows = new Set<string>();
    const seenEmployees = new Set<string>();
    value.rows.forEach((row, index) => {
      if (row.vehicleId !== null) {
        if (seenVehicles.has(row.vehicleId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rows', index, 'vehicleId'],
            message: 'a vehicle appears twice in one plan',
          });
        }
        seenVehicles.add(row.vehicleId);
      }
      if (row.crewAssignmentId !== undefined) {
        if (seenRows.has(row.crewAssignmentId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rows', index, 'crewAssignmentId'],
            message: 'a row appears twice in one plan',
          });
        }
        if (removed.has(row.crewAssignmentId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rows', index, 'crewAssignmentId'],
            message: 'a row cannot be both edited and removed in one plan',
          });
        }
        seenRows.add(row.crewAssignmentId);
      }
      // Q11 is UNCHANGED in meaning — one person, one ROW per operating day. Only the traversal
      // widened: each slot is now a list, so the check flattens it, and since Round 20 a row
      // without a van counts like any other («one person, one row»). Three implementations of
      // this rule exist and must move together — here, the service's end-state check, and the
      // repository's `takenCrew`.
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
              message: 'a crew member may hold one row per operating day (Q11)',
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

/**
 * One vehicle's standing crew. Beyond the shape, the server holds it to the day's own slot rule
 * (Round 23): a person NEWLY put in a slot must fit it (`fitsCrewSlot`) → else 422
 * `OPERATIONS_CREW_MEMBER_WRONG_SLOT`; somebody already in that slot of that vehicle's row stays.
 * The day is seeded from this row, so a seat the day would refuse must not be written here either.
 *
 * «الاتجاه» follows the day's rule (Round 28, see `PlanOperationsCrewRowSchema`): a NEW or CHANGED
 * direction that names active areas is stored in their spelling, anything else as typed (tidied);
 * one the row already holds stays as written while it is sent unchanged. One rule so the two boxes
 * behave alike — and, since Round 28b, because the day reads it: «تحميل الطاقم الثابت» copies the
 * people AND the direction, never the time (`standing-load.ts` on the board) — the direction onto a
 * van it fills whose day row has none, and never one the day's save would refuse (blank, «-», or
 * typed by hand past `OPERATIONS_DIRECTION_MAX_LENGTH`, as a row's own legacy one may be).
 */
export const SetOperationsStandingCrewRowSchema = z
  .object({
    vehicleId: objectId(),
    captainEmployeeIds: standingCrewSlot(),
    specialist1EmployeeIds: standingCrewSlot(),
    specialist2EmployeeIds: standingCrewSlot(),
    direction: crewDirection(),
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

/**
 * Round 18 — «عدد الورق من كل فئة»: the Egyptian pound denominations the legacy receive form counts
 * notes of, smallest first, as its row of boxes reads (0.25 … 200). A receipt may record how many
 * notes of each the vault took in; none is required.
 */
export const OPERATIONS_VAULT_DENOMINATIONS = [0.25, 0.5, 1, 5, 10, 20, 50, 100, 200] as const;
export type OperationsVaultDenomination = (typeof OPERATIONS_VAULT_DENOMINATIONS)[number];

const isVaultDenomination = (value: number): value is OperationsVaultDenomination =>
  (OPERATIONS_VAULT_DENOMINATIONS as readonly number[]).includes(value);

/**
 * Round 18 — how many seals close each bag: the legacy form's «2×» / «3×» beside «عدد الحقائب». The
 * form draws `bagCount × bagSealsPerBag` barcode boxes; the server stores the choice and whatever
 * seals were typed, and ties no count to the other («كله اختيارى»).
 */
export const OPERATIONS_VAULT_BAG_SEALS_PER_BAG = [2, 3] as const;
export type OperationsVaultBagSealsPerBag = (typeof OPERATIONS_VAULT_BAG_SEALS_PER_BAG)[number];

/** The notes of one denomination a receipt counted. Stored only when `count` is above zero. */
export interface OperationsVaultDenominationCountDto {
  value: OperationsVaultDenomination;
  count: number;
}

export const OperationsVaultDenominationCountSchema = z
  .object({
    value: z.number().refine(isVaultDenomination, {
      message: `a denomination is one of ${OPERATIONS_VAULT_DENOMINATIONS.join(', ')}`,
    }),
    count: z.number().int().min(0),
  })
  .strict();

/**
 * Custody of a secured shipment while it sits with the treasury — the treasury's own record. No
 * endpoint serves it whole: Operations reads custody through the Treasury port
 * (`OperationsVaultInventoryRowDto`, `OperationsVaultReceiptDto`), which leaves the seals out.
 */
export interface OperationsVaultCustodyDto {
  id: string;
  shipmentId: string;
  state: OperationsCustodyState;
  /**
   * Legacy `receipt_num` — typed by the vault at receive. OPTIONAL since Round 18 («ومش عاوز اى خانة
   * من الخانات دى اجبارى كله اختيارى»): null when none was typed — a screen prints «—».
   */
  receiptNumber: string | null;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  /** Round 18 — «2×» / «3×»; null on a receipt taken before the form asked. */
  bagSealsPerBag: OperationsVaultBagSealsPerBag | null;
  /** Legacy `bag_seals` / `box_seals` — barcode arrays, blank entries dropped. */
  bagSeals: string[];
  boxSeals: string[];
  /** Round 18 — the notes counted of each denomination, smallest first; only those above zero. */
  denominations: OperationsVaultDenominationCountDto[];
  /**
   * Round 18 — WHO received it: the signed-in user who pressed «إستلام», read by the server from the
   * token, never sent by the form («انا مش عاوز اى اسماء»). Null on a receipt taken before Round 18,
   * which named two treasurers instead (below).
   */
  receivedById: string | null;
  /** That user's Arabic display name (English when there is none); null when unknown or none. */
  receivedByName: string | null;
  /**
   * Legacy `treasurer_receive` + `treasurer_receive2` — the two treasurers a receipt taken BEFORE
   * Round 18 named (Q2's dual control, which the owner dropped: «انا مش عاوز اى اسماء»). Kept as they
   * were stored, so an old receipt still says who signed for it; null on every newer receipt.
   */
  receivedByPrimaryId: string | null;
  receivedBySecondaryId: string | null;
  receivedAt: string;
  /** Legacy `treasurer_delivery` / `treasurer_delivery_date` — declared but NEVER written (Q3). */
  releasedById: string | null;
  releasedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Round 18 — the shipment's data as the vault corrects it in its own receive form: «تعدّلها عادي».
 * EXACTLY the edit form's fields and rules (`UpdateOperationsShipmentSchema`, and on the server the
 * very checks `PATCH /operations/shipments/:id` makes — banks, branch-of-bank, currencies, the date
 * rules, a delivery date moved off its van's day), minus two: `version`, which the receive carries
 * once for the whole act, and `serialTracked`, which is the receipt's own field
 * (`ReceiveIntoVaultSchema.serialTracked`). Send only what changed: every field is optional and a
 * field left out is not touched — so an empty patch corrects nothing and is no edit at all.
 */
export const ReceiveIntoVaultShipmentPatchSchema = UpdateOperationsShipmentSchema.omit({
  version: true,
  serialTracked: true,
});
export type ReceiveIntoVaultShipmentPatch = z.infer<typeof ReceiveIntoVaultShipmentPatchSchema>;

/**
 * A list of seal numbers as typed, each trimmed. The blank ones (an empty box is no seal) are
 * dropped by `ReceiveIntoVaultSchema` itself, AFTER the repeat check, so a repeat is named at the
 * index the client sent it at, not at its index once the blanks are gone.
 */
const sealNumbers = z.array(z.string().trim()).max(500).default([]);

const withoutBlanks = (seals: readonly string[]): string[] => seals.filter((seal) => seal !== '');

/**
 * Round 21 — WHAT MAKES TWO SEALS THE SAME SEAL, for the vault receipt's one-seal-once rule (the
 * owner: «مينفعش يكون فيه رقم للحقائب و الصناديق زى بعض برضو»). One definition for the contract's
 * refusal and the receive form's red boxes, so the two can never disagree about a repeat:
 *
 *   · A seal of digits only is a WHOLE NUMBER: 0099 and 99 are one seal, and ٩٩ (Arabic-Indic, as
 *     an Arabic keyboard types it) is that seal too. Compared as text with the leading zeros gone,
 *     so a barcode longer than a JavaScript number is exact still compares exactly.
 *   · Anything else (a barcode with a letter in it) is compared exactly as typed, trimmed.
 *   · A blank is no seal: null.
 *   · What cannot be SEEN is not read: the invisible format marks (Unicode Cf — the right-to-left
 *     and left-to-right marks a number copied from an Arabic message or sheet carries, zero-width
 *     spaces) are dropped first. The owner's rule is about what the clerk sees: two boxes that
 *     both show 12 are the same seal, whatever invisible mark one of them holds.
 *
 * Not to be confused with the ATM module's `sealKey` (DS-15), which is that module's own rule.
 */
export const vaultSealKey = (seal: string): string | null => {
  const trimmed = seal.replace(/\p{Cf}/gu, '').trim();
  if (trimmed === '') return null;
  const digits = asciiDigits(trimmed);
  return /^[0-9]+$/u.test(digits) ? digits.replace(/^0+(?=[0-9])/u, '') : trimmed;
};

/**
 * The vault's ✓ — `POST /operations/secured/:id/receive` (`operationsVault.receive`): custody taken,
 * the shipment `draft` → `inVault`, and from then on LOCKED (`isOperationsShipmentLocked`). Answers
 * 200 with `OperationsVaultReceiveResultDto` — the updated shipment, plus the receipt just taken.
 *
 * ROUND 18 — THE LEGACY «إستلام محصنة» FORM («عاوز اخلى الفورم دا لما اجى استلم محصنة»), and the
 * owner's answers:
 *   · EVERYTHING IS OPTIONAL («انا مش عاوز اى اسماء ومش عاوز اى خانة من الخانات دى اجبارى كله
 *     اختيارى») — the receipt number included. `{ version }` alone receives. `receiptNumber` is
 *     trimmed, and an empty one is none (null). The counts default to 0, `bagSealsPerBag` to 2.
 *   · NO NAMES. The two treasurers (`receivedByPrimaryId` / `receivedBySecondaryId`, Q2's dual
 *     control) are gone from the request — sending them is a 400 like any unknown field. The
 *     custody records WHO received it from the token (`receivedById`): the signed-in user.
 *   · SEALS: `bagSeals` / `boxSeals` as typed, each trimmed, blank entries dropped. No length is tied
 *     to the counts — the form draws `bagCount × bagSealsPerBag` boxes for bags and 2 per box, and
 *     what is left empty is simply not a seal. Cartons have none.
 *   · ONE SEAL, ONCE PER RECEIPT (Round 21 — «مينفعش يكون فيه رقم للحقائب و الصناديق زى بعض برضو»):
 *     a seal number appears once across `bagSeals` AND `boxSeals` together — a bag's seal may not be
 *     a box's, and no seal may be typed twice in its own list. "The same seal" is
 *     `vaultSealKey`'s (0099 = 99 = ٩٩). A refusal, not a warning: 400 `VALIDATION_FAILED`, the
 *     issue on the LATER occurrence (`body.boxSeals.1`, as sent — blanks counted), its message
 *     naming the seal and where it first appeared.
 *   · NOR A SEAL STILL IN THE VAULT (Round 21b — «لو موجوده عندنا لا ك محصنة يبقى مينفعش ولو دخلت
 *     وخرجت واتكرر يبقى عادى»): a seal of ANOTHER محصنة the vault holds now (its custody `held`, the
 *     receipt not cancelled) refuses the receipt — 409 `OPERATIONS_SEAL_HELD_IN_VAULT`, nothing
 *     written. A seal of one that came in and went out again (released, dispatched, completed), or
 *     whose receipt was cancelled, may repeat. Same `vaultSealKey`. The form asks as seals are
 *     typed: `POST /operations/secured/seal-check` (`CheckVaultSealsSchema`).
 *   · «عدد الورق من كل فئة»: `denominations`, the notes counted of each pound denomination
 *     (`OPERATIONS_VAULT_DENOMINATIONS`); a value not in the list, or the same one twice, is a 400;
 *     a count of 0 is accepted and not stored.
 *   · «سيريال» — «بتتعرف عند الاستلام اذا كان سيريال او لا»: `serialTracked` sets the shipment's flag
 *     at the receipt (left out → untouched); a change shows on the `vaultReceived` entry of «السجل».
 *   · THE SHIPMENT'S DATA MAY BE CORRECTED IN THE SAME FORM («تعدّلها عادي»): `shipment` carries the
 *     edits (`ReceiveIntoVaultShipmentPatchSchema` — the edit form's fields and rules), applied in
 *     the SAME transaction as the receipt: the edit first (version-checked), then the custody and
 *     the move to `inVault`. Refused by any edit rule (422 `OPERATIONS_UNKNOWN_BRANCH`,
 *     `OPERATIONS_BRANCH_BANK_MISMATCH`, a date rule, 409 `OPERATIONS_DISTRIBUTION_LEG_STARTED` …) →
 *     nothing is written, the shipment stays draft and unreceived; a receive that fails after the
 *     edit rolls the edit back with it. «السجل» shows an `edited` entry with what the vault changed,
 *     then `vaultReceived`, both by the receiver. The GRANT is the receive's: `operationsVault.receive`
 *     covers the edits made inside it — `operationsShipment.edit` is not asked — because they are
 *     part of the vault's act, made while it receives, on a shipment that is still a draft (the only
 *     state a receive starts from), and locked by the very same act.
 *   After the receipt everything is locked, as since Round 10.
 *
 * FROM ANY DRAFT since Round 13 — white or yellow (`OPERATIONS_SECURED_RECEIVABLE_STAGES`): «واستلام
 * الخزينه ممكن تستلم يكون القائد معلمش التسليم، او ان العمليات معملتش التسليم والخزنه تستلم عادي».
 * Round 10's refusal of a white row (409 `OPERATIONS_SECURED_NOT_PICKED_UP`, «مش هيقدر يعمل صح الا
 * لما القائد او العمليات تبقى عامله صح») is LIFTED; that code now answers the desk's undo alone.
 *
 * The receipt does NOT write the pickup record: received white, the row is `inVault` with
 * `pickedUpBy: null` / `pickedUpAt: null` for good — «لم يتم الاستلام» in the vault screen's pickup
 * column, «بالخزينة» in its vault column. «السجل» shows the `vaultReceived` entry and no pickup
 * entry. Received yellow, it keeps who brought it, as before. Either way the desk's pickup ✓ and its
 * undo are locked from here (409 `OPERATIONS_SECURED_LOCKED`), like every other change of its data.
 *
 * THE CAPTAIN'S PICKUP LEG after a white receipt: a leg he never STARTED is settled — the stop reads
 * `progress: 'completed'` in his day (its `executionStatus` still `pending`, never rewritten), stops
 * blocking the stops after it, and acting on it answers 422 `OPERATIONS_EXECUTION_ALREADY_SETTLED`.
 * A leg he HAD started stays his to finish (his ✓, «تم التسليم», «تم»); his ✓ then records his leg
 * only, never the shipment's pickup. See `OPERATIONS_STOP_PROGRESS`.
 *
 * The custody and the shipment's move are ONE transaction since Round 10: a receive refused at
 * either leaves nothing behind. The other refusals are unchanged: 422
 * `OPERATIONS_NOT_A_SECURED_SHIPMENT`, 422 `OPERATIONS_INVALID_SHIPMENT_TRANSITION` (not `draft`),
 * 409 `STALE_DOCUMENT`, 409 when custody is already held.
 *
 * A receipt cancelled later (`POST /operations/secured/:id/cancel-receipt`) VOIDS its custody: the
 * row is kept (receipt, counts, seals, note counts, who received it, plus when / who / why it was
 * cancelled) but no list reads it again — the shipment's «السجل» still shows it, as
 * `vaultReceived` then `receiptCancelled`.
 */
export const ReceiveIntoVaultSchema = z
  .object({
    receiptNumber: z
      .string()
      .trim()
      .nullish()
      .transform((value) => (value == null || value === '' ? null : value)),
    bagCount: z.number().int().min(0).default(0),
    cartonCount: z.number().int().min(0).default(0),
    boxCount: z.number().int().min(0).default(0),
    bagSealsPerBag: z.union([z.literal(2), z.literal(3)]).default(2),
    bagSeals: sealNumbers,
    boxSeals: sealNumbers,
    denominations: z
      .array(OperationsVaultDenominationCountSchema)
      .max(OPERATIONS_VAULT_DENOMINATIONS.length)
      .default([]),
    /** The shipment's `serial` flag — «بتتعرف عند الاستلام اذا كان سيريال او لا». */
    serialTracked: z.boolean().optional(),
    /** Round 18 — the shipment's data as the vault corrected it in the form («تعدّلها عادي»). */
    shipment: ReceiveIntoVaultShipmentPatchSchema.optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    // One count per denomination: two boxes for «200» would be two answers to one question.
    const seen = new Set<number>();
    value.denominations.forEach((line, index) => {
      if (seen.has(line.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['denominations', index, 'value'],
          message: 'a denomination appears twice in one receipt',
        });
      }
      seen.add(line.value);
    });
    // Round 21 — «مينفعش يكون فيه رقم للحقائب و الصناديق زى بعض برضو»: a seal closes ONE package,
    // so one receipt names it once — bags and boxes read as one list, bags first. The first time a
    // seal appears is its place; every later one is refused where it stands.
    const firstAt = new Map<string, string>();
    for (const list of ['bagSeals', 'boxSeals'] as const) {
      value[list].forEach((seal, index) => {
        const key = vaultSealKey(seal);
        if (key === null) return;
        const first = firstAt.get(key);
        if (first === undefined) {
          firstAt.set(key, `${list}.${index}`);
          return;
        }
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [list, index],
          message: `seal ${JSON.stringify(seal)} is already in this receipt at ${first} — a seal appears once across bagSeals and boxSeals`,
        });
      });
    }
  })
  .transform((value) => ({
    ...value,
    bagSeals: withoutBlanks(value.bagSeals),
    boxSeals: withoutBlanks(value.boxSeals),
  }));
export type ReceiveIntoVault = z.infer<typeof ReceiveIntoVaultSchema>;
/** What a client sends — every field but `version` may be left out. */
export type ReceiveIntoVaultInput = z.input<typeof ReceiveIntoVaultSchema>;

/** One seal check asks about at most two lists' worth of seals — the receipt's own ceiling. */
export const OPERATIONS_VAULT_SEAL_CHECK_MAX = 1000;

/**
 * Round 21b — WHICH OF THESE SEALS IS STILL IN THE VAULT? `POST /operations/secured/seal-check`,
 * on the receive's own grant (`operationsVault.receive`). The owner, asked whether a seal already
 * recorded on another محصنة should be refused: «لو موجوده عندنا لا ك محصنة يبقى مينفعش ولو دخلت وخرجت
 * واتكرر يبقى عادى». The receive form asks as seals are typed or scanned, and marks the ones the vault
 * holds now before «استلام» is pressed.
 *
 *   · "Still in the vault" is the receipt's own rule: a custody `held` (not released to a van) on a
 *     receipt not cancelled — exactly what the vault inventory lists. "The same seal" is
 *     `vaultSealKey`'s (0099 = 99 = ٩٩; a seal with a letter in it as typed).
 *   · `seals`: bags and boxes in one list, each trimmed; a blank one is no seal and is skipped.
 *   · `excludeShipmentId`: the shipment being received — its own custody, should it hold one, is
 *     not "another محصنة".
 *   · A POST although it writes nothing: a list of a receipt's seals belongs in a body, out of URLs
 *     and access logs, as the receipt itself carries them.
 *
 * Answers 200 `OperationsVaultSealCheckDto`. ADVICE ONLY: the receipt decides, in its own
 * transaction, with 409 `OPERATIONS_SEAL_HELD_IN_VAULT` — a check made a moment before another
 * receipt was taken can be stale.
 */
export const CheckVaultSealsSchema = z
  .object({
    seals: z.array(z.string().trim()).max(OPERATIONS_VAULT_SEAL_CHECK_MAX),
    excludeShipmentId: objectId().optional(),
  })
  .strict();
export type CheckVaultSeals = z.infer<typeof CheckVaultSealsSchema>;

/** The held محصنة a seal is on — what tells it apart to a treasurer, as the vault screens name it. */
export interface OperationsVaultSealHolderDto {
  shipmentId: string;
  /** That receipt's «رقم الإيصال»; null when the vault typed none. */
  receiptNumber: string | null;
  /** The main bank's operational name (`opsName`). */
  mainBankName: string;
  originBranchName: string;
  destinationBranchName: string;
  /** When the vault took it in — ISO instant. */
  receivedAt: string;
}

/** A seal the check was asked about that the vault holds now. */
export interface OperationsVaultHeldSealDto {
  /** The seal as sent, trimmed — its first spelling when the same seal was sent more than once. */
  seal: string;
  holder: OperationsVaultSealHolderDto;
}

export interface OperationsVaultSealCheckDto {
  /** Each seal sent that the vault holds now, once, in the order sent; empty when none is. */
  held: OperationsVaultHeldSealDto[];
}

/**
 * Round 18 — the receipt the vault's ✓ just took, as the Treasury port hands it back: what the
 * «إيصال» print needs that the form does not already hold — when it was received, the receipt
 * number and counts as STORED (trimmed, zero counts dropped), and who received it, by name. The seal
 * numbers stay behind the port, as on every Operations read: the print takes them from the form,
 * trimmed and with the blank ones dropped — the very rule the server stores them by.
 */
export interface OperationsVaultReceiptDto {
  custodyId: string;
  receiptNumber: string | null;
  /** ISO instant. */
  receivedAt: string;
  /** The signed-in user who received it (from the token). */
  receivedById: string;
  /** Their Arabic display name (English when there is none); null when unknown. */
  receivedByName: string | null;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  bagSealsPerBag: OperationsVaultBagSealsPerBag;
  denominations: OperationsVaultDenominationCountDto[];
}

/** `POST /operations/secured/:id/receive`'s answer: the shipment (now `inVault`) and its receipt. */
export interface OperationsVaultReceiveResultDto extends OperationsShipmentDto {
  receipt: OperationsVaultReceiptDto;
}

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
  /**
   * Legacy `car_num2` for the delivery leg (`car_num1` for pickup) — the van of the crew row the
   * leg rides. NULL (Round 24) for a delivery leg on a crew row WITHOUT A VAN («عاوز لو عربيه من غير
   * كود عادى تظهر ان اوزع عليها محصنات»): it rides the row, and the row has no van yet. Giving the
   * row a van on «لوحة التشغيلة» writes the van onto its live legs in the same save.
   */
  vehicleId: string | null;
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
 * Round 24: the crew row may be one WITHOUT A VAN — the same delivery leg «توزيع المحصنات» writes,
 * so both doors accept the same rows. (The daily PICKUP leg — `pickup` on the shipment form,
 * `AssignShipmentPickupLegSchema` — still takes a van's row only: 404 for a row without a van.)
 * Round 25: and both keep the «محصنة» rule — a row not of that type takes no محصنة unless its
 * delivery leg is already on that row: 422 `OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED`, checked after
 * the day and before the captain, naming the shipment and the row.
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
 *
 * Today's vans only: a crew row of any other operating day (Cairo calendar) is refused with 422
 * `OPERATIONS_DISPATCH_NOT_TODAY` before any shipment is looked at — a van leaves on its own day.
 * Round 24: a crew row WITHOUT A VAN is handed over exactly like a van (404 only when the crew row
 * does not exist or was removed).
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
 * screen totalled bags/boxes/cartons per bank (contad_app.js:1437-1447), and since Round 18 the
 * note counts and the seals-per-bag choice of the legacy receive form, and WHO received it — the
 * signed-in user, by name. A receipt taken before Round 18 named two treasurers (Q2's dual control,
 * dropped by the owner: «انا مش عاوز اى اسماء»); those stay readable here as they were stored. It
 * carries NO seal barcodes: no legacy Operations screen or report read them, so they stay behind
 * the port.
 */
export interface OperationsVaultInventoryRowDto {
  id: string;
  shipmentId: string;
  state: OperationsCustodyState;
  /** Null when the vault typed none (optional since Round 18) — a screen prints «—». */
  receiptNumber: string | null;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  /** «2×» / «3×»; null on a receipt taken before Round 18. */
  bagSealsPerBag: OperationsVaultBagSealsPerBag | null;
  /** «عدد الورق من كل فئة», smallest first, only those above zero; empty on an older receipt. */
  denominations: OperationsVaultDenominationCountDto[];
  /** The user who received it (Round 18); null on a receipt taken before. */
  receivedById: string | null;
  /** Their Arabic display name (English when there is none); null when unknown or none. */
  receivedByName: string | null;
  /** The two treasurers of a receipt taken before Round 18; null on every newer one. */
  receivedByPrimaryId: string | null;
  receivedBySecondaryId: string | null;
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
 * turns yellow (`withOperations`) and the vault's pickup column says «تم الاستلام من العمليات» (the
 * vault may receive it either way since Round 13). DELETE CLEARS the record, whoever
 * wrote it — the captain's ✓ from the app included («لو القائد عمل صح ممكن العمليات تشيلها») — and
 * the row turns white again; the desk may then ✓ it again (as Operations). The undo never rewrites
 * the captain's pickup leg: that stays his execution record.
 *
 * Refusals, in the order they are checked:
 *   · 403 — without `operationsShipment.complete`;
 *   · 404 — no such shipment (or deleted);
 *   · 422 `OPERATIONS_NOT_A_SECURED_SHIPMENT` — a daily shipment;
 *   · 409 `OPERATIONS_SECURED_LOCKED` — the vault has received it (status is not `draft`): the ✓
 *     can be taken back only UNTIL the vault receives — and a receipt nobody handed over (Round 13)
 *     is locked the same way: neither the ✓ nor the undo can be pressed after it;
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
 *   · the vault custody is VOIDED, never erased: the custody row keeps its receipt, counts, seals,
 *     note counts and who received it (the receiving user since Round 18; the two treasurers of a
 *     receipt taken before), gains `cancelledAt` / `cancelledById` / `cancelReason`, and leaves every live
 *     read (the vault inventory, the roll-up, the reports, today's receipts on the receive queue) —
 *     so a fresh receipt can be taken later;
 *   · the shipment returns to `draft`, its `receiptNumber` cleared, its pickup record INTACT — so
 *     it is YELLOW again (`withCaptain` / `withOperations`) when somebody had collected it, WHITE
 *     again (`awaitingPickup`) when the vault had received it with nobody's ✓ (Round 13 — the
 *     cancel invents no pickup), editable again, and receivable again either way.
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
 *   · `date` — OPTIONAL, a whole day; left out → TODAY on the Cairo calendar. An empty `date=` is a
 *     400 (omit the key). Round 30 — «عاوز هنا يقدر يجيب اليوم اللى قبله ك رؤيى بس ميقدرش يعدل عليه
 *     او يعمل حاجه ك سجل يعنى»: a day BEFORE today is no longer refused — it answers as that day's
 *     RECORD (`past` true, see `OperationsSecuredDistributionDto`), read only: the save refuses it
 *     (422 `OPERATIONS_DISTRIBUTION_DAY_IN_PAST`).
 */
export const OperationsSecuredDistributionQuerySchema = z
  .object({ date: z.coerce.date().optional() })
  .strict();
export type OperationsSecuredDistributionQuery = z.infer<
  typeof OperationsSecuredDistributionQuerySchema
>;

/** A shipment's delivery leg as it stands — on whatever day it is planned. */
export interface OperationsSecuredDistributionLegDto {
  /** The crew row (the van of that day, or a row without a van — Round 24) the leg rides. */
  crewAssignmentId: string;
  captainEmployeeId: string;
  /** Null (Round 24) when the leg rides a crew row without a van. */
  vehicleId: string | null;
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
   * «متأخرة» — an IN-VAULT shipment whose delivery date has PASSED: before TODAY on the Cairo
   * calendar (`today`), the very rule «محصنات الخزينة» marks it by. Placing it on a van of the day
   * moves its delivery date to the day (see the save). False for every shipment due on the day.
   *
   * Before TODAY, not before the screen's day: on a later day's screen a shipment due today (or
   * any day before that later day) is not late — it is its own day's, and is not listed there at
   * all. Otherwise a desk planning tomorrow would see today's load marked «متأخرة», unplaced (its
   * van is today's), proposed onto tomorrow's van by its direction — and one «حفظ» would pull it
   * off today's van and push its delivery to tomorrow.
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
   * of the «محصنة» type (`securedType`, Round 25) that have at least one captain and whose `direction`
   * names this shipment's `areaName`
   * (`operationsDirectionMatchesArea`), in `crews` order. The screen PROPOSES the shipment onto the
   * van when it is unplaced and this holds EXACTLY ONE id — on load, and again on «توزيع تلقائي»;
   * with none or several it is left for the person. A proposal is the screen's until «حفظ».
   */
  directionCrewAssignmentIds: string[];
}

/**
 * A crew row on «توزيع المحصنات» / «تسليم المحصنات» — the boards' van card, plus (Round 25) whether
 * the row's «النوع» is the seeded «محصنة» type.
 */
export interface OperationsSecuredDistributionCrewDto extends OperationsDayBoardVehicleCrewDto {
  /**
   * True for a row of the «محصنة» type — the only rows that take محصنات. False for a row of another
   * type (or none) listed only because it already carries one of this screen's shipments: the screen
   * marks it («ليس من نوع محصنة») and offers it no new one.
   */
  securedType: boolean;
  /** The row's «النوع» by name (the catalog's Arabic name), or null when it has none. */
  shiftTypeName: string | null;
  /**
   * A row WITHOUT A VAN: its number among ALL the day's rows without a van, in the order they were
   * added — «لوحة التشغيلة»'s «بدون سيارة (n)», whatever their type — so the screen names it as the
   * board does even though it lists the «محصنة» rows only. Null on a van's row.
   */
  looseNumber: number | null;
}

/** Round 30 — one shipment's packages as the vault counted them at its receipt (`recordPackages`). */
export interface OperationsSecuredDistributionPackagesDto {
  shipmentId: string;
  bags: number;
  cartons: number;
  boxes: number;
}

export interface OperationsSecuredDistributionDto {
  /** The day distributed (its UTC midnight, ISO) — today in Cairo when none was asked for. */
  date: string;
  /**
   * TODAY on the Cairo calendar (UTC midnight, ISO) — the earliest day that can be distributed
   * (Round 30: an earlier one is read as its record, `past`).
   */
  today: string;
  /**
   * Round 30 — `date` is BEFORE `today`: the answer is that day's RECORD, READ ONLY. Nothing of it
   * can be written — the save refuses the day (422 `OPERATIONS_DISTRIBUTION_DAY_IN_PAST`, before any
   * shipment), and the screen offers no drag, «نقل إلى…», «توزيع تلقائي», «تراجع» or «حفظ».
   *
   * WHAT A RECORD SHOWS — what is STORED NOW about the day, not a photograph taken on it:
   *   · `crews`: the day's saved crew rows, by the same rule as a day to come (the «محصنة» rows, and
   *     a row of another type that carries one of `shipments`), as they were last saved;
   *   · `shipments`: every secured shipment (not deleted) DUE on the day, WHATEVER its status now —
   *     handed over, delivered, still in the vault (then `overdue`), never received — and every one
   *     whose LIVE delivery leg rides one of the day's crew rows; each at its CURRENT stage, on the
   *     van its live leg rides (`placedCrewAssignmentId`), or on none;
   *   · every `directionCrewAssignmentIds` is EMPTY: a record proposes nothing.
   * WHAT IT CANNOT SHOW: a shipment taken off its van since (its leg retired — the story is in its
   * «السجل»), or moved to another day since (its delivery date, or its leg, now another day's — it is
   * on that day's screen); and the OVERDUE ones that waited in the vault that day without being placed
   * on one of its vans (which shipments were overdue on a past day is not kept).
   * False on today and on every day after it.
   */
  past: boolean;
  /**
   * Round 30 — on a RECORD (`past`), for a reader of the vault (`operationsVault.view`, the grant
   * the screen's packaging read already rides): each listed shipment's packages as the vault counted
   * them at its receipt — held now OR SINCE HANDED OVER (the vault's holdings no longer carry what
   * left on the day's vans). A shipment the vault never took in (or whose receipt was cancelled) is
   * absent. NULL on today and every later day (the screen reads the vault's holdings, as before) and
   * for a reader without the vault's grant.
   */
  recordPackages: OperationsSecuredDistributionPackagesDto[] | null;
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
   * name, `direction`, `plannedTime`. A van with no captain is listed but cannot take a shipment
   * (the save answers `OPERATIONS_CREW_CAPTAIN_MISMATCH`). Empty when nothing is planned for the day.
   *
   * Round 24 — «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات»: a crew row WITHOUT A VAN
   * («بدون سيارة» on the board) is listed too and takes محصنات exactly like a van — `vehicleId`,
   * `vehicleCode` null, `drivers` empty; tell it apart by `crewAssignmentId`.
   *
   * Order: the vans by van code (numbers in number order; a van Fleet cannot name last), THEN the
   * rows without a van in the order they were added on the board.
   *
   * Round 25 — «انا عاوز اللى يظهر اللى نوعها محصنة بس ولازم اكون دايس حفظ»: only SAVED crew rows
   * (the board's unsaved draft is not in the database) whose «النوع» is the seeded «محصنة» type
   * (`seedKey` 'secured' — a rename keeps it), van or none. A row of another type, or with no type,
   * is not listed — UNLESS it already holds the live delivery leg of a shipment listed here (placed
   * before Round 25, or its type changed since): then it stays, `securedType` false, so nothing on
   * it vanishes; it takes no NEW shipment (the save answers `OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED`).
   */
  crews: OperationsSecuredDistributionCrewDto[];
  /**
   * THE MAHSANAT (the left column, and each van's load): every SECURED shipment, not deleted, that is
   *   · due on the day (`deliveryDate` = `date`) and not yet out — status `draft` (any stage:
   *     awaitingPickup / withCaptain / withOperations — placeable now, handed over only once the
   *     vault has it) or `inVault`; or
   *   · OVERDUE in the vault — status `inVault` with a delivery date before TODAY (`today`, Cairo
   *     — see `overdue`). On today's screen that is "before `date`"; on a later day's, a shipment
   *     due between today and that day is its own day's and is not listed.
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
 *     before TODAY, Cairo — `overdue`) — a draft due another day, one with no delivery date, or one
 *     in the vault due on a later day than today but before `date` (it is its own day's), is not
 *     this day's;
 *   · the version: 409 `STALE_DOCUMENT` unless `version` is its delivery leg's current version
 *     (null ⇔ no leg);
 *   · a take-off (`crewAssignmentId` null): 422 `OPERATIONS_CREW_DAY_MISMATCH` when its leg rides a
 *     crew row of ANOTHER day — an overdue one's leg left on a past day's van is that day's record
 *     (Round 30), which no save changes;
 *   · the leg: 409 `OPERATIONS_DISTRIBUTION_LEG_STARTED` when the captain has started it in the app
 *     (its `executionStatus` is not `pending`) and the change would move or clear it;
 *   · the van: 404 when the crew row does not exist (or was removed); 422
 *     `OPERATIONS_CREW_DAY_MISMATCH` when it is a crew row of another day; 422 `OPERATIONS_CREW_CAPTAIN_MISMATCH` when the captain is not one of
 *     its captains (a van with two captains takes either — the screen sends the one chosen on the
 *     van card, the first by default). Round 24: a crew row WITHOUT A VAN of the day is a van here
 *     like any other — same checks, and the leg it gets has `vehicleId` null. Round 25: 422
 *     `OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED` when the row's «النوع» is not the seeded «محصنة»
 *     type (another type, or none) and the shipment's delivery leg is not already on that row —
 *     checked after the day, before the captain; a second detail names the row (`field`
 *     'crewAssignmentId', `code` 'NOT_SECURED', `message` its id).
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
//      punctuation mark or symbol made a SPACE (Round 28 critic — «شبرا/الخيمة» is «شبرا الخيمة», as
//      a desk types it; dropped, it was «شبراالخيمه», which no typing reached), any other character
//      that is not a letter, a digit or a space dropped; a leading «ال» taken off each word longer
//      than three letters («المعادي» = «معادي», «ال» alone stays); spaces made one.
//   3. The shipment matches the van when its folded area EQUALS the WHOLE folded direction (an area
//      whose own name holds a separator, «شبرا/الخيمة», is never split — Round 28 critic), or one
//      folded area of the direction — equal, never "contains": «مصر» does not match «مصر الجديدة».
//   4. No area, or no direction, or either folding to nothing → no match.

/** Where a direction is split into its areas (rule 1) — shared with the board's direction box. */
export const OPERATIONS_DIRECTION_SEPARATOR = /\s*[-–—/\\|،,؛;+&]\s*|\s+و\s+/u;
const DIRECTION_SEPARATOR = OPERATIONS_DIRECTION_SEPARATOR;

/** One area name, folded (rule 2) — exported so a screen can show what was compared. */
export const foldOperationsAreaName = (value: string): string =>
  asciiDigits(value)
    .toLowerCase()
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/gu, '')
    .replace(/\p{Cf}/gu, '')
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/ة/gu, 'ه')
    .replace(/[\p{P}\p{S}]/gu, ' ')
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

/**
 * A direction read against the areas: does it name ACTIVE operations areas only? Every area it
 * names is looked up in `areaNames` (the ACTIVE operations areas — the names the branches'
 * «المنطقة» uses), compared FOLDED (rule 2), and the direction is returned in the areas' OWN
 * spelling: one area → its name; several (rule 1's separators — a direction may still name
 * «المعادي - حلوان», the distribution reads both) → their names joined by « - », each once. The
 * WHOLE text is tried as one area first, so an area whose name holds a separator («شبرا/الخيمة»)
 * is never split.
 *
 * Round 28b critic — and so is a RUN of parts inside a longer direction: «شبرا/الخيمة - المعادي»,
 * split at «/» too, was «شبرا» and «الخيمة» — no areas — so the answer read again was no answer.
 * The save judged this function's own respelling hand-typed text, held it to
 * `OPERATIONS_DIRECTION_MAX_LENGTH`, and refused «تحميل الطاقم الثابت»'s copy of a standing
 * direction of eight areas (400 `TOO_BIG`), as it refused the picker's. Consecutive parts are now
 * read as ONE area wherever the text between them folds to its name, the longest run first (as the
 * whole text is), so this function's answer, read again, is an answer too — and stays savable
 * however long.
 *
 * `{ unknown }` lists the parts no area answers, as typed. Round 20 refused those («لازم اختار من
 * الاتجاهات اللى موجوده بتاعت البنوك»); Round 28 reverses it («عاوز الاتجاه اقدر اكتبه بايدى لو مش
 * موجود فى الليست»): the save then stores the text as typed (`normalizeOperationsDirection`), and
 * only a direction this function answers is respelled. Shared by the server's save and the board's
 * picker, so the two cannot disagree about what is an area.
 */
export const canonicalOperationsDirection = (
  direction: string,
  areaNames: readonly string[],
): { direction: string } | { unknown: string[] } => {
  const byFold = new Map<string, string>();
  for (const name of areaNames) {
    const folded = foldOperationsAreaName(name);
    if (folded !== '' && !byFold.has(folded)) byFold.set(folded, name);
  }
  const whole = byFold.get(foldOperationsAreaName(direction));
  if (whole !== undefined) return { direction: whole };
  const parts = directionPartSpans(direction);
  const count = parts.length;
  if (count === 0) return { unknown: [direction] };
  // Each part folds to a word at least, so no run of more parts than the widest name has words is
  // an area: the runs tried stay a few per part, however long the text.
  let widest = 0;
  for (const folded of byFold.keys()) widest = Math.max(widest, folded.split(' ').length);
  const areaOf = (from: number, to: number): string | undefined =>
    byFold.get(
      foldOperationsAreaName(
        direction.slice((parts[from] as PartSpan).start, (parts[to - 1] as PartSpan).end),
      ),
    );
  // From the last part back: how the parts from `from` on read as areas, the longest run first.
  const read: ({ to: number; name: string } | null)[] = new Array(count + 1).fill(null);
  const reads: boolean[] = new Array(count + 1).fill(false);
  reads[count] = true;
  for (let from = count - 1; from >= 0; from -= 1) {
    for (let to = Math.min(count, from + widest); to > from; to -= 1) {
      if (!reads[to]) continue;
      const name = areaOf(from, to);
      if (name === undefined) continue;
      read[from] = { to, name };
      reads[from] = true;
      break;
    }
  }
  if (reads[0]) {
    const names: string[] = [];
    for (let at = read[0] ?? null; at !== null; at = read[at.to] ?? null) names.push(at.name);
    return { direction: [...new Set(names)].join(' - ') };
  }
  // The parts no run answers, as typed.
  const answered = new Set<number>();
  for (let from = 0; from < count; from += 1) {
    for (let to = from + 1; to <= Math.min(count, from + widest); to += 1) {
      if (areaOf(from, to) === undefined) continue;
      for (let at = from; at < to; at += 1) answered.add(at);
    }
  }
  const text = (span: PartSpan): string => direction.slice(span.start, span.end);
  const unknown = parts.filter((_, at) => !answered.has(at)).map(text);
  if (unknown.length > 0) return { unknown };
  // Every part is in some area's run, but no runs read the whole text: those not areas alone.
  const alone = parts.filter((_, at) => areaOf(at, at + 1) === undefined).map(text);
  return { unknown: alone.length > 0 ? alone : [direction] };
};

interface PartSpan {
  start: number;
  end: number;
}

const DIRECTION_SEPARATORS = new RegExp(DIRECTION_SEPARATOR.source, 'gu');

/**
 * The parts of a direction between its separators (rule 1), where each sits in the text — trimmed,
 * and a part that folds to nothing («- -») left out.
 */
const directionPartSpans = (direction: string): PartSpan[] => {
  const spans: PartSpan[] = [];
  const cut = (start: number, end: number): void => {
    const raw = direction.slice(start, end);
    const from = start + (raw.length - raw.trimStart().length);
    const trimmed = raw.trim();
    if (foldOperationsAreaName(trimmed) !== '') spans.push({ start: from, end: from + trimmed.length });
  };
  let from = 0;
  for (const match of direction.matchAll(DIRECTION_SEPARATORS)) {
    cut(from, match.index);
    from = match.index + match[0].length;
  }
  cut(from, direction.length);
  return spans;
};

/** Does this van's direction name this shipment's area (rules 3-4)? */
export const operationsDirectionMatchesArea = (
  direction: string | null | undefined,
  areaName: string | null | undefined,
): boolean => {
  if (areaName == null || direction == null) return false;
  const area = foldOperationsAreaName(areaName);
  if (area === '') return false;
  // The WHOLE direction first, as `canonicalOperationsDirection` reads it: split at «/», the van
  // picked as «شبرا/الخيمة» was never proposed for its own area's محصنات.
  return (
    foldOperationsAreaName(direction) === area || operationsDirectionAreas(direction).includes(area)
  );
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
 * «شاشة استلام الخزينه», what the treasury receives. Round 13 — «واستلام الخزينه ممكن تستلم يكون
 * القائد معلمش التسليم، او ان العمليات معملتش التسليم والخزنه تستلم عادي» — so by default the queue is
 * what the vault can receive NOW:
 *
 *   · by default (`all` absent or false):
 *       – every secured DRAFT whose `collectionDate` is TODAY OR EARLIER on the Cairo calendar
 *         (`date` below) — WHITE (`awaitingPickup`, nobody recorded collecting it) or YELLOW;
 *       – every YELLOW draft (`withCaptain` — the captain's ✓ in the app; `withOperations` — the
 *         desk's ✓) WHATEVER its collection date: somebody says it is in hand, so it is on its way
 *         now (a ✓ pressed ahead of the booked day is rare, and is never hidden behind «الكل»);
 *       – those RECEIVED into the vault TODAY on the Cairo calendar (GREEN — by the custody's
 *         `receivedAt`; listed whatever their stage now, so one received and dispatched the same
 *         day still shows as today's receipt; a receipt CANCELLED since is not today's receipt any
 *         more, and the shipment is back among the drafts — yellow, or white when it had been
 *         received with nobody's ✓);
 *   · with `all=true`: the same, plus the WHITE drafts booked for a LATER collection day (booked
 *     ahead). Every row of it is receivable too.
 *
 * Every DRAFT row is receivable (`OPERATIONS_SECURED_RECEIVABLE_STAGES` — white or yellow): the
 * vault's ✓ is `POST /operations/secured/:id/receive` (`operationsVault.receive` — since Round 18
 * the legacy «إستلام محصنة» form, every field optional, no names), and from it the shipment is locked
 * (`isOperationsShipmentLocked`). A row past `draft` is a receipt of today, never receivable again.
 *
 * READING A ROW IN TWO COLUMNS (Round 13 — «مكان الحاله عمودين»):
 *   · «حالة الاستلام» (who collected it from the bank) — `pickedUpBy` / `pickedUpAt`: 'captain' →
 *     «تم الاستلام من القائد», 'operations' → «تم الاستلام من العمليات», with the time; null →
 *     «لم يتم الاستلام» — on a draft (nobody yet) AND on a receipt nobody handed over (for good: the
 *     vault never writes the pickup record);
 *   · «حالة الخزينة» (the vault's side) — `status` with `vaultReceivedAt`: `draft` → not received
 *     yet; `inVault` → «بالخزينة» at `vaultReceivedAt`; `dispatched` / `completed` — a receipt of
 *     today that has left the vault since («خرجت للتسليم» / «تم التسليم»), `vaultReceivedAt` still
 *     set.
 *   · `collectionDate` (every board row has it) is what put a white draft on the default list.
 *
 * Newest created first. Counted before it is read: more than `OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS`
 * candidates (the drafts the list would read — by default the ones above, with `all` every open
 * draft — plus today's receipts) is refused with 422 `OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE`
 * (details `count`, `max`), never cut short.
 */
export const OperationsVaultQueueQuerySchema = z
  .object({ all: booleanQuery().optional() })
  .strict();
export type OperationsVaultQueueQuery = z.infer<typeof OperationsVaultQueueQuerySchema>;

/**
 * A vault-queue row: a board row (its `pickedUpBy` / `pickedUpAt` are the pickup column, its
 * `collectionDate` the day it is collected), plus when the vault received it.
 */
export interface OperationsVaultQueueShipmentDto extends OperationsDayBoardShipmentDto {
  /**
   * When the treasury took it into the vault (the custody's `receivedAt`, ISO instant) — set on
   * EVERY row past `draft` (the queue lists no other received row than today's receipts), null on
   * the drafts still to be received.
   */
  vaultReceivedAt: string | null;
}

export interface OperationsVaultQueueDto {
  /**
   * The Cairo day "received today" and "collected by today" were read for, as its UTC midnight
   * ISO string.
   */
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
  /** Null (Round 24) on a stop of a crew row without a van. */
  vehicleId: string | null;
  crewAssignmentId: string;
}

export interface OperationsCaptainRouteDto {
  date: string;
  operationsDayId: string | null;
  captainEmployeeId: string;
  /** The crew behind the wheel, resolved through (day, vehicle) — never copied onto a shipment. */
  crew: {
    crewAssignmentId: string;
    /** Null (Round 24) for a crew row without a van. */
    vehicleId: string | null;
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
 *
 * `completed` means SETTLED — nothing is left for the captain on this stop — which the server
 * answers from three facts (the same predicate the sequential lock uses, so the read and the lock
 * never disagree): his execution is finished (`completed` / `cancelled`); or the back office has
 * completed the shipment; or (Round 13) it is the PICKUP leg of a SECURED shipment the vault has
 * already received (status past `draft`) and he never started it — «والخزنه تستلم عادي»: the vault
 * may take a محصنة in with nobody's ✓, and then there is nothing left to fetch from the bank. Such a
 * stop keeps `executionStatus: 'pending'` (his leg is never rewritten), its `status` says where the
 * shipment is (`inVault` …), and the next stop becomes `current`. A pickup leg he HAD started is not
 * settled by the vault: he finishes it as usual. A cancelled receipt takes the shipment back to
 * `draft`, and an unstarted pickup leg is his to do again.
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
  /** Null (Round 24) on a stop of a crew row without a van — the captain's crew has no van yet. */
  vehicleId: string | null;
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
    /**
     * Null (Round 24) for a crew row WITHOUT A VAN. Since Round 24 such a row is a captaincy like a
     * van's: «توزيع المحصنات» may give it محصنات, and its captain is a captain that day.
     */
    vehicleId: string | null;
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
   * Round 12 — a secured shipment taken OFF its van on «توزيع المحصنات», or by an edit that moves its
   * delivery date off the van's day (or clears it): its delivery leg cleared.
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
  /** Round 20 — the crew row itself, so a row without a van can be told from another. */
  crewAssignmentId: objectId(),
  /** Null for a row without a van (Round 20). A removed row reports its slots empty. */
  vehicleId: objectId().nullable(),
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
  /** Null (Round 24) for a leg on a crew row without a van. */
  vehicleId: objectId().nullable(),
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
  /** Null (Round 24) for a leg on a crew row without a van. */
  vehicleId: objectId().nullable(),
  leg: OperationsShipmentLegSchema,
  sequence: z.number().int().min(1),
  from: OperationsExecutionStatusSchema,
  to: OperationsExecutionStatusSchema,
});
