// The day board's figures, in its toolbar — «عاوز الاحصائيات تكون مكان تشغيل يوم … وخلى الاحصائيات
// تفتح يمين». A Fleet FigureChip is a 64px card made for a block of its own; these sit in one row
// with the toolbar's buttons, so they are pills of the same height (the ATM machines' figures are
// the precedent for the shape), in the Fleet boards' palette and figures font.
import { type ReactNode } from 'react';
import { type OperationsCurrencyDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatAmount, formatNumber } from '../../../shared/lib/format';
import { pluralForm } from '../../../shared/lib/plural';
import { DesignCancel, DesignDialog } from '../../fleet/components/DesignDialog';
import { BoardIcon, NUM } from '../../fleet/components/FuelCardBoard';
import { currencyUnit, type OtherCurrencyCard } from '../lib/day-board';
import { SHIPMENT_PATH } from './shipment-icons';

const PILL =
  'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white py-1 pe-3 ps-1 dark:border-slate-800 dark:bg-[#111827]';

/** The tones of the figures, by what they count. */
export const FIGURE_TONE = {
  count: 'bg-brand-500/15 text-brand-600 dark:text-brand-300',
  pound: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  dollar: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  others: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
} as const;

const PillBody = ({
  icon,
  tone,
  label,
  value,
  unit,
}: {
  icon: readonly string[];
  tone: string;
  label: string;
  value: string;
  unit?: string | undefined;
}): JSX.Element => (
  <>
    <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', tone)}>
      <BoardIcon d={[...icon]} className="h-4 w-4" />
    </span>
    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</span>
    <span className={cn('text-[15px] font-black text-slate-900 dark:text-white', NUM)}>
      {value}
    </span>
    {unit !== undefined && unit !== '' && (
      <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">{unit}</span>
    )}
  </>
);

