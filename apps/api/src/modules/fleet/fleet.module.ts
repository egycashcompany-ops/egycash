// Fleet module manifest (frozen design docs/12-planning/fleet-module-design.md, FL-2 slice).
// Delivered incrementally exactly as HR was: this slice registers vehicles, vehicle types and
// catalogs; FL-3..FL-6 add drivers, odometer/maintenance, roster, accidents/violations — each
// extending THIS manifest, never adding a second one.
import { declarePermissions, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildFleetVehicleTypesRouter } from './vehicle-types';
import { buildFleetCatalogRouter } from './catalogs';
import { buildFleetVehiclesRouter } from './vehicles';
import { registerFleetSettings } from './fleet.settings';
import { seedFleet } from './fleet.seed';

registerFleetSettings();

const vehiclePermissions = declarePermissions(
  'fleet',
  'fleetVehicle',
  { en: 'vehicles', ar: 'السيارات' },
  ['view', 'create', 'edit', 'delete'],
  [
    // A separate grant from `edit` (design §7): taking a vehicle out of service or disposing of
    // it is an operational decision, not a data correction.
    {
      action: 'changeStatus',
      name: { en: 'Change vehicle status', ar: 'تغيير حالة السيارة' },
    },
  ],
);

const catalogPermissions = declarePermissions(
  'fleet',
  'fleetCatalog',
  { en: 'fleet catalogs', ar: 'قوائم الحركة' },
  [],
  [{ action: 'manage', name: { en: 'Manage fleet catalogs', ar: 'إدارة قوائم الحركة' } }],
);

const maintenanceRulePermissions = declarePermissions(
  'fleet',
  'fleetMaintenanceRule',
  { en: 'maintenance rules', ar: 'قواعد الصيانة' },
  [],
  [
    {
      action: 'manage',
      name: {
        en: 'Manage maintenance rules and vehicle types',
        ar: 'إدارة قواعد الصيانة وأنواع السيارات',
      },
    },
  ],
);

export const fleetPermissions: PermissionDef[] = [
  ...vehiclePermissions,
  ...catalogPermissions,
  ...maintenanceRulePermissions,
];

export const fleetModule: ModuleManifest = {
  id: 'fleet',
  name: { en: 'Fleet', ar: 'الحركة' },
  version: '0.1.0',
  requiresPlatform: '^2.1',
  permissions: fleetPermissions,
  routes: [
    { prefix: '/fleet/vehicles', router: buildFleetVehiclesRouter() },
    { prefix: '/fleet/vehicle-types', router: buildFleetVehicleTypesRouter() },
    { prefix: '/fleet/catalog-items', router: buildFleetCatalogRouter() },
  ],
  collections: ['fleet_vehicles', 'fleet_vehicle_types', 'fleet_catalog_items'],
  eventSubscriptions: [],
  seed: seedFleet,
};
