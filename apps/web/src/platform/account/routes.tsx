// Account area (self-service): Security (auth design §6.3) and Preferences (P9-B).
//
// Neither page carries a permission and neither appears in the page registry — the registry
// describes ADMINISTRATION screens, and these two are about the caller's own account, which every
// session already owns. That is why they hang off the user menu rather than the navigation
// catalog.
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../layout/AppShell';
import SecurityPage from './SecurityPage';
import PreferencesPage from './PreferencesPage';

export default function AccountRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="security" element={<SecurityPage />} />
        <Route path="preferences" element={<PreferencesPage />} />
        {/* `/account` alone kept its old destination — the page it resolved to before this
            router had a second one. */}
        <Route index element={<Navigate to="security" replace />} />
      </Route>
    </Routes>
  );
}
