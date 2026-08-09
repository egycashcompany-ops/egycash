// IT module contracts (docs/12-planning/it-module-design.md, FROZEN v1.2) — slices IT-1 and IT-2:
// catalog items, vendors, the asset register with server-allocated codes, QR labels, and the
// custody lifecycle (assign / return / transfer / dispose) with its append-only history.
// Help desk, maintenance, software and dashboards arrive in IT-3…IT-6 by extending this file,
// never by adding a second one.
//
// Asset `status` is deliberately absent from every write schema: it is derived from operations
// (FR-2) and no endpoint sets it. In IT-1 the only operation is registration, so every asset is
// `inStock` — the full vocabulary is declared now so IT-2 extends behaviour, not shapes.
import { z } from 'zod';
import { LocalizedStringSchema } from '../common/localized.js';
import { PaginationQuerySchema, booleanQuery, objectId } from '../common/index.js';

// ── Simple catalogs (design §2.4 — one collection, kind-discriminated) ──────

export const IT_CATALOG_KINDS = ['assetCategory', 'ticketCategory'] as const;
export const ItCatalogKindSchema = z.enum(IT_CATALOG_KINDS);
export type ItCatalogKind = z.infer<typeof ItCatalogKindSchema>;

export interface ItCatalogItemDto {
  id: string;
  kind: ItCatalogKind;
  code: string | null;
  name: { ar: string; en: string };
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const CreateItCatalogItemSchema = z
  .object({
    kind: ItCatalogKindSchema,
    code: z.string().trim().min(1).max(30).optional(),
    name: LocalizedStringSchema,
    description: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().min(0).default(0),
  })
  .strict();
export type CreateItCatalogItem = z.infer<typeof CreateItCatalogItemSchema>;

export const UpdateItCatalogItemSchema = z
  .object({
    code: z.string().trim().min(1).max(30).nullable().optional(),
    name: LocalizedStringSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateItCatalogItem = z.infer<typeof UpdateItCatalogItemSchema>;

export const ListItCatalogQuerySchema = PaginationQuerySchema.extend({
  kind: ItCatalogKindSchema.optional(),
  isActive: booleanQuery().optional(),
}).strict();
export type ListItCatalogQuery = z.infer<typeof ListItCatalogQuerySchema>;

// ── Vendors (design §2.9 — IT-owned until Procurement exists, §13-Q6) ───────

export const ItVendorContactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().email().max(200).optional(),
  })
  .strict();
export type ItVendorContact = z.infer<typeof ItVendorContactSchema>;

export interface ItVendorContactDto {
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

export interface ItVendorDto {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  services: string | null;
  contacts: ItVendorContactDto[];
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Contacts are embedded — bounded by business reality (design §2.9), not a growth collection. */
const vendorCore = {
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(30).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(200).optional(),
  address: z.string().trim().max(500).optional(),
  services: z.string().trim().max(500).optional(),
  contacts: z.array(ItVendorContactSchema).max(20).default([]),
};

export const CreateItVendorSchema = z.object(vendorCore).strict();
export type CreateItVendor = z.infer<typeof CreateItVendorSchema>;

export const UpdateItVendorSchema = z
  .object({
    name: vendorCore.name.optional(),
    code: vendorCore.code.nullable().optional(),
    phone: vendorCore.phone.nullable().optional(),
    email: vendorCore.email.nullable().optional(),
    address: vendorCore.address.nullable().optional(),
    services: vendorCore.services.nullable().optional(),
    contacts: z.array(ItVendorContactSchema).max(20).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateItVendor = z.infer<typeof UpdateItVendorSchema>;

/** `search` from day one — vendors are a growth catalog and pickers search them (ADR-019 rule 5). */
export const ListItVendorsQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  isActive: booleanQuery().optional(),
}).strict();
export type ListItVendorsQuery = z.infer<typeof ListItVendorsQuerySchema>;

// ── Assets (design §2.2) ────────────────────────────────────────────────────

export const IT_ASSET_STATUSES = ['inStock', 'assigned', 'underMaintenance', 'disposed'] as const;
export const ItAssetStatusSchema = z.enum(IT_ASSET_STATUSES);
export type ItAssetStatus = z.infer<typeof ItAssetStatusSchema>;

export interface ItAssetPurchaseDto {
  date: string | null;
  cost: number | null;
  vendorId: string | null;
  invoiceRef: string | null;
}

export interface ItAssetWarrantyDto {
  vendorId: string | null;
  start: string;
  end: string;
  terms: string | null;
}

/** Disposal is set once and terminal (design §2.2, FR-4). */
export const IT_DISPOSAL_METHODS = [
  'sold',
  'scrapped',
  'donated',
  'lost',
  'returnedToVendor',
] as const;
export const ItDisposalMethodSchema = z.enum(IT_DISPOSAL_METHODS);
export type ItDisposalMethod = z.infer<typeof ItDisposalMethodSchema>;

export interface ItAssetDisposalDto {
  at: string;
  method: ItDisposalMethod;
  reason: string;
  notes: string | null;
}

export interface ItAssetDto {
  id: string;
  assetCode: string;
  name: string;
  description: string | null;
  categoryId: string;
  status: ItAssetStatus;
  serialNumber: string | null;
  model: string | null;
  manufacturer: string | null;
  externalTag: string | null;
  branchId: string;
  location: string | null;
  purchase: ItAssetPurchaseDto | null;
  warranty: ItAssetWarrantyDto | null;
  /**
   * Denormalized head of the OPEN custody interval, `null` when the asset is not out (design
   * §2.2). A read convenience only — `it_asset_assignments` is the truth, and "at most one open
   * per asset" is a partial unique index rather than a convention (ADR-021).
   *
   * Added in IT-2. Additive to the IT-1 DTO: no existing field changed shape or meaning.
   */
  currentAssignmentId: string | null;
  /** Set once, terminal (FR-4). `null` until the asset is disposed. */
  disposal: ItAssetDisposalDto | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const ItAssetPurchaseSchema = z
  .object({
    date: z.coerce.date().optional(),
    cost: z.number().nonnegative().optional(),
    vendorId: objectId().optional(),
    invoiceRef: z.string().trim().max(100).optional(),
  })
  .strict();
export type ItAssetPurchase = z.infer<typeof ItAssetPurchaseSchema>;

export const ItAssetWarrantySchema = z
  .object({
    vendorId: objectId().optional(),
    start: z.coerce.date(),
    end: z.coerce.date(),
    terms: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.end.getTime() < value.start.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: 'warranty end must not precede its start',
      });
    }
  });
export type ItAssetWarranty = z.infer<typeof ItAssetWarrantySchema>;

/** `assetCode` is server-allocated (design §2.1) — it is not accepted on any write. */
const assetCore = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  categoryId: objectId(),
  serialNumber: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().max(120).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  /** A pre-existing printed tag/barcode number — legacy labels keep working (design §2.2). */
  externalTag: z.string().trim().min(1).max(120).optional(),
  branchId: objectId(),
  location: z.string().trim().max(200).optional(),
  purchase: ItAssetPurchaseSchema.optional(),
  warranty: ItAssetWarrantySchema.optional(),
  notes: z.string().trim().max(2000).optional(),
};

