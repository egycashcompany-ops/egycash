// What an execution act does to the query cache (C4).
//
// THIS IS THE MECHANISM BEHIND THE SEQUENTIAL LOCK REACHING THE SCREEN. The server decides which
// stop is `current`; the phone learns it only by reading the day again. So the one behaviour that
// must never regress is that every act — successful or refused — leaves `myDay` stale, and that
// the client never writes an unlocked stop into the cache by itself.
//
// Run against a real QueryClient rather than a mock, the same way `workflow-cache.spec.ts` does:
// the behaviour under test IS cache behaviour.
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { featureKey, listKey } from '../../../shared/lib/query-keys';

const QUERIES = readFileSync(
  fileURLToPath(new URL('../api/operations-queries.ts', import.meta.url)),
  'utf8',
);

describe('every act leaves the day stale', () => {
  it('invalidates the whole myDay subtree, not one date’s key', () => {
    // An act can change a day the screen is not looking at — a stop finished at 00:05 belongs to a
    // date the client may already have left — so the feature key is the right blast radius.
    expect(QUERIES).toContain("invalidateQueries({ queryKey: featureKey(MODULE, 'myDay') })");
  });

  it('invalidates on settle, so a REFUSED act refetches too', () => {
    // `onSettled`, not `onSuccess`. After a 409 the server's state is the one fact worth having —
    // that is the whole recovery path for a conflict.
    const block = QUERIES.slice(QUERIES.indexOf('const useExecutionAct'));
    expect(block).toContain('onSettled: invalidate');
    expect(block).not.toContain('onSuccess:');
  });

  it('also stales the desk’s view of the same shipments', () => {
    expect(QUERIES).toContain("invalidateQueries({ queryKey: featureKey(MODULE, 'dayBoard') })");
  });

  it('performs no optimistic update and unlocks nothing locally', () => {
    // `setQueryData` here would mean the client deciding a stop's progress. The lock is a domain
    // rule the server enforces; a phone that guessed would offer a button the API then refuses.
    const block = QUERIES.slice(QUERIES.indexOf('// ── Captain mobile'));
    expect(block).not.toContain('setQueryData');
    expect(block).not.toContain('onMutate');
  });
});

describe('invalidating myDay really does reach every cached date', () => {
  it('marks today AND yesterday stale from the one feature key', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const today = listKey('operations', 'myDay', { date: 'today' });
    const yesterday = listKey('operations', 'myDay', { date: '2026-08-17' });
    qc.setQueryData(today, { stops: [] });
    qc.setQueryData(yesterday, { stops: [] });
    expect(qc.getQueryState(today)?.isInvalidated).toBe(false);

    void qc.invalidateQueries({ queryKey: featureKey('operations', 'myDay') });

    expect(qc.getQueryState(today)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(yesterday)?.isInvalidated).toBe(true);
  });

  it('leaves unrelated features alone', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const banks = listKey('operations', 'banks', { page: 1 });
    qc.setQueryData(banks, { items: [] });
    void qc.invalidateQueries({ queryKey: featureKey('operations', 'myDay') });
    expect(qc.getQueryState(banks)?.isInvalidated).toBe(false);
  });
});

describe('a stale day is refetched rather than served from cache', () => {
  it('re-runs the query function after invalidation', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const key = listKey('operations', 'myDay', { date: 'today' });
    const queryFn = vi.fn().mockResolvedValue({ stops: ['first'] });

    await qc.fetchQuery({ queryKey: key, queryFn });
    expect(queryFn).toHaveBeenCalledTimes(1);

    queryFn.mockResolvedValue({ stops: ['second'] });
    await qc.invalidateQueries({ queryKey: featureKey('operations', 'myDay') });
    await qc.fetchQuery({ queryKey: key, queryFn });

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(qc.getQueryData(key)).toEqual({ stops: ['second'] });
  });
});

describe('nothing about the day is kept outside the cache', () => {
  it('stores no execution state in localStorage or sessionStorage', () => {
    // A phone locks, backgrounds, loses signal and reloads. The server is the only place the
    // captain's progress lives; a local copy would eventually be the one the screen believed.
    const MOBILE = fileURLToPath(new URL('.', import.meta.url));
    const files = ['CaptainDayPage.tsx', 'StopDetailPage.tsx', 'StopActions.tsx', 'day-view.ts'];
    for (const file of files) {
      const text = readFileSync(`${MOBILE}${file}`, 'utf8');
      expect(text, file).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });
});

describe('a phone that has been in a pocket re-reads the day', () => {
  it('overrides the console-wide refetchOnWindowFocus for this query only', () => {
    // The app-wide default is `false` with a 30-second staleTime, which is right for a console
    // somebody leaves open all day. A captain locks his phone between stops and the back office
    // can complete a shipment while it is in his pocket.
    const block = QUERIES.slice(QUERIES.indexOf('export const useMyDay'));
    expect(block.slice(0, block.indexOf('};'))).toContain('refetchOnWindowFocus: true');
    expect(block.slice(0, block.indexOf('};'))).toContain('staleTime: 0');
  });
});

describe('one refused act produces exactly one message', () => {
  it('declares onError, which is what opts out of the app-wide generic toast', () => {
    // `query-client.ts` toasts the generic `errorMessage` for any mutation declaring no `onError`
    // — which beside this surface's precise reason would put "something went wrong" on screen at
    // the same moment as "the previous stop has to be finished first".
    const block = QUERIES.slice(QUERIES.indexOf('const useExecutionAct'));
    expect(block).toContain('onError:');
    expect(block).toContain('executionErrorMessage');
  });

  it('the button does not report the failure a second time', () => {
    const actions = readFileSync(
      fileURLToPath(new URL('./StopActions.tsx', import.meta.url)),
      'utf8',
    );
    expect(actions).not.toContain('executionErrorMessage');
  });
});
