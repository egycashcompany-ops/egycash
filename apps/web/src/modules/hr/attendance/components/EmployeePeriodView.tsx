// One employee's attendance over a period — the SAME view wherever it is opened: the employee
// month page, the Attendance tab of a profile, and My Attendance.
//
// ONE COMPONENT RATHER THAN THREE COPIES. The three screens differ only in who the subject is and
// which endpoint answers for them (`/days` scoped, or `/days/me` which is own-scope by
// construction). Everything below that — which days are drawn, which figures are shown, which
// controls are offered — is the same question about the same rows, and three copies of it would
// drift apart by the second change. An employee looking at themselves therefore sees exactly what
// HR sees about them, minus the controls their keys do not open.
//
// EVERY FIGURE COMES FROM THE SERVER. The KPIs are computed over the whole period beside the rows
// they come from; this component does no arithmetic over a month and invents nothing. While they
// are still in flight it shows a loading state rather than a screen of zeros that a reader would
// believe.
import { useState } from 'react';
import {
  type AttendanceDayDto,
  type AttendanceEmployeeSummaryDto,
  type AttendanceSheetRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Button } from '../../../../shared/ui';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { formatBusinessDateTime } from '../../../../shared/lib/format';
import { DayDecisionDialog } from './DayDecisionDialog';
import { Input } from '../../../../shared/ui/form';
import {
  addDays,
  MAX_PERIOD_DAYS,
  periodRange,
  rangeLabel,
  type PeriodKey,
  type PeriodRange,
} from './period';
import { cairoToday, datesBetween, toEmployeeDay } from '../view-model';
import { EmployeeAttendanceView, Segmented, type EmployeeHeader } from '../views';

export interface PeriodState extends PeriodRange {
  key: PeriodKey;
}

/** The three presets the owner asked for, plus the custom range the screens already had. */
const PERIOD_OPTIONS: PeriodKey[] = ['thisMonth', 'lastMonth', 'last30', 'custom'];

