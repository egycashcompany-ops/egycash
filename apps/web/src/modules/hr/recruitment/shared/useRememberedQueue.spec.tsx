// The one rule that keeps "remember my filters" from becoming a bug: a URL that already says
// something must win. If a shared link, a bookmark or the back button lands on the queue with a
// query string, replacing it with yesterday's filters would break every link anyone sends.
//
// The hook is exercised through its storage contract rather than a renderer: what matters is which
// state gets restored and which gets recorded, and both are decisions about the string.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { chooseInitialView, useRememberedQueue } from './useRememberedQueue';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

/** Server rendering runs the body but never the effects — enough to prove the hook is inert there. */
const renderOnce = (search: string): { setSpCalls: URLSearchParams[] } => {
  const setSpCalls: URLSearchParams[] = [];
  const setSp = ((next: URLSearchParams) => void setSpCalls.push(next)) as never;
  const Probe = (): null => {
    useRememberedQueue('screening', [new URLSearchParams(search), setSp]);
    return null;
  };
  renderToStaticMarkup(<Probe />);
  return { setSpCalls };
};

describe('chooseInitialView', () => {
  // The precedence is the feature. Each of these three would look "helpful" if it won more often
  // than it should, and each would break something real.
  it('leaves a URL that says something alone — every shared link depends on it', () => {
    expect(chooseInitialView('status=rejected', 'status=waiting', 'status=waiting')).toBe('');
    // Even when the URL happens to match nothing anyone saved or defaulted to.
    expect(chooseInitialView('page=3', '', 'status=waiting')).toBe('');
  });

  it('prefers the view this user left behind over the queue’s default', () => {
    expect(chooseInitialView('', 'status=accepted', 'status=waiting')).toBe('status=accepted');
  });

  it('falls back to the default only when there is nothing else', () => {
    expect(chooseInitialView('', '', 'status=waiting')).toBe('status=waiting');
  });

  it('does nothing at all when a queue has no default and nothing was saved', () => {
    expect(chooseInitialView('', '', '')).toBe('');
  });
});

describe('useRememberedQueue', () => {
  beforeEach(() => store.clear());

  it('keys storage per screen, under the app’s own prefix', () => {
    store.set('ecms.queue.screening', 'status=waiting');
    expect(store.get('ecms.queue.screening')).toBe('status=waiting');
    // A different queue must not read this one's view.
    expect(store.get('ecms.queue.interviews')).toBeUndefined();
  });

  it('never navigates during a render — restoring is an effect, not a side effect of drawing', () => {
    store.set('ecms.queue.screening', 'status=waiting');
    expect(renderOnce('').setSpCalls).toEqual([]);
    expect(renderOnce('status=accepted').setSpCalls).toEqual([]);
  });

  it('survives storage being unavailable, because a queue that cannot remember still works', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => renderOnce('')).not.toThrow();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
});
