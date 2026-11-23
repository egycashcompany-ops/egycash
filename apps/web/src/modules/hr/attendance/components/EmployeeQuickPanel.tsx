// The daily board's pop-up, with its data: one person's recent days, read from the SAME endpoints
// and turned into days by the SAME `toEmployeeDay` as their profile, so the pop-up and the profile
// can never tell two stories. The period ends on the board's date; nothing is computed here.
import { useMemo, useState } from 'react';
import type { Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useAttendanceEmployeePeriod, useAttendanceEmployeeSummary } from '../api/attendance-queries';
import { cairoToday, datesBetween, toEmployeeDay } from '../view-model';
import { EmployeeQuickView, type SheetRow } from '../views';
import { addDays, rangeLabel } from './period';
import { useEmployeePhotoUrl } from '../../employee-management/employees/api/employee-photo';

type QuickPeriod = '7' | '14' | '30';

export const EmployeeQuickPanel = ({
  rows,
  index,
  date,
  onIndex,
  onOpenProfile,
  onClose,
}: {
  /** The board's rows as shown, so previous/next walk the same order the reader sees. */
  rows: SheetRow[];
  index: number;
  /** The board's date: the period ends on it. */
  date: string;
  onIndex: (i: number) => void;
  onOpenProfile: (id: string) => void;
  onClose: () => void;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [period, setPeriod] = useState<QuickPeriod>('7');
  const row = rows[index];
  const from = addDays(date, -(Number(period) - 1));
  const params = useMemo(() => ({ from, to: date, employeeId: row?.id ?? '' }), [from, date, row?.id]);
  const days = useAttendanceEmployeePeriod(params, row !== undefined);
  const summary = useAttendanceEmployeeSummary(params, row !== undefined);
  const photo = useEmployeePhotoUrl(row?.id ?? '', row?.photoFileId ?? null);
  if (row === undefined) return null;

  const today = cairoToday();
  const byDate = new Map((days.data ?? []).map((d) => [d.date.slice(0, 10), d]));
  const list =
    days.data === undefined
      ? []
      : datesBetween(from, date)
          .reverse()
          .map((d) => toEmployeeDay(d, byDate.get(d) ?? null, { today, label: t, locale }));
  const s = summary.data;

  return (
    <EmployeeQuickView
      person={{ name: row.name, code: row.code, photoUrl: photo.url, department: row.department ?? null, status: row.status }}
      position={{
        index,
        total: rows.length,
        onPrev: index > 0 ? () => onIndex(index - 1) : null,
        onNext: index < rows.length - 1 ? () => onIndex(index + 1) : null,
      }}
      period={{
        value: period,
        options: [
          { value: '7', label: t('attendanceView.last7') },
          { value: '14', label: t('attendanceView.last14') },
          { value: '30', label: t('attendance.period.last30') },
        ],
        onChange: (v) => setPeriod(v as QuickPeriod),
        label: rangeLabel({ from, to: date }, locale),
      }}
      kpis={
        s === undefined
          ? null
          : {
              daysPresent: s.daysPresent,
              daysExpected: s.daysExpected,
              lateDays: s.lateDays,
              lateMinutesTotal: s.lateMinutesTotal,
              absentDays: s.absentDays,
              incompleteDays: s.incompleteDays,
              shortfallTotal: s.shortfallMinutesTotal,
              avgWorked: s.avgWorkedMinutes,
            }
      }
      days={list}
      today={today}
      locale={locale === 'en' ? 'en' : 'ar'}
      loading={days.isLoading || summary.isLoading}
      onOpenProfile={() => onOpenProfile(row.id)}
      onClose={onClose}
    />
  );
};
