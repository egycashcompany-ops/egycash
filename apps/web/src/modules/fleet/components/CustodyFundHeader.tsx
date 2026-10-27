// «خلاص افصلهم»: SCREEN 1 «العهدة» is the money itself. Over each of its three tabs — «سجل العهدة»,
// «المذكرات», «لوحة تحكم العهدة» — the same head:
//   • the fund now, «إجمالي العهدة — الآن»: the fund card's wallet and figure laid out as one strip (a
//     fund below zero «−X» in red), and «استعاضة معلّقة» as a small chip beside it — muted at zero,
//     amber while a replenishment waits for its transfer (the fund summary's `held`). The card's
//     «صُرف من … X%» is not repeated here: «العهدة الآن» on «لوحة تحكم العهدة» carries it;
//   • the fund's three actions (`CustodyFundActions`: «تسوية العهدة» · «استعاضة العهدة» · «طلب عهدة»);
//   • the tabs (`CustodyTabs`).
// The fund's dialogs are mounted here once (`CustodyFundDialogs`, `?fund=`), so a button — or a card
// of the dashboard, or an old `?fund=` link — opens its dialog on every tab.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { useCustodyFundSummary } from '../api/fleet-queries';
import { CUSTODY_FUND } from './CustodyKinds';
import { CustodyFundActions } from './CustodyFundActions';
import { CustodyFundDialogs } from './CustodyFundDialogs';
import { CUSTODY_NEGATIVE_INK, custodyFundAmount } from './CustodyFigures';
import { CustodyTabs } from './CustodyTabs';
import { moneyChip } from './FleetFigures';
import { BoardIcon, NUM } from './FuelCardBoard';
import { CAIRO, CARD_SURFACE } from './custody-dashboard-parts';

/** Where the amount stands in the chip's sentence — split on it, as `CustodyAlerts` does. */
const TOKEN = '⁣';

const HELD_WAITING =
  'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:font-semibold dark:text-amber-300';
const HELD_NONE =
  'border-slate-200 bg-white/70 text-slate-500 dark:border-slate-700/70 dark:bg-slate-900/40 dark:font-semibold dark:text-slate-400';

/** «استعاضة معلّقة: 0.00 ج.م.» — muted at zero, amber while one waits for its transfer. */
export const CustodyHeldChip = ({ amount }: { amount: number }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { value, unit } = moneyChip(amount, locale);
  const [before = '', after = ''] = t('fleet.custody.hold.heldTile', { amount: TOKEN }).split(TOKEN);
  const waiting = amount > 0;
  return (
    <span
      data-custody-held={amount}
      title={t(waiting ? 'fleet.custody.hold.heldTileNote' : 'fleet.custody.hold.heldNone')}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-bold',
        CAIRO,
        waiting ? HELD_WAITING : HELD_NONE,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" strokeLinecap="round" />
      </svg>
      {before}
      <span dir="ltr" className={cn(NUM, waiting ? '' : 'text-slate-600 dark:text-slate-300')}>
        {value}
      </span>
      <span className="text-[11px] font-semibold">{unit}</span>
      {after}
    </span>
  );
};

/** The wallet on its tile and «إجمالي العهدة — الآن» over whatever stands for the figure. */
const FundNowTile = ({ children }: { children: JSX.Element }): JSX.Element => {
  const t = useT();
  return (
    <span className="flex items-center gap-3.5">
      <span className={cn('shrink-0 rounded-xl p-3', CUSTODY_FUND.tile)}>
        <BoardIcon d={CUSTODY_FUND.icon} className="h-6 w-6" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('text-[13px]', CUSTODY_FUND.label, CAIRO)}>
          {t('fleet.custody.ledger.tiles.fundNow')}
        </span>
        {children}
      </span>
    </span>
  );
};

/**
 * The fund now and the held chip, from the fund's own summary (unfiltered). A shimmer while it is
 * on its way; a muted «—» if it could not be read, rather than a shimmer that never ends.
 */
const FundNowStrip = (): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const fund = useCustodyFundSummary();
  if (fund.data === undefined) {
    return fund.isError ? (
      <div data-custody-fund-now="head" data-custody-fund-failed="true">
        <FundNowTile>
          <span className="text-[28px] font-black leading-9 text-slate-400 dark:text-slate-500">
            —
          </span>
        </FundNowTile>
      </div>
    ) : (
      <Skeleton className="h-14 w-[24rem] max-w-full rounded-xl" />
    );
  }
  const amount = custodyFundAmount(fund.data.fundTotal);
  const money = moneyChip(Math.abs(amount), locale);
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3"
      data-custody-fund-now="head"
    >
      <FundNowTile>
        <span className="flex items-baseline gap-1.5">
          <span
            data-custody-fund-value={amount}
            className={cn(
              'text-[28px] font-black leading-9 tracking-tight text-slate-900 dark:text-white',
              NUM,
            )}
          >
            {amount < 0 ? (
              // «−124,139.46» — left to right, or the minus would sit after the figure in Arabic.
              <span dir="ltr" data-custody-fund-negative="true" className={CUSTODY_NEGATIVE_INK}>
                {`−${money.value}`}
              </span>
            ) : (
              money.value
            )}
          </span>
          <span className={cn('text-sm', CUSTODY_FUND.unit)}>{money.unit}</span>
        </span>
      </FundNowTile>
      <CustodyHeldChip amount={fund.data.held.amount} />
    </div>
  );
};

/** The head of «العهدة»: the fund now and its three actions, then the three tabs. */
export const CustodyFundHeader = (): JSX.Element => (
  <div data-custody-fund-header="true" className="mb-4 flex shrink-0 flex-col gap-4">
    <section
      data-custody-fund-bar="true"
      className={cn(
        CARD_SURFACE,
        'flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border px-5 py-3.5',
        CUSTODY_FUND.card,
        CUSTODY_FUND.accent,
      )}
    >
      <FundNowStrip />
      <CustodyFundActions />
    </section>
    <CustodyTabs />
    <CustodyFundDialogs />
  </div>
);
