// Administrative Affairs module manifest — «الشئون الإدارية»: warehouses and procurement
// (docs/12-planning/administration-module-design.md and its three companion files).
//
// The one manifest of the module, grown slice by slice exactly as IT's and ATM's were, never a
// second one. P1a.1 shipped the catalog's first two lists — units of measure and item categories —
// on one key and one page; P1a.2 added the items, their three keys and their page; P1a.3 added the
// warehouses, their three keys and their page, and the people the keeper is picked from; P1b.1
// added the suppliers, their three keys, their page and their papers' authorizer (§19.1); P2.2
// adds the purchase requests, their four keys and their page (P2 plan §9.1), and P2.6 their files'
// authorizer (P2 plan §4.3). A key ships with its operation and a page with its keys: a key whose
// page is missing fails boot, and so does a page with no key.
import { declarePermissions, type PageDef, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { seedAdministration } from './administration.seed';
import { buildAdministrationCatalogItemsRouter } from './catalog/catalog-items';
import { buildAdministrationItemCategoriesRouter } from './catalog/item-categories';
import { buildAdministrationItemsRouter } from './catalog/items';
import { buildAdministrationPeopleRouter } from './people/index';
import {
  buildAdministrationPurchaseRequestsRouter,
  purchaseRequestFileAuthorizer,
} from './procurement/purchase-requests/index';
import {
  buildAdministrationSuppliersRouter,
  supplierFileAuthorizer,
} from './procurement/suppliers';
import { buildAdministrationWarehousesRouter } from './warehouses/warehouses/index';

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

// The stores of each branch (§6.2): `view` reads the warehouses its scope reaches, fail-closed
// (§7.2), and `create`, `edit` write — deactivation included — in a branch the key reaches. Not
// held to organization scope: a warehouse is a branch record, not organization-wide master data.
const warehousePermissions = declarePermissions(
  'administration',
  'administrationWarehouse',
  { en: 'Warehouses', ar: 'المخازن' },
  ['view', 'create', 'edit'],
  [],
  'administration.warehouses',
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

// The supplier register (§6.2; OD-01 C, ADR-040): `view` reads it organization-wide, papers
// included — master data is read whole (§7.1) — and `create`, `edit` write it, deactivation and
// papers included, at organization scope (OD-04 A). The Arabic resource name follows the verbal
// noun of each label, so it is genitive — «عرض الموردين», as Fleet's «عرض السائقين» — while the
// page keeps the nominative «الموردون».
const supplierPermissions = declarePermissions(
  'administration',
  'administrationSupplier',
  { en: 'Suppliers', ar: 'الموردين' },
  ['view', 'create', 'edit'],
  [],
  'administration.suppliers',
);

// Purchase requests (P2 plan §9.1; design §6.2): `view` reads the register and a record within its
// scope; `create` raises a draft and submits it (P2.3), on the holder's own department copy (OD-16
// A); `edit` edits a draft, the requester's own; `approve` decides a rung, and opens the record of
// what it decides, at each rung's own scope (OD-69 (i)) — declared now so the chains of P2.3 can
// name it (ADR-041 decision 9). `cancel` ships with its act (P2.5).
const purchaseRequestPermissions = declarePermissions(
  'administration',
  'administrationPurchaseRequest',
  { en: 'Purchase requests', ar: 'طلبات الشراء' },
  ['view', 'create', 'edit', 'approve'],
  [],
  'administration.purchase-requests',
);

export const administrationPermissions: PermissionDef[] = [
  ...warehousePermissions,
  ...itemPermissions,
  ...catalogPermissions,
  ...supplierPermissions,
  ...purchaseRequestPermissions,
];

export const administrationPages: PageDef[] = [
  {
    id: 'administration.warehouses',
    moduleId: 'administration',
    name: { en: 'Warehouses', ar: 'المخازن' },
    route: '/administration/warehouses',
    sortOrder: 10,
  },
  {
    id: 'administration.items',
    moduleId: 'administration',
    name: { en: 'Items', ar: 'الأصناف' },
    route: '/administration/items',
    sortOrder: 20,
  },
  {
    id: 'administration.catalogs',
    moduleId: 'administration',
    name: { en: 'Units and categories', ar: 'وحدات القياس والتصنيفات' },
    route: '/administration/catalogs',
    sortOrder: 30,
  },
  {
    id: 'administration.suppliers',
    moduleId: 'administration',
    name: { en: 'Suppliers', ar: 'الموردون' },
    route: '/administration/suppliers',
    sortOrder: 40,
  },
  {
    id: 'administration.purchase-requests',
    moduleId: 'administration',
    name: { en: 'Purchase requests', ar: 'طلبات الشراء' },
    route: '/administration/purchase-requests',
    sortOrder: 50,
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
    { prefix: '/administration/warehouses', router: buildAdministrationWarehousesRouter() },
    // The keeper picker (§7.8): read-only, over the platform directory.
    { prefix: '/administration/people', router: buildAdministrationPeopleRouter() },
    { prefix: '/administration/suppliers', router: buildAdministrationSuppliersRouter() },
    {
      prefix: '/administration/purchase-requests',
      router: buildAdministrationPurchaseRequestsRouter(),
    },
  ],
  // Bookkeeping included (§3.3): the counter the item and supplier codes, and the requests' yearly
  // numbers, are taken from.
  collections: [
    'administration_catalog_items',
    'administration_item_categories',
    'administration_items',
    'administration_warehouses',
    'administration_suppliers',
    'administration_purchase_requests',
    'administration_counters',
  ],
  eventSubscriptions: [],
  // A supplier's papers are filed under `administration/supplier` (§11.3), and a purchase
  // request's files under `administration/purchaseRequest` (P2 plan §4.3, P2.6).
  fileEntityAuthorizers: [supplierFileAuthorizer, purchaseRequestFileAuthorizer],
  seed: seedAdministration,
};
