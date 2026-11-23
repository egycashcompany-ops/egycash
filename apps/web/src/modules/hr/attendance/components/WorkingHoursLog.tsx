// «سجل التعديلات» on the Working Hours page: who changed which department's hours, and when.
//
// Read from the audit log the settings service already writes on every save (see
// `workingHoursHistory` in the API), newest first: the day and time, the person, the department
// and branch, and the hours before → after. «الافتراضي» means the department had no hours of its
// own, so the company default applied.
import { useState } from 'react';
import type { Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { useWorkingHoursHistory } from '../api/attendance-queries';
import type { WorkingHoursChange } from '../api/attendance-api';
import { FIG, INK, INK2, INK3, Sheet, SheetHead } from '../views/view-parts';

const FIRST = 10;

export const WorkingHoursLog = ({ locale }: { locale: Locale }): JSX.Element => {
  const t = useT();
  const query = useWorkingHoursHistory();
  const [all, setAll] = useState(false);
  const rows = query.data ?? [];
  const shown = all ? rows : rows.slice(0, FIRST);

  const when = (iso: string): string =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Africa/Cairo',
    }).format(new Date(iso));

  const rule = (r: WorkingHoursChange['before'], tone: string): JSX.Element =>
    r === null ? (
      <span className={cn('rounded-md bg-[var(--att-muted-soft)] px-2 py-0.5 text-[12.5px]', INK3)}>{t('attendance.workingHours.log.default')}</span>
    ) : (
      <bdi className={cn('rounded-md px-2 py-0.5 text-[12.5px] font-semibold', FIG, tone)}>
        {t('attendance.workingHours.log.rule', { start: r.startTime, hours: r.hours })}
      </bdi>
    );

  return (
    <Sheet className="overflow-hidden">
      <SheetHead title={t('attendance.workingHours.log.title')} note={t('attendance.workingHours.log.note')} />
      {query.isLoading ? (
        <p className={cn('px-6 py-10 text-center text-sm', INK3)}>…</p>
      ) : rows.length === 0 ? (
        <p className={cn('px-6 py-10 text-center text-sm', INK3)}>{t('attendance.workingHours.log.empty')}</p>
      ) : (
        <>
          <ul className="mt-3">
            {shown.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[color:var(--att-line)] px-5 py-3 sm:px-6">
                <span className={cn('w-40 shrink-0 text-[12.5px]', FIG, INK3)}>{when(r.at)}</span>
                <span className={cn('w-40 shrink-0 truncate text-[13.5px] font-semibold', INK)}>
                  {r.by?.[locale] ?? t('attendance.workingHours.log.unknown')}
                </span>
                <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', INK2)}>
                  {r.departmentName?.[locale] ?? '—'}
                  {r.branchName !== null && <span className={INK3}> · {r.branchName[locale]}</span>}
                </span>
                <span className="inline-flex items-center gap-2">
                  {rule(r.before, 'bg-[var(--att-muted-soft)] text-[color:var(--att-ink-2)] line-through decoration-1')}
                  <span className={INK3} aria-hidden>
                    {locale === 'ar' ? '←' : '→'}
                  </span>
                  {rule(r.after, 'bg-[var(--att-accent-soft)] text-[color:var(--att-accent)]')}
                </span>
              </li>
            ))}
          </ul>
          {rows.length > FIRST && (
            <div className="border-t border-[color:var(--att-line)] px-5 py-3 text-center sm:px-6">
              <button type="button" className="text-[13px] font-medium text-[color:var(--att-accent)] hover:underline" onClick={() => setAll(!all)}>
                {all ? t('attendance.workingHours.log.less') : t('attendance.workingHours.log.more', { n: rows.length - FIRST })}
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
};
