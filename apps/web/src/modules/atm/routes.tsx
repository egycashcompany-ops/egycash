// ATM module route subtree, lazy-loaded as one chunk from App.tsx — the same route-based code
// splitting every module uses.
//
// OWNER RULE (inherited from Fleet FW-1): no placeholder surface is ever reachable. Every route
// here shipped with its screen in the ATM Operations port. Live routes, each behind its
// permission (port doc §7.2):
//   /atm/replenishments        atmReplenishment.view   (legacy /atm_replenishment)
//   /atm/replenishments/done   atmReplenishment.view   (legacy /atm_replenishment_done)
//   /atm/maintenance           atmMaintenance.view     (legacy /atm_maintenance)
//   /atm/maintenance/done      atmMaintenance.view     (legacy /atm_maintenance_done)
//   /atm/mail-tickets          atmMailTicket.view      (legacy /mail_maintenance)
//   /atm/mail-tickets/log      atmMailTicket.viewLog   (legacy /mail_maintenance_log)
//   /atm/machines              atmMachine.view         (legacy /all_atm)
//   /atm/data-edit             any of atmRefLabel.create, atmRefLabel.edit, atmMachine.moveArea,
//                              atmMachine.manage       (legacy /data_edit_atm — Operations keep the
//                              lists and the area move, the machine master stays `manage`; each
//                              action on the page is gated again by its own key)
//   /atm/reports/daily         atmReplenishment.view   (legacy /reports_atm)
//
// The efficiency register (docs/12-planning/atm-efficiency-register.md §8.1) — no legacy screen;
// its source is the owner's workbook `Comprehensive ATMs report` (sheets `ATMs`, `Data Report`):
//   /atm/register              atmRegister.view        (sheet ATMs)
//   /atm/register/report       atmRegisterReport.view  (sheet Data Report)
//   /atm/register/import       atmRegister.import      (the one-time workbook import + settings)
// The three register screens are built on the feature branch by their own work packages and
// release together with these routes — the owner rule above holds at release, not per commit.
//
// The machine map (docs/12-planning/atm-map-zones.md §8.1) — no legacy screen:
//   /atm/map                   atmMap.view             (the map, and its zone edit mode)
//   /atm/map/unlocated         atmMap.view + atmMachine.locate (machines without a location)
//
// Settlements & Review → Preparation → Control & Supplies, phase 1 (docs/12-planning/
// atm-settlements-phase1.md §9.1) — no legacy screen; the source is the banks' daily Master
// workbooks (sheets `REP. TAPE`, `Print`, `بيان التغذية`, `سيلزات`):
//   /atm/settlements/plans           atmSettlementPlan.view   (the day's plan, its papers)
//   /atm/settlements/layouts         atmCassetteLayout.view   (each machine's cassettes)
//   /atm/settlements/layouts/import  atmCassetteLayout.import (the bank's Full list seed import)
//   /atm/preparation                 atmPreparation.view      (bag QRs and cassette seals)
//   /atm/control                     atmControl.view          (the handover, the crew lines)
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../platform/layout/AppShell';
import { AtmOverviewPage } from './pages/AtmOverviewPage';
import { ReplenishmentsPage } from './pages/ReplenishmentsPage';
import { ReplenishmentsDonePage } from './pages/ReplenishmentsDonePage';
import { MaintenancePage } from './pages/MaintenancePage';
import { MaintenanceDonePage } from './pages/MaintenanceDonePage';
import { MailTicketsPage } from './pages/MailTicketsPage';
import { MailLogPage } from './pages/MailLogPage';
import { MachinesPage } from './pages/MachinesPage';
import { DataEditPage } from './pages/DataEditPage';
import { DailyReportPage } from './pages/DailyReportPage';
import { RegisterPage } from './pages/RegisterPage';
import { RegisterReportPage } from './pages/RegisterReportPage';
import { RegisterImportPage } from './pages/RegisterImportPage';
import { MachineMapPage } from './pages/MachineMapPage';
import { UnlocatedMachinesPage } from './pages/UnlocatedMachinesPage';
import { SettlementPlanPage } from './pages/SettlementPlanPage';
import { CassetteLayoutsPage } from './pages/CassetteLayoutsPage';
import { LayoutImportPage } from './pages/LayoutImportPage';
import { PreparationPage } from './pages/PreparationPage';
import { ControlPage } from './pages/ControlPage';

