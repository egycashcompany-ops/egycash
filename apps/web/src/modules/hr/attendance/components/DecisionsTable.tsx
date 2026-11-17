// Manager day decisions, as HR reviews them (stage 3).
//
// The queue this feeds is the OLD-DAY path: a manager decided a day far enough back that somebody
// else should look before it takes effect. So the two things this table must make obvious are what
// was decided and why — the reason is a column, not a tooltip, because it is the whole substance
// of what HR is being asked to approve.
import { useState } from 'react';
import { type AttendanceDecisionDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Badge, Button, DataTable, type Column, type Tone } from '../../../../shared/ui';
import { formatDate, localized } from '../../../../shared/lib/format';
import { cairoTime } from './minutes';
import {
  useDecideAttendanceDecision,
  useRevokeAttendanceDecision,
} from '../api/attendance-queries';

const STATUS_TONE: Record<AttendanceDecisionDto['status'], Tone> = {
  applied: 'success',
  pendingHr: 'warning',
  rejected: 'danger',
  revoked: 'neutral',
};

export const DecisionsTable = ({
  rows,
  loading,
  error,
  onRetry,
  empty,
  canApprove,
  canRevoke,
  showDecidedBy = false,
}: {
  rows: AttendanceDecisionDto[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: JSX.Element;
  canApprove: boolean;
  canRevoke: boolean;
  /** The history view names the person; the queue does not need to — it is one manager's ask. */
  showDecidedBy?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const decide = useDecideAttendanceDecision();
  const revoke = useRevokeAttendanceDecision();
  const [busy, setBusy] = useState<string | null>(null);

  const verdict = (row: AttendanceDecisionDto, choice: 'approve' | 'reject'): void => {
    setBusy(row.id);
    decide.mutate(
      { id: row.id, body: { verdict: choice, version: row.version } },
      { onSettled: () => setBusy(null) },
    );
  };

  const undo = (row: AttendanceDecisionDto): void => {
    // The reason is mandatory on the server, so it is asked for here rather than sent empty and
    // refused. A plain prompt keeps the undo one click away from the row it undoes.
    const reason = window.prompt(t('attendance.decision.revokeReason'));
    if (reason === null || reason.trim().length < 3) return;
    setBusy(row.id);
    revoke.mutate(
      { id: row.id, body: { reason: reason.trim(), version: row.version } },
      { onSettled: () => setBusy(null) },
    );
  };

  const columns: Column<AttendanceDecisionDto>[] = [
    {
      key: 'employee',
      header: t('attendance.days.employee'),
      render: (r) => (
        <span>
          {r.employeeName ?? '—'}{' '}
          <span className="font-mono text-xs text-slate-500" dir="ltr">
            {r.employeeCode ?? ''}
          </span>
        </span>
      ),
    },
    {
      key: 'workDate',
      header: t('attendance.days.date'),
      render: (r) => (
        <span dir="ltr" className="text-xs">
          {formatDate(r.workDate, locale)}
        </span>
      ),
    },
    ...(showDecidedBy
      ? [
          {
            key: 'decidedBy',
            header: t('attendance.changes.decidedBy'),
            render: (r: AttendanceDecisionDto) => (
              <span className="text-sm">
                {r.decidedByName === undefined ? '—' : localized(r.decidedByName, locale)}
                {r.hrDecidedByName !== undefined && (
                  <span className="block text-xs text-slate-500">
                    {t('attendance.changes.approvedBy', {
                      name: localized(r.hrDecidedByName, locale),
                    })}
                  </span>
                )}
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'type',
      header: t('attendance.decision.type'),
      render: (r) => <span className="text-sm">{t(`attendance.decision.type.${r.type}`)}</span>,
    },
    {
      key: 'times',
      header: t('attendance.days.span'),
      render: (r) => (
        <span dir="ltr" className="text-xs">
          {r.inAt === null ? '—' : cairoTime(r.inAt, locale)}
          {r.outAt === null ? '' : ` → ${cairoTime(r.outAt, locale)}`}
        </span>
      ),
    },
    {
      // The substance of the review, so it gets room rather than a tooltip.
      key: 'reason',
      header: t('attendance.decision.reason'),
      render: (r) => (
        <span className="block max-w-[22rem] whitespace-pre-wrap break-words text-sm">
          {r.reason}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('attendance.days.status'),
      render: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone={STATUS_TONE[r.status]}>{t(`attendance.decision.status.${r.status}`)}</Badge>
          {/* The §4 warning, on the row itself: this decision went against what a device saw. */}
          {r.overrodePunch && (
            <span
              className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
              title={t('attendance.decision.overrodePunch')}
            >
              {t('attendance.decision.overrodePunch')}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('attendance.days.actions'),
      render: (r) => (
        <span className="flex flex-wrap gap-2">
          {canApprove && r.status === 'pendingHr' && (
            <>
              <Button
                size="sm"
                loading={busy === r.id && decide.isPending}
                onClick={() => verdict(r, 'approve')}
              >
                {t('attendance.decision.approve')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={busy === r.id && decide.isPending}
                onClick={() => verdict(r, 'reject')}
              >
                {t('attendance.decision.reject')}
              </Button>
            </>
          )}
          {/* Revoking is for a decision that is already in force, or one still waiting; the
              server refuses the rest, so they are not offered. */}
          {canRevoke && (r.status === 'applied' || r.status === 'pendingHr') && r.type !== 'revoke' && (
            <Button
              size="sm"
              variant="secondary"
              loading={busy === r.id && revoke.isPending}
              onClick={() => undo(r)}
            >
              {t('attendance.decision.revoke')}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading ?? false}
        error={error}
        {...(onRetry === undefined ? {} : { onRetry })}
        {...(empty === undefined ? {} : { empty })}
      />
      {(decide.isError || revoke.isError) && (
        <p role="alert" className="text-sm text-red-600">
          {((decide.error ?? revoke.error) as Error).message}
        </p>
      )}
    </div>
  );
};
