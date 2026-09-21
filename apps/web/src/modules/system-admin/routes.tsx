// System Administration route subtree (lazy-loaded as one chunk — route-based code splitting per
// Software Architecture §6). Default export so React.lazy can import it.
//
// Every screen is permission-gated with the permission its API already enforces; the guard is the
// second layer, never the only one. `/system` itself redirects into the first section rather than
// rendering a landing page: with one section there is nothing for a landing page to choose between,
// and an index that lists exactly one link is a click that does nothing.
//
// This subtree ships users, roles, the permission registry, system settings (P8), the
// notification-template catalog (P10) and the two log streams (P11). Appearance and colour rules
// are later phases, and the owner rule carried from the Fleet FW-1 review holds for them: no
// unshipped surface is reachable, so nothing routes to them and nothing links to them.
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { SystemAdminLayout } from './SystemAdminLayout';
import { UsersListPage } from './users/pages/UsersListPage';
import { UserDetailPage } from './users/pages/UserDetailPage';
import { RolesListPage } from './roles/pages/RolesListPage';
import { RoleDetailPage } from './roles/pages/RoleDetailPage';
import { RoleEditorPage } from './roles/pages/RoleEditorPage';
import { PermissionCatalogPage } from './roles/pages/PermissionCatalogPage';
import { ApprovalWorkflowsPage } from './approvals/pages/ApprovalWorkflowsPage';
import { SettingsPage } from './settings/pages/SettingsPage';
import { TemplatesListPage } from './notification-templates/pages/TemplatesListPage';
import { TemplateDetailPage } from './notification-templates/pages/TemplateDetailPage';
import { AuditLogPage } from './audit/pages/AuditLogPage';
import { ActivityLogPage } from './audit/pages/ActivityLogPage';

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
          {/* Before `:id` — «new» is not a role id, and a router that met `:id` first would send
              the create page off to fetch a role called «new» and show «not found». */}
          <Route
            path="new"
            element={
              <RequirePermission permission="role.create">
                <RoleEditorPage />
              </RequirePermission>
            }
          />
          <Route path=":id" element={<RoleDetailPage />} />
          <Route
            path=":id/edit"
            element={
              <RequirePermission permission="role.edit">
                <RoleEditorPage />
              </RequirePermission>
            }
          />
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

        {/* Gap 2. One key for reading and writing a chain, deliberately: a chain is a map of who
            may decide what, and handing that out is handing out the org's decision structure. */}
        <Route
          path="approvals"
          element={
            <RequirePermission permission="approval.configure">
              <ApprovalWorkflowsPage />
            </RequirePermission>
          }
        />

        {/* P8. Gated on `setting.view`, which is what `GET /settings/definitions` enforces — the
            other half of the screen (`GET /settings/me`) needs only a session, so the stricter of
            the two is the one that decides whether the screen may open at all. */}
        <Route
          path="settings"
          element={
            <RequirePermission permission="setting.view">
              <SettingsPage />
            </RequirePermission>
          }
        />

        {/* P10. `notificationTemplate.view` is what every read on the screen enforces — the list,
            the single template, its versions and the preview. Editing and test-sending are
            separate keys, checked inside the screen and by the API. */}
        <Route
          path="notification-templates"
          element={
            <RequirePermission permission="notificationTemplate.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<TemplatesListPage />} />
          <Route path=":id" element={<TemplateDetailPage />} />
        </Route>

        {/* P11. Two routes, not one screen with tabs: the streams are separate collections behind
            separate grants, with different filter vocabularies and different retention. A shared
            surface would put both behind whichever permission the reader happened to hold. */}
        <Route
          path="audit"
          element={
            <RequirePermission permission="auditLog.view">
              <AuditLogPage />
            </RequirePermission>
          }
        />
        <Route
          path="activity"
          element={
            <RequirePermission permission="activityLog.view">
              <ActivityLogPage />
            </RequirePermission>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
