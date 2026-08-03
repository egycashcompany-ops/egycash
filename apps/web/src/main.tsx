import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { QueryClientProvider } from '@tanstack/react-query';
import { store } from './store';
import { signedOut } from './store/authSlice';
import { queryClient } from './shared/lib/query-client';
import { setOnAuthLost } from './shared/lib/api-client';
import { ThemeProvider } from './platform/theme/ThemeProvider';
import { ErrorBoundary } from './platform/app/ErrorBoundary';
import { Toaster } from './shared/ui/toast/Toaster';
import { App } from './platform/app/App';
import './styles.css';

// Organized sign-out on definitive auth loss (failed silent refresh): one state flip —
// RequireAuth then renders a single redirect to /login. Fired once per failed refresh by
// the api-client's shared single-flight promise, never once per waiting request.
setOnAuthLost(() => {
  store.dispatch(signedOut());
  queryClient.clear();
});

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root');

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
          <Toaster />
        </QueryClientProvider>
      </ThemeProvider>
    </Provider>
  </StrictMode>,
);
