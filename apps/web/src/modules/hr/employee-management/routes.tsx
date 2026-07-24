// Employee Management route subtree (lazy-loaded — route-based code splitting per Software
// Architecture §6). The registry that outlives the recruitment pipeline (frozen design):
// list → profile hub (tabs + personnel actions), hire-from-offer, Direct Registration (D4).
// Employee Files mount separately (files-routes.tsx) — same module, own sidebar app.
// Default export so React.lazy can import it.
import { Outlet, Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { EmployeesListPage } from './employees/pages/EmployeesListPage';
import { EmployeeProfilePage } from './employees/pages/EmployeeProfilePage';
import { EmployeeCreatePage } from './employees/pages/EmployeeCreatePage';
import { DirectRegisterPage } from './employees/pages/DirectRegisterPage';

export default function EmployeeManagementRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          element={
            <RequirePermission permission="employee.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<EmployeesListPage />} />
          <Route
            path="new"
            element={
              <RequirePermission permission="employee.create">
                <EmployeeCreatePage />
              </RequirePermission>
            }
          />
          <Route
            path="register"
            element={
              <RequirePermission permission="employee.registerDirect">
                <DirectRegisterPage />
              </RequirePermission>
            }
          />
          <Route path=":id" element={<EmployeeProfilePage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
