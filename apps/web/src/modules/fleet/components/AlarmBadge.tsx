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
  // «حسن تشبع الالوان»: the row is the alarms board's alone, and it was asked to read DEEPER — a
  // clearly red row and a clearly amber one, in the light theme as much as the dark. The `cell`
  // patch is the odometer log's and stays exactly what it was.
  yellow: {
    row: 'bg-amber-200/70 dark:bg-amber-500/[0.22]',
    cell: 'bg-amber-100/80 dark:bg-amber-950/50',
  },
  red: {
    row: 'bg-red-200/80 dark:bg-red-600/[0.30]',
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
  '[&_tbody_tr[data-alarm=red]]:!bg-red-200/80 dark:[&_tbody_tr[data-alarm=red]]:!bg-red-600/[0.30]',
  '[&_tbody_tr[data-alarm=red]:hover]:!bg-red-300/70 dark:[&_tbody_tr[data-alarm=red]:hover]:!bg-red-600/[0.40]',
  '[&_tbody_tr[data-alarm=yellow]]:!bg-amber-200/70 dark:[&_tbody_tr[data-alarm=yellow]]:!bg-amber-500/[0.22]',
  '[&_tbody_tr[data-alarm=yellow]:hover]:!bg-amber-300/60 dark:[&_tbody_tr[data-alarm=yellow]:hover]:!bg-amber-500/[0.32]',
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

/**
 * The alarms board's own pill — «كبر الخط وحسن تشبع الالوان».
 *
 * SOLID rather than the design system's pale `-100` wash: a full red with white type, a full amber
 * with near-black type, so the level reads from across the room and still reads on a row that is
 * itself tinted red or amber (a pale pill on a tinted row all but disappears). A size up as well,
 * to sit beside the board's larger figures. The quiet `none` stays grey — a healthy car and a car
 * the projection could not measure are still not states worth colouring — only firmer.
 *
 * The board's alone: the odometer log keeps the shared `Badge` and its cell patch untouched.
 */
const SOLID_PILL =
  'inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-[15px] leading-5 shadow-sm';
const SOLID_TONE: Record<FleetAlarmLevel, string> = {
  red: 'bg-red-600 text-white ring-1 ring-inset ring-red-700/60 dark:bg-red-600 dark:text-white dark:ring-red-400/40',
  yellow:
    'bg-amber-400 text-amber-950 ring-1 ring-inset ring-amber-500/70 dark:bg-amber-400 dark:text-amber-950 dark:ring-amber-300/50',
  none: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
};

export const AlarmBadge = ({
  level,
  noAlarmReason = null,
  reasonDisplay = 'text',
  variant = 'soft',
}: {
  level: FleetAlarmLevel;
  /** `null` = the alarm was computed, so `level` is the whole answer. */
  noAlarmReason?: FleetNoAlarmReason | null;
  /**
   * `'soft'` is the shared pill every screen draws. `'solid'` is the alarms board's — see
   * `SOLID_TONE`. The words, the reason and where the reason goes are the same either way.
   */
  variant?: 'soft' | 'solid';
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
  if (variant === 'solid') {
    // The same words as the soft pill below, in the same places — only the paint differs.
    const tooltip = level === 'none' && noAlarmReason !== null && reasonDisplay === 'tooltip';
    const pill = (
      <span className={cn(SOLID_PILL, SOLID_TONE[level])}>
        {tooltip ? t('fleet.vehicle.alarmNone') : alarmText(t, level, noAlarmReason)}
      </span>
    );
    return tooltip ? <span title={alarmText(t, level, noAlarmReason)}>{pill}</span> : pill;
  }
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
/**
 * The colour a remaining distance is written in on the alarms board, by the car's level — the
 * server's level, read, never re-derived. Overdue is red whatever the level says, because a
 * missed service is the most urgent thing a row can report. Saturated, and dark enough in the
 * light theme to read on a tinted row.
 */
const REMAINING_TONE: Record<FleetAlarmLevel | 'overdue', string> = {
  overdue: 'text-red-700 dark:text-red-400',
  red: 'text-red-700 dark:text-red-400',
  yellow: 'text-amber-800 dark:text-amber-400',
  none: 'text-emerald-700 dark:text-emerald-400',
};

/**
 * A sentence with its figure set apart — «متأخر <250> كم» — so the figure can wear the boards'
 * monospace while the words keep the page's own face (a monospace font has no Arabic letters).
 * The template is split rather than the unit appended, so each locale keeps its own word order.
 */
const withFigure = (
  t: (key: string, params?: Record<string, string | number>) => string,
  key: string,
  figure: string,
  figureClassName: string,
): JSX.Element => {
  const [before = '', after = ''] = t(key, { km: '\u0000' }).split('\u0000');
  return (
    <>
      {before}
      <span dir="ltr" className={figureClassName}>
        {figure}
      </span>
      {after}
    </>
  );
};

export const RemainingKm = ({
  remainingKm,
  locale,
  formatNumber,
  level,
  figureClassName,
}: {
  remainingKm: number | null;
  locale: 'ar' | 'en';
  formatNumber: (value: number, locale: 'ar' | 'en') => string;
  /**
   * The alarms board's colouring — «حسن تشبع الالوان»: the distance takes the car's level (red,
   * amber, emerald) and an overdue one is red. Absent, the figure is drawn as it always was.
   */
  level?: FleetAlarmLevel;
  /** When given, the figure alone is set in this class (the boards' monospace), left to right. */
  figureClassName?: string;
}): JSX.Element => {
  const t = useT();
  if (remainingKm === null) {
    // The board's dash is the boards' one grey; elsewhere it keeps the dimmer dark shade it had.
    return (
      <span
        className={level === undefined ? 'text-slate-400 dark:text-slate-600' : 'text-slate-400'}
      >
        —
      </span>
    );
  }
  const say = (key: string, km: number): JSX.Element | string =>
    figureClassName === undefined
      ? t(key, { km: formatNumber(km, locale) })
      : withFigure(t, key, formatNumber(km, locale), figureClassName);
  if (remainingKm < 0) {
    return (
      <span
        className={cn(
          'font-medium',
          level === undefined ? 'text-red-700 dark:text-red-300' : REMAINING_TONE.overdue,
        )}
      >
        {say('fleet.dashboard.overdueKm', Math.abs(remainingKm))}
      </span>
    );
  }
  return (
    <span className={cn('tabular-nums', level !== undefined && REMAINING_TONE[level])}>
      {say('fleet.odometer.kmValue', remainingKm)}
    </span>
  );
};
