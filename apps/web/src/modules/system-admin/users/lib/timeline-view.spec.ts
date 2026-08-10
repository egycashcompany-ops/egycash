// The two rules the Activity tab runs on, checked directly.
//
// The wiring — that the component asks these functions rather than re-deciding in JSX, and that the
// query hands `getNextPageParam` to the second one — is pinned by source assertions at the bottom,
// because with `environment: 'node'` there is no DOM to render the tab into and confirm it.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nextTimelinePage, timelinePanel } from './timeline-view';

const HERE = dirname(fileURLToPath(import.meta.url));
const TAB = readFileSync(resolve(HERE, '../components/UserActivityTab.tsx'), 'utf8');
const QUERIES = readFileSync(resolve(HERE, '../api/user-queries.ts'), 'utf8');

describe('a failed read never renders as an empty history', () => {
  it('shows the error panel when the first load fails', () => {
    expect(timelinePanel({ isLoading: false, isError: true, loaded: 0 })).toBe('error');
  });

  // The whole point of the rule: the two states are one boolean apart and mean opposite things.
  it('shows the empty state only when the read SUCCEEDED and returned nothing', () => {
    expect(timelinePanel({ isLoading: false, isError: false, loaded: 0 })).toBe('empty');
  });

  it('keeps the entries on screen when a LATER page fails', () => {
    expect(timelinePanel({ isLoading: false, isError: true, loaded: 25 })).toBe('entries');
  });

  it('shows the loading state before anything is decided, error or not', () => {
    expect(timelinePanel({ isLoading: true, isError: false, loaded: 0 })).toBe('loading');
    expect(timelinePanel({ isLoading: true, isError: true, loaded: 0 })).toBe('loading');
  });

  it('shows entries whenever there are entries and no failure', () => {
    expect(timelinePanel({ isLoading: false, isError: false, loaded: 1 })).toBe('entries');
  });
});

describe('paging stops exactly when the history runs out', () => {
  it('asks for the next page after a FULL one', () => {
    expect(nextTimelinePage(25, 1, 25)).toBe(2);
    expect(nextTimelinePage(25, 3, 25)).toBe(4);
  });

  it('stops on a short page — nothing can be behind it', () => {
    expect(nextTimelinePage(24, 1, 25)).toBeUndefined();
    expect(nextTimelinePage(1, 4, 25)).toBeUndefined();
  });

  // The one case the inference cannot avoid: a total that is an exact multiple looks like "more".
  // The next request comes back empty and stops there, which costs one request and never a wrong
  // answer — the alternative was a contract change to a shared endpoint.
  it('stops on the empty page that follows an exact multiple', () => {
    expect(nextTimelinePage(25, 2, 25)).toBe(3);
    expect(nextTimelinePage(0, 3, 25)).toBeUndefined();
  });

  it('never returns a page it has already loaded', () => {
    for (let loaded = 1; loaded < 10; loaded += 1) {
      expect(nextTimelinePage(25, loaded, 25)).toBeGreaterThan(loaded);
    }
  });
});

describe('the tab and the query use these rules rather than restating them', () => {
  it('renders the panel this file chose', () => {
    expect(TAB).toContain('const panel = timelinePanel({ isLoading, isError, loaded: entries.length })');
    expect(TAB).toContain("panel === 'error' ? (");
    expect(TAB).toContain('<ErrorState error={error} onRetry={() => void refetch()} />');
    // The failure mode this guards: an `isError` branch that fell through to EmptyState.
    expect(TAB).not.toMatch(/isError[^\n]*<EmptyState/);
  });

  it('appends pages instead of replacing them', () => {
    expect(TAB).toContain('const items = (data?.pages ?? []).flatMap((p) => p.items)');
  });

  it('drives the infinite query from `nextTimelinePage`', () => {
    expect(QUERIES).toContain('useInfiniteQuery');
    expect(QUERIES).toContain(
      'nextTimelinePage(last.items.length, pages.length, TIMELINE_PAGE_SIZE)',
    );
  });
});
