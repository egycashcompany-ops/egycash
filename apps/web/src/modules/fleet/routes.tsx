// Fleet module route subtree (FW-1), lazy-loaded as one chunk from App.tsx — the same
// route-based code splitting every module uses. The full information architecture from the
// frozen design is routed and permission-guarded here from day one (§7 permission table);
// FW-2…FW-10 replace each PlannedPage element with the real screen without touching the tree.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../platform/layout/AppShell';
import { FleetOverview } from './pages/FleetOverview';
import { PlannedPage } from './pages/PlannedPage';

/** Route → (§7 permission, final title, delivering slice). One table, no drift. */
const PLANNED: { path: string; permission: string; titleKey: string; slice: string }[] = [
  {
    path: 'vehicles',
    permission: 'fleetVehicle.view',
    titleKey: 'fleet.nav.vehicles',
    slice: 'FW-3',
  },
  {
    path: 'vehicles/:id',
    permission: 'fleetVehicle.view',
    titleKey: 'fleet.nav.vehicles',
    slice: 'FW-4',
  },
  { path: 'drivers', permission: 'fleetDriver.view', titleKey: 'fleet.nav.drivers', slice: 'FW-5' },
  {
    path: 'attendance',
    permission: 'fleetAvailability.view',
    titleKey: 'fleet.nav.attendance',
    slice: 'FW-5',
  },
  {
    path: 'odometer',
    permission: 'fleetOdometer.view',
    titleKey: 'fleet.nav.odometer',
    slice: 'FW-6',
  },
  {
    path: 'maintenance',
    permission: 'fleetMaintenance.view',
    titleKey: 'fleet.nav.maintenance',
    slice: 'FW-6',
  },
  {
    path: 'maintenance-alarms',
    permission: 'fleetOdometer.view',
    titleKey: 'fleet.nav.maintenanceAlarms',
    slice: 'FW-6',
  },
  { path: 'roster', permission: 'fleetRoster.view', titleKey: 'fleet.nav.roster', slice: 'FW-7' },
  {
    path: 'accidents',
    permission: 'fleetAccident.view',
    titleKey: 'fleet.nav.accidents',
    slice: 'FW-8',
  },
  {
    path: 'violations',
    permission: 'fleetViolation.view',
    titleKey: 'fleet.nav.violations',
    slice: 'FW-9',
  },
  {
    path: 'catalogs',
    permission: 'fleetCatalog.manage',
    titleKey: 'fleet.nav.catalogs',
    slice: 'FW-10',
  },
  {
    path: 'settings',
    permission: 'fleetMaintenanceRule.manage',
    titleKey: 'fleet.nav.settings',
    slice: 'FW-10',
  },
];

export default function FleetRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<FleetOverview />} />
        {PLANNED.map((page) => (
          <Route
            key={page.path}
            path={page.path}
            element={
              <RequirePermission permission={page.permission}>
                <PlannedPage titleKey={page.titleKey} slice={page.slice} />
              </RequirePermission>
            }
          />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
