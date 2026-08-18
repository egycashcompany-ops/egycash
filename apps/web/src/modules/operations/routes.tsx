// Operations module route subtree, lazy-loaded as one chunk from App.tsx — the same route-based
// code splitting every module uses.
//
// OWNER RULE (inherited from Fleet FW-1): no placeholder surface is ever reachable by an end user.
// A screen is routed here in the SAME slice that ships it and joins the module home at the same
// moment; until then its URL falls through to the standard 404. Live routes, each behind its
// design §16.2 permission:
//   /operations/shipments  operationsShipment.view    B2  (legacy /main_ops)
//   /operations/crew-board    operationsCrew.view       B3  (legacy /tashghela)
//   /operations/requirements  operationsCrew.view       B3  (legacy /requirement)
//   /operations/secured       operationsShipment.view   B4  (legacy /mohsana)
//   /operations/vault/receive operationsVault.view      B4  (legacy /receive_mohsana)
//   /operations/vault/dispatch operationsVault.view     B4  (legacy /deliver_mohsana + /tash4ela_mohasana)
//   /operations/vault         operationsVault.view      B4  (legacy /vault1)
//   /operations/reports/captains operationsShipment.view B5 (legacy /ops_report)
//   /operations/reports/banks    operationsShipment.view B5 (legacy /ops_bank_report)
//   /operations/attendance    operationsCrew.view + attendance.view  B5  (NO legacy equivalent)
//   /operations/catalogs   operationsCatalog.manage   B1  (legacy /data_edit)
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../platform/layout/AppShell';
import { OperationsOverviewPage } from './pages/OperationsOverviewPage';
import { CatalogsPage } from './pages/CatalogsPage';
import { DailyOperationsPage } from './pages/DailyOperationsPage';
import { CrewBoardPage } from './pages/CrewBoardPage';
import { RequirementsPage } from './pages/RequirementsPage';
import { SecuredBacklogPage } from './pages/SecuredBacklogPage';
import { SecuredDispatchPage } from './pages/SecuredDispatchPage';
import { VaultInventoryPage } from './pages/VaultInventoryPage';
import { VaultReceivePage } from './pages/VaultReceivePage';
import { CaptainReportPage } from './pages/CaptainReportPage';
import { BankReportPage } from './pages/BankReportPage';
import { CrewAttendancePage } from './pages/CrewAttendancePage';

export default function OperationsRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OperationsOverviewPage />} />
        <Route
          path="shipments"
          element={
            <RequirePermission permission="operationsShipment.view">
              <DailyOperationsPage />
            </RequirePermission>
          }
        />
        <Route
          path="crew-board"
          element={
            <RequirePermission permission="operationsCrew.view">
              <CrewBoardPage />
            </RequirePermission>
          }
        />
        <Route
          path="requirements"
          element={
            <RequirePermission permission="operationsCrew.view">
              <RequirementsPage />
            </RequirePermission>
          }
        />
        <Route
          path="secured"
          element={
            <RequirePermission permission="operationsShipment.view">
              <SecuredBacklogPage />
            </RequirePermission>
          }
        />
        <Route
          path="vault/receive"
          element={
            <RequirePermission permission="operationsVault.view">
              <VaultReceivePage />
            </RequirePermission>
          }
        />
        <Route
          path="vault/dispatch"
          element={
            <RequirePermission permission="operationsVault.view">
              <SecuredDispatchPage />
            </RequirePermission>
          }
        />
        <Route
          path="vault"
          element={
            <RequirePermission permission="operationsVault.view">
              <VaultInventoryPage />
            </RequirePermission>
          }
        />
        <Route
          path="reports/captains"
          element={
            <RequirePermission permission="operationsShipment.view">
              <CaptainReportPage />
            </RequirePermission>
          }
        />
        <Route
          path="reports/banks"
          element={
            <RequirePermission permission="operationsShipment.view">
              <BankReportPage />
            </RequirePermission>
          }
        />
        {/* TWO grants, matching the endpoint: reading the roster is Operations', reading
            attendance is HR's, and this screen needs both. */}
        <Route
          path="attendance"
          element={
            <RequirePermission permission="operationsCrew.view">
              <RequirePermission permission="attendance.view">
                <CrewAttendancePage />
              </RequirePermission>
            </RequirePermission>
          }
        />
        <Route
          path="catalogs"
          element={
            <RequirePermission permission="operationsCatalog.manage">
              <CatalogsPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
