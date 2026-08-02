// Fleet module route subtree, lazy-loaded as one chunk from App.tsx — the same route-based
// code splitting every module uses.
//
// OWNER RULE (FW-1 review): no placeholder surface is ever reachable by an end user. A screen
// is routed here in the SAME slice that ships it, and joins the navigation catalog at the same
// moment; until then its URL falls through to the standard 404. The frozen IA and its §7
// permission per route, for the record:
//   /fleet/vehicles (+/:id)   fleetVehicle.view            FW-3 / FW-4
//   /fleet/drivers            fleetDriver.view             FW-5
//   /fleet/attendance         fleetAvailability.view       FW-5
//   /fleet/odometer           fleetOdometer.view           FW-6
//   /fleet/maintenance        fleetMaintenance.view        FW-6
//   /fleet/maintenance-alarms fleetOdometer.view           FW-6
//   /fleet/roster             fleetRoster.view             FW-7
//   /fleet/accidents          fleetAccident.view           FW-8
//   /fleet/violations         fleetViolation.view          FW-9
//   /fleet/catalogs           fleetCatalog.manage          FW-10
//   /fleet/settings           fleetMaintenanceRule.manage  FW-10
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../platform/layout/AppShell';
import { FleetDashboardPage } from './pages/FleetDashboardPage';
import { VehiclesListPage } from './pages/VehiclesListPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';

export default function FleetRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<FleetDashboardPage />} />
        <Route
          path="vehicles"
          element={
            <RequirePermission permission="fleetVehicle.view">
              <VehiclesListPage />
            </RequirePermission>
          }
        />
        <Route
          path="vehicles/:id"
          element={
            <RequirePermission permission="fleetVehicle.view">
              <VehicleDetailPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
