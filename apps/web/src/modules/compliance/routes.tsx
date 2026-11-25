// Compliance and Risks route subtree «الالتزام والمخاطر», lazy-loaded as one chunk from App.tsx —
// the route-based code splitting every module uses. One screen so far, behind the two keys that
// open it (the same pair `SHARED_NAVIGATION_ROWS` opens its sidebar row with):
//   /compliance/files   complianceFile.manage or complianceFile.view
// `/compliance` itself lands on it: the module has nothing else to show yet. Creating and editing a
// folder, uploading, renaming and the seen report are dialogs on the screen, never routes.
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../platform/layout/AppShell';
import { COMPLIANCE_FILES_KEYS } from './lib/access';
import { ComplianceFilesPage } from './pages/ComplianceFilesPage';

export default function ComplianceRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="files" replace />} />
        <Route
          path="files"
          element={
            <RequirePermission anyOf={COMPLIANCE_FILES_KEYS}>
              <ComplianceFilesPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
