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
import { MyProfilePage } from './employees/pages/MyProfilePage';
import { EmployeeCreatePage } from './employees/pages/EmployeeCreatePage';
import { EmployeesReadyPage } from './employees/pages/EmployeesReadyPage';
import { DirectRegisterPage } from './employees/pages/DirectRegisterPage';

export default function EmployeeManagementRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/*
          MY OWN FILE — OUTSIDE the `employee.view` guard, deliberately.
          
          Everything below this line is the administrator's registry, and `employee.view` is the
          key that opens it: holding it means seeing OTHER PEOPLE. An employee has no business
          holding that to read their own file, and the server agrees — `/hr/employees/me` takes the
          id from the token and authorizes nothing, because there is no id the caller could have
          chosen. There is no `:id` in this path either, so it cannot be pointed at anyone else.
        */}
        <Route path="me" element={<MyProfilePage />} />
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
          {/* A6/RW15 — accepted offers not yet converted into an Employee. */}
          <Route
            path="ready"
            element={
              <RequirePermission permission="employee.create">
                <EmployeesReadyPage />
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
