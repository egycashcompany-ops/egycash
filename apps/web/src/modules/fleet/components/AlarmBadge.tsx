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
