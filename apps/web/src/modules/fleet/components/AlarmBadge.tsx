// The maintenance alarm's LEVEL, drawn one way.
//
// The same three tones were written out in the dashboard, the odometer log and the alarms board —
// identical today, and three places for them to stop being identical tomorrow. A level means the
// same thing wherever it is shown, so it looks the same wherever it is shown, and the maintenance
// screen joining them adds a reader rather than a fourth copy.
//
// Presentation ONLY. The level itself is `computeAlarm`'s, derived server-side per request; this
// module decides no threshold and recomputes nothing.
import { type HTMLAttributes } from 'react';
import { type FleetAlarmLevel, type FleetNoAlarmReason } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Badge } from '../../../shared/ui/Badge';
import { cn } from '../../../shared/lib/cn';

/**
 * The alarm's colour as a SURFACE — the one definition of what red and yellow look like when they
 * tint something rather than sit in a pill.
 *
 * Two intensities of one decision, in one object. A `row` tint spans a whole table row: «الاحمر
 * يكون الصف كله زى ما كان» — the red car's WHOLE row reads red, in the dark theme as much as the
 * light one, so it is a full step of the colour (a translucent wash of the hue on the dark board,
 * not the `-950` that vanished into it), and still light enough to read the row's text through. A
 * `cell` tint is a small patch sitting beside a badge that is itself `-100`. Different surfaces,
 * same colour choice — and both here, because the alternative is each screen inventing its own red.
 *
 * `none` is deliberately absent: a vehicle with no alarm is not a state worth tinting, and
 * colouring it would spend the reader's attention on the ordinary case.
 */
const ALARM_TINT: Record<'yellow' | 'red', { row: string; cell: string }> = {
  yellow: {
    row: 'bg-amber-100/70 dark:bg-amber-500/[0.12]',
    cell: 'bg-amber-100/80 dark:bg-amber-950/50',
  },
  red: {
    row: 'bg-red-100 dark:bg-red-500/[0.18]',
    cell: 'bg-red-100/80 dark:bg-red-950/50',
  },
};

/**
 * The tint for a whole table ROW, or `undefined` when there is nothing to flag.
 *
 * `undefined` rather than `''` so a caller hands it straight to `rowClassName`, which is typed to
 * expect exactly that for "this row is ordinary".
 */
export const alarmRowTint = (level: FleetAlarmLevel | undefined): string | undefined =>
  level === 'red' || level === 'yellow' ? ALARM_TINT[level].row : undefined;

/**
 * The row's level as an attribute — `data-alarm="red" | "yellow" | "none"` — for `rowProps`.
 *
 * The board table of the Fleet screens paints EVERY row's hover itself, from the table's wrapper,
 * and a rule written there outranks any class on the `<tr>`: the red row turned grey the moment
 * the pointer reached it. The attribute is what lets the wrapper hold the tint instead — see
 * `ALARM_ROW_HOLD`, which reads exactly this name.
 */
export const alarmRowAttrs = (level: FleetAlarmLevel): HTMLAttributes<HTMLTableRowElement> => {
  const attrs: HTMLAttributes<HTMLTableRowElement> & { 'data-alarm': FleetAlarmLevel } = {
    'data-alarm': level,
  };
  return attrs;
};

/**
 * The row tint, HELD under the board table — for the table's wrapper, beside `DARK_TABLE`.
 *
 * The same red and amber as `ALARM_TINT.row`, at rest, and one step deeper on hover, so a tinted
 * row still answers the pointer without dropping its colour for the board's grey. The attribute
 * selector is one step more specific than the board's own `tbody tr:hover`, which is the whole
 * trick (the dealership board holds its green rows the same way).
 *
 * Spelled out in full because Tailwind only generates the classes it can read whole in the source;
 * a string assembled from `ALARM_TINT` would produce no CSS at all.
 */
export const ALARM_ROW_HOLD = cn(
  '[&_tbody_tr[data-alarm=red]]:!bg-red-100 dark:[&_tbody_tr[data-alarm=red]]:!bg-red-500/[0.18]',
  '[&_tbody_tr[data-alarm=red]:hover]:!bg-red-200/70 dark:[&_tbody_tr[data-alarm=red]:hover]:!bg-red-500/[0.26]',
  '[&_tbody_tr[data-alarm=yellow]]:!bg-amber-100/70 dark:[&_tbody_tr[data-alarm=yellow]]:!bg-amber-500/[0.12]',
  '[&_tbody_tr[data-alarm=yellow]:hover]:!bg-amber-200/60 dark:[&_tbody_tr[data-alarm=yellow]:hover]:!bg-amber-500/[0.2]',
);

/**
 * The tint for the CELL's own content — a patch around the figure and its badge, never the row.
 *
 * Used where a row already means something else. On the maintenance screen the row is green when
 * the car has left the workshop, and that is a different fact about a different thing; painting
 * the alarm across the row would take a colour that is already spoken for. Tinting an element
 * INSIDE the cell leaves the row's own colour framing it, so the two coexist instead of one
 * overwriting the other. On the odometer log the reason is different and just as concrete: rows
 * there are READINGS, and one car has many — a row tint would draw five alarms for one car.
 */
