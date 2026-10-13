// The custody board's figures — behind «الإحصائيات» on the board's toolbar, a button in the site's
// purple as on every board; the colours below are the tiles' own.
//
// «عاوز الاحصائيات الكوتش لوحده والغسيل لوحده»: five figures, not four — everything the fund paid,
// then each kind on its own tile in its own colour and icon (`CustodyKinds.tsx`). The numbers are
// the server's, over the whole filtered set, never the page. Since the owner's dashboard design
// («فى شاشه العهد … فى اللايت سيم والدارك سيم») each tile also wears the design's coloured edge,
// the total the emerald one; since «هادية», each is the dashboard's KPI card, a kind's with a thin
// bar of its share.
//
// «والنسب باينه»: each kind's tile also says what part of the whole it is. A share is written here
// once — `custodyShare` and `CustodyShare` — and «لوحة تحكم» writes every one of its shares with
// them, so «45%» reads the same on a tile, a card, a ranked line and a table.
//
// «عاوز ازود اجمالى العهده فى الاحصايات و تكون فى الداس بورد»: six figures now — the fund itself
// first («إجمالي العهدة», `CustodyFundCard`), then everything it paid for. The board and «لوحة تحكم»
// draw the same card, the board's with the bar of what was spent of it.
import { type FleetCustodySummaryDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import {
  CUSTODY_FUND,
  CUSTODY_KIND,
  CUSTODY_KINDS,
  CUSTODY_TOTAL_ACCENT,
  CUSTODY_TOTAL_TILE,
} from './CustodyKinds';
import { moneyChip } from './FleetFigures';
import { BoardIcon, NUM, PATH } from './FuelCardBoard';
import { CARD_BORDER, CARD_SURFACE, useCount } from './custody-dashboard-parts';

/**
 * «44%» — under one per cent but not nothing, «<1%»; over ninety-nine but not all of it, «>99%»;
 * of nothing, a dash. The two ends mirror each other: rounded, 9,980 of 10,000 would read «100%»
 * on the tile beside the other 20's «<1%» — two shares of one whole that cannot both be true.
 */
export const custodyShare = (part: number, whole: number): string => {
  if (whole <= 0) return '—';
  const pct = (part / whole) * 100;
  if (part > 0 && pct < 1) return '<1%';
  if (part < whole && pct > 99) return '>99%';
  return `${Math.round(pct)}%`;
};

/** The same share as a number of per cent, for a drawing to decide by — of nothing, 0, never NaN. */
export const custodySharePct = (part: number, whole: number): number =>
  whole <= 0 ? 0 : (part / whole) * 100;

/**
 * A share as the boards write a figure: Latin digits in their monospace, and `dir="ltr"` so that
 * inside an Arabic line «%» stays after the figure and «<1%» is not mirrored into «1%>». Beside a
 * sum of money it may sit on a neutral chip of its own (`pill`), so «850.00 ج.م. 20%» never reads
 * as one number.
 */
export const CustodyShare = ({
  part,
  whole,
  pill = false,
  className,
}: {
  part: number;
  whole: number;
  pill?: boolean;
  className?: string;
}): JSX.Element => (
  <span
    dir="ltr"
    data-custody-pct="true"
    className={cn(
      'whitespace-nowrap',
      NUM,
      pill &&
        'rounded-md bg-slate-100 px-1.5 py-px text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200',
      className,
    )}
  >
    {custodyShare(part, whole)}
  </span>
);

/**
 * The fund as a sum — what «شحن العهدة» charged into it, 0 until that action exists. Anything that
 * is not an amount reads as 0 too: an older server's `null`, or an answer with no `fundTotal` at
 * all (while a deploy rolls the web out first), must never print «ليس رقمًا» or «NaN%».
 */
export const custodyFundAmount = (fund: number | null | undefined): number =>
  typeof fund === 'number' && Number.isFinite(fund) && fund > 0 ? fund : 0;

/**
 * «صُرف منها 4.3%» — what the movements spent of the fund: one decimal under ten per cent, whole
 * from there; a sliver «<0.1%», never «0.0%». Past the fund it says so — the spend can outrun what
 * was charged into it — and the two ends never claim what is not true: all but a sliver is «>99%»,
 * never «100%», and a sliver over is «>100%», never «100%». With nothing in the fund (0), a dash:
 * there is nothing to divide by.
 */
export const custodySpentOfFund = (spent: number, fundTotal: number | null | undefined): string => {
  const fund = custodyFundAmount(fundTotal);
  if (fund <= 0) return '—';
  if (spent <= 0) return '0%';
  const pct = (spent / fund) * 100;
  if (pct < 0.1) return '<0.1%';
  if (Math.round(pct * 10) / 10 < 10) return `${pct.toFixed(1)}%`;
  const whole = Math.round(pct);
  if (spent < fund && whole >= 100) return '>99%';
  if (spent > fund && whole <= 100) return '>100%';
  return `${whole}%`;
};

/** The same, as the width of a bar: with nothing in the fund, none; past the fund, the whole bar. */
export const custodySpentOfFundPct = (
  spent: number,
  fundTotal: number | null | undefined,
): number => {
  const fund = custodyFundAmount(fundTotal);
  return fund > 0 ? Math.min(100, Math.max(0, (spent / fund) * 100)) : 0;
};

/** The fund's words, under `fleet.custody.fund`. */
export const CUSTODY_FUND_LABEL = 'fleet.custody.fund.title';

/** Each figure's words, the kind's own key under `fleet.custody.totals`. */
export const CUSTODY_KIND_LABEL = {
  dealership: 'fleet.custody.totals.dealership',
  fuel: 'fleet.custody.totals.fuel',
  tyres: 'fleet.custody.totals.tyres',
  wash: 'fleet.custody.totals.wash',
} as const;

/**
 * «عاوزك تظبط الوان العهده ك شاشه … الداش بورد زى ما هى حلوه»: the board's figures in the
 * cards of «لوحة تحكم» — its surface and border in both themes (`CARD_SURFACE`, `CARD_BORDER`),
 * each kind's edge, label and icon tile, the total in the dashboard's emerald card, the fund in
 * its slate one. The figure stays black in the boards' monospace (`NUM`), as the board's tiles
 * always wrote it, with one font-family class only: `cn` merges nothing, and of two the
 * stylesheet's order, not the markup's, would pick. The dashboard's own cards are not touched:
 * these are the board's, built from the same parts. Every number is still the summary's — the
 * share's bar draws the share already written beside it, nothing new.
 */
const TILE_FIGURE = cn('text-2xl font-black tracking-tight text-slate-900 dark:text-white', NUM);
const TILE_RULE = 'mt-3 border-t border-slate-100 pt-2 text-xs dark:border-[#1c273b]';
const TILE_FOOT = cn(TILE_RULE, 'flex items-center justify-between gap-2');

/**
 * «إجمالي العهدة» — the fund: what «شحن العهدة» charged into it, «0.00 ج.م.» until that action
 * exists — always a sum, never «—». The spend's own card in the fund's slate (`CUSTODY_FUND`), a
 * wallet on its tile. Under it, «صُرف منها X%»: the movements' total over the fund — the board's
 * own filters hold for the spend, the fund is the fund — and «—» while the fund is 0. On the board
 * (`board`) a bar draws that share, as each kind's tile draws its own (empty while the fund is 0),
 * and the figure is in the boards' monospace, as its tiles write theirs; on «لوحة تحكم» it takes
 * the dashboard's own figure (`figure`, Cairo), with no bar, as its other cards.
 */
export const CustodyFundCard = ({
  fundTotal,
  spent,
  board = false,
  figure = TILE_FIGURE,
}: {
  /** The fund in EGP; an older server's `null` or a missing one (`undefined`) reads as 0. */
  fundTotal: number | null | undefined;
  /** The movements' total over the same filters — `total` of the summary. */
  spent: number;
  /** The board's figure: the bar of what was spent of the fund under it. */
  board?: boolean;
  /** The sum's classes — the board's tiles' by default, the dashboard's on «لوحة تحكم». */
  figure?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const fund = moneyChip(custodyFundAmount(fundTotal), locale);
  return (
    <div
      data-custody-fund="true"
      className={cn(
        CARD_SURFACE,
        'group relative flex h-full min-w-0 flex-col justify-between overflow-hidden rounded-2xl p-4',
        CUSTODY_FUND.card,
        CUSTODY_FUND.accent,
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className={cn('block text-xs', CUSTODY_FUND.label)}>{t(CUSTODY_FUND_LABEL)}</span>
          <span className="mt-1 flex flex-wrap items-baseline gap-1">
            <span data-custody-fund-value="true" className={figure}>
              {fund.value}
            </span>
            <span className={cn('text-xs', CUSTODY_FUND.unit)}>{fund.unit}</span>
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded-xl p-2.5 transition group-hover:scale-105',
            CUSTODY_FUND.tile,
          )}
        >
          <BoardIcon d={CUSTODY_FUND.icon} className="h-5 w-5" />
        </span>
      </span>
      <span className={cn(TILE_RULE, 'flex flex-col gap-1.5')}>
        <span data-custody-fund-spent="true" className="text-slate-600 dark:text-slate-400">
          {t('fleet.custody.fund.spent')}{' '}
          <span
            dir="ltr"
            data-custody-fund-pct="true"
            className={cn(
              'whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-px text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200',
              NUM,
            )}
          >
            {custodySpentOfFund(spent, fundTotal)}
          </span>
        </span>
        {board && (
          <span
            aria-hidden="true"
            data-custody-fund-bar="true"
            className="block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#162135]"
          >
            <span
              className={cn('block h-full rounded-full', CUSTODY_FUND.fill)}
              style={{ width: `${custodySpentOfFundPct(spent, fundTotal)}%` }}
            />
          </span>
        )}
      </span>
    </div>
  );
};

export const CustodyFigures = ({ totals }: { totals: FleetCustodySummaryDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { count } = useCount();
  const total = moneyChip(totals.total, locale);
  return (
    <section
      data-custody-figures="true"
      // «هتضيف بس فى الاول قبل إجمالي مصروفات العهدة»: the fund joins the front of the row the board
      // already had — all six in ONE row from 1,680px, as the five were, the sums a size down there
      // (`text-lg`, back to `text-xl` from 1,800px and `text-2xl` from 2,100px) so a sum in the
      // millions still clears its icon beside the side bar (measured: at 1,536px a sixth is 195px and
      // «2,345,678.90» ran under its icon). Narrower: one to a row on a phone,
      // two from `sm`, and from `xl` two rows of three — not three from `lg`, where the side bar
      // (240px) opens and a third of a 1,024px board left a tile about 232px wide. Should a sum still
      // not fit, «ج.م.» goes under it rather than off the tile.
      className="grid shrink-0 animate-drop-in grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1680px]:grid-cols-6 min-[1680px]:[&_.text-2xl]:text-lg min-[1800px]:[&_.text-2xl]:text-xl min-[2100px]:[&_.text-2xl]:text-2xl [&_.items-baseline]:flex-wrap"
    >
      {/* Each card fills its cell (`h-full`). Spans inside the card, so the card is one box to
          whatever reads its markup. */}
      <div data-custody-figure="fund">
        <CustodyFundCard fundTotal={totals.fundTotal} spent={totals.total} board />
      </div>
      <div data-custody-figure="total">
        <div
          className={cn(
            CARD_SURFACE,
            'group relative flex h-full min-w-0 flex-col justify-between overflow-hidden rounded-2xl border-emerald-300 bg-gradient-to-br from-emerald-50/70 via-white to-white p-4 dark:border-emerald-500/40',
            CUSTODY_TOTAL_ACCENT,
          )}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -left-12 -top-12 hidden h-28 w-28 rounded-full bg-emerald-500/10 blur-2xl dark:block"
          />
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-xs font-bold text-emerald-800 dark:font-semibold dark:text-emerald-300">
                {t('fleet.custody.totals.total')}
              </span>
              <span className="mt-1 flex items-baseline gap-1">
                <span className={TILE_FIGURE}>{total.value}</span>
                <span className="text-xs font-bold text-emerald-700 dark:font-semibold dark:text-emerald-400">
                  {total.unit}
                </span>
              </span>
            </span>
            <span
              className={cn(
                'shrink-0 rounded-xl p-2.5 transition group-hover:scale-105',
                CUSTODY_TOTAL_TILE,
              )}
            >
              <BoardIcon d={PATH.box} className="h-5 w-5" />
            </span>
          </span>
          <span className={TILE_FOOT}>
            <span className="text-slate-600 dark:text-slate-300">
              {t('fleet.custody.dashboard.kpi.movements')}
            </span>
            <span
              className={cn(
                'shrink-0 whitespace-nowrap rounded border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-700/30 dark:bg-emerald-950/40 dark:text-xs dark:text-emerald-400',
                NUM,
              )}
            >
              {count('movement', totals.count)}
            </span>
          </span>
        </div>
      </div>
      {CUSTODY_KINDS.map((kind) => {
        const look = CUSTODY_KIND[kind];
        const sum = moneyChip(totals[kind], locale);
        return (
          <div key={kind} data-custody-figure={kind}>
            <div
              className={cn(
                CARD_SURFACE,
                CARD_BORDER,
                'group flex h-full min-w-0 flex-col justify-between rounded-2xl p-4',
                look.accent,
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className={cn('block text-xs', look.label)}>
                    {t(CUSTODY_KIND_LABEL[kind])}
                  </span>
                  <span className="mt-1 flex items-baseline gap-1">
                    <span className={TILE_FIGURE}>{sum.value}</span>
                    <span className="text-xs font-semibold text-slate-500 dark:font-medium dark:text-slate-400">
                      {sum.unit}
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-xl p-2.5 transition group-hover:scale-105',
                    look.tile,
                  )}
                >
                  <BoardIcon d={look.icon} className="h-5 w-5" />
                </span>
              </span>
              {/* «45% من الإجمالي» — «45% of total»: both languages put the share first, and a
                  thin bar in the kind's fill draws the same share. Of nothing the tile says
                  nothing, rather than «—» or «NaN%» under a zero. */}
              {totals.total > 0 && (
                <span className={cn(TILE_RULE, 'flex flex-col gap-1.5')}>
                  <span
                    data-custody-figure-share={kind}
                    className="text-slate-600 dark:text-slate-400"
                  >
                    <CustodyShare part={totals[kind]} whole={totals.total} pill />{' '}
                    {t('fleet.custody.totals.ofTotal')}
                  </span>
                  <span
                    aria-hidden="true"
                    className="block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-[#162135]"
                  >
                    <span
                      className={cn('block h-full rounded-full', look.fill)}
                      style={{ width: `${custodySharePct(totals[kind], totals.total)}%` }}
                    />
                  </span>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
};
