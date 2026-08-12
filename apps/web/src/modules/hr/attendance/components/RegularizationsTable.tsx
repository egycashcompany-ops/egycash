// The shared regularization table (the queue · My Attendance · the profile tab). The decision
// buttons live here, and they appear ONLY where the caller could actually decide: the manager
// step for a manager or a key-holder, the HR step for a key-holder — and never on the caller's
// own request (C7). The server re-checks every one of those, this only stops offering the
// impossible.
import { useState } from 'react';
import { type AttendanceRegularizationDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Button, DataTable, type Column } from '../../../../shared/ui';
import { formatDate } from '../../../../shared/lib/format';
import { RegularizationStatusBadge } from './AttendanceStatusBadge';
import { cairoTime } from './minutes';
import { useDecideRegularization } from '../api/attendance-queries';

export const RegularizationsTable = ({
  rows,
  loading,
  error,
  onRetry,
  showEmployee = false,
  showDecisions = false,
  empty,
}: {
  rows: AttendanceRegularizationDto[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  showEmployee?: boolean;
  /** The queue passes true; the self-service views never do. */
  showDecisions?: boolean;
  empty?: JSX.Element;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const decide = useDecideRegularization();
  const [acting, setActing] = useState<string | null>(null);

  const act = (row: AttendanceRegularizationDto, verdict: 'approve' | 'reject'): void => {
    setActing(row.id);
    decide.mutate(
      { id: row.id, body: { verdict, version: row.version } },
      { onSettled: () => setActing(null) },
    );
  };

  const columns: Column<AttendanceRegularizationDto>[] = [
    ...(showEmployee
      ? [
          {
            key: 'employee',
            header: t('attendance.reg.employee'),
            render: (r: AttendanceRegularizationDto) => (
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
      header: t('attendance.reg.workDate'),
      render: (r) => (
        <span dir="ltr" className="text-xs">
          {formatDate(r.workDate, locale)}
        </span>
      ),
    },
    {
      key: 'proposed',
      header: t('attendance.reg.proposed'),
      render: (r) => (
        <span dir="ltr" className="text-xs">
          {cairoTime(r.proposedInAt, locale)} → {cairoTime(r.proposedOutAt, locale)}
        </span>
      ),
    },
    { key: 'reason', header: t('attendance.reg.reason'), render: (r) => r.reason },
    {
      key: 'status',
      header: t('attendance.reg.status'),
      render: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <RegularizationStatusBadge status={r.status} />
          {r.postFreeze && (
            <span
              className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              title={t('attendance.reg.postFreezeHint')}
            >
              {t('attendance.reg.postFreeze')}
            </span>
          )}
          {r.direct && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {t('attendance.reg.direct')}
            </span>
          )}
        </span>
      ),
    },
    ...(showDecisions
      ? [
          {
            key: 'decide',
            header: t('attendance.reg.decision'),
            render: (r: AttendanceRegularizationDto) =>
              r.status === 'pendingManager' || r.status === 'pendingHr' ? (
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    loading={acting === r.id && decide.isPending}
                    onClick={() => act(r, 'approve')}
                  >
                    {t('attendance.reg.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={acting === r.id && decide.isPending}
                    onClick={() => act(r, 'reject')}
                  >
                    {t('attendance.reg.reject')}
                  </Button>
                </span>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      {decide.isError && (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {(decide.error as Error).message}
        </p>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading ?? false}
        error={error}
        {...(onRetry === undefined ? {} : { onRetry })}
        {...(empty === undefined ? {} : { empty })}
      />
    </>
  );
};
