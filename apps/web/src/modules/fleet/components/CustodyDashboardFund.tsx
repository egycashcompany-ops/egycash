// «العهدة الآن» on «لوحة تحكم العهدة» — the fund over its whole history, whatever the board's
// filters (its heading says so: «من بداية العهدة، ولا تتأثر بالفلاتر»), above the filtered spend:
//
//   N1  the formula as five tiles — «إجمالي الشحن» − «مصروفات الإيصالات» + «إجمالي الاستعاضة» −
//       «إجمالي التسوية» = «إجمالي العهدة» — the ledger's own tiles (`LedgerFigures`), the fund the
//       board's own card; each tile opens «سجل العهدة» over its operation.
//   N2  «مبالغ صُرفت ولم تُستعَض بعد» — what «استعاضة العهدة» would bring back: the memos waiting and
//       the receipts in no memo yet, kind by kind with the age of the oldest.
//   N3  «مصروفات تراخيص لم تُسوَّ بعد» — what «تسوية العهدة» would take out: the licensing memos waiting.
//   N4  «إجمالي العهدة بعد كل عملية» — the fund after every line of «سجل العهدة», as a step line.
//   N5  «آخر عمليات العهدة» — its newest lines, in the log's own words.
//   N7  the filtered spend split by its memos' state, a thin bar on each spend card.
//
// Plus the fund's lines in the alerts banner (a–e). Every number is one the API sends, through the
// hooks «العهدة» and «سجل العهدة» already read (all under `fleetKeys.custody`, so a «شحن», a
// «استعاضة», a «تسوية», a memo or a receipt refreshes them). Each card loads and fails on its own —
// its own shimmer, its own error with a retry — and the body never waits for it.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FLEET_CUSTODY_STALE_DAYS,
  MAX_PAGE_SIZE,
  type FleetCustodyDashboardDto,
  type FleetCustodyLedgerRowDto,
  type FleetCustodyMemoState,
  type FleetCustodyOutsideKindDto,
  type FleetCustodySettleCandidateDto,
  type FleetCustodySource,
  type FleetLicenseExpenseKind,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import {
  useCustodyFundSummary,
  useCustodyLedger,
  useReplenishCandidates,
  useSettleCandidates,
} from '../api/fleet-queries';
import { CustodyFundCard } from './CustodyFigures';
import { CUSTODY_OPS } from './CustodyFundActions';
import { useLedgerWordsKit } from './CustodyOperationDrawer';
import { LICENCE_DOT, LICENCE_PILL } from './CustodySettleDialog';
import { BoardIcon, NUM, PATH, ymd } from './FuelCardBoard';
import {
  CAIRO,
  CARD,
  COMPACT,
  custodyTicks,
  NOTE,
  SCROLLBAR,
  TITLE,
  TITLE_CHIP,
  useCount,
  useMoney,
  useMoneyText,
} from './custody-dashboard-parts';
import {
  KindPill,
  MEMO_ICON,
  memoDisplayName,
  MemoName,
  Money,
  MUTED_INK,
  Signed,
} from './custody-memo-parts';
import {
  LEDGER_FIGURES_GRID,
  LedgerFigures,
  LedgerFundSlot,
  STRIP_FIGURE,
} from './CustodyLedgerFigures';
import { LEDGER_OP_DOT, LedgerOpChip, ledgerOpLabel } from './custody-ledger-parts';
import { useCustodyCount } from '../lib/custody-words';
import { ledgerCount, ledgerWords, partsPhrase } from '../lib/custody-ledger-words';
import { codesShown } from '../lib/custody-fund-forms';
import {
  CUSTODY_MEMO_STATES,
  custodyAgeDays,
  custodyFundAlerts,
  custodyIsLate,
  custodyLedgerTarget,
  custodyNotReplenished,
  custodyPeriodLink,
  custodySettleWaiting,
  custodyWaiting,
  type CustodyFundAlert,
} from '../lib/custody-dashboard-fund';

const D = 'fleet.custody.dashboard';
const LATIN = new Intl.NumberFormat('en-US');
const LATIN2 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** The two operations the dashboard opens on the board behind it. */
export type CustodyFundOpening = 'replenish' | 'settle';

/** What the fund's cards ask of the board — each optional; without it a link does the same. */
export interface CustodyFundSectionActions {
  /** «استعاضة العهدة» / «تسوية العهدة»: the dashboard closed, the board's dialog opened (`?fund=`). */
  onFundAction?: ((op: CustodyFundOpening) => void) | undefined;
  /**
   * A receipts line of «سجل العهدة»: the board's «من» / «إلى» set to its days — the dashboard stays
   * open and its filtered part follows.
   */
  onShowPeriod?: ((from: string, to: string) => void) | undefined;
}

/** The fund's two rows: seven twelfths and five, stacked under `lg`. */
export const CUSTODY_FUND_ROW = 'grid grid-cols-1 gap-5 lg:grid-cols-12';
/** «سجل العهدة» newest first, one page at the most the API serves. */
export const CUSTODY_LEDGER_PARAMS = { page: 1, pageSize: MAX_PAGE_SIZE, sort: 'date:desc' };

// ── Shared pieces ───────────────────────────────────────────────────────────────────────────────

/**
 * A section's heading on the dashboard — «العهدة الآن» with its scope chip, «مصروفات العهدة حسب
 * الفلاتر» alone — and the rule that runs to the end of the row.
 */
export const CustodySectionHeading = ({
  name,
  id,
  title,
  chip,
}: {
  name: string;
  id?: string;
  title: string;
  chip?: string;
}): JSX.Element => (
  <div
    className="flex flex-wrap items-center gap-x-3 gap-y-2"
    data-custody-dashboard-heading={name}
  >
    <h2
      id={id}
      className={cn(
        'flex shrink-0 items-center gap-2 whitespace-nowrap text-lg font-bold text-slate-900 dark:text-white',
        CAIRO,
      )}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400"
      />
      {title}
    </h2>
    {chip !== undefined && (
      <span
        data-custody-scope="true"
        className="shrink-0 whitespace-nowrap rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:border-[#223048] dark:bg-[#0a0e17] dark:font-medium dark:text-slate-300"
      >
        {chip}
      </span>
    )}
    <span
      aria-hidden="true"
      className="hidden h-px min-w-6 flex-1 bg-slate-200 sm:block dark:bg-[#1c263b]"
    />
  </div>
);

/**
 * The fund's two rows of cards at 1,536px on the owner's scenario — «مبالغ صُرفت …» beside «مصروفات
 * تراخيص …», the step line beside «آخر عمليات العهدة»: each card shimmers at that height.
 */
const WAITING_ROW_H = 'min-h-[475px]';
const HISTORY_ROW_H = 'min-h-[542px]';

/** A card's own face while its read is on its way, or its own error with a retry. */
const CardState = ({
  name,
  error,
  onRetry,
  className,
}: {
  name: string;
  error: unknown;
  onRetry: () => void;
  className: string;
}): JSX.Element =>
  error === null || error === undefined ? (
    <div className="contents" data-custody-card-loading={name}>
      <Skeleton className={cn('rounded-2xl', className)} />
    </div>
  ) : (
    <div className={cn(CARD, 'rounded-2xl', className)} data-custody-card-error={name}>
      <ErrorState error={error} onRetry={onRetry} />
    </div>
  );

const CARD_FOOT =
  'mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-[#1c273b]';
const SUB_HEAD = cn(
  'mb-2 flex items-center justify-between gap-2 text-[13px] font-bold text-slate-700 dark:font-semibold dark:text-slate-300',
  CAIRO,
);
const LIST_FRAME =
  'divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 dark:divide-[#1a2538] dark:border-[#1e2a3f] dark:bg-[#0a101b]/70';
