// /atm/mail-tickets/log — the legacy /mail_maintenance_log page (mail_maintenance_log.ejs) by
// parity: every ticket of a received-day range, newest first, painted by outcome (white pending,
// green accepted, red rejected — :818-824) with who decided — and now WHEN (`actionAt`, the one
// field the legacy log lacked, port doc GAP G1).
//
// «عايز فلتر وعايز Action Buttons … في /atm/mail-tickets/log إسترجاع ويقدر يرجعه مفتوح لو قبل أو
// رفض غلط» (2026-10-28):
//
//   · the range is read WHOLE and filtered in the browser (`lib/mail-view.ts`) — the pending page's
//     bank, area and code-or-name row, plus the status beside the range; the address bar carries
//     the filters and a visit restores them, but never the range, which opens on today as before;
//   · a DECIDED mail carries «استرجاع»: it goes back to pending, and an accepted one's maintenance
//     leaves /atm/maintenance with it while that maintenance is still open — a closed one is
//     finished work, and the server refuses the restore (`meta.refused`), which a toast names.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AtmMailTicketDto, type AtmMailTicketStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { StatusBadge, type Tone } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Field, Select } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { PINNED_ACTIONS, RowActions } from '../../../shared/ui/RowActions';
import { UndoIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDateTime } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useAtmMailLog, useRestoreAtmMailTickets } from '../api/atm-queries';
import { cairoToday, doneRange, joinCodes } from '../lib/operation-view';
import { withBoardFilter } from '../lib/board-filters';
import {
  MAIL_ROW_PAINT,
  MAIL_STATUS_FILTERS,
  filterMailTickets,
  isMailFiltered,
  isRestorable,
  mailFilterOptions,
  readMailFilters,
  readMailStatus,
  restoreConfirmBody,
  restoreRefusalToasts,
  withMailBanks,
  withMailParam,
  withoutMailFilters,
} from '../lib/mail-view';
import { ConfirmActionDialog } from '../components/ReplenishmentDialogs';
import { BoardResetButton } from '../components/BoardResetButton';
import { DoneRangeBar, DoneRangeCutShort } from '../components/DoneRangeBar';

/**
 * Remembered across visits: the filters. Not `from`/`to` — the log opens on today, a day of mail,
 * not on whichever range was last read.
 */
const REMEMBERED_FILTERS = ['banks', 'areas', 'q', 'status'] as const;

const STATUS_TONE: Record<AtmMailTicketStatus, Tone> = {
  pending: 'neutral',
  accepted: 'success',
  rejected: 'danger',
};

const ROW_CLASS: Record<AtmMailTicketStatus, string> = {
  pending: '',
  accepted: MAIL_ROW_PAINT.accepted,
  rejected: MAIL_ROW_PAINT.rejected,
};

