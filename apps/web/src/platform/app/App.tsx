// App root: session bootstrap (silent refresh + /auth/me), locale/direction sync, and the top
// route split — /login vs the authenticated recruitment module (lazy-loaded for code splitting).
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppDispatch, useAppSelector } from '../../store';
import { signedIn, signedOut } from '../../store/authSlice';
import { bootstrapSession } from '../auth/api';
import { LoginPage } from '../auth/LoginPage';
import { RequireAuth } from '../router/RequireAuth';
import { LoadingState } from '../../shared/ui/states/LoadingState';

const RecruitmentRoutes = lazy(() => import('../../modules/hr/recruitment/routes'));
const EmployeeManagementRoutes = lazy(() => import('../../modules/hr/employee-management/routes'));
const EmployeeFilesRoutes = lazy(() => import('../../modules/hr/employee-management/files-routes'));
const OrganizationRoutes = lazy(() => import('../../modules/organization/routes'));

const useDirection = (): void => {
  const { locale, dir } = useAppSelector((state) => state.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);
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
          path="/organization/*"
          element={
            <RequireAuth>
              <Suspense fallback={<div className="grid min-h-screen place-items-center"><LoadingState /></div>}>
                <OrganizationRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/employees/*"
          element={
            <RequireAuth>
              <Suspense fallback={<div className="grid min-h-screen place-items-center"><LoadingState /></div>}>
                <EmployeeManagementRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/employee-files/*"
          element={
            <RequireAuth>
              <Suspense fallback={<div className="grid min-h-screen place-items-center"><LoadingState /></div>}>
                <EmployeeFilesRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <Suspense fallback={<div className="grid min-h-screen place-items-center"><LoadingState /></div>}>
                <RecruitmentRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};
