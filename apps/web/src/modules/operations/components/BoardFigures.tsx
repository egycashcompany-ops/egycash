// The day board's figures, in its toolbar — «عاوز الاحصائيات تكون مكان تشغيل يوم … وخلى الاحصائيات
// تفتح يمين». A Fleet FigureChip is a 64px card made for a block of its own; these sit in one row
// with the toolbar's buttons, so they are pills of the same height (the ATM machines' figures are
// the precedent for the shape), in the Fleet boards' palette and figures font.
import { type ReactNode } from 'react';
import { type OperationsCurrencyDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatAmount } from '../../../shared/lib/format';
import { DesignCancel, DesignDialog } from '../../fleet/components/DesignDialog';
import { FigureChip } from '../../fleet/components/FleetFigures';
import { BoardIcon, NUM } from '../../fleet/components/FuelCardBoard';
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
 * made of.
 */
/** The breakdown itself — one figure per currency, or the empty line. Apart so it can be rendered
 * (and pinned) without the dialog's portal. */
export const OtherCurrenciesList = ({
  totals,
  currencyOf,
  locale,
}: {
  totals: readonly { currencyId: string; amount: number }[];
  currencyOf: (id: string) => OperationsCurrencyDto | undefined;
  locale: 'ar' | 'en';
}): JSX.Element => {
  const t = useT();
  return totals.length === 0 ? (
    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
      {t('operations.board.figures.otherCurrenciesEmpty')}
    </p>
  ) : (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-other-currencies-list="true">
      {totals.map((total) => {
        const currency = currencyOf(total.currencyId);
        return (
          <FigureChip
            key={total.currencyId}
            icon={SHIPMENT_PATH.money}
            iconClass={FIGURE_TONE.others}
            label={currency?.name ?? '…'}
            value={formatAmount(total.amount, locale)}
            unit={currency?.code ?? ''}
          />
        );
      })}
    </div>
  );
};

export const OtherCurrenciesDialog = ({
  open,
  onClose,
  totals,
  currencyOf,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  totals: readonly { currencyId: string; amount: number }[];
  currencyOf: (id: string) => OperationsCurrencyDto | undefined;
  locale: 'ar' | 'en';
}): JSX.Element | null => {
  const t = useT();
  return (
    <DesignDialog
      open={open}
      onClose={onClose}
      title={t('operations.board.figures.otherCurrenciesTitle')}
      icon={SHIPMENT_PATH.money}
      width="lg"
      panelProps={{ 'data-other-currencies': 'true' }}
      footer={<DesignCancel onClick={onClose} label={t('common.close')} />}
    >
      <OtherCurrenciesList totals={totals} currencyOf={currencyOf} locale={locale} />
    </DesignDialog>
  );
};
