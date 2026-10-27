// /atm/maintenance/done — the legacy /atm_maintenance_done page (atm_maintenance_done.ejs) by
// parity: the replenishment done page's shape plus the maintenance facts (service, notes,
// reference), with the same visible reopen the done icon's double-click performed.
//
// Read WHOLE — every row closed in the range, not the first hundred — so every column sorts in the
// browser and the table leaves as Excel and PDF, «بيان صيانة ماكينات الصراف الآلي عن يوم … / عن
// الفترة من … إلى …» of the days it closed on (2026-10-27).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AtmMaintenanceDto } from '@ecms/contracts';
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
import { useDoneAtmMaintenances, useReopenAtmMaintenance } from '../api/atm-queries';
import {
  cairoToday,
  doneRange,
  isAlreadyOpenRefusal,
  reopenRefusalKey,
} from '../lib/operation-view';
import { maintenanceColumns } from '../lib/operation-sheet';
import { useReaderOrder } from '../lib/useBoardView';
import { StatementExportButtons } from '../components/StatementExportButtons';
import { ConfirmActionDialog } from '../components/ReplenishmentDialogs';
import { DoneRangeBar, DoneRangeCutShort, doneRangeWhole } from '../components/DoneRangeBar';

export const MaintenanceDonePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const { from, to } = doneRange(sp.get('from'), sp.get('to'), cairoToday());
  const list = useDoneAtmMaintenances({ from, to });
  const reopen = useReopenAtmMaintenance();
  const [reopening, setReopening] = useState<AtmMaintenanceDto | null>(null);

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
    } catch (error) {
      // The owner's rule (port doc OD-1): the machine already has another open maintenance that day.
      // Say so and close the dialog — trying again cannot succeed until that one is closed.
      if (isAlreadyOpenRefusal(error)) {
        toast.error(t(reopenRefusalKey('maintenance'), { code: reopening.machineCode }));
        setReopening(null);
        return;
      }
      toast.error(t('atm.common.actionFailed'));
    }
  };

  // The table is the sheet's columns, in its order, sortable, with the reopen at the end.
  const sheetColumns = maintenanceColumns(t, locale, 'done');
  const order = useReaderOrder([sp, setSp], list.data?.items ?? [], sheetColumns);
  const columns: Column<AtmMaintenanceDto>[] = [
    ...sheetColumns.map((column) => ({
      key: column.key,
      header: column.header,
      sortable: true,
      render: (row: AtmMaintenanceDto) => column.text(row, '—'),
    })),
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (row) =>
        can('atmMaintenance.complete') ? (
          <RowActions>
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
        <PageHeader title={t('atm.done.maintTitle')} />
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
                kind="maintenance"
                name="atm-maintenance-done"
                sheetName={t('atm.done.maintTitle')}
                range={{ from, to }}
                rows={order.rows}
                columns={sheetColumns}
                filterLine=""
              />
            )
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
            empty={t('atm.done.empty')}
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
