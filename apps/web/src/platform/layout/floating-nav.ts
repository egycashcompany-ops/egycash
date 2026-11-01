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
// The panel stays mounted in all three: hidden makes it transparent and `inert` (out of the tab
// order, the accessibility tree and the pointer's way). Unmounting it on every hover threw away
// what the person did in it — a folded section unfolded again, the page list scrolled back to the
// top — and switching it between floating and docked must not remount it either, or the pin would
// lose the keyboard focus the moment it was pressed. It is never hidden with `visibility`: a
// visibility transition starts at its hidden end, so for that first frame nothing in the panel
// can take the focus, and the strip's focus handed to it was lost (the keyboard could not reach
// the panel at all).
//
// Every change of state goes through `navReducer`, a plain function, so the rules can be tested
// without a browser; the hook only feeds it the pointer, the focus and the keyboard.
//
// The pinned choice is remembered on this device, under a key of its own. The old in-column
// panel's key meant "expanded" unless someone had collapsed it, so carried over it would have
// docked the panel for nearly everyone, and the hover the owner asked for would never be seen.
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';

export const NAV_PINNED_KEY = 'ecms.nav.floatingPinned';

/** Long enough that a pointer crossing the strip on its way elsewhere does not open the panel. */
export const HOVER_OPEN_DELAY_MS = 120;
/** Long enough to cross the gap from the strip into the panel, or to come back after overshooting. */
export const HOVER_CLOSE_DELAY_MS = 250;

/** How long the pointer must stay (opening) or stay away (closing) before the panel follows it. */
export const hoverDelay = (opening: boolean): number =>
  opening ? HOVER_OPEN_DELAY_MS : HOVER_CLOSE_DELAY_MS;

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

// ── The rules ───────────────────────────────────────────────────────────────

export interface NavState {
  pinned: boolean;
  /** The pointer is on the strip or the panel (after the hover delays). */
  pointer: boolean;
  /** The keyboard focus is on the strip or the panel. */
  focused: boolean;
  /** A surface opened from the panel (the module launchpad) is up and needs the panel under it. */
  held: boolean;
}

export type NavAction =
  | { type: 'pointer'; on: boolean }
  | { type: 'focus'; on: boolean }
  | { type: 'escape' }
  | { type: 'hold' }
  | { type: 'release' }
  /** `byPointer`: pressed with a mouse or a finger, which is ON the panel at that moment. */
  | { type: 'toggle'; byPointer: boolean };

export const initialNavState = (pinned: boolean): NavState => ({
  pinned,
  pointer: false,
  focused: false,
  held: false,
});

export const navReducer = (state: NavState, action: NavAction): NavState => {
  switch (action.type) {
    case 'pointer':
      return state.pointer === action.on ? state : { ...state, pointer: action.on };
    case 'focus':
      return state.focused === action.on ? state : { ...state, focused: action.on };
    case 'escape':
      // Escape closes a panel the pointer or the focus floated. A pinned one is undocked with its
      // pin, and a held one belongs to the launchpad above it, which Escape closes first.
      if (state.pinned || state.held) return state;
      return { ...state, pointer: false, focused: false };
    case 'hold':
      return state.held ? state : { ...state, held: true };
    case 'release':
      return state.held ? { ...state, held: false } : state;
    case 'toggle':
      // Unpinned by a pointer press, the panel floats on under that pointer and closes once it
      // leaves — it does not vanish under the click. The hover-open delay may not have run out yet
      // (a quick move and click, or a tap), so the press itself is the proof the pointer is there.
      // Pressed from the keyboard, the keyboard is on the pin — even if a click put the focus there
      // earlier — so the panel floats on with it rather than vanishing from under a visible control.
      return {
        ...state,
        pinned: !state.pinned,
        pointer: state.pinned && action.byPointer ? true : state.pointer,
        focused: action.byPointer ? state.focused : true,
      };
  }
};

export type NavPanelMode = 'hidden' | 'floating' | 'docked';

