// Shared requests table (My Leave, All Requests, Approvals) — columns adapt via `showEmployee`.
import { useNavigate } from 'react-router-dom';
import { type LeaveRequestDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { DataTable, type Column } from '../../../../shared/ui';
import { formatDate } from '../../../../shared/lib/format';
import { LeaveStatusBadge } from './LeaveStatusBadge';
import { typeLabel } from './typeLabel';

export const RequestsTable = ({
  rows,
  loading,
  error,
  onRetry,
  showEmployee = false,
  empty,
}: {
  rows: LeaveRequestDto[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  showEmployee?: boolean;
  empty?: JSX.Element;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();

  const columns: Column<LeaveRequestDto>[] = [
    ...(showEmployee
      ? [
          {
            key: 'employee',
            header: t('leave.columns.employee'),
            render: (r: LeaveRequestDto) => (
              <span>
                {r.employeeName} <span className="font-mono text-xs text-slate-500" dir="ltr">{r.employeeCode}</span>
              </span>
            ),
          },
        ]
      : []),
    { key: 'type', header: t('leave.columns.type'), render: (r) => typeLabel(t, r.typeCode) },
    {
      key: 'span',
      header: t('leave.columns.span'),
      render: (r) => (
        <span dir="ltr" className="text-xs">
          {formatDate(r.startDate, locale)} → {formatDate(r.endDate, locale)}
        </span>
      ),
    },
    { key: 'days', header: t('leave.columns.days'), render: (r) => <strong>{r.days}</strong> },
    { key: 'status', header: t('leave.columns.status'), render: (r) => <LeaveStatusBadge status={r.status} /> },
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
      onRowClick={(r) => navigate(`/leave/requests/${r.id}`)}
    />
  );
};
