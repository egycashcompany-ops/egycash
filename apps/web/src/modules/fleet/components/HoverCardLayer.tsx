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
  /** A toggle's only (`toggle: true`): a press or a tap opens it, or closes it. */
  onClick?: () => void;
}

/** How an open card came: under the pointer, by the keyboard's focus, or by a press or a tap. */
export type HoverCardVia = 'hover' | 'focus' | 'press';

/**
 * Round 34 H critic — what a press on a TOGGLE's trigger does (`useHoverCard(…, { toggle: true })`).
 * Closed, it opens. Open under the pointer, it stays and is held there: the pointer can leave
 * without closing it. Open by the keyboard's focus or by an earlier press or tap, it closes.
 * Nothing is reached by hover alone: a tap and the keyboard each open it.
 */
export const togglePress = (open: boolean, via: HoverCardVia): 'show' | 'close' =>
  open && via !== 'hover' ? 'close' : 'show';

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
  {
    focusable = true,
    toggle = false,
    when,
  }: {
    focusable?: boolean;
    /**
     * Round 34 H critic — a TOGGLE (a toggletip): what the trigger says lives only in the card, so
     * a press or a tap opens it too, and closes it again (`togglePress`). A touch screen has no
     * hover, and a sighted keyboard user sees no `title`. Its own trigger's press does not count as
     * a press elsewhere. Left out: a press closes the card, as on a name that is also a pick.
     */
    toggle?: boolean;
    /**
     * Round 26 — a last word before the card opens, asked as the pointer (or the focus) comes AND
     * again when the delay ends: «توزيع المحصنات»'s van card says no while a drag is on, while a
     * «نقل إلى…» menu is open, or over a captain's own name. Left out: always yes.
     */
    when?: () => boolean;
  } = {},
): {
  open: boolean;
  id: string;
  anchor: RefObject<HTMLElement | null>;
  triggerProps: HoverCardTriggerProps;
  /** Round 26 — the hover's own delayed open, for a trigger that re-arms inside itself. */
  arm: () => void;
  /** Round 26 — the waiting open called off, and the card closed. */
  dismiss: () => void;
} => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  /**
   * How it opened: a hover closes when the pointer leaves; a keyboard focus stays until blur; a
   * toggle's press stays until another press, a press elsewhere, blur or Escape.
   */
  const via = useRef<HoverCardVia>('hover');
  const id = useId();
  // The latest `when`, read when the delay ends — not the one of the render that armed it.
  const allowed = useRef(when);
  useEffect(() => {
    allowed.current = when;
  });

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
      if (allowed.current !== undefined && !allowed.current()) return;
      if (closeOpenCard !== null && closeOpenCard !== close) closeOpenCard();
      closeOpenCard = close;
      setOpen(true);
    };
    const setAnchor = (el: HTMLElement | null): void => {
      anchor.current = el;
    };
    const arm = (): void => {
      if (allowed.current !== undefined && !allowed.current()) return;
      via.current = 'hover';
      clear();
      timer.current = window.setTimeout(show, OPEN_DELAY_MS);
    };
    return { clear, close, show, setAnchor, arm };
  }, []);

  // Gone with its trigger: no timer left to fire, no card left open.
  useEffect(() => control.close, [control]);

  // While open: any press, or Escape anywhere, closes it — a toggle's own trigger aside: its press
  // is its own click's to answer.
  useEffect(() => {
    if (!open) return undefined;
    const press = (event: PointerEvent): void => {
      const target = event.target;
      if (toggle && target instanceof Node && anchor.current?.contains(target) === true) return;
      control.close();
    };
    const escape = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') control.close();
    };
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open, control, toggle]);

  if (!active) {
    return {
      open: false,
      id,
      anchor,
      triggerProps: {},
      arm: () => undefined,
      dismiss: () => undefined,
    };
  }

  const triggerProps: HoverCardTriggerProps = {
    ref: control.setAnchor,
    onMouseEnter: () => {
      if (open) return;
      control.arm();
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
    // waiting to open does not. A toggle's press IS the question: its click answers it.
    ...(toggle
      ? {
          onClick: () => {
            if (togglePress(open, via.current) === 'close') {
              control.close();
              return;
            }
            via.current = 'press';
            control.show();
          },
        }
      : { onMouseDown: control.close }),
    onDragStart: control.close,
    ...(focusable ? { tabIndex: 0 } : {}),
    ...(open ? { 'aria-describedby': id } : {}),
  };
  return {
    open,
    id,
    anchor,
    triggerProps,
    arm: () => {
      if (!open) control.arm();
    },
    dismiss: control.close,
  };
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
 * A TIP's frame: the cards' fill, border and shadow in both themes, sized to its words — the name of
 * an icon, said in a box that reads as the app's own rather than the browser's grey `title`.
 */
export const HOVER_TIP_FRAME =
  "w-max max-w-[16rem] rounded-lg border border-slate-200 bg-white px-2 py-1 text-start text-[12.5px] font-bold leading-5 text-slate-800 shadow-xl dark:border-[#2b3b6b] dark:bg-[#131d35] dark:text-slate-100 [font-family:'Cairo',sans-serif]";

/**
 * The point under a tip (`align="center"`), at its icon: a small square turned on its corner, in the
 * tip's fill with the border on its two outer sides — so a tip over a column of chips says WHICH
 * icon it names, not the chip it happens to lie on.
 */
const TIP_POINT =
  'pointer-events-none absolute h-2 w-2 -translate-x-1/2 rotate-45 border-slate-200 bg-white dark:border-[#2b3b6b] dark:bg-[#131d35]';

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
  frame = HOVER_CARD_FRAME,
  align = 'start',
  children,
}: {
  id: string;
  anchor: RefObject<HTMLElement | null>;
  /**
   * `captain` and `crew` are Operations' day-board cards (`BoardCrewCards`), and `roster` the
   * member card on «كشف طاقم العمليات» (`RosterMemberCard`), on these mechanics. On «لوحة التشغيلة»
   * (Round 22): `crew-plan` the person card on a name, `crew-flag` the small tip that names a
   * requirement icon (`crew-plan-icons`). On «توزيع المحصنات» (Round 25): `secured-shipment` the
   * card of a محصنة's small chip; (Round 26) `secured-van` the van's card — everyone on it and what
   * it carries — on its head and its captain's line, on «تسليم المحصنات» too. On «لوحة التشغيلة»
   * (Round 34 H critic): `crew-record` what a past day's record mark says, a toggle — a press or a
   * tap opens it, so a phone and the keyboard reach it as the mouse does.
   */
  mark:
    | 'driver'
    | 'vehicle'
    | 'captain'
    | 'crew'
    | 'roster'
    | 'crew-plan'
    | 'crew-flag'
    | 'secured-shipment'
    | 'secured-van'
    | 'crew-record';
  /**
   * The look. Every card keeps the cards' frame; a TIP — a word or two for an icon — takes
   * `HOVER_TIP_FRAME`, on the same mechanics.
   */
  frame?: string;
  /** `start` hangs a card off its trigger's start edge; `center` sets a tip over its icon's middle. */
  align?: 'start' | 'center';
  children: ReactNode;
}): JSX.Element | null => {
  const panel = useRef<HTMLDivElement>(null);
  /** Where it is drawn, which side of its trigger, and (a tip) where its point meets the trigger. */
  const [at, setAt] = useState<{
    top: number;
    left: number;
    side: 'above' | 'below';
    point: number;
  } | null>(null);
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
      // A tip leaves room for its point.
      const gap = align === 'center' ? 9 : 6;
      const above = rect.top - gap - height >= 8;
      const top = above
        ? rect.top - gap - height
        : Math.min(rect.bottom + gap, window.innerHeight - height - 8);
      const rtl = getComputedStyle(box).direction === 'rtl';
      const start =
        align === 'center'
          ? rect.left + rect.width / 2 - width / 2
          : rtl
            ? rect.right - width
            : rect.left;
      const left = Math.min(window.innerWidth - width - 8, Math.max(8, start));
      setAt({
        top: Math.max(8, top),
        left,
        side: above ? 'above' : 'below',
        // Kept off the rounded corners when the tip is pushed in from the screen's edge.
        point: Math.min(width - 10, Math.max(10, rect.left + rect.width / 2 - left)),
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
  }, [anchor, align]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={panel}
      id={id}
      role="tooltip"
      {...{ [`data-${mark}-hover-card`]: 'true' }}
      data-side={at?.side}
      // Unseen until it has its place, so it never flashes at the corner of the screen.
      style={
        at === null ? { top: 0, left: 0, visibility: 'hidden' } : { top: at.top, left: at.left }
      }
      className={cn('pointer-events-none fixed z-[110] animate-menu-in', frame)}
    >
      {children}
      {align === 'center' && at !== null && (
        <span
          aria-hidden
          data-tip-point="true"
          style={{ left: at.point }}
          className={cn(
            TIP_POINT,
            at.side === 'above'
              ? '-bottom-[5px] border-b border-r'
              : '-top-[5px] border-l border-t',
          )}
        />
      )}
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
