// IT module contracts (docs/12-planning/it-module-design.md, FROZEN v1.2) — IT-1 slice only:
// catalog items, vendors, the asset register with server-allocated codes, and QR labels.
// Custody, help desk, maintenance, software and dashboards arrive in IT-2…IT-6 by extending this
// file, never by adding a second one.
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

// ── Events (design §8.1 — IT-1 emits the two registry events) ───────────────

export const ItEvents = {
  AssetRegistered: 'it.asset.registered',
  AssetUpdated: 'it.asset.updated',
} as const;
export type ItEventName = (typeof ItEvents)[keyof typeof ItEvents];

export const ItAssetEventPayloadV1 = z.object({
  assetId: objectId(),
  assetCode: z.string(),
  categoryId: objectId(),
});
export type ItAssetEventPayload = z.infer<typeof ItAssetEventPayloadV1>;
