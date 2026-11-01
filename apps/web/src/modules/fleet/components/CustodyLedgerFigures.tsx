// The fund's formula as tiles — «إجمالي الشحن» − «مصروفات الإيصالات» + «إجمالي الاستعاضة» − «إجمالي
// التسوية» = «إجمالي العهدة» — over the WHOLE history, whatever the filters. One component for the
// two screens that draw it:
//
//   «سجل العهدة» (`look="ledger"`)  each term signed in its colour, in the boards' figures, and the
//                                   fund «— الآن» a tile of its own with the formula under it (a
//                                   fund below zero in red).
//   «لوحة تحكم العهدة» («العهدة الآن», `look="dashboard"`)  the dashboard's own Cairo figure; each
//                                   term a way into «سجل العهدة» filtered to its operation
//                                   (`?op=charge|spend|replenish|settle`); the fund the board's own
//                                   card («صُرف من إجمالي الشحن X%»), handed in as `fundCard`.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  type FleetCustodyFundSummaryDto,
  type FleetCustodyLedgerOp,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { formatMoneyParts } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { CUSTODY_FUND } from './CustodyKinds';
import { CUSTODY_OPS } from './CustodyFundActions';
import { useLedgerWordsKit } from './CustodyOperationDrawer';
import { BoardIcon, NUM } from './FuelCardBoard';
import { CAIRO, CARD_BORDER, CARD_SURFACE } from './custody-dashboard-parts';
import { RECEIPT_ICON, SPEND_LOOK } from './custody-memo-parts';
import { partsPhrase } from '../lib/custody-ledger-words';

export type LedgerFiguresLook = 'ledger' | 'dashboard';

const COUNT = new Intl.NumberFormat('en-US');
const NEGATIVE_INK = 'text-red-600 dark:text-red-400';

/** The circled sign between two tiles, from `xl` where they stand in one row. */
export const LEDGER_OPERATOR =
  'absolute -start-[1.3rem] top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 bg-white text-base font-black text-slate-700 shadow-sm xl:flex dark:border-slate-600 dark:bg-[#0b0f19] dark:text-slate-200';

/** Four terms and the fund a little wider: one row from `xl`, two to a row under it. */
export const LEDGER_FIGURES_GRID: Record<LedgerFiguresLook, string> = {
  ledger:
    'grid shrink-0 grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.15fr)] xl:gap-5',
  dashboard:
    'grid grid-cols-2 gap-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.15fr)] xl:gap-5',
};

/** The dashboard's figure (Cairo, black) — a size up in the five tiles, where each is wider. */
export const STRIP_FIGURE = cn(
  'text-2xl font-black tracking-tight text-slate-900 [overflow-wrap:anywhere] dark:text-white',
  CAIRO,
);

/** Which operation of «سجل العهدة» each term is — its filter there. */
const TERM_OP: Record<'charged' | 'spent' | 'replenished' | 'settled', FleetCustodyLedgerOp> = {
  charged: 'charge',
  spent: 'spend',
  replenished: 'replenish',
  settled: 'settle',
};

/** «سجل العهدة» over one operation — where a dashboard tile leads. */
export const ledgerOpLink = (op: FleetCustodyLedgerOp): string => `/fleet/custody/log?op=${op}`;

