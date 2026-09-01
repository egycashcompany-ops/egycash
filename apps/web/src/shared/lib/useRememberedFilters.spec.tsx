// Three rules keep "remember my filters" from becoming a bug, and each of them would look helpful
// while breaking something real if it won more often than it should:
//
//   • a URL that already says something must win, or every shared link breaks;
//   • the pass that issues a restore must not record, or it erases what it is restoring;
//   • only what a screen DECLARED gets written, or the mechanism starts remembering tabs, board
//     dates and legacy params it was never meant to touch.
//
// The suite has no DOM, so the hook is exercised through the two decisions it is made of rather
// than through a renderer: both are decisions about strings, and both are the part that can be
// wrong.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  chooseInitialView,
  rememberedOnly,
  runFilterPass,
  useRememberedFilters,
} from './useRememberedFilters';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

const KEEP = ['status', 'q', 'sort', 'size'] as const;

/** Server rendering runs the body but never the effects — enough to prove the hook is inert there. */
const renderOnce = (search: string): { setSpCalls: unknown[] } => {
  const setSpCalls: unknown[] = [];
  const setSp = ((next: URLSearchParams) => void setSpCalls.push(next)) as never;
  const Probe = (): null => {
    useRememberedFilters([new URLSearchParams(search), setSp], KEEP);
    return null;
  };
  renderToStaticMarkup(
    <MemoryRouter>
      <Probe />
    </MemoryRouter>,
  );
  return { setSpCalls };
};

describe('chooseInitialView — the precedence IS the feature', () => {
  it('leaves a URL that says something alone — every shared link depends on it', () => {
    expect(chooseInitialView('status=rejected', 'status=waiting', 'status=waiting')).toBe('');
    // Even when the URL happens to match nothing anyone saved or defaulted to.
    expect(chooseInitialView('page=3', '', 'status=waiting')).toBe('');
  });

  it('prefers the view this user left behind over the screen’s default', () => {
    expect(chooseInitialView('', 'status=accepted', 'status=waiting')).toBe('status=accepted');
  });

  it('falls back to the default only when there is nothing else', () => {
    expect(chooseInitialView('', '', 'status=waiting')).toBe('status=waiting');
  });

  it('does nothing at all when a screen has no default and nothing was saved', () => {
    expect(chooseInitialView('', '', '')).toBe('');
  });
});

describe('rememberedOnly — only what the screen declared', () => {
  it('drops `page`, because a screen that lists it does not get one', () => {
    const sp = new URLSearchParams('status=open&page=7&q=cairo');
    expect(rememberedOnly(sp, KEEP)).toBe('status=open&q=cairo');
  });

  it('drops anything undeclared — a tab, a board date, a legacy param', () => {
    // The three real cases the contract excludes by name.
    expect(rememberedOnly(new URLSearchParams('kind=workType&status=open'), KEEP)).toBe(
      'status=open',
    );
    expect(rememberedOnly(new URLSearchParams('date=2026-01-05&sort=from:desc'), KEEP)).toBe(
      'sort=from%3Adesc',
    );
    expect(rememberedOnly(new URLSearchParams('code=FLT210&q=cairo'), KEEP)).toBe('q=cairo');
  });

  it('orders by the declaration, so the same view always stores the same string', () => {
    const a = new URLSearchParams('q=cairo&status=open');
    const b = new URLSearchParams('status=open&q=cairo');
    expect(rememberedOnly(a, KEEP)).toBe(rememberedOnly(b, KEEP));
    expect(rememberedOnly(a, KEEP)).toBe('status=open&q=cairo');
  });

  it('keeps every value of a repeated param rather than the first', () => {
    expect(rememberedOnly(new URLSearchParams('status=open&status=closed'), KEEP)).toBe(
      'status=open&status=closed',
    );
  });

  it('drops a param that is present but empty — it filters nothing', () => {
    expect(rememberedOnly(new URLSearchParams('status=&q=cairo'), KEEP)).toBe('q=cairo');
  });

  it('is empty when a screen has been cleared, which is a view worth recording', () => {
    expect(rememberedOnly(new URLSearchParams('page=2'), KEEP)).toBe('');
  });
});

describe('runFilterPass — when each of the two things happens', () => {
  it('restores on a bare arrival, and does NOT record that pass', () => {
    // The bug this replaces: the pass that navigates still holds the bare URL, so recording it
    // wrote '' over the saved view before the navigation could put it back.
    expect(
      runFilterPass({
        settled: false,
        navigating: false,
        current: '',
        saved: 'status=waiting',
        fallback: '',
      }),
    ).toEqual({ restore: 'status=waiting', record: false });
  });

  it('does not record the pass that is merely showing what it just restored', () => {
    expect(
      runFilterPass({
        settled: true,
        navigating: true,
        current: 'status=waiting',
        saved: '',
        fallback: '',
      }),
    ).toEqual({ restore: '', record: false });
  });

  it('records every pass after that — this is how a change gets remembered', () => {
    expect(
      runFilterPass({
        settled: true,
        navigating: false,
        current: 'status=open',
        saved: '',
        fallback: '',
      }),
    ).toEqual({ restore: '', record: true });
  });

  it('records a bare arrival with nothing to restore, so a cleared screen stays cleared', () => {
    expect(
      runFilterPass({ settled: false, navigating: false, current: '', saved: '', fallback: '' }),
    ).toEqual({ restore: '', record: true });
  });

  it('never restores over a URL that says something, and records it instead', () => {
    expect(
      runFilterPass({
        settled: false,
        navigating: false,
        current: 'status=rejected',
        saved: 'status=waiting',
        fallback: 'status=waiting',
      }),
    ).toEqual({ restore: '', record: true });
  });

  it('applies a screen’s fallback only when nothing was saved', () => {
    expect(
      runFilterPass({
        settled: false,
        navigating: false,
        current: '',
        saved: '',
        fallback: 'status=waiting',
      }).restore,
    ).toBe('status=waiting');
    expect(
      runFilterPass({
        settled: false,
        navigating: false,
        current: '',
        saved: 'status=accepted',
        fallback: 'status=waiting',
      }).restore,
    ).toBe('status=accepted');
  });
});

describe('useRememberedFilters', () => {
  beforeEach(() => store.clear());

  it('keys storage per pathname, under the app’s own prefix', () => {
    store.set('ecms.filters./it/tickets', 'status=open');
    expect(store.get('ecms.filters./it/tickets')).toBe('status=open');
    // A different screen must not read this one's filters.
    expect(store.get('ecms.filters./it/assets')).toBeUndefined();
  });

  it('never navigates during a render — restoring is an effect, not a side effect of drawing', () => {
    store.set('ecms.filters./', 'status=open');
    expect(renderOnce('').setSpCalls).toEqual([]);
    expect(renderOnce('status=closed').setSpCalls).toEqual([]);
  });

  it('survives storage being unavailable, because a screen that cannot remember still works', () => {
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
