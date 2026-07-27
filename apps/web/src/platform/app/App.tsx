// App root: session bootstrap (silent refresh + /auth/me), locale/direction sync, and the top
// route split — /login vs the authenticated recruitment module (lazy-loaded for code splitting).
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppDispatch, useAppSelector } from '../../store';
import { signedIn, signedOut } from '../../store/authSlice';
import { bootstrapSession } from '../auth/api';
import { LoginPage } from '../auth/LoginPage';
import { ActivationPage } from '../auth/ActivationPage';
import { RequireAuth } from '../router/RequireAuth';
import { LoadingState } from '../../shared/ui/states/LoadingState';
import { registerRecruitmentNavProviders } from '../../modules/hr/recruitment/counters/register-nav-providers';

// The sidebar renders on EVERY authenticated page, so the recruitment stage menus and their live
// counters must be registered eagerly. Registering them from inside the lazy recruitment chunk
// left the badges — and the Employees Ready row — missing until the user happened to open a
// recruitment page. The registry itself is a few lines; the counters query is shared.
registerRecruitmentNavProviders();

const RecruitmentRoutes = lazy(() => import('../../modules/hr/recruitment/routes'));
const EmployeeManagementRoutes = lazy(() => import('../../modules/hr/employee-management/routes'));
const EmployeeFilesRoutes = lazy(() => import('../../modules/hr/employee-management/files-routes'));
const OrganizationRoutes = lazy(() => import('../../modules/organization/routes'));
const LeaveManagementRoutes = lazy(() => import('../../modules/hr/leave-management/routes'));
const ContractsRoutes = lazy(() => import('../../modules/hr/contracts/routes'));
const VerifyContractPage = lazy(() => import('../../modules/hr/contracts/pages/VerifyContractPage'));
const AccountRoutes = lazy(() => import('../account/routes'));

const useDirection = (): void => {
  const { locale, dir } = useAppSelector((state) => state.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);
};

// Subpath deployments: the router mirrors Vite's base (BASE_URL is '/' at the root).
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

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
    <BrowserRouter basename={BASENAME}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/activate" element={<ActivationPage />} />
        {/* A23 — public document verification (the PDF QR's target). */}
        <Route
          path="/verify/contract"
          element={
            <Suspense fallback={<div className="grid min-h-screen place-items-center"><LoadingState /></div>}>
              <VerifyContractPage />
            </Suspense>
          }
        />
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
          path="/leave/*"
          element={
            <RequireAuth>
              <Suspense fallback={<div className="grid min-h-screen place-items-center"><LoadingState /></div>}>
                <LeaveManagementRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/contracts/*"
          element={
            <RequireAuth>
              <Suspense fallback={<div className="grid min-h-screen place-items-center"><LoadingState /></div>}>
                <ContractsRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/account/security"
          element={
            <RequireAuth>
              <Suspense fallback={<div className="grid min-h-screen place-items-center"><LoadingState /></div>}>
                <AccountRoutes />
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