export const CreateItAssetSchema = z.object(assetCore).strict();
export type CreateItAsset = z.infer<typeof CreateItAssetSchema>;

export const UpdateItAssetSchema = z
  .object({
    name: assetCore.name.optional(),
    description: assetCore.description.nullable().optional(),
    categoryId: objectId().optional(),
    serialNumber: assetCore.serialNumber.nullable().optional(),
    model: assetCore.model.nullable().optional(),
    manufacturer: assetCore.manufacturer.nullable().optional(),
    externalTag: assetCore.externalTag.nullable().optional(),
    location: assetCore.location.nullable().optional(),
    purchase: ItAssetPurchaseSchema.nullable().optional(),
    warranty: ItAssetWarrantySchema.nullable().optional(),
    notes: assetCore.notes.nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateItAsset = z.infer<typeof UpdateItAssetSchema>;

export const ListItAssetsQuerySchema = PaginationQuerySchema.extend({
  /** Matches assetCode, name, serialNumber and externalTag — the strings an operator has. */
  search: z.string().trim().max(200).optional(),
  categoryId: objectId().optional(),
  status: ItAssetStatusSchema.optional(),
  branchId: objectId().optional(),
}).strict();
export type ListItAssetsQuery = z.infer<typeof ListItAssetsQuerySchema>;

/**
 * Label sheet request (design §4.2). Bounded: a print batch, not a bulk read — the sheet grows in
 * pages, the request does not grow past the bound.
 */
export const ItAssetLabelsSchema = z
  .object({ assetIds: z.array(objectId()).min(1).max(100) })
  .strict();
export type ItAssetLabels = z.infer<typeof ItAssetLabelsSchema>;

// ── Custody: assignments (design §2.5) ──────────────────────────────────────

export interface ItAssetAssignmentDto {
  id: string;
  assetId: string;
  assignedToEmployeeId: string;
  assignedByUserId: string | null;
  assignedAt: string;
  conditionOnIssue: string | null;
  expectedReturnAt: string | null;
  /** `null` while the interval is OPEN — the field that closes it (design §6). */
  returnedAt: string | null;
  returnedToUserId: string | null;
  conditionOnReturn: string | null;
  notes: string | null;
  /** The asset's branch when the interval opened — denormalized so the register filters on it. */
  branchId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The four custody actions are NAMED (design §4.3) — never a generic PATCH — because each is a
 * distinct business act with its own guard, its own event and its own audit action. A PATCH that
 * happened to set `assignedToEmployeeId` would be none of those things.
 *
 * None of them carries a `version`: a custody action is not an edit of a record the caller is
 * holding, it is a transition of the ASSET, and its precondition is the asset's own state (in
 * stock / out / disposed) which the server checks inside the transaction. Optimistic locking
 * guards the registry edit form; the state machine guards these.
 */
export const AssignItAssetSchema = z
  .object({
    employeeId: objectId(),
    assignedAt: z.coerce.date().optional(),
    conditionOnIssue: z.string().trim().max(500).optional(),
    expectedReturnAt: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.expectedReturnAt !== undefined &&
      value.assignedAt !== undefined &&
      value.expectedReturnAt.getTime() < value.assignedAt.getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedReturnAt'],
        message: 'the expected return cannot precede the assignment',
      });
    }
  });