/** One term of «إجمالي العهدة = شحن − مصروفات + استعاضة − تسوية». */
const Term = ({
  term,
  label,
  value,
  sign,
  note,
  icon,
  tile,
  accent,
  operator,
  look,
}: {
  term: keyof typeof TERM_OP;
  label: string;
  value: number;
  sign: '+' | '−';
  note: string;
  icon: readonly string[];
  tile: string;
  accent: string;
  operator: string | null;
  look: LedgerFiguresLook;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { figure, currency } = formatMoneyParts(value, 'EGP', locale);
  const operatorMark = operator !== null && (
    <span aria-hidden="true" className={cn(LEDGER_OPERATOR, NUM)}>
      {operator}
    </span>
  );
  if (look === 'dashboard') {
    return (
      <div className="relative" data-ledger-term={term}>
        {operatorMark}
        <Link
          to={ledgerOpLink(TERM_OP[term])}
          data-custody-fund-term={term}
          className={cn(
            CARD_SURFACE,
            CARD_BORDER,
            'group flex h-full min-w-0 flex-col justify-between rounded-2xl p-4',
            accent,
          )}
        >
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate text-xs font-bold text-slate-800 dark:font-semibold dark:text-slate-300">
                {label}
              </span>
              <span className="mt-1 flex flex-wrap items-baseline gap-1">
                <span dir="ltr" data-ledger-term-value={value} className={STRIP_FIGURE}>
                  {figure}
                </span>
                <span className="text-xs font-semibold text-slate-500 dark:font-medium dark:text-slate-400">
                  {currency}
                </span>
              </span>
            </span>
            <span
              className={cn('shrink-0 rounded-xl p-2.5 transition group-hover:scale-105', tile)}
            >
              <BoardIcon d={icon} className="h-5 w-5" />
            </span>
          </span>
          <span className="mt-3 truncate border-t border-slate-100 pt-2 text-xs text-slate-600 dark:border-[#1c273b] dark:text-slate-400">
            {note}
          </span>
        </Link>
      </div>
    );
  }
  return (
    <div className="relative" data-ledger-term={term}>
      {operatorMark}
      <div
        className={cn(
          CARD_SURFACE,
          CARD_BORDER,
          'flex h-full min-w-0 flex-col justify-between rounded-2xl p-3 sm:p-4 xl:p-3 min-[1700px]:p-4',
          accent,
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold text-slate-800 dark:font-semibold dark:text-slate-300">
              {label}
            </span>
            <span className="mt-1 flex flex-wrap items-baseline gap-1 xl:flex-nowrap">
              <span
                dir="ltr"
                data-ledger-term-value={value}
                className={cn(
                  'text-base font-black tracking-tight sm:text-2xl xl:text-lg min-[1700px]:text-2xl',
                  NUM,
                  sign === '+' ? 'text-emerald-700 dark:text-emerald-400' : NEGATIVE_INK,
                )}
              >
                {sign}
                {figure}
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {currency}
              </span>
            </span>
          </span>
          <span
            className={cn(
              'hidden shrink-0 rounded-xl p-2.5 sm:inline-flex xl:p-2 min-[1700px]:p-2.5',
              tile,
            )}
          >
            <BoardIcon
              d={icon}
              className="h-5 w-5 xl:h-4 xl:w-4 min-[1700px]:h-5 min-[1700px]:w-5"
            />
          </span>
        </span>
        <span className="mt-1.5 truncate border-t border-slate-100 pt-1.5 text-[11px] text-slate-600 sm:text-xs dark:border-[#1c273b] dark:text-slate-400">
          {note}
        </span>
      </div>
    </div>
  );
};

/** «إجمالي العهدة — الآن» on «سجل العهدة»: the fund's own tile, the formula under it. */
const LedgerFundNow = ({ fund }: { fund: FleetCustodyFundSummaryDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const now = formatMoneyParts(Math.abs(fund.fundTotal), 'EGP', locale);
  const negative = fund.fundTotal < 0;
  return (
    <div
      data-ledger-fund-now={fund.fundTotal}
      {...(negative ? { 'data-ledger-fund-negative': 'true' } : {})}
      className={cn(
        CARD_SURFACE,
        'flex h-full min-w-0 flex-col justify-between rounded-2xl border p-3 sm:p-4 xl:p-3 min-[1700px]:p-4',
        CUSTODY_FUND.card,
        CUSTODY_FUND.accent,
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className={cn('block text-xs', CUSTODY_FUND.label)}>
            {t('fleet.custody.ledger.tiles.fundNow')}
          </span>
          <span className="mt-1 flex flex-wrap items-baseline gap-1">
            <span
              dir="ltr"
              className={cn(
                'text-xl font-black tracking-tight sm:text-2xl xl:text-lg min-[1700px]:text-2xl',
                NUM,
                negative ? NEGATIVE_INK : 'text-slate-900 dark:text-white',
              )}
            >
              {negative ? '−' : ''}
              {now.figure}
            </span>
            <span className={cn('text-xs', CUSTODY_FUND.unit)}>{now.currency}</span>
          </span>
        </span>
        <span className={cn('shrink-0 rounded-xl p-2.5 xl:p-2', CUSTODY_FUND.tile)}>
          <BoardIcon d={CUSTODY_FUND.icon} className="h-5 w-5 xl:h-4 xl:w-4" />
        </span>
      </span>
      <span className="mt-1.5 whitespace-nowrap border-t border-slate-200 pt-1.5 text-[11px] text-slate-600 dark:border-[#1c273b] dark:text-slate-400">
        {t('fleet.custody.ledger.tiles.formula')}
      </span>
    </div>
  );
};

/**
 * The four terms and the fund they make — over the whole history, whatever the filters. On the
 * dashboard the fund is `fundCard` (the board's own card); on «سجل العهدة» its own tile.
 */
export const LedgerFigures = ({
  fund,
  look = 'ledger',
  fundCard,
}: {
  fund: FleetCustodyFundSummaryDto;
  look?: LedgerFiguresLook;
  /** The fund's tile on the dashboard — «إجمالي العهدة», the board's own card. */
  fundCard?: ReactNode;
}): JSX.Element => {
  const t = useT();
  const kit = useLedgerWordsKit();
  return (
    <section
      data-ledger-figures="true"
      data-ledger-figures-look={look}
      aria-label={look === 'dashboard' ? t('fleet.custody.ledger.tiles.formula') : undefined}
      className={LEDGER_FIGURES_GRID[look]}
    >
      <Term
        term="charged"
        label={t('fleet.custody.ledger.tiles.charged')}
        value={fund.charged.amount}
        sign="+"
        note={t(`fleet.custody.ledger.tiles.chargedNote.${kit.form(fund.charged.count)}`, {
          count: COUNT.format(fund.charged.count),
        })}
        icon={CUSTODY_OPS.charge.icon}
        tile={CUSTODY_OPS.charge.tile}
        accent={CUSTODY_OPS.charge.accent}
        operator={null}
        look={look}
      />
      <Term
        term="spent"
        label={t('fleet.custody.ledger.tiles.spent')}
        value={fund.spent.amount}
        sign="−"
        note={kit.count('receipt', fund.spent.count)}
        icon={RECEIPT_ICON}
        tile={SPEND_LOOK.tile}
        accent={SPEND_LOOK.accent}
        operator="−"
        look={look}
      />
      <Term
        term="replenished"
        label={t('fleet.custody.ledger.tiles.replenished')}
        value={fund.replenished.amount}
        sign="+"
        note={kit.count('memo', fund.replenished.memos)}
        icon={CUSTODY_OPS.replenish.icon}
        tile={CUSTODY_OPS.replenish.tile}
        accent={CUSTODY_OPS.replenish.accent}
        operator="+"
        look={look}
      />
      <Term
        term="settled"
        label={t('fleet.custody.ledger.tiles.settled')}
        value={fund.settled.amount}
        sign="−"
        note={partsPhrase(fund.settled.parts, kit)}
        icon={CUSTODY_OPS.settle.icon}
        tile={CUSTODY_OPS.settle.tile}
        accent={CUSTODY_OPS.settle.accent}
        operator="−"
        look={look}
      />
      <LedgerFundSlot>
        {look === 'dashboard' && fundCard !== undefined ? fundCard : <LedgerFundNow fund={fund} />}
      </LedgerFundSlot>
    </section>
  );
};

/** The fund's place at the end of the row, «=» before it. */
export const LedgerFundSlot = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="relative col-span-2 xl:col-span-1" data-ledger-term-fund="true">
    <span aria-hidden="true" className={cn(LEDGER_OPERATOR, NUM)}>
      =
    </span>
    {children}
  </div>
);
