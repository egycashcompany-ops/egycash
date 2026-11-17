// The daily sheet's own table, because the sheet's row is not a day record.
//
// `DaysTable` renders `AttendanceDayDto` and is shared by the employee month, My Attendance and
// the profile tab — all three of which list ROWS THAT EXIST. The sheet lists PEOPLE, and the
// people it exists to surface are the ones with no row yet: a no-show has no id, no `computedAt`
// and no quantities, so handing `DaysTable` a synthesized row would mean inventing all three and
// teaching three other screens about a case none of them has.
//
// WHAT THE REDESIGN CHANGED (stage 6). The row leads with a FACE and a name rather than a code,
// because a supervisor reads this screen looking for people they know by sight. The scheduled
// hours sit beside the actual ones so the comparison the screen exists for — due at nine, scanned
// at ten past — is one glance and not a subtraction. And a quantity nobody has measured prints as
// a dash: a confident `0:00` in the late column of somebody who has not arrived is a lie the old
// table told on every unscanned row.
import { type AttendanceSheetRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { DataTable, type Column } from '../../../../shared/ui';
import { AttendanceDayStatusBadge } from './AttendanceStatusBadge';
import { SheetAvatar } from './SheetAvatar';
import { cairoTime, formatMinutes } from './minutes';

/** A quantity nobody has measured prints as a dash, never as a confident zero. */
const unknown = '—';

/** The employee cell, shared by the table and the phone-width cards below it. */
export const SheetIdentity = ({ row }: { row: AttendanceSheetRowDto }): JSX.Element => (
  <span className="flex items-center gap-2.5">
    <SheetAvatar
      employeeId={row.employeeId}
      photoFileId={row.employeePhotoFileId}
      name={row.employeeName}
    />
    <span className="min-w-0">
      <span className="block truncate font-medium text-slate-800 dark:text-slate-100">
        {row.employeeName}
      </span>
      <span className="block truncate font-mono text-xs text-slate-500" dir="ltr">
        {row.employeeCode}
      </span>
    </span>
  </span>
);

/** `09:00 → 17:00`, or a dash when nobody has said when this person is due. */
export const expectedSpan = (row: AttendanceSheetRowDto, locale: Locale): string =>
  row.expectedStartAt === null
    ? unknown
    : `${cairoTime(row.expectedStartAt, locale)} → ${cairoTime(row.expectedEndAt, locale)}`;

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
      render: (r) => <SheetIdentity row={r} />,
    },
    {
      key: 'status',
      header: t('attendance.days.status'),
      render: (r) => <AttendanceDayStatusBadge status={r.status} />,
    },
    {
      // What was expected of them today, as the assignment or the branch pattern stands NOW.
      // Blank means nobody has said when this person is due — which is why their empty day reads
      // as «لا يوجد جدول» rather than as an absence.
      key: 'expected',
      header: t('attendance.daily.expected'),
      render: (r) => (
        <span dir="ltr" className="whitespace-nowrap text-xs text-slate-500">
          {expectedSpan(r, locale)}
        </span>
      ),
    },
    {
      key: 'span',
      header: t('attendance.days.span'),
      render: (r) => (
        <span dir="ltr" className="whitespace-nowrap text-xs">
          {r.day === null
            ? unknown
            : `${cairoTime(r.day.firstInAt, locale)} → ${cairoTime(r.day.lastOutAt, locale)}`}
        </span>
      ),
    },
    {
      key: 'late',
      header: t('attendance.days.late'),
      render: (r) =>
        r.day === null || r.day.lateMinutes === 0 ? (
          <span className="text-slate-400">{unknown}</span>
        ) : (
          <span dir="ltr" className="font-medium text-amber-700 dark:text-amber-400">
            {formatMinutes(r.day.lateMinutes, locale)}
          </span>
        ),
    },
    {
      // Approved over derived: only the first number ever reaches Payroll (D5).
      key: 'overtime',
      header: t('attendance.days.overtime'),
      render: (r) =>
        r.day === null || r.day.overtimeMinutes === 0 ? (
          <span className="text-slate-400">{unknown}</span>
        ) : (
          <span dir="ltr" className="whitespace-nowrap text-xs">
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
      // `dense` is the mode built for rows carrying avatars and chips: those set the row height on
      // their own, so the usual padding only pushes rows off the screen.
      dense
      embedded
      hoverable
      {...(onRetry === undefined ? {} : { onRetry })}
      {...(empty === undefined ? {} : { empty })}
    />
  );
};
