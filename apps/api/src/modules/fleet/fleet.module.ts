// Fleet module manifest (frozen design docs/12-planning/fleet-module-design.md, FL-2 slice).
// Delivered incrementally exactly as HR was: this slice registers vehicles, vehicle types and
// catalogs; FL-3..FL-6 add drivers, odometer/maintenance, roster, accidents/violations — each
// extending THIS manifest, never adding a second one.
import { declarePermissions, type PageDef, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { buildFleetVehicleTypesRouter } from './vehicle-types';
import { buildFleetCatalogRouter } from './catalogs';
import { buildFleetVehiclesRouter } from './vehicles';
import { vehicleFileAuthorizer } from './vehicles/vehicle-files';
import { buildFleetDriversRouter } from './driver-profiles/driver-profile.routes';
import { fleetDriverProfileService } from './driver-profiles/driver-profile.service';
import { buildFleetAvailabilityRouter } from './availability/unavailability.routes';
import { buildFleetOdometerRouter } from './odometer/odometer.routes';
import { buildFleetMaintenanceRouter } from './maintenance/maintenance.routes';
import { buildFleetRosterRouter } from './roster/roster.routes';
import { buildFleetAccidentsRouter } from './accidents/accident.routes';
import { buildFleetViolationsRouter } from './violations/violation.routes';
import { licenseExpirySweep, maintenanceAlarmSweep } from './sweeps/fleet-sweeps';
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
  'fleet.vehicles',
);

const catalogPermissions = declarePermissions(
  'fleet',
  'fleetCatalog',
  { en: 'fleet catalogs', ar: 'قوائم الحركة' },
  [],
  [{ action: 'manage', name: { en: 'Manage fleet catalogs', ar: 'إدارة قوائم الحركة' } }],
  'fleet.catalogs',
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
  'fleet.settings',
);

const driverPermissions = declarePermissions(
  'fleet',
  'fleetDriver',
  { en: 'drivers', ar: 'السائقين' },
  ['view'],
  [
    {
      action: 'manage',
      name: { en: 'Manage driver profiles', ar: 'إدارة ملفات السائقين' },
    },
  ],
  'fleet.drivers',
);

const availabilityPermissions = declarePermissions(
  'fleet',
  'fleetAvailability',
  { en: 'driver availability', ar: 'تمامات السائقين' },
  ['view'],
  [
    { action: 'record', name: { en: 'Record unavailability', ar: 'تسجيل عدم إتاحة' } },
    {
      action: 'edit',
      name: { en: 'Edit or cancel unavailability', ar: 'تعديل أو إلغاء عدم إتاحة' },
    },
  ],
  'fleet.attendance',
);

const odometerPermissions = declarePermissions(
  'fleet',
  'fleetOdometer',
  { en: 'odometer log', ar: 'عدادات السيارات' },
  ['view'],
  [
    { action: 'record', name: { en: 'Record odometer reading', ar: 'تسجيل قراءة عداد' } },
    // The ONLY way past the monotonic guard (FR-2) — a distinct, audited grant by design.
    {
      action: 'correct',
      name: { en: 'Correct odometer readings', ar: 'تصحيح قراءات العداد' },
    },
  ],
  'fleet.odometer',
);

const maintenancePermissions = declarePermissions(
  'fleet',
  'fleetMaintenance',
  { en: 'maintenance visits', ar: 'صيانة السيارات' },
  ['view', 'edit', 'delete'],
  [
    {
      action: 'checkIn',
      name: { en: 'Check a vehicle into a workshop', ar: 'إدخال سيارة للورشة' },
    },
    {
      action: 'checkOut',
      name: { en: 'Check a vehicle out (and undo)', ar: 'إخراج سيارة من الورشة (والتراجع)' },
    },
  ],
  'fleet.maintenance',
);

const rosterPermissions = declarePermissions(
  'fleet',
  'fleetRoster',
  { en: 'duty roster', ar: 'تعيين السيارات' },
  ['view'],
  [
    // One grant covers the whole planning surface: assigning, moving and clearing are the same
    // operation on the same board (§4.5), not separately delegable decisions.
    { action: 'plan', name: { en: 'Plan the daily roster', ar: 'تخطيط تعيين اليوم' } },
  ],
  'fleet.roster',
);

const accidentPermissions = declarePermissions(
  'fleet',
  'fleetAccident',
  { en: 'accidents', ar: 'حوادث السيارات' },
  ['view', 'create', 'edit', 'delete'],
  [
    // FR-10 — one grant, both directions: whoever may close a file may reopen it.
    {
      action: 'close',
      name: { en: 'Close or reopen an accident', ar: 'إغلاق أو إعادة فتح حادث' },
    },
  ],
  'fleet.accidents',
);

const violationPermissions = declarePermissions(
  'fleet',
  'fleetViolation',
  { en: 'violations', ar: 'مخالفات السيارات' },
  ['view', 'edit', 'delete'],
  [
    { action: 'record', name: { en: 'Record violations', ar: 'تسجيل المخالفات' } },
    // The grievance rewrites a year's money story — its own decision, its own grant (§7).
    {
      action: 'grievance',
      name: { en: 'Set the yearly grievance figure', ar: 'تسجيل تظلم سنوي' },
    },
  ],
  'fleet.violations',
);

export const fleetPermissions: PermissionDef[] = [
  ...vehiclePermissions,
  ...catalogPermissions,
  ...maintenanceRulePermissions,
  ...driverPermissions,
  ...availabilityPermissions,
  ...odometerPermissions,
  ...maintenancePermissions,
  ...rosterPermissions,
  ...accidentPermissions,
  ...violationPermissions,
];

