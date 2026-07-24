// Employee Files route subtree — the document archive of the Employee module (frozen design:
// the Electronic Employee File is permanent across employments; rehires supplement it).
// Mounted at /employee-files; default export so React.lazy can import it.
import { Outlet, Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { EmployeeFilesListPage } from './employee-files/pages/EmployeeFilesListPage';
import { EmployeeFileDetailPage } from './employee-files/pages/EmployeeFileDetailPage';

export default function EmployeeFilesRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          element={
            <RequirePermission permission="employeeFile.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<EmployeeFilesListPage />} />
          <Route path=":id" element={<EmployeeFileDetailPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
