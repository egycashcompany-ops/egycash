// Doc → DTO mapping for the Administrative Affairs module (the ATM and IT mappers' precedent): ids
// and dates become strings, a reference's label is resolved by the caller at read time and handed
// in, and nothing the server owns alone — `nameKey` above all — leaves it.
import {
  type AdministrationCatalogItemDto,
  type AdministrationItemCategoryDto,
  type AdministrationItemDto,
  type AdministrationPersonDto,
  type AdministrationSupplierDetailDto,
  type AdministrationSupplierDto,
  type AdministrationWarehouseDto,
  type AdministrationWarehouseKeeperDto,
} from '@ecms/contracts';
import { type DirectoryEmployee, type DirectoryEmployeeListing } from '../../platform/directory';
import { type AdministrationCatalogItemDoc } from './catalog/catalog-items/catalog-item.model';
import { type AdministrationItemCategoryDoc } from './catalog/item-categories/item-category.model';
import { type ItemCategoryParentNames } from './catalog/item-categories/item-category.service';
import { type AdministrationItemDoc } from './catalog/items/item.model';
import { type ItemLabels } from './catalog/items/item.service';
import { type AdministrationSupplierDoc } from './procurement/suppliers/supplier.model';
import {
  type SupplierDetailFacts,
  type SupplierLabels,
} from './procurement/suppliers/supplier.service';
import { type AdministrationWarehouseDoc } from './warehouses/warehouses/warehouse.model';
import { type WarehouseLabels } from './warehouses/warehouses/warehouse.service';

const iso = (d: Date): string => d.toISOString();

