// The shell bar has to fit the width it is given.
//
// WHY A TEST. Overflow in a `flex-nowrap` row is silent. Nothing throws, nothing logs, the row
// simply extends past the viewport and the controls at its end are gone — not clipped in a way you
// can scroll to, gone. That is what shipped: on a 360px phone the bar measured 510px, so 150px of
// it sat past the edge, taking the notification bell and the account menu with it. The only report
// it could ever produce is a person saying "part of the bar isn't showing".
//
// This suite has no DOM and cannot measure a layout, so it does not pretend to. What it pins is
// the contract that made the width fit — the row wraps, the search takes the space left on its
// line instead of demanding one, the utilities claim the second line — and the rule that the fix
// must not be paid for by hiding controls, which is the tempting wrong answer to "it doesn't fit".
//
// The measurements themselves were taken in a real browser against the real stylesheet: 0px
// overflow at 320/360/412, and a desktop bar byte-identical to the one before the change.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { uiSlice } from '../../store/uiSlice';
import { authSlice } from '../../store/authSlice';
import { Topbar } from './Topbar';

const me: MeDto = {
  id: 'u-1',
  email: 'me@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'ar',
  navLayout: 'launchpad',
  theme: 'dark',
  branchId: null,
  employeeId: null,
  permissions: {},
  // Whole-company, so the branch switcher renders — the widest the bar ever gets.
  isPrivileged: true,
  flags: {},
  totpEnabled: false,
  external: null,
};

const render = (): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, ui: uiSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as const, dir: 'rtl' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
      auth: { me, status: 'signedIn' as const },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Topbar onOpenSearch={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const MARKUP = render();

/** The header's own class list — the first `class="..."` the markup opens with. */
const headerClasses = (): string[] =>
  (/<header[^>]*class="([^"]*)"/.exec(MARKUP)?.[1] ?? '').split(/\s+/);

/**
 * The classes of the button that CONTAINS `needle`.
 *
 * Found by walking back from the text to the button that opens it, rather than by a regex spanning
 * from `<button` to the text — that form matches the FIRST button in the document and any text
 * after it, which silently answered every question about the search field with the menu button's
 * classes.
 */
const buttonAround = (needle: string): string[] => {
  const at = MARKUP.indexOf(needle);
  expect(at, `${needle} is in the bar`).toBeGreaterThan(-1);
  const opensAt = MARKUP.lastIndexOf('<button', at);
  return (/class="([^"]*)"/.exec(MARKUP.slice(opensAt, at))?.[1] ?? '').split(/\s+/);
};

/** Everything from the utilities group's opening tag to the end of the bar. */
const UTILITIES = MARKUP.slice(MARKUP.lastIndexOf('<div class="flex w-full shrink-0'));

describe('the bar wraps rather than running off the edge', () => {
  it('lets its row wrap at a phone width', () => {
    expect(headerClasses()).toContain('flex-wrap');
  });

  it('and stops wrapping from md up, where one row fits', () => {
    // Measured: a full bar needs ~710px at md, against 768 available.
    expect(headerClasses()).toContain('md:flex-nowrap');
  });

  it('takes its height from its content below md, and the fixed 14 above', () => {
    // `h-14` on a wrapping row would crush two lines into one row's height.
    expect(headerClasses()).not.toContain('h-14');
    expect(headerClasses()).toEqual(expect.arrayContaining(['md:h-14', 'py-2', 'md:py-0']));
  });
});

describe('the search takes the space left on its line, never a line of its own', () => {
  const search = (): string[] => buttonAround('ابحث أو انتقل');

  it('grows into the free space and may shrink below its content', () => {
    // Without `min-w-0` a flex item refuses to shrink past its text, which is its own overflow.
    expect(search()).toEqual(expect.arrayContaining(['flex-1', 'min-w-0']));
  });

  it('is still capped and centred, which is what keeps the desktop bar identical', () => {
    expect(search()).toEqual(expect.arrayContaining(['max-w-md', 'mx-auto']));
  });
});

describe('the utilities take the second line, and give nothing up for it', () => {
  const groupClasses = (): string[] =>
    (/<div class="([^"]*)"/.exec(UTILITIES)?.[1] ?? '').split(/\s+/);

  it('claims a full line below md and returns to its own width above', () => {
    expect(groupClasses()).toEqual(expect.arrayContaining(['w-full', 'md:w-auto']));
  });

  it('spreads across that line, and bunches up again on one row', () => {
    expect(groupClasses()).toEqual(expect.arrayContaining(['justify-between', 'md:justify-normal']));
  });

  /**
   * The rule this file exists to defend.
   *
   * "It doesn't fit" has an easy wrong answer — hide something below `md` — and it is wrong here
   * because every one of these is the ONLY way to reach what it opens. Dropping the bell on a
   * phone does not tidy the bar; it removes notifications from phones. The nav-layout toggle is
   * on the list deliberately: the drawer really does render the rail or the launchpad by that
   * preference, so it is not a desktop-only control either.
   */
  it('hides no control at a phone width', () => {
    // The six the group carries: branch, nav layout, theme, language, notifications, account.
    const controls = [...UTILITIES.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1] ?? '');
    expect(controls).toHaveLength(6);
    for (const classes of controls) {
      expect(classes.split(/\s+/), classes).not.toContain('hidden');
    }
  });

  it('and hides nothing WRAPPING a control either', () => {
    // Checking only the buttons' own classes is not enough, and the gap is not hypothetical: a
    // `<div className="hidden md:block">` around the bell passes every assertion above while
    // removing notifications from every phone. So the rule is stated over the whole group —
    // anything `hidden` here has to be decoration.
    const hiddenHere = [...UTILITIES.matchAll(/<(\w+)[^>]*class="([^"]*\bhidden\b[^"]*)"/g)];
    for (const [, tag = '', classes = ''] of hiddenHere) {
      // The only two kinds of thing this bar may drop when it gets narrow: a `w-px` divider, and
      // the text label beside an icon whose meaning the icon already carries.
      const isDecoration = tag === 'span' || classes.includes('w-px');
      expect(isDecoration, `<${tag} class="${classes}"> is decoration, not a control`).toBe(true);
    }
  });

  it('and each of the six is still the reachable control it was', () => {
    // Named by what the user sees, so a control quietly dropped from the group fails here rather
    // than only in the count above.
    for (const label of [
      'المعروض الآن', // branch switcher
      'التبديل إلى شريط الأيقونات', // nav layout
      'السمة الداكنة', // theme
      'English', // language
      'الإشعارات', // notifications
      'aria-haspopup="menu"', // account
    ]) {
      expect(MARKUP, label).toContain(label);
    }
  });
});
