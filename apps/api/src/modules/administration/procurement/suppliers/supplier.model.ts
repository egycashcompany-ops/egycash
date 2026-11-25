// Suppliers (design §2.3.6): the organization's one register of the parties it buys from —
// «الموردون». The module's own (OD-01 C, ADR-040): IT's vendors and Fleet's workshops are not moved
// into it, and a later platform seam may read it; a later merge would bring their rows in under
// their own ids. Master data, never deleted: retiring a supplier is an edit (`isActive: false`,
// OD-12 A), and its name and code stay taken while it is retired.
//
// The fields are OD-11 A's and nothing more: identity, contacts, the tax and commercial
// registration numbers, a VAT status, payment terms, and the papers. No bank, IBAN or account data
// is stored, and no national id — no decision needs them (§6.8).
//
// The code is generated, «SUP-00001» (OD-05 A), taken inside the create's transaction from the
// module's counter under its own key, so a create that rolls back gives its number back. It is
// permanent and unique across every row ever written, retired or not.
import { Schema, model, type Types } from 'mongoose';
import { type AdministrationSupplierVatStatus, type LocalizedString } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

/** A contact person — embedded, because reality bounds the list (≤ 20, IT's vendor card). */
export interface AdministrationSupplierContactSub {
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * One paper on the supplier's typed list (list B, §11.4). Files owns the bytes; this is the link,
 * with the facts a documents card shows without reading the file. `attachmentId` is what the
 * paper's own read and removal name; `categoryKey` is the purpose the file was filed under.
 */
export interface AdministrationSupplierAttachmentSub {
  attachmentId: Types.ObjectId;
  fileId: Types.ObjectId;
  categoryKey: string;
  label: string;
  fileName: string;
  mime: string;
  size: number;
  addedByUserId: Types.ObjectId;
  addedAt: Date;
}

export interface AdministrationSupplierDoc extends BaseDocFields {
  /** «SUP-00001», generated (OD-05 A). Never changes. */
  code: string;
  /** The trade name as printed. */
  name: LocalizedString;
  /** `foldName(name.ar)`, written by the service on every create and rename (§2.1). */
  nameKey: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  contacts: AdministrationSupplierContactSub[];
  /** The item categories it supplies, which RFQ invitations will be filtered by (P3). */
  categoryIds: Types.ObjectId[];
  /** Repeated across suppliers only with a warning, never refused (OD-11 (i)). */
  taxNumber: string | null;
  commercialRegistry: string | null;
  /** Null until OD-29 gives the values. */
  vatStatus: AdministrationSupplierVatStatus | null;
  /** Free text until OD-29 structures terms. */
  paymentTerms: string | null;
  attachments: AdministrationSupplierAttachmentSub[];
  notes: string | null;
  isActive: boolean;
}

const contactSchema = new Schema<AdministrationSupplierContactSub>(
  {
    name: { type: String, required: true },
    role: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, default: null },
  },
  { _id: false },
);

const attachmentSchema = new Schema<AdministrationSupplierAttachmentSub>(
  {
    attachmentId: { type: Schema.Types.ObjectId, required: true },
    fileId: { type: Schema.Types.ObjectId, required: true },
    categoryKey: { type: String, required: true },
    label: { type: String, required: true },
    fileName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    addedByUserId: { type: Schema.Types.ObjectId, required: true },
    addedAt: { type: Date, required: true },
  },
  { _id: false },
);

const supplierSchema = new Schema<AdministrationSupplierDoc>(
  {
    code: { type: String, required: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    nameKey: { type: String, required: true },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    address: { type: String, default: null },
    contacts: { type: [contactSchema], required: true, default: [] },
    categoryIds: { type: [Schema.Types.ObjectId], required: true, default: [] },
    taxNumber: { type: String, default: null },
    commercialRegistry: { type: String, default: null },
    vatStatus: { type: String, default: null },
    paymentTerms: { type: String, default: null },
    attachments: { type: [attachmentSchema], required: true, default: [] },
    notes: { type: String, default: null },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// A generated code is unique across EVERY row, not only live ones: it is never reused, so not even
// a deleted row frees it (§2.1). It is also what the counter's floor is read through, by prefix.
supplierSchema.index({ code: 1 }, { unique: true, name: 'ux_code' });
// One Arabic trade name among live suppliers, compared folded (§2.1) — the race guard two
// spellings typed at once both pass the service's own check against.
supplierSchema.index(
  { nameKey: 1 },
  { unique: true, name: 'ux_name_key', partialFilterExpression: { isDeleted: false } },
);
// The tax-number warning's read (OD-11 (i)). NOT unique: a unique index would mean one record per
// legal entity, and a supplier's branches could not be separate records.
supplierSchema.index(
  { taxNumber: 1 },
  {
    name: 'ix_tax_number',
    partialFilterExpression: { taxNumber: { $type: 'string' }, isDeleted: false },
  },
);
// The register's status filter, and its category filter — multikey over the list (§2.3.6).
supplierSchema.index({ isActive: 1 }, { name: 'ix_active' });
supplierSchema.index({ categoryIds: 1 }, { name: 'ix_category' });

export const AdministrationSupplierModel = model<AdministrationSupplierDoc>(
  'AdministrationSupplier',
  supplierSchema,
  'administration_suppliers',
);
