// «عاوز فى اى شااشه اقف على اسم السواق يجيب الاسم كامل والكود ورقم الفون والعربيه اللى متعين
// عليها والفرع».
//
// ONE card, hung on the shared name renderers — `DriverCell`, `EmployeeName` / `DriverName`,
// `DriverChip`, `DriverIdentity` — so every screen that draws a driver through them shows it, and
// a screen added later gets it by drawing its names the usual way.
//
// How it behaves, and why:
// - It opens on a short hover, or at once when the name is reached with the keyboard (Tab); it
//   closes when the pointer leaves, on blur, on Escape, on any press, and when a drag starts.
// - It is ATTACHED to the name's own element (`triggerProps`), never a wrapper around it, so a
//   board's layout — the roster chip's full width, the centred maintenance stack — is untouched.
// - It is drawn in a layer of its own over everything (a portal), and it takes no pointer events:
//   a click, a drag or a scroll goes to whatever is under it, exactly as without the card. It
//   follows its name as a table scrolls inside itself, and hides when the name leaves the screen —
//   or the box it scrolls in, or slides under that box's sticky head, long before the window's edge.
// - One open at a time.
// - Nothing is fetched until a card first opens: the people are the list the name already came
//   from; the branch names and today's roster are each ONE cached list shared by every card — not
//   a request per name.
// - A name Fleet does not know (a name from the old books, an id not on the roster) gets no card;
//   it keeps the title it has always had.
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
import { type FleetPersonDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { useAppSelector } from '../../../store';
import { useBranchOptions } from '../../organization/shared/references';
import { useRosterToday } from '../api/fleet-queries';
import { driverCardFacts, type DriverCardFacts } from '../lib/driver-card';

/** A beat before it opens — a pointer crossing a table is not asking about every name on it. */
const OPEN_DELAY_MS = 300;

/** A layout effect in the browser; a plain one where there is no layout (a static render). */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The card open now, if any — opening another closes it. */
let closeOpenCard: (() => void) | null = null;

/** What the name's own element takes. Empty for a name Fleet does not know. */
export interface DriverCardTriggerProps {
  'data-driver-hover'?: string;
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
 * The card for one name (or several — an accident's culprits). Spread `triggerProps` on the
 * element that draws the name and render `card` beside it; `card` is a portal, so where it sits
 * in the markup changes nothing on screen.
 *
 * `people` are the records the name was drawn from — passed in, not looked up again, so a board of
 * two hundred chips builds no second roster map per chip. Pass `[]` for a name Fleet does not know.
 *
 * `focusable: false` where the name sits inside something that already owns the keyboard — a
 * picker's box, a draggable chip — so it adds no tab stop of its own there; the hover still works.
 */
export const useDriverHoverCard = (
  people: readonly FleetPersonDto[],
  { focusable = true }: { focusable?: boolean } = {},
): { triggerProps: DriverCardTriggerProps; card: ReactNode } => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  /** How it opened: a hover closes when the pointer leaves; a keyboard focus stays until blur. */
  const via = useRef<'hover' | 'focus'>('hover');
  const id = useId();
  const key = people.map((person) => person.employeeId).join(',');

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

  // Gone with its name: no timer left to fire, no card left open.
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

  if (key === '') return { triggerProps: {}, card: null };

  const triggerProps: DriverCardTriggerProps = {
    // A mark, not the id: a board's markup never carries a raw id for a person it can name.
    'data-driver-hover': 'true',
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
      // Escape closes the card and only the card — not the dialog or the list around the name.
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        control.close();
      }
    },
    // A press on the name — a pick, the start of a drag — is not a question about it: the card
    // waiting to open does not.
    onMouseDown: control.close,
    onDragStart: control.close,
    ...(focusable ? { tabIndex: 0 } : {}),
    ...(open ? { 'aria-describedby': id } : {}),
  };
  const card = open ? <DriverCardLayer id={id} anchor={anchor} people={people} /> : null;
  return { triggerProps, card };
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
 * scroll moves these boxes, it does not change which they are.
 */
const clippingBoxes = (el: HTMLElement): { node: HTMLElement; head: HTMLElement | null }[] => {
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
 * Where the card is drawn: ABOVE the name, below it when there is no room above; its start edge
 * on the name's start edge (the right, in Arabic), kept on the screen. Measured before it is
 * painted, and again as the page scrolls or the card's own lines land.
 */
const DriverCardLayer = ({
  id,
  anchor,
  people,
}: {
  id: string;
  anchor: RefObject<HTMLElement | null>;
  people: readonly FleetPersonDto[];
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
      // The name scrolled out of sight: the card does not float on without it.
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
      const rtl = getComputedStyle(target).direction === 'rtl';
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
      data-driver-hover-card="true"
      // Unseen until it has its place, so it never flashes at the corner of the screen.
      style={at === null ? { top: 0, left: 0, visibility: 'hidden' } : at}
      className="pointer-events-none fixed z-[110] w-72 max-w-[calc(100vw-16px)] animate-menu-in rounded-xl border border-slate-200 bg-white p-3 text-start text-slate-900 shadow-2xl dark:border-[#2b3b6b] dark:bg-[#131d35] dark:text-white [font-family:'Cairo',sans-serif]"
    >
      <DriverCardBody people={people} />
    </div>,
    document.body,
  );
};

/** A fact the books do not have, or one still on its way — never a guess. */
const Missing = ({ loading = false }: { loading?: boolean }): JSX.Element => (
  <span className="text-slate-400 dark:text-slate-500">{loading ? '…' : '—'}</span>
);

const Fact = ({ label, children }: { label: string; children: ReactNode }): JSX.Element => (
  <>
    <dt className="whitespace-nowrap font-semibold text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="min-w-0 break-words font-bold text-slate-800 dark:text-slate-100">{children}</dd>
  </>
);

const PersonFacts = ({ facts }: { facts: DriverCardFacts }): JSX.Element => {
  const t = useT();
  const { vehicle } = facts;
  return (
    <div data-driver-card-person={facts.employeeId}>
      <p className="flex items-start gap-2 text-[15px] font-extrabold leading-snug">
        <span
          aria-hidden
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-300"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
          </svg>
        </span>
        {/* The WHOLE name, wrapped — the reason the card exists on a board that cuts it. */}
        <span className="min-w-0 whitespace-normal break-words">{facts.name}</span>
      </p>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-[13px] leading-snug">
        <Fact label={t('fleet.drivers.columns.employeeCode')}>
          {facts.code === '' ? (
            <Missing />
          ) : (
            <span dir="ltr" className="font-figures">
              {facts.code}
            </span>
          )}
        </Fact>
        <Fact label={t('fleet.drivers.columns.phone')}>
          {facts.phone === null ? (
            <Missing />
          ) : (
            <span dir="ltr" className="font-figures">
              {facts.phone}
            </span>
          )}
        </Fact>
        {/* No `fleetRoster.view`: no car line at all, rather than a dash that reads «no car». */}
        {vehicle.kind !== 'hidden' && (
          <Fact label={t('fleet.drivers.card.vehicle')}>
            {vehicle.kind === 'car' ? (
              <span dir="ltr" className="font-figures">
                {vehicle.code}
              </span>
            ) : vehicle.kind === 'elsewhere' ? (
              t('fleet.roster.otherVehicle')
            ) : (
              <Missing loading={vehicle.kind === 'loading'} />
            )}
          </Fact>
        )}
        <Fact label={t('fleet.drivers.columns.branch')}>
          {facts.branch === null || facts.branch === 'loading' ? (
            <Missing loading={facts.branch === 'loading'} />
          ) : (
            facts.branch
          )}
        </Fact>
      </dl>
    </div>
  );
};

/**
 * The card's content: one block per driver — the name, then the code, phone, today's car and the
 * branch. Exported for the specs, which seed the three lists and read what it says.
 */
export const DriverCardBody = ({ people }: { people: readonly FleetPersonDto[] }): JSX.Element => {
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const mayReadRoster = can('fleetRoster.view');
  const roster = useRosterToday(mayReadRoster);
  const branches = useBranchOptions();
  return (
    <div className="space-y-3">
      {people.map((person, index) => (
        <div
          key={person.employeeId}
          className={cn(index > 0 && 'border-t border-slate-200 pt-3 dark:border-[#2b3b6b]')}
        >
          <PersonFacts
            facts={driverCardFacts({
              person,
              branches: branches.data ?? (branches.isError ? null : 'loading'),
              roster: !mayReadRoster || roster.isError ? 'hidden' : (roster.data ?? 'loading'),
              locale,
            })}
          />
        </div>
      ))}
    </div>
  );
};

/**
 * A name drawn as plain text that is not one of the shared renderers' — an accident's culprit,
 * which may be several of ours or a third party's. With the people behind it, the text opens
 * their card; without, it is the text as before.
 */
export const DriverHoverText = ({
  people,
  children,
  className,
}: {
  people: readonly FleetPersonDto[];
  children: ReactNode;
  className?: string;
}): JSX.Element => {
  const { triggerProps, card } = useDriverHoverCard(people);
  return (
    <>
      <span className={className} {...triggerProps}>
        {children}
      </span>
      {card}
    </>
  );
};
