// Administrative Affairs — procurement (docs/12-planning/administration-module-design.md §2.3.6,
// §11.2–§11.5, §19.4): the supplier register, P1b.1. Requests, quotations and orders join here
// from P2 on.
//
// The register is the module's own (OD-01 C, ADR-040): IT's vendors and Fleet's workshops stay
// where they are, and a later platform seam may read this one. The fields are OD-11 A's — identity,
// contacts, the tax and commercial registration numbers, a VAT status, payment terms, the papers —
// and nothing else: no bank, IBAN or account data, and no national id. A supplier is active or
// retired (OD-12 A, the IT vendor precedent), never deleted, and keeps its name and code retired.
//
// As in the catalog, no schema takes `code` (generated, «SUP-00001», OD-05 A) or `nameKey` (the
// service folds `name.ar`, §2.1), and every write schema is strict, so a stray key is refused
// rather than dropped.
import { z } from 'zod';
import { PaginationQuerySchema, booleanQuery, objectId } from '../common/index.js';
import { type LocalizedString } from '../common/localized.js';
import { type ScanStatus } from '../platform/files.js';
import { AdministrationNameSchema } from './administration-catalog.js';

// ── Field shapes ────────────────────────────────────────────────────────────

/** The IT vendor card's bounds (§2.3.6: "the IT vendor card"), so one phone fits either form. */
const phone = z.string().trim().max(30);
const email = z.string().trim().email().max(200);
const address = z.string().trim().max(500);
/**
 * A registration number as the paper prints it, trimmed. Bounded as the Organization's own
 * `taxNumber` and `commercialRegistry` are (50), whose names these are (§2.3.6). No format is
 * imposed: the design gives none, and a supplier's papers are what the number is checked against.
 */
const registryNumber = z.string().trim().min(1).max(50);
/** Free text until OD-29 structures payment terms (OD-11 A). */
const paymentTerms = z.string().trim().max(500);
const notes = z.string().trim().max(2000);

/** A supplier lists at most 20 contact people (§2.3.6): reality bounds the list, IT's rule. */
export const ADMINISTRATION_SUPPLIER_MAX_CONTACTS = 20;

/**
 * The most item categories one supplier names. Not a business rule — the design states none — but
 * the bound every stored array keeps, here a list page's 100, so a row stays small.
 */
export const ADMINISTRATION_SUPPLIER_MAX_CATEGORIES = 100;

/**
 * A supplier's VAT status (OD-11 A): a closed list whose values arrive with OD-29 (VAT, §12.8).
 * Until then the list is empty and the field holds null only, so the record's shape is final and
 * the values join without a migration — none is invented here.
 */
export const ADMINISTRATION_SUPPLIER_VAT_STATUSES = [] as const;
export type AdministrationSupplierVatStatus = (typeof ADMINISTRATION_SUPPLIER_VAT_STATUSES)[number];

/**
 * What a supplier names (`ADMINISTRATION_REFERENCE_INACTIVE`'s detail `field`): the item
 * categories it supplies, which RFQ invitations will be filtered by (P3).
 */
export const ADMINISTRATION_SUPPLIER_REFERENCE_FIELDS = ['categoryIds'] as const;
export type AdministrationSupplierReferenceField =
  (typeof ADMINISTRATION_SUPPLIER_REFERENCE_FIELDS)[number];

export const AdministrationSupplierContactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().max(120).optional(),
    phone: phone.optional(),
    email: email.optional(),
  })
  .strict();
export type AdministrationSupplierContact = z.infer<typeof AdministrationSupplierContactSchema>;

const contacts = z
  .array(AdministrationSupplierContactSchema)
  .max(ADMINISTRATION_SUPPLIER_MAX_CONTACTS);
const categoryIds = z.array(objectId()).max(ADMINISTRATION_SUPPLIER_MAX_CATEGORIES);

// ── Papers — `administration-supplier-documents` (§11.2, OD-11 A) ───────────

/** The file category a supplier's papers are filed in, one key per purpose (§11.2). */
export const ADMINISTRATION_SUPPLIER_DOCUMENTS_FILE_CATEGORY = 'administration-supplier-documents';

/**
 * PDF and images only (OD-76 (i)): "a phone photo of the signed paper, or the office scanner's
 * PDF", each previewable in the browser. Office formats would be download-only, a macro risk.
 */
export const ADMINISTRATION_SUPPLIER_DOCUMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** The category's limit, the one a user meets: the upload's own cap sits 5 MB above it (§11.2). */
export const ADMINISTRATION_SUPPLIER_DOCUMENT_MAX_MB = 10;

/**
 * The text fields sent beside the file (multipart, so each arrives as a string): what the paper
 * is — «السجل التجاري», «البطاقة الضريبية» — bounded as a file's display name is, and the
 * version of the supplier the person was looking at, because a paper's link is an edit of it.
 */
export const AddAdministrationSupplierAttachmentSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    version: z.coerce.number().int().min(0),
  })
  .strict();
export type AddAdministrationSupplierAttachment = z.infer<
  typeof AddAdministrationSupplierAttachmentSchema
>;

