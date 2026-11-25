// Warehouses (design §2.3.5): the stores of each branch — «المخازن». A branch record, never
// deleted: retiring a warehouse is an edit (`isActive: false`), and its code and name stay taken
// while it is retired. It holds no quantity: from P5 its stock is the ledger's and its projection's
// alone (ADR-024).
//
// THE BRANCH IS THE STORE'S FOR GOOD. Set at the create and never written again: the ledger will
// copy it onto every movement and never re-file one, so a store that moves branch is a new
// warehouse (OD-10 A) — IT's "an item never changes branch".
//
// THE KEEPER IS AN ID ONLY. «أمين المخزن» is accountability, not authority (OD-10 keeper (i)): no
// name is copied here, it is read from HR when the warehouse is read, so HR's permanent delete has
// nothing of the person's to rewrite on this row, and a workforce reset (which keeps the row,
// OD-64 A) leaves an id that resolves to nobody until a keeper is named again.
import { Schema, model, type Types } from 'mongoose';
import {
  ADMINISTRATION_WAREHOUSE_TYPES,
  type AdministrationWarehouseType,
  type LocalizedString,
} from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface AdministrationWarehouseDoc extends BaseDocFields {
  /** Typed (OD-05 A), in the org units' pattern; one per live warehouse across the company. */
  code: string;
  name: LocalizedString;
  /** `foldName(name.ar)`, written by the service on every create and rename (§2.1). */
  nameKey: string;
  /** The scope anchor (§7.2). No write path changes it. */
  branchId: Types.ObjectId;
  type: AdministrationWarehouseType;
  /** The owning department copy, in the store's branch; reference-only (OD-10 department (i)). */
  departmentId: Types.ObjectId | null;
  /** The keeper (OD-10 keeper (i)), resolved at read time and never snapshotted here. */
  responsibleEmployeeId: Types.ObjectId | null;
  /** Where the store sits within its branch, free text. */
  location: string | null;
  notes: string | null;
  isActive: boolean;
}

const warehouseSchema = new Schema<AdministrationWarehouseDoc>(
  {
    code: { type: String, required: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    nameKey: { type: String, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ADMINISTRATION_WAREHOUSE_TYPES, required: true },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    responsibleEmployeeId: { type: Schema.Types.ObjectId, default: null },
    location: { type: String, default: null },
    notes: { type: String, default: null },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// A typed code, one per live warehouse in the whole company (§2.1: "a typed code gets a unique
// index partial on live rows", the org units' pattern). Master rows are never deleted, so a
// retired warehouse keeps its code: reactivate it, never type it again.
warehouseSchema.index(
  { code: 1 },
  { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
);
// One name per branch among live warehouses: two stores of one name in one branch would be one
// store to everybody who picks it. The race guard of one-name-one-store — two spellings typed at
// once («مخزن الأدوات», «مخزن الادوات») both pass the service's own check.
warehouseSchema.index(
  { branchId: 1, nameKey: 1 },
  { unique: true, name: 'ux_branch_name_key', partialFilterExpression: { isDeleted: false } },
);
// The register's reads: a branch's warehouses, by status — the scope anchor first.
warehouseSchema.index({ branchId: 1, isActive: 1 }, { name: 'ix_branch_active' });

export const AdministrationWarehouseModel = model<AdministrationWarehouseDoc>(
  'AdministrationWarehouse',
  warehouseSchema,
  'administration_warehouses',
);
