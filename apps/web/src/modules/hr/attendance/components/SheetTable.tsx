// The daily sheet's own table, because the sheet's row is not a day record.
//
// `DaysTable` renders `AttendanceDayDto` and is shared by the employee month, My Attendance and
// the profile tab — all three of which list ROWS THAT EXIST. The sheet lists PEOPLE, and the
// people it exists to surface are the ones with no row yet: a no-show has no id, no `computedAt`
// and no quantities, so handing `DaysTable` a synthesized row would mean inventing all three and
// teaching three other screens about a case none of them has.
//
// What the sheet adds, and the day table has nowhere to put: the hours the person was EXPECTED,
// resolved when the page was read rather than stored, and a status that may not be the one on the
// row — «لم يحضر بعد» until the hour they were due, «غائب» after it.
import { type AttendanceSheetRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { DataTable, type Column } from '../../../../shared/ui';
import { AttendanceDayStatusBadge } from './AttendanceStatusBadge';
import { cairoTime, formatMinutes } from './minutes';

/** A quantity nobody has measured prints as a dash, never as a confident zero. */
const unknown = '—';

export const SheetTable = ({
  rows,
  loading,
  error,
  onRetry,
  empty,
  rowActions,
}: {
  rows: AttendanceSheetRowDto[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: JSX.Element;
  /** Offered only where there is a day row to act on — the overtime approval needs its version. */
  rowActions?: (row: AttendanceSheetRowDto) => JSX.Element | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const columns: Column<AttendanceSheetRowDto>[] = [
    {
      key: 'employee',
      header: t('attendance.days.employee'),
      render: (r) => (
        <span>
          {r.employeeName}{' '}
          <span className="font-mono text-xs text-slate-500" dir="ltr">
            {r.employeeCode}
          </span>
        </span>
      ),
    },
    {
      // What was expected of them today, as the assignment or the branch pattern stands NOW.
      // Blank means nobody has said when this person is due — which is why their empty day reads
      // as a day off rather than as an absence.
      key: 'expected',
      header: t('attendance.daily.expected'),
      render: (r) => (
        <span dir="ltr" className="text-xs text-slate-500">
          {r.expectedStartAt === null
            ? unknown
            : `${cairoTime(r.expectedStartAt, locale)} → ${cairoTime(r.expectedEndAt, locale)}`}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('attendance.days.status'),
      render: (r) => <AttendanceDayStatusBadge status={r.status} />,
    },
    {
      key: 'span',
      header: t('attendance.days.span'),
      render: (r) => (
        <span dir="ltr" className="text-xs">
          {r.day === null
            ? unknown
            : `${cairoTime(r.day.firstInAt, locale)} → ${cairoTime(r.day.lastOutAt, locale)}`}
        </span>
      ),
    },
    {
      key: 'worked',
      header: t('attendance.days.worked'),
      render: (r) => (
        <strong dir="ltr">
          {r.day === null ? unknown : formatMinutes(r.day.workedMinutes, locale)}
        </strong>
      ),
    },
    {
      key: 'late',
      header: t('attendance.days.late'),
      render: (r) => (
        <span dir="ltr">{r.day === null ? unknown : formatMinutes(r.day.lateMinutes, locale)}</span>
      ),
    },
    {
      key: 'overtime',
      header: t('attendance.days.overtime'),
      render: (r) =>
        r.day === null ? (
          <span dir="ltr">{unknown}</span>
        ) : (
          <span dir="ltr" className="text-xs">
            <strong>{formatMinutes(r.day.approvedOvertimeMinutes, locale)}</strong>
            <span className="text-slate-500">
              {' / '}
              {formatMinutes(r.day.overtimeMinutes, locale)}
            </span>
          </span>
        ),
    },
    {
      key: 'marks',
      header: t('attendance.days.marks'),
      render: (r) => (
        <span className="flex flex-wrap gap-1 text-xs text-slate-500">
          {r.day !== null && r.day.frozenAt !== null && (
            <span
              className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800"
              title={t('attendance.days.frozenHint')}
            >
              {t('attendance.days.frozen')}
            </span>
          )}
          {(r.day?.flags ?? []).map((flag) => (
            <span key={flag} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
              {t(`attendance.flag.${flag}`)}
            </span>
          ))}
        </span>
      ),
    },
    ...(rowActions === undefined
      ? []
      : [
          {
            key: 'actions',
            header: t('attendance.days.actions'),
            render: (r: AttendanceSheetRowDto) => rowActions(r),
          },
        ]),
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      // The EMPLOYEE is the identity of a sheet line: there may be no day row to take one from,
      // and there is exactly one line per employee per date.
      rowKey={(r) => r.employeeId}
      loading={loading ?? false}
      error={error}
      {...(onRetry === undefined ? {} : { onRetry })}
      {...(empty === undefined ? {} : { empty })}
    />
  );
};
