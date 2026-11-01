// /atm/mail-tickets — the legacy /mail_maintenance page (mail_maintenance.ejs) by parity:
// pending tickets only, the DUPLICATE rows painted (yellow row, recomputed at read — :770-773),
// and two decisions: accept (opens maintenance operations) or reject. Final here — the log can put
// a decided mail back (`MailLogPage.tsx`).
//
// The owner's rule (2026-10-13, port doc OD-1): a machine is never in maintenance twice. A row is
// painted DUPLICATE exactly when its machine already has an open maintenance — any day, any
// branch, no longer only "today" — and accept REFUSES those tickets: they stay pending, and the
// answer names them, which this page prints in red beside the accepted count.
//
// «عايز فلتر وعايز Action Buttons — في /atm/mail-tickets يكون 2 قبول ورفض» (2026-10-28):
//
//   · accept and reject are the ROW's buttons, as on the open boards, and the bar that held them is
//     gone: always painted, pinned to the row's end, and a button on a CHECKED row acts on every
//     checked row (`actionTargets`) — on an unchecked row, on that row alone;
//   · a filter row narrows by bank, area and machine code or name, over the WHOLE pending list read
//     in the browser (`lib/mail-view.ts`), its dropdowns drawn from the rows read; the address bar
//     carries it, a visit restores it, and the red reset clears it, as on the boards.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AtmMailAcceptRefusalDto, type AtmMailTicketDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { useTableSelection } from '../../../shared/ui/useTableSelection';
import { Button } from '../../../shared/ui/Button';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { PINNED_ACTIONS, RowActions } from '../../../shared/ui/RowActions';
import { StatusBadge } from '../../../shared/ui/Badge';
import { CheckIcon, CloseIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDateTime } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import {
  useAcceptAtmMailTickets,
  usePendingAtmMailTickets,
  useRejectAtmMailTickets,
} from '../api/atm-queries';
import { ConfirmActionDialog } from '../components/ReplenishmentDialogs';
import { BoardResetButton } from '../components/BoardResetButton';
import {
  acceptConfirmBody,
  actionTargets,
  joinCodes,
  refusedMachineCodes,
} from '../lib/operation-view';
import { withBoardFilter } from '../lib/board-filters';
import {
  MAIL_ROW_PAINT,
  filterMailTickets,
  isMailFiltered,
  mailFilterOptions,
  readMailFilters,
  withMailBanks,
  withMailParam,
  withoutMailFilters,
} from '../lib/mail-view';

/** Remembered across visits: the filters — the only thing this page keeps in its address bar. */
const REMEMBERED_FILTERS = ['banks', 'areas', 'q'] as const;

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
    <p className="text-sm text-red-600 dark:text-red-400" data-refusal="maintenance-open">
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
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const list = usePendingAtmMailTickets();
  const pending = useMemo(() => list.data?.items ?? [], [list.data]);
  const filters = useMemo(() => readMailFilters(sp), [sp]);
  const rows = useMemo(() => filterMailTickets(pending, filters), [pending, filters]);
  const options = useMemo(() => mailFilterOptions(pending, filters), [pending, filters]);

  // Selection is over the rows on screen: a mail the filters hide is never decided unseen.
  const selection = useTableSelection(rows.map((row) => row.id));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selectedRows = selection.ids
    .map((id) => byId.get(id))
    .filter((row): row is AtmMailTicketDto => row !== undefined);

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

  // A checked row's buttons act on every checked row (`actionTargets`), and say so.
  const coversSelection = (row: AtmMailTicketDto): boolean =>
    selectedRows.length > 1 && selection.selectedIds.has(row.id);
  const targetIds = (row: AtmMailTicketDto): string[] =>
    actionTargets(row, selectedRows).map((one) => one.id);

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
    {
      key: 'actions',
      header: '',
      align: 'end',
      // Pinned to the row's end, as on the boards: the buttons stay in view however wide the table.
      className: PINNED_ACTIONS.cell,
      headerClassName: PINNED_ACTIONS.head,
      render: (row) => (
        // Always painted: deciding a mail is this page's work, not a secondary action.
        <RowActions always>
          {can('atmMailTicket.decide') && (
            <>
              <Button
                size="icon"
                variant="ghost-brand"
                title={t(coversSelection(row) ? 'atm.mail.acceptSelected' : 'atm.mail.accept')}
                onClick={() => setAccepting(targetIds(row))}
              >
                <CheckIcon className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost-danger"
                title={t(coversSelection(row) ? 'atm.mail.rejectSelected' : 'atm.mail.reject')}
                onClick={() => setRejecting(targetIds(row))}
              >
                <CloseIcon className="h-4 w-4" />
              </Button>
            </>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <PageContainer fullHeight>
      {/* The board frame (`shared/ui/board-scroll.ts`, 2026-10-27 «تثبت الفورم والفلتر وتخلي الجدول
          بس هو اللى يعمل Scroll»): on a computer the title, the filters and the refusal line keep
          their place, and only the table's rows scroll, under a head that stays. */}
      <div className={BOARD_FRAME}>
        <PageHeader title={t('atm.mail.title')} />

        {/* The boards' filter row: the narrowing sits at the far end — the LEFT in Arabic, mirrored
            in English, because `ms-auto` follows the writing direction. */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
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
            <BoardResetButton
              active={isMailFiltered(filters)}
              onReset={() => setSp(withoutMailFilters(sp), { replace: true })}
            />
          </div>
        </div>

        <AcceptRefusalNotice refused={refused} />

        <div className={BOARD_TABLE_FILL}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            empty={pending.length === 0 ? t('atm.mail.empty') : t('atm.mail.emptyFiltered')}
            selection={selection}
            // No head box, and — unlike the boards — no F8 to bring it back. The owner
            // (2026-10-28): «عايزك هنا كمان /atm/mail-tickets تلغي الـ Select All». The row boxes
            // stay: checking rows is how one button decides several mails.
            selectAll={false}
            // The duplicate row paint — the legacy's yellow background (:771), as a row class that
            // reaches the pinned buttons' cell too (`MAIL_ROW_PAINT`).
            rowClassName={(row) => (row.duplication ? MAIL_ROW_PAINT.duplicate : '')}
            stickyHead
          />
        </div>
      </div>

      <ConfirmActionDialog
        open={accepting !== null}
        title={t('atm.mail.acceptTitle')}
        body={acceptConfirmBody(t, pending, accepting ?? [])}
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
