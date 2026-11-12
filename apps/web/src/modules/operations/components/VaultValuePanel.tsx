// «اجمالى قيمة الشحنات» — the panel legacy's vault roll-up drew beside its table: «إجمالي المصري»,
// «إجمالي العملات الأجنبية», then every currency of its list with what the vault holds of it. It is
// legacy's SECOND aggregation (contad_app.js:1524 — the same vault set, the pound taken out), here a
// view of the server's grand total (`vaultValuePanel`, lib/report-board.ts), in the report board's
// card and the boards' palette: the pound in the pound's green, the foreign sum in the others' amber.
//
// THE FULL LIST, ZEROS INCLUDED, as legacy listed it: the treasurer reads down a list he knows by
// heart, and a currency missing from it reads as "not counted" rather than "none held". The zeros
// are drawn dimmed, so what the vault does hold stands out of the list.
import { MAX_PAGE_SIZE, type OperationsReportTotalsDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { cn } from '../../../shared/lib/cn';
import { formatAmount } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { BoardIcon, NUM } from '../../fleet/components/FuelCardBoard';
import { useOperationsCurrencies } from '../api/operations-queries';
import { vaultValuePanel } from '../lib/report-board';
import { FIGURE_TONE } from './BoardFigures';
import { REPORT_CARD, ReportTitle } from './ReportBoard';
import { SHIPMENT_PATH } from './shipment-icons';

/** One of the two sums at the top of the panel. */
const Headline = ({
  tone,
  label,
  value,
  ...rest
}: {
  tone: string;
  label: string;
  value: string;
} & Record<`data-${string}`, string>): JSX.Element => (
  <div className="flex items-center gap-2.5 px-4 py-2.5" {...rest}>
    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', tone)}>
      <BoardIcon d={[...SHIPMENT_PATH.money]} className="h-4 w-4" />
    </span>
    <span className="min-w-0 flex-1 text-sm font-black text-slate-800 dark:text-slate-100">
      {label}
    </span>
    <span
      dir="ltr"
      className={cn('whitespace-nowrap text-[15px] font-black text-slate-900 dark:text-white', NUM)}
    >
      {value}
    </span>
  </div>
);

export const VaultValuePanel = ({
  grandTotal,
  loading,
}: {
  /** The server's grand total — the panel's only source (never the rows, Q27). */
  grandTotal: OperationsReportTotalsDto | undefined;
  loading: boolean;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  // The boards' own query, so the catalog is one cache across them.
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  const waiting = loading || currencies.isLoading;
  // A failed report says so in the table's place, with its retry; the panel has nothing to add.
  if (!waiting && grandTotal === undefined) return null;
  const panel =
    grandTotal === undefined
      ? null
      : vaultValuePanel(grandTotal.currencies, currencies.data?.items ?? []);

  return (
    <aside
      className={cn(REPORT_CARD, 'lg:max-h-full lg:w-80 lg:shrink-0 xl:w-[22rem]')}
      aria-label={t('operations.vaultReport.value')}
      data-vault-value="true"
    >
      <ReportTitle icon={SHIPMENT_PATH.money} title={t('operations.vaultReport.value')} />
      {waiting || panel === null ? (
        <div className="space-y-3 p-4" aria-busy="true">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-4 w-full" />
          ))}
        </div>
      ) : (
        <div className="min-h-0 overflow-y-auto">
          <div className="divide-y divide-slate-200 border-b-2 border-slate-200 bg-slate-50 dark:divide-slate-800 dark:border-slate-700 dark:bg-[#0c121e]">
            <Headline
              tone={FIGURE_TONE.pound}
              label={t('operations.vaultReport.totalPound')}
              value={formatAmount(panel.egp, locale)}
              data-vault-value-total="egp"
            />
            <Headline
              tone={FIGURE_TONE.others}
              label={t('operations.vaultReport.totalForeign')}
              value={formatAmount(panel.foreign, locale)}
              data-vault-value-total="foreign"
            />
          </div>
          <ul>
            {panel.lines.map((line) => (
              <li
                key={line.key}
                data-vault-value-line={line.key}
                data-zero={line.zero ? 'true' : undefined}
                className={cn(
                  'flex items-center justify-between gap-3 px-4 py-[7px] text-sm font-bold even:bg-slate-50/70 dark:even:bg-white/[0.025]',
                  line.zero
                    ? 'text-slate-400 dark:text-slate-500'
                    : 'text-slate-800 dark:text-slate-100',
                )}
              >
                <span className="min-w-0 truncate">{line.name}</span>
                <span dir="ltr" className={cn('whitespace-nowrap', NUM)}>
                  {formatAmount(line.amount, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
};
