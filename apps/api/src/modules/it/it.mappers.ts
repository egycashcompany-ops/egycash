// Doc → DTO mapping for the IT-1 entities. Derived facts stay derived — the mapper never invents
// one (the fleet FR-12 discipline).
import {
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItVendorDto,
} from '@ecms/contracts';
import { type ItCatalogItemDoc } from './catalog-items/catalog-item.model';
import { type ItVendorDoc } from './vendors/vendor.model';
import { type ItAssetDoc } from './assets/asset.model';

const iso = (d: Date): string => d.toISOString();

export const toItCatalogItemDto = (doc: ItCatalogItemDoc): ItCatalogItemDto => ({
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

export const toItVendorDto = (doc: ItVendorDoc): ItVendorDto => ({
  id: String(doc._id),
  name: doc.name,
  code: doc.code,
  phone: doc.phone,
  email: doc.email,
  address: doc.address,
  services: doc.services,
  contacts: doc.contacts.map((c) => ({
    name: c.name,
    role: c.role,
    phone: c.phone,
    email: c.email,
  })),
  isActive: doc.isActive,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});

export const toItAssetDto = (doc: ItAssetDoc): ItAssetDto => ({
  id: String(doc._id),
  assetCode: doc.assetCode,
  name: doc.name,
  description: doc.description,
  categoryId: String(doc.categoryId),
  status: doc.status,
  serialNumber: doc.serialNumber,
  model: doc.model,
  manufacturer: doc.manufacturer,
  externalTag: doc.externalTag,
  branchId: String(doc.branchId),
  location: doc.location,
  purchase:
    doc.purchase === null
      ? null
      : {
          date: doc.purchase.date === null ? null : iso(doc.purchase.date),
          cost: doc.purchase.cost,
          vendorId: doc.purchase.vendorId === null ? null : String(doc.purchase.vendorId),
          invoiceRef: doc.purchase.invoiceRef,
        },
  warranty:
    doc.warranty === null
      ? null
      : {
          vendorId: doc.warranty.vendorId === null ? null : String(doc.warranty.vendorId),
          start: iso(doc.warranty.start),
          end: iso(doc.warranty.end),
          terms: doc.warranty.terms,
        },
  notes: doc.notes,
  version: doc.__v,
  createdAt: iso(doc.createdAt),
  updatedAt: iso(doc.updatedAt),
});
