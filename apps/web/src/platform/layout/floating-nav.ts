// The navigation panel FLOATS over the page instead of taking a column from it.
//
// «الـ sidebar يظهر لما أعمل hover عليه ويظهر فوق الكونتنت ميخدش حيّز، ولو عاوز أفتحه يظهر برضه فوق
// الجدول ميخدش حيّز». On a desktop the page keeps its whole width at all times: only the slim icon
// strip stands beside it. The full panel opens OVER the page, from the strip's edge, in two ways:
//   • hovering the strip shows it while the pointer stays on the strip or the panel;
//   • the strip's open button keeps it shown (pinned) until it is closed again.
// Either way the table underneath does not move or narrow; the panel is drawn above it.
//
// The pinned choice is remembered on this device. It is stored under a key of its own: the key
// the old in-column panel used meant "expanded" by default, and carried over it would have opened
// the floating panel over everyone's page on their first load.
import { useCallback, useEffect, useRef, useState } from 'react';

export const NAV_PINNED_KEY = 'ecms.nav.floatingPinned';

/** Long enough that a pointer crossing the strip on its way elsewhere does not open the panel. */
export const HOVER_OPEN_DELAY_MS = 120;
/** Long enough to cross the gap from the strip into the panel, or to come back after overshooting. */
export const HOVER_CLOSE_DELAY_MS = 250;

export const loadNavPinned = (): boolean => {
  try {
    return localStorage.getItem(NAV_PINNED_KEY) === '1';
  } catch {
    return false;
  }
};

export const persistNavPinned = (pinned: boolean): void => {
  try {
    localStorage.setItem(NAV_PINNED_KEY, pinned ? '1' : '0');
  } catch {
    /* ignore */
  }
};

/**
 * Whether the floating panel is drawn. `held` is a surface opened from inside the panel — the
 * module launchpad — which would vanish with the panel if a hover-only panel closed under it.
 */
export const navPanelShown = (state: {
  pinned: boolean;
  hovering: boolean;
  held: boolean;
}): boolean => state.pinned || state.hovering || state.held;

export interface FloatingNav {
  pinned: boolean;
  shown: boolean;
  /** Open and keep open, or close a pinned panel. */
  togglePinned: () => void;
  /** Spread on the element that holds BOTH the strip and the floating panel. */
  hoverProps: { onMouseEnter: () => void; onMouseLeave: () => void };
  /** Keep the panel while a surface opened from it is up; call `release` when it closes. */
  hold: () => void;
  release: () => void;
}

export const useFloatingNav = (enabled: boolean): FloatingNav => {
  const [pinned, setPinned] = useState<boolean>(() => enabled && loadNavPinned());
  const [hovering, setHovering] = useState(false);
  const [held, setHeld] = useState(false);
  const timer = useRef<number | null>(null);

  const clearTimer = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clearTimer, []);

  const onMouseEnter = useCallback((): void => {
    if (!enabled) return;
    clearTimer();
    timer.current = window.setTimeout(() => setHovering(true), HOVER_OPEN_DELAY_MS);
  }, [enabled]);

  const onMouseLeave = useCallback((): void => {
    if (!enabled) return;
    clearTimer();
    timer.current = window.setTimeout(() => setHovering(false), HOVER_CLOSE_DELAY_MS);
  }, [enabled]);

  const togglePinned = useCallback((): void => {
    clearTimer();
    setPinned((was) => {
      persistNavPinned(!was);
      return !was;
    });
    // Closing a pinned panel closes it now, even with the pointer still over it.
    setHovering(false);
  }, []);

  // Escape closes a panel the pointer opened. A pinned one is closed with its own button.
  const shown = navPanelShown({ pinned, hovering, held });
  useEffect(() => {
    if (!enabled || !hovering || pinned || held) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setHovering(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, hovering, pinned, held]);

  return {
    pinned,
    shown: enabled && shown,
    togglePinned,
    hoverProps: { onMouseEnter, onMouseLeave },
    hold: useCallback(() => setHeld(true), []),
    release: useCallback(() => setHeld(false), []),
  };
};