export const EmployeePeriodView = ({
  employeeId,
  header,
  rows,
  summary,
  loading,
  error,
  period,
  onPeriodChange,
  onExport,
  canDecide = false,
}: {
  employeeId: string;
  header: Omit<EmployeeHeader, 'lastPunch'>;
  /** The period's day rows, in any order — the view is handed one entry per DATE. */
  rows: AttendanceDayDto[];
  summary: AttendanceEmployeeSummaryDto | undefined;
  loading: boolean;
  error?: unknown;
  period: PeriodState;
  onPeriodChange: (next: PeriodState) => void;
  /** Offered only where `attendance.export` is held — an employee reads their own month. */
  onExport?: () => void;
  /** Offered only where `attendance.decide` is held, and never on somebody's own page. */
  canDecide?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [deciding, setDeciding] = useState<AttendanceDayDto | 'noRow' | null>(null);
  const [decidingDate, setDecidingDate] = useState<string>('');

  const spanDays = (from: string, to: string): number =>
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000 + 1;

  /**
   * A hand-typed range is held to the same 92 days the server's export and recompute are capped
   * at — and, more immediately, to a page the screen can actually show: one request carries at
   * most `MAX_PAGE_SIZE` rows, so a longer range would quietly drop days off the end. The end the
   * reader did NOT just touch is the one that moves.
   */
  const setFrom = (from: string): void => {
    if (from === '') return;
    const to = period.to < from ? from : period.to;
    onPeriodChange({
      ...period,
      from,
      to: spanDays(from, to) > MAX_PERIOD_DAYS ? addDays(from, MAX_PERIOD_DAYS - 1) : to,
    });
  };
  const setTo = (to: string): void => {
    if (to === '') return;
    const from = to < period.from ? to : period.from;
    onPeriodChange({
      ...period,
      to,
      from: spanDays(from, to) > MAX_PERIOD_DAYS ? addDays(to, -(MAX_PERIOD_DAYS - 1)) : from,
    });
  };

  const periodPicker = (
    <span className="flex flex-wrap items-center gap-2">
      <Segmented
        value={period.key}
        options={PERIOD_OPTIONS.map((key) => ({
          value: key,
          label: t(`attendance.period.${key}`),
        }))}
        onChange={(key) =>
          onPeriodChange(key === 'custom' ? { ...period, key } : { key, ...periodRange(key) })
        }
      />
      {period.key === 'custom' && (
        <>
          <Input
            type="date"
            value={period.from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label={t('attendance.period.from')}
            dir="ltr"
            className="w-auto"
          />
          <Input
            type="date"
            value={period.to}
            onChange={(e) => setTo(e.target.value)}
            aria-label={t('attendance.period.to')}
            dir="ltr"
            className="w-auto"
          />
        </>
      )}
    </span>
  );

  if (error !== undefined && error !== null) {
    return <ErrorState error={error} />;
  }
  // No figures yet: a screen of zeros reads as "this person attended nothing", which is a claim
  // about them rather than about the request still being in flight.
  if (summary === undefined) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">{periodPicker}</div>
        <LoadingState />
      </div>
    );
  }

  const today = cairoToday();
  const byDate = new Map(rows.map((row) => [row.workDate.slice(0, 10), row]));

  /** The decide button for one day, offered only where the key is held and the day is not frozen. */
  const actionFor = (date: string, day: AttendanceDayDto | null): JSX.Element | undefined => {
    if (!canDecide) return undefined;
    if (day !== null && day.frozenAt !== null) return undefined;
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setDecidingDate(date);
          setDeciding(day ?? 'noRow');
        }}
      >
        {t('attendance.decision.action')}
      </Button>
    );
  };

  // EVERY DATE OF THE PERIOD, oldest first. The calendar lays its weeks out by position, so a
  // missing date would shift every cell after it onto the wrong weekday; a date the engine has
  // concluded nothing about keeps its place and says «لا يوجد سجل».
  const days = datesBetween(period.from, period.to).map((date) => {
    const day = byDate.get(date) ?? null;
    const action = actionFor(date, day);
    return toEmployeeDay(date, day, {
      today,
      label: t,
      ...(action === undefined ? {} : { action }),
    });
  });

  /** The dialog speaks the sheet's row shape; this is the same day, said in its words. */
  const decidingRow: AttendanceSheetRowDto | null =
    deciding === null
      ? null
      : {
          employeeId,
          employeeCode: header.code,
          employeeName: header.name,
          employeePhotoFileId: null,
          employeeDepartment: null,
          branchId: '',
          date: decidingDate,
          status: 'pending',
          expectedStartAt: null,
          expectedEndAt: null,
          day: deciding === 'noRow' ? null : deciding,
        };

  return (
    <>
      <EmployeeAttendanceView
        employee={{
          ...header,
          lastPunch:
            summary.lastPunchAt === null
              ? null
              : formatBusinessDateTime(summary.lastPunchAt, locale),
        }}
        periodPicker={periodPicker}
        periodLabel={rangeLabel(period, locale)}
        kpis={{
          daysPresent: summary.daysPresent,
          daysExpected: summary.daysExpected,
          usualArrival: summary.usualArrival,
          usualDeparture: summary.usualDeparture,
          avgWorked: summary.avgWorkedMinutes,
          totalWorked: summary.totalWorkedMinutes,
          lateDays: summary.lateDays,
          lateMinutesTotal: summary.lateMinutesTotal,
          absentDays: summary.absentDays,
          incompleteDays: summary.incompleteDays,
        }}
        days={days}
        dayStart={summary.dayStart}
        grace={summary.graceMinutes}
        today={today}
        {...(onExport === undefined ? {} : { onExport })}
      />
      {loading && <span className="sr-only">{t('common.loading')}</span>}
      {decidingRow !== null && (
        <DayDecisionDialog
          row={decidingRow}
          onClose={() => {
            setDeciding(null);
            setDecidingDate('');
          }}
        />
      )}
    </>
  );
};
