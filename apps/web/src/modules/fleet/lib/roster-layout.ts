// Which «تعيين السيارات» board this screen draws: the computer's table, or one of the three touch
// layouts — «فى تعديل بسيط ف شاشة تعبين الطاقم فى الحركه عاوز شكلها يتغير فى التابلت والفون».
//
// The rule is the VIEWPORT, read through the same four media queries the approved samples were
// shot at (the phone at 390×844, the tablet at 820×1180 and 1180×820, the computer at 1536):
//
//   width ≥ 1280          desktop     the table and the one drivers panel
//   1024 ≤ width < 1280   landscape   the split view: cars beside the drivers
//   768 ≤ width < 1024    portrait    cards, with a sticky header
//   width < 768           phone       cards; only the filter row is sticky
//
// and a viewport under 500px tall is SHORT (a phone held sideways is wide but very short): nothing
// on top stays pinned, so the cards keep the screen.
//
// One board is mounted at a time — JavaScript decides, not CSS hiding — so the hook is read once
// by the page shell and the board's model lives above both layouts: turning a tablet keeps the
// draft and the undo stack.
import { useMemo, useSyncExternalStore } from 'react';

export type RosterLayout = 'phone' | 'portrait' | 'landscape' | 'desktop';
export type TouchLayout = Exclude<RosterLayout, 'desktop'>;

export const ROSTER_BREAKPOINTS = {
  portrait: 768,
  landscape: 1024,
  desktop: 1280,
  tall: 500,
} as const;

/** The rule above, pure: a viewport's width and height → the layout, and whether it is short. */
export const rosterLayoutFor = (
  width: number,
  height: number,
): { layout: RosterLayout; short: boolean } => {
  const layout: RosterLayout =
    width >= ROSTER_BREAKPOINTS.desktop
      ? 'desktop'
      : width >= ROSTER_BREAKPOINTS.landscape
        ? 'landscape'
        : width >= ROSTER_BREAKPOINTS.portrait
          ? 'portrait'
          : 'phone';
  // A computer's screen is never "short" in this sense: the table has no sticky header to drop.
  return { layout, short: layout !== 'desktop' && height < ROSTER_BREAKPOINTS.tall };
};

const QUERIES = {
  desktop: `(min-width: ${String(ROSTER_BREAKPOINTS.desktop)}px)`,
  landscape: `(min-width: ${String(ROSTER_BREAKPOINTS.landscape)}px)`,
  portrait: `(min-width: ${String(ROSTER_BREAKPOINTS.portrait)}px)`,
  tall: `(min-height: ${String(ROSTER_BREAKPOINTS.tall)}px)`,
} as const;

/** No window (the server, the web suite's node run) or no `matchMedia`: nothing to ask. */
const canAsk = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** What a reader without a window gets — the computer's board, which is what the specs render. */
const DESKTOP_SNAPSHOT = 'desktop';

/**
 * The layout of the window this runs in, NOW, read through the four media queries. Each query
 * stands for the smallest width it admits, and `rosterLayoutFor` turns those into the answer —
 * the rule is written once. No window, or no `matchMedia`: the computer's board.
 */
export const viewportLayout = (): { layout: RosterLayout; short: boolean } => {
  if (!canAsk()) return { layout: 'desktop', short: false };
  const at = (query: string): boolean => window.matchMedia(query).matches;
  const width = at(QUERIES.desktop)
    ? ROSTER_BREAKPOINTS.desktop
    : at(QUERIES.landscape)
      ? ROSTER_BREAKPOINTS.landscape
      : at(QUERIES.portrait)
        ? ROSTER_BREAKPOINTS.portrait
        : 0;
  const height = at(QUERIES.tall) ? ROSTER_BREAKPOINTS.tall : 0;
  return rosterLayoutFor(width, height);
};

/**
 * The layout as ONE string (`'portrait'`, `'portrait:short'` …), so React compares snapshots by
 * value and re-renders only when the answer actually changes.
 */
const snapshot = (): string => {
  const { layout, short } = viewportLayout();
  return short ? `${layout}:short` : layout;
};

const subscribe = (onChange: () => void): (() => void) => {
  if (!canAsk()) return () => undefined;
  const lists = Object.values(QUERIES).map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
};

const serverSnapshot = (): string => DESKTOP_SNAPSHOT;

/**
 * The layout for the viewport, live: a rotate or a resize across a breakpoint redraws the board.
 *
 * Read during render (an external store, not a state set after the first paint), so the first
 * client paint is already the right board; with no window it answers the computer's board.
 */
export const useRosterLayout = (): { layout: RosterLayout; short: boolean } => {
  const key = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return useMemo(() => {
    const [layout, flag] = key.split(':') as [RosterLayout, string | undefined];
    return { layout, short: flag === 'short' };
  }, [key]);
};