/** One figure. Given `onClick`, it is a button that opens what the figure sums. */
export const BoardFigurePill = ({
  icon,
  tone,
  label,
  value,
  unit,
  onClick,
  title,
  children,
  ...rest
}: {
  icon: readonly string[];
  tone: string;
  label: string;
  value: string;
  unit?: string;
  onClick?: () => void;
  title?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string>): JSX.Element =>
  onClick === undefined ? (
    <span className={PILL} title={title} {...rest}>
      <PillBody icon={icon} tone={tone} label={label} value={value} unit={unit} />
      {children}
    </span>
  ) : (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-haspopup="dialog"
      className={cn(
        PILL,
        'cursor-pointer transition hover:border-amber-400/70 hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 dark:hover:bg-amber-500/10',
      )}
      {...rest}
    >
      <PillBody icon={icon} tone={tone} label={label} value={value} unit={unit} />
      {children}
    </button>
  );

/**
 * «لما ادوس على عملات أخرى دى يفتح فورم ب كل عملة لوحدها كام»: the currencies the «عملات أخرى»
 * figure adds together, each with its own total — the one place a reader sees what that sum is
 * made of. «شكل الفورم بتاعت العملات مش عاجبنى كبرها وحسن الشكل»: a wide panel, the figure itself
 * on a band across the top, then one generous card per currency, in the catalog's order — «ترتيب
 * العملات … على حسب ترتيبها ف شاشة البيانات المرجعية» — with its share of the figure on its bar.
 *
 * The cards are `otherCurrencies()` (lib/day-board.ts) — exactly the currencies the pill counted,
 * so the panel can never list one the figure did not add, or miss one it did.
 */
const PERCENT = (share: number): string => {
  if (share <= 0) return '0%';
  const rounded = Math.round(share * 100);
  // A sliver still shows as something: «0%» beside a currency that IS in the sum reads as a bug.
  return rounded === 0 ? '<1%' : `${String(rounded)}%`;
};

/** The cards' columns: one card reads alone, two side by side, three or more three across. */
const cardColumns = (count: number): string =>
  count === 1
    ? 'grid-cols-1'
    : count === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

/** The amber tile a currency's drawing sits in — the «عملات أخرى» pill's own tone. */
const COIN_TILE =
  'flex shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300';

/** A small rounded fact beside the band's figure. */
const BandChip = ({ children }: { children: ReactNode }): JSX.Element => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-white/80 px-3 py-1 text-xs font-bold text-slate-700 dark:border-amber-500/30 dark:bg-[#0a1233]/70 dark:text-slate-200">
    {children}
  </span>
);

/** One currency: its name, its total very large, how many shipments carry it, its share. */
const CurrencyCard = ({
  card,
  currency,
  locale,
}: {
  card: OtherCurrencyCard;
  currency: OperationsCurrencyDto | undefined;
  locale: 'ar' | 'en';
}): JSX.Element => {
  const t = useT();
  // Only an alphabetic code is a unit (EUR); the legacy catalog's «3» is a row number.
  const unit = currencyUnit(currency);
  return (
    <li
      data-other-currency={card.currencyId}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-amber-400/70 hover:shadow-lg hover:shadow-amber-500/10 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80 dark:hover:border-amber-400/40"
    >
      <div className="flex items-center gap-3">
        <span className={cn(COIN_TILE, 'h-11 w-11')}>
          <BoardIcon d={[...SHIPMENT_PATH.money]} className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-lg font-black text-slate-900 dark:text-white">
            {currency?.name ?? '…'}
          </p>
          <p className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">
            {t(`operations.board.figures.inShipments.${pluralForm(locale, card.shipments)}`, {
              count: formatNumber(card.shipments, locale),
            })}
          </p>
        </div>
        {unit !== '' && (
          <span
            dir="ltr"
            className="shrink-0 rounded-lg border border-amber-300/70 bg-amber-50 px-2 py-0.5 text-[11px] font-black tracking-wider text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
          >
            {unit}
          </span>
        )}
      </div>
      <p className="text-start">
        <span
          dir="ltr"
          className={cn(
            'inline-block whitespace-nowrap text-[1.75rem] font-black leading-none tracking-tight text-slate-900 dark:text-white',
            NUM,
          )}
        >
          {formatAmount(card.amount, locale)}
        </span>
      </p>
      <div className="flex items-center gap-2" title={t('operations.board.figures.share')}>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-l from-amber-500 to-amber-300 dark:from-amber-400 dark:to-amber-600"
            style={{ width: `${String(Math.min(100, Math.max(0, card.share * 100)))}%` }}
          />
        </div>
        <span
          dir="ltr"
          className={cn('shrink-0 text-xs font-bold text-slate-500 dark:text-slate-400', NUM)}
        >
          {PERCENT(card.share)}
        </span>
      </div>
    </li>
  );
};

/** The breakdown itself — the band and the cards, or the empty line. Apart so it can be rendered
 * (and pinned) without the dialog's portal. */
export const OtherCurrenciesList = ({
  cards,
  sum,
  shipments,
  currencyOf,
  locale,
}: {
  cards: readonly OtherCurrencyCard[];
  /** The «عملات أخرى» figure — the cards' amounts added together. */
  sum: number;
  /** How many of the shipments shown carry any of these currencies. */
  shipments: number;
  currencyOf: (id: string) => OperationsCurrencyDto | undefined;
  locale: 'ar' | 'en';
}): JSX.Element => {
  const t = useT();
  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className={cn(COIN_TILE, 'h-14 w-14 opacity-70')}>
          <BoardIcon d={[...SHIPMENT_PATH.money]} className="h-7 w-7" />
        </span>
        <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
          {t('operations.board.figures.otherCurrenciesEmpty')}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-5" data-other-currencies-list="true">
      <section
        data-other-currencies-total="true"
        className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-gradient-to-l from-amber-50 via-white to-white p-5 dark:border-amber-500/25 dark:from-amber-500/15 dark:via-[#0a1233]/80 dark:to-[#0a1233]/80"
      >
        <div className="flex min-w-0 items-center gap-4">
          <span className={cn(COIN_TILE, 'h-14 w-14 rounded-2xl')}>
            <BoardIcon d={[...SHIPMENT_PATH.money]} className="h-7 w-7" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
              {t('operations.board.figures.otherCurrenciesTotal')}
            </p>
            <p className="mt-1 text-start">
              <span
                dir="ltr"
                className={cn(
                  'inline-block whitespace-nowrap text-4xl font-black leading-none tracking-tight text-slate-900 sm:text-5xl dark:text-white',
                  NUM,
                )}
              >
                {formatAmount(sum, locale)}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BandChip>
            <BoardIcon
              d={[...SHIPMENT_PATH.money]}
              className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300"
            />
            {t(`operations.board.figures.currencyCount.${pluralForm(locale, cards.length)}`, {
              count: formatNumber(cards.length, locale),
            })}
          </BandChip>
          <BandChip>
            <BoardIcon
              d={[...SHIPMENT_PATH.shipment]}
              className="h-3.5 w-3.5 text-brand-600 dark:text-brand-300"
            />
            {t(`operations.board.figures.inShipments.${pluralForm(locale, shipments)}`, {
              count: formatNumber(shipments, locale),
            })}
          </BandChip>
        </div>
      </section>
      <ul className={cn('grid gap-3', cardColumns(cards.length))}>
        {cards.map((card) => (
          <CurrencyCard
            key={card.currencyId}
            card={card}
            currency={currencyOf(card.currencyId)}
            locale={locale}
          />
        ))}
      </ul>
    </div>
  );
};

export const OtherCurrenciesDialog = ({
  open,
  onClose,
  cards,
  sum,
  shipments,
  currencyOf,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  cards: readonly OtherCurrencyCard[];
  sum: number;
  shipments: number;
  currencyOf: (id: string) => OperationsCurrencyDto | undefined;
  locale: 'ar' | 'en';
}): JSX.Element | null => {
  const t = useT();
  return (
    <DesignDialog
      open={open}
      onClose={onClose}
      title={t('operations.board.figures.otherCurrenciesTitle')}
      subtitle={t('operations.board.figures.otherCurrenciesSubtitle')}
      icon={SHIPMENT_PATH.money}
      width="4xl"
      // A phone reads the whole title rather than «العملات الأخرى، كل عمل…».
      wrapTitle
      panelProps={{ 'data-other-currencies': 'true' }}
      footer={<DesignCancel onClick={onClose} label={t('common.close')} />}
    >
      <OtherCurrenciesList
        cards={cards}
        sum={sum}
        shipments={shipments}
        currencyOf={currencyOf}
        locale={locale}
      />
    </DesignDialog>
  );
};
