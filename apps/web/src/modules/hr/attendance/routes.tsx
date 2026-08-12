// Attendance route subtree (AT-1, lazy-loaded). Only the two admin surfaces ship in this phase:
// the daily sheet, the employee month, the regularization queue and the profile tab are AT-6 —
// no unshipped surface is reachable (the owner rule carried from Fleet FW-1).
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { ShiftsPage } from './pages/ShiftsPage';
import { AssignmentsPage } from './pages/AssignmentsPage';

export default function AttendanceRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
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
