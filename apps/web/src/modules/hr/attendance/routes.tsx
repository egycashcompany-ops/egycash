// Attendance route subtree (lazy-loaded). Every administrative surface is gated by the same key
// its server route checks; My Attendance is the one exception, and for the same reason My Leave
// is: it needs an authenticated employee login, not a permission — the endpoints behind it are
// own-scope by construction (the ESS role carries attendance.view/requestRegularization at `own`).
import { Outlet, Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { ShiftsPage } from './pages/ShiftsPage';
import { AssignmentsPage } from './pages/AssignmentsPage';
import { DailySheetPage } from './pages/DailySheetPage';
import { EmployeeMonthPage } from './pages/EmployeeMonthPage';
import { MyAttendancePage } from './pages/MyAttendancePage';
import { RegularizationQueuePage } from './pages/RegularizationQueuePage';

export default function AttendanceRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<MyAttendancePage />} />
        <Route path="me" element={<MyAttendancePage />} />
        <Route
          element={
            <RequirePermission permission="attendance.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route path="daily" element={<DailySheetPage />} />
          <Route path="employees/:id" element={<EmployeeMonthPage />} />
        </Route>
        <Route
          path="regularizations"
          element={
            <RequirePermission permission="attendance.decideRegularization">
              <RegularizationQueuePage />
            </RequirePermission>
          }
        />
        <Route
          path="shifts"
          element={
            <RequirePermission permission="attendance.manageShifts">
              <ShiftsPage />
            </RequirePermission>
          }
        />
        <Route
          path="assignments"
          element={
            <RequirePermission permission="attendance.assign">
              <AssignmentsPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