export const toAdministrationCatalogItemDto = (
  doc: AdministrationCatalogItemDoc,
): AdministrationCatalogItemDto => ({
  id: String(doc._id),
  kind: doc.kind,
  code: doc.code,
  name: doc.name,
  description: doc.description,
  sortOrder: doc.sortOrder,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/** `parents` holds the names the caller resolved; a parent it could not name reads null. */
export const toAdministrationItemCategoryDto = (
  doc: AdministrationItemCategoryDoc,
  parents: ItemCategoryParentNames,
): AdministrationItemCategoryDto => {
  const parentId = doc.parentId === null ? null : String(doc.parentId);
  return {
    id: String(doc._id),
    code: doc.code,
    name: doc.name,
    parentId,
    parentName: parentId === null ? null : (parents.get(parentId) ?? null),
    description: doc.description,
    sortOrder: doc.sortOrder,
    isActive: doc.isActive,
    version: doc.__v,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
};

/**
 * `labels` holds the names the caller resolved (§19.4): the category's and its parent's, the
 * unit's. A reference it could not name reads null rather than failing the row. A row written
 * before the item's kind existed is a stock item (OD-14 C, absence-safe).
 */
export const toAdministrationItemDto = (
  doc: AdministrationItemDoc,
  labels: ItemLabels,
): AdministrationItemDto => {
  const categoryId = String(doc.categoryId);
  const unitId = String(doc.unitId);
  const category = labels.categories.get(categoryId) ?? null;
  return {
    id: String(doc._id),
    code: doc.code,
    barcode: doc.barcode,
    name: doc.name,
    categoryId,
    categoryName: category?.name ?? null,
    categoryParentId: category?.parentId ?? null,
    categoryParentName: category?.parentName ?? null,
    unitId,
    unitName: labels.units.get(unitId) ?? null,
    minQty: doc.minQty,
    reorderPointQty: doc.reorderPointQty,
    maxQty: doc.maxQty,
    description: doc.description,
    notes: doc.notes,
    stockTracked: doc.stockTracked ?? true,
    isActive: doc.isActive,
    version: doc.__v,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
};

/**
 * `labels` holds the names the caller resolved (§19.4): the branch's and the keeper's, read fresh
 * and never stored. A branch it could not name reads null rather than failing the row; a keeper HR
 * cannot name reads null beside the id that is still stored. `canEdit` is the server's answer for
 * this reader, which the web cannot work out itself (§19.3).
 */
export const toAdministrationWarehouseDto = (
  doc: AdministrationWarehouseDoc,
  labels: WarehouseLabels,
  canEdit: boolean,
): AdministrationWarehouseDto => {
  const branchId = String(doc.branchId);
  const keeperId = doc.responsibleEmployeeId === null ? null : String(doc.responsibleEmployeeId);
  return {
    id: String(doc._id),
    code: doc.code,
    name: doc.name,
    branchId,
    branchName: labels.branches.get(branchId) ?? null,
    type: doc.type,
    departmentId: doc.departmentId === null ? null : String(doc.departmentId),
    responsibleEmployeeId: keeperId,
    keeper: keeperId === null ? null : (labels.keepers.get(keeperId) ?? null),
    location: doc.location,
    notes: doc.notes,
    isActive: doc.isActive,
    canEdit,
    version: doc.__v,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
};

/** A directory listing as the module prints a person (§7.8): seven facts, nothing else of HR's. */
export const toAdministrationPersonDto = (
  person: DirectoryEmployeeListing,
): AdministrationPersonDto => ({
  employeeId: person.employeeId,
  code: person.code,
  fullNameAr: person.fullNameAr,
  status: person.status,
  branchId: person.branchId,
  departmentId: person.departmentId,
  jobTitleId: person.jobTitleId,
});

/** A keeper on a warehouse: who, and whether they still work here (the screen marks a leaver). */
export const toAdministrationKeeperDto = (
  employee: DirectoryEmployee,
): AdministrationWarehouseKeeperDto => ({
  employeeId: employee.employeeId,
  code: employee.code,
  fullNameAr: employee.fullNameAr,
  status: employee.status,
});

/**
 * A register row (§19.4): `labels` holds the category names the caller resolved, a category it
 * could not name reading null rather than failing the row. Its papers are the detail's alone.
 */
export const toAdministrationSupplierDto = (
  doc: AdministrationSupplierDoc,
  labels: SupplierLabels,
): AdministrationSupplierDto => ({
  id: String(doc._id),
  code: doc.code,
  name: doc.name,
  phone: doc.phone,
  email: doc.email,
  address: doc.address,
  contacts: doc.contacts.map((contact) => ({
    name: contact.name,
    role: contact.role,
    phone: contact.phone,
    email: contact.email,
  })),
  categories: doc.categoryIds.map((categoryId) => {
    const id = String(categoryId);
    return { id, name: labels.categories.get(id) ?? null };
  }),
  taxNumber: doc.taxNumber,
  commercialRegistry: doc.commercialRegistry,
  vatStatus: doc.vatStatus,
  paymentTerms: doc.paymentTerms,
  notes: doc.notes,
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

/**
 * The record as its page reads it (§13.6 B): the row, each paper with its file's scan state read
 * at read time (null for a file gone or archived, §11.5), and the other holders of its tax number
 * — a warning, never a block (OD-11 (i)). A paper's file id stays on the server: the paper is read
 * through its own route, by `attachmentId`.
 */
export const toAdministrationSupplierDetailDto = (
  doc: AdministrationSupplierDoc,
  facts: SupplierDetailFacts,
): AdministrationSupplierDetailDto => ({
  ...toAdministrationSupplierDto(doc, facts.labels),
  attachments: doc.attachments.map((paper) => ({
    attachmentId: String(paper.attachmentId),
    categoryKey: paper.categoryKey,
    label: paper.label,
    fileName: paper.fileName,
    mime: paper.mime,
    size: paper.size,
    addedByUserId: String(paper.addedByUserId),
    addedAt: iso(paper.addedAt),
    scanStatus: facts.scanStates.get(String(paper.fileId)) ?? null,
  })),
  taxNumberMatches: facts.taxNumberMatches.map((match) => ({
    id: String(match._id),
    code: match.code,
    name: match.name,
    isActive: match.isActive,
  })),
});
