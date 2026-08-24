// Gold & Precious-Metals Vault module contracts.
//
// This module is a PORT, not a new design. The shapes below are the gold system's own collections
// and endpoints (models/Bar.js, models/Vault.js, controllers/receiving|delivery|transfer…), carried
// over field for field so the business rules that read them keep working unchanged. Where a name
// looks odd for ECMS (`receiptNumber` formats, `deliveredByUs`, `weightBeforePacking`) it is the
// gold system's name and is kept on purpose: renaming it would be a redesign, and the port is
// explicitly not one.
//
// THREE THINGS — and only three — are integrated with the rest of ECMS rather than ported:
//
//  1. Transport of a receiving receipt: the crew leader and the vehicle. `teamLeader` and
//     `vehicleNumber` were free text typed into the receipt. They are now `teamLeaderEmployeeId`
//     (an ECMS employee) and `vehicleId` (an ECMS Fleet vehicle), each carrying a display SNAPSHOT
//     (`teamLeaderName`, `vehicleNumber`) so a printed receipt still reads the same after the
//     employee is renamed or the vehicle is sold.
//  2. Vault custodians (أمناء الخزن): `supervisor1` / `supervisor2` were names picked from a gold-
//     owned `supervisors` collection. That collection is gone; both are now ECMS employees
//     (`supervisor1EmployeeId` + `supervisor1Name`, and the same for the second).
//  3. Branches: the gold-owned `branches` collection is gone. `branchId` points at an ECMS
//     organization branch, and the module's data scoping is the platform's branch scope.
//
// Everything else — numbering, the draft → confirmed → reverted lifecycle, drawer counters, the
// closing-balance arithmetic — is the gold logic verbatim.
import { z } from 'zod';
import { PaginationQuerySchema, listQuery, objectId } from '../common/index.js';

// ── Shared vocabularies (gold config/permissions.js + the models' enums) ────

export const GOLD_METAL_TYPES = ['gold', 'silver', 'platinum', 'palladium', 'other'] as const;
export const GoldMetalTypeSchema = z.enum(GOLD_METAL_TYPES);
export type GoldMetalType = z.infer<typeof GoldMetalTypeSchema>;

export const GOLD_BAR_STATUSES = [
  'in_vault',
  'delivered',
  'transferred',
  'modified',
  'archived',
] as const;
export const GoldBarStatusSchema = z.enum(GOLD_BAR_STATUSES);
export type GoldBarStatus = z.infer<typeof GoldBarStatusSchema>;

/** The one lifecycle every gold document shares (receiving, delivery, transfer). */
export const GOLD_DOCUMENT_STATUSES = ['draft', 'confirmed', 'reverted'] as const;
export const GoldDocumentStatusSchema = z.enum(GOLD_DOCUMENT_STATUSES);
export type GoldDocumentStatus = z.infer<typeof GoldDocumentStatusSchema>;

export const GOLD_COMPANY_TYPES = ['company', 'fund', 'institution'] as const;
export const GoldCompanyTypeSchema = z.enum(GOLD_COMPANY_TYPES);
export type GoldCompanyType = z.infer<typeof GoldCompanyTypeSchema>;

export const GOLD_ACTIVE_STATUSES = ['active', 'inactive'] as const;
export const GoldActiveStatusSchema = z.enum(GOLD_ACTIVE_STATUSES);
export type GoldActiveStatus = z.infer<typeof GoldActiveStatusSchema>;

export const GOLD_VAULT_STATUSES = ['active', 'inactive', 'maintenance'] as const;
export const GoldVaultStatusSchema = z.enum(GOLD_VAULT_STATUSES);
export type GoldVaultStatus = z.infer<typeof GoldVaultStatusSchema>;

export const GOLD_DRAWER_STATUSES = ['empty', 'occupied'] as const;
export const GoldDrawerStatusSchema = z.enum(GOLD_DRAWER_STATUSES);
export type GoldDrawerStatus = z.infer<typeof GoldDrawerStatusSchema>;

export const GOLD_KEY_STATUSES = ['active', 'returned'] as const;
export const GoldKeyStatusSchema = z.enum(GOLD_KEY_STATUSES);
export type GoldKeyStatus = z.infer<typeof GoldKeyStatusSchema>;

