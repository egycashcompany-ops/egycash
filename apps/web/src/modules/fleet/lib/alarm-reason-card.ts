// What the «فارق عداد الصيانة» reason card says, kept pure so every case is testable without a
// browser (the web suite runs in `node`).
//
// The card stands where the odometer register would print «—» for a car whose distance since its
// last service the projection REFUSED to compute. It says the reason in the alarms board's own
// words, what to do about it, the one place to fix it — and the projection's own facts: the visit
// the cycle is measured from, its two counters with the one USED marked (and an exit counter SET
// ASIDE, with the reading that contradicts it), the reading the used counter was JUDGED AGAINST,
// and a NEWER visit that is still open or does not count. Every fact is the server's
// (`FleetMaintenanceAlarmDto.baseline` and friends); nothing here re-derives one, and the reason
// itself is `noAlarmReason` as it came.
//
// A car the projection leaves out — not active — gets its own card: «السيارة غير نشطة».
import {
  type FleetAlarmChainPointDto,
  type FleetAlarmUncountedWhy,
  type FleetMaintenanceAlarmDto,
  type FleetNoAlarmReason,
  type FleetVehicleStatus,
} from '@ecms/contracts';

// ── Words ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The CHIP's words: the alarms board's sentence, up to its dash. The two long reasons there read
 * «… — الرقمان غير قابلين للمقارنة»; the chip keeps the fact before the dash, and the card's
 * heading carries the whole sentence. The four short reasons are the board's words unchanged.
 */
export const chipWords = (sentence: string): string => sentence.split(' — ')[0] ?? sentence;

/**
 * The card HEADING's words: the board's whole sentence, with the space BEFORE its dash made
 * unbreakable. A line may then end on the dash but never begin with one — a leading «—» on a
 * right-to-left line reads as a list bullet, not as the rest of the sentence.
 */
export const headingWords = (sentence: string): string => sentence.replace(' — ', ' — ');

/** The key of the counter label a reason's «المطلوب» names: the counter actually USED. */
export const counterLabelKey = (alarm: Pick<FleetMaintenanceAlarmDto, 'baseline'>): string =>
  alarm.baseline?.source === 'exit'
    ? 'fleet.maintenance.fields.exitOdometer'
    : 'fleet.maintenance.fields.odometerAtService';

/** A template cut at its `{{name}}` placeholders, so a figure or a day can be set apart in it. */
export type TemplatePart = { text: string } | { name: string };
export const templateParts = (template: string): TemplatePart[] =>
  template
    .split(/(\{\{\w+\}\})/u)
    .filter((part) => part !== '')
    .map((part) => {
      const name = /^\{\{(\w+)\}\}$/u.exec(part)?.[1];
      return name === undefined ? { text: part } : { name };
    });

// ── The way to fix it ───────────────────────────────────────────────────────────────────────────

/**
 * Editing a type's maintenance interval is `VehicleTypesTable`'s `MAKES_PERMISSION` — not the
 * catalogs' own grant, which only opens the screen. The link needs both.
 */
export const INTERVAL_PERMISSION = 'fleetMaintenanceRule.manage';

type FixRule =
  | { kind: 'route'; to: (car: { code: string; vehicleId: string }) => string; needs: string[] }
  | { kind: 'record'; needs: string[] };

const maintenanceOf = ({ code }: { code: string }): string =>
  `/fleet/maintenance?vehicleCodes=${encodeURIComponent(code)}`;

