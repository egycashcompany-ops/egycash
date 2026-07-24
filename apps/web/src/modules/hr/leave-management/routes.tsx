// Leave app route subtree (lazy-loaded). My Leave is the landing surface; approvals, the team
// calendar and the HR administration pages sit beside it (frozen design §11). Every surface
// except My Leave requires a permission; My Leave needs only an authenticated employee login
// (the ESS role provides leave.view/request at own scope — server-enforced).
import { Outlet, Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { MyLeavePage } from './pages/MyLeavePage';
import { ApprovalsInboxPage } from './pages/ApprovalsInboxPage';
import { TeamCalendarPage } from './pages/TeamCalendarPage';
import { AllRequestsPage } from './pages/AllRequestsPage';
import { LeaveRequestDetailPage } from './pages/LeaveRequestDetailPage';
import { LeaveTypesPage } from './pages/LeaveTypesPage';
import { HolidaysPage } from './pages/HolidaysPage';

export default function LeaveManagementRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<MyLeavePage />} />
        <Route path="approvals" element={<ApprovalsInboxPage />} />
        <Route path="requests/:id" element={<LeaveRequestDetailPage />} />
        <Route
          element={
            <RequirePermission permission="leave.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route path="calendar" element={<TeamCalendarPage />} />
          <Route path="requests" element={<AllRequestsPage />} />
        </Route>
        <Route
          path="types"
          element={
            <RequirePermission permission="leave.manageTypes">
              <LeaveTypesPage />
            </RequirePermission>
          }
        />
        <Route
          path="holidays"
          element={
            <RequirePermission permission="workCalendar.manage">
              <HolidaysPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
