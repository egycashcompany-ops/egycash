// The month grid: one cell per calendar day, coloured by status, with the worked total under it.
// It is a READING of the day rows — never a second derivation — so a day the engine has not
// computed renders as an empty cell rather than as a guess.
import { type AttendanceDayDto, type AttendanceDayStatus, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { formatMinutes } from './minutes';

const TONE: Record<AttendanceDayStatus, string> = {
  present: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  late: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  earlyLeave: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  lateAndEarly: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  absent: 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200',
  incomplete: 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200',
  onLeave: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  weekend: 'bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400',
  holiday: 'bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400',
  dayOff: 'bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400',
};

/** `month` is `YYYY-MM`; the grid spans that month's real length, not a fixed 31. */
export const MonthGrid = ({
  month,
  rows,
  onSelect,
}: {
  month: string;
  rows: AttendanceDayDto[];
  onSelect?: (row: AttendanceDayDto) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [year, monthIndex] = month.split('-').map(Number) as [number, number];
  const dayCount = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const byDate = new Map(rows.map((row) => [row.workDate.slice(0, 10), row]));

  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
      role="list"
      aria-label={t('attendance.month.gridLabel')}
    >
      {Array.from({ length: dayCount }, (_, index) => {
        const dayNumber = index + 1;
        const iso = `${month}-${String(dayNumber).padStart(2, '0')}`;
        const row = byDate.get(iso);
        const tone =
          row === undefined
            ? 'bg-white text-slate-400 dark:bg-slate-950 dark:text-slate-600'
            : TONE[row.status];
        const label =
          row === undefined
            ? t('attendance.month.noRow')
            : `${t(`attendance.dayStatus.${row.status}`)} · ${formatMinutes(row.workedMinutes, locale)}`;
        const cell = (
          <>
            <span className="text-xs font-semibold" dir="ltr">
              {dayNumber}
            </span>
            <span className="mt-1 block text-[11px] leading-tight">{label}</span>
          </>
        );
        return (
          <div key={iso} role="listitem">
            {row !== undefined && onSelect !== undefined ? (
              <button
                type="button"
                onClick={() => onSelect(row)}
                aria-label={`${iso} — ${label}`}
                className={`w-full rounded-lg border border-slate-200 p-2 text-start hover:ring-2 hover:ring-brand-400 dark:border-slate-800 ${tone}`}
              >
                {cell}
              </button>
            ) : (
              <div
                aria-label={`${iso} — ${label}`}
                className={`rounded-lg border border-slate-200 p-2 dark:border-slate-800 ${tone}`}
              >
                {cell}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