/** Where each reason sends the reader, and what the reader must hold for the link to show. */
export const REASON_FIX: Record<FleetNoAlarmReason | 'notActive', FixRule> = {
  noInterval: {
    kind: 'route',
    to: () => '/fleet/catalogs?kind=make',
    needs: ['fleetCatalog.manage', INTERVAL_PERMISSION],
  },
  // This screen's own «تسجيل قراءة», opened on the car.
  noReading: { kind: 'record', needs: ['fleetOdometer.record'] },
  noService: { kind: 'route', to: maintenanceOf, needs: ['fleetMaintenance.view'] },
  readingOlderThanService: {
    kind: 'route',
    to: ({ code }) => `/fleet/maintenance-alarms?vehicleCodes=${encodeURIComponent(code)}`,
    needs: ['fleetOdometer.view'],
  },
  baselineAboveReading: { kind: 'route', to: maintenanceOf, needs: ['fleetMaintenance.view'] },
  baselineBelowChain: { kind: 'route', to: maintenanceOf, needs: ['fleetMaintenance.view'] },
  notActive: {
    kind: 'route',
    to: ({ vehicleId }) => `/fleet/vehicles/${encodeURIComponent(vehicleId)}`,
    needs: ['fleetVehicle.view'],
  },
};

export type ReasonFix = { kind: 'route'; to: string } | { kind: 'record' } | null;

/** The fix this reader is offered — `null` when a grant it needs is missing. */
export const reasonFix = (
  reason: FleetNoAlarmReason | 'notActive',
  car: { code: string; vehicleId: string },
  can: (permission: string) => boolean,
): ReasonFix => {
  const rule = REASON_FIX[reason];
  if (!rule.needs.every((permission) => can(permission))) return null;
  return rule.kind === 'record' ? { kind: 'record' } : { kind: 'route', to: rule.to(car) };
};

// ── The facts block ─────────────────────────────────────────────────────────────────────────────

/** One line of the card's facts, in the order the card draws them. */
export type CardFact =
  | { kind: 'car'; code: string }
  | {
      kind: 'latest';
      reading: number;
      date: string | null;
      /** The reading is below the counter used (`baselineAboveReading`). */
      conflict: boolean;
      /** Its day is not after the visit's out day (`readingOlderThanService`). */
      dateFlagged: boolean;
    }
  | { kind: 'service'; inDate: string; outDate: string; outFlagged: boolean }
  | {
      kind: 'counter';
      which: 'entry' | 'exit';
      value: number;
      used: boolean;
      /** The USED counter is above the latest reading. */
      conflict: boolean;
      setAside: {
        because: 'belowChain' | 'aboveReading';
        conflict: FleetAlarmChainPointDto;
      } | null;
    }
  | { kind: 'standIn'; value: number }
  | { kind: 'judged'; point: FleetAlarmChainPointDto; conflict: boolean }
  | { kind: 'newer'; why: FleetAlarmUncountedWhy; date: string };

/**
 * The facts, ordered: the car, its latest reading, the counted visit, its entry and exit counters
 * (or the reading standing in for both), the reading the used counter was judged against, and a
 * newer visit that does not count. A fact the projection does not carry is left out, never guessed.
 *
 * The conflict marks follow the reason: `baselineBelowChain` marks the judged-against reading;
 * `baselineAboveReading` the latest reading and the counter used; `readingOlderThanService` the
 * latest reading's day and the visit's out day.
 */
export const cardFacts = (
  alarm: FleetMaintenanceAlarmDto,
  reason: FleetNoAlarmReason,
): CardFact[] => {
  const above = reason === 'baselineAboveReading';
  const below = reason === 'baselineBelowChain';
  const waiting = reason === 'readingOlderThanService';
  const base = alarm.baseline;
  const facts: CardFact[] = [{ kind: 'car', code: alarm.code }];
  if (alarm.latestReading !== null) {
    facts.push({
      kind: 'latest',
      reading: alarm.latestReading,
      date: alarm.latestReadingAt,
      conflict: above,
      dateFlagged: waiting,
    });
  }
  if (base !== null) {
    facts.push({
      kind: 'service',
      inDate: base.inDate,
      outDate: base.outDate,
      outFlagged: waiting,
    });
    const counter = (which: 'entry' | 'exit', value: number | null): void => {
      if (value === null) return;
      const used = base.source === which;
      facts.push({
        kind: 'counter',
        which,
        value,
        used,
        conflict: used && above,
        setAside: which === 'exit' ? base.exitSetAside : null,
      });
    };
    counter('entry', base.entryCounter);
    counter('exit', base.exitCounter);
    if (base.source === 'reading' && base.counter !== null) {
      facts.push({ kind: 'standIn', value: base.counter });
    }
    if (base.judgedAgainst !== null) {
      facts.push({ kind: 'judged', point: base.judgedAgainst, conflict: below });
    }
  }
  const newer = alarm.newerUncountedVisit;
  if (newer !== null) facts.push({ kind: 'newer', why: newer.why, date: newer.inDate });
  return facts;
};

