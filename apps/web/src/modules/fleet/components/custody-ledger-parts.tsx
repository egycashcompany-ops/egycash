// What «سجل العهدة» and «لوحة تحكم العهدة» say of a line of the fund's history in the same way: the
// name of its operation — the three actions' own names and the receipts' «مصروفات الإيصالات» — its
// chip in the action's colours, and the dot that marks it on the dashboard's step line.
import { type FleetCustodyLedgerOp } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { CUSTODY_OPS } from './CustodyFundActions';
import { BoardIcon } from './FuelCardBoard';
import { CAIRO } from './custody-dashboard-parts';
import { RECEIPT_ICON, SPEND_LOOK } from './custody-memo-parts';

/** A line's own words for its operation — the three actions' names, and the receipts'. */
export const ledgerOpLabel = (op: FleetCustodyLedgerOp): string =>
  op === 'spend' ? 'fleet.custody.ledger.op.spend' : CUSTODY_OPS[op].label;

/** Each operation's chip and icon — the action's own, the receipts' slate. */
export const ledgerOpLook = (op: FleetCustodyLedgerOp): { chip: string; icon: readonly string[] } =>
  op === 'spend'
    ? { chip: SPEND_LOOK.chip, icon: RECEIPT_ICON }
    : { chip: CUSTODY_OPS[op].chip, icon: CUSTODY_OPS[op].icon };

/** The dot of each operation on the step line — its chip's 500 shade. */
export const LEDGER_OP_DOT: Record<FleetCustodyLedgerOp, string> = {
  charge: '#14b8a6',
  replenish: '#0ea5e9',
  settle: '#10b981',
  spend: '#64748b',
};

const CHIP_SIZE = {
  /** The log's column. */
  md: 'gap-1.5 px-3 py-1 text-[14px] leading-5',
  /** The dashboard's readout. */
  sm: 'gap-1.5 px-2.5 py-0.5 text-[13px] leading-5',
  /** The dashboard's recent lines — a little smaller, so the note beside it has the room. */
  xs: 'gap-1 px-2 py-0.5 text-[12px] leading-5',
} as const;

export const LedgerOpChip = ({
  op,
  size = 'md',
}: {
  op: FleetCustodyLedgerOp;
  size?: keyof typeof CHIP_SIZE;
}): JSX.Element => {
  const t = useT();
  const look = ledgerOpLook(op);
  return (
    <span
      data-ledger-op={op}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border',
        CHIP_SIZE[size],
        CAIRO,
        look.chip,
      )}
    >
      <BoardIcon d={look.icon} className={size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {t(ledgerOpLabel(op))}
    </span>
  );
};