// Drawer-numbering axes — utils/drawerNumbering.js, unchanged.
export const GOLD_ORIENTATIONS = ['horizontal', 'vertical'] as const;
export const GOLD_H_DIRECTIONS = ['ltr', 'rtl'] as const;
export const GOLD_V_DIRECTIONS = ['ttb', 'btt'] as const;
export const GoldOrientationSchema = z.enum(GOLD_ORIENTATIONS);
export const GoldHDirectionSchema = z.enum(GOLD_H_DIRECTIONS);
export const GoldVDirectionSchema = z.enum(GOLD_V_DIRECTIONS);
export type GoldOrientation = z.infer<typeof GoldOrientationSchema>;
export type GoldHDirection = z.infer<typeof GoldHDirectionSchema>;
export type GoldVDirection = z.infer<typeof GoldVDirectionSchema>;

/** Every gold document is stamped with the ECMS branch it belongs to (integration 3). */
interface GoldBranchScoped {
  branchId: string | null;
  branchName: string | null;
}

const optionalText = (max: number) => z.string().trim().max(max).optional();

// ── Companies / funds (gold models/Company.js) ─────────────────────────────

export interface GoldCompanyDto {
  id: string;
  name: string;
  /**
   * The company logo, as a platform Files id. The gold system stored a Cloudinary URL; storing the
   * URL of a service ECMS does not use would have carried a second file stack into the platform,
   * which is exactly what the port is not allowed to do.
   */
  logoFileId: string | null;
  type: GoldCompanyType;
  phone: string | null;
  email: string | null;
  status: GoldActiveStatus;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const companyCore = {
  name: z.string().trim().min(1).max(200),
  type: GoldCompanyTypeSchema.default('company'),
  phone: optionalText(30),
  email: z.string().trim().email().max(200).optional(),
  status: GoldActiveStatusSchema.default('active'),
  notes: optionalText(2000),
  logoFileId: objectId().optional(),
};

export const CreateGoldCompanySchema = z.object(companyCore).strict();
export type CreateGoldCompany = z.infer<typeof CreateGoldCompanySchema>;

export const UpdateGoldCompanySchema = z
  .object({
    name: companyCore.name.optional(),
    type: GoldCompanyTypeSchema.optional(),
    phone: companyCore.phone.nullable(),
    email: companyCore.email.nullable(),
    status: GoldActiveStatusSchema.optional(),
    notes: companyCore.notes.nullable(),
    logoFileId: objectId().nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateGoldCompany = z.infer<typeof UpdateGoldCompanySchema>;

export const ListGoldCompaniesQuerySchema = PaginationQuerySchema.extend({
  search: optionalText(200),
  type: listQuery(GoldCompanyTypeSchema),
  status: listQuery(GoldActiveStatusSchema),
}).strict();
export type ListGoldCompaniesQuery = z.infer<typeof ListGoldCompaniesQuerySchema>;

// ── Representatives (gold models/Representative.js) ────────────────────────

export interface GoldRepresentativeDto {
  id: string;
  companyId: string;
  companyName: string | null;
  fullName: string;
  nationalId: string | null;
  phone: string | null;
  jobTitle: string | null;
  joinDate: string | null;
  status: GoldActiveStatus;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const representativeCore = {
  companyId: objectId(),
  fullName: z.string().trim().min(1).max(200),
  nationalId: optionalText(30),
  phone: optionalText(30),
  jobTitle: optionalText(120),
  joinDate: z.coerce.date().optional(),
  status: GoldActiveStatusSchema.default('active'),
  notes: optionalText(2000),
};

export const CreateGoldRepresentativeSchema = z.object(representativeCore).strict();
export type CreateGoldRepresentative = z.infer<typeof CreateGoldRepresentativeSchema>;

export const UpdateGoldRepresentativeSchema = z
  .object({
    companyId: objectId().optional(),
    fullName: representativeCore.fullName.optional(),
    nationalId: representativeCore.nationalId.nullable(),
    phone: representativeCore.phone.nullable(),
    jobTitle: representativeCore.jobTitle.nullable(),
    joinDate: z.coerce.date().nullable().optional(),
    status: GoldActiveStatusSchema.optional(),
    notes: representativeCore.notes.nullable(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateGoldRepresentative = z.infer<typeof UpdateGoldRepresentativeSchema>;

export const ListGoldRepresentativesQuerySchema = PaginationQuerySchema.extend({
  search: optionalText(200),
  companyId: objectId().optional(),
  status: GoldActiveStatusSchema.optional(),
}).strict();
export type ListGoldRepresentativesQuery = z.infer<typeof ListGoldRepresentativesQuerySchema>;

// ── Floors (gold models/Floor.js) ──────────────────────────────────────────

export interface GoldFloorDto extends GoldBranchScoped {
  id: string;
  name: string;
  order: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateGoldFloorSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    order: z.number().int().min(0).optional(),
  })
  .strict();
export type CreateGoldFloor = z.infer<typeof CreateGoldFloorSchema>;

export const UpdateGoldFloorSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    order: z.number().int().min(0).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateGoldFloor = z.infer<typeof UpdateGoldFloorSchema>;

/** The ▲▼ reorder both floors and vaults use — a list of (id, order) pairs, as gold sent it. */
export const ReorderGoldItemsSchema = z
  .object({
    items: z
      .array(z.object({ id: objectId(), order: z.number().int().min(0) }).strict())
      .min(1)
      .max(200),
  })
  .strict();
export type ReorderGoldItems = z.infer<typeof ReorderGoldItemsSchema>;

// ── Vaults and drawers (gold models/Vault.js + models/Drawer.js) ───────────

export interface GoldVaultLayoutDto {
  rows: number;
  cols: number;
  orientation: GoldOrientation;
  horizontalDirection: GoldHDirection;
  verticalDirection: GoldVDirection;
  startNumber: number;
  /** Grams; 0 = no limit. Indicative and deliberately exceedable (gold README). */
  drawerWeightLimit: number;
}

export interface GoldVaultDto extends GoldBranchScoped {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: GoldVaultStatus;
  layout: GoldVaultLayoutDto | null;
  drawersGenerated: boolean;
  floorId: string | null;
  floorName: string | null;
  order: number;
  drawerCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** The owners of the bars sitting in one drawer — the coloured strip on the visual board. */
export interface GoldDrawerCompanyDto {
  id: string;
  name: string;
  count: number;
}

export interface GoldDrawerDto {
  id: string;
  vaultId: string;
  branchId: string | null;
  row: number;
  col: number;
  number: number;
  label: string;
  status: GoldDrawerStatus;
  barsCount: number;
  totalWeight: number;
  weightLimit: number;
  companies: GoldDrawerCompanyDto[];
}

export const CreateGoldVaultSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** Optional: the vault name doubles as its code, uniquified server-side (gold behaviour). */
    code: optionalText(120),
    description: optionalText(2000),
    status: GoldVaultStatusSchema.optional(),
    floorId: objectId().nullable().optional(),
    order: z.number().int().min(0).optional(),
  })
  .strict();
export type CreateGoldVault = z.infer<typeof CreateGoldVaultSchema>;

// Metadata only — the layout is changed through generate/reshape, exactly as gold had it.
export const UpdateGoldVaultSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: optionalText(2000).nullable(),
    status: GoldVaultStatusSchema.optional(),
    floorId: objectId().nullable().optional(),
    order: z.number().int().min(0).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateGoldVault = z.infer<typeof UpdateGoldVaultSchema>;

export const ListGoldVaultsQuerySchema = PaginationQuerySchema.extend({
  search: optionalText(200),
  status: GoldVaultStatusSchema.optional(),
}).strict();
export type ListGoldVaultsQuery = z.infer<typeof ListGoldVaultsQuerySchema>;

const layoutCore = {
  rows: z.coerce.number().int().min(1).max(100),
  cols: z.coerce.number().int().min(1).max(100),
  orientation: GoldOrientationSchema.default('horizontal'),
  horizontalDirection: GoldHDirectionSchema.default('ltr'),
  verticalDirection: GoldVDirectionSchema.default('ttb'),
  startNumber: z.coerce.number().int().min(1).default(1),
  drawerWeightLimit: z.coerce.number().min(0).default(0),
};

/** Stateless preview — returns the would-be drawers without persisting anything. */
export const PreviewGoldLayoutSchema = z
  .object({ ...layoutCore, code: optionalText(120) })
  .strict();
export type PreviewGoldLayout = z.infer<typeof PreviewGoldLayoutSchema>;

export const GenerateGoldLayoutSchema = z.object(layoutCore).strict();
export type GenerateGoldLayout = z.infer<typeof GenerateGoldLayoutSchema>;

export interface GoldLayoutPreviewDrawerDto {
  row: number;
  col: number;
  number: number;
  label: string;
}

export interface GoldLayoutPreviewDto {
  count: number;
  from: number | null;
  to: number | null;
  drawers: GoldLayoutPreviewDrawerDto[];
}

export interface GoldDrawerDetailDto {
  drawer: GoldDrawerDto;
  bars: GoldBarDto[];
}

// ── Bars (gold models/Bar.js) ──────────────────────────────────────────────

export interface GoldBarHistoryEntryDto {
  action: string;
  fromVaultId: string | null;
  fromDrawerId: string | null;
  toVaultId: string | null;
  toDrawerId: string | null;
  reference: string | null;
  byUserId: string | null;
  at: string;
  notes: string | null;
}

export interface GoldBarDto extends GoldBranchScoped {
  id: string;
  serialNumber: string;
  companyId: string | null;
  companyName: string | null;
  parentCompanyId: string | null;
  metalType: GoldMetalType;
  brand: string | null;
  purity: string | null;
  weight: number;
  sealed: boolean;
  weightBeforeSeal: number | null;
  weightAfterSeal: number | null;
  currentVaultId: string | null;
  currentVaultCode: string | null;
  currentDrawerId: string | null;
  currentDrawerNumber: number | null;
  status: GoldBarStatus;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface GoldBarHistoryDto {
  serialNumber: string;
  history: GoldBarHistoryEntryDto[];
}

export const CreateGoldBarSchema = z
  .object({
    serialNumber: z.string().trim().min(1).max(120),
    companyId: objectId(),
    parentCompanyId: objectId().optional(),
    metalType: GoldMetalTypeSchema.default('gold'),
    brand: optionalText(120),
    purity: optionalText(30),
    weight: z.coerce.number().min(0),
    sealed: z.boolean().optional(),
    weightBeforeSeal: z.coerce.number().min(0).optional(),
    weightAfterSeal: z.coerce.number().min(0).optional(),
    currentVaultId: objectId().optional(),
    currentDrawerId: objectId().optional(),
    notes: optionalText(2000),
  })
  .strict();
export type CreateGoldBar = z.infer<typeof CreateGoldBarSchema>;

export const UpdateGoldBarSchema = z
  .object({
    serialNumber: z.string().trim().min(1).max(120).optional(),
    companyId: objectId().optional(),
    parentCompanyId: objectId().nullable().optional(),
    metalType: GoldMetalTypeSchema.optional(),
    purity: optionalText(30).nullable(),
    brand: optionalText(120).nullable(),
    weight: z.coerce.number().min(0).optional(),
    sealed: z.boolean().optional(),
    weightBeforeSeal: z.coerce.number().min(0).nullable().optional(),
    weightAfterSeal: z.coerce.number().min(0).nullable().optional(),
    currentVaultId: objectId().nullable().optional(),
    currentDrawerId: objectId().nullable().optional(),
    status: GoldBarStatusSchema.optional(),
    notes: optionalText(2000).nullable(),
    /** Free-text reason recorded on the bar's history entry (gold `changeNote`). */
    changeNote: optionalText(500),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateGoldBar = z.infer<typeof UpdateGoldBarSchema>;

export const ListGoldBarsQuerySchema = PaginationQuerySchema.extend({
  search: optionalText(200),
  serialNumber: optionalText(200),
  companyId: listQuery(objectId()),
  metalType: listQuery(GoldMetalTypeSchema),
  purity: listQuery(z.string().trim().min(1).max(30)),
  status: listQuery(GoldBarStatusSchema),
  vaultId: objectId().optional(),
  drawerId: objectId().optional(),
  minWeight: z.coerce.number().min(0).optional(),
  maxWeight: z.coerce.number().min(0).optional(),
}).strict();
export type ListGoldBarsQuery = z.infer<typeof ListGoldBarsQuerySchema>;

/** The distinct purities in scope — what the Bars screen's purity filter offers. */
export interface GoldBarFacetsDto {
  purities: string[];
}

// ── Receiving receipts — عمليات الدخول (gold models/ReceivingReceipt.js) ────
//
// The line is the receipt's own record of a bar BEFORE the bar exists: bars become documents only
// on confirm, so a draft receipt fully retains its data and can be edited, printed and re-opened
// until it is approved. That is the gold rule and it is unchanged.

export interface GoldReceivingLineDto {
  serialNumber: string;
  metalType: GoldMetalType;
  purity: string | null;
  weight: number;
  brand: string | null;
  weightBeforePacking: number | null;
  weightAfterPacking: number | null;
  vaultId: string | null;
  vaultCode: string | null;
  drawerId: string | null;
  drawerNumber: number | null;
}

export interface GoldReceivingReceiptDto extends GoldBranchScoped {
  id: string;
  receiptNumber: string;
  status: GoldDocumentStatus;
  printCount: number;
  lastPrintedAt: string | null;
  receiptDate: string;
  releaseType: string | null;
  releaseOrderNumber: string | null;
  releaseLetterNumber: string | null;
  releaseLetterDate: string | null;
  /** True = EGYCASH moved the shipment; the transport block below then applies. */
  deliveredByUs: boolean;
  // ── Integration 1: the crew leader and the vehicle come from ECMS ──
  teamLeaderEmployeeId: string | null;
  teamLeaderName: string | null;
  vehicleId: string | null;
  /** Snapshot of the Fleet vehicle's plate — the number the printed receipt has always shown. */
  vehicleNumber: string | null;
  companyId: string | null;
  companyName: string | null;
  companyDelegateId: string | null;
  companyDelegateName: string | null;
  companyDelegateNationalId: string | null;
  storageDelegateId: string | null;
  storageDelegateName: string | null;
  storageDelegateNationalId: string | null;
  // ── Integration 2: both vault custodians are ECMS employees ──
  supervisor1EmployeeId: string | null;
  supervisor1Name: string | null;
  supervisor2EmployeeId: string | null;
  supervisor2Name: string | null;
  representativeId: string | null;
  representativeName: string | null;
  nationalId: string | null;
  keyHolder: string | null;
  keyHolderNationalId: string | null;
  totalWeight: number;
  barsCount: number;
  notes: string | null;
  storageLocation: string | null;
  lines: GoldReceivingLineDto[];
  barIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const GoldReceivingLineSchema = z
  .object({
    serialNumber: optionalText(120),
    metalType: GoldMetalTypeSchema.default('gold'),
    purity: optionalText(30),
    weight: z.coerce.number().min(0).default(0),
    brand: optionalText(120),
    weightBeforePacking: z.coerce.number().min(0).nullable().optional(),
    weightAfterPacking: z.coerce.number().min(0).nullable().optional(),
    vaultId: objectId().nullable().optional(),
    drawerId: objectId().nullable().optional(),
  })
  .strict();
export type GoldReceivingLine = z.infer<typeof GoldReceivingLineSchema>;

/**
 * The receipt header. Every field is optional because a gold draft is saved from whatever the
 * operator has so far — completeness is checked at CONFIRM, not at save, and that ordering is the
 * whole point of the draft → confirm flow.
 */
const receivingHeader = {
  receiptDate: z.coerce.date().optional(),
  releaseType: optionalText(120),
  releaseOrderNumber: optionalText(120),
  releaseLetterNumber: optionalText(120),
  releaseLetterDate: z.coerce.date().nullable().optional(),
  deliveredByUs: z.boolean().optional(),
  teamLeaderEmployeeId: objectId().nullable().optional(),
  vehicleId: objectId().nullable().optional(),
  companyId: objectId().nullable().optional(),
  companyDelegateId: objectId().nullable().optional(),
  companyDelegateNationalId: optionalText(30).nullable(),
  storageDelegateId: objectId().nullable().optional(),
  storageDelegateNationalId: optionalText(30).nullable(),
  supervisor1EmployeeId: objectId().nullable().optional(),
  supervisor2EmployeeId: objectId().nullable().optional(),
  representativeId: objectId().nullable().optional(),
  nationalId: optionalText(30).nullable(),
  keyHolder: optionalText(200).nullable(),
  keyHolderNationalId: optionalText(30).nullable(),
  notes: optionalText(2000).nullable(),
  storageLocation: optionalText(200).nullable(),
};

export const CreateGoldReceivingSchema = z
  .object({
    ...receivingHeader,
    /** Typed by hand when the owner delivered; server-allocated (R<yyyymmdd><nn>) when we did. */
    receiptNumber: optionalText(60),
    lines: z.array(GoldReceivingLineSchema).max(2000).default([]),
  })
  .strict();
export type CreateGoldReceiving = z.infer<typeof CreateGoldReceivingSchema>;

export const UpdateGoldReceivingSchema = z
  .object({
    ...receivingHeader,
    receiptNumber: optionalText(60),
    lines: z.array(GoldReceivingLineSchema).max(2000).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateGoldReceiving = z.infer<typeof UpdateGoldReceivingSchema>;

export const ListGoldReceivingQuerySchema = PaginationQuerySchema.extend({
  search: optionalText(200),
  companyId: listQuery(objectId()),
  status: listQuery(GoldDocumentStatusSchema),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict();
export type ListGoldReceivingQuery = z.infer<typeof ListGoldReceivingQuerySchema>;

/** Confirm / revert / print carry the version so two operators cannot approve the same draft. */
export const GoldDocumentActionSchema = z.object({ version: z.number().int().min(0) }).strict();
export type GoldDocumentAction = z.infer<typeof GoldDocumentActionSchema>;

export interface GoldNextNumberDto {
  number: string;
}

export interface GoldPrintResultDto {
  printCount: number;
  lastPrintedAt: string | null;
}

// ── Delivery receipts — عمليات الخروج (gold models/DeliveryReceipt.js) ──────

export interface GoldDeliveryReceiptDto extends GoldBranchScoped {
  id: string;
  receiptNumber: string;
  status: GoldDocumentStatus;
  printCount: number;
  lastPrintedAt: string | null;
  receiptDate: string;
  companyId: string | null;
  companyName: string | null;
  metalType: GoldMetalType | null;
  supervisor1EmployeeId: string | null;
  supervisor1Name: string | null;
  supervisor2EmployeeId: string | null;
  supervisor2Name: string | null;
  representativeId: string | null;
  representativeName: string | null;
  nationalId: string | null;
  keyHolder: string | null;
  totalWeight: number;
  barsCount: number;
  barIds: string[];
  /** Populated on the single-receipt read, so the printable order lists its bars. */
  bars: GoldBarLineDto[];
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** The compact bar shape delivery/transfer documents embed in their reads. */
export interface GoldBarLineDto {
  id: string;
  serialNumber: string;
  weight: number;
  metalType: GoldMetalType;
  brand: string | null;
  purity: string | null;
}

const deliveryHeader = {
  receiptDate: z.coerce.date().optional(),
  companyId: objectId().nullable().optional(),
  metalType: GoldMetalTypeSchema.nullable().optional(),
  representativeId: objectId().nullable().optional(),
  nationalId: optionalText(30).nullable(),
  supervisor1EmployeeId: objectId().nullable().optional(),
  supervisor2EmployeeId: objectId().nullable().optional(),
  keyHolder: optionalText(200).nullable(),
  notes: optionalText(2000).nullable(),
};

export const CreateGoldDeliverySchema = z
  .object({ ...deliveryHeader, barIds: z.array(objectId()).max(2000).default([]) })
  .strict();
export type CreateGoldDelivery = z.infer<typeof CreateGoldDeliverySchema>;

export const UpdateGoldDeliverySchema = z
  .object({
    ...deliveryHeader,
    barIds: z.array(objectId()).max(2000).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateGoldDelivery = z.infer<typeof UpdateGoldDeliverySchema>;

export const ListGoldDeliveryQuerySchema = PaginationQuerySchema.extend({
  search: optionalText(200),
  companyId: listQuery(objectId()),
  status: listQuery(GoldDocumentStatusSchema),
  metalType: listQuery(GoldMetalTypeSchema),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict();
export type ListGoldDeliveryQuery = z.infer<typeof ListGoldDeliveryQuerySchema>;

// ── Ownership transfers — عمليات التحويل (gold models/Transfer.js) ──────────

export interface GoldTransferDto extends GoldBranchScoped {
  id: string;
  transferNumber: string;
  status: GoldDocumentStatus;
  printCount: number;
  lastPrintedAt: string | null;
  transferDate: string;
  metalType: GoldMetalType | null;
  supervisor1EmployeeId: string | null;
  supervisor1Name: string | null;
  supervisor2EmployeeId: string | null;
  supervisor2Name: string | null;
  currentOwnerId: string | null;
  currentOwnerName: string | null;
  currentOwnerDelegateId: string | null;
  currentOwnerDelegateName: string | null;
  currentOwnerNationalId: string | null;
  newOwnerId: string | null;
  newOwnerName: string | null;
  newOwnerDelegateId: string | null;
  newOwnerDelegateName: string | null;
  newOwnerNationalId: string | null;
  barsCount: number;
  totalWeight: number;
  barIds: string[];
  bars: GoldBarLineDto[];
  approvedBy: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const transferHeader = {
  transferDate: z.coerce.date().optional(),
  metalType: GoldMetalTypeSchema.nullable().optional(),
  supervisor1EmployeeId: objectId().nullable().optional(),
  supervisor2EmployeeId: objectId().nullable().optional(),
  currentOwnerId: objectId().nullable().optional(),
  currentOwnerDelegateId: objectId().nullable().optional(),
  currentOwnerNationalId: optionalText(30).nullable(),
  newOwnerId: objectId().nullable().optional(),
  newOwnerDelegateId: objectId().nullable().optional(),
  newOwnerNationalId: optionalText(30).nullable(),
  approvedBy: optionalText(200).nullable(),
  notes: optionalText(2000).nullable(),
};

export const CreateGoldTransferSchema = z
  .object({ ...transferHeader, barIds: z.array(objectId()).max(2000).default([]) })
  .strict();
export type CreateGoldTransfer = z.infer<typeof CreateGoldTransferSchema>;

export const UpdateGoldTransferSchema = z
  .object({
    ...transferHeader,
    barIds: z.array(objectId()).max(2000).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateGoldTransfer = z.infer<typeof UpdateGoldTransferSchema>;

export const ListGoldTransfersQuerySchema = PaginationQuerySchema.extend({
  search: optionalText(200),
  status: listQuery(GoldDocumentStatusSchema),
  metalType: listQuery(GoldMetalTypeSchema),
}).strict();
export type ListGoldTransfersQuery = z.infer<typeof ListGoldTransfersQuerySchema>;

// ── Drawer keys — المفاتيح (gold models/KeyHandover.js) ─────────────────────

export interface GoldKeyHandoverDto extends GoldBranchScoped {
  id: string;
  companyId: string;
  companyName: string | null;
  representativeId: string;
  representativeName: string | null;
  representativePhone: string | null;
  representativeNationalId: string | null;
  vaultId: string;
  vaultName: string | null;
  drawerId: string;
  drawerNumber: number | null;
  drawerLabel: string | null;
  handedOverByUserId: string | null;
  handedOverByName: string | null;
  handoverDate: string;
  status: GoldKeyStatus;
  returnedAt: string | null;
  returnedByUserId: string | null;
  returnedByName: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateGoldKeyHandoverSchema = z
  .object({
    companyId: objectId(),
    representativeId: objectId(),
    vaultId: objectId(),
    drawerId: objectId(),
    notes: optionalText(2000),
  })
  .strict();
export type CreateGoldKeyHandover = z.infer<typeof CreateGoldKeyHandoverSchema>;

export const ListGoldKeysQuerySchema = PaginationQuerySchema.extend({
  vaultId: objectId().optional(),
  status: GoldKeyStatusSchema.optional(),
}).strict();
export type ListGoldKeysQuery = z.infer<typeof ListGoldKeysQuerySchema>;

/** Who holds which drawer key right now — the overlay the vault board and the Keys page share. */
export interface GoldKeyHolderDto {
  holder: string;
  company: string;
  date: string;
}

export interface GoldKeysOverviewDto {
  totalDrawers: number;
  handedOver: number;
  notHandedOver: number;
  byDrawer: Record<string, GoldKeyHolderDto>;
}

// ── Dashboard (gold controllers/dashboard.controller.js) ───────────────────

export interface GoldMetalTotalDto {
  weight: number;
  count: number;
}

export interface GoldDashboardStatsDto {
  totalVaults: number;
  totalDrawers: number;
  totalBars: number;
  totalCompanies: number;
  totalWeight: number;
  goldWeight: number;
  silverWeight: number;
  byMetal: Record<string, GoldMetalTotalDto>;
}

export interface GoldCompanyMetalRowDto {
  companyId: string;
  name: string;
  gold: number;
  silver: number;
  weight: number;
  count: number;
}

export interface GoldPurityWeightDto {
  purity: string | null;
  weight: number;
}

export interface GoldMonthlyCountDto {
  year: number;
  month: number;
  count: number;
}

export interface GoldMonthlyMetalFlowDto {
  year: number;
  month: number;
  metal: string;
  weight: number;
}

export interface GoldDashboardChartsDto {
  barsByCompany: GoldCompanyMetalRowDto[];
  weightByPurity: GoldPurityWeightDto[];
  receivingTrend: GoldMonthlyCountDto[];
  deliveryTrend: GoldMonthlyCountDto[];
  transferTrend: GoldMonthlyCountDto[];
  inFlow: GoldMonthlyMetalFlowDto[];
  outFlow: GoldMonthlyMetalFlowDto[];
  ownerTypeWeight: Record<string, number>;
}

// ── Reports (gold controllers/reports.controller.js) ───────────────────────

export const GoldClientBalancesQuerySchema = z
  .object({
    metalType: GoldMetalTypeSchema.default('gold'),
    ownerType: GoldCompanyTypeSchema.optional(),
    funds: listQuery(objectId(), 500),
  })
  .strict();
export type GoldClientBalancesQuery = z.infer<typeof GoldClientBalancesQuerySchema>;

export interface GoldClientBalanceRowDto {
  companyId: string;
  name: string;
  type: GoldCompanyType;
  count: number;
  weight: number;
}

export interface GoldClientBalancesDto {
  rows: GoldClientBalanceRowDto[];
  totals: { count: number; weight: number };
  metalType: string;
}

export const GoldFundMovementQuerySchema = z
  .object({
    metalType: GoldMetalTypeSchema.default('gold'),
    year: z.coerce.number().int().min(2000).max(2200).optional(),
    fromMonth: z.coerce.number().int().min(1).max(12).optional(),
    toMonth: z.coerce.number().int().min(1).max(12).optional(),
    funds: listQuery(objectId(), 500),
  })
  .strict();
export type GoldFundMovementQuery = z.infer<typeof GoldFundMovementQuerySchema>;

export interface GoldFundMovementRowDto {
  companyId: string;
  name: string;
  inCount: number;
  outCount: number;
  inWeight: number;
  outWeight: number;
  netWeight: number;
  balanceCount: number;
  balanceWeight: number;
}

export interface GoldFundMovementDto {
  rows: GoldFundMovementRowDto[];
  totals: Omit<GoldFundMovementRowDto, 'companyId' | 'name'>;
  metalType: string;
  year: number;
  fromMonth: number;
  toMonth: number;
}

export interface GoldFundClosingMonthDto {
  year: number;
  month: number;
  inCount: number;
  outCount: number;
  inWeight: number;
  outWeight: number;
  netWeight: number;
  balanceCount: number;
  balanceWeight: number;
}

export interface GoldFundClosingDto {
  metalType: string;
  funds: { companyId: string; name: string; rows: GoldFundClosingMonthDto[] }[];
}

export const GoldFundClosingQuerySchema = GoldFundMovementQuerySchema;
export type GoldFundClosingQuery = GoldFundMovementQuery;