// ── «السيارة غير نشطة» ──────────────────────────────────────────────────────────────────────────

export interface NotActiveSaid {
  /** `fleet.odometer.alarmReason.notActive.<why>`. */
  why: 'why' | 'whyDeleted' | 'whyUnknown';
  /** The car as the registry holds it; `null` when it is gone from it or cannot be read. */
  vehicle: { status: FleetVehicleStatus; statusReason: string | null } | null;
}

/**
 * Why a car the projection leaves out is not measured, from the registry list the car filter
 * already holds (every status). A car missing from that list is deleted; a reader who may not
 * read the registry, or a list not in yet, gets the plain sentence — never a status guessed.
 */
export const notActiveCard = (
  registry: { readable: boolean; loaded: boolean },
  vehicle: { status: FleetVehicleStatus; statusReason: string | null } | undefined,
): NotActiveSaid => {
  if (!registry.readable || !registry.loaded) return { why: 'whyUnknown', vehicle: null };
  if (vehicle === undefined) return { why: 'whyDeleted', vehicle: null };
  const reason =
    vehicle.statusReason === null || vehicle.statusReason.trim() === ''
      ? null
      : vehicle.statusReason;
  return { why: 'why', vehicle: { status: vehicle.status, statusReason: reason } };
};

// ── Opening and closing ─────────────────────────────────────────────────────────────────────────

/** A beat before it opens — a pointer crossing the column is not asking about every chip. */
export const REASON_CARD_DELAY_MS = 250;

export interface HoverControl {
  /** The pointer is over the chip: open after the delay. */
  enter: () => void;
  /** The pointer left: a card it opened closes; one the keyboard opened stays until blur. */
  leave: () => void;
  /** Focus reached the chip: the keyboard's opens it at once; a click's is not a question. */
  focus: (byKeyboard: boolean) => void;
  blur: () => void;
  /** Escape: closes an open card and says so (so the key goes no further); else does nothing. */
  escape: () => boolean;
  close: () => void;
}

/** The card open now, if any — opening another closes it, as the driver card does. */
let closeOpenCard: (() => void) | null = null;

/** One chip's open / close rules, outside React so they run under fake timers. */
export const hoverControl = (
  setOpen: (open: boolean) => void,
  delayMs: number = REASON_CARD_DELAY_MS,
): HoverControl => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let open = false;
  let via: 'hover' | 'focus' = 'hover';
  const clear = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const close = (): void => {
    clear();
    if (closeOpenCard === close) closeOpenCard = null;
    if (!open) return;
    open = false;
    setOpen(false);
  };
  const show = (): void => {
    clear();
    if (closeOpenCard !== null && closeOpenCard !== close) closeOpenCard();
    closeOpenCard = close;
    if (open) return;
    open = true;
    setOpen(true);
  };
  return {
    enter: () => {
      if (open) return;
      via = 'hover';
      clear();
      timer = setTimeout(show, delayMs);
    },
    leave: () => {
      if (via === 'hover') close();
      else clear();
    },
    focus: (byKeyboard) => {
      if (!byKeyboard) return;
      via = 'focus';
      show();
    },
    blur: close,
    escape: () => {
      if (!open) return false;
      close();
      return true;
    },
    close,
  };
};
