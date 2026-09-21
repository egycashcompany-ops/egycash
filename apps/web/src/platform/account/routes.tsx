// Account area (self-service): Security (auth design §6.3), Preferences (P9-B) and «صلاحياتي».
//
// No page here carries a permission and none appears in the page registry — the registry describes
// ADMINISTRATION screens, and these are about the caller's own account, which every session already
// owns. That is why they hang off the user menu rather than the navigation catalog.
//
// «صلاحياتي» belongs to this set for exactly that reason, and it is the case that proves the rule:
// a `RequirePermission` around it would be a gate that the people who most need the page — the ones
// with almost nothing — would be the first to fail. It is safe ungated because the endpoint behind
// it takes no id and can only answer for the caller.
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../layout/AppShell';
import SecurityPage from './SecurityPage';
import PreferencesPage from './PreferencesPage';
import MyPermissionsPage from './MyPermissionsPage';

export default function AccountRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="security" element={<SecurityPage />} />
        <Route path="preferences" element={<PreferencesPage />} />
        <Route path="permissions" element={<MyPermissionsPage />} />
        {/* `/account` alone kept its old destination — the page it resolved to before this
            router had a second one. */}
        <Route index element={<Navigate to="security" replace />} />
      </Route>
    </Routes>
  );
}
