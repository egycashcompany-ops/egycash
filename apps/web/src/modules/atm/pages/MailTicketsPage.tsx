// /atm/mail-tickets — the legacy /mail_maintenance page (mail_maintenance.ejs) by parity:
// pending tickets only, the DUPLICATE rows painted (yellow row, recomputed at read — :770-773),
// and two decisions: accept (opens maintenance operations) or reject. Final here — the log can put
// a decided mail back (`MailLogPage.tsx`).
//
// A row is painted DUPLICATE when its machine already has an open maintenance on the mail's day,
// in any branch — a warning, as in the legacy: accept opens another maintenance for it (the owner,
// 2026-11-02 — port doc OD-1c). From 2026-10-13 to then (OD-1) accept refused such a mail.
//
// «عايز فلتر وعايز Action Buttons — في /atm/mail-tickets يكون 2 قبول ورفض» (2026-10-28):
//
//   · accept and reject are the ROW's buttons, as on the open boards, and the bar that held them is
//     gone: always painted, pinned to the row's end, and a button on a CHECKED row acts on every
//     checked row (`actionTargets`) — on an unchecked row, on that row alone;
//   · a filter row narrows by bank, area and machine code or name, over the WHOLE pending list read
//     in the browser (`lib/mail-view.ts`), its dropdowns drawn from the rows read; the address bar
//     carries it, a visit restores it, and the red reset clears it, as on the boards;
//   · (2026-11-02) that row sits on the title's line («عايز تطلع الصف بتاع الـ Form يبقي بجانب
//     العنوان»), a box under every column narrows the rows further («فلتر لكل عمود»), and F8
//     brings the head's «select all» back, as on the boards — «في رسائل الصيانة /atm/mail-tickets
//     عايزك تزود موضوع الـ Select All من خلال F8» (it was removed outright on 2026-10-28).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AtmMailTicketDto } from '@ecms/contracts';
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
import { filterRowsByColumns } from '../../../shared/lib/column-filter';
import { useColumnFilters } from '../../../shared/ui/useColumnFilters';
import {
  useAcceptAtmMailTickets,
  usePendingAtmMailTickets,
  useRejectAtmMailTickets,
} from '../api/atm-queries';
import { ConfirmActionDialog } from '../components/ReplenishmentDialogs';
import { BoardResetButton } from '../components/BoardResetButton';
import { acceptConfirmBody, actionTargets } from '../lib/operation-view';
import { withBoardFilter } from '../lib/board-filters';
import { useSelectAllReveal } from '../lib/select-all-reveal';
import {
  MAIL_ROW_PAINT,
  filterMailTickets,
  isMailFiltered,
  mailCellText,
  mailFilterOptions,
  readMailFilters,
  withMailBanks,
  withMailParam,
  withoutMailFilters,
} from '../lib/mail-view';

/** Remembered across visits: the filters — the only thing this page keeps in its address bar. */
const REMEMBERED_FILTERS = ['banks', 'areas', 'q'] as const;

export const MailTicketsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const list = usePendingAtmMailTickets();
  const pending = useMemo(() => list.data?.items ?? [], [list.data]);
  const filters = useMemo(() => readMailFilters(sp), [sp]);
  const filtered = useMemo(() => filterMailTickets(pending, filters), [pending, filters]);
  const options = useMemo(() => mailFilterOptions(pending, filters), [pending, filters]);
  // The boxes under the head narrow what the filters above kept, on what each cell shows.
  const columnFilters = useColumnFilters();
  const rows = useMemo(
    () =>
      filterRowsByColumns(
        filtered,
        columnFilters.values,
        mailCellText(t, locale, { duplicateBadge: true }),
      ),
    [filtered, columnFilters.values, t, locale],
  );

  // Selection is over the rows on screen: a mail the filters or the boxes hide is never decided
  // unseen — F8's «select all» checks exactly these.
  const selection = useTableSelection(rows.map((row) => row.id));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selectedRows = selection.ids
    .map((id) => byId.get(id))
    .filter((row): row is AtmMailTicketDto => row !== undefined);

  const accept = useAcceptAtmMailTickets();
  const reject = useRejectAtmMailTickets();
  const [accepting, setAccepting] = useState<string[] | null>(null);
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  // F8 shows the head's box until the next key or press elsewhere (`lib/select-all-reveal.ts`);
  // never while a decision is being confirmed.
  const selectAllShown = useSelectAllReveal(accepting === null && rejecting === null);

  const decide = async (kind: 'accept' | 'reject'): Promise<void> => {
    const ids = kind === 'accept' ? accepting : rejecting;
    if (ids === null || ids.length === 0) return;
    try {
      if (kind === 'accept') {
        const result = await accept.mutateAsync(ids);
        toast.success(t('atm.mail.acceptedCount', { count: result.accepted.length }));
      } else {
        const decided = await reject.mutateAsync(ids);
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
    { key: 'bank', header: t('atm.common.bank'), render: (row) => row.bankName, filterable: true },
    {
      key: 'code',
      header: t('atm.common.machineId'),
      render: (row) => row.machineCode,
      filterable: true,
    },
    {
      key: 'name',
      header: t('atm.common.machineName'),
      render: (row) => row.machineName,
      filterable: true,
    },
    {
      key: 'issue',
      header: t('atm.mail.issue'),
      filterable: true,
      render: (row) => (
        <span className="inline-flex items-center gap-1.5">
          {row.issueText}
          {row.duplication && <StatusBadge tone="warning" label={t('atm.mail.duplicate')} />}
        </span>
      ),
    },
    { key: 'area', header: t('atm.common.area'), render: (row) => row.area, filterable: true },
    {
      key: 'received',
      header: t('atm.mail.receivedAt'),
      filterable: true,
      render: (row) => formatDateTime(row.receivedAt, locale),
    },
    {
      key: 'sender',
      header: t('atm.mail.sender'),
      render: (row) => row.senderEmail,
      filterable: true,
    },
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
          بس هو اللى يعمل Scroll»): on a computer the title and the filters keep their place, and
          only the table's rows scroll, under a head that stays. */}
      <div className={BOARD_FRAME}>
        {/* The boards' filter row, on the title's line (2026-11-02): the narrowing sits at the far
            end — the LEFT in Arabic, mirrored in English, because `ms-auto` follows the writing
            direction. */}
        <PageHeader
          title={t('atm.mail.title')}
          toolbar={
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
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
                {/* One reset for everything that narrows the list: the filters and the boxes. */}
                <BoardResetButton
                  active={isMailFiltered(filters) || columnFilters.active}
                  onReset={() => {
                    setSp(withoutMailFilters(sp), { replace: true });
                    columnFilters.clear();
                  }}
                />
              </div>
            </div>
          }
        />

        <div className={BOARD_TABLE_FILL}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            empty={
              pending.length === 0
                ? t('atm.mail.empty')
                : columnFilters.active && filtered.length > 0
                  ? t('atm.common.emptyColumnFiltered')
                  : t('atm.mail.emptyFiltered')
            }
            selection={selection}
            // No head box until F8 asks for it, as on the boards — «في رسائل الصيانة
            // /atm/mail-tickets عايزك تزود موضوع الـ Select All من خلال F8» (2026-11-02; on
            // 2026-10-28 it had been removed outright). It checks the rows on screen only.
            selectAll={selectAllShown}
            columnFilters={{
              values: columnFilters.values,
              onChange: columnFilters.set,
              label: (header) => t('atm.common.filterColumn', { column: header }),
              placeholder: t('atm.common.filterPlaceholder'),
            }}
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