const ROW_HOVER = 'transition hover:bg-white dark:hover:bg-slate-800/40';
const HEAD_FIGURE = cn('text-2xl font-black tracking-tight text-slate-900 dark:text-white', CAIRO);
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60';
/** The «+ مذكرة صيانة» button — the memos page's own. */
const MAKE_MEMO =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-brand-500/50 bg-brand-500/15 px-2 py-0.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 dark:text-brand-200';
const NOW_CHIP =
  'rounded-full bg-emerald-100 px-2 py-px text-[11px] leading-4 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300';
/** «الآن» on the newest line of «آخر عمليات العهدة» — a size down from the readout's. */
const NOW_CHIP_SMALL =
  'rounded-full bg-emerald-100 px-1.5 py-px text-[10px] leading-4 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300';
export const CLOCK: readonly string[] = ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7v5l3 2'];

/** «اليوم», «منذ يومين», «منذ 5 أيام», «منذ 42 يومًا» — whole UTC days from the board's day. */
export const useCustodyAge = (
  now?: number | undefined,
): ((day: string) => { days: number; text: string }) => {
  const t = useT();
  const { form } = useCustodyCount();
  return (day) => {
    const days = custodyAgeDays(day, now);
    return {
      days,
      text:
        days === 0
          ? t(`${D}.age.today`)
          : t(`${D}.age.${form(days)}`, { count: LATIN.format(days) }),
    };
  };
};

/** How old a memo is — slate, amber with a clock past the owner's threshold. */
const AgeChip = ({ day, now }: { day: string; now?: number | undefined }): JSX.Element => {
  const age = useCustodyAge(now)(day);
  const late = custodyIsLate(age.days);
  return (
    <span
      data-custody-age={age.days}
      {...(late ? { 'data-custody-late': 'true' } : {})}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-bold leading-4',
        CAIRO,
        late
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:font-semibold dark:text-amber-300'
          : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700/60 dark:bg-[#142135] dark:font-medium dark:text-slate-300',
      )}
    >
      {late && <BoardIcon d={CLOCK} className="h-3 w-3" />}
      {age.text}
    </span>
  );
};

