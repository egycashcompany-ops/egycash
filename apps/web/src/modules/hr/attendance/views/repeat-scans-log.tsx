// «سجل البصمات المتكررة» — under the employee's daily record.
//
// The days on which the person pressed check-in or check-out more than once (the branch server's
// website lists the same thing as repeats). Only the first check-in and the first check-out count;
// this log keeps the extra presses visible so a manager can see who scans five or six times a day.
// Each day says how many check-ins and check-outs there were; the days with the most come first
// in their own colour, and every day opens to its scans to the second, with which two counted.
import { useState } from 'react';
import { cn } from '../../../../shared/lib/cn';
import { useT } from '../../../../platform/localization/useT';
import { FIG, INK, INK2, INK3, SOFT, type Tone } from './view-parts';
import { dayLabel, num } from './view-format';
import type { EmployeeDay, ScanEntry } from './view-types';

/** A day with this many check-ins or check-outs (or more) is marked as heavy. */
export const HEAVY_REPEATS = 5;

const ROLE_TONE: Record<ScanEntry['role'], Tone> = { arrival: 'ok', departure: 'info', repeat: 'warn' };

interface RepeatDay {
  day: EmployeeDay;
  ins: number;
  outs: number;
  extra: number;
  heavy: boolean;
}

export const repeatDays = (days: EmployeeDay[]): RepeatDay[] =>
  days
    .filter((d) => (d.repeats ?? 0) > 0 && (d.scans?.length ?? 0) > 0)
    .map((d) => {
      const scans = d.scans ?? [];
      const ins = scans.filter((s) => s.direction === 'in').length;
      const outs = scans.filter((s) => s.direction === 'out').length;
      return { day: d, ins, outs, extra: d.repeats ?? 0, heavy: ins >= HEAVY_REPEATS || outs >= HEAVY_REPEATS };
    })
    .sort((a, b) => Number(b.heavy) - Number(a.heavy) || b.day.date.localeCompare(a.day.date));

export const RepeatScansLog = ({ days, locale }: { days: EmployeeDay[]; locale: 'ar' | 'en' }): JSX.Element => {
  const t = useT();
  const rows = repeatDays(days);
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) return <p className={cn('px-6 py-10 text-center text-sm', INK3)}>{t('attendanceView.repeatLogEmpty')}</p>;

  return (
    <ul className="pb-2">
      {rows.map(({ day, ins, outs, extra, heavy }) => {
        const isOpen = open === day.date;
        return (
          <li key={day.date} className="border-t border-[color:var(--att-line)]">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : day.date)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 text-start transition-colors hover:bg-[var(--att-sheet-2)] sm:px-6"
            >
              <span className={cn('w-36 shrink-0 text-[14px] font-semibold', FIG, INK)}>{dayLabel(day.date, locale)}</span>
              <Count tone={ins >= HEAVY_REPEATS ? 'bad' : 'ok'} text={t('attendanceView.repeatIns', { n: num(ins) })} />
              <Count tone={outs >= HEAVY_REPEATS ? 'bad' : 'info'} text={t('attendanceView.repeatOuts', { n: num(outs) })} />
              <span className={cn('text-[12.5px]', FIG, INK3)}>{t('attendanceView.repeats', { n: num(extra) })}</span>
              {heavy && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', SOFT.bad)}>{t('attendanceView.repeatHeavy', { n: HEAVY_REPEATS })}</span>}
              <span className={cn('ms-auto text-[12.5px] font-medium text-[color:var(--att-accent)]')}>
                {t(isOpen ? 'attendanceView.hideScans' : 'attendanceView.showScans')}
              </span>
            </button>
            {isOpen && (
              <table className="att-open mx-5 mb-3 w-[calc(100%-2.5rem)] text-[13px] sm:mx-6 sm:w-[calc(100%-3rem)]">
                <thead>
                  <tr className={cn('text-start text-[11.5px]', INK3)}>
                    <th className="py-1.5 text-start font-medium">{t('attendanceView.time')}</th>
                    <th className="py-1.5 text-start font-medium">{t('attendanceView.direction')}</th>
                    <th className="py-1.5 text-start font-medium">{t('attendanceView.device')}</th>
                    <th className="py-1.5 text-end font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {(day.scans ?? []).map((s, i) => (
                    <tr key={`${s.time}-${i}`} className="border-t border-[color:var(--att-line)]">
                      <td className={cn('py-1.5 font-semibold', FIG, INK)}>
                        {s.time}
                        {s.dayOffset > 0 && <sup className={cn('ms-0.5 text-[9.5px]', INK3)}>+{s.dayOffset}</sup>}
                      </td>
                      <td className={cn('py-1.5', INK2)}>{t(`attendanceView.dir.${s.direction}`)}</td>
                      <td className={cn('py-1.5', INK3)}>{s.device ?? t(`attendanceView.source.${s.source}`)}</td>
                      <td className="py-1.5 text-end">
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', SOFT[ROLE_TONE[s.role]])}>{t(`attendanceView.role.${s.role}`)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const Count = ({ tone, text }: { tone: Tone; text: string }): JSX.Element => (
  <bdi className={cn('rounded-lg px-2 py-0.5 text-[12.5px] font-semibold', FIG, SOFT[tone])}>{text}</bdi>
);