/**
 * How the panel is drawn. Pinned wins: a pinned panel is in the layout whatever the pointer does.
 * Otherwise the pointer or the focus floats it over the page, and so does `held` — the module
 * launchpad opened from inside the panel, which would vanish with it if the panel closed under it.
 */
export const navPanelMode = (state: NavState): NavPanelMode => {
  if (state.pinned) return 'docked';
  return state.pointer || state.focused || state.held ? 'floating' : 'hidden';
};

// ── Reading the DOM ─────────────────────────────────────────────────────────

/** The part of a React pointer or focus event the panel reads. */
interface BoundaryEvent {
  currentTarget: Element;
  target: EventTarget | null;
  relatedTarget: EventTarget | null;
}

/**
 * Whether a node is inside the box IN THE DOM. React sends pointer and focus events up through
 * portals, so the module launchpad (a portal opened from the panel) counts as inside the box to
 * React: moving the pointer onto it would never "leave", and the panel would stay open after the
 * launchpad closed with the pointer far away. Entering and leaving are decided by the DOM instead;
 * while the launchpad is up, the hold keeps the panel.
 */
export const focusInside = (box: Element, target: EventTarget | null): boolean =>
  typeof Node !== 'undefined' && target instanceof Node && box.contains(target);

/**
 * Whether a mouseover, mouseout or blur crosses the box's own edge. They fire on every child
 * crossed, so only one whose target is in the box and whose other end is outside it counts — and
 * one whose target is not in the box at all is a portal's event, bubbled up by React.
 */
export const crossesEdge = (
  box: Element,
  target: EventTarget | null,
  related: EventTarget | null,
): boolean => focusInside(box, target) && !focusInside(box, related);

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

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * The control in `within` that stands for `from`: the same page (by its link), the module switcher
 * for the module switcher, else the current page or module, else the first control there is. Used
 * to hand the keyboard focus between the strip and the panel without losing the person's place.
 */
export const counterpart = (from: Element | null, within: ParentNode): HTMLElement | null => {
  const href = from?.getAttribute('href') ?? null;
  if (href !== null) {
    const links = Array.from(within.querySelectorAll<HTMLElement>('a[href]'));
    const same = links.find((a) => a.getAttribute('href') === href);
    if (same !== undefined) return same;
  }
  if (from?.getAttribute('aria-haspopup') === 'dialog') {
    const switcher = within.querySelector<HTMLElement>('[aria-haspopup="dialog"]');
    if (switcher !== null) return switcher;
  }
  return (
    within.querySelector<HTMLElement>('[aria-current="page"]') ??
    within.querySelector<HTMLElement>(FOCUSABLE)
  );
};

/** The box's own strip or rail: every child but the panel. */
export const homeOf = (box: Element): Element | null =>
  Array.from(box.children).find((child) => !child.hasAttribute('data-nav-panel')) ?? null;

// ── The hook ────────────────────────────────────────────────────────────────

export interface FloatingNav {
  pinned: boolean;
  /** Always `hidden` where the panel is not managed (the mobile drawer shows it as it is). */
  mode: NavPanelMode;
  /** A surface opened from the panel is up (see `hold`). */
  held: boolean;
  /** Dock the panel into the layout, or unpin it back to floating with the pointer. */
  togglePinned: (byPointer: boolean) => void;
  /** Spread on the element that holds BOTH the strip and the panel. */
  hoverProps: {
    ref: (el: HTMLElement | null) => void;
    onMouseOver: (e: BoundaryEvent) => void;
    onMouseOut: (e: BoundaryEvent) => void;
    onFocus: (e: BoundaryEvent) => void;
    onBlur: (e: BoundaryEvent) => void;
  };
  /** Keep the panel while a surface opened from it is up; call `release` when it closes. */
  hold: () => void;
  release: () => void;
  /**
   * Put the focus back on a control in the box WITHOUT that counting as the keyboard arriving —
   * for a launchpad closing, which returns the focus to the switcher that opened it. Counted, the
   * panel would pop open over the page after Alt+M then Escape, which nobody asked for.
   */
  restoreFocus: (el: HTMLElement | null) => void;
  /**
   * The same for the panel's OWN launchpad: loud (the keyboard arriving) if the keyboard had the
   * panel open when it was raised, quiet otherwise.
   */
  returnFocus: (el: HTMLElement | null) => void;
}

