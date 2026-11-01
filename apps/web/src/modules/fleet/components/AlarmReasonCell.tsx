// «اعدّل شاشة العدادات بحيث بدل «—» يظهر السبب في سطر آخر قراءة لكل عربية».
//
// The «فارق عداد الصيانة» cell of a car whose distance since service the projection REFUSED to
// compute (`noAlarmReason`), on the one row `reasonRows` picks: a short muted chip in the alarms
// board's own words, one small link to where it is fixed, and on hover or keyboard focus a card
// that says why, what to do, and the projection's own facts (`cardFacts`, drawn by
// `AlarmReasonFacts`). A car the projection leaves out gets «السيارة غير نشطة» (`NotActiveCell`),
// with its status and reason from the registry list the car filter already holds — no new request.
//
// The card behaves as the driver card does: 250 ms on hover, at once on keyboard focus, closed on
// leave, blur and Escape, one open at a time (`hoverControl`), drawn in a layer of its own that
// takes no pointer events, following its chip and hiding once the chip scrolls out of the table's
// box. The words are never a `title`: the card says them.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { type FleetMaintenanceAlarmDto, type FleetNoAlarmReason } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { useAllVehicles } from '../api/fleet-queries';
import {
  cardFacts,
  chipWords,
  counterLabelKey,
  headingWords,
  hoverControl,
  notActiveCard,
  reasonFix,
  type HoverControl,
  type NotActiveSaid,
  type ReasonFix,
} from '../lib/alarm-reason-card';
import { NotActiveFacts, ReasonFacts } from './AlarmReasonFacts';
import { clippingBoxes, nameInSight, type ScreenBox } from './DriverHoverCard';

const CARD = 'fleet.odometer.alarmReason.card.';

/** A layout effect in the browser; a plain one where there is no layout (a static render). */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Was this focus the keyboard's? A click focuses too, and a click is not a question. */
const keyboardFocus = (el: HTMLElement): boolean => {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
};

const Glyph = ({
  children,
  className,
  width = 2,
}: {
  children: ReactNode;
  className: string;
  width?: number;
}): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);
const INFO = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 7.5h.01" />
  </>
);
/** «السيارة غير نشطة». */
const PAUSED = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 9v6M14 9v6" />
  </>
);
/** «←» in Arabic: the way forward on a right-to-left page. */
const FORWARD = (
  <>
    <path d="M19 12H5" />
    <path d="M11 6l-6 6 6 6" />
  </>
);

/** The card, beside its chip: over everything, above the chip or below it, centred on it. */
const ReasonCardLayer = ({
  id,
  anchor,
  children,
}: {
  id: string;
  anchor: RefObject<HTMLElement | null>;
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
        if (head === null) return edge;
        const under = head.getBoundingClientRect().bottom;
        return {
          top: Math.max(edge.top, under),
          right: edge.right,
          bottom: edge.bottom,
          left: edge.left,
        };
      });
      // The chip scrolled out of the table's box: the card does not float on without it.
      if (!nameInSight(rect, cuts, { width: window.innerWidth, height: window.innerHeight })) {
        setAt(null);
        return;
      }
      const width = box.offsetWidth;
      const height = box.offsetHeight;
      const gap = 8;
      const top =
        rect.top - gap - height >= 8
          ? rect.top - gap - height
          : Math.min(rect.bottom + gap, window.innerHeight - height - 8);
      const left = rect.left + rect.width / 2 - width / 2;
      setAt({
        top: Math.max(8, top),
        left: Math.min(window.innerWidth - width - 8, Math.max(8, left)),
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
      data-odo-reason-card="true"
      dir="rtl"
      // Unseen until it has its place, so it never flashes at the corner of the screen.
      style={at === null ? { top: 0, left: 0, visibility: 'hidden' } : at}
      className="pointer-events-none fixed z-[110] w-[30rem] max-w-[calc(100vw-16px)] animate-menu-in rounded-xl border border-slate-200 bg-white p-3.5 text-start text-slate-900 shadow-2xl dark:border-[#2b3b6b] dark:bg-[#131d35] dark:text-white [font-family:'Cairo',sans-serif]"
    >
      {children}
    </div>,
    document.body,
  );
};

