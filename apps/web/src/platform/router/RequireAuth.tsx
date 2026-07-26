// Auth route guard: holds render while the session bootstrap is still resolving (`unknown`),
// then either renders the protected subtree or redirects to /login. The server is the real
// authority; this only shapes navigation. FIRST-LOGIN GATE (auth design 4.2): while the
// account is flagged `mustChangePassword`, every protected route renders the change screen
// instead — the API enforces the same rule server-side.
import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppSelector } from '../../store';
import { ForcePasswordChangePage } from '../auth/ForcePasswordChangePage';

export const RequireAuth = ({ children }: { children: ReactNode }): ReactNode => {
  const status = useAppSelector((state) => state.auth.status);
  const mustChange = useAppSelector((state) => state.auth.me?.mustChangePassword ?? false);
  if (status === 'unknown') return null;
  if (status !== 'signedIn') return <Navigate to="/login" replace />;
  if (mustChange) return <ForcePasswordChangePage />;
  return children;
};
