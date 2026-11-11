// The hover card's MECHANICS, shared by the driver card (`DriverHoverCard`) and the car card
// (`VehicleHoverCard`) — «عاوز لما اماوس يقف على كود عربيه يجيب بيانات زى اما اقف على اسم السواق
// نفس الموضوع كدا».
//
// What the two cards have in common, and why it lives in one place:
// - How it opens: after a short hover, or at once when the thing it is about is reached with the
//   keyboard (Tab); it closes when the pointer leaves, on blur, on Escape, on any press, and when a
//   drag starts.
// - ONE card open at a time, across both kinds: opening a car's card closes a driver's, and the
//   other way round — one slot for the whole page, not one per kind.
// - It is attached to the element that draws the name or the code (`triggerProps`), never to a
//   wrapper round it, so a board's layout is untouched.
// - It is drawn in a layer of its own over everything (a portal) and takes no pointer events, so a
//   click, a drag or a scroll goes to whatever is under it. It follows its trigger as a table
//   scrolls inside itself, and hides when the trigger leaves sight.
// - The frame — width, border, fill and shadow in both themes — is one class string.
//
// What each card says is its own; only these mechanics are shared.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../shared/lib/cn';

/** A beat before it opens — a pointer crossing a table is not asking about every name on it. */
const OPEN_DELAY_MS = 300;

/** A layout effect in the browser; a plain one where there is no layout (a static render). */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The card open now, if any, whichever kind — opening another closes it. */
let closeOpenCard: (() => void) | null = null;

/** What the trigger element takes. Empty when there is no card to show. */
export interface HoverCardTriggerProps {
  'aria-describedby'?: string;
  tabIndex?: number;
  ref?: (el: HTMLElement | null) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  onMouseDown?: () => void;
  onDragStart?: () => void;
}

/** Was this focus the keyboard's? A click focuses too, and a click is not a question. */
const keyboardFocus = (el: HTMLElement): boolean => {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
};

/**
 * The open/close control for one trigger. `active: false` — nothing to say about this name or
 * code — gives no trigger props at all, and the card never opens.
 *
 * `focusable: false` where the trigger sits inside something that already owns the keyboard — a
 * picker's box, a draggable chip — so it adds no tab stop of its own there; the hover still works.
 *
 * Spread `triggerProps` on the element and render the layer (`HoverCardLayer`) while `open`.
 */
export const useHoverCard = (
  active: boolean,
  { focusable = true }: { focusable?: boolean } = {},
): {
  open: boolean;
  id: string;
  anchor: RefObject<HTMLElement | null>;
  triggerProps: HoverCardTriggerProps;
} => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  /** How it opened: a hover closes when the pointer leaves; a keyboard focus stays until blur. */
  const via = useRef<'hover' | 'focus'>('hover');
  const id = useId();

  const control = useMemo(() => {
    const clear = (): void => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = undefined;
    };
    const close = (): void => {
      clear();
      setOpen(false);
      if (closeOpenCard === close) closeOpenCard = null;
    };
    const show = (): void => {
      clear();
      if (closeOpenCard !== null && closeOpenCard !== close) closeOpenCard();
      closeOpenCard = close;
      setOpen(true);
    };
    const setAnchor = (el: HTMLElement | null): void => {
      anchor.current = el;
    };
    return { clear, close, show, setAnchor };
  }, []);

  // Gone with its trigger: no timer left to fire, no card left open.
  useEffect(() => control.close, [control]);

  // While open: any press, or Escape anywhere, closes it.
  useEffect(() => {
    if (!open) return undefined;
    const press = (): void => control.close();
    const escape = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') control.close();
    };
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open, control]);

  if (!active) return { open: false, id, anchor, triggerProps: {} };

  const triggerProps: HoverCardTriggerProps = {
    ref: control.setAnchor,
    onMouseEnter: () => {
      if (open) return;
      via.current = 'hover';
      control.clear();
      timer.current = window.setTimeout(control.show, OPEN_DELAY_MS);
    },
    onMouseLeave: () => {
      if (via.current === 'hover') control.close();
      else control.clear();
    },
    onFocus: (e) => {
      if (!keyboardFocus(e.currentTarget)) return;
      via.current = 'focus';
      control.show();
    },
    onBlur: control.close,
    onKeyDown: (e) => {
      // Escape closes the card and only the card — not the dialog or the list around the trigger.
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        control.close();
      }
    },
    // A press on the trigger — a pick, the start of a drag — is not a question about it: the card
    // waiting to open does not.
    onMouseDown: control.close,
    onDragStart: control.close,
    ...(focusable ? { tabIndex: 0 } : {}),
    ...(open ? { 'aria-describedby': id } : {}),
  };
  return { open, id, anchor, triggerProps };
};

/** A box on the screen, as `getBoundingClientRect` gives it. */
export interface ScreenBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Is any of the name still in sight: inside the window AND inside every box that cuts it off. A
 * board's rows scroll inside the table's own box, under its sticky head, so a name leaves sight
 * there while it is still well inside the window.
 */
export const nameInSight = (
  name: ScreenBox,
  clips: readonly ScreenBox[],
  view: { width: number; height: number },
): boolean => {
  let top = 0;
  let left = 0;
  let bottom = view.height;
  let right = view.width;
  for (const clip of clips) {
    top = Math.max(top, clip.top);
    left = Math.max(left, clip.left);
    bottom = Math.min(bottom, clip.bottom);
    right = Math.min(right, clip.right);
  }
  return name.bottom > top && name.top < bottom && name.right > left && name.left < right;
};

