// Auth route guard: holds render while the session bootstrap is still resolving (`unknown`),
// then either renders the protected subtree or redirects to /login. The server is the real
// authority; this only shapes navigation.
import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppSelector } from '../../store';

export const RequireAuth = ({ children }: { children: ReactNode }): ReactNode => {
  const status = useAppSelector((state) => state.auth.status);
  if (status === 'unknown') return null;
  return status === 'signedIn' ? children : <Navigate to="/login" replace />;
};
