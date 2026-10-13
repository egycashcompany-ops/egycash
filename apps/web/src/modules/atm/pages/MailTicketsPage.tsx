// /atm/mail-tickets — the legacy /mail_maintenance page (mail_maintenance.ejs) by parity:
// pending tickets only, the DUPLICATE rows painted (yellow row, recomputed at read — :770-773),
// and two decisions over the checked set: accept (opens maintenance operations) or reject. Both
// terminal.
//
// The owner's rule (2026-10-13, port doc OD-1): a machine is never in maintenance twice. A row is
// painted DUPLICATE exactly when its machine already has an open maintenance — any day, any
// branch, no longer only "today" — and accept REFUSES those tickets: they stay pending, and the
// answer names them, which this page prints in red beside the accepted count.
import { useState } from 'react';
import {
  MAX_PAGE_SIZE,
  type AtmMailAcceptRefusalDto,
  type AtmMailTicketDto,
} from '@ecms/contracts';
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
import { acceptConfirmBody, joinCodes, refusedMachineCodes } from '../lib/operation-view';

/** The tickets accept refused (OD-1) and why — the machine already has an open maintenance. */
export const AcceptRefusalNotice = ({
  refused,
}: {
  refused: readonly AtmMailAcceptRefusalDto[];
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  if (refused.length === 0) return null;
  return (
    <p className="mb-3 text-sm text-red-600 dark:text-red-400" data-refusal="maintenance-open">
      {t('atm.mail.refusedOpenMaintenance', {
        count: refused.length,
        codes: joinCodes(refusedMachineCodes(refused), locale),
      })}
    </p>
  );
};

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
  const [refused, setRefused] = useState<AtmMailAcceptRefusalDto[]>([]);

  const decide = async (kind: 'accept' | 'reject'): Promise<void> => {
    const ids = kind === 'accept' ? accepting : rejecting;
    if (ids === null || ids.length === 0) return;
    try {
      if (kind === 'accept') {
        const result = await accept.mutateAsync(ids);
        setRefused(result.refused);
        // Nothing accepted only because every ticket was refused: the red line says it all.
        if (result.accepted.length > 0 || result.refused.length === 0) {
          toast.success(t('atm.mail.acceptedCount', { count: result.accepted.length }));
        }
        if (result.refused.length > 0) {
          toast.error(
            t('atm.mail.refusedOpenMaintenance', {
              count: result.refused.length,
              codes: joinCodes(refusedMachineCodes(result.refused), locale),
            }),
          );
        }
      } else {
        const decided = await reject.mutateAsync(ids);
        setRefused([]);
        toast.success(t('atm.mail.rejectedCount', { count: decided.length }));
      }
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
      <PageHeader title={t('atm.mail.title')} />

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

      <AcceptRefusalNotice refused={refused} />

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
        body={acceptConfirmBody(t, rows, accepting ?? [])}
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
