// ── DESIGN SAMPLE — NEVER COMMIT (apps/web/src/zz-* is in .git/info/exclude) ────────────────────
// «الطقم الثابت» in the design of «تعيين السيارات» (owner 2026-11-17: «اعمل ديزاين شاشة الطاقم الثابت
// زى التعيين اليومى»). The sample page in the REAL AppShell (side menu, top bar, branch switcher),
// and beside it the REAL merged daily roster on the same figures, for the side-by-side shots.
//
//   /zz-fixed-sample.html#/fleet/fixed-roster            the sample — a dispatcher who plans
//   /zz-fixed-sample.html?viewer=1#/fleet/fixed-roster   a reader who may only view
//   /zz-fixed-sample.html?fail=1#/fleet/fixed-roster     the board's read fails (error + retry)
//   /zz-fixed-sample.html?slow=1#/fleet/fixed-roster     the board never answers (loading)
//   /zz-fixed-sample.html?nopool=1#/fleet/fixed-roster   every driver a standing crew holds: the
//                                                        free list is empty («لا يوجد سائقون بلا طقم ثابت»)
//   /zz-fixed-sample.html#/fleet/roster                  the REAL «تعيين السيارات» (reference)
//   ?theme=light                                         light (dark is the default here)
//
// The top bar's branch is the app's own: `ecms.activeBranch` in localStorage (set by the switcher, or
// by the shooter before the page loads), sent as `X-Active-Branch` — the answers below read it.
// Every /api/v1/** request is answered in the page from zz-fixed-sample-data.ts: nothing leaves it.
import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { type FleetFixedRosterDto, type MeDto } from '@ecms/contracts';
import { store } from './store';
import { signedIn } from './store/authSlice';
import { setTheme } from './store/uiSlice';
import { ThemeProvider } from './platform/theme/ThemeProvider';
import { AppShell } from './platform/layout/AppShell';
import { readStoredBranch } from './platform/layout/BranchSwitcher';
import { RequirePermission } from './platform/router/RequirePermission';
import { setActiveBranch } from './shared/lib/api-client';
import { FilterResetStyleContext } from './shared/ui/FilterBar';
import { Toaster } from './shared/ui/toast/Toaster';
import { RosterPage } from './modules/fleet/pages/RosterPage';
import {
  answerSampleApi,
  PLANNER_PERMISSIONS,
  refusalOf,
  VIEWER_PERMISSIONS,
} from './zz-fixed-sample-data';
import { FixedCrewSamplePage } from './zz-fixed-sample-page';
import './styles.css';

const PARAMS = new URLSearchParams(window.location.search);
const VIEWER = PARAMS.get('viewer') === '1';
const FAIL = PARAMS.get('fail') === '1';
const SLOW = PARAMS.get('slow') === '1';
const NO_POOL = PARAMS.get('nopool') === '1';
const THEME = PARAMS.get('theme') === 'light' ? 'light' : 'dark';

// ── the API, answered in the page ───────────────────────────────────────────────────────────────
const asked: string[] = [];
const unknown = new Set<string>();
(window as unknown as { __zzAsked: string[] }).__zzAsked = asked;
(window as unknown as { __zzUnknown: Set<string> }).__zzUnknown = unknown;
/** Every «حفظ» body the page sent (`window.__zzSaves`) — the shooter reads what a save carries. */
const saves: unknown[] = [];
(window as unknown as { __zzSaves: unknown[] }).__zzSaves = saves;

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, window.location.origin);
  const at = url.pathname.indexOf('/api/v1');
  if (at === -1) return realFetch(input, init);
  const path = url.pathname.slice(at + '/api/v1'.length);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const branch = new Headers(init?.headers).get('X-Active-Branch');
  asked.push(`${method} ${path}${url.search}${branch === null ? '' : ` [${branch}]`}`);
  if (path === '/fleet/fixed-roster' && method === 'GET') {
    if (SLOW) return new Promise<Response>(() => undefined);
    if (FAIL) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NETWORK', message: 'Failed to fetch' } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }
  let body: unknown = null;
  if (typeof init?.body === 'string') {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = null;
    }
  }
  if (method === 'POST' && path === '/fleet/fixed-roster') {
    saves.push(body);
    const refused = refusalOf(body);
    if (refused !== null) {
      return new Response(JSON.stringify(refused.body), {
        status: refused.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  let answer = answerSampleApi(method, path, url.searchParams, branch, body);
  if (answer === null) {
    const key = `${method} ${path}`;
    if (!unknown.has(key)) console.warn(`[zz mock] unknown → []: ${key}${url.search}`);
    unknown.add(key);
    answer = { success: true, data: [] };
  }
  if (NO_POOL && path === '/fleet/fixed-roster') {
    // The empty pool: the server's drivers are only the ones some standing crew already holds.
    const board = answer.data as FleetFixedRosterDto;
    answer = {
      ...answer,
      data: {
        ...board,
        drivers: board.drivers.filter((driver) => driver.assignedVehicleId !== null),
      },
    };
  }
  return new Response(JSON.stringify(answer), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ── the signed-in reader ────────────────────────────────────────────────────────────────────────
const ME = {
  id: '65f000000000000000000001',
  email: 'dispatch@egycash.local',
  username: 'dispatch',
  mustChangePassword: false,
  name: { firstName: { ar: 'مشرف', en: 'Fleet' }, lastName: { ar: 'الحركة', en: 'Dispatcher' } },
  locale: 'ar',
  theme: THEME,
  navLayout: 'rail',
  branchId: null,
  branchIds: [],
  employeeId: null,
  permissions: Object.fromEntries(
    (VIEWER ? VIEWER_PERMISSIONS : PLANNER_PERMISSIONS).map((key) => [key, 'organization']),
  ),
  isPrivileged: false,
  flags: {},
  totpEnabled: true,
  external: null,
} as unknown as MeDto;

setActiveBranch(readStoredBranch());
store.dispatch(signedIn(ME));
store.dispatch(setTheme(THEME));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 60_000 } },
});

/** Loud on purpose: the shooter looks for `[data-zz-error]` and fails the run. */
class HarnessBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <pre data-zz-error="true" dir="ltr" className="whitespace-pre-wrap p-6 text-xs text-red-600">
        {`${this.state.error.message}\n\n${this.state.error.stack ?? ''}`}
      </pre>
    );
  }
}

const entry = ((): string => {
  const hash = window.location.hash.replace(/^#/, '');
  return hash.startsWith('/') ? hash : '/fleet/fixed-roster';
})();

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root');

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <HarnessBoundary>
            <MemoryRouter initialEntries={[entry]}>
              <div
                className="contents"
                data-zz-page={entry}
                data-zz-variant={VIEWER ? 'viewer' : 'planner'}
              >
                <FilterResetStyleContext.Provider value={{ tone: 'red', always: false }}>
                  <Routes>
                    <Route path="/fleet" element={<AppShell />}>
                      <Route
                        path="fixed-roster"
                        element={
                          <RequirePermission permission="fleetRoster.view">
                            <FixedCrewSamplePage />
                          </RequirePermission>
                        }
                      />
                      <Route
                        path="roster"
                        element={
                          <RequirePermission permission="fleetRoster.view">
                            <RosterPage />
                          </RequirePermission>
                        }
                      />
                    </Route>
                    <Route path="*" element={<p className="p-6 text-sm">no route for {entry}</p>} />
                  </Routes>
                </FilterResetStyleContext.Provider>
              </div>
            </MemoryRouter>
          </HarnessBoundary>
          <Toaster />
        </QueryClientProvider>
      </ThemeProvider>
    </Provider>
  </StrictMode>,
);
