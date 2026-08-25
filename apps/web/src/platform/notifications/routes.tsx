// Notifications inbox route subtree (lazy-loaded).
//
// No permission guard, deliberately. Every account has an inbox and it holds only what was sent to
// THAT account — the server scopes every read to the caller. A permission here would be a key
// somebody could fail to hold for their own messages.
import { Route, Routes } from 'react-router-dom';
import { NotFoundPage } from '../app/pages/NotFoundPage';
import { AppShell } from '../layout/AppShell';
import { NotificationsInboxPage } from './pages/NotificationsInboxPage';

export default function NotificationRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<NotificationsInboxPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
