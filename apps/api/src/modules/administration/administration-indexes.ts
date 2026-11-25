// The module's models, as the seed hands them to the shared index sync (design §15.3.2, D-16).
//
// `autoIndex` is off in production and the deploy's index step builds only once an operator
// switches it from report to apply — while a unique index is the only guard this module has against
// two spellings of one name becoming two rows. So the seed builds them itself, FIRST, through the
// shared `syncDeclaredIndexes('apply', …)`: definitions read from the schemas, one index at a time,
// duplicates reported and never resolved, nothing dropped. No builder is copied here (ATM's copy has
// already drifted from the shared plan). The sync never throws; each repository's
// `ensureCollection` is what refuses a write while its index is missing.
//
// Every collection a `*.model.ts` in this module declares is on this list — the counter's too, which
// the shared factory defines — and the indexes spec reads the model files to prove it, so a model
// added without its line fails CI.
import { type Model } from 'mongoose';
import { AdministrationCatalogItemModel } from './catalog/catalog-items/catalog-item.model';
import { AdministrationItemCategoryModel } from './catalog/item-categories/item-category.model';
import { AdministrationItemModel } from './catalog/items/item.model';
import { AdministrationPurchaseRequestModel } from './procurement/purchase-requests/purchase-request.model';
import { AdministrationSupplierModel } from './procurement/suppliers/supplier.model';
import { AdministrationCounterModel } from './shared/counter.model';
import { AdministrationWarehouseModel } from './warehouses/warehouses/warehouse.model';

export const administrationModels: Model<never>[] = [
  AdministrationCatalogItemModel,
  AdministrationItemCategoryModel,
  AdministrationItemModel,
  AdministrationWarehouseModel,
  AdministrationSupplierModel,
  AdministrationPurchaseRequestModel,
  AdministrationCounterModel,
  // A list of differently typed models is what the shared sync takes: it reads only their schemas
  // and collections, so the documents' types do not matter to it.
] as unknown as Model<never>[];
