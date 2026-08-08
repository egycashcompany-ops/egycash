// IT module manifest (frozen design docs/12-planning/it-module-design.md v1.2, IT-1 slice).
// Delivered incrementally exactly as HR and Fleet were: this slice registers the catalogs,
// vendors and the asset register; IT-2…IT-6 add custody, help desk, maintenance, software and
// dashboards — each extending THIS manifest, never adding a second one.
import { declarePermissions, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildItCatalogRouter } from './catalog-items';
import { buildItVendorsRouter } from './vendors';
import { buildItAssetsRouter } from './assets';

const assetPermissions = declarePermissions(
  'it',
  'itAsset',
  { en: 'IT assets', ar: 'أصول تقنية المعلومات' },
  // No `print` grant by design (§7): a label shows nothing `view` cannot. Custody grants
  // (`assign`, `dispose`) arrive with IT-2, where the operations they gate exist.
  ['view', 'create', 'edit', 'delete'],
);

const catalogPermissions = declarePermissions(
  'it',
  'itCatalog',
  { en: 'IT catalogs', ar: 'قوائم تقنية المعلومات' },
  [],
  [
    // One grant for both kinds (asset + ticket categories) — the fleetCatalog.manage precedent.
    { action: 'manage', name: { en: 'Manage IT catalogs', ar: 'إدارة قوائم تقنية المعلومات' } },
  ],
);

const vendorPermissions = declarePermissions(
  'it',
  'itVendor',
  { en: 'IT vendors', ar: 'موردو تقنية المعلومات' },
  ['view'],
  [{ action: 'manage', name: { en: 'Manage IT vendors', ar: 'إدارة موردي تقنية المعلومات' } }],
);

export const itPermissions: PermissionDef[] = [
  ...assetPermissions,
  ...catalogPermissions,
  ...vendorPermissions,
];

export const itModule: ModuleManifest = {
  id: 'it',
  name: { en: 'IT', ar: 'تقنية المعلومات' },
  version: '0.1.0',
  requiresPlatform: '^2.1',
  permissions: itPermissions,
  routes: [
    { prefix: '/it/assets', router: buildItAssetsRouter() },
    { prefix: '/it/catalog-items', router: buildItCatalogRouter() },
    { prefix: '/it/vendors', router: buildItVendorsRouter() },
  ],
  collections: ['it_assets', 'it_catalog_items', 'it_vendors', 'it_sequences'],
  eventSubscriptions: [],
};
