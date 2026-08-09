// IT module manifest (frozen design docs/12-planning/it-module-design.md v1.2, slices IT-1+IT-2).
// Delivered incrementally exactly as HR and Fleet were: IT-1 registered the catalogs, vendors and
// the asset register; IT-2 adds the custody lifecycle, its append-only history and the HR-exit
// subscription. IT-3…IT-6 add help desk, maintenance, software and dashboards — each extending
// THIS manifest, never adding a second one.
import { declarePermissions, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildItCatalogRouter } from './catalog-items';
import { buildItVendorsRouter } from './vendors';
import { buildItAssetsRouter, buildItAssignmentsRouter, itAssetCustodyService } from './assets';

const assetPermissions = declarePermissions(
  'it',
  'itAsset',
  { en: 'IT assets', ar: 'أصول تقنية المعلومات' },
  // No `print` grant by design (§7): a label shows nothing `view` cannot. `export` arrives with
  // IT-6, where the operation it gates exists — a grant is declared WITH its operation, never
  // ahead of it.
  ['view', 'create', 'edit', 'delete'],
  [
    // IT-2 custody (§7). ONE grant for assign + return + transfer: they are a single operational
    // surface — whoever hands an asset out is who takes it back — and the roster precedent says
    // one surface, one grant.
    {
      action: 'assign',
      name: { en: 'Assign, return and transfer IT assets', ar: 'تسليم واسترجاع ونقل الأصول' },
    },
    // Disposal is its OWN grant: writing an asset off is a different decision from moving it
    // between hands, it is terminal, and it is the one custody act that cannot be undone.
    {
      action: 'dispose',
      name: { en: 'Dispose of IT assets', ar: 'استبعاد الأصول' },
    },
  ],
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
    { prefix: '/it/assignments', router: buildItAssignmentsRouter() },
    { prefix: '/it/catalog-items', router: buildItCatalogRouter() },
    { prefix: '/it/vendors', router: buildItVendorsRouter() },
  ],
  collections: [
    'it_assets',
    'it_asset_assignments',
    'it_asset_events',
    'it_catalog_items',
    'it_vendors',
    'it_sequences',
  ],
  eventSubscriptions: [
    {
      // Design §9.1 / FR-13 — leaving the company does NOT return the assets. The leaver's open
      // assignments are recorded so the exit checklist has a safety net; a human still records the
      // physical return, because an automatic one would write a custody fact that never happened.
      // Event-driven, no HR import (the Fleet precedent).
      event: 'hr.employee.exited',
      handlerId: 'it.flagAssetsHeldByExitedEmployee',
      handler: async (envelope) => {
        const payload = envelope.payload as { employeeId?: string };
        if (typeof payload.employeeId === 'string') {
          await itAssetCustodyService.flagAssetsHeldByExitedEmployee(payload.employeeId);
        }
      },
    },
  ],
};
