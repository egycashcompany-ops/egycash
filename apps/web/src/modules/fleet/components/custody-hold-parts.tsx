// The small pieces of «استعاضة معلّقة لحين التحويل», defined once for every screen that draws a
// replenishment — «سجل العهدة», its drawer, «المذكرات», «لوحة تحكم العهدة»:
//
//   HeldChip / HeldAmount / HeldSigned   «معلّقة» in amber; the amount it WILL add, dashed — it
//                                        counts for nothing until «تأكيد التحويل».
//   HeldLine                             «استعاضة معلّقة: 81,908.00» under the fund's figures.
//   HeldMemoChip                         a memo reserved by a held replenishment: «في انتظار التحويل»
//                                        in the replenishment's sky, with its letter's day, a way to
//                                        that line of «سجل العهدة».
//   CancelledChip / CancelledAmount      «ملغاة» in slate; the amount struck through.
//   TransferDate / HoldDetailNote        a ledger line's date and its note under «التفاصيل».
//   ConfirmTransferButton                «تأكيد التحويل», the held line's own action.
//   WaitingHeldLegend                    «في انتظار التحويل X» — the dashboard's third part (N2).
//
// Nothing here imports `custody-memo-parts` (which draws `HeldMemoChip` in its `MemoStatus`).
// Every word is an i18n key; numbers are Latin, as on every board.
import { Link } from 'react-router-dom';
import {
  type FleetCustodyLedgerRowDto,
  type FleetCustodyOperationStatus,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { formatMoneyParts } from '../../../shared/lib/format';
import { CheckIcon } from '../../../shared/ui/icons';
import { NUM, ymd } from './FuelCardBoard';
import { CAIRO } from './custody-dashboard-parts';
import { actionColour } from './row-actions-look';

const HOLD = 'fleet.custody.hold';
/** The boards' figure — `custody-memo-parts`' FIGURE, written again so nothing imports it. */
const FIGURE = cn('whitespace-nowrap', NUM);
const MUTED_INK = 'text-slate-500 dark:text-slate-400';
/** Where a value stands in a sentence — the sentence is split on it, so the words stay keys. */
const TOKEN = '⁣';

const useLocale = (): Locale => useAppSelector((state): Locale => state.locale.locale);

/** `[before, after]` of a sentence around its one value. */
const around = (sentence: string): [string, string] => {
  const [before = '', after = ''] = sentence.split(TOKEN);
  return [before, after];
};

/** The clock — a replenishment waiting for its money. */
export const HOLD_CLOCK: readonly string[] = ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7v5l3 2'];
/** A circle struck through — a cancelled replenishment. */
export const CANCEL_ICON: readonly string[] = [
  'M12 21a9 9 0 100-18 9 9 0 000 18z',
  'M5.6 5.6l12.8 12.8',
];

export const ClockGlyph = ({ className }: { className: string }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" strokeLinecap="round" />
  </svg>
);
const CancelGlyph = ({ className }: { className: string }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" strokeLinecap="round" />
  </svg>
);

// ── Looks ──────────────────────────────────────────────────────────────────────────────────────

/** A held replenishment's line: amber, faint — waiting, not done. */
export const HELD_ROW = 'bg-amber-50/70 dark:bg-amber-500/[0.06]';
/** A cancelled replenishment's line: muted — kept in the log, counting for nothing. */
export const CANCELLED_ROW = 'bg-slate-100/70 dark:bg-white/[0.02]';
/** A line's tint by its status — `undefined` for a done one. */
export const holdRowTint = (status: FleetCustodyOperationStatus): string | undefined =>
  status === 'held' ? HELD_ROW : status === 'cancelled' ? CANCELLED_ROW : undefined;
/** A held line's words under its figure — amber, a size down. */
const HELD_WORDS = cn(
  'whitespace-nowrap text-[11px] leading-4 [&&]:!font-semibold',
  CAIRO,
  'text-amber-700/90 dark:text-amber-300/80',
);

// ── Chips and amounts ──────────────────────────────────────────────────────────────────────────

const HELD_CHIP =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-px text-[12px] font-bold leading-5 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:font-semibold dark:text-amber-300';
/** «معلّقة» — amber, under «استعاضة العهدة». */
export const HeldChip = ({ size = 'md' }: { size?: 'md' | 'xs' }): JSX.Element => {
  const t = useT();
  return (
    <span
      className={cn(HELD_CHIP, CAIRO, size === 'xs' && 'px-1.5 text-[11px] leading-4')}
      title={t(`${HOLD}.chipTitle`)}
      data-ledger-held="true"
    >
      <ClockGlyph className="h-3 w-3" />
      {t(`${HOLD}.chip`)}
    </span>
  );
};

/** The figure a held replenishment WILL add — amber, over a dashed rule. */
export const HeldSigned = ({ value }: { value: number }): JSX.Element => {
  const { figure, currency } = formatMoneyParts(Math.abs(value), 'EGP', useLocale());
  return (
    <span
      data-ledger-amount="held"
      className="inline-flex items-baseline gap-1 whitespace-nowrap text-amber-700 dark:text-amber-300"
    >
      <span
        dir="ltr"
        className={cn(
          FIGURE,
          'border-b-2 border-dashed border-amber-400/80 dark:border-amber-500/60',
        )}
      >
        +{figure}
      </span>
      <span className="text-sm">{currency}</span>
    </span>
  );
};

/** `HeldSigned` with «لا تُحسب حتى التحويل» under it (`note`). */
export const HeldAmount = ({
  value,
  note = true,
}: {
  value: number;
  note?: boolean;
}): JSX.Element => {
  const t = useT();
  return (
    <span className="inline-flex flex-col items-center gap-0.5" data-ledger-held-amount={value}>
      <HeldSigned value={value} />
      {note && <span className={HELD_WORDS}>{t(`${HOLD}.notCounted`)}</span>}
    </span>
  );
};

/** «لم تتغيّر بعد» under a held line's «إجمالي العهدة بعدها». */
export const HeldUnchanged = (): JSX.Element => {
  const t = useT();
  return (
    <span className={HELD_WORDS} data-ledger-held-unchanged="true">
      {t(`${HOLD}.unchanged`)}
    </span>
  );
};

const CANCELLED_CHIP =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-slate-300 bg-slate-100 px-2 py-px text-[12px] font-bold leading-5 text-slate-600 dark:border-slate-600/70 dark:bg-slate-700/30 dark:font-semibold dark:text-slate-300';
/** «ملغاة» — slate: a letter that was cancelled, kept in the log. */
export const CancelledChip = ({ size = 'md' }: { size?: 'md' | 'xs' }): JSX.Element => {
  const t = useT();
  return (
    <span
      className={cn(CANCELLED_CHIP, CAIRO, size === 'xs' && 'px-1.5 text-[11px] leading-4')}
      title={t(`${HOLD}.cancelledTitle`)}
      data-ledger-cancelled="true"
    >
      <CancelGlyph className="h-3 w-3" />
      {t(`${HOLD}.cancelledChip`)}
    </span>
  );
};

/** What a cancelled replenishment would have added — slate, struck through: it counts for nothing. */
export const CancelledAmount = ({ value }: { value: number }): JSX.Element => {
  const { figure, currency } = formatMoneyParts(Math.abs(value), 'EGP', useLocale());
  return (
    <span
      data-ledger-amount="cancelled"
      data-ledger-cancelled-amount={value}
      className="inline-flex items-baseline gap-1 whitespace-nowrap text-slate-400 line-through decoration-slate-400/80 decoration-2 dark:text-slate-500 dark:decoration-slate-500/80"
    >
      <span dir="ltr" className={FIGURE}>
        +{figure}
      </span>
      <span className="text-sm">{currency}</span>
    </span>
  );
};

/** A line's amount by its status — held amber and dashed, cancelled struck through. */
export const HoldAmountOr = ({
  status,
  value,
  note = true,
  done,
}: {
  status: FleetCustodyOperationStatus;
  value: number;
  /** A held line's «لا تُحسب حتى التحويل». */
  note?: boolean;
  /** A done line's amount as its screen draws it. */
  done: JSX.Element;
}): JSX.Element =>
  status === 'held' ? (
    <HeldAmount value={value} note={note} />
  ) : status === 'cancelled' ? (
    <CancelledAmount value={value} />
  ) : (
    done
  );

/** «معلّقة» / «ملغاة» under an operation's chip — the chip itself as its screen draws it. */
export const HoldOpChip = ({
  status,
  size = 'md',
  children,
}: {
  status: FleetCustodyOperationStatus;
  size?: 'md' | 'xs';
  children: JSX.Element;
}): JSX.Element =>
  status !== 'held' && status !== 'cancelled' ? (
    children
  ) : (
    <span
      className={cn('inline-flex flex-col gap-1', size === 'xs' ? 'items-start' : 'items-center')}
    >
      <span data-ledger-op-chip="true" className={cn(status === 'cancelled' && 'opacity-60')}>
        {children}
      </span>
      {status === 'held' ? <HeldChip size={size} /> : <CancelledChip size={size} />}
    </span>
  );

/** «استعاضة معلّقة: 81,908.00» — amber, the clock before it; nothing at zero. */
export const HeldLine = ({
  amount,
  mark,
}: {
  amount: number;
  mark: string;
}): JSX.Element | null => {
  const t = useT();
  const locale = useLocale();
  if (amount <= 0) return null;
  const { figure } = formatMoneyParts(amount, 'EGP', locale);
  const [before, after] = around(t(`${HOLD}.heldTile`, { amount: TOKEN }));
  return (
    <span
      data-ledger-held-line={mark}
      title={t(`${HOLD}.heldTileNote`)}
      className={cn(
        // On a phone's two-column tiles the figure drops under the words instead of spilling out.
        'mt-1.5 inline-flex w-fit max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 self-start rounded-md border border-amber-300 bg-amber-50 px-1.5 py-px text-[11px] font-bold leading-4 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:font-semibold dark:text-amber-300',
        CAIRO,
      )}
    >
      <ClockGlyph className="h-3 w-3 shrink-0" />
      {before}
      <span dir="ltr" className={cn(NUM, 'whitespace-nowrap')}>
        {figure}
      </span>
      {after}
    </span>
  );
};

/** «في انتظار التحويل» — the memo status chip's shape, in the replenishment's sky. */
const HELD_MEMO_CHIP = cn(
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-bold leading-5',
  CAIRO,
  'border-sky-300 bg-sky-50 text-sky-800 transition hover:brightness-95 dark:border-sky-500/40 dark:bg-sky-500/10 dark:font-semibold dark:text-sky-300',
);

/** A memo reserved by a held replenishment — a way to that line of «سجل العهدة». */
export const HeldMemoChip = ({
  replenishment,
}: {
  replenishment: { id: string; date: string };
}): JSX.Element => {
  const t = useT();
  return (
    <Link
      to={`/fleet/custody/log?open=${encodeURIComponent(replenishment.id)}`}
      title={t(`${HOLD}.memoChipTitle`, { date: ymd(replenishment.date) })}
      data-status="memo-held"
      className={HELD_MEMO_CHIP}
    >
      <ClockGlyph className="h-3.5 w-3.5" />
      {t(`${HOLD}.memoChip`)}
      <span dir="ltr" className={cn(NUM, 'font-semibold opacity-80')}>
        {ymd(replenishment.date)}
      </span>
    </Link>
  );
};

// ── «سجل العهدة» ────────────────────────────────────────────────────────────────────────────────

/** A transferred replenishment's date: the transfer's day, its letter's day muted under it. */
export const TransferDate = ({
  day,
  letterDay,
}: {
  day: string;
  letterDay: string;
}): JSX.Element => {
  const t = useT();
  const [before, after] = around(t(`${HOLD}.letterOf`, { date: TOKEN }));
  return (
    <span className="inline-flex flex-col items-center leading-[18px]" data-ledger-date="transfer">
      <span dir="ltr" className={cn(FIGURE, 'text-slate-700 dark:text-slate-200')}>
        {ymd(day)}
      </span>
      <span className={cn('whitespace-nowrap text-[11px] leading-4', MUTED_INK)}>
        {before}
        <span dir="ltr" className={FIGURE}>
          {ymd(letterDay)}
        </span>
        {after}
      </span>
    </span>
  );
};

/**
 * Under a replenishment's «التفاصيل»: held «في انتظار تحويل المبلغ منذ …»; transferred «✓ حُوِّل
 * المبلغ في …» with «مرجع …» on its own line (beside a held line's «تأكيد التحويل» one line has no
 * room for both); cancelled «استعاضة ملغاة — لا تُحسب في إجمالي العهدة». Nothing on other lines.
 */
export const HoldDetailNote = ({
  row,
}: {
  row: Pick<FleetCustodyLedgerRowDto, 'id' | 'status' | 'date' | 'transfer' | 'cancellation'>;
}): JSX.Element | null => {
  const t = useT();
  if (row.status === 'cancelled') {
    return (
      <span
        data-ledger-cancelled-note={row.id}
        className="mt-0.5 whitespace-nowrap text-[12px] leading-4 text-slate-500 [&&]:!font-bold dark:text-slate-400"
      >
        {t(`${HOLD}.cancelledTitle`)}
      </span>
    );
  }
  if (row.status === 'held') {
    const [before, after] = around(t(`${HOLD}.waitingSince`, { date: TOKEN }));
    return (
      <span
        data-ledger-held-note={row.id}
        className="mt-0.5 whitespace-nowrap text-[12px] leading-4 text-amber-700 [&&]:!font-bold dark:text-amber-300"
      >
        {before}
        <span dir="ltr" className={FIGURE}>
          {ymd(row.date)}
        </span>
        {after}
      </span>
    );
  }
  if (row.transfer === null) return null;
  const [before, after] = around(t(`${HOLD}.transferredOn`, { date: TOKEN }));
  return (
    <span
      data-ledger-transfer-note={row.id}
      className="mt-0.5 whitespace-nowrap text-[12px] leading-4 text-emerald-700 [&&]:!font-bold dark:text-emerald-400"
    >
      ✓ {before}
      <span dir="ltr" className={FIGURE}>
        {ymd(row.transfer.date)}
      </span>
      {after}
      {row.transfer.reference !== '' && (
        <span
          data-ledger-transfer-ref={row.id}
          className="block text-slate-500 [&&]:!font-medium dark:text-slate-400"
        >
          {t(`${HOLD}.reference`, { ref: row.transfer.reference })}
        </span>
      )}
    </span>
  );
};

/**
 * «تأكيد التحويل» — the held line's own action, in the actions' one box between the eye and the
 * printer: a change of status in violet, labelled (it is the line's next step). `[&&]:` outranks
 * the boards' rule that squares every button in a cell (row-actions-look.ts).
 */
const CONFIRM_BUTTON = cn(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 text-[12px] font-bold leading-none ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 [&&]:!h-6 [&&]:!w-auto',
  actionColour('status'),
  'bg-violet-500/10 ring-violet-500/30 dark:bg-violet-500/15 dark:ring-violet-400/30',
);
export const ConfirmTransferButton = ({
  id,
  onConfirm,
}: {
  id: string;
  onConfirm: (id: string) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      data-ledger-confirm={id}
      title={t(`${HOLD}.confirmTitle`)}
      onClick={() => onConfirm(id)}
      className={cn(CONFIRM_BUTTON, CAIRO)}
    >
      <CheckIcon className="h-3.5 w-3.5" />
      {t(`${HOLD}.confirm`)}
    </button>
  );
};

// ── «لوحة تحكم العهدة» ─────────────────────────────────────────────────────────────────────────

/**
 * N2's third part: «في انتظار التحويل X» — the memos of a held replenishment, spent and not back
 * yet; a way to «المذكرات» on «في انتظار التحويل».
 */
export const WaitingHeldLegend = ({
  figure,
  className,
}: {
  /** The amount as the card writes its figures. */
  figure: string;
  className: string;
}): JSX.Element => {
  const t = useT();
  return (
    <Link
      to="/fleet/custody/memos?status=held"
      data-custody-waiting-legend="held"
      title={t(`${HOLD}.heldTileNote`)}
      className={cn(
        'flex items-center gap-1.5 rounded text-slate-600 hover:text-sky-700 dark:text-slate-300 dark:hover:text-sky-300',
        className,
      )}
    >
      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-sky-500" />
      {t('fleet.custody.dashboard.waiting.held')}
      <strong className={cn('text-slate-900 dark:text-white', NUM)}>{figure}</strong>
    </Link>
  );
};
