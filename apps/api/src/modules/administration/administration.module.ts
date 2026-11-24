// Administrative Affairs module manifest — «الشئون الإدارية»: warehouses and procurement
// (docs/12-planning/administration-module-design.md and its three companion files).
//
// The one manifest of the module, grown slice by slice exactly as IT's and ATM's were, never a
// second one. P1a.1 ships the catalog's first two lists — units of measure and item categories —
// on one key and one page; items, warehouses and their keys and pages join in P1a.2 and P1a.3,
// suppliers in P1b.1 (§19.1). A key ships with its operation and a page with its keys: a key whose
// page is missing fails boot, and so does a page with no key.
import { declarePermissions, type PageDef, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { seedAdministration } from './administration.seed';
import { buildAdministrationCatalogItemsRouter } from './catalog/catalog-items';
import { buildAdministrationItemCategoriesRouter } from './catalog/item-categories';

// One grant over every catalog kind, as `itCatalog.manage` is (§6.2): units and item categories
// are configuration the same people keep. Held at ORGANIZATION scope by its services (OD-04 A).
const catalogPermissions = declarePermissions(
  'administration',
  'administrationCatalog',
  { en: 'Units and item categories', ar: 'وحدات القياس وتصنيفات الأصناف' },
  [],
  [
    {
      action: 'manage',
      name: {
        en: 'Manage units and item categories',
        ar: 'إدارة وحدات القياس وتصنيفات الأصناف',
      },
    },
  ],
  'administration.catalogs',
);

export const administrationPermissions: PermissionDef[] = [...catalogPermissions];

export const administrationPages: PageDef[] = [
  {
    id: 'administration.catalogs',
    moduleId: 'administration',
    name: { en: 'Units and categories', ar: 'وحدات القياس والتصنيفات' },
    route: '/administration/catalogs',
    // Warehouses (10) and items (20) come before it as they ship (§6.3).
    sortOrder: 30,
  },
];

export const administrationModule: ModuleManifest = {
  id: 'administration',
  name: { en: 'Administrative Affairs', ar: 'الشئون الإدارية' },
  version: '0.1.0',
  requiresPlatform: '^2.2',
  permissions: administrationPermissions,
  pages: administrationPages,
  routes: [
    { prefix: '/administration/catalog-items', router: buildAdministrationCatalogItemsRouter() },
    {
      prefix: '/administration/item-categories',
      router: buildAdministrationItemCategoriesRouter(),
    },
  ],
  collections: ['administration_catalog_items', 'administration_item_categories'],
  eventSubscriptions: [],
  seed: seedAdministration,
};
