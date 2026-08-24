// /atm/mail-tickets — the legacy /mail_maintenance page (mail_maintenance.ejs) by parity:
// pending tickets only, the DUPLICATE rows painted (yellow row = an open maintenance already
// exists for that machine today, recomputed at read — :770-773), and two decisions over the
// checked set: accept (opens maintenance operations) or reject. Both terminal.
import { useState } from 'react';
import { MAX_PAGE_SIZE, type AtmMailTicketDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { useTableSelection } from '../../../shared/ui/useTableSelection';
import { BulkActionBar } from '../../../shared/ui/BulkActionBar';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDateTime } from '../../../shared/lib/format';
import {
  useAcceptAtmMailTickets,
  usePendingAtmMailTickets,
  useRejectAtmMailTickets,
} from '../api/atm-queries';
import { ConfirmActionDialog } from '../components/ReplenishmentDialogs';

export const MailTicketsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);

  const list = usePendingAtmMailTickets({ pageSize: MAX_PAGE_SIZE });
  const rows = list.data?.items ?? [];
  const selection = useTableSelection(rows.map((row) => row.id));

  const accept = useAcceptAtmMailTickets();
  const reject = useRejectAtmMailTickets();
  const [accepting, setAccepting] = useState<string[] | null>(null);
  const [rejecting, setRejecting] = useState<string[] | null>(null);

  const decide = async (kind: 'accept' | 'reject'): Promise<void> => {
    const ids = kind === 'accept' ? accepting : rejecting;
    if (ids === null || ids.length === 0) return;
    try {
      const decided = await (kind === 'accept' ? accept.mutateAsync(ids) : reject.mutateAsync(ids));
      toast.success(
        t(kind === 'accept' ? 'atm.mail.acceptedCount' : 'atm.mail.rejectedCount', {
          count: decided.length,
        }),
      );
      selection.clear();
    } catch {
      toast.error(t('atm.common.actionFailed'));
    } finally {
      setAccepting(null);
      setRejecting(null);
    }
  };

  const columns: Column<AtmMailTicketDto>[] = [
    { key: 'bank', header: t('atm.common.bank'), render: (row) => row.bankName },
    { key: 'code', header: t('atm.common.machineId'), render: (row) => row.machineCode },
    { key: 'name', header: t('atm.common.machineName'), render: (row) => row.machineName },
    {
      key: 'issue',
      header: t('atm.mail.issue'),
      render: (row) => (
        <span className="inline-flex items-center gap-1.5">
          {row.issueText}
          {row.duplication && <StatusBadge tone="warning" label={t('atm.mail.duplicate')} />}
        </span>
      ),
    },
    { key: 'area', header: t('atm.common.area'), render: (row) => row.area },
    {
      key: 'received',
      header: t('atm.mail.receivedAt'),
      render: (row) => formatDateTime(row.receivedAt, locale),
    },
    { key: 'sender', header: t('atm.mail.sender'), render: (row) => row.senderEmail },
  ];

  return (
    <PageContainer>
      <PageHeader title={t('atm.mail.title')} description={t('atm.mail.subtitle')} />

      <BulkActionBar count={selection.count} onClear={selection.clear}>
        {can('atmMailTicket.decide') && (
          <>
            <Button variant="primary" onClick={() => setAccepting(selection.ids)}>
              {t('atm.mail.accept')}
            </Button>
            <Button variant="danger" onClick={() => setRejecting(selection.ids)}>
              {t('atm.mail.reject')}
            </Button>
          </>
        )}
      </BulkActionBar>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={t('atm.mail.empty')}
        selection={selection}
        // The duplicate row paint — the legacy's yellow background (:771), as a row class.
        rowClassName={(row) => (row.duplication ? 'bg-yellow-50 dark:bg-yellow-950/30' : '')}
      />

      <ConfirmActionDialog
        open={accepting !== null}
        title={t('atm.mail.acceptTitle')}
        body={t('atm.mail.acceptBody', { count: accepting?.length ?? 0 })}
        confirmLabel={t('atm.mail.accept')}
        busy={accept.isPending}
        onConfirm={() => void decide('accept')}
        onClose={() => setAccepting(null)}
      />
      <ConfirmActionDialog
        open={rejecting !== null}
        title={t('atm.mail.rejectTitle')}
        body={t('atm.mail.rejectBody', { count: rejecting?.length ?? 0 })}
        confirmLabel={t('atm.mail.reject')}
        danger
        busy={reject.isPending}
        onConfirm={() => void decide('reject')}
        onClose={() => setRejecting(null)}
      />
    </PageContainer>
  );
};
