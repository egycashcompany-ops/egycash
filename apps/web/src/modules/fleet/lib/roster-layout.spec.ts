// Which «تعيين السيارات» board a viewport gets — the rule the approved shots were taken at: the
// phone at 390×844 («P1»), the phone held sideways at 844×390 («PL1»), the tablet at 820×1180
// («TP») and 1180×820 («TL2»), the computer at 1536 («D1», «اعتمد»).
//
// The web suite has no DOM: the rule is a pure function, the media-query read is driven through a
// stubbed `matchMedia`, and the hook is rendered with `renderToStaticMarkup`, which is exactly the
// "no window" case every roster spec renders the page in.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ROSTER_BREAKPOINTS,
  rosterLayoutFor,
  useRosterLayout,
  viewportLayout,
} from './roster-layout';

/** A window whose `matchMedia` answers `(min-width: Npx)` / `(min-height: Npx)` for this size. */
const viewport = (width: number, height: number): void => {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => {
      const found = /\((min-width|min-height): (\d+)px\)/u.exec(query);
      const side = found?.[1] === 'min-height' ? height : width;
      return {
        matches: found !== null && side >= Number(found[2]),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
    },
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rosterLayoutFor — the viewport decides the board', () => {
  it.each([
    [390, 844, 'phone', false],
    [844, 390, 'portrait', true],
    [820, 1180, 'portrait', false],
    [1180, 820, 'landscape', false],
    [1279, 800, 'landscape', false],
    [1280, 800, 'desktop', false],
    [1536, 864, 'desktop', false],
    [1920, 1080, 'desktop', false],
  ] as const)('%i×%i → %s (short: %s)', (width, height, layout, short) => {
    expect(rosterLayoutFor(width, height)).toEqual({ layout, short });
  });

  it('switches exactly at the breakpoints', () => {
    expect(rosterLayoutFor(767, 900).layout).toBe('phone');
    expect(rosterLayoutFor(768, 900).layout).toBe('portrait');
    expect(rosterLayoutFor(1023, 900).layout).toBe('portrait');
    expect(rosterLayoutFor(1024, 900).layout).toBe('landscape');
    expect(rosterLayoutFor(1279, 900).layout).toBe('landscape');
    expect(rosterLayoutFor(1280, 900).layout).toBe('desktop');
  });

  it('calls a touch viewport under 500px tall SHORT — and never the computer', () => {
    expect(rosterLayoutFor(390, 499).short).toBe(true);
    expect(rosterLayoutFor(390, ROSTER_BREAKPOINTS.tall).short).toBe(false);
    expect(rosterLayoutFor(1100, 480)).toEqual({ layout: 'landscape', short: true });
    expect(rosterLayoutFor(1440, 400)).toEqual({ layout: 'desktop', short: false });
  });
});

describe('viewportLayout — the window this runs in', () => {
  it('reads the same rule through the media queries', () => {
    viewport(390, 844);
    expect(viewportLayout()).toEqual({ layout: 'phone', short: false });
    viewport(844, 390);
    expect(viewportLayout()).toEqual({ layout: 'portrait', short: true });
    viewport(1180, 820);
    expect(viewportLayout()).toEqual({ layout: 'landscape', short: false });
    viewport(1536, 864);
    expect(viewportLayout()).toEqual({ layout: 'desktop', short: false });
  });

  it('answers the computer’s board with no window, or a window without matchMedia', () => {
    expect(viewportLayout()).toEqual({ layout: 'desktop', short: false });
    vi.stubGlobal('window', {});
    expect(viewportLayout()).toEqual({ layout: 'desktop', short: false });
  });
});

describe('useRosterLayout — read during render', () => {
  const Probe = (): JSX.Element => {
    const { layout, short } = useRosterLayout();
    return createElement('i', { 'data-layout': layout, 'data-short': String(short) });
  };

  it('renders the computer’s board where there is no window — what every roster spec renders', () => {
    const markup = renderToStaticMarkup(createElement(Probe));
    expect(markup).toBe('<i data-layout="desktop" data-short="false"></i>');
  });
});
