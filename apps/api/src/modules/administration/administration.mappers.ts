// Doc → DTO mapping for the Administrative Affairs module (the ATM and IT mappers' precedent): ids
// and dates become strings, a reference's label is resolved by the caller at read time and handed
// in, and nothing the server owns alone — `nameKey` above all — leaves it.
import {
  type AdministrationCatalogItemDto,
  type AdministrationItemCategoryDto,
} from '@ecms/contracts';
import { type AdministrationCatalogItemDoc } from './catalog/catalog-items/catalog-item.model';
import { type AdministrationItemCategoryDoc } from './catalog/item-categories/item-category.model';
import { type ItemCategoryParentNames } from './catalog/item-categories/item-category.service';

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
