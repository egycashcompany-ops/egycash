// Who has been deciding days (stage 4 §4).
//
// THIS IS A PROMPT TO LOOK, AND THE COPY HAS TO SAY SO. Crossing the threshold blocks nothing,
// refuses nothing and undoes nothing — a supervisor whose fingerprint reader broke will cross it
// legitimately, and that is precisely the week worth opening. A screen that implied wrongdoing
// from a number would be read as an accusation, and would be wrong most of the time it fired.
//
// Both figures are shown together on purpose: a manager with forty decisions of which none went
// against a device is doing data entry for a broken reader, and one with four that all did is a
// different conversation. Either number alone invites the wrong conclusion.
import { type AttendanceDecisionSignalsDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';

export const DecisionSignals = ({
  data,
}: {
  data: AttendanceDecisionSignalsDto | undefined;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (data === undefined || data.managers.length === 0) return null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
        {t('attendance.signals.title')}
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        {t('attendance.signals.hint', { threshold: String(data.threshold) })}
      </p>
      <ul className="flex flex-wrap gap-2">
        {data.managers.map((manager) => (
          <li
            key={manager.decidedBy}
            className={`rounded border px-2.5 py-1.5 text-xs ${
              manager.flagged
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
            }`}
          >
            <span className="font-medium">{localized(manager.decidedByName, locale)}</span>{' '}
            <span dir="ltr" className="font-mono">
              {manager.total}
            </span>
            {manager.overrodePunch > 0 && (
              <>
                {' · '}
                {t('attendance.signals.overrode', { count: String(manager.overrodePunch) })}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};
