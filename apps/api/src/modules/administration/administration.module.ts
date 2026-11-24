// Administrative Affairs module manifest — «الشئون الإدارية»: warehouses and procurement
// (docs/12-planning/administration-module-design.md and its three companion files).
//
// The one manifest of the module, grown slice by slice exactly as IT's and ATM's were, never a
// second one. P1a.1 shipped the catalog's first two lists — units of measure and item categories —
// on one key and one page; P1a.2 adds the items, their three keys and their page; warehouses join
// in P1a.3, suppliers in P1b.1 (§19.1). A key ships with its operation and a page with its keys: a
// key whose page is missing fails boot, and so does a page with no key.
import { declarePermissions, type PageDef, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { seedAdministration } from './administration.seed';
import { buildAdministrationCatalogItemsRouter } from './catalog/catalog-items';
import { buildAdministrationItemCategoriesRouter } from './catalog/item-categories';
import { buildAdministrationItemsRouter } from './catalog/items';

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

// The item master (§6.2): `view` reads the register organization-wide — master data is read whole
// (§7.1) — and `create`, `edit` write it, deactivation included, at organization scope (OD-04 A).
const itemPermissions = declarePermissions(
  'administration',
  'administrationItem',
  { en: 'Items', ar: 'الأصناف' },
  ['view', 'create', 'edit'],
  [],
  'administration.items',
);

export const administrationPermissions: PermissionDef[] = [
  ...itemPermissions,
  ...catalogPermissions,
];

export const administrationPages: PageDef[] = [
  {
    id: 'administration.items',
    moduleId: 'administration',
    name: { en: 'Items', ar: 'الأصناف' },
    route: '/administration/items',
    // Warehouses (10) come before it when they ship (§6.3).
    sortOrder: 20,
  },
  {
    id: 'administration.catalogs',
    moduleId: 'administration',
    name: { en: 'Units and categories', ar: 'وحدات القياس والتصنيفات' },
    route: '/administration/catalogs',
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
    { prefix: '/administration/items', router: buildAdministrationItemsRouter() },
  ],
  // Bookkeeping included (§3.3): the counter the item codes are taken from.
  collections: [
    'administration_catalog_items',
    'administration_item_categories',
    'administration_items',
    'administration_counters',
  ],
  eventSubscriptions: [],
  seed: seedAdministration,
};
