// System Administration route subtree (lazy-loaded as one chunk — route-based code splitting per
// Software Architecture §6). Default export so React.lazy can import it.
//
// Every screen is permission-gated with the permission its API already enforces; the guard is the
// second layer, never the only one. `/system` itself redirects into the first section rather than
// rendering a landing page: with one section there is nothing for a landing page to choose between,
// and an index that lists exactly one link is a click that does nothing.
//
// This slice ships users, roles and the permission registry. Appearance and settings are later
// phases, and the owner rule carried from the Fleet FW-1 review holds here too: no unshipped
// surface is reachable, so nothing routes to them and nothing links to them.
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { SystemAdminLayout } from './SystemAdminLayout';
import { UsersListPage } from './users/pages/UsersListPage';
import { UserDetailPage } from './users/pages/UserDetailPage';
import { RolesListPage } from './roles/pages/RolesListPage';
import { RoleDetailPage } from './roles/pages/RoleDetailPage';
import { PermissionCatalogPage } from './roles/pages/PermissionCatalogPage';

export default function SystemAdminRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<SystemAdminLayout />}>
        <Route index element={<Navigate to="users" replace />} />

        <Route
          path="users"
          element={
            <RequirePermission permission="user.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<UsersListPage />} />
          <Route path=":id" element={<UserDetailPage />} />
        </Route>

        <Route
          path="roles"
          element={
            <RequirePermission permission="role.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<RolesListPage />} />
          <Route path=":id" element={<RoleDetailPage />} />
        </Route>

        {/* The registry is read-only and gated by its own permission — an administrator may be
            allowed to see what a key means without being allowed to see who holds it. */}
        <Route
          path="permissions"
          element={
            <RequirePermission permission="permission.view">
              <PermissionCatalogPage />
            </RequirePermission>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