/** Every key that leads to the data-edit page (spec §7.3) — the route guard is any-of. */
const DATA_EDIT_KEYS = [
  'atmRefLabel.create',
  'atmRefLabel.edit',
  'atmMachine.moveArea',
  'atmMachine.manage',
] as const;

export default function AtmRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<AtmOverviewPage />} />
        <Route
          path="replenishments"
          element={
            <RequirePermission permission="atmReplenishment.view">
              <ReplenishmentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="replenishments/done"
          element={
            <RequirePermission permission="atmReplenishment.view">
              <ReplenishmentsDonePage />
            </RequirePermission>
          }
        />
        <Route
          path="maintenance"
          element={
            <RequirePermission permission="atmMaintenance.view">
              <MaintenancePage />
            </RequirePermission>
          }
        />
        <Route
          path="maintenance/done"
          element={
            <RequirePermission permission="atmMaintenance.view">
              <MaintenanceDonePage />
            </RequirePermission>
          }
        />
        <Route
          path="mail-tickets"
          element={
            <RequirePermission permission="atmMailTicket.view">
              <MailTicketsPage />
            </RequirePermission>
          }
        />
        <Route
          path="mail-tickets/log"
          element={
            <RequirePermission permission="atmMailTicket.viewLog">
              <MailLogPage />
            </RequirePermission>
          }
        />
        <Route
          path="machines"
          element={
            <RequirePermission permission="atmMachine.view">
              <MachinesPage />
            </RequirePermission>
          }
        />
        <Route
          path="map"
          element={
            <RequirePermission permission="atmMap.view">
              <MachineMapPage />
            </RequirePermission>
          }
        />
        {/* Both keys: the screen returns coordinates and counts of the map (`atmMap.view`) and
            every action on it places a pin (`atmMachine.locate`). The guard takes one key or
            any-of, so the two are nested. */}
        <Route
          path="map/unlocated"
          element={
            <RequirePermission permission="atmMap.view">
              <RequirePermission permission="atmMachine.locate">
                <UnlocatedMachinesPage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="data-edit"
          element={
            <RequirePermission anyOf={DATA_EDIT_KEYS}>
              <DataEditPage />
            </RequirePermission>
          }
        />
        <Route
          path="reports/daily"
          element={
            <RequirePermission permission="atmReplenishment.view">
              <DailyReportPage />
            </RequirePermission>
          }
        />
        <Route
          path="register"
          element={
            <RequirePermission permission="atmRegister.view">
              <RegisterPage />
            </RequirePermission>
          }
        />
        <Route
          path="register/report"
          element={
            <RequirePermission permission="atmRegisterReport.view">
              <RegisterReportPage />
            </RequirePermission>
          }
        />
        <Route
          path="register/import"
          element={
            <RequirePermission permission="atmRegister.import">
              <RegisterImportPage />
            </RequirePermission>
          }
        />
        <Route
          path="settlements/plans"
          element={
            <RequirePermission permission="atmSettlementPlan.view">
              <SettlementPlanPage />
            </RequirePermission>
          }
        />
        <Route
          path="settlements/layouts"
          element={
            <RequirePermission permission="atmCassetteLayout.view">
              <CassetteLayoutsPage />
            </RequirePermission>
          }
        />
        <Route
          path="settlements/layouts/import"
          element={
            <RequirePermission permission="atmCassetteLayout.import">
              <LayoutImportPage />
            </RequirePermission>
          }
        />
        <Route
          path="preparation"
          element={
            <RequirePermission permission="atmPreparation.view">
              <PreparationPage />
            </RequirePermission>
          }
        />
        <Route
          path="control"
          element={
            <RequirePermission permission="atmControl.view">
              <ControlPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
