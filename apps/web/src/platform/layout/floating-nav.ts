// The navigation panel on a desktop: OVER the page while it is only being looked at, IN the layout
// once it is pinned.
//
// «الsidebar يظهر لما اعمل hover عليه ويظهر فوق الكونتنت ميخدش حايز لو عاوز افتحه يظهر برضو فوق
// الجدول ميخدش حايز», and then, once the pin existed: «لما اعمل تثبيت يبقى موجود بس يلخد من الحايز
// عادى». So the panel has three states (`navPanelMode`):
//   • hidden — only the slim icon strip stands beside the page;
//   • floating — the pointer (or the keyboard focus) is on the strip or the panel. The panel is
//     drawn OVER the page from the strip's edge, and the table underneath keeps its whole width;
//   • docked — pinned with the pin at the top of the panel, right after the module switcher
//     (NavPinButton). The panel stands in the layout like any column and the page narrows beside
//     it, until it is unpinned. There is no other open or close button: one gesture to look at the
//     menu, one pin to keep it.
//
// The pinned choice is remembered on this device, under a key of its own. The old in-column
// panel's key meant "expanded" unless someone had collapsed it, so carried over it would have
// docked the panel for nearly everyone, and the hover the owner asked for would never be seen.
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

export type NavPanelMode = 'hidden' | 'floating' | 'docked';

/**
 * How the panel is drawn. Pinned wins: a pinned panel is in the layout whatever the pointer does.
 * Otherwise the pointer or the focus floats it over the page, and so does `held` — a surface opened
 * from inside the panel (the module launchpad), which would vanish with the panel if a hover-only
 * panel closed under it.
 */
export const navPanelMode = (state: {
  pinned: boolean;
  hovering: boolean;
  held: boolean;
}): NavPanelMode => {
  if (state.pinned) return 'docked';
  return state.hovering || state.held ? 'floating' : 'hidden';
};

/** The part of a React pointer or focus event the panel reads. */
interface BoundaryEvent {
  currentTarget: Element;
  target: EventTarget | null;
  relatedTarget: EventTarget | null;
}

/**
 * Whether an event happened inside the box in the DOM. React sends pointer and focus events up
 * through portals, so the module launchpad (a portal opened from the panel) counts as INSIDE the
 * box to React: moving the pointer onto it never "leaves", and the panel would stay open after the
 * launchpad closed with the pointer far away. Entering and leaving are decided by the DOM instead;
 * while the launchpad is up, the hold keeps the panel.
 */
export const focusInside = (box: Element, target: EventTarget | null): boolean =>
  typeof Node !== 'undefined' && target instanceof Node && box.contains(target);

/**
 * Whether focus arrived by keyboard. A mouse click focuses the button or link it lands on too, and
 * counting that would keep a hover panel open after the pointer left it, until a click elsewhere.
 * The browser already draws that line for focus rings, with `:focus-visible`.
 */
export const keyboardFocus = (target: EventTarget | null): boolean => {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  try {
    return target.matches(':focus-visible');
  } catch {
    return false;
  }
};

export interface FloatingNav {
  pinned: boolean;
  /** Always `hidden` where the panel is not managed (the mobile drawer shows it as it is). */
  mode: NavPanelMode;
  /** Dock the panel into the layout, or unpin it back to floating with the pointer. */
  togglePinned: () => void;
  /** Spread on the element that holds BOTH the strip and the floating panel. */
  hoverProps: {
    onMouseOver: (e: BoundaryEvent) => void;
    onMouseOut: (e: BoundaryEvent) => void;
    onFocus: (e: BoundaryEvent) => void;
    onBlur: (e: BoundaryEvent) => void;
  };
  /** Keep the panel while a surface opened from it is up; call `release` when it closes. */
  hold: () => void;
  release: () => void;
}

export const useFloatingNav = (enabled: boolean): FloatingNav => {
  const [pinned, setPinned] = useState<boolean>(() => enabled && loadNavPinned());
  // The pointer and the keyboard focus are tracked apart: each opens the panel, and it closes only
  // once neither is on the strip or the panel.
  const [pointer, setPointer] = useState(false);
  const [focused, setFocused] = useState(false);
  const [held, setHeld] = useState(false);
  // One timer, for whichever change of the pointer is on its way.
  const timer = useRef<{ id: number; opening: boolean } | null>(null);

  const clearTimer = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current.id);
      timer.current = null;
    }
  };
  const schedule = (opening: boolean): void => {
    clearTimer();
    const id = window.setTimeout(
      () => {
        timer.current = null;
        setPointer(opening);
      },
      opening ? HOVER_OPEN_DELAY_MS : HOVER_CLOSE_DELAY_MS,
    );
    timer.current = { id, opening };
  };
  useEffect(() => clearTimer, []);

  // `mouseover` and `mouseout` fire on every child crossed, so only a crossing of the box's own
  // edge counts: entering from outside it, or leaving for somewhere outside it.
  const onMouseOver = useCallback(
    (e: BoundaryEvent): void => {
      if (!enabled || !focusInside(e.currentTarget, e.target)) return;
      if (focusInside(e.currentTarget, e.relatedTarget)) return;
      if (timer.current?.opening === true) return;
      schedule(true);
    },
    [enabled],
  );

  const onMouseOut = useCallback(
    (e: BoundaryEvent): void => {
      if (!enabled || !focusInside(e.currentTarget, e.target)) return;
      if (focusInside(e.currentTarget, e.relatedTarget)) return;
      schedule(false);
    },
    [enabled],
  );

  // Tab into the strip opens the panel at once, so its pages and its pin can be reached from the
  // keyboard; it closes when the focus leaves the strip and the panel both. Moving between two of
  // their buttons is not leaving.
  const onFocus = useCallback(
    (e: BoundaryEvent): void => {
      if (!enabled || !focusInside(e.currentTarget, e.target) || !keyboardFocus(e.target)) return;
      setFocused(true);
    },
    [enabled],
  );

  const onBlur = useCallback(
    (e: BoundaryEvent): void => {
      if (!enabled || !focusInside(e.currentTarget, e.target)) return;
      if (focusInside(e.currentTarget, e.relatedTarget)) return;
      setFocused(false);
    },
    [enabled],
  );

  // Unpinning hands the panel back to the pointer: pressed from inside it, the panel floats while
  // the pointer is still on it and closes once it leaves, rather than vanishing under the click.
  // The pointer and the focus are tracked while it is docked too, so they are right at that moment.
  const togglePinned = useCallback((): void => {
    setPinned((was) => {
      persistNavPinned(!was);
      return !was;
    });
  }, []);

  // Escape closes a panel the pointer or the focus opened. A pinned one is undocked with its pin.
  const hovering = pointer || focused;
  const mode = enabled ? navPanelMode({ pinned, hovering, held }) : 'hidden';
  useEffect(() => {
    if (!enabled || !hovering || pinned || held) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      clearTimer();
      setPointer(false);
      setFocused(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, hovering, pinned, held]);

  return {
    pinned,
    mode,
    togglePinned,
    hoverProps: { onMouseOver, onMouseOut, onFocus, onBlur },
    hold: useCallback(() => setHeld(true), []),
    release: useCallback(() => setHeld(false), []),
  };
};
