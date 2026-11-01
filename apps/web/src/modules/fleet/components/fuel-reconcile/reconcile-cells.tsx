// «مطابقة أرصدة الكروت» — the small cells the table, the folds, the header and the confirmation
// share: a card's place, a balance, «سجل الكارت»'s button, a difference with its bar, the tick, the
// signed net, and the two marks (a moved card, a row that never matches). The approved sample's
// own pieces, class for class.
import { type FleetFuelCardDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { HistoryIcon } from '../../../../shared/ui/icons';
import { cn } from '../../../../shared/lib/cn';
import { NUM } from '../FuelCardBoard';
import { ACTION_GROUP, actionTone } from '../row-actions-look';
import { CodeChip } from '../custody-memo-parts';
import { money, signed } from '../../lib/fuel-reconcile';

/** A clock turning back — «تغيّر بعد القراءة». */
export const MOVED_ICON: readonly string[] = ['M12 8v4l3 2', 'M3.05 11a9 9 0 1 1 .5 4M3 4v5h5'];
/** Two rows that disagree — «صفوف لا تُطابَق». */
export const CONFLICT_ICON: readonly string[] = [
  'M8 7h12M8 12h12M8 17h12',
  'M3.5 6.5l2 2m0-2l-2 2',
  'M3.5 16.5l2 2m0-2l-2 2',
];

/** A card's place: its car's code, or what a card on no car is called («سفر 5», «اسبير»). */
export const Place = ({ card }: { card: FleetFuelCardDto }): JSX.Element =>
  card.vehicleCode !== null ? (
    <CodeChip code={card.vehicleCode} />
  ) : (
    <span className="inline-flex items-center whitespace-nowrap rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[13px] font-bold text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300">
      {card.label ?? '—'}
    </span>
  );

/** A balance: Latin figures with their two decimals; struck through once it no longer holds. */
export const Figure = ({
  value,
  className,
  struck = false,
}: {
  value: number;
  className?: string;
  struck?: boolean;
}): JSX.Element => (
  <span
    dir="ltr"
    className={cn(
      NUM,
      'whitespace-nowrap text-[15px] font-bold text-slate-800 dark:text-slate-200',
      className,
      struck && '!text-slate-400 line-through decoration-2 dark:!text-slate-500',
    )}
  >
    {money(value)}
  </span>
);

/** «سجل الكارت» in the row actions' own box. */
export const HistoryButton = ({
  card,
  onOpen,
}: {
  card: FleetFuelCardDto;
  onOpen: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <span className={ACTION_GROUP}>
      <button
        type="button"
        data-recon-history={card.id}
        title={t('fleet.fuelCards.history.open')}
        aria-label={t('fleet.fuelCards.history.open')}
        onClick={onOpen}
        className={actionTone('history')}
      >
        <HistoryIcon className="h-4 w-4" />
      </button>
    </span>
  );
};

/** «الفرق» — signed and coloured, with a bar of its size against the largest. */
export const Difference = ({ value, largest }: { value: number; largest: number }): JSX.Element => {
  const width = largest > 0 ? Math.max(3, Math.round((Math.abs(value) / largest) * 100)) : 0;
  const up = value > 0;
  return (
    <span className="mx-auto flex w-36 flex-col items-center gap-1" data-recon-diff={value}>
      <span
        dir="ltr"
        className={cn(
          NUM,
          'whitespace-nowrap text-[15px] font-black',
          up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
        )}
      >
        {signed(value)}
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700/60">
        <span
          className={cn('block h-full rounded-full', up ? 'bg-emerald-500/80' : 'bg-red-500/80')}
          style={{ width: `${width}%` }}
        />
      </span>
    </span>
  );
};

/** The table's square tick — `DataTable`'s own checkbox, which a decided row no longer offers. */
export const Check = ({
  on,
  partly = false,
  label,
  onChange,
  ...rest
}: {
  on: boolean;
  partly?: boolean;
  label: string;
  onChange: (on: boolean) => void;
} & Record<`data-${string}`, string>): JSX.Element => (
  <input
    type="checkbox"
    {...rest}
    className="h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900"
    checked={on}
    ref={(el) => {
      if (el !== null) el.indeterminate = partly && !on;
    }}
    onChange={(e) => onChange(e.target.checked)}
    aria-label={label}
    title={label}
  />
);

/** The selection's net difference, green up and red down. */
export const Net = ({ value }: { value: number }): JSX.Element => (
  <b
    dir="ltr"
    className={cn(
      NUM,
      value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
    )}
  >
    {signed(value)}
  </b>
);