/** One chip's card: open state, its rules (`hoverControl`), and Escape anywhere while open. */
const useReasonCard = (): { open: boolean; control: HoverControl } => {
  const [open, setOpen] = useState(false);
  const control = useMemo(() => hoverControl(setOpen), []);
  // Gone with its chip: no timer left to fire, no card left open.
  useEffect(() => control.close, [control]);
  useEffect(() => {
    if (!open) return undefined;
    const escape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') control.escape();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, control]);
  return { open, control };
};

const CHIP =
  'inline-flex max-w-[12.5rem] cursor-help items-center gap-1.5 whitespace-normal rounded-full border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1 text-center text-[13px] leading-[18px] text-slate-600 outline-none transition hover:border-slate-400 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800';
const FIX_LOOK =
  'inline-flex items-center gap-1 whitespace-nowrap rounded text-[12.5px] leading-4 text-sky-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-sky-400';

/** The card's content: the heading, why, what to do, the facts, and the footer. */
const CardShell = ({
  icon,
  heading,
  why,
  todo,
  facts,
  footer,
}: {
  icon: ReactNode;
  heading: string;
  why: string;
  todo: string;
  facts: ReactNode;
  footer: string;
}): JSX.Element => {
  const t = useT();
  return (
    <>
      <p className="flex items-start gap-2 text-[14.5px] font-extrabold leading-snug">
        <span
          aria-hidden
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-500/15 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300"
        >
          <Glyph className="h-3.5 w-3.5">{icon}</Glyph>
        </span>
        <span className="min-w-0">{heading}</span>
      </p>
      <dl className="mt-2.5 space-y-2 text-[13px] leading-relaxed">
        <div>
          <dt className="font-bold text-slate-500 dark:text-slate-400">{t(`${CARD}why`)}</dt>
          <dd className="font-semibold text-slate-700 dark:text-slate-200">{why}</dd>
        </div>
        <div className="rounded-lg bg-sky-50 px-2.5 py-2 dark:bg-sky-500/10">
          <dt className="font-bold text-sky-800 dark:text-sky-300">{t(`${CARD}todo`)}</dt>
          <dd className="font-semibold text-slate-800 dark:text-slate-100">{todo}</dd>
        </div>
      </dl>
      {facts}
      <p className="mt-2.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">{footer}</p>
    </>
  );
};

/**
 * The chip, its link, and its card while open. The anchor is the whole stack — chip and link — so
 * the card opens clear of the link, never over it.
 */
const ReasonStack = ({
  mark,
  icon,
  chip,
  fix,
  fixLabel,
  onRecord,
  card,
}: {
  mark: string;
  icon: ReactNode;
  chip: string;
  fix: ReasonFix;
  fixLabel: string;
  onRecord?: () => void;
  card: ReactNode;
}): JSX.Element => {
  const id = useId();
  const anchor = useRef<HTMLSpanElement | null>(null);
  const { open, control } = useReasonCard();
  const linkBody = (
    <>
      {fixLabel}
      <Glyph className="h-3 w-3" width={2.2}>
        {FORWARD}
      </Glyph>
    </>
  );
  return (
    <span ref={anchor} className="inline-flex flex-col items-center gap-1" data-odo-reason={mark}>
      <span
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        data-odo-reason-chip="true"
        onMouseEnter={control.enter}
        onMouseLeave={control.leave}
        onFocus={(e) => control.focus(keyboardFocus(e.currentTarget))}
        onBlur={control.blur}
        onKeyDown={(e) => {
          // Escape closes the card and only the card — not a dialog or a list around it.
          if (e.key === 'Escape' && control.escape()) e.stopPropagation();
        }}
        className={CHIP}
      >
        <Glyph className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500">{icon}</Glyph>
        <span>{chip}</span>
      </span>
      {fix?.kind === 'route' && (
        <Link to={fix.to} className={FIX_LOOK} data-odo-reason-fix={mark}>
          {linkBody}
        </Link>
      )}
      {fix?.kind === 'record' && (
        // A `span` with the button's role, not a `<button>`: the board table squares every button
        // in a cell to its row icons' size, which would crush a worded action.
        <span
          role="button"
          tabIndex={0}
          className={cn(FIX_LOOK, 'cursor-pointer')}
          data-odo-reason-fix={mark}
          onClick={() => onRecord?.()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onRecord?.();
            }
          }}
        >
          {linkBody}
        </span>
      )}
      {open && (
        <ReasonCardLayer id={id} anchor={anchor}>
          {card}
        </ReasonCardLayer>
      )}
    </span>
  );
};

