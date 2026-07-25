// Account area (self-service): currently only the Security page (auth design §6.3).
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '../layout/AppShell';
import SecurityPage from './SecurityPage';

export default function AccountRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<SecurityPage />} />
      </Route>
    </Routes>
  );
}
