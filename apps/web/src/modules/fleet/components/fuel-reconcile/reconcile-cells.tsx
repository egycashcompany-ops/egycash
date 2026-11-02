// «مطابقة أرصدة الكروت» — the small cells the table, the folds, the header and the confirmation
// share: a card's place, a balance, «سجل الكارت»'s button, a difference with its bar, the tick, the
// signed net, and the two marks (a moved card, a row that never matches). The approved sample's
// own pieces, class for class. Batch 3 adds a file's name and a bare date set in order inside
// Arabic words, a sentence whose «quoted» names never break, a template filled with pieces of
// markup, and a link's place (a car's code, or a label).
import { Fragment, type ReactNode } from 'react';
import { type FleetFuelCardDto, type FleetFuelLinkPlaceDto } from '@ecms/contracts';
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

/** A card's place on a link — a car's code, or the label a card on no car is known by. */
export const LinkPlace = ({ place }: { place: FleetFuelLinkPlaceDto }): JSX.Element =>
  place.vehicleCode !== null ? (
    <CodeChip code={place.vehicleCode} />
  ) : (
    <span className="inline-flex items-center whitespace-nowrap rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[13px] font-bold text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300">
      {place.label ?? '—'}
    </span>
  );

// A name's Latin tail — its date and extension («4-10-2026.xlsx»).
const TAIL = /[0-9A-Za-z][0-9A-Za-z .\-_()]*$/u;

/**
 * A sheet's file name, written in order. «وطنية 4-10-2026.xlsx» set as plain text in an Arabic
 * line prints «xlsx.2026-10-4 وطنية»: the bidi algorithm turns digits that follow Arabic letters
 * into Arabic numbers, and «-» does not join them, so the date reverses. The Arabic head stays
 * right to left and the tail — the date and the extension — is isolated left to right.
 */
export const FileName = ({
  name,
  className,
}: {
  name: string;
  className?: string;
}): JSX.Element => {
  const at = name.search(TAIL);
  // A Latin name is one left-to-right run already; it needs a box only to carry a look.
  if (at === 0) {
    return className === undefined ? (
      <>{name}</>
    ) : (
      <span dir="ltr" className={className}>
        {name}
      </span>
    );
  }
  return (
    <span dir="rtl" className={className}>
      {at < 0 ? name : name.slice(0, at)}
      {at > 0 && <span dir="ltr">{name.slice(at)}</span>}
    </span>
  );
};

/** A bare «1-11-2026» inside an Arabic sentence, in order. */
export const DateText = ({ text }: { text: string }): JSX.Element => <span dir="ltr">{text}</span>;

/**
 * A sentence whose «quoted» names never break inside: «شُحن اليوم» stays one piece at the end of a
 * line instead of leaving «شُحن» on one line and «اليوم» on the next.
 */
export const KeepQuotes = ({ text }: { text: string }): JSX.Element => (
  <>
    {text.split(/(«[^»]*»)/u).map((piece, i) =>
      piece.startsWith('«') ? (
        <span key={i} className="whitespace-nowrap">
          {piece}
        </span>
      ) : (
        piece
      ),
    )}
  </>
);

/**
 * An i18n template (`t(key)` with no values, its `{{names}}` kept) filled with pieces of markup —
 * a figure in Latin digits, a file name in order — where `t(key, values)` would only take text.
 */
export const Filled = ({
  template,
  values,
}: {
  template: string;
  values: Readonly<Record<string, ReactNode>>;
}): JSX.Element => (
  <>
    {template.split(/(\{\{\w+\}\})/u).map((piece, i) => {
      const name = /^\{\{(\w+)\}\}$/u.exec(piece)?.[1];
      return <Fragment key={i}>{name === undefined ? piece : (values[name] ?? '')}</Fragment>;
    })}
  </>
);
