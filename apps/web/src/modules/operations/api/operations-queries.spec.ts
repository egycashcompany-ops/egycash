// What a reference-data mutation moves in the query cache.
//
// The failure this guards is silent: after renaming a bank, the branches table still shows the old
// operational name until something else happens to refetch it. Nothing throws, nothing logs — the
// operator simply reads a stale value and believes it. So the invalidation fan-out is asserted
// directly, against a real QueryClient.
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { listKey } from '../../../shared/lib/query-keys';
import { __operationsKeys } from './operations-queries';

/** Seed one cache entry per feature so "did it become stale?" is answerable per feature. */
const seed = (qc: QueryClient): void => {
  qc.setQueryData(listKey('operations', 'banks', { page: 1 }), { items: [] });
  qc.setQueryData(listKey('operations', 'bankBranches', { page: 1 }), { items: [] });
  qc.setQueryData(listKey('operations', 'currencies', { page: 1 }), { items: [] });
};

const isStale = (qc: QueryClient, key: readonly unknown[]): boolean =>
  qc
    .getQueryCache()
    .findAll({ queryKey: key })
    .every((query) => query.state.isInvalidated);

describe('operations reference-data cache keys', () => {
  it('keeps the three features on separate subtrees', () => {
    expect(__operationsKeys.banks).toEqual(['operations', 'banks']);
    expect(__operationsKeys.branches).toEqual(['operations', 'bankBranches']);
    expect(__operationsKeys.currencies).toEqual(['operations', 'currencies']);
  });

  it('a bank change also stales the branches — branch rows show their bank name', async () => {
    const qc = new QueryClient();
    seed(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.banks });
    await qc.invalidateQueries({ queryKey: __operationsKeys.branches });

    expect(isStale(qc, __operationsKeys.banks)).toBe(true);
    expect(isStale(qc, __operationsKeys.branches)).toBe(true);
    // ...but currencies are untouched: nothing about them depends on a bank.
    expect(isStale(qc, __operationsKeys.currencies)).toBe(false);
  });

  it('a branch change does NOT stale the banks — the dependency runs one way only', async () => {
    const qc = new QueryClient();
    seed(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.branches });

    expect(isStale(qc, __operationsKeys.branches)).toBe(true);
    expect(isStale(qc, __operationsKeys.banks)).toBe(false);
    expect(isStale(qc, __operationsKeys.currencies)).toBe(false);
  });

  it('a currency change touches currencies alone', async () => {
    const qc = new QueryClient();
    seed(qc);
    await qc.invalidateQueries({ queryKey: __operationsKeys.currencies });

    expect(isStale(qc, __operationsKeys.currencies)).toBe(true);
    expect(isStale(qc, __operationsKeys.banks)).toBe(false);
    expect(isStale(qc, __operationsKeys.branches)).toBe(false);
  });

  it('paginated entries of the same feature all stale together', async () => {
    const qc = new QueryClient();
    qc.setQueryData(listKey('operations', 'banks', { page: 1 }), { items: [] });
    qc.setQueryData(listKey('operations', 'banks', { page: 2 }), { items: [] });
    await qc.invalidateQueries({ queryKey: __operationsKeys.banks });

    expect(qc.getQueryCache().findAll({ queryKey: __operationsKeys.banks })).toHaveLength(2);
    expect(isStale(qc, __operationsKeys.banks)).toBe(true);
  });
});
