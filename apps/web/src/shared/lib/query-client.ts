// TanStack Query client + GLOBAL error handling (ADR-013). Server state lives here; every
// unhandled failure surfaces as a toast in the caller's locale. Component-level Error states
// (see shared/ui/states) still render inline for a query's FIRST load — we only toast a query
// error when it fails a background refetch of data already on screen, so initial-load failures
// aren't shown twice. Mutations that declare their own onError opt out of the global toast.
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { store } from '../../store';
import { toast } from '../ui/toast/toast-store';
import { errorMessage } from './errors';

const notify = (error: unknown): void => {
  toast.error(errorMessage(error, store.getState().locale.locale));
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.state.data !== undefined) notify(error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.options.onError === undefined) notify(error);
    },
  }),
});
