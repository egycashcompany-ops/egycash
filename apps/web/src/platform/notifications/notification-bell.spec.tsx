// The bell has to render what the server says, not a constant.
//
// WHY A TEST. What shipped was `const unread = 0` with a comment calling the inbox "a later
// feature". It rendered a bell, a popover and an empty state, and asked the server nothing —
// so notifications arrived on people's phones while the one place inside ECMS anybody would look
// for them was hard-coded to say there were none. Nothing threw. Nothing logged. The only report
// it could ever produce is somebody saying "the notification doesn't show in the bell".
//
// This suite has no DOM and cannot click (see `vitest.config.ts`), so it does not pretend to test
// the popover. What it pins is the one thing that made the bug possible and that static markup can
// still answer: the badge is READ FROM THE QUERY, so a count the server reports reaches the screen.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { localeSlice } from '../../store/localeSlice';
import { uiSlice } from '../../store/uiSlice';
import { authSlice } from '../../store/authSlice';
import { NotificationBell } from './NotificationBell';

/**
 * Render the bell with the unread count already in the cache.
 *
 * Seeding the cache rather than mocking `fetch` is what makes this a test of the COMPONENT: it
 * asserts that a count which reached the query reaches the badge, which is precisely the wiring
 * that was missing.
 */
const render = (count: number | undefined, signedIn = true): string => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (count !== undefined) client.setQueryData(['notifications', 'unread-count'], { count });

  const store = configureStore({
    reducer: { locale: localeSlice.reducer, ui: uiSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as const, dir: 'rtl' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
      auth: { me: null, status: signedIn ? ('signedIn' as const) : ('signedOut' as const) },
    },
  });

  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NotificationBell />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** The badge is the only element carrying the unread pill's background. */
const badgeText = (markup: string): string | null =>
  /<span class="[^"]*bg-red-500[^"]*">([^<]*)<\/span>/.exec(markup)?.[1] ?? null;

describe('the unread badge', () => {
  it('shows the count the server reported', () => {
    // The assertion the old component could never pass: 3 in, 3 on screen.
    expect(badgeText(render(3))).toBe('3');
  });

  it('is not a constant — a different count renders differently', () => {
    // Guards the specific shape of the bug. A component that hard-coded `1` would pass the case
    // above; nothing that ignores the query passes this one.
    expect(badgeText(render(1))).toBe('1');
    expect(badgeText(render(7))).toBe('7');
  });

  it('caps at 9+ rather than widening the bell', () => {
    expect(badgeText(render(10))).toBe('9+');
    expect(badgeText(render(240))).toBe('9+');
  });

  it('shows nothing at all when there is nothing waiting', () => {
    // A zero badge is worse than none: it draws the eye to say there is nothing to see.
    expect(badgeText(render(0))).toBeNull();
  });

  it('shows nothing before the count has arrived', () => {
    // First paint, cache cold. A badge invented while the answer is still in flight would flicker
    // a wrong number at every page load.
    expect(badgeText(render(undefined))).toBeNull();
  });
});

describe('the bell itself', () => {
  it('still renders for a signed-out shell without asking for a count', () => {
    // The topbar mounts before the session resolves. Asking then would 401 on every poll.
    const markup = render(undefined, false);
    expect(markup).toContain('<button');
    expect(badgeText(markup)).toBeNull();
  });

  it('labels itself for screen readers in the active language', () => {
    // `.spec.tsx` exists in this repo chiefly to catch a component asking for a translation key
    // that does not exist — a raw dotted key reaching a user.
    expect(render(0)).toContain('aria-label="الإشعارات"');
  });
});
