import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { QueryClientProvider } from '@tanstack/react-query';
import { store } from './store';
import { signedOut } from './store/authSlice';
import { queryClient } from './shared/lib/query-client';
import { setActiveBranch, setOnAuthLost } from './shared/lib/api-client';
import { ThemeProvider } from './platform/theme/ThemeProvider';
import { PreferenceSync } from './platform/preferences/PreferenceSync';
import { ErrorBoundary } from './platform/app/ErrorBoundary';
import { Toaster } from './shared/ui/toast/Toaster';
import { App } from './platform/app/App';
import { readStoredBranch } from './platform/layout/BranchSwitcher';
import './styles.css';

// Organized sign-out on definitive auth loss (failed silent refresh): one state flip —
// RequireAuth then renders a single redirect to /login. Fired once per failed refresh by
// the api-client's shared single-flight promise, never once per waiting request.
setOnAuthLost(() => {
  store.dispatch(signedOut());
  queryClient.clear();
});

// The command bar's branch narrowing, restored before anything is fetched — otherwise the session
// bootstrap and the first screen would both answer unnarrowed and then quietly change under the
// user once the switcher mounted.
setActiveBranch(readStoredBranch());

// The installed-app service worker (see `public/sw.js` for what it does and refuses to do).
//
// Production only. On the dev server a worker would sit in front of Vite's module graph and serve
// HMR yesterday's modules, which is a confusing failure to debug and buys nothing — nobody
// installs localhost. Registration is fire-and-forget and its failure is not the app's problem:
// a browser without service workers, a private window that refuses them, or a deployment served
// without `sw.js` all still run ECMS exactly as before.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => undefined);
  });
}

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root');

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      {/* Outside ThemeProvider on purpose: this decides WHICH theme and locale are in the store,
          and ThemeProvider/useDirection then apply whatever it decided. */}
      <PreferenceSync>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
            <Toaster />
          </QueryClientProvider>
        </ThemeProvider>
      </PreferenceSync>
    </Provider>
  </StrictMode>,
);