/** The card of a refused car. Exported for the specs, which read what it says. */
export const AlarmReasonCard = ({
  alarm,
  reason,
}: {
  alarm: FleetMaintenanceAlarmDto;
  reason: FleetNoAlarmReason;
}): JSX.Element => {
  const t = useT();
  const words = `fleet.odometer.alarmReason.${reason}.`;
  return (
    <CardShell
      icon={INFO}
      // The board's own sentence, whole — nothing re-worded.
      heading={headingWords(t(`fleet.alarms.noAlarmReason.${reason}`))}
      why={t(`${words}why`)}
      // The two counter reasons name the counter actually used.
      todo={t(`${words}todo`, { counter: t(counterLabelKey(alarm)) })}
      facts={<ReasonFacts facts={cardFacts(alarm, reason)} />}
      footer={t(`${CARD}footer`)}
    />
  );
};

/**
 * The reason, on the row of the car's latest reading. `onRecord` opens this screen's own
 * «تسجيل قراءة» on the car — the fix for a car with no reading is here, not on another screen.
 */
export const AlarmReasonCell = ({
  alarm,
  reason,
  onRecord,
}: {
  alarm: FleetMaintenanceAlarmDto;
  reason: FleetNoAlarmReason;
  onRecord: (code: string) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  return (
    <ReasonStack
      mark={reason}
      icon={INFO}
      chip={chipWords(t(`fleet.alarms.noAlarmReason.${reason}`))}
      fix={reasonFix(reason, { code: alarm.code, vehicleId: alarm.vehicleId }, can)}
      fixLabel={t(`fleet.odometer.alarmReason.${reason}.fix`)}
      onRecord={() => onRecord(alarm.code)}
      card={<AlarmReasonCard alarm={alarm} reason={reason} />}
    />
  );
};

const NOT_ACTIVE = 'fleet.odometer.alarmReason.notActive.';

/**
 * What the registry says about a car the projection leaves out: the whole list the car filter
 * already holds (`anyStatus`, the same cache key — no new request), read only by a reader who may.
 */
const useNotActive = (vehicleId: string): NotActiveSaid => {
  const can = useCan();
  const readable = can('fleetVehicle.view');
  const registry = useAllVehicles({ anyStatus: true }, readable);
  return notActiveCard(
    { readable, loaded: registry.isSuccess },
    registry.data?.items.find((vehicle) => vehicle.id === vehicleId),
  );
};

/** The card of a car that is not active. Exported for the specs. */
export const NotActiveReasonCard = ({
  vehicleId,
  code,
}: {
  vehicleId: string;
  code: string | null;
}): JSX.Element => {
  const t = useT();
  const said = useNotActive(vehicleId);
  const status = said.vehicle === null ? '' : t(`fleet.vehicles.status.${said.vehicle.status}`);
  return (
    <CardShell
      icon={PAUSED}
      heading={t(`${NOT_ACTIVE}chip`)}
      why={t(`${NOT_ACTIVE}${said.why}`, { status })}
      todo={t(`${NOT_ACTIVE}todo`)}
      facts={<NotActiveFacts code={code} vehicle={said.vehicle} />}
      footer={t(`${CARD}footerInactive`)}
    />
  );
};

/** «السيارة غير نشطة», on the newest row of a car the projection leaves out. */
export const NotActiveCell = ({
  vehicleId,
  code,
}: {
  vehicleId: string;
  code: string | null;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const said = useNotActive(vehicleId);
  return (
    <ReasonStack
      mark="notActive"
      icon={PAUSED}
      chip={t(`${NOT_ACTIVE}chip`)}
      // The car's profile, only for a car the registry still holds.
      fix={
        said.vehicle === null ? null : reasonFix('notActive', { code: code ?? '', vehicleId }, can)
      }
      fixLabel={t(`${NOT_ACTIVE}fix`)}
      card={<NotActiveReasonCard vehicleId={vehicleId} code={code} />}
    />
  );
};
