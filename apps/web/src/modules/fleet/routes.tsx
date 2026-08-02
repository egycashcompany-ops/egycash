// Fleet module route subtree, lazy-loaded as one chunk from App.tsx — the same route-based
// code splitting every module uses.
//
// OWNER RULE (FW-1 review): no placeholder surface is ever reachable by an end user. A screen
// is routed here in the SAME slice that ships it, and joins the navigation catalog at the same
// moment; until then its URL falls through to the standard 404. With FW-10 the frozen IA is
// COMPLETE — every route below is live, each behind its §7 permission:
//   /fleet/vehicles (+/:id)   fleetVehicle.view            FW-3 / FW-4
//   /fleet/drivers (+/:id)    fleetDriver.view             FW-5
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
import { DriversListPage } from './pages/DriversListPage';
import { DriverProfilePage } from './pages/DriverProfilePage';
import { AttendancePage } from './pages/AttendancePage';
import { OdometerPage } from './pages/OdometerPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { MaintenanceAlarmsPage } from './pages/MaintenanceAlarmsPage';
import { RosterPage } from './pages/RosterPage';
import { AccidentsPage } from './pages/AccidentsPage';
import { ViolationsPage } from './pages/ViolationsPage';
import { CatalogsPage } from './pages/CatalogsPage';
import { FleetSettingsPage } from './pages/FleetSettingsPage';

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
        <Route
          path="drivers"
          element={
            <RequirePermission permission="fleetDriver.view">
              <DriversListPage />
            </RequirePermission>
          }
        />
        <Route
          path="drivers/:id"
          element={
            <RequirePermission permission="fleetDriver.view">
              <DriverProfilePage />
            </RequirePermission>
          }
        />
        <Route
          path="attendance"
          element={
            <RequirePermission permission="fleetAvailability.view">
              <AttendancePage />
            </RequirePermission>
          }
        />
        <Route
          path="odometer"
          element={
            <RequirePermission permission="fleetOdometer.view">
              <OdometerPage />
            </RequirePermission>
          }
        />
        <Route
          path="maintenance"
          element={
            <RequirePermission permission="fleetMaintenance.view">
              <MaintenancePage />
            </RequirePermission>
          }
        />
        <Route
          path="maintenance-alarms"
          element={
            <RequirePermission permission="fleetOdometer.view">
              <MaintenanceAlarmsPage />
            </RequirePermission>
          }
        />
        <Route
          path="roster"
          element={
            <RequirePermission permission="fleetRoster.view">
              <RosterPage />
            </RequirePermission>
          }
        />
        <Route
          path="accidents"
          element={
            <RequirePermission permission="fleetAccident.view">
              <AccidentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="violations"
          element={
            <RequirePermission permission="fleetViolation.view">
              <ViolationsPage />
            </RequirePermission>
          }
        />
        <Route
          path="catalogs"
          element={
            <RequirePermission permission="fleetCatalog.manage">
              <CatalogsPage />
            </RequirePermission>
          }
        />
        <Route
          path="settings"
          element={
            <RequirePermission permission="fleetMaintenanceRule.manage">
              <FleetSettingsPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
