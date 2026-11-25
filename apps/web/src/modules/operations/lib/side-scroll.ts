// Round 34 E — «لوحة التشغيلة»'s totals in the toolbar: one line, never wrapped. When the catalog
// outgrows the room the line scrolls sideways inside its own box (the last resort — the chips are
// tightened first), and this says so and lets a plain mouse wheel move it:
//   · the edge that hides chips fades (`sideFade`), so the line reads as going on;
//   · a wheel turned over it moves it toward its end or back to its start (`wheelToSide`) — and lets
//     the turn through to the page once it is at that edge, or when the wheel is already sideways;
//   · a chip reached by Tab is brought clear of the box's edges and their fade (`sideReveal`) — the
//     browser leaves a PARTLY seen focused chip where it is, under the fade or past the edge.
// Pure, apart from `followSide` (the listeners, on any box) and the hook, which only read the box and
// write its scroll — at once, never smoothly, so a reduced-motion reader sees no glide.
import { useEffect, useState, type RefObject } from 'react';

/** The fade's width over an edge that hides chips — and the room a chip brought into view keeps. */
export const SIDE_FADE = 28;

/** What the box hides: chips before its start edge, chips past its end edge. */
export interface SideEdges {
  start: boolean;
  end: boolean;
}

export const NO_EDGES: SideEdges = { start: false, end: false };

/**
 * Where the box stands. `scrollLeft` is read as a distance from the reading start: Chrome and Firefox
 * count it 0 → negative in a right-to-left box, 0 → positive in a left-to-right one. A pixel of slack
 * on each side (zoom draws fractions).
 */
export const sideEdges = (box: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): SideEdges => {
  const gone = Math.abs(box.scrollLeft);
  return {
    start: gone > 1,
    end: gone + box.clientWidth < box.scrollWidth - 1,
  };
};

/**
 * How far a wheel's turn moves the box sideways, in `scrollLeft`'s own sign — or null to leave the
 * turn to the browser: a sideways wheel (a trackpad's swipe) already moves the box; a turn toward an
 * edge the box is at belongs to the page. Down is toward the end: leftwards in Arabic.
 */
export const wheelToSide = (
  wheel: { deltaX: number; deltaY: number },
  edges: SideEdges,
  rtl: boolean,
): number | null => {
  if (wheel.deltaY === 0 || Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY)) return null;
  const towardEnd = wheel.deltaY > 0;
  if (towardEnd ? !edges.end : !edges.start) return null;
  return rtl ? -wheel.deltaY : wheel.deltaY;
};

/** The fade over the edge(s) that hide chips — a mask, so it works on any ground, dark or light. */
export const sideFade = (edges: SideEdges, rtl: boolean, width = SIDE_FADE): string | undefined => {
  if (!edges.start && !edges.end) return undefined;
  // The gradient runs left → right; in Arabic the start is the right.
  const left = rtl ? edges.end : edges.start;
  const right = rtl ? edges.start : edges.end;
  const from = left ? `transparent 0, #000 ${width}px` : '#000 0';
  const to = right ? `#000 calc(100% - ${width}px), transparent 100%` : '#000 100%';
  return `linear-gradient(to right, ${from}, ${to})`;
};

/**
 * How far to move the box (in `scrollLeft`, either direction of reading) so a focused chip stands
 * whole inside it, `pad` clear of each edge — the fade's width — or 0 when it already does. Read off
 * the two boxes on the screen: a larger `scrollLeft` moves the chips LEFT, in Arabic as in English.
 * A chip wider than the room keeps its reading start in sight. The browser clamps at the line's ends.
 */
export const sideReveal = (
  box: { left: number; right: number },
  chip: { left: number; right: number },
  rtl: boolean,
  pad = SIDE_FADE,
): number => {
  const from = box.left + pad;
  const to = box.right - pad;
  const fromStart = rtl ? chip.right - to : chip.left - from;
  if (chip.right - chip.left > to - from) return Math.round(fromStart);
  if (chip.left < from) return Math.round(chip.left - from);
  if (chip.right > to) return Math.round(chip.right - to);
  return 0;
};

/** Was this focus the keyboard's (`:focus-visible`)? Where the question cannot be asked, yes. */
const keyboardFocus = (chip: { matches?: (selector: string) => boolean }): boolean => {
  if (typeof chip.matches !== 'function') return true;
  try {
    return chip.matches(':focus-visible');
  } catch {
    return true;
  }
};

/** What `followSide` reads and writes: a scrolling box (an element on the page, or a stand-in). */
export interface SideBox extends EventTarget {
  scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly children: ArrayLike<Element> | HTMLCollection;
  getBoundingClientRect(): { left: number; right: number };
}

/**
 * The box's listeners — its scroll, a plain wheel over it, a chip of it taking the focus, and its
 * size and its chips' — each telling `onEdges` where the box now stands. Returns the way to undo
 * them. `rtl` is asked at the moment (the page's language can change under the box).
 */
export const followSide = (
  box: SideBox,
  { onEdges, rtl }: { onEdges: (edges: SideEdges) => void; rtl: () => boolean },
): (() => void) => {
  const look = (): void => onEdges(sideEdges(box));
  const onWheel = (event: Event): void => {
    const by = wheelToSide(event as WheelEvent, sideEdges(box), rtl());
    if (by === null) return;
    event.preventDefault();
    box.scrollLeft += by;
  };
  const onFocus = (event: Event): void => {
    const chip = event.target as {
      getBoundingClientRect?: () => { left: number; right: number };
      matches?: (selector: string) => boolean;
    } | null;
    if ((chip as unknown) === box || typeof chip?.getBoundingClientRect !== 'function') return;
    // The keyboard's focus only: a press focuses its chip too, and moving the line under a pressing
    // pointer would land the release on another chip — the press lost.
    if (!keyboardFocus(chip)) return;
    const by = sideReveal(box.getBoundingClientRect(), chip.getBoundingClientRect(), rtl());
    if (by === 0) return;
    box.scrollLeft += by;
    look();
  };
  look();
  box.addEventListener('scroll', look, { passive: true });
  box.addEventListener('wheel', onWheel, { passive: false });
  box.addEventListener('focusin', onFocus);
  const sized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(look);
  if (sized !== null) {
    sized.observe(box as unknown as Element);
    for (const chip of Array.from(box.children)) sized.observe(chip);
  }
  const changed =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
          for (const chip of Array.from(box.children)) sized?.observe(chip);
          look();
        });
  changed?.observe(box as unknown as Node, { childList: true, subtree: true, characterData: true });
  return () => {
    box.removeEventListener('scroll', look);
    box.removeEventListener('wheel', onWheel);
    box.removeEventListener('focusin', onFocus);
    sized?.disconnect();
    changed?.disconnect();
  };
};

/**
 * The box's edges, kept current (`followSide`), for the fade: a plain wheel turned over it moves it
 * sideways, and a chip reached by Tab comes into view clear of the fade.
 */
export const useSideScroll = (ref: RefObject<HTMLElement>): SideEdges => {
  const [edges, setEdges] = useState<SideEdges>(NO_EDGES);
  useEffect(() => {
    const box = ref.current;
    if (box === null) return undefined;
    return followSide(box, {
      onEdges: (next) =>
        setEdges((current) =>
          current.start === next.start && current.end === next.end ? current : next,
        ),
      rtl: () => getComputedStyle(box).direction === 'rtl',
    });
  }, [ref]);
  return edges;
};
