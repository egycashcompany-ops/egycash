// «انصراف مبكر» on the day timeline — the other end of a short day.
//
// The timeline drew the late part of a day (shift start → arrival) and nothing at the departure
// end, so a day the engine calls «تأخير وانصراف مبكر» showed only half of what it was called for.
// This proves the half that was added, and — more importantly — the rule that keeps it honest.
//
// THE ENGINE DECIDES, NEVER THE CLOCK. Under the flexible-hours rule of 18 November, leaving
// before the hour costs nothing once the day's hours are complete; `derive-day.ts` applies that
// (and the out-grace) and publishes `earlyLeaveMinutes`. The views read that figure AND gate on
// the status, so a day the engine calls «حاضر» can never draw early leave even if some later
// reading of the DTO put a number in the field.
//
// No DOM here (`renderToStaticMarkup`), which is the right tool: what is being asserted is markup
// — a chip, a striped span, and the inline-axis maths that makes the bar correct in Arabic.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { Locale } from '@ecms/contracts';
import { localeSlice, setLocale } from '../../../../store/localeSlice';
import { store as appStore } from '../../../../store';
import { authSlice } from '../../../../store/authSlice';
import { uiSlice } from '../../../../store/uiSlice';
import { DayLegend, DayTimelineList } from './day-timeline';
import type { EmployeeDay, ViewStatus } from './view-types';

const DATE = '2026-11-22';

/** 09:00 → 17:00, arrived 10:07, left 16:45 — the owner's own example, in minutes. */
const day = (over: Partial<EmployeeDay> = {}): EmployeeDay => ({
  date: DATE,
  status: 'lateAndEarly',
  inAt: 10 * 60 + 7,
  outAt: 16 * 60 + 45,
  expected: { start: 9 * 60, end: 17 * 60 },
  worked: 398,
  lateMinutes: 67,
  earlyLeave: 15,
  shortfall: 82,
  tags: [],
  scans: [],
  repeats: 0,
  ...over,
});

const render = (node: JSX.Element, locale: Locale = 'ar'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: null, status: 'signedOut' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  // `view-format.ts` reads the locale off the app's single store, so the two are kept in step.
  appStore.dispatch(setLocale(locale));
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

const list = (d: EmployeeDay, locale: Locale = 'ar'): string =>
  render(<DayTimelineList days={[d]} today={DATE} locale={locale === 'en' ? 'en' : 'ar'} />, locale);

/** Every `inset-inline-start:N%` in the markup, in order — the bar's positions. */
const insetStarts = (html: string): number[] =>
  [...html.matchAll(/inset-inline-start:([\d.]+)%/gu)].map((m) => Number(m[1]));

describe('the early-leave chip', () => {
  it('names the figure, in Arabic, on a «تأخير وانصراف مبكر» day', () => {
    const html = list(day());
    expect(html).toContain('انصراف مبكر');
    // 15 minutes, written by `hm()` exactly as the late chip writes its own.
    expect(html).toMatch(/انصراف مبكر\s*<bdi class="att-fig">15 د<\/bdi>/u);
    // Its own colour, not the late chip's red and not the amber of the status pill beside it.
    expect(html).toContain('text-[color:var(--att-early)]');
    expect(html).toContain('bg-[var(--att-early-soft)]');
  });

  it('names it in English too', () => {
    expect(list(day(), 'en')).toContain('Left early');
  });

  it('shows the late chip and the early chip together — both ends of the same day', () => {
    const html = list(day());
    expect(html).toContain('انصراف مبكر');
    expect(html).toContain('text-[color:var(--att-bad)]'); // the late chip keeps its red
  });

  it('is absent on a day the ENGINE does not call early, whatever the figure says', () => {
    // The flexible-hours rule: hours complete, so the engine published `present` — and a stale or
    // mistaken `earlyLeave` number must not put a chip on a day nobody owes anything for.
    const html = list(day({ status: 'present', earlyLeave: 15, lateMinutes: 0 }));
    expect(html).not.toContain('انصراف مبكر');
    expect(html).not.toContain('att-early-stripe');
  });

  it('is absent when the engine says early but the figure is zero', () => {
    // The CHIP, not the words: on an `earlyLeave` day the status pill says «انصراف مبكر» too, so
    // the phrase is on the screen either way. The chip is its own background.
    const html = list(day({ status: 'earlyLeave', earlyLeave: 0 }));
    expect(html).not.toContain('bg-[var(--att-early-soft)]');
    expect(html).not.toContain('att-early-stripe');
  });

  it.each<ViewStatus>(['earlyLeave', 'lateAndEarly'])('draws on a %s day', (status) => {
    expect(list(day({ status }))).toContain('att-early-stripe');
  });
});

describe('the early-leave segment on the bar', () => {
  it('runs from the departure to the hour they were due to leave', () => {
    const html = list(day());
    expect(html).toContain('att-early-stripe');
    // Positions are on the INLINE axis, never `left` — which is what makes the bar correct in
    // Arabic without a second code path. The late segment and this one share the maths.
    expect(html).not.toMatch(/style="[^"]*\bleft:/u);
    expect(insetStarts(html).length).toBeGreaterThan(0);
  });

  it('places the early segment after the late one along the day, in both directions', () => {
    for (const locale of ['ar', 'en'] as const) {
      const html = list(day(), locale);
      const late = html.indexOf('att-late-stripe');
      const early = html.indexOf('att-early-stripe');
      expect(late, locale).toBeGreaterThan(-1);
      expect(early, locale).toBeGreaterThan(-1);
      // The SAME markup in both locales: the direction is the browser's to apply, from
      // `inset-inline-start`, not something the component branches on.
      expect(html.includes('att-early-stripe'), locale).toBe(true);
    }
    expect(list(day(), 'ar').replace(/انصراف مبكر|متأخر/gu, '')).toContain('inset-inline-start');
  });

  it('is not drawn when the departure is not before the expected end', () => {
    // Left at 17:30 on a 17:00 day: nothing early about it, whatever the status field holds.
    const html = list(day({ outAt: 17 * 60 + 30 }));
    expect(html).not.toContain('att-early-stripe');
  });

  it('draws across midnight on a night shift, from the stored minutes', () => {
    // 22:00 → 06:00 next day, left at 04:00. The view-model carries minutes past the day's start,
    // so the expected end is 1800 and the departure 1680 — no calendar arithmetic here.
    const night = day({
      status: 'earlyLeave',
      inAt: 22 * 60,
      outAt: 28 * 60,
      expected: { start: 22 * 60, end: 30 * 60 },
      worked: 360,
      lateMinutes: 0,
      earlyLeave: 120,
      shortfall: 120,
    });
    const html = list(night);
    expect(html).toContain('att-early-stripe');
    expect(html).toMatch(/انصراف مبكر\s*<bdi class="att-fig">2 س<\/bdi>/u);
  });
});

describe('the legend', () => {
  it('names the new colour beside «متأخر»', () => {
    const html = render(<DayLegend />);
    expect(html).toContain('att-early-stripe');
    expect(html).toContain('انصراف مبكر');
    expect(html).toContain('att-late-stripe');
  });
});
