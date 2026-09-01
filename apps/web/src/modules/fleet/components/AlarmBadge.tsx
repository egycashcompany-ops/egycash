// The maintenance alarm's LEVEL, drawn one way.
//
// The same three tones were written out in the dashboard, the odometer log and the alarms board —
// identical today, and three places for them to stop being identical tomorrow. A level means the
// same thing wherever it is shown, so it looks the same wherever it is shown, and the maintenance
// screen joining them adds a reader rather than a fourth copy.
//
// Presentation ONLY. The level itself is `computeAlarm`'s, derived server-side per request; this
// module decides no threshold and recomputes nothing.
import { type FleetAlarmLevel } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Badge } from '../../../shared/ui/Badge';

/**
 * The alarm's colour as a SURFACE — the one definition of what red and yellow look like when they
 * tint something rather than sit in a pill.
 *
 * Two intensities of one decision, in one object. A `row` tint spans a whole table row and has to
 * stay quiet enough to read text through, so it matches the weight of the green already used for a
 * closed visit; a `cell` tint is a small patch sitting beside a badge that is itself `-100`, and at
 * row weight it would simply not be visible. Different surfaces, same colour choice — and both
 * here, because the alternative is each screen inventing its own red.
 *
 * `none` is deliberately absent: a vehicle with no alarm is not a state worth tinting, and
 * colouring it would spend the reader's attention on the ordinary case.
 */
const ALARM_TINT: Record<'yellow' | 'red', { row: string; cell: string }> = {
  yellow: {
    row: 'bg-amber-50/70 dark:bg-amber-950/30',
    cell: 'bg-amber-100/80 dark:bg-amber-950/50',
  },
  red: {
    row: 'bg-red-50/70 dark:bg-red-950/30',
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

export const AlarmBadge = ({ level }: { level: FleetAlarmLevel }): JSX.Element => {
  const t = useT();
  if (level === 'none') return <Badge tone="neutral">{t('fleet.vehicle.alarmNone')}</Badge>;
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
