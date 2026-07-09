import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppDispatch, useAppSelector } from '../../store';
import { signedIn, signedOut } from '../../store/authSlice';
import { bootstrapSession } from '../auth/api';
import { LoginPage } from '../auth/LoginPage';
import { Shell } from '../layout/Shell';

const useDirection = (): void => {
  const { locale, dir } = useAppSelector((state) => state.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);
};

const Protected = ({ children }: { children: JSX.Element }): JSX.Element => {
  const status = useAppSelector((state) => state.auth.status);
  if (status === 'unknown') return <></>;
  return status === 'signedIn' ? children : <Navigate to="/login" replace />;
};

export const App = (): JSX.Element => {
  useDirection();
  const dispatch = useAppDispatch();
  const status = useAppSelector((state) => state.auth.status);

  // Session bootstrap: silent refresh + /auth/me (permissions + flags).
  const { data, isFetched } = useQuery({
    queryKey: ['platform', 'auth', 'bootstrap'],
    queryFn: bootstrapSession,
    enabled: status === 'unknown',
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (status !== 'unknown' || !isFetched) return;
    if (data !== undefined && data !== null) dispatch(signedIn(data));
    else dispatch(signedOut());
  }, [status, isFetched, data, dispatch]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <Protected>
              <Shell />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