export type AssignItAsset = z.infer<typeof AssignItAssetSchema>;

export const ReturnItAssetSchema = z
  .object({
    returnedAt: z.coerce.date().optional(),
    conditionOnReturn: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type ReturnItAsset = z.infer<typeof ReturnItAssetSchema>;

/**
 * Transfer moves custody in ONE fact (design §2.5): person→person, branch→branch, or both. It is
 * never expressed as return + assign, because the history must show intent rather than mechanics.
 * At least one destination is required — a transfer to nowhere is not a transfer.
 */
export const TransferItAssetSchema = z
  .object({
    toEmployeeId: objectId().optional(),
    toBranchId: objectId().optional(),
    at: z.coerce.date().optional(),
    conditionOnReturn: z.string().trim().max(500).optional(),
    conditionOnIssue: z.string().trim().max(500).optional(),
    expectedReturnAt: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.toEmployeeId === undefined && value.toBranchId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toEmployeeId'],
        message: 'a transfer needs a new holder, a new branch, or both',
      });
    }
  });
export type TransferItAsset = z.infer<typeof TransferItAssetSchema>;

/** Disposal is terminal and set once (FR-4); `reason` is required because it is the record. */
export const DisposeItAssetSchema = z
  .object({
    method: ItDisposalMethodSchema,
    reason: z.string().trim().min(1).max(500),
    at: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type DisposeItAsset = z.infer<typeof DisposeItAssetSchema>;

export const ListItAssignmentsQuerySchema = PaginationQuerySchema.extend({
  /** `true` → only the open interval; `false` → only closed ones. Omitted → both. */
  open: booleanQuery().optional(),
  assetId: objectId().optional(),
  employeeId: objectId().optional(),
  branchId: objectId().optional(),
}).strict();
export type ListItAssignmentsQuery = z.infer<typeof ListItAssignmentsQuerySchema>;

// ── Custody: the asset's business history (design §2.3) ─────────────────────

/**
 * The closed vocabulary of `it_asset_events`. IT-2 writes five of these; the maintenance types
 * arrive with IT-4. Declared whole now so the history renderer is written once — the same reason
 * the status vocabulary was complete in IT-1.
 */
export const IT_ASSET_EVENT_TYPES = [
  'registered',
  'updated',
  'assigned',
  'returned',
  'transferred',
  'maintenanceStarted',
  'maintenanceCompleted',
  'warrantyUpdated',
  'disposed',
] as const;
export const ItAssetEventTypeSchema = z.enum(IT_ASSET_EVENT_TYPES);
export type ItAssetEventType = z.infer<typeof ItAssetEventTypeSchema>;

export interface ItAssetHistoryEntryDto {
  id: string;
  assetId: string;
  type: ItAssetEventType;
  at: string;
  actorUserId: string | null;
  /** Denormalized so the history survives a user rename or deactivation. */
  actorName: string;
  /**
   * Extra facts for the types that have them — empty for the ones that do not. Consumers switch
   * on `type` and never probe keys (design §2.3): a renderer that inspected metadata would break
   * silently the day a type stopped carrying a key.
   */
  metadata: Record<string, unknown>;
  notes: string | null;
}

export const ListItAssetHistoryQuerySchema = PaginationQuerySchema.extend({
  type: ItAssetEventTypeSchema.optional(),
}).strict();
export type ListItAssetHistoryQuery = z.infer<typeof ListItAssetHistoryQuerySchema>;

// ── Events (design §8.1) ────────────────────────────────────────────────────

export const ItEvents = {
  AssetRegistered: 'it.asset.registered',
  AssetUpdated: 'it.asset.updated',
  AssetAssigned: 'it.asset.assigned',
  AssetReturned: 'it.asset.returned',
  AssetTransferred: 'it.asset.transferred',
  AssetDisposed: 'it.asset.disposed',
} as const;
export type ItEventName = (typeof ItEvents)[keyof typeof ItEvents];

export const ItAssetEventPayloadV1 = z.object({
  assetId: objectId(),
  assetCode: z.string(),
  categoryId: objectId(),
});
export type ItAssetEventPayload = z.infer<typeof ItAssetEventPayloadV1>;

export const ItAssetAssignedPayloadV1 = z.object({
  assetId: objectId(),
  assetCode: z.string(),
  employeeId: objectId(),
  assignmentId: objectId(),
});
export type ItAssetAssignedPayload = z.infer<typeof ItAssetAssignedPayloadV1>;

export const ItAssetReturnedPayloadV1 = z.object({
  assetId: objectId(),
  assetCode: z.string(),
  employeeId: objectId(),
  condition: z.string().nullable(),
});
export type ItAssetReturnedPayload = z.infer<typeof ItAssetReturnedPayloadV1>;

export const ItAssetTransferredPayloadV1 = z.object({
  assetId: objectId(),
  assetCode: z.string(),
  fromEmployeeId: objectId().nullable(),
  toEmployeeId: objectId().nullable(),
  fromBranchId: objectId().nullable(),
  toBranchId: objectId().nullable(),
});
export type ItAssetTransferredPayload = z.infer<typeof ItAssetTransferredPayloadV1>;

export const ItAssetDisposedPayloadV1 = z.object({
  assetId: objectId(),
  assetCode: z.string(),
  method: ItDisposalMethodSchema,
  reason: z.string(),
});
export type ItAssetDisposedPayload = z.infer<typeof ItAssetDisposedPayloadV1>;