export const MailLogPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // The done pages' range (`doneRange`), now that the range is read whole as theirs is: a date box
  // cleared reads the other day rather than a request the API refuses, and a «إلى» before «من» reads
  // the days between rather than nothing.
  const { from, to } = doneRange(sp.get('from'), sp.get('to'), cairoToday());
  const list = useAtmMailLog({ from, to });
  const read = useMemo(() => list.data?.items ?? [], [list.data]);
  const filters = useMemo(() => readMailFilters(sp), [sp]);
  const status = readMailStatus(sp);
  const rows = useMemo(() => filterMailTickets(read, filters, status), [read, filters, status]);
  const options = useMemo(() => mailFilterOptions(read, filters), [read, filters]);

  const restore = useRestoreAtmMailTickets();
  const [restoring, setRestoring] = useState<AtmMailTicketDto | null>(null);

  const setRange = (next: { from: string; to: string }): void => {
    const nextParams = new URLSearchParams(sp);
    nextParams.set('from', next.from);
    nextParams.set('to', next.to);
    setSp(nextParams);
  };

  const confirmRestore = async (): Promise<void> => {
    if (restoring === null) return;
    try {
      const result = await restore.mutateAsync([restoring.id]);
      // Nothing restored only because it was refused: the red toast says it all.
      if (result.restored.length > 0 || result.refused.length === 0) {
        toast.success(t('atm.mail.restoredCount', { count: result.restored.length }));
      }
      for (const text of restoreRefusalToasts(t, result.refused, (codes) =>
        joinCodes(codes, locale),
      )) {
        toast.error(text);
      }
    } catch {
      toast.error(t('atm.common.actionFailed'));
    } finally {
      setRestoring(null);
    }
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
    {
      key: 'actions',
      header: '',
      align: 'end',
      // Pinned to the row's end, as on the boards: ten columns outgrow a laptop, the button stays.
      className: PINNED_ACTIONS.cell,
      headerClassName: PINNED_ACTIONS.head,
      render: (row) => (
        // Always painted, as the boards' are — and only on a decided mail: a pending one has
        // nothing to go back from.
        <RowActions always>
          {can('atmMailTicket.decide') && isRestorable(row) && (
            <Button
              size="icon"
              variant="ghost-warning"
              title={t('atm.mail.restore')}
              onClick={() => setRestoring(row)}
            >
              <UndoIcon className="h-4 w-4 rtl:-scale-x-100" />
            </Button>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <PageContainer fullHeight>
      {/* The board frame (`shared/ui/board-scroll.ts`, 2026-10-27): on a computer the title, the
          range and the filters keep their place, and only the table's rows scroll, under a head
          that stays. */}
      <div className={BOARD_FRAME}>
        <PageHeader title={t('atm.mail.logTitle')} />

        {/* One row, as on the boards: the range and the status at its start, the bank, area and
            search narrowing at the far end — the LEFT in Arabic, mirrored in English. */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <DoneRangeBar from={from} to={to} onChange={setRange} />
          <Field label={t('atm.common.status')} htmlFor="mail-log-status">
            <Select
              id="mail-log-status"
              value={status}
              onChange={(e) => setSp(withMailParam(sp, 'status', e.target.value))}
            >
              {MAIL_STATUS_FILTERS.map((option) => (
                <option key={option} value={option}>
                  {t(option === 'all' ? 'atm.mail.allStatuses' : `atm.mail.status.${option}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="ms-auto flex flex-wrap items-end gap-2">
            <MultiSelect
              label={t('atm.common.bank')}
              options={options.bankOptions}
              value={filters.banks}
              // A bank change drops the areas the new banks do not hold, as on the boards.
              onChange={(next) => setSp(withMailBanks(sp, next, list.data?.items))}
            />
            <MultiSelect
              label={t('atm.common.area')}
              options={options.areaOptions}
              value={filters.areas}
              onChange={(next) => setSp(withBoardFilter(sp, 'areas', next))}
            />
            <SearchInput
              className="w-56"
              value={filters.q}
              placeholder={t('atm.mail.search')}
              // `replace`: a pause in typing is not a step the Back button should walk through.
              onChange={(text) => setSp(withMailParam(sp, 'q', text), { replace: true })}
            />
            {/* Clears the status too — every narrowing, but never the range. */}
            <BoardResetButton
              active={isMailFiltered(filters, status)}
              onReset={() => setSp(withoutMailFilters(sp), { replace: true })}
            />
          </div>
        </div>

        {/* A range too long to read whole says so, as the done pages do. */}
        <DoneRangeCutShort meta={list.data?.meta} />

        <div className={BOARD_TABLE_FILL}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            empty={read.length === 0 ? t('atm.mail.logEmpty') : t('atm.mail.emptyFiltered')}
            // The outcome's paint, reaching the pinned button's cell too (`MAIL_ROW_PAINT`).
            rowClassName={(row) => ROW_CLASS[row.status]}
            stickyHead
          />
        </div>
      </div>

      <ConfirmActionDialog
        open={restoring !== null}
        title={t('atm.mail.restoreTitle')}
        body={restoring === null ? '' : restoreConfirmBody(t, restoring)}
        confirmLabel={t('atm.mail.restore')}
        busy={restore.isPending}
        onConfirm={() => void confirmRestore()}
        onClose={() => setRestoring(null)}
      />
    </PageContainer>
  );
};
