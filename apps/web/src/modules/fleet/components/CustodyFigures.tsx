// The custody board's figures — behind «الإحصائيات» on the board, and leading «لوحة تحكم».
//
// «عاوز الاحصائيات الكوتش لوحده والغسيل لوحده»: five figures, not four — everything the fund paid,
// then each kind on its own tile in its own colour and icon (`CustodyKinds.tsx`). The numbers are
// the server's, over the whole filtered set, never the page.
//
// «والنسب باينه»: each kind's tile also says what part of the whole it is. A share is written here
// once — `custodyShare` and `CustodyShare` — and «لوحة تحكم» writes every one of its shares with
// them, so «45%» reads the same on a tile, a bar, a ranked line and a table.
import { type FleetCustodySummaryDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { CUSTODY_KIND, CUSTODY_KINDS, CUSTODY_TOTAL_TILE } from './CustodyKinds';
import { FigureChip, moneyChip } from './FleetFigures';
import { NUM, PATH } from './FuelCardBoard';

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
 * sum of money it sits on a neutral chip of its own (`pill`), so «850.00 ج.م. 20%» never reads as
 * one number — neutral, because purple is what is pressed and green, amber and red are states.
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

/** Each figure's words, the kind's own key under `fleet.custody.totals`. */
const KIND_LABEL = {
  dealership: 'fleet.custody.totals.dealership',
  fuel: 'fleet.custody.totals.fuel',
  tyres: 'fleet.custody.totals.tyres',
  wash: 'fleet.custody.totals.wash',
} as const;

export const CustodyFigures = ({ totals }: { totals: FleetCustodySummaryDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <section
      data-custody-figures="true"
      // Five across only where five sums fit (measured: a 1,024px board cuts «ج.م.» off a tile
      // of five); between 1,280 and 1,536 the figure a size down, so a sum in the millions fits —
      // and should one still not, «ج.م.» goes under it rather than off the tile.
      className="grid shrink-0 animate-drop-in grid-cols-2 gap-3 xl:grid-cols-5 xl:[&_.text-2xl]:text-xl 2xl:[&_.text-2xl]:text-2xl [&_.items-baseline]:flex-wrap"
    >
      {/* A sum of money takes the whole row on a phone, so «ج.م.» stays on the tile; the total
          keeps a row of its own until the five fit on one. Each card fills its cell (`h-full`):
          the total has no «من الإجمالي» line under it, and five across it would stop short of its
          four neighbours. */}
      <div className="col-span-2 xl:col-span-1" data-custody-figure="total">
        <FigureChip
          className="h-full"
          icon={PATH.box}
          iconClass={CUSTODY_TOTAL_TILE}
          label={t('fleet.custody.totals.total')}
          {...moneyChip(totals.total, locale)}
        />
      </div>
      {CUSTODY_KINDS.map((kind) => (
        <div key={kind} className="col-span-2 sm:col-span-1" data-custody-figure={kind}>
          <FigureChip
            className="h-full"
            icon={CUSTODY_KIND[kind].icon}
            iconClass={cn(CUSTODY_KIND[kind].fill, CUSTODY_KIND[kind].ink)}
            label={t(KIND_LABEL[kind])}
            {...moneyChip(totals[kind], locale)}
            // «45% من الإجمالي» — «45% of total»: both languages put the share first. Of nothing
            // the tile says nothing, rather than «—» or «NaN%» under a zero.
            {...(totals.total > 0
              ? {
                  note: (
                    <span data-custody-figure-share={kind}>
                      <CustodyShare part={totals[kind]} whole={totals.total} pill />{' '}
                      {t('fleet.custody.totals.ofTotal')}
                    </span>
                  ),
                }
              : {})}
          />
        </div>
      ))}
    </section>
  );
};
