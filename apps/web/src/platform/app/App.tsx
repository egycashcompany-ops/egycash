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
import { RealtimeProvider } from '../realtime/RealtimeProvider';
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
const AttendanceRoutes = lazy(() => import('../../modules/hr/attendance/routes'));
const PayrollRoutes = lazy(() => import('../../modules/hr/payroll/routes'));
const TrainingRoutes = lazy(() => import('../../modules/hr/training/routes'));
const ContractsRoutes = lazy(() => import('../../modules/hr/contracts/routes'));
const AnnouncementRoutes = lazy(() => import('../../modules/hr/announcements/routes'));
const NotificationRuleRoutes = lazy(() => import('../../modules/hr/notification-rules/routes'));
const FleetRoutes = lazy(() => import('../../modules/fleet/routes'));
const OperationsRoutes = lazy(() => import('../../modules/operations/routes'));
const AtmRoutes = lazy(() => import('../../modules/atm/routes'));
const ItRoutes = lazy(() => import('../../modules/it/routes'));
const GoldRoutes = lazy(() => import('../../modules/gold/routes'));
// The customer portal is a SEPARATE surface, not a page of the app: its own login, its own
// chrome, no sidebar. Neither route is wrapped in RequireAuth — that guard redirects to the
// STAFF login, which is not where a customer belongs.
const PortalLoginPage = lazy(async () => ({
  default: (await import('../../modules/gold/portal/PortalLoginPage')).PortalLoginPage,
}));
const GoldPortalRoutes = lazy(() => import('../../modules/gold/portal/routes'));
const SystemAdminRoutes = lazy(() => import('../../modules/system-admin/routes'));
const VerifyContractPage = lazy(
  () => import('../../modules/hr/contracts/pages/VerifyContractPage'),
);
const ApplicantPortalLoginPage = lazy(() =>
  import('../../modules/hr/recruitment/applicant-portal/ApplicantPortalLoginPage').then((m) => ({
    default: m.ApplicantPortalLoginPage,
  })),
);
const ApplicantPortalRoutes = lazy(
  () => import('../../modules/hr/recruitment/applicant-portal/routes'),
);
const PublicApplyPage = lazy(() =>
  import('../../modules/hr/recruitment/recruitment-form/pages/PublicApplyPage').then((m) => ({
    default: m.PublicApplyPage,
  })),
);
const AccountRoutes = lazy(() => import('../account/routes'));
const NotificationRoutes = lazy(() => import('../notifications/routes'));

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
      {/* Renders nothing — holds the realtime socket while a session is signed in (ADR-029). */}
      <RealtimeProvider />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/activate" element={<ActivationPage />} />
        {/* The per-source application link's target. No session: the token is the credential. */}
        <Route
          path="/apply/:token"
          element={
            <Suspense
              fallback={
                <div className="grid min-h-screen place-items-center">
                  <LoadingState />
                </div>
              }
            >
              <PublicApplyPage />
            </Suspense>
          }
        />
        {/* A23 — public document verification (the PDF QR's target). */}
        <Route
          path="/verify/contract"
          element={
            <Suspense
              fallback={
                <div className="grid min-h-screen place-items-center">
                  <LoadingState />
                </div>
              }
            >
              <VerifyContractPage />
            </Suspense>
          }
        />
        {/* بوابة العملاء — the vault's customers. Public in the same sense /login is: the guard is
            inside, and it sends an unauthenticated visitor to the PORTAL's login rather than the
            staff one. Declared here, above the catch-all, so `/portal/*` is never swallowed by it. */}
        <Route
          path="/portal/login"
          element={
            <Suspense
              fallback={
                <div className="grid min-h-screen place-items-center">
                  <LoadingState />
                </div>
              }
            >
              <PortalLoginPage />
            </Suspense>
          }
        />
        {/* بوابة المتقدمين — the candidates'. Public in the same sense /login is: the guard is
            inside, and it sends an unauthenticated visitor to the CANDIDATE's login rather than
            the staff one. Declared here, above the catch-all, for the same reason /portal is. */}
        <Route
          path="/applicant-portal/login"
          element={
            <Suspense
              fallback={
                <div className="grid min-h-screen place-items-center">
                  <LoadingState />
                </div>
              }
            >
              <ApplicantPortalLoginPage />
            </Suspense>
          }
        />
        <Route
          path="/applicant-portal/*"
          element={
            <Suspense
              fallback={
                <div className="grid min-h-screen place-items-center">
                  <LoadingState />
                </div>
              }
            >
              <ApplicantPortalRoutes />
            </Suspense>
          }
        />
        <Route
          path="/portal/*"
          element={
            <Suspense
              fallback={
                <div className="grid min-h-screen place-items-center">
                  <LoadingState />
                </div>
              }
            >
              <GoldPortalRoutes />
            </Suspense>
          }
        />
        <Route
          path="/organization/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <OrganizationRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/employees/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <EmployeeManagementRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/leave/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <LeaveManagementRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/announcements/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <AnnouncementRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/notification-rules/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <NotificationRuleRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        {/* The inbox a push lands on. Every account has one; the server scopes it to the caller. */}
        <Route
          path="/notifications/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <NotificationRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/attendance/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <AttendanceRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/payroll/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <PayrollRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/training/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <TrainingRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/contracts/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <ContractsRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/fleet/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <FleetRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/operations/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <OperationsRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/atm/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <AtmRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/it/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <ItRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/gold/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <GoldRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/system/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <SystemAdminRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        {/* The account area gained a second page in P9-B, so this became a wildcard: the exact
            `/account/security` it used to declare could never have matched a sibling. */}
        <Route
          path="/account/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <AccountRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/employee-files/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <EmployeeFilesRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <Suspense
                fallback={
                  <div className="grid min-h-screen place-items-center">
                    <LoadingState />
                  </div>
                }
              >
                <RecruitmentRoutes />
              </Suspense>
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};