export const useFloatingNav = (enabled: boolean): FloatingNav => {
  const [state, dispatch] = useReducer(navReducer, enabled, (on: boolean) =>
    initialNavState(on && loadNavPinned()),
  );
  const mode = enabled ? navPanelMode(state) : 'hidden';
  const box = useRef<HTMLElement | null>(null);
  const muted = useRef(false);
  // Moves the focus without that counting as the keyboard arriving: the hook's own handovers
  // (strip ↔ panel) and a closing launchpad's return. Counted, a handover the pointer caused would
  // keep the panel floating after the pointer left, and Alt+M then Escape would float it open.
  const quietFocus = useCallback((el: HTMLElement | null): void => {
    muted.current = true;
    try {
      el?.focus();
    } finally {
      muted.current = false;
    }
  }, []);
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
    const id = window.setTimeout(() => {
      timer.current = null;
      dispatch({ type: 'pointer', on: opening });
    }, hoverDelay(opening));
    timer.current = { id, opening };
  };
  useEffect(() => clearTimer, []);

  // The focus is checked against the DOM, not only trusted from the last blur: React sends no blur
  // when the focused element is removed (a favourite unpinned from its own star), and the panel
  // would then float on forever with the focus already gone.
  const syncFocus = useCallback((): void => {
    const el = box.current;
    if (el !== null && !el.contains(document.activeElement)) dispatch({ type: 'focus', on: false });
  }, []);

  const ref = useCallback((el: HTMLElement | null): void => {
    box.current = el;
  }, []);

  const onMouseOver = useCallback(
    (e: BoundaryEvent): void => {
      if (!enabled || !crossesEdge(e.currentTarget, e.target, e.relatedTarget)) return;
      if (timer.current?.opening === true) return;
      schedule(true);
    },
    [enabled],
  );

  const onMouseOut = useCallback(
    (e: BoundaryEvent): void => {
      if (!enabled || !crossesEdge(e.currentTarget, e.target, e.relatedTarget)) return;
      schedule(false);
      syncFocus();
    },
    [enabled, syncFocus],
  );

  // Tab into the strip opens the panel at once, so its pages and its pin can be reached from the
  // keyboard; it closes when the focus leaves the strip and the panel both. Moving between two of
  // their controls is not leaving.
  const onFocus = useCallback(
    (e: BoundaryEvent): void => {
      if (!enabled || muted.current) return;
      if (!focusInside(e.currentTarget, e.target) || !keyboardFocus(e.target)) return;
      dispatch({ type: 'focus', on: true });
    },
    [enabled],
  );

  const onBlur = useCallback(
    (e: BoundaryEvent): void => {
      if (!enabled || !crossesEdge(e.currentTarget, e.target, e.relatedTarget)) return;
      dispatch({ type: 'focus', on: false });
    },
    [enabled],
  );

  useEffect(() => {
    if (state.focused) syncFocus();
  });
  useEffect(() => {
    if (!enabled || !state.focused) return undefined;
    // A click or a Tab that lands outside, after the focus was dropped somewhere no blur reported.
    document.addEventListener('focusin', syncFocus, true);
    document.addEventListener('pointerdown', syncFocus, true);
    return () => {
      document.removeEventListener('focusin', syncFocus, true);
      document.removeEventListener('pointerdown', syncFocus, true);
    };
  }, [enabled, state.focused, syncFocus]);

  // Showing and hiding, in the DOM, before the browser paints:
  //   • hiding with the KEYBOARD focus in the panel (Escape) brings it back to the same place in the
  //     strip or rail first, so it is not dropped on <body>. A focus a mouse click left there is
  //     let go instead: parked on a strip or rail control, the next Space or Enter would press it;
  //   • the hidden panel is `inert`;
  //   • where the panel covers the strip (the launchpad's, marked `data-nav-covered`), keyboard
  //     focus on the strip is handed to the same control in the panel — a mouse click's focus is
  //     let go instead, since focusing the twin would scroll the list to it — and the strip is
  //     `inert` while the panel shows: its controls are behind an opaque panel, and Tab would walk
  //     through every one of them unseen. Only once the focus is out of it: `inert` on a focused
  //     element drops the focus.
  // After EVERY render, not on a change of mode: the box is not in the DOM while the menu loads, so
  // a panel that mounts already hidden would otherwise never be made inert. Each step only acts on
  // where the focus is now, so running it again changes nothing.
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const panel = el.querySelector<HTMLElement>('[data-nav-panel]');
    const covered = el.querySelector<HTMLElement>('[data-nav-covered]');
    const showing = mode !== 'hidden';
    if (panel !== null) {
      const active = document.activeElement;
      if (!showing && panel.contains(active)) {
        const home = homeOf(el);
        if (keyboardFocus(active) && home !== null) {
          home.removeAttribute('inert');
          quietFocus(counterpart(active, home));
        } else if (active instanceof HTMLElement) {
          active.blur();
        }
      }
      panel.toggleAttribute('inert', !showing);
    }
    if (covered !== null) {
      const active = document.activeElement;
      if (showing && panel !== null && covered.contains(active)) {
        if (keyboardFocus(active)) quietFocus(counterpart(active, panel));
        else if (active instanceof HTMLElement) active.blur();
      }
      covered.toggleAttribute('inert', showing && !covered.contains(document.activeElement));
    }
  });

  // Escape closes a floating panel; the effect above brings a focus inside it home first.
  useEffect(() => {
    if (mode !== 'floating' || state.held) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      clearTimer();
      dispatch({ type: 'escape' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, state.held]);

  // Remembered on this device, from the person's own presses only.
  const lastPersisted = useRef(state.pinned);
  useEffect(() => {
    if (state.pinned === lastPersisted.current) return;
    lastPersisted.current = state.pinned;
    persistNavPinned(state.pinned);
  }, [state.pinned]);

  const togglePinned = useCallback((byPointer: boolean): void => {
    if (byPointer) clearTimer();
    dispatch({ type: 'toggle', byPointer });
  }, []);

  // Whether the keyboard had the panel open when the launchpad was raised from it (see returnFocus).
  const focusedNow = useRef(state.focused);
  useLayoutEffect(() => {
    focusedNow.current = state.focused;
  });
  const keyboardHeld = useRef(false);
  const hold = useCallback((): void => {
    keyboardHeld.current = focusedNow.current;
    dispatch({ type: 'hold' });
  }, []);
  const release = useCallback((): void => dispatch({ type: 'release' }), []);

  // The panel's own launchpad closing gives the focus back to the panel's switcher. That counts as
  // the keyboard arriving only if the keyboard had the panel open when the launchpad was raised:
  // otherwise a panel the pointer floated would stay open over the page after Alt+M then Escape,
  // with the pointer long gone.
  const returnFocus = useCallback(
    (el: HTMLElement | null): void => {
      const loud = keyboardHeld.current;
      keyboardHeld.current = false;
      if (loud) el?.focus();
      else quietFocus(el);
    },
    [quietFocus],
  );

  // A launchpad opened from the strip may close while the panel floats over the strip (the pointer
  // came to rest on it meanwhile): the strip's switcher is inert then, and the focus goes to the
  // panel's own switcher instead of being dropped.
  const restoreFocus = useCallback(
    (el: HTMLElement | null): void => {
      const panel = box.current?.querySelector<HTMLElement>('[data-nav-panel]') ?? null;
      const covered = el?.closest('[inert]') ?? null;
      quietFocus(
        covered !== null && panel !== null && !panel.hasAttribute('inert')
          ? counterpart(el, panel)
          : el,
      );
    },
    [quietFocus],
  );

  return {
    pinned: state.pinned,
    mode,
    held: state.held,
    togglePinned,
    hoverProps: { ref, onMouseOver, onMouseOut, onFocus, onBlur },
    hold,
    release,
    restoreFocus,
    returnFocus,
  };
};