/** `?version=` on a paper's removal — a DELETE carries no body. */
export const AdministrationSupplierAttachmentVersionQuerySchema = z
  .object({ version: z.coerce.number().int().min(0) })
  .strict();
export type AdministrationSupplierAttachmentVersionQuery = z.infer<
  typeof AdministrationSupplierAttachmentVersionQuerySchema
>;

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface AdministrationSupplierContactDto {
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

/** An item category the supplier names, by its name at read time (a retired one names itself). */
export interface AdministrationSupplierCategoryDto {
  id: string;
  name: LocalizedString | null;
}

/** A register row (§19.4): the record and its category names. Papers are the detail's. */
export interface AdministrationSupplierDto {
  id: string;
  /** «SUP-00001», generated at creation (OD-05 A): permanent, never reused. */
  code: string;
  name: LocalizedString;
  phone: string | null;
  email: string | null;
  address: string | null;
  contacts: AdministrationSupplierContactDto[];
  /** The item categories it supplies, in the order they were given. */
  categories: AdministrationSupplierCategoryDto[];
  taxNumber: string | null;
  commercialRegistry: string | null;
  /** Null until OD-29 gives the values (`ADMINISTRATION_SUPPLIER_VAT_STATUSES`). */
  vatStatus: AdministrationSupplierVatStatus | null;
  paymentTerms: string | null;
  notes: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** One paper on the supplier's list (list B, §11.4), its file's scan state read at read time. */
export interface AdministrationSupplierAttachmentDto {
  /** What the paper's own read and removal name: `/suppliers/:id/attachments/:attachmentId`. */
  attachmentId: string;
  categoryKey: string;
  label: string;
  fileName: string;
  mime: string;
  size: number;
  addedByUserId: string;
  addedAt: string;
  /**
   * The file's scan state, never stored (§11.5): `pending` can be neither previewed nor
   * downloaded yet, `blocked` never. Null when the file is gone or archived — «الملف غير متاح».
   */
  scanStatus: ScanStatus | null;
}

/** Another supplier, as a warning names it. */
export interface AdministrationSupplierMatchDto {
  id: string;
  code: string;
  name: LocalizedString;
  isActive: boolean;
}

/** The record as its page reads it (§13.6 B): the register row, its papers, and its warnings. */
export interface AdministrationSupplierDetailDto extends AdministrationSupplierDto {
  attachments: AdministrationSupplierAttachmentDto[];
  /**
   * Other suppliers that hold this tax number, retired ones included — a WARNING, never a block
   * (OD-11 (i)): a supplier's branches may be separate records. At most
   * `ADMINISTRATION_SUPPLIER_MAX_TAX_NUMBER_MATCHES`, newest first; empty without a tax number.
   */
  taxNumberMatches: AdministrationSupplierMatchDto[];
}

/** How many other holders of a tax number the warning names — enough to recognize, not a report. */
export const ADMINISTRATION_SUPPLIER_MAX_TAX_NUMBER_MATCHES = 5;

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * No `code` (the server takes it inside the create's transaction), no `attachments` (a paper is
 * linked through its own endpoint, with its file), no `isActive` (a supplier starts active), and
 * no bank data of any kind (OD-11 A). `vatStatus` takes null alone until OD-29.
 */
export const CreateAdministrationSupplierSchema = z
  .object({
    name: AdministrationNameSchema,
    phone: phone.optional(),
    email: email.optional(),
    address: address.optional(),
    contacts: contacts.default([]),
    categoryIds: categoryIds.default([]),
    taxNumber: registryNumber.optional(),
    commercialRegistry: registryNumber.optional(),
    vatStatus: z.null().optional(),
    paymentTerms: paymentTerms.optional(),
    notes: notes.optional(),
  })
  .strict();
export type CreateAdministrationSupplier = z.infer<typeof CreateAdministrationSupplierSchema>;

/**
 * `null` clears a field; `contacts` and `categoryIds` replace their whole list; `isActive: false`
 * retires the supplier (OD-12 A, §5.3), which nothing refuses.
 */
export const UpdateAdministrationSupplierSchema = z
  .object({
    name: AdministrationNameSchema.optional(),
    phone: phone.nullable().optional(),
    email: email.nullable().optional(),
    address: address.nullable().optional(),
    contacts: contacts.optional(),
    categoryIds: categoryIds.optional(),
    taxNumber: registryNumber.nullable().optional(),
    commercialRegistry: registryNumber.nullable().optional(),
    vatStatus: z.null().optional(),
    paymentTerms: paymentTerms.nullable().optional(),
    notes: notes.nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateAdministrationSupplier = z.infer<typeof UpdateAdministrationSupplierSchema>;

/**
 * `search` reads the code and both names, the Arabic folded too (§19.4). `categoryId` reads a
 * category with its subcategories, as the item register does: the filter is picked from the top
 * level down.
 */
export const ListAdministrationSuppliersQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  categoryId: objectId().optional(),
  isActive: booleanQuery().optional(),
}).strict();
export type ListAdministrationSuppliersQuery = z.infer<
  typeof ListAdministrationSuppliersQuerySchema
>;
