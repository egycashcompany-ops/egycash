// «عقود توريد السيارات» — the board's Excel / PDF pill: «اكسلات هتاخد اللى الفلتر عامله بس» — every
// contract the filters match, in the table's order, as the licence expenses board writes its files.
// The PDF carries the figures over the same filtered set under its table.
import { useState } from 'react';
import {
  type FleetVehicleContractDto,
  type FleetVehicleContractTotalsDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { formatDate, localized } from '../../../shared/lib/format';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import * as api from '../api/vehicle-contract-api';
import { type VehicleContractListParams } from '../api/vehicle-contract-api';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { printFleetReport, reportMoney } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { latin, phraseText, useVehicleContractWords } from '../lib/vehicle-contract-words';
import { BoardIcon, PATH } from './FuelCardBoard';

const PILL_BUTTON =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 transition active:scale-95 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs dark:text-slate-200';

export const VehicleContractsExport = ({
  params,
  totals,
}: {
  params: VehicleContractListParams;
  totals: FleetVehicleContractTotalsDto | undefined;
}): JSX.Element => {
  const t = useT();
  const words = useVehicleContractWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const signatories = useReportSignatories();
  // One file at a time; the pressed one spins while the rows are gathered.
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const header = [
    t('fleet.vehicleContracts.columns.contract'),
    t('fleet.vehicleContracts.fact.date'),
    t('fleet.vehicleContracts.fact.deadline'),
    t('fleet.vehicleContracts.columns.supplier'),
    t('fleet.vehicleContracts.columns.makes'),
    t('fleet.vehicleContracts.figure.contracted'),
    t('fleet.vehicleContracts.figure.received'),
    t('fleet.vehicleContracts.figure.remaining'),
    t('fleet.vehicleContracts.columns.alarm'),
    t('fleet.vehicleContracts.columns.total'),
    t('fleet.vehicleContracts.columns.files'),
  ];
  const makesText = (row: FleetVehicleContractDto): string =>
    row.lines
      .map(
        (line) =>
          `${line.typeName === null ? '—' : localized(line.typeName, locale)} × ${latin(line.count)}`,
      )
      .join('، ');
  const alarmText = (row: FleetVehicleContractDto): string =>
    row.alarm === null
      ? ''
      : `${t(`fleet.dashboard.level.${row.alarm.level}`)} — ${phraseText(words.deadline(row.alarm.days))}`;
  const cells = (row: FleetVehicleContractDto) =>
    [
      words.contractName(row).text,
      formatDate(row.date, locale),
      row.deadline === null ? '' : formatDate(row.deadline, locale),
      row.supplier,
      makesText(row),
      row.contracted,
      row.received,
      row.remaining,
      alarmText(row),
      row.total,
      row.files.length,
    ] as const;
  const allRows = () =>
    fetchFilteredRows((pageNo, size) =>
      api.listVehicleContracts({ ...filtersOnly(params), page: pageNo, pageSize: size }),
    );

  const run = async (kind: 'excel' | 'pdf'): Promise<void> => {
    if (exporting !== null) return;
    setExporting(kind);
    try {
      const all = await allRows();
      if (kind === 'excel') {
        saveSheet({
          name: t('fleet.vehicleContracts.title'),
          serialHeader: t('fleet.violations.report.serial'),
          header,
          rows: all.map((row) => [...cells(row)]),
          moneyColumns: [9],
        });
        return;
      }
      try {
        printFleetReport({
          title: t('fleet.vehicleContracts.title'),
          department: t('fleet.violations.report.department'),
          subtitle: '',
          header,
          rows: all.map((row) =>
            cells(row).map((cell, index) =>
              index === 9 ? reportMoney(Number(cell)) : String(cell) || '—',
            ),
          ),
          totals:
            totals === undefined
              ? []
              : [
                  {
                    label: t('fleet.vehicleContracts.stats.value'),
                    value: reportMoney(totals.value),
                  },
                  {
                    label: t('fleet.vehicleContracts.stats.contracted'),
                    value: latin(totals.contracted),
                  },
                  {
                    label: t('fleet.vehicleContracts.stats.received'),
                    value: latin(totals.received),
                  },
                ],
          signatories,
          serialHeader: t('fleet.violations.report.serial'),
          emptyLabel: t('fleet.violations.report.empty'),
        });
      } catch {
        toast.error(t('fleet.violations.popupBlocked'));
      }
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80">
      <button
        type="button"
        data-export="vehicle-contracts"
        title={t('fleet.export.excel')}
        disabled={exporting !== null}
        onClick={() => void run('excel')}
        className={cn(
          PILL_BUTTON,
          'hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300',
        )}
      >
        {exporting === 'excel' ? (
          <Spinner className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <BoardIcon
            d={PATH.excel}
            className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
          />
        )}
        <span className="sm:hidden">Excel</span>
        <span className="hidden sm:inline">{t('fleet.fuelCards.board.excel')}</span>
      </button>
      <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
      <button
        type="button"
        data-print="vehicle-contracts"
        title={t('common.print')}
        disabled={exporting !== null}
        onClick={() => void run('pdf')}
        className={cn(
          PILL_BUTTON,
          'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400',
        )}
      >
        {exporting === 'pdf' ? (
          <Spinner className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
        ) : (
          <BoardIcon d={PATH.pdf} className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
        )}
        <span className="sm:hidden">PDF</span>
        <span className="hidden sm:inline">{t('fleet.fuelCards.board.pdf')}</span>
      </button>
    </div>
  );
};
