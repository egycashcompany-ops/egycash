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
//   /fleet/fixed-roster       fleetRoster.view             FW-7
//   /fleet/accidents          fleetAccident.view           FW-8
//   /fleet/violations         fleetViolation.view          FW-9
//   /fleet/licensing          fleetLicensing.view          التراخيص
//   /fleet/notices (+/:tpl)   fleetNotice.view             الإخطارات
//   /fleet/notices/setup/:tpl fleetNotice.view             إعداد النماذج
//   /fleet/dealership         fleetDealership.view         التوكيل
//   /fleet/fuel-cards         fleetFuelCard.view           بطاقات الوقود
//   /fleet/fuel-cards/charging fleetFuelCharge.view        شحن الكروت
//   /fleet/receipts           fleetReceipt.view            خصم الإيصالات
//   /fleet/custody            fleetCustody.view            العهدة
//   /fleet/catalogs           fleetCatalog.manage          FW-10
//   /fleet/settings           fleetMaintenanceRule.manage  FW-10
import { Route, Routes } from 'react-router-dom';
import { FilterResetStyleContext } from '../../shared/ui/FilterBar';
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
import { FixedRosterPage } from './pages/FixedRosterPage';
import { AccidentsPage } from './pages/AccidentsPage';
import { ViolationsPage } from './pages/ViolationsPage';
import { LicensingPage } from './pages/LicensingPage';
import { NoticesPage } from './pages/NoticesPage';
import { NoticeEditorPage } from './pages/NoticeEditorPage';
import { NoticeSetupPage } from './pages/NoticeSetupPage';
import { DealershipPage } from './pages/DealershipPage';
import { FuelCardsPage } from './pages/FuelCardsPage';
import { FuelChargingPage } from './pages/FuelChargingPage';
import { ReceiptsPage } from './pages/ReceiptsPage';
import { CustodyPage } from './pages/CustodyPage';
import { CatalogsPage } from './pages/CatalogsPage';
import { FleetSettingsPage } from './pages/FleetSettingsPage';

// «زرار ريست … يكون لونه احمر ويكون قبل رقم الفلاتر … يظهر لو عامل فلتر» — every Fleet filter bar's
// reset is red, and shows once a filter is set.
const FLEET_RESET = { tone: 'red', always: false } as const;

export default function FleetRoutes(): JSX.Element {
  return (
    <FilterResetStyleContext.Provider value={FLEET_RESET}>
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
            path="fixed-roster"
            element={
              <RequirePermission permission="fleetRoster.view">
                <FixedRosterPage />
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
            path="licensing"
            element={
              <RequirePermission permission="fleetLicensing.view">
                <LicensingPage />
              </RequirePermission>
            }
          />
          <Route
            path="notices"
            element={
              <RequirePermission permission="fleetNotice.view">
                <NoticesPage />
              </RequirePermission>
            }
          />
          <Route
            path="dealership"
            element={
              <RequirePermission permission="fleetDealership.view">
                <DealershipPage />
              </RequirePermission>
            }
          />
          <Route
            path="fuel-cards"
            element={
              <RequirePermission permission="fleetFuelCard.view">
                <FuelCardsPage />
              </RequirePermission>
            }
          />
          <Route
            path="fuel-cards/charging"
            element={
              <RequirePermission permission="fleetFuelCharge.view">
                <FuelChargingPage />
              </RequirePermission>
            }
          />
          <Route
            path="receipts"
            element={
              <RequirePermission permission="fleetReceipt.view">
                <ReceiptsPage />
              </RequirePermission>
            }
          />
          <Route
            path="custody"
            element={
              <RequirePermission permission="fleetCustody.view">
                <CustodyPage />
              </RequirePermission>
            }
          />
          <Route
            path="notices/setup/:template"
            element={
              <RequirePermission permission="fleetNotice.view">
                <NoticeSetupPage />
              </RequirePermission>
            }
          />
          <Route
            path="notices/:template"
            element={
              <RequirePermission permission="fleetNotice.view">
                <NoticeEditorPage />
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
    </FilterResetStyleContext.Provider>
  );
}