/** «استعاضة العهدة» / «تسوية العهدة» at a card's foot — the action's own chip. */
const FundOpButton = ({
  op,
  onFundAction,
}: {
  op: CustodyFundOpening;
  onFundAction?: ((op: CustodyFundOpening) => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const look = CUSTODY_OPS[op];
  const className = cn(
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-bold transition hover:brightness-95 active:scale-95 dark:hover:brightness-125',
    FOCUS_RING,
    look.chip,
  );
  const inner = (
    <>
      <BoardIcon d={look.icon} className="h-3.5 w-3.5" />
      {t(look.label)}
    </>
  );
  return onFundAction === undefined ? (
    <Link to={`/fleet/custody?fund=${op}`} data-custody-fund-open={op} className={className}>
      {inner}
    </Link>
  ) : (
    <button
      type="button"
      data-custody-fund-open={op}
      onClick={() => onFundAction(op)}
      className={className}
    >
      {inner}
    </button>
  );
};

const FootLink = ({ to, children }: { to: string; children: ReactNode }): JSX.Element => (
  <Link
    to={to}
    data-custody-foot-link={to}
    className={cn(
      'inline-flex items-center gap-1 whitespace-nowrap text-xs font-bold text-emerald-700 transition hover:underline dark:font-medium dark:text-emerald-400 dark:hover:text-emerald-300',
      FOCUS_RING,
    )}
  >
    {children}
    <span aria-hidden="true">←</span>
  </Link>
);

/** A card's head: its icon and title, the line under it, and its headline at the end. */
const FundCardHead = ({
  id,
  icon,
  tile,
  title,
  note,
  figure,
  under,
  mark,
}: {
  id: string;
  icon: readonly string[];
  tile: string;
  title: string;
  note: string;
  figure: number;
  under: string;
  mark: string;
}): JSX.Element => {
  const money = useMoney();
  const { figure: value, currency } = money(figure);
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 id={id} className={cn(TITLE, 'flex items-center gap-2')}>
          <span className={cn('rounded-lg p-1.5', tile)}>
            <BoardIcon d={icon} className="h-4 w-4" />
          </span>
          {title}
        </h3>
        <p className={cn(NOTE, 'mt-1')}>{note}</p>
      </div>
      <div className="text-end" data-custody-card-headline={mark}>
        <div className="flex items-baseline justify-end gap-1">
          <span dir="ltr" data-custody-headline-value={figure} className={HEAD_FIGURE}>
            {value}
          </span>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {currency}
          </span>
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">{under}</div>
      </div>
    </div>
  );
};

// ── N1 «العهدة الآن» ────────────────────────────────────────────────────────────────────────────

/** The fund's own three figures — unfiltered, on the dashboard's answer and the fund's summary alike. */
export type CustodyFundFigures = Pick<
  FleetCustodyDashboardDto,
  'fundTotal' | 'fundCharged' | 'fundSpent'
>;

/** A tile's height in «العهدة الآن» at 1,536px — its shimmer the same, so nothing moves when it lands. */
const FORMULA_TILE_H = 'min-h-[124px]';

/**
 * The heading with its scope chip, and the formula as five tiles. The fund's own card stands at
 * the end from the dashboard's answer (unfiltered: `fundTotal`, `fundCharged`, `fundSpent`) — or,
 * while the filtered answer is on its way, from the fund's summary, which holds the same three; the
 * four terms come from the summary, shimmering while it is on its way.
 */
export const CustodyFundNow = ({
  data,
}: {
  data?: CustodyFundFigures | undefined;
}): JSX.Element => {
  const t = useT();
  const headingId = useId();
  const fund = useCustodyFundSummary();
  const figures: CustodyFundFigures | undefined =
    data ??
    (fund.data === undefined
      ? undefined
      : {
          fundTotal: fund.data.fundTotal,
          fundCharged: fund.data.charged.amount,
          fundSpent: fund.data.spent.amount,
        });
  const card =
    figures === undefined ? (
      <div className="contents" data-custody-card-loading="fundNow">
        <Skeleton className={cn('h-full rounded-2xl', FORMULA_TILE_H)} />
      </div>
    ) : (
      <Link
        to="/fleet/custody/log"
        data-custody-fund-now="true"
        className={cn('block h-full rounded-2xl', FOCUS_RING)}
      >
        <CustodyFundCard
          fundTotal={figures.fundTotal}
          charged={figures.fundCharged}
          spent={figures.fundSpent}
          figure={STRIP_FIGURE}
        />
      </Link>
    );
  return (
    <section
      data-custody-dashboard-section="fund"
      aria-labelledby={headingId}
      className="space-y-4"
    >
      <CustodySectionHeading
        name="fund"
        id={headingId}
        title={t(`${D}.fund.heading`)}
        chip={t(`${D}.fund.scope`)}
      />
      {fund.data !== undefined ? (
        <LedgerFigures fund={fund.data} look="dashboard" fundCard={card} />
      ) : (
        <div className={LEDGER_FIGURES_GRID.dashboard}>
          {fund.error === null || fund.error === undefined ? (
            [0, 1, 2, 3].map((i) => (
              <CardState
                key={i}
                name="formula"
                error={null}
                onRetry={() => undefined}
                className={FORMULA_TILE_H}
              />
            ))
          ) : (
            <CardState
              name="formula"
              error={fund.error}
              onRetry={() => void fund.refetch()}
              className="col-span-2 xl:col-span-4"
            />
          )}
          <LedgerFundSlot>{card}</LedgerFundSlot>
        </div>
      )}
    </section>
  );
};

// ── N2 «مبالغ صُرفت ولم تُستعَض بعد» ───────────────────────────────────────────────────────────

/** How many memos waiting the card names before «+N». */
const SHOWN_MEMOS = 5;

const OutsideRow = ({
  line,
  now,
}: {
  line: FleetCustodyOutsideKindDto;
  now?: number | undefined;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const { count } = useCustodyCount();
  const age = useCustodyAge(now);
  const none = line.count === 0;
  const late = line.stale.count > 0;
  return (
    <div
      data-custody-outside-kind={line.kind}
      {...(late ? { 'data-custody-late': 'true' } : {})}
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-2.5',
        late
          ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/[0.06]'
          : 'border-slate-200 bg-white dark:border-[#1e2a3f] dark:bg-[#0a101b]/70',
        none && 'opacity-50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <KindPill kind={line.kind} />
          <span className="whitespace-nowrap text-[13px] font-bold text-slate-600 dark:text-slate-300">
            {none ? t(`${D}.waiting.noOutside`) : count('receipt', line.count)}
          </span>
        </span>
        <span className="shrink-0 text-[15px] font-bold">
          <Money value={line.total} ink={none ? MUTED_INK : undefined} />
        </span>
      </div>
      {!none && (
        <div className="flex items-center justify-between gap-2">
          {line.oldest === null ? (
            <span />
          ) : (
            <span
              data-custody-outside-oldest={line.kind}
              title={ymd(line.oldest)}
              className={cn(
                'flex items-center gap-1 ps-0.5 text-[11px]',
                late
                  ? 'font-bold text-amber-700 dark:font-semibold dark:text-amber-300'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {late && <BoardIcon d={CLOCK} className="h-3 w-3" />}
              {t(`${D}.waiting.oldest`, { age: age(line.oldest).text })}
            </span>
          )}
          {can('fleetReceipt.create') && (
            <Link
              to={`/fleet/custody/memos/new/${line.kind}`}
              data-custody-make-memo={line.kind}
              className={cn(MAKE_MEMO, FOCUS_RING)}
            >
              <BoardIcon d={PATH.plus} className="h-2.5 w-2.5" width={2.5} />
              {t('fleet.custody.memos.outside.make', {
                kind: t(`fleet.custody.source.${line.kind}`),
              })}
            </Link>
          )}
        </div>
      )}
    </div>
  );
};

export const CustodyWaitingCard = ({
  onFundAction,
  now,
}: {
  onFundAction?: ((op: CustodyFundOpening) => void) | undefined;
  now?: number | undefined;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const { count } = useCustodyCount();
  const money = useMoneyText();
  const titleId = useId();
  const cand = useReplenishCandidates(true);
  const fund = useCustodyFundSummary();
  if (cand.data === undefined || fund.data === undefined) {
    return (
      <CardState
        name="waiting"
        error={cand.error ?? fund.error}
        onRetry={() => {
          void cand.refetch();
          void fund.refetch();
        }}
        className={cn(WAITING_ROW_H, 'lg:col-span-7')}
      />
    );
  }
  const memos = cand.data.memos;
  const outside = cand.data.outside;
  const waiting = custodyWaiting(memos, outside, fund.data.memos.pendingTotal);
  const pctIn = waiting.total > 0 ? (waiting.inMemos / waiting.total) * 100 : 0;
  const shown = memos.slice(0, SHOWN_MEMOS);
  return (
    <section
      data-custody-dashboard-section="waiting"
      aria-labelledby={titleId}
      className={cn(CARD, 'flex min-w-0 flex-col rounded-2xl p-5 lg:col-span-7')}
    >
      <FundCardHead
        id={titleId}
        icon={CUSTODY_OPS.replenish.icon}
        tile={CUSTODY_OPS.replenish.tile}
        title={t(`${D}.waiting.title`)}
        note={t(`${D}.waiting.note`)}
        figure={waiting.total}
        under={count('receipt', waiting.receipts)}
        mark="waiting"
      />

      {/* The headline's two parts, side by side in one bar. */}
      <div className="mb-4">
        <div
          aria-hidden="true"
          className="flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#162135]"
        >
          {waiting.inMemos > 0 && (
            <span
              data-custody-waiting-part="inMemos"
              className="h-full bg-amber-500"
              style={{ width: `${pctIn}%` }}
            />
          )}
          {waiting.outside > 0 && (
            <span
              data-custody-waiting-part="outside"
              className="h-full bg-slate-400 dark:bg-slate-500"
              style={{ width: `${100 - pctIn}%` }}
            />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-xs">
          <span
            data-custody-waiting-legend="inMemos"
            className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
            {t(`${D}.waiting.inMemos`)}
            <strong className={cn('text-slate-900 dark:text-white', NUM)}>
              {money(waiting.inMemos)}
            </strong>
          </span>
          <span
            data-custody-waiting-legend="outside"
            className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-sm bg-slate-400 dark:bg-slate-500"
            />
            {t('fleet.custody.memos.outside.title')}
            <strong className={cn('text-slate-900 dark:text-white', NUM)}>
              {money(waiting.outside)}
            </strong>
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className={SUB_HEAD}>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-amber-500" />
              {t('fleet.custody.fundForm.replenish.list')}
            </span>
            {memos.length > SHOWN_MEMOS && (
              <span data-custody-more-memos="true" className={cn(TITLE_CHIP, NUM)}>
                +{LATIN.format(memos.length - SHOWN_MEMOS)}
              </span>
            )}
          </div>
          {memos.length === 0 ? (
            <div
              data-custody-no-pending="true"
              className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-xs text-slate-500 dark:border-[rgba(71,85,105,.6)] dark:text-slate-400"
            >
              <BoardIcon d={MEMO_ICON} className="h-4 w-4 shrink-0" />
              {t('fleet.custody.fundForm.replenish.empty')}
            </div>
          ) : (
            <div className={LIST_FRAME}>
              {shown.map((memo) => (
                <Link
                  key={memo.id}
                  to="/fleet/custody/memos?status=pending"
                  data-custody-pending-memo={memo.no}
                  className={cn(
                    'flex items-center justify-between gap-3 px-3 py-2.5',
                    ROW_HOVER,
                    FOCUS_RING,
                  )}
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <MemoName memo={memo} />
                    <KindPill kind={memo.kind} />
                    <span className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400">
                      <span
                        dir="ltr"
                        className={cn(NUM, 'font-bold text-slate-700 dark:text-slate-200')}
                      >
                        {ymd(memo.date)}
                      </span>
                      <span>· {count('receipt', memo.receipts)}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <AgeChip day={memo.date} now={now} />
                    <span className="text-[15px] font-bold">
                      <Money value={memo.total} />
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className={SUB_HEAD}>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-sm bg-slate-400 dark:bg-slate-500"
              />
              {t('fleet.custody.memos.outside.title')}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {outside.map((line) => (
              <OutsideRow key={line.kind} line={line} now={now} />
            ))}
          </div>
        </div>
      </div>

      <div className={cn(CARD_FOOT, 'mt-4')}>
        {can('fleetReceipt.create') ? (
          <FundOpButton op="replenish" onFundAction={onFundAction} />
        ) : (
          <span />
        )}
        <FootLink to="/fleet/custody/memos">{t(`${D}.waiting.showMemos`)}</FootLink>
      </div>
    </section>
  );
};

// ── N3 «مصروفات تراخيص لم تُسوَّ بعد» ─────────────────────────────────────────────────────────

const LicencePill = ({
  part,
  cars,
}: {
  part: FleetLicenseExpenseKind;
  cars: number;
}): JSX.Element => {
  const t = useT();
  const carsCount = useCount();
  return (
    <span
      data-custody-licence-kind={part}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-bold leading-5',
        CAIRO,
        LICENCE_PILL[part],
      )}
    >
      <i className={cn('h-1.5 w-1.5 rounded-full', LICENCE_DOT[part])} />
      {t('fleet.custody.fundForm.settle.pill', {
        kind: t(`fleet.custody.fundForm.settle.kind.${part}`),
        cars: carsCount.count('car', cars),
      })}
    </span>
  );
};

/** «150 · 151 · 153 · 156 و19 سيارة أخرى» — the settle dialog's own way of naming the cars. */
const Codes = ({ codes }: { codes: readonly string[] }): JSX.Element => {
  const t = useT();
  const { form } = useCustodyCount();
  const list = codesShown(codes);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
      <span className={cn(NUM, 'inline-flex items-center gap-1 whitespace-nowrap')}>
        {list.shown.map((code, i) => (
          <span key={`${code}:${i}`} className="inline-flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">·</span>}
            <bdi>{code}</bdi>
          </span>
        ))}
      </span>
      {list.more > 0 && (
        <span className="whitespace-nowrap rounded bg-slate-200/80 px-1.5 py-px text-slate-600 dark:bg-slate-700/60 dark:text-slate-300">
          {t(`fleet.custody.fundForm.settle.moreCars.${form(list.more)}`, { count: list.more })}
        </span>
      )}
    </span>
  );
};

const SettleRowBody = ({
  part,
  now,
}: {
  part: FleetCustodySettleCandidateDto;
  now?: number | undefined;
}): JSX.Element => {
  const t = useT();
  const money = useMoney();
  return (
    <>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <LicencePill part={part.part} cars={part.cars} />
          <span
            dir="ltr"
            className={cn(NUM, 'text-[12px] font-bold text-slate-700 dark:text-slate-200')}
          >
            {ymd(part.date)}
          </span>
        </span>
        <Codes codes={part.codes} />
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {t('fleet.custody.fundForm.settle.visa')}{' '}
          <span dir="ltr" className={NUM}>
            {money(part.visaTotal).figure}
          </span>{' '}
          • {t('fleet.custody.fundForm.settle.cash')}{' '}
          <span dir="ltr" className={NUM}>
            {money(part.cashTotal).figure}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[15px] font-bold">
          <Money value={part.total} />
        </span>
        <AgeChip day={part.date} now={now} />
      </span>
    </>
  );
};

/** One licensing memo's waiting money in «مصروفات التراخيص» — the memo's kind, still waiting. */
export const licenceWaitingLink = (part: FleetLicenseExpenseKind): string =>
  `/fleet/license-expenses?kind=${part}&status=waiting`;

export const CustodySettleCard = ({
  onFundAction,
  now,
}: {
  onFundAction?: ((op: CustodyFundOpening) => void) | undefined;
  now?: number | undefined;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const kit = useLedgerWordsKit();
  const money = useMoney();
  const titleId = useId();
  const cand = useSettleCandidates(true);
  if (cand.data === undefined) {
    return (
      <CardState
        name="settle"
        error={cand.error}
        onRetry={() => void cand.refetch()}
        className={cn(WAITING_ROW_H, 'lg:col-span-5')}
      />
    );
  }
  const parts = cand.data.parts;
  const licences = can('fleetLicenseExpense.view');
  const row = cn('flex items-center justify-between gap-3 px-3 py-3');
  return (
    <section
      data-custody-dashboard-section="settle"
      aria-labelledby={titleId}
      className={cn(CARD, 'flex min-w-0 flex-col rounded-2xl p-5 lg:col-span-5')}
    >
      <FundCardHead
        id={titleId}
        icon={CUSTODY_OPS.settle.icon}
        tile={CUSTODY_OPS.settle.tile}
        title={t(`${D}.settle.title`)}
        note={t(`${D}.settle.note`)}
        figure={custodySettleWaiting(parts)}
        under={partsPhrase(parts.length, kit)}
        mark="settle"
      />
      {parts.length === 0 ? (
        <div
          data-custody-no-settle="true"
          className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-500 dark:border-[rgba(71,85,105,.6)] dark:text-slate-400"
        >
          {t('fleet.custody.fundForm.settle.empty')}
        </div>
      ) : (
        <div className={LIST_FRAME}>
          {parts.map((part) => {
            const title = `${t('fleet.custody.fundForm.settle.visa')} ${money(part.visaTotal).figure} • ${t('fleet.custody.fundForm.settle.cash')} ${money(part.cashTotal).figure}`;
            return licences ? (
              <Link
                key={`${part.expenseId}:${part.part}`}
                to={licenceWaitingLink(part.part)}
                data-custody-settle-row={part.part}
                title={title}
                className={cn(row, ROW_HOVER, FOCUS_RING)}
              >
                <SettleRowBody part={part} now={now} />
              </Link>
            ) : (
              <div
                key={`${part.expenseId}:${part.part}`}
                data-custody-settle-row={part.part}
                title={title}
                className={row}
              >
                <SettleRowBody part={part} now={now} />
              </div>
            );
          })}
        </div>
      )}
      <div className={cn(CARD_FOOT, 'mt-4')}>
        {can('fleetReceipt.create') ? (
          <FundOpButton op="settle" onFundAction={onFundAction} />
        ) : (
          <span />
        )}
        {licences && (
          <FootLink to="/fleet/license-expenses?status=waiting">{t(`${D}.settle.show`)}</FootLink>
        )}
      </div>
    </section>
  );
};

// ── A line of «سجل العهدة» ──────────────────────────────────────────────────────────────────────

/** A line's day — a receipts line its first and last, «2026/10/06 إلى 2026/10/18». */
const LineDay = ({ row }: { row: FleetCustodyLedgerRowDto }): JSX.Element => {
  const t = useT();
  return row.op === 'spend' ? (
    <span className="whitespace-nowrap">
      <span dir="ltr" className={NUM}>
        {ymd(row.date)}
      </span>{' '}
      <span className="text-[11px] text-slate-400">{t('fleet.custody.parts.to')}</span>{' '}
      <span dir="ltr" className={NUM}>
        {ymd(row.dateTo ?? row.date)}
      </span>
    </span>
  ) : (
    <span dir="ltr" className={NUM}>
      {ymd(row.date)}
    </span>
  );
};

/** Where a line leads: an operation to its drawer; a receipts line to the board over its days. */
const LedgerLine = ({
  row,
  onShowPeriod,
  className,
  children,
}: {
  row: FleetCustodyLedgerRowDto;
  onShowPeriod?: ((from: string, to: string) => void) | undefined;
  className: string;
  children: ReactNode;
}): JSX.Element => {
  const target = custodyLedgerTarget(row);
  if (target.kind === 'operation') {
    return (
      <Link to={target.to} data-custody-recent-row={row.op} className={className}>
        {children}
      </Link>
    );
  }
  if (onShowPeriod === undefined) {
    return (
      <Link
        to={custodyPeriodLink(target.from, target.to)}
        data-custody-recent-row={row.op}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-custody-recent-row={row.op}
      onClick={() => onShowPeriod(target.from, target.to)}
      className={cn(className, 'w-full text-start')}
    >
      {children}
    </button>
  );
};

// ── N4 «إجمالي العهدة بعد كل عملية» ─────────────────────────────────────────────────────────────

const CHART_H = 250;
const PAD = { top: 26, bottom: 8, left: 48, right: 22 };
/** The plot's own width — every slot the same, the figures in HTML so they are never stretched. */
const PLOT_W = 1000;
/** Under each slot, its operation's short word. */
const SHORT: Record<FleetCustodyLedgerRowDto['op'], string> = {
  charge: CUSTODY_OPS.charge.short,
  replenish: CUSTODY_OPS.replenish.short,
  settle: CUSTODY_OPS.settle.short,
  spend: 'fleet.custody.ledger.op.spend',
};

/**
 * The value axis over a history: round steps over its highest — and, when the fund went below zero,
 * the same round steps carried down past its lowest, so «−97,794» has a figure to be read against.
 * One step over the whole span, above and below zero alike; `bottom` is the lowest tick.
 */
export const custodyStepScale = (
  rows: readonly Pick<FleetCustodyLedgerRowDto, 'before' | 'after'>[],
): { ticks: number[]; top: number; bottom: number; negative: boolean } => {
  const values = rows.flatMap((row) => [row.before, row.after]);
  const high = Math.max(0, ...values);
  const low = Math.min(0, ...values);
  if (low >= 0) {
    const ticks = custodyTicks(high);
    return { ticks, top: ticks[ticks.length - 1] ?? 0, bottom: 0, negative: false };
  }
  const step = custodyTicks(high - low)[1] ?? high - low;
  const ticks: number[] = [];
  for (let k = Math.floor(low / step); k <= Math.ceil(high / step); k += 1) {
    ticks.push(Math.round(k * step * 100) / 100);
  }
  return { ticks, top: ticks[ticks.length - 1] ?? 0, bottom: ticks[0] ?? low, negative: true };
};

/** A tick of the value axis — «−25K» below zero, with the true minus. */
const tickText = (tick: number): string =>
  tick < 0 ? `−${COMPACT.format(-tick)}` : COMPACT.format(tick);

/** Half the line's width: the plot is drawn 1:1 upright, so this many units are its pixels. */
const LINE_EDGE = 1.5;

const NOW_LABEL_H = 24;
const NOW_LABEL_GAP = 14;
/**
 * Where «الآن X» goes by the latest point — on the side away from the step's own amount, which
 * stands beside its fall (above the point) or its rise (below it): under a fall, over a rise. When
 * that side runs past the plot — the fund at the bottom of its history, below zero or nearly
 * nothing — the label stands beside the point instead, on its left, where the line is not: it came
 * in at the step's other end.
 */
export const custodyNowLabelPlace = (
  pointY: number,
  beforeY: number,
): { top: number; beside: boolean } => {
  const rise = beforeY > pointY;
  const below = pointY + NOW_LABEL_GAP;
  const above = pointY - NOW_LABEL_GAP - NOW_LABEL_H;
  if (!rise && below + NOW_LABEL_H <= CHART_H - PAD.bottom) return { top: below, beside: false };
  if (rise && above >= 0) return { top: above, beside: false };
  const top = Math.min(Math.max(0, pointY - NOW_LABEL_H / 2), CHART_H - NOW_LABEL_H);
  return { top, beside: true };
};

export const CustodyFundSteps = ({
  onShowPeriod,
}: {
  onShowPeriod?: ((from: string, to: string) => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const money = useMoneyText();
  const navigate = useNavigate();
  const titleId = useId();
  const plotId = `custody-fund-${useId().replace(/[^a-zA-Z0-9_-]/gu, '')}`;
  const gradientId = `${plotId}-area`;
  const kit = useLedgerWordsKit();
  const ledger = useCustodyLedger(CUSTODY_LEDGER_PARAMS);
  const [picked, setPicked] = useState<number | null>(null);
  // Wider than its card, the plot opens on its latest stretch — «الآن» — at the right end.
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = ledger.data?.items.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollLeft = el.scrollWidth;
  }, [lines]);
  if (ledger.data === undefined) {
    return (
      <CardState
        name="steps"
        error={ledger.error}
        onRetry={() => void ledger.refetch()}
        className={cn(HISTORY_ROW_H, 'lg:col-span-7')}
      />
    );
  }
  const rows = [...ledger.data.items].reverse();
  const capped = ledger.data.meta.totalItems > rows.length;
  const n = rows.length;
  const active = picked === null ? n - 1 : Math.min(picked, n - 1);
  const shown = rows[active];
  const { ticks, top, bottom, negative } = custodyStepScale(rows);
  const inner = PLOT_W - PAD.left - PAD.right;
  const slot = inner / Math.max(1, n);
  const x = (i: number): number => PAD.left + slot * (i + 0.5);
  const y = (v: number): number =>
    PAD.top + (1 - (v - bottom) / Math.max(1, top - bottom)) * (CHART_H - PAD.top - PAD.bottom);
  let line = `M ${PAD.left} ${y(rows[0]?.before ?? 0)}`;
  rows.forEach((row, i) => {
    line += ` H ${x(i)} V ${y(row.after)}`;
  });
  // Closed on zero: above it the area is the fund's green, below it the red of money short.
  const zero = y(0);
  const area = `${line} H ${PLOT_W - PAD.right} V ${zero} H ${PAD.left} Z`;
  if (n > 0) line += ` H ${PLOT_W - PAD.right}`;
  /** Below zero only: what is drawn above it, or under it. */
  const clip = (side: 'above' | 'below' | 'line-above' | 'line-below'): { clipPath?: string } =>
    negative ? { clipPath: `url(#${plotId}-${side})` } : {};
  const go = (row: FleetCustodyLedgerRowDto): void => {
    const target = custodyLedgerTarget(row);
    if (target.kind === 'operation') void navigate(target.to);
    else if (onShowPeriod !== undefined) onShowPeriod(target.from, target.to);
    else void navigate(custodyPeriodLink(target.from, target.to));
  };
  const operations = rows.filter((row) => row.op !== 'spend').length;
  return (
    <section
      data-custody-dashboard-section="steps"
      aria-labelledby={titleId}
      className={cn(CARD, 'flex min-w-0 flex-col rounded-2xl p-5 lg:col-span-7')}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className={cn(TITLE, 'flex items-center gap-2')}>
            <span>{t(`${D}.steps.title`)}</span>
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400"
            />
          </h3>
          <p className={NOTE}>{t(`${D}.steps.note`)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {capped && (
            <span data-custody-steps-capped="true" className={TITLE_CHIP}>
              {t(`${D}.steps.capped`, { count: LATIN.format(MAX_PAGE_SIZE) })}
            </span>
          )}
          {n > 0 && (
            <span className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-700 dark:border-[#22324e] dark:bg-[#121c2e] dark:text-slate-300">
              {ledgerCount({ operations, spendLines: n - operations }, kit)}
            </span>
          )}
        </div>
      </div>

      {n === 0 || shown === undefined ? (
        <div
          data-custody-steps-empty="true"
          className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-xs text-slate-500 dark:border-[rgba(71,85,105,.6)] dark:text-slate-400"
        >
          {t(`${D}.steps.empty`)}
        </div>
      ) : (
        <>
          <div
            aria-live="polite"
            data-custody-step-readout={shown.id}
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 shadow-inner dark:border-emerald-500/30 dark:bg-[#0c1322]/90 dark:text-slate-300"
          >
            <div className="flex flex-wrap items-center gap-2">
              <LedgerOpChip op={shown.op} size="sm" />
              <span className="font-bold text-slate-700 dark:text-slate-200">
                <LineDay row={shown} />
              </span>
              <span className="text-[13px] font-bold">
                <Signed value={shown.amount} />
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span>{t(`${D}.steps.after`)}</span>
              <strong
                data-custody-step-after={shown.after}
                className={cn(
                  'whitespace-nowrap text-sm',
                  NUM,
                  shown.after < 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-900 dark:text-white',
                )}
              >
                <MoneyInline value={shown.after} />
              </strong>
              {shown.latest && <span className={NOW_CHIP}>{t('fleet.custody.ledger.now')}</span>}
            </div>
          </div>

          <div
            ref={scrollRef}
            data-custody-steps-scroll="true"
            className={cn('overflow-x-auto', SCROLLBAR)}
            dir="ltr"
          >
            <div style={{ minWidth: `${n * 96 + 70}px` }}>
              <div className="relative" style={{ height: CHART_H }}>
                <svg
                  viewBox={`0 0 ${PLOT_W} ${CHART_H}`}
                  preserveAspectRatio="none"
                  className="absolute inset-0 h-full w-full overflow-visible"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                    </linearGradient>
                    {negative && (
                      <>
                        <clipPath id={`${plotId}-above`}>
                          <rect
                            data-custody-steps-clip="above"
                            x={0}
                            y={0}
                            width={PLOT_W}
                            height={zero}
                          />
                        </clipPath>
                        <clipPath id={`${plotId}-below`}>
                          <rect
                            data-custody-steps-clip="below"
                            x={0}
                            y={zero}
                            width={PLOT_W}
                            height={CHART_H - zero}
                          />
                        </clipPath>
                        {/* The line's own: a stretch AT zero is not short of anything — green. */}
                        <clipPath id={`${plotId}-line-above`}>
                          <rect x={0} y={0} width={PLOT_W} height={zero + LINE_EDGE} />
                        </clipPath>
                        <clipPath id={`${plotId}-line-below`}>
                          <rect
                            x={0}
                            y={zero + LINE_EDGE}
                            width={PLOT_W}
                            height={CHART_H - zero - LINE_EDGE}
                          />
                        </clipPath>
                      </>
                    )}
                  </defs>
                  {ticks.map((tick) => (
                    <line
                      key={tick}
                      {...(tick === 0 ? { 'data-custody-steps-zero': zero } : {})}
                      x1={PAD.left}
                      x2={PLOT_W - PAD.right}
                      y1={y(tick)}
                      y2={y(tick)}
                      className={
                        tick === 0
                          ? 'stroke-slate-300 dark:stroke-slate-700'
                          : 'stroke-slate-100 dark:stroke-slate-800/60'
                      }
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {/* The picked slot under the band, the area and the line — each reads over it. */}
                  <rect
                    data-custody-step-highlight={active}
                    x={PAD.left + slot * active}
                    y={PAD.top - 18}
                    width={slot}
                    height={CHART_H - PAD.top + 18 - PAD.bottom}
                    rx={6}
                    className="fill-emerald-50 stroke-emerald-300 dark:fill-emerald-950/30 dark:stroke-emerald-500/40"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  {negative && (
                    <rect
                      data-custody-steps-negative="true"
                      x={PAD.left}
                      y={zero}
                      width={inner}
                      height={y(bottom) - zero}
                      className="fill-red-500/10"
                    />
                  )}
                  <path
                    data-custody-steps-area="above"
                    d={area}
                    fill={`url(#${gradientId})`}
                    {...clip('above')}
                  />
                  {negative && (
                    <path
                      data-custody-steps-area="below"
                      d={area}
                      {...clip('below')}
                      className="fill-red-500/15"
                    />
                  )}
                  <path
                    d={line}
                    fill="none"
                    {...clip('line-above')}
                    className="stroke-emerald-600 dark:stroke-emerald-400"
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {negative && (
                    <path
                      data-custody-steps-line="below"
                      d={line}
                      fill="none"
                      {...clip('line-below')}
                      className="stroke-red-600 dark:stroke-red-400"
                      strokeWidth={2.5}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
                {/* The value axis, in HTML so its figures are not stretched with the plot. */}
                {ticks.map((tick) => (
                  <span
                    key={tick}
                    className={cn(
                      'absolute left-1 -translate-y-1/2 text-[10px] text-slate-400 dark:text-slate-500',
                      NUM,
                    )}
                    style={{ top: y(tick) }}
                  >
                    {tickText(tick)}
                  </span>
                ))}
                {rows.map((row, i) => {
                  const up = row.amount >= 0;
                  const left = `${(x(i) / PLOT_W) * 100}%`;
                  const mid = (y(row.before) + y(row.after)) / 2;
                  const nowAt = custodyNowLabelPlace(y(row.after), y(row.before));
                  return (
                    <div key={row.id}>
                      {/* The step's own amount, beside its rise or its fall. */}
                      <span
                        className={cn(
                          'absolute whitespace-nowrap rounded bg-white/80 px-1 text-[10px] font-bold leading-4 dark:bg-[#0d1424]/80',
                          NUM,
                          up
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400',
                        )}
                        style={{
                          left: `calc(${left} + 6px)`,
                          top: mid,
                          transform: 'translateY(-50%)',
                        }}
                      >
                        {up ? '+' : '−'}
                        {LATIN2.format(Math.abs(row.amount))}
                      </span>
                      <button
                        type="button"
                        data-custody-step={row.id}
                        data-custody-step-op={row.op}
                        aria-label={`${t(ledgerOpLabel(row.op))} ${ymd(row.date)} — ${t(`${D}.steps.after`)} ${row.after < 0 ? '−' : ''}${money(Math.abs(row.after))}`}
                        onMouseEnter={() => setPicked(i)}
                        onFocus={() => setPicked(i)}
                        onClick={() => go(row)}
                        className={cn(
                          'absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow transition hover:scale-125 dark:border-[#0d1424]',
                          FOCUS_RING,
                          i === active && 'scale-125 ring-2 ring-emerald-400/60',
                        )}
                        style={{ left, top: y(row.after), backgroundColor: LEDGER_OP_DOT[row.op] }}
                      />
                      {row.latest && (
                        <span
                          data-custody-now-label={nowAt.beside ? 'beside' : 'true'}
                          dir="rtl"
                          className={cn(
                            'absolute whitespace-nowrap rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 shadow-sm dark:border-emerald-500/40 dark:bg-emerald-950/80 dark:text-emerald-300',
                            nowAt.beside ? '-translate-x-full' : '-translate-x-1/2',
                            NUM,
                            row.after < 0 && 'text-red-600 dark:text-red-400',
                          )}
                          style={{
                            left: nowAt.beside ? `calc(${left} - 12px)` : left,
                            top: nowAt.top,
                          }}
                        >
                          {t('fleet.custody.ledger.now')}{' '}
                          <span dir="ltr">
                            {row.after < 0 ? '−' : ''}
                            {LATIN2.format(Math.abs(row.after))}
                          </span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Under each slot: what it was, and when. */}
              <div
                className="mt-2 flex"
                style={{
                  paddingLeft: `${(PAD.left / PLOT_W) * 100}%`,
                  paddingRight: `${(PAD.right / PLOT_W) * 100}%`,
                }}
              >
                {rows.map((row, i) => (
                  <button
                    key={row.id}
                    type="button"
                    tabIndex={-1}
                    data-custody-step-label={row.id}
                    onMouseEnter={() => setPicked(i)}
                    onClick={() => go(row)}
                    className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 text-center"
                  >
                    <span
                      dir="rtl"
                      className={cn(
                        'whitespace-nowrap text-[11px] font-bold',
                        CAIRO,
                        i === active
                          ? 'text-emerald-800 dark:text-emerald-300'
                          : 'text-slate-600 dark:text-slate-300',
                      )}
                    >
                      {t(SHORT[row.op])}
                    </span>
                    <span
                      className={cn(
                        'whitespace-nowrap text-[10px] text-slate-500 dark:text-slate-400',
                        NUM,
                      )}
                    >
                      {ymd(row.date)}
                    </span>
                    {row.op === 'spend' && (
                      <span
                        dir="rtl"
                        className="whitespace-nowrap text-[10px] text-slate-400 dark:text-slate-500"
                      >
                        {t('fleet.custody.parts.to')}{' '}
                        <span dir="ltr" className={NUM}>
                          {ymd(row.dateTo ?? row.date)}
                        </span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-4 border-t border-slate-100 pt-3 text-xs font-medium text-slate-600 dark:border-slate-800/80 dark:font-normal dark:text-slate-300">
            {(['charge', 'spend', 'replenish', 'settle'] as const).map((op) => (
              <span key={op} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: LEDGER_OP_DOT[op] }}
                />
                {t(ledgerOpLabel(op))}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
};

// ── N5 «آخر عمليات العهدة» ─────────────────────────────────────────────────────────────────────

/** How many of the newest lines the card lists. */
const RECENT = 6;
/**
 * The frame runs down to the card's foot beside the step chart; its lines keep their own height,
 * one under the other from the top — six fill it, one or two never stretch to it.
 */
const RECENT_LIST = 'flex flex-1 flex-col justify-start';

export const CustodyRecentOps = ({
  onShowPeriod,
}: {
  onShowPeriod?: ((from: string, to: string) => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const kit = useLedgerWordsKit();
  const titleId = useId();
  const ledger = useCustodyLedger(CUSTODY_LEDGER_PARAMS);
  if (ledger.data === undefined) {
    return (
      <CardState
        name="recent"
        error={ledger.error}
        onRetry={() => void ledger.refetch()}
        className={cn(HISTORY_ROW_H, 'lg:col-span-5')}
      />
    );
  }
  const rows = ledger.data.items.slice(0, RECENT);
  return (
    <section
      data-custody-dashboard-section="recent"
      aria-labelledby={titleId}
      className={cn(CARD, 'flex min-w-0 flex-col rounded-2xl p-5 lg:col-span-5')}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 id={titleId} className={cn(TITLE, 'flex items-center gap-2')}>
          {t(`${D}.recent.title`)}
        </h3>
      </div>
      {rows.length === 0 ? (
        <div
          data-custody-recent-empty="true"
          className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-xs text-slate-500 dark:border-[rgba(71,85,105,.6)] dark:text-slate-400"
        >
          {t(`${D}.steps.empty`)}
        </div>
      ) : (
        <div data-custody-recent-list="true" className={cn(LIST_FRAME, RECENT_LIST)}>
          {rows.map((row) => {
            const words = ledgerWords(row, kit);
            return (
              <LedgerLine
                key={row.id}
                row={row}
                onShowPeriod={onShowPeriod}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5',
                  ROW_HOVER,
                  FOCUS_RING,
                  row.op === 'spend' && 'bg-slate-100/70 dark:bg-white/[0.025]',
                )}
              >
                <span className="w-[8.25rem] shrink-0">
                  <LedgerOpChip op={row.op} size="xs" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    title={words.title}
                    className={cn(
                      'truncate text-[13px] font-bold',
                      row.op === 'spend'
                        ? 'text-slate-600 dark:text-slate-300'
                        : 'text-slate-900 dark:text-white',
                      CAIRO,
                    )}
                  >
                    {words.title}
                  </span>
                  <span className="text-[11px] leading-[1.15rem] text-slate-500 dark:text-slate-400">
                    <span className="font-bold text-slate-600 dark:text-slate-300">
                      <LineDay row={row} />
                    </span>
                    {words.note === '' ? '' : ` · ${words.note}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-[13px] font-bold">
                    <Signed value={row.amount} />
                  </span>
                  <span
                    data-custody-recent-after={row.after}
                    className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"
                  >
                    {t(`${D}.steps.after`)}
                    <span
                      dir="ltr"
                      className={cn(
                        NUM,
                        'font-bold',
                        row.after < 0
                          ? 'text-red-600 dark:text-red-400'
                          : row.latest
                            ? 'text-emerald-800 dark:text-emerald-300'
                            : 'text-slate-700 dark:text-slate-200',
                      )}
                    >
                      {row.after < 0 ? '−' : ''}
                      {LATIN2.format(Math.abs(row.after))}
                    </span>
                    {row.latest && (
                      <span data-custody-recent-now="true" className={NOW_CHIP_SMALL}>
                        {t('fleet.custody.ledger.now')}
                      </span>
                    )}
                  </span>
                </span>
              </LedgerLine>
            );
          })}
        </div>
      )}
      <div className={cn(CARD_FOOT, 'mt-4 justify-end')}>
        <FootLink to="/fleet/custody/log">{t(`${D}.recent.showLog`)}</FootLink>
      </div>
    </section>
  );
};

// ── The fund's lines in the alerts banner ───────────────────────────────────────────────────────

/**
 * The fund's lines (a–e) the banner adds — read from the same hooks as the cards, so a read on its
 * way raises nothing and a failed one says nothing here (its card says it).
 */
export const useCustodyFundAlerts = (
  fundTotal: number | undefined,
  now?: number | undefined,
): CustodyFundAlert[] => {
  const replenish = useReplenishCandidates(true);
  const settle = useSettleCandidates(true);
  // The dashboard's answer on its way: the fund's own reads hold the same unfiltered total.
  const fund = fundTotal ?? replenish.data?.fundTotal;
  const lines = custodyFundAlerts({
    fundTotal: fund ?? 0,
    outside: replenish.data?.outside,
    memos: replenish.data?.memos,
    parts: settle.data?.parts,
    ...(now === undefined ? {} : { now }),
  });
  // With no total at all yet, nothing is said about it: below zero, or past what it holds.
  return fund === undefined
    ? lines.filter((line) => line.type !== 'negative' && line.type !== 'settleOver')
    : lines;
};

/**
 * «−1,000.00 ج.م.» inside a line of Arabic: the signed figure left to right — so the minus stays
 * before it — and «ج.م.» after it, as the line reads.
 */
const MoneyInline = ({ value }: { value: number }): JSX.Element => {
  const { figure, currency } = useMoney()(Math.abs(value));
  return (
    <>
      <span dir="ltr">
        {value < 0 ? '−' : ''}
        {figure}
      </span>{' '}
      {currency}
    </>
  );
};

/** A sentence with some of its values set apart in bold figures (`strong`), the rest as words. */
const Sentence = ({
  text,
  params,
  strong,
  ink = {},
  nodes = {},
  wrap = [],
}: {
  text: (params: Record<string, string>) => string;
  params: Record<string, string>;
  strong: readonly string[];
  ink?: Record<string, string>;
  /** Values set apart that may still fold onto the next line — a name he typed, of any length. */
  wrap?: readonly string[];
  /** How a value set apart is drawn, when not as its words — money with its «ج.م.». */
  nodes?: Record<string, ReactNode>;
}): JSX.Element => {
  const marked = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      strong.includes(key) ? `\uE000${key}\uE001` : value,
    ]),
  );
  const parts = text(marked).split(/(\uE000\w+\uE001)/u);
  return (
    <>
      {parts.map((part, i) => {
        const name = /^\uE000(\w+)\uE001$/u.exec(part)?.[1];
        if (name === undefined) return <span key={i}>{part}</span>;
        const value = params[name] ?? '';
        const node = nodes[name];
        // A figure or a day left to right; words (and money with its «ج.م.») in the line's own way.
        const ltr = node === undefined && /^[\d\s,./\u2212+-]+$/u.test(value);
        return (
          <strong
            key={i}
            {...(ltr ? { dir: 'ltr' } : {})}
            data-custody-alert-value={name}
            className={cn(
              !wrap.includes(name) && 'whitespace-nowrap',
              'font-bold',
              NUM,
              ink[name] ?? 'text-slate-900 dark:text-white',
            )}
          >
            {node ?? value}
          </strong>
        );
      })}
    </>
  );
};

const AMBER = 'text-amber-600 dark:text-amber-400';
const RED = 'text-red-600 dark:text-red-400';
const ALERT_LINK = cn(MAKE_MEMO, FOCUS_RING);

/** One of the fund's lines: its icon, its sentence and the way to deal with it. */
const FundAlertLine = ({
  line,
  onFundAction,
}: {
  line: CustodyFundAlert;
  onFundAction?: ((op: CustodyFundOpening) => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const { form } = useCustodyCount();
  const money = useMoneyText();
  const age = (days: number): string => t(`${D}.age.${form(days)}`, { count: LATIN.format(days) });
  const minus = (value: number): string => `−${money(Math.abs(value))}`;
  let icon: readonly string[] = CLOCK;
  let tone = AMBER;
  let body: ReactNode;
  let action: ReactNode = null;
  switch (line.type) {
    case 'negative':
      icon = PATH.warn;
      tone = RED;
      body = (
        <Sentence
          text={(p) => t(`${D}.alerts.negative`, p)}
          params={{ amount: minus(line.amount) }}
          strong={['amount']}
          ink={{ amount: RED }}
          nodes={{ amount: <MoneyInline value={line.amount} /> }}
        />
      );
      action = (
        <Link to="/fleet/custody/log" className={ALERT_LINK}>
          {t(`${D}.recent.showLog`)}
        </Link>
      );
      break;
    case 'stale': {
      const kind = t(`fleet.custody.source.${line.kind}`);
      body = (
        <Sentence
          text={(p) => t(`${D}.alerts.stale.${form(line.count)}`, p)}
          params={{
            count: LATIN.format(line.count),
            kind,
            amount: money(line.total),
            days: LATIN.format(FLEET_CUSTODY_STALE_DAYS),
            date: ymd(line.oldest),
          }}
          strong={['count', 'amount', 'date']}
          nodes={{ amount: <MoneyInline value={line.total} /> }}
        />
      );
      action = can('fleetReceipt.create') ? (
        <Link
          to={`/fleet/custody/memos/new/${line.kind}`}
          data-custody-make-memo={line.kind}
          className={ALERT_LINK}
        >
          <BoardIcon d={PATH.plus} className="h-2.5 w-2.5" width={2.5} />
          {t('fleet.custody.memos.outside.make', { kind })}
        </Link>
      ) : null;
      break;
    }
    case 'memo':
      body = (
        <Sentence
          text={(p) => t(`${D}.alerts.memo`, p)}
          params={{ memo: memoDisplayName(line.memo, t), age: age(line.days) }}
          strong={['memo', 'age']}
          wrap={['memo']}
        />
      );
      action = (
        <Link to="/fleet/custody/memos?status=pending" className={ALERT_LINK}>
          {t(`${D}.waiting.showMemos`)}
        </Link>
      );
      break;
    case 'licence':
      body = (
        <Sentence
          text={(p) => t(`${D}.alerts.licence`, p)}
          params={{
            part: t(`fleet.licenseExpenses.kinds.${line.part.part}`),
            date: ymd(line.part.date),
            age: age(line.days),
          }}
          strong={['date', 'age']}
        />
      );
      action = can('fleetLicenseExpense.view') ? (
        <Link to={licenceWaitingLink(line.part.part)} className={ALERT_LINK}>
          {t(`${D}.settle.show`)}
        </Link>
      ) : null;
      break;
    case 'settleOver':
      icon = PATH.warn;
      tone = RED;
      body = (
        <Sentence
          text={(p) => t(`${D}.alerts.settleOver`, p)}
          params={{
            total: money(line.total),
            fund: line.fund < 0 ? minus(line.fund) : money(line.fund),
          }}
          strong={['total', 'fund']}
          ink={line.fund < 0 ? { fund: RED } : {}}
          nodes={{
            total: <MoneyInline value={line.total} />,
            fund: <MoneyInline value={line.fund} />,
          }}
        />
      );
      action = can('fleetReceipt.create') ? (
        <FundOpButton op="settle" onFundAction={onFundAction} />
      ) : null;
      break;
  }
  return (
    <li
      data-custody-alert={`fund-${line.type}`}
      data-custody-alert-key={line.key}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700 dark:text-slate-300"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <BoardIcon d={icon} className={cn('h-3.5 w-3.5 shrink-0', tone)} />
        <span>{body}</span>
      </span>
      {action}
    </li>
  );
};

/** The fund's lines under the banner's own — a rule between them when both are there. */
export const CustodyFundAlertLines = ({
  lines,
  ruled,
  onFundAction,
}: {
  lines: readonly CustodyFundAlert[];
  ruled: boolean;
  onFundAction?: ((op: CustodyFundOpening) => void) | undefined;
}): JSX.Element | null =>
  lines.length === 0 ? null : (
    <ul
      data-custody-fund-alerts="true"
      className={cn(
        'space-y-1.5',
        ruled && 'mt-2 border-t border-amber-200/80 pt-2 dark:border-amber-500/20',
      )}
    >
      {lines.map((line) => (
        <FundAlertLine key={line.key} line={line} onFundAction={onFundAction} />
      ))}
    </ul>
  );

// ── N7 the spend by its memos' state ────────────────────────────────────────────────────────────

const STATE_FILL: Record<FleetCustodyMemoState, string> = {
  replenished: 'bg-emerald-500',
  pending: 'bg-amber-500',
  outside: 'bg-slate-400 dark:bg-slate-500',
};
/** Where each state leads: a pending memo to the memos waiting, a receipt in none to the memos. */
const STATE_LINK: Record<FleetCustodyMemoState, string | null> = {
  replenished: null,
  pending: '/fleet/custody/memos?status=pending',
  outside: '/fleet/custody/memos',
};

/**
 * The spend split by its memos' state — replenished, waiting in a memo, in no memo yet — as a thin
 * bar; the total's card with its legend, a kind's with «لم تُستعَض: X» only when X is not zero.
 */
export const CustodyMemoStateBar = ({
  parts,
  legend,
  name,
}: {
  parts: Record<FleetCustodyMemoState, number>;
  legend: boolean;
  name: FleetCustodySource | 'total';
}): JSX.Element => {
  const t = useT();
  const money = useMoney();
  const whole = CUSTODY_MEMO_STATES.reduce((sum, state) => sum + Math.max(0, parts[state]), 0);
  const waiting = custodyNotReplenished(parts);
  const label = (state: FleetCustodyMemoState): string =>
    `${t(`${D}.states.${state}`)}: ${money(parts[state]).figure} ${money(parts[state]).currency}`;
  return (
    <div data-custody-memo-states={name} className="mt-3">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#162135]">
        {CUSTODY_MEMO_STATES.map((state) => {
          if (parts[state] <= 0 || whole <= 0) return null;
          const style = { width: `${(parts[state] / whole) * 100}%` };
          const to = STATE_LINK[state];
          return to === null ? (
            <span
              key={state}
              data-custody-memo-state={state}
              title={label(state)}
              className={cn('h-full', STATE_FILL[state])}
              style={style}
            />
          ) : (
            <Link
              key={state}
              to={to}
              data-custody-memo-state={state}
              title={label(state)}
              aria-label={label(state)}
              className={cn('h-full', STATE_FILL[state])}
              style={style}
            />
          );
        })}
      </div>
      {legend ? (
        <div className="mt-2 space-y-0.5 text-[11px]">
          {CUSTODY_MEMO_STATES.map((state) => {
            const to = STATE_LINK[state];
            const row = (
              <>
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn('h-2 w-2 rounded-sm', STATE_FILL[state])}
                  />
                  {t(`${D}.states.${state}`)}
                </span>
                <span dir="ltr" className={cn('font-bold text-slate-800 dark:text-slate-200', NUM)}>
                  {money(parts[state]).figure}
                </span>
              </>
            );
            const className =
              'flex items-center justify-between gap-2 text-slate-600 dark:text-slate-400';
            return to === null ? (
              <div key={state} data-custody-memo-legend={state} className={className}>
                {row}
              </div>
            ) : (
              <Link
                key={state}
                to={to}
                data-custody-memo-legend={state}
                className={cn(className, 'rounded hover:underline', FOCUS_RING)}
              >
                {row}
              </Link>
            );
          })}
        </div>
      ) : (
        waiting > 0 && (
          <Link
            to={parts.outside > 0 ? '/fleet/custody/memos' : '/fleet/custody/memos?status=pending'}
            data-custody-memo-waiting={name}
            className={cn(
              'mt-1.5 block text-[11px] text-slate-600 hover:underline dark:text-slate-400',
              FOCUS_RING,
            )}
          >
            <Sentence
              text={(p) => t(`${D}.states.waitingLine`, p)}
              params={{ amount: money(waiting).figure }}
              strong={['amount']}
              ink={{ amount: 'text-slate-800 dark:text-slate-200' }}
            />
          </Link>
        )
      )}
    </div>
  );
};
