// Crew attendance (B5) — read-only, and gating nothing.
//
// THERE IS NO LEGACY SCREEN BEHIND THIS ONE. `/ops_attendance` does not exist in the legacy system
// (discovery §2.2); the only attendance screen there is `/fleet_attendance`, it belongs to the
// DRIVERS department (`الحركة`), it is Fleet's, and ECMS shipped it in FW-5. For cash-transfer
// crew, legacy asked nothing at all: `AbsenceEvent` is queried in six places and none of them
// mentions `نقل الاموال` or `التشغيل` (§10.2), so `/tashghela` would assign an absent captain
// without a murmur.
//
// This page closes the VISIBILITY half of that gap and deliberately not the other half. It shows
// the day's attendance beside the roster so a planner can SEE it. It does not gate assignment: an
// absent crew member remains fully assignable on the crew board, exactly as in legacy. Attendance
// is an indicator here, on the same footing as the requirement flags — the standing owner decision
// that requirements gate nothing applies to this for the same reason.
//
// "Unknown" is its own state and is never shown as present: attendance having no record for
// somebody is not the same fact as that person being at work.
import { useSearchParams } from 'react-router-dom';
import { type OperationsCrewAttendanceDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Badge } from '../../../shared/ui/Badge';
import { formatNumber } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { useCrewAttendance } from '../api/operations-queries';
import { attendanceTone, toIsoDay } from '../lib/attendance-view';

export const CrewAttendancePage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((s) => s.locale.locale);
  const [sp, setSp] = useSearchParams();
  const date = sp.get('date') ?? toIsoDay(new Date());

  const day = useCrewAttendance(date);
  const summary = day.data?.summary;

  const columns: Column<OperationsCrewAttendanceDto>[] = [
    { key: 'code', header: t('operations.crew.code'), render: (row) => row.code },
    { key: 'name', header: t('operations.crew.name'), render: (row) => row.fullNameAr },
    {
      key: 'attendance',
      header: t('operations.attendance.status'),
      render: (row) =>
        row.attendance === null ? (
          <Badge tone="neutral">{t('operations.attendance.unknown')}</Badge>
        ) : (
          <Badge tone={attendanceTone(row.attendance.status)}>
            {t(`attendance.dayStatus.${row.attendance.status}`)}
          </Badge>
        ),
    },
    {
      key: 'assigned',
      // The reason a planner is on this page: somebody absent who is nevertheless crewed today.
      header: t('operations.attendance.assignedToday'),
      render: (row) =>
        row.assignedVehicleId === null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <Badge tone="info">{t('operations.attendance.assigned')}</Badge>
        ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.attendance.title')}
        description={t('operations.attendance.subtitle')}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">{t('operations.attendance.date')}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              const params = new URLSearchParams(sp);
              params.set('date', e.target.value);
              setSp(params);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
      </div>

      {/* The banner is not decoration: this page exists next to a planning board, and a reader
          must not conclude that a red row blocks anything. It states the rule in one line. */}
      <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        {t('operations.attendance.nonGatingNotice')}
      </p>

      {summary !== undefined && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ['total', summary.total],
              ['present', summary.present],
              ['absent', summary.absent],
              ['onLeave', summary.onLeave],
              ['notScheduled', summary.notScheduled],
              ['unknown', summary.unknown],
            ] as const
          ).map(([key, value]) => (
            <div
              key={key}
              className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              <div className="text-xs text-slate-500">{t(`operations.attendance.count.${key}`)}</div>
              <div className="tabular-nums text-lg">{formatNumber(value, locale)}</div>
            </div>
          ))}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={day.data?.members ?? []}
        rowKey={(row) => row.employeeId}
        loading={day.isLoading}
        error={day.error}
        onRetry={() => void day.refetch()}
        empty={t('operations.attendance.empty')}
      />
    </PageContainer>
  );
};
