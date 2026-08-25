// Notification rules route subtree (lazy-loaded).
//
// Gated by `notificationRule.view` rather than `manage`, so somebody who may only READ the rules
// can open the screen and see what the system is set to say. The editor's own actions are refused
// by the server for anyone without `manage` at organization scope — the screen renders, the save
// does not.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { NotificationRulesPage } from './pages/NotificationRulesPage';

export default function NotificationRuleRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <RequirePermission permission="notificationRule.view">
              <NotificationRulesPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
