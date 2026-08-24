// /atm/mail-tickets/log — the legacy /mail_maintenance_log page (mail_maintenance_log.ejs) by
// parity: every ticket of a received-day range, newest first, painted by outcome (white pending,
// green accepted, red rejected — :818-824) with who decided — and now WHEN (`actionAt`, the one
// field the legacy log lacked, port doc GAP G1).
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE, type AtmMailTicketDto, type AtmMailTicketStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { StatusBadge, type Tone } from '../../../shared/ui/Badge';
import { formatDateTime } from '../../../shared/lib/format';
import { useAtmMailLog } from '../api/atm-queries';
import { cairoToday } from '../lib/operation-view';
import { DoneRangeBar } from '../components/DoneRangeBar';

const STATUS_TONE: Record<AtmMailTicketStatus, Tone> = {
  pending: 'neutral',
  accepted: 'success',
  rejected: 'danger',
};

const ROW_CLASS: Record<AtmMailTicketStatus, string> = {
  pending: '',
  accepted: 'bg-green-50 dark:bg-green-950/30',
  rejected: 'bg-red-50 dark:bg-red-950/30',
};

export const MailLogPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const from = sp.get('from') ?? cairoToday();
  const to = sp.get('to') ?? from;
  const params = useMemo(() => ({ from, to, pageSize: MAX_PAGE_SIZE }), [from, to]);
  const list = useAtmMailLog(params);

  const setRange = (next: { from: string; to: string }): void => {
    const nextParams = new URLSearchParams(sp);
    nextParams.set('from', next.from);
    nextParams.set('to', next.to);
    setSp(nextParams);
  };

  const columns: Column<AtmMailTicketDto>[] = [
    { key: 'bank', header: t('atm.common.bank'), render: (row) => row.bankName },
    { key: 'code', header: t('atm.common.machineId'), render: (row) => row.machineCode },
    { key: 'name', header: t('atm.common.machineName'), render: (row) => row.machineName },
    { key: 'issue', header: t('atm.mail.issue'), render: (row) => row.issueText },
    { key: 'area', header: t('atm.common.area'), render: (row) => row.area },
    {
      key: 'received',
      header: t('atm.mail.receivedAt'),
      render: (row) => formatDateTime(row.receivedAt, locale),
    },
    {
      key: 'status',
      header: t('atm.common.status'),
      render: (row) => (
        <StatusBadge tone={STATUS_TONE[row.status]} label={t(`atm.mail.status.${row.status}`)} />
      ),
    },
    {
      key: 'actionBy',
      header: t('atm.mail.actionBy'),
      render: (row) => row.actionByName ?? '—',
    },
    {
      key: 'actionAt',
      header: t('atm.mail.actionAt'),
      render: (row) => (row.actionAt === null ? '—' : formatDateTime(row.actionAt, locale)),
    },
    { key: 'sender', header: t('atm.mail.sender'), render: (row) => row.senderEmail },
  ];

  return (
    <PageContainer>
      <PageHeader title={t('atm.mail.logTitle')} description={t('atm.mail.logSubtitle')} />
      <DoneRangeBar from={from} to={to} onChange={setRange} />
      <DataTable
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={t('atm.mail.logEmpty')}
        rowClassName={(row) => ROW_CLASS[row.status]}
      />
    </PageContainer>
  );
};
