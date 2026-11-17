// The daily sheet at phone width.
//
// WHY NOT JUST THE TABLE. `DataTable` keeps its columns and scrolls sideways when the screen is
// narrower than they are — correct for a register somebody is comparing column by column, wrong
// for this one. A supervisor opens the sheet on a phone to answer "who is not here yet", and that
// answer should not require dragging a seven-column grid horizontally to reach the status.
//
// So the same rows are laid out as cards below `sm`, with the two things that question needs —
// the face and the status — on the first line, and the times beneath. Nothing is hidden that the
// table shows: a card carries the same fields, stacked.
import { type AttendanceSheetRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { AttendanceDayStatusBadge } from './AttendanceStatusBadge';
import { SheetIdentity, expectedSpan } from './SheetTable';
import { cairoTime, formatMinutes } from './minutes';

const unknown = '—';

const Line = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="shrink-0 text-xs text-slate-500">{label}</span>
    <span className="min-w-0 truncate text-sm">{children}</span>
  </div>
);

export const SheetCards = ({
  rows,
  rowActions,
}: {
  rows: AttendanceSheetRowDto[];
  rowActions?: (row: AttendanceSheetRowDto) => JSX.Element | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((row) => {
        const action = rowActions?.(row) ?? null;
        return (
          <li key={row.employeeId} className="space-y-2 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <SheetIdentity row={row} />
              <AttendanceDayStatusBadge status={row.status} size="sm" />
            </div>
            <div className="space-y-1 ps-[2.625rem]">
              <Line label={t('attendance.daily.expected')}>
                <span dir="ltr" className="text-slate-500">
                  {expectedSpan(row, locale)}
                </span>
              </Line>
              <Line label={t('attendance.days.span')}>
                <span dir="ltr">
                  {row.day === null
                    ? unknown
                    : `${cairoTime(row.day.firstInAt, locale)} → ${cairoTime(row.day.lastOutAt, locale)}`}
                </span>
              </Line>
              {/* Shown only when there is something to say: a dash on every card for a quantity
                  nobody measured is three lines of noise on a screen with room for six rows. */}
              {row.day !== null && row.day.lateMinutes > 0 && (
                <Line label={t('attendance.days.late')}>
                  <span dir="ltr" className="font-medium text-amber-700 dark:text-amber-400">
                    {formatMinutes(row.day.lateMinutes, locale)}
                  </span>
                </Line>
              )}
              {row.day !== null && row.day.overtimeMinutes > 0 && (
                <Line label={t('attendance.days.overtime')}>
                  <span dir="ltr">
                    <strong>{formatMinutes(row.day.approvedOvertimeMinutes, locale)}</strong>
                    <span className="text-slate-500">
                      {' / '}
                      {formatMinutes(row.day.overtimeMinutes, locale)}
                    </span>
                  </span>
                </Line>
              )}
              {action !== null && <div className="pt-1">{action}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
