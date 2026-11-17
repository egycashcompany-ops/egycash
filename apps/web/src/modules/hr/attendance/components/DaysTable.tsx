// The daily record — one employee's days, newest first (the employee month · My Attendance · the
// profile tab). The daily SHEET has its own table: it lists people on one date, and the people it
// exists to surface have no day row at all.
//
// WHAT THE REDESIGN CHANGED. The old table was eight columns of numbers — date, status, in → out,
// worked, late, early leave, overtime, marks — and reading one day meant reading across all of
// them. The question actually asked of this screen is "when did they come and go, and did they
// stay?", so the row now leads with that: WHEN THEY ARRIVED, WHEN THEY LEFT, HOW LONG THAT WAS,
// and a strip of clock that puts the two scans on a scale shared by every row.
//
// NOTHING MEASURED WAS DROPPED. Lateness rides beside the arrival it describes, early leave and
// overtime beside the departure, each as a chip that appears only when there is something to
// say — which is the other half of the change: a column of «0:00» against a day nobody has
// scanned out of is a confident statement about hours nobody measured.
//
// Everything here is a QUANTITY or a classification. There is deliberately no column that could
// carry a price (§1, D5).
import { type AttendanceDayDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Badge, DataTable, type Column } from '../../../../shared/ui';
import { AttendanceDayStatusBadge } from './AttendanceStatusBadge';
import { DayTimeline, TimelineScale } from './DayTimeline';
import { cairoTime, formatMinutes } from './minutes';

/** A quantity nobody has measured prints as a dash, never as a confident zero. */
const unknown = '—';

/** `Mon, 16 Nov 2026` — the weekday earns its place: a Friday absence reads differently. */
const workDateLabel = (workDate: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    // A work date is a calendar day, parsed at UTC midnight so no zone can shift it to the 15th.
    timeZone: 'UTC',
  }).format(new Date(`${workDate.slice(0, 10)}T00:00:00.000Z`));

/** A scan: the dot says whether there was one, the time says when. */
const Punch = ({
  at,
  locale,
  tone,
}: {
  at: string | null;
  locale: Locale;
  tone: string;
}): JSX.Element => (
  <span className="flex items-center gap-2 whitespace-nowrap">
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${at === null ? 'bg-slate-300 dark:bg-slate-600' : tone}`}
    />
    <span dir="ltr" className={at === null ? 'text-slate-400' : 'font-medium'}>
      {at === null ? unknown : cairoTime(at, locale)}
    </span>
  </span>
);

export const DaysTable = ({
  rows,
  loading,
  error,
  onRetry,
  empty,
  rowActions,
}: {
  rows: AttendanceDayDto[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: JSX.Element;
  /** The overtime approval lives on the sheet, and nowhere on the self-service views. */
  rowActions?: (row: AttendanceDayDto) => JSX.Element | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const columns: Column<AttendanceDayDto>[] = [
    {
      key: 'workDate',
      header: t('attendance.days.date'),
      render: (r) => (
        <span className="whitespace-nowrap font-medium text-slate-800 dark:text-slate-100">
          {workDateLabel(r.workDate, locale)}
        </span>
      ),
    },
    {
      key: 'in',
      header: t('attendance.days.arrived'),
      render: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <Punch at={r.firstInAt} locale={locale} tone="bg-emerald-500" />
          {r.lateMinutes > 0 && (
            <Badge tone="warning" size="sm">
              {t('attendance.days.lateBy', { minutes: formatMinutes(r.lateMinutes, locale) })}
            </Badge>
          )}
          {r.flags.map((flag) => (
            <Badge key={flag} tone="neutral" size="sm">
              {t(`attendance.flag.${flag}`)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      key: 'out',
      header: t('attendance.days.left'),
      render: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <Punch at={r.lastOutAt} locale={locale} tone="bg-brand-500" />
          {r.earlyLeaveMinutes > 0 && (
            <Badge tone="warning" size="sm">
              {t('attendance.days.earlyBy', {
                minutes: formatMinutes(r.earlyLeaveMinutes, locale),
              })}
            </Badge>
          )}
          {r.overtimeMinutes > 0 && (
            // Approved over derived: only the first number ever reaches Payroll (D5). With nothing
            // approved yet there is no pair to show — and `formatMinutes(0)` is a dash, which
            // would have read as «إضافي — من ٠:٢٢».
            <Badge tone="info" size="sm">
              {r.approvedOvertimeMinutes > 0
                ? t('attendance.days.overtimeOf', {
                    approved: formatMinutes(r.approvedOvertimeMinutes, locale),
                    derived: formatMinutes(r.overtimeMinutes, locale),
                  })
                : t('attendance.days.overtimePending', {
                    derived: formatMinutes(r.overtimeMinutes, locale),
                  })}
            </Badge>
          )}
          {r.frozenAt !== null && (
            <Badge tone="neutral" size="sm">
              {t('attendance.days.frozen')}
            </Badge>
          )}
        </span>
      ),
    },
    {
      // Hours when they were measured; otherwise the day's own answer for why there are none.
      key: 'worked',
      header: t('attendance.days.worked'),
      render: (r) =>
        r.workedMinutes > 0 ? (
          <strong dir="ltr" className="tabular-nums">
            {formatMinutes(r.workedMinutes, locale)}
          </strong>
        ) : r.firstInAt !== null && r.lastOutAt === null ? (
          // The commonest day on this payroll: they came, and nobody scanned them out.
          <Badge tone="success" size="sm">
            {t('attendance.days.checkedInOnly')}
          </Badge>
        ) : (
          <AttendanceDayStatusBadge status={r.status} size="sm" />
        ),
    },
    {
      key: 'timeline',
      header: t('attendance.days.timeline'),
      // The heading IS the scale: the hour labels have to sit where the row's marks sit, which a
      // word cannot do.
      headerNode: <TimelineScale />,
      render: (r) => <DayTimeline inAt={r.firstInAt} outAt={r.lastOutAt} />,
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
      dense
      embedded
      hoverable
      {...(onRetry === undefined ? {} : { onRetry })}
      {...(empty === undefined ? {} : { empty })}
    />
  );
};
