// «مذكرة رقم 7» under «العهدة» on the receipts table: the custody memo («المذكرات») this receipt is a
// line of — amber while that memo waits for its «استعاضة», emerald once it is replenished, as the
// memos' own status chips read. Hovering says which, and since when; whoever may open the memo is
// taken to it.
import { Link } from 'react-router-dom';
import { type FleetReceiptMemoLinkDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { memoDay } from '../lib/receipt-memo-lock';

const CHIP =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs leading-4 transition';
const PENDING =
  'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400';
const REPLENISHED =
  'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400';

export const ReceiptMemoChip = ({ memo }: { memo: FleetReceiptMemoLinkDto }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const replenished = memo.replenishedAt !== null;
  const title = replenished
    ? t('fleet.receipts.memo.replenishedTitle', {
        no: memo.no,
        date: memoDay(memo.replenishedAt ?? ''),
      })
    : t('fleet.receipts.memo.pendingTitle', { no: memo.no });
  const inside = (
    <>
      {replenished ? (
        <span aria-hidden="true">✓</span>
      ) : (
        <i aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      )}
      {t('fleet.receipts.memo.chip', { no: memo.no })}
    </>
  );
  const look = cn(CHIP, replenished ? REPLENISHED : PENDING);
  const state = replenished ? 'replenished' : 'pending';
  // The memo opens on its own page, which asks for both grants — the link is offered only then.
  return can('fleetCustody.view') && can('fleetReceipt.edit') ? (
    <Link
      to={`/fleet/custody/memos/${encodeURIComponent(memo.id)}`}
      title={title}
      data-receipt-memo={memo.no}
      data-receipt-memo-state={state}
      className={cn(look, 'hover:brightness-95')}
    >
      {inside}
    </Link>
  ) : (
    <span
      title={title}
      data-receipt-memo={memo.no}
      data-receipt-memo-state={state}
      className={look}
    >
      {inside}
    </span>
  );
};