/**
 * Every box round the name that cuts off what overflows it — the table's scrolling box, a rounded
 * card — each with the sticky head that covers its top, if it has one. Asked once per opening: a
 * scroll moves these boxes, it does not change which they are. Shared with the odometer's reason
 * card (`AlarmReasonCell`), which follows its chip the same way.
 */
export const clippingBoxes = (
  el: HTMLElement,
): { node: HTMLElement; head: HTMLElement | null }[] => {
  const found: { node: HTMLElement; head: HTMLElement | null }[] = [];
  for (
    let node = el.parentElement;
    node !== null && node !== document.body;
    node = node.parentElement
  ) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX === 'visible' && overflowY === 'visible') continue;
    const head = node.querySelector<HTMLElement>(':scope > table > thead');
    found.push({
      node,
      head: head !== null && getComputedStyle(head).position === 'sticky' ? head : null,
    });
  }
  return found;
};

/**
 * The card's frame, both kinds alike: the width, border, fill and shadow in both themes. The look
 * only — the layer adds its own placing classes.
 */
export const HOVER_CARD_FRAME =
  "w-72 max-w-[calc(100vw-16px)] rounded-xl border border-slate-200 bg-white p-3 text-start text-slate-900 shadow-2xl dark:border-[#2b3b6b] dark:bg-[#131d35] dark:text-white [font-family:'Cairo',sans-serif]";

/**
 * Where the card is drawn: ABOVE its trigger, below it when there is no room above; its start edge
 * on the trigger's start edge, kept on the screen. Measured before it is painted, and again as the
 * page scrolls or the card's own lines land.
 *
 * «Start» is the PAGE's, not the trigger's own: a car code is set `dir="ltr"` (a figure), and read
 * off the code's element, an Arabic board would hang the card off the code's LEFT edge — out over
 * the next column. The card itself is drawn in the page's direction (a portal on `body`), so its
 * start edge is the page's start edge.
 *
 * `mark` names the kind on the card's own element — `data-<mark>-hover-card` — for the specs and
 * the shoot scripts.
 */
export const HoverCardLayer = ({
  id,
  anchor,
  mark,
  children,
}: {
  id: string;
  anchor: RefObject<HTMLElement | null>;
  /** `captain` and `crew` are Operations' day-board cards (`BoardCrewCards`), on these mechanics. */
  mark: 'driver' | 'vehicle' | 'captain' | 'crew';
  children: ReactNode;
}): JSX.Element | null => {
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  useBrowserLayoutEffect(() => {
    const clips = anchor.current === null ? [] : clippingBoxes(anchor.current);
    const place = (): void => {
      const target = anchor.current;
      const box = panel.current;
      if (target === null || box === null) return;
      const rect = target.getBoundingClientRect();
      const cuts = clips.map(({ node, head }): ScreenBox => {
        const edge = node.getBoundingClientRect();
        return head === null
          ? edge
          : {
              top: Math.max(edge.top, head.getBoundingClientRect().bottom),
              right: edge.right,
              bottom: edge.bottom,
              left: edge.left,
            };
      });
      // The trigger scrolled out of sight: the card does not float on without it.
      if (!nameInSight(rect, cuts, { width: window.innerWidth, height: window.innerHeight })) {
        setAt(null);
        return;
      }
      const width = box.offsetWidth;
      const height = box.offsetHeight;
      const gap = 6;
      const top =
        rect.top - gap - height >= 8
          ? rect.top - gap - height
          : Math.min(rect.bottom + gap, window.innerHeight - height - 8);
      const rtl = getComputedStyle(box).direction === 'rtl';
      const start = rtl ? rect.right - width : rect.left;
      setAt({
        top: Math.max(8, top),
        left: Math.min(window.innerWidth - width - 8, Math.max(8, start)),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (panel.current !== null) watch?.observe(panel.current);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      watch?.disconnect();
    };
  }, [anchor]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={panel}
      id={id}
      role="tooltip"
      {...{ [`data-${mark}-hover-card`]: 'true' }}
      // Unseen until it has its place, so it never flashes at the corner of the screen.
      style={at === null ? { top: 0, left: 0, visibility: 'hidden' } : at}
      className={cn('pointer-events-none fixed z-[110] animate-menu-in', HOVER_CARD_FRAME)}
    >
      {children}
    </div>,
    document.body,
  );
};

/** A fact the books do not have, or one still on its way — never a guess. */
export const HoverCardMissing = ({ loading = false }: { loading?: boolean }): JSX.Element => (
  <span className="text-slate-400 dark:text-slate-500">{loading ? '…' : '—'}</span>
);

/** One line of a card: the label, then the value. Inside the card's `<dl>` grid. */
export const HoverCardFact = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element => (
  <>
    <dt className="whitespace-nowrap font-semibold text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="min-w-0 break-words font-bold text-slate-800 dark:text-slate-100">{children}</dd>
  </>
);

/** The `<dl>` the facts sit in — label column as wide as its longest label, values beside. */
export const HOVER_CARD_FACTS =
  'mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-[13px] leading-snug';

/** The small square the card's icon sits in, at the start of its head line. */
export const HOVER_CARD_ICON =
  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-300';
