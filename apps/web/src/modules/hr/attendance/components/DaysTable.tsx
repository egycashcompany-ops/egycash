// The shared day table (daily sheet · employee month · My Attendance · the profile tab).
// Columns adapt via `showEmployee`; everything it renders is a QUANTITY or a classification —
// there is deliberately no column that could carry a price (§1, D5).
import { type AttendanceDayDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { DataTable, type Column } from '../../../../shared/ui';
import { formatDate } from '../../../../shared/lib/format';
import { AttendanceDayStatusBadge } from './AttendanceStatusBadge';
import { cairoTime, formatMinutes } from './minutes';

export const DaysTable = ({
  rows,
  loading,
  error,
  onRetry,
  showEmployee = false,
  empty,
  rowActions,
}: {
  rows: AttendanceDayDto[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  showEmployee?: boolean;
  empty?: JSX.Element;
  /** The overtime approval lives here on the sheet, and nowhere on the self-service views. */
  rowActions?: (row: AttendanceDayDto) => JSX.Element | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const columns: Column<AttendanceDayDto>[] = [
    ...(showEmployee
      ? [
          {
            key: 'employee',
            header: t('attendance.days.employee'),
            render: (r: AttendanceDayDto) => (
              <span>
                {r.employeeName ?? '—'}{' '}
                <span className="font-mono text-xs text-slate-500" dir="ltr">
                  {r.employeeCode ?? ''}
                </span>
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'workDate',
      header: t('attendance.days.date'),
      render: (r) => (
        <span dir="ltr" className="text-xs">
          {formatDate(r.workDate, locale)}
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
          {cairoTime(r.firstInAt, locale)} → {cairoTime(r.lastOutAt, locale)}
        </span>
      ),
    },
    {
      key: 'worked',
      header: t('attendance.days.worked'),
      render: (r) => (
        <strong dir="ltr">{formatMinutes(r.workedMinutes, locale)}</strong>
      ),
    },
    {
      key: 'late',
      header: t('attendance.days.late'),
      render: (r) => <span dir="ltr">{formatMinutes(r.lateMinutes, locale)}</span>,
    },
    {
      key: 'early',
      header: t('attendance.days.earlyLeave'),
      render: (r) => <span dir="ltr">{formatMinutes(r.earlyLeaveMinutes, locale)}</span>,
    },
    {
      // Derived vs approved, side by side: only the second number ever reaches Payroll (D5).
      key: 'overtime',
      header: t('attendance.days.overtime'),
      render: (r) => (
        <span dir="ltr" className="text-xs">
          <strong>{formatMinutes(r.approvedOvertimeMinutes, locale)}</strong>
          <span className="text-slate-500"> / {formatMinutes(r.overtimeMinutes, locale)}</span>
        </span>
      ),
    },
    {
      key: 'marks',
      header: t('attendance.days.marks'),
      render: (r) => (
        <span className="flex flex-wrap gap-1 text-xs text-slate-500">
          {r.frozenAt !== null && (
            <span
              className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800"
              title={t('attendance.days.frozenHint')}
            >
              {t('attendance.days.frozen')}
            </span>
          )}
          {r.flags.map((flag) => (
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
            render: (r: AttendanceDayDto) => rowActions(r),
          },
        ]),
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      loading={loading ?? false}
      error={error}
      {...(onRetry === undefined ? {} : { onRetry })}
      {...(empty === undefined ? {} : { empty })}
    />
  );
};
