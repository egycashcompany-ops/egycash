// Announcements route subtree (lazy-loaded).
//
// Gated by `announcement.send`, the same key the server checks on the compose and preview
// endpoints — a screen that renders for somebody the API will refuse is a 403 discovered after
// they wrote the message.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { ComposeAnnouncementPage } from './pages/ComposeAnnouncementPage';

export default function AnnouncementRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <RequirePermission permission="announcement.send">
              <ComposeAnnouncementPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