export const alarmCellTint = (level: FleetAlarmLevel | undefined): string | undefined =>
  level === 'red' || level === 'yellow'
    ? `${ALARM_TINT[level].cell} rounded-md px-2 py-1`
    : undefined;

/**
 * The alarm's LEVEL, and — when there isn't one — what stopped it being calculated.
 *
 * «لا يوجد» used to mean five different things: a healthy cycle, and each of four separate
 * reasons the cycle could not be measured at all. A reader looking at it had no way to tell
 * "this car is fine" from "this car's type has no service interval", and no way to know what
 * to go and fix. The server names the guard that stopped it; this reads that out.
 *
 * The reason is the SERVER's — never re-derived here. Three of the four cannot even be seen from
 * the client: the interval lives on the vehicle type, and the reading and its date are not in
 * this projection. A screen guessing from what it happens to hold would state a wrong cause.
 */
/**
 * The same answer as a STRING, for a document — a sheet has no room for a badge.
 *
 * Here rather than in the export that wanted it, because this file is the one place allowed to
 * put the reason into words: a screen and a spreadsheet disagreeing about why a car has no alarm
 * is exactly the confusion the reason was added to end. `t` is passed in so this stays pure and
 * callable from a callback, where a hook cannot go.
 */
export const alarmText = (
  t: (key: string) => string,
  level: FleetAlarmLevel,
  noAlarmReason: FleetNoAlarmReason | null = null,
): string => {
  if (level !== 'none') return t(`fleet.dashboard.level.${level}`);
  return noAlarmReason === null
    ? t('fleet.vehicle.alarmNone')
    : t(`fleet.alarms.noAlarmReason.${noAlarmReason}`);
};

export const AlarmBadge = ({
  level,
  noAlarmReason = null,
  reasonDisplay = 'text',
}: {
  level: FleetAlarmLevel;
  /** `null` = the alarm was computed, so `level` is the whole answer. */
  noAlarmReason?: FleetNoAlarmReason | null;
  /**
   * How much room the reason may take.
   *
   * `'text'` spells it out, and belongs where ONE row is ONE vehicle — the alarms board. There it
   * is the answer to the column's question and it is said once per car.
   *
   * `'tooltip'` keeps the short word and hangs the sentence off it. That is for a table whose
   * rows are something else: the maintenance screen lists VISITS and the odometer log lists
   * READINGS, so one car occupies several rows, and a per-vehicle sentence repeated down every
   * one of them reads as several different problems instead of one — the same noise a per-row
   * tint would have made, which is why the tint went on the cell there.
   */
  reasonDisplay?: 'text' | 'tooltip';
}): JSX.Element => {
  const t = useT();
  if (level === 'none') {
    // A computed `none` is a healthy car: it keeps the word it has always had, and says no more.
    if (noAlarmReason === null) return <Badge tone="neutral">{t('fleet.vehicle.alarmNone')}</Badge>;
    const reason = alarmText(t, level, noAlarmReason);
    if (reasonDisplay === 'text') return <Badge tone="neutral">{reason}</Badge>;
    // Wrapped rather than passed to `Badge`: a `title` prop on the design system's pill would
    // widen a component every feature shares, for one screen's layout problem.
    return (
      <span title={reason}>
        <Badge tone="neutral">{t('fleet.vehicle.alarmNone')}</Badge>
      </span>
    );
  }
  return (
    <Badge tone={level === 'red' ? 'danger' : 'warning'}>
      {t(`fleet.dashboard.level.${level}`)}
    </Badge>
  );
};

/**
 * The remaining-km figure as a reader should see it: a distance while there is one left, and the
 * OVERDUE distance once it has gone past.
 *
 * `remainingKm` is `interval − sinceService` and goes negative the moment a service is missed —
 * printing «-٢٠٠ كم متبقٍ» would be arithmetic, not information. The sign is read here and turned
 * into the sentence it means, using the same two strings the dashboard and the alarms board
 * already use for it.
 */
export const RemainingKm = ({
  remainingKm,
  locale,
  formatNumber,
}: {
  remainingKm: number | null;
  locale: 'ar' | 'en';
  formatNumber: (value: number, locale: 'ar' | 'en') => string;
}): JSX.Element => {
  const t = useT();
  if (remainingKm === null) {
    return <span className="text-slate-400 dark:text-slate-600">—</span>;
  }
  if (remainingKm < 0) {
    return (
      <span className="font-medium text-red-700 dark:text-red-300">
        {t('fleet.dashboard.overdueKm', { km: formatNumber(Math.abs(remainingKm), locale) })}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      {t('fleet.odometer.kmValue', { km: formatNumber(remainingKm, locale) })}
    </span>
  );
};
