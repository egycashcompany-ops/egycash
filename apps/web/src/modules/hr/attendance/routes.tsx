// Attendance route subtree (lazy-loaded). Every administrative surface is gated by the same key
// its server route checks; My Attendance is the one exception, and for the same reason My Leave
// is: it needs an authenticated employee login, not a permission — the endpoints behind it are
// own-scope by construction (the ESS role carries attendance.view/requestRegularization at `own`).
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { ShiftsPage } from './pages/ShiftsPage';
import { AssignmentsPage } from './pages/AssignmentsPage';
import { DailySheetPage } from './pages/DailySheetPage';
import { DeviceHealthPage } from './pages/DeviceHealthPage';
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
        {/*
          AT-D4. Behind `attendanceDevice.view` — the key that now names this page in the registry,
          after sitting deliberately page-less since AT-D1. The manage-only actions inside it are
          hidden rather than disabled, which is this product's rule for a control a reader may not
          use: a disabled button still says «this is for you» and then refuses.
        */}
        <Route
          path="devices"
          element={
            <RequirePermission permission="attendanceDevice.view">
              <DeviceHealthPage />
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
        {/* «ساعات العمل» is a tab of «الإعدادات» now; the old address goes there. */}
        <Route path="working-hours" element={<Navigate to="/hr-settings/working-hours" replace />} />
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