/**
 * The administration surfaces this module owns — the middle layer of the role matrix.
 * Organizational only: nothing authorizes on a page, and declaring one grants nobody anything.
 * Declared here rather than derived from the navigation catalogue, which is runtime data an
 * administrator can edit.
 */
export const fleetPages: PageDef[] = [
  {
    id: 'fleet.vehicles',
    moduleId: 'fleet',
    name: { en: 'Vehicles', ar: 'المركبات' },
    route: '/fleet/vehicles',
    sortOrder: 10,
  },
  {
    id: 'fleet.drivers',
    moduleId: 'fleet',
    name: { en: 'Drivers', ar: 'السائقون' },
    route: '/fleet/drivers',
    sortOrder: 20,
  },
  {
    id: 'fleet.attendance',
    moduleId: 'fleet',
    name: { en: 'Attendance', ar: 'الحضور' },
    route: '/fleet/attendance',
    sortOrder: 30,
  },
  {
    id: 'fleet.roster',
    moduleId: 'fleet',
    name: { en: 'Daily roster', ar: 'الجدول اليومي' },
    route: '/fleet/roster',
    sortOrder: 40,
  },
  {
    id: 'fleet.odometer',
    moduleId: 'fleet',
    name: { en: 'Odometer', ar: 'عداد المسافات' },
    route: '/fleet/odometer',
    sortOrder: 50,
  },
  {
    id: 'fleet.maintenance',
    moduleId: 'fleet',
    name: { en: 'Maintenance', ar: 'الصيانة' },
    route: '/fleet/maintenance',
    sortOrder: 60,
  },
  {
    id: 'fleet.accidents',
    moduleId: 'fleet',
    name: { en: 'Accidents', ar: 'الحوادث' },
    route: '/fleet/accidents',
    sortOrder: 70,
  },
  {
    id: 'fleet.violations',
    moduleId: 'fleet',
    name: { en: 'Violations', ar: 'المخالفات' },
    route: '/fleet/violations',
    sortOrder: 80,
  },
  {
    id: 'fleet.catalogs',
    moduleId: 'fleet',
    name: { en: 'Fleet catalogs', ar: 'قوائم الحركة' },
    route: '/fleet/catalogs',
    sortOrder: 90,
  },
  {
    id: 'fleet.settings',
    moduleId: 'fleet',
    name: { en: 'Fleet settings', ar: 'إعدادات الحركة' },
    route: '/fleet/settings',
    sortOrder: 100,
  },
];

export const fleetModule: ModuleManifest = {
  id: 'fleet',
  name: { en: 'Fleet', ar: 'الحركة' },
  version: '0.1.0',
  requiresPlatform: '^2.1',
  permissions: fleetPermissions,
  pages: fleetPages,
  routes: [
    { prefix: '/fleet/vehicles', router: buildFleetVehiclesRouter() },
    { prefix: '/fleet/vehicle-types', router: buildFleetVehicleTypesRouter() },
    { prefix: '/fleet/catalog-items', router: buildFleetCatalogRouter() },
    { prefix: '/fleet/drivers', router: buildFleetDriversRouter() },
    { prefix: '/fleet/availability', router: buildFleetAvailabilityRouter() },
    { prefix: '/fleet/odometer', router: buildFleetOdometerRouter() },
    { prefix: '/fleet/maintenance', router: buildFleetMaintenanceRouter() },
    { prefix: '/fleet/roster', router: buildFleetRosterRouter() },
    { prefix: '/fleet/accidents', router: buildFleetAccidentsRouter() },
    { prefix: '/fleet/violations', router: buildFleetViolationsRouter() },
  ],
  collections: [
    'fleet_vehicles',
    'fleet_vehicle_types',
    'fleet_catalog_items',
    'fleet_driver_profiles',
    'fleet_driver_unavailability',
    'fleet_odometer_logs',
    'fleet_maintenance_visits',
    'fleet_sweep_marks',
    'fleet_duty_assignments',
    'fleet_accidents',
    'fleet_violations',
    'fleet_violation_grievances',
  ],
  // ADR-023 — a vehicle's files answer to the VEHICLE's grants and data scope, so reaching them
  // through the platform's own file endpoints is guarded exactly as the fleet routes are.
  fileEntityAuthorizers: [vehicleFileAuthorizer],
  eventSubscriptions: [
    {
      // Design §9.1 — leaving the company leaves the driver pool. Event-driven, no HR import.
      event: 'hr.employee.exited',
      handlerId: 'fleet.deactivateExitedDriver',
      handler: async (envelope) => {
        const payload = envelope.payload as { employeeId?: string };
        if (typeof payload.employeeId === 'string') {
          await fleetDriverProfileService.deactivateForExitedEmployee(payload.employeeId);
        }
      },
    },
  ],
  scheduledTasks: [
    {
      // FR-14 — license expiry becomes an announcement instead of a surprise. Idempotent via
      // fleet_sweep_marks (owner FL-4 point 4): safe to run twice, to overlap, or to replay.
      key: 'fleet.licenseExpirySweep',
      description: 'Announce vehicle/driver licenses expiring within the warn windows (FR-14)',
      cron: '15 4 * * *',
      ownerService: 'fleet',
      handler: async () => {
        await licenseExpirySweep();
      },
    },
    {
      // §4.4's additive half — the alarm stays DERIVED (FR-3); this only announces a threshold
      // crossing, once per (vehicle, level, baseline). A new service visit re-arms it.
      key: 'fleet.maintenanceAlarmSweep',
      description: 'Announce maintenance-alarm threshold crossings (yellow/red), once per baseline',
      cron: '30 4 * * *',
      ownerService: 'fleet',
      handler: async () => {
        await maintenanceAlarmSweep();
      },
    },
  ],
  seed: seedFleet,
};
