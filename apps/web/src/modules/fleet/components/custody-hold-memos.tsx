// The memos a held replenishment reserved, as «تأكيد التحويل» and «إلغاء الاستعاضة المعلّقة» list
// them: each memo's name, kind and number, its period, its total and its receipts; then the total
// of them all with its kinds. The confirm's total row is the replenishment's sky (they are about to
// come back into the fund); the cancel's is slate (they go back to «لم تُستعَض بعد»).
import { type FleetCustodyOperationDto, type FleetCustodySource } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { useCustodyCount } from '../lib/custody-words';
import { MONO } from './FuelCardDialog';
import { useSeparator } from './custody-dashboard-parts';
import {
  Dates,
  FORM_TABLE,
  FORM_TABLE_WRAP,
  FORM_TBODY,
  FORM_THEAD,
  KindPill,
  MemoName,
  Money,
} from './custody-memo-parts';

const TOTAL_ROW = {
  sky: {
    row: 'bg-sky-50/70 dark:bg-sky-500/[0.06]',
    cell: '[&&]:!text-sky-800 dark:[&&]:!text-sky-300',
    ink: 'text-sky-800 dark:text-sky-300',
  },
  slate: {
    row: 'bg-slate-50 dark:bg-white/[0.03]',
    cell: 'whitespace-nowrap [&&]:!text-slate-700 dark:[&&]:!text-slate-200',
    ink: undefined,
  },
} as const;

export const HeldMemoTable = ({
  op,
  kinds,
  tone,
  mark,
}: {
  op: Pick<FleetCustodyOperationDto, 'memos' | 'amount'>;
  /** The kinds the memos hold, in the order the total row names them. */
  kinds: readonly FleetCustodySource[];
  tone: keyof typeof TOTAL_ROW;
  /** `data-memo-<mark>-list` / `-row` — what the specs and the shoot scripts find. */
  mark: 'confirm' | 'cancel';
}): JSX.Element => {
  const t = useT();
  const { count } = useCustodyCount();
  const separator = useSeparator();
  const look = TOTAL_ROW[tone];
  const memos = [...op.memos].sort((a, b) => a.no - b.no);
  return (
    <div className={FORM_TABLE_WRAP}>
      <table className={FORM_TABLE} {...{ [`data-memo-${mark}-list`]: 'true' }}>
        <thead className={FORM_THEAD}>
          <tr>
            <th>{t('fleet.custody.fundForm.replenish.memo')}</th>
            <th>{t('fleet.custody.fundForm.period')}</th>
            <th>{t('fleet.custody.fundForm.total')}</th>
          </tr>
        </thead>
        <tbody className={FORM_TBODY}>
          {memos.map((memo) => (
            <tr key={memo.memoId} {...{ [`data-memo-${mark}-row`]: String(memo.no) }}>
              <td>
                <span
                  className={cn(
                    'mx-auto flex flex-col items-center gap-1',
                    mark === 'cancel' ? 'max-w-[20rem]' : 'max-w-[17rem]',
                  )}
                >
                  <MemoName memo={memo} boxed />
                  <span className="flex items-center gap-2 whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <KindPill kind={memo.kind} />
                    <span>
                      {t('fleet.custody.fundForm.no')} <span className={MONO}>{memo.no}</span>
                    </span>
                  </span>
                </span>
              </td>
              <td>
                <Dates from={memo.from} to={memo.to} />
              </td>
              <td>
                <span className="flex flex-col items-center gap-0.5">
                  <Money value={memo.amount} unit="wide" />
                  <span className="whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {count('receipt', memo.receipts)}
                  </span>
                </span>
              </td>
            </tr>
          ))}
          <tr className={look.row}>
            <td className={look.cell}>
              {t('fleet.custody.fundForm.total')} —{' '}
              {kinds.map((kind) => t(`fleet.custody.source.${kind}`)).join(separator)}
            </td>
            <td />
            <td>
              <Money value={op.amount} unit="wide" ink={look.ink} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
