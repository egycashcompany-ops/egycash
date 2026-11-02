// /atm/replenishments/done — the legacy /atm_replenishment_done page (atm_replenishment_done.ejs)
// by parity: closed rows of a day range (default today), close time ascending, with the duration
// column — computed honestly now that both timestamps are real instants (port doc T1; the legacy
// added +3h to bridge its mixed-epoch storage). Reopen was the done icon's double-click
// (:462 → contad_app.js:1032); here it is a visible action with a confirm — same capability,
// same data effect (`closedAt` cleared, closer kept), an affordance change recorded in the port
// doc rather than a hidden gesture carried for its own sake.
//
// Read WHOLE — every row closed in the range, not the first hundred — so every column sorts in the
// browser and the table leaves as Excel and PDF, «بيان تغذية ماكينات الصراف الآلي عن يوم … / عن
// الفترة من … إلى …» of the days it closed on (2026-10-27).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AtmReplenishmentDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { Button } from '../../../shared/ui/Button';
import { RowActions } from '../../../shared/ui/RowActions';
import { toast } from '../../../shared/ui/toast/toast-store';
import { hasError } from '../../../shared/lib/errors';
import { useDoneAtmReplenishments, useReopenAtmReplenishment } from '../api/atm-queries';
import { cairoToday, doneRange } from '../lib/operation-view';
import {
  columnFilterEntries,
  replenishmentColumns,
  statementFilterLine,
} from '../lib/operation-sheet';
import { useColumnFiltered, useReaderOrder } from '../lib/useBoardView';
import { useColumnFilters } from '../../../shared/ui/useColumnFilters';
import { StatementExportButtons } from '../components/StatementExportButtons';
import { ConfirmActionDialog } from '../components/ReplenishmentDialogs';
import { DoneRangeBar, DoneRangeCutShort, doneRangeWhole } from '../components/DoneRangeBar';

export const ReplenishmentsDonePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const { from, to } = doneRange(sp.get('from'), sp.get('to'), cairoToday());
  const list = useDoneAtmReplenishments({ from, to });
  const reopen = useReopenAtmReplenishment();
  const [reopening, setReopening] = useState<AtmReplenishmentDto | null>(null);

  const setRange = (next: { from: string; to: string }): void => {
    const nextParams = new URLSearchParams(sp);
    nextParams.set('from', next.from);
    nextParams.set('to', next.to);
    setSp(nextParams);
  };

  const confirmReopen = async (): Promise<void> => {
    if (reopening === null) return;
    try {
      await reopen.mutateAsync({ id: reopening.id, version: reopening.version });
      toast.success(t('atm.done.reopened'));
      setReopening(null);
    } catch {
      // Never the per-day rule: a replenishment reopens beside another open one (OD-1b).
      toast.error(t('atm.common.actionFailed'));
    }
  };

  // The table is the sheet's columns, in its order, sortable, with the reopen at the end.
  const sheetColumns = replenishmentColumns(t, locale, 'done');
  // The boxes under the head (2026-11-02, «فلتر لكل عمود») narrow the range's rows before the
  // reader's order, so the table and its statement show the same rows.
  const columnFilters = useColumnFilters();
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const kept = useColumnFiltered(items, sheetColumns, columnFilters.values);
  const order = useReaderOrder([sp, setSp], kept, sheetColumns);
  const columns: Column<AtmReplenishmentDto>[] = [
    ...sheetColumns.map((column) => ({
      key: column.key,
      header: column.header,
      sortable: true,
      render: (row: AtmReplenishmentDto) => column.text(row, '—'),
      filterable: true,
    })),
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) =>
        can('atmReplenishment.complete') ? (
          <RowActions always>
            <Button
              size="icon"
              variant="ghost-warning"
              title={t('atm.done.reopen')}
              onClick={() => setReopening(row)}
            >
              ↩
            </Button>
          </RowActions>
        ) : null,
    },
  ];

  return (
    <PageContainer fullHeight>
      {/* The board frame (`shared/ui/board-scroll.ts`, 2026-10-27): on a computer the title and the
          day range keep their place, and only the table's rows scroll, under a head that stays. */}
      <div className={BOARD_FRAME}>
        {/* The range and its files on the title's line (2026-11-02, «عايز تطلع الصف بتاع الـ Form
            يبقي بجانب العنوان»). */}
        <PageHeader
          title={t('atm.done.repTitle')}
          toolbar={
            <DoneRangeBar
              from={from}
              to={to}
              onChange={setRange}
              trailing={
                // Only once the rows on screen are the answer — never «nothing» while loading or failed.
                // And only for a range read whole: a part titled as the period would misstate it.
                list.isLoading ||
                hasError(list.error) ||
                !doneRangeWhole(list.data?.meta) ? undefined : (
                  <StatementExportButtons
                    kind="replenishment"
                    name="atm-replenishments-done"
                    sheetName={t('atm.done.repTitle')}
                    range={{ from, to }}
                    rows={order.rows}
                    columns={sheetColumns}
                    // A statement narrowed by a box says so (`columnFilterEntries`).
                    filterLine={statementFilterLine(t, locale, {
                      banks: [],
                      areas: [],
                      columns: columnFilterEntries(sheetColumns, columnFilters.values),
                    })}
                  />
                )
              }
            />
          }
        />
        <DoneRangeCutShort meta={list.data?.meta} />
        <div className={BOARD_TABLE_FILL}>
          <DataTable
            columns={columns}
            rows={order.rows}
            rowKey={(row) => row.id}
            loading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            empty={
              columnFilters.active && items.length > 0
                ? t('atm.common.emptyColumnFiltered')
                : t('atm.done.empty')
            }
            columnFilters={{
              values: columnFilters.values,
              onChange: columnFilters.set,
              generation: columnFilters.generation,
              label: (header) => t('atm.common.filterColumn', { column: header }),
              placeholder: t('atm.common.filterPlaceholder'),
            }}
            sort={order.sorts}
            onSortChange={order.changeSort}
            stickyHead
          />
        </div>
      </div>
      <ConfirmActionDialog
        open={reopening !== null}
        title={t('atm.done.reopenTitle')}
        body={t('atm.done.reopenBody', { code: reopening?.machineCode ?? '' })}
        confirmLabel={t('atm.done.reopen')}
        busy={reopen.isPending}
        onConfirm={() => void confirmReopen()}
        onClose={() => setReopening(null)}
      />
    </PageContainer>
  );
};
