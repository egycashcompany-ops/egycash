// Operations module route subtree, lazy-loaded as one chunk from App.tsx — the same route-based
// code splitting every module uses.
//
// OWNER RULE (inherited from Fleet FW-1): no placeholder surface is ever reachable by an end user.
// A screen is routed here in the SAME slice that ships it and joins the module home at the same
// moment; until then its URL falls through to the standard 404. Live routes, each behind its
// design §16.2 permission:
//   /operations/shipments  operationsShipment.view    B2  (legacy /main_ops)
//   /operations/shipments/history  operationsShipment.view  (NO legacy equivalent — the day board
//                                  over a from–to range: «اعمل dublicat للشاشة دى بس التاريخ … من الى»;
//                                  daily shipments and محصنات alike: «تكون شحنات ومحصنات»)
//   /operations/crew-board    operationsCrew.view       B3  (legacy /tashghela)
//   /operations/requirements  operationsCrew.view       B3  (legacy /requirement)
//   /operations/crew-departments setting.edit           (Round 14 — «إدارات العمليات», a screen of its
//                                                       own: «شاشة لوحدها في القائمة»; the grant that
//                                                       writes the one setting it edits)
//   /operations/standing-crew operationsCrew.view       (NO legacy equivalent — الطاقم الثابت)
//   /operations/secured       operationsShipment.view   B4  (legacy /mohsana — every open محصنة, on the
//                                                       day board's own board with its delivery date
//                                                       and its stage: «شكلها يكون زى شاشة اليوم التشغيلى»)
//   /operations/secured/distribution operationsShipment.view  (Round 12 — «توزيع المحصنات»: the
//                                                       day's محصنات onto the day's vans; saving is
//                                                       `operationsShipment.edit`, on the server)
//   /operations/vault/receive operationsVault.view      B4  (legacy /receive_mohsana)
//   /operations/vault/handover operationsVault.view     (Round 12 — «تسليم المحصنات»: each van's load
//                                                       handed over; the act is `operationsVault.dispatch`)
//   /operations/vault/dispatch operationsVault.view     B4  (legacy /deliver_mohsana + /tash4ela_mohasana;
//                                                       Round 12: «محصنات الخزينة», view only)
//   /operations/vault         operationsVault.view      B4  (legacy /vault1; Round 12: «سجل الخزينة»)
//   /operations/reports/captains operationsShipment.view B5 (legacy /ops_report)
//   /operations/reports/banks    operationsShipment.view OR operationsVault.view  B6 (legacy
//                                /vault1_reports — Round 14: «خلي المحتوى بتاع تجميع خزينه ده يبقى
//                                اسمه تقرير بنوك»; `OPERATIONS_BANK_REPORT_KEYS`)
//   /operations/reports/vault    → redirects to /operations/reports/banks, query kept («تجميع
//                                الخزينة» is gone: «شيلها خالص»)
//   /operations/attendance    operationsCrew.view + attendance.view  B5  (NO legacy equivalent)
//   /operations/catalogs   operationsCatalog.manage   B1  (legacy /data_edit)
//   /operations/my-day     operationsExecution.own    C1  (NO legacy equivalent)
//   /operations/my-day/stops/:id  operationsExecution.own  C2  (NO legacy equivalent)
//
// `/operations/my-day` is the ONE route here that does not sit inside `AppShell`. It is the
// captain's phone surface, and a topbar, a navigation rail and a keyboard-shortcut command palette
// are console furniture that a 360px screen cannot afford. Same app, same session, same route
// guard — a different frame. See `mobile/CaptainShell.tsx`.
import { Route, Routes } from 'react-router-dom';
import { OPERATIONS_BANK_REPORT_KEYS } from '@ecms/contracts';
import { RedirectKeepingQuery } from '../../platform/router/RedirectKeepingQuery';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../platform/layout/AppShell';
import { OperationsOverviewPage } from './pages/OperationsOverviewPage';
import { CatalogsPage } from './pages/CatalogsPage';
import { DailyOperationsPage } from './pages/DailyOperationsPage';
import { ShipmentsHistoryPage } from './pages/ShipmentsHistoryPage';
import { CrewBoardPage } from './pages/CrewBoardPage';
import { RequirementsPage } from './pages/RequirementsPage';
import { StandingCrewPage } from './pages/StandingCrewPage';
import { SecuredBacklogPage } from './pages/SecuredBacklogPage';
import { SecuredDispatchPage } from './pages/SecuredDispatchPage';
import { SecuredDistributionPage } from './pages/SecuredDistributionPage';
import { VaultHandoverPage } from './pages/VaultHandoverPage';
import { VaultInventoryPage } from './pages/VaultInventoryPage';
import { VaultReceivePage } from './pages/VaultReceivePage';
import { CaptainReportPage } from './pages/CaptainReportPage';
import { BankReportPage } from './pages/BankReportPage';
import { CrewDepartmentsPage } from './pages/CrewDepartmentsPage';
import { CrewAttendancePage } from './pages/CrewAttendancePage';
import { CaptainDayPage } from './mobile/CaptainDayPage';
import { StopDetailPage } from './mobile/StopDetailPage';

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
        {/* The same grant as the day board: it is the same rows, over more days. */}
        <Route
          path="shipments/history"
          element={
            <RequirePermission permission="operationsShipment.view">
              <ShipmentsHistoryPage />
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
        {/* Round 14 — «إدارات العمليات» on a screen of its own («شاشة لوحدها في القائمة»), guarded by
            the grant that writes its one setting — what the card always required. */}
        <Route
          path="crew-departments"
          element={
            <RequirePermission permission="setting.edit">
              <CrewDepartmentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="standing-crew"
          element={
            <RequirePermission permission="operationsCrew.view">
              <StandingCrewPage />
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
        {/* Round 12 — the day's محصنات onto the day's vans, on the secured screen's own grant. */}
        <Route
          path="secured/distribution"
          element={
            <RequirePermission permission="operationsShipment.view">
              <SecuredDistributionPage />
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
        {/* Round 12 — the vault hands each van its load, on the vault screens' grant. */}
        <Route
          path="vault/handover"
          element={
            <RequirePermission permission="operationsVault.view">
              <VaultHandoverPage />
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
        {/* Round 14 — «تجميع الخزينة كشاشه مفيش حاجه اسمها تجميع خزينه، شيلها خالص». Its content is
            «تقرير البنوك» now, so a bookmark or an old link lands there with its period and its
            bank filter. Nothing to guard here: the page it lands on has its own. */}
        <Route
          path="reports/vault"
          element={<RedirectKeepingQuery to="/operations/reports/banks" />}
        />
        <Route
          path="reports/captains"
          element={
            <RequirePermission permission="operationsShipment.view">
              <CaptainReportPage />
            </RequirePermission>
          }
        />
        {/* «تقرير البنوك» — the screen «تجميع الخزينة» was, so whoever could open either opens it:
            the shipments' readers and the vault's (the endpoint checks the same list). */}
        <Route
          path="reports/banks"
          element={
            <RequirePermission anyOf={OPERATIONS_BANK_REPORT_KEYS}>
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
      </Route>

      {/*
        Outside the AppShell route element on purpose — see the header comment. The permission
        guard is identical to every page above it; only the chrome differs.
      */}
      <Route
        path="my-day"
        element={
          <RequirePermission permission="operationsExecution.own">
            <CaptainDayPage />
          </RequirePermission>
        }
      />
      <Route
        path="my-day/stops/:assignmentId"
        element={
          <RequirePermission permission="operationsExecution.own">
            <StopDetailPage />
          </RequirePermission>
        }
      />

      <Route element={<AppShell />}>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
