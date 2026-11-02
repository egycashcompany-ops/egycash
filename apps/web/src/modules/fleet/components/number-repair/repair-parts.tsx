// «تصحيح أرقام الكروت» (6d) — the small pieces of the repair screen, the approved sample's own
// (`zz-6d-parts`), made of the system's: the fuel board's figure face (NUM) and big car-code box,
// the reconcile pages' chips and tags, the board's icons. A card number is only ever its printed
// start and last four («548 •••• 0935»); a PIN is never drawn — only whether one is stored with a
// number, and where it goes.
import { type ReactNode } from 'react';
import {
  type FleetFuelNumberRepairRowState,
  type FleetFuelNumberRepairTopUpDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, NUM, PATH } from '../FuelCardBoard';
import { cairoDayOf } from '../../lib/custody-hold';
import { dayText, money, signed } from '../../lib/fuel-reconcile';
import { N } from '../../lib/fuel-number-repair-words';
import { Filled } from '../fuel-reconcile/reconcile-cells';

/** A circled tick, a circled cross, two arrows that swap, a spanner, a cycle — and the board's own. */
export const ICON = {
  ok: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', 'm8 12 3 3 5-6'],
  no: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', 'm15 9-6 6', 'm9 9 6 6'],
  swap: ['M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4'],
  fix: [
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  ],
  cycle: ['M21 12a9 9 0 1 1-3-6.7', 'M21 4v5h-5'],
  money: [
    'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  ],
  step: ['M13 7l5 5m0 0l-5 5m5-5H6'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z', 'm9 12 2 2 4-4'],
  card: PATH.card,
  lock: PATH.lock,
  warn: PATH.warn,
  excel: PATH.excel,
} as const;

/** «2027/03/31» — a day year first, with slashes. */
export const ymdOf = (day: string): string => dayText(day.slice(0, 10));
/** «2026/10/09» — the Cairo day of an instant. */
export const cairoYmdOf = (iso: string): string => dayText(cairoDayOf(iso));

/** A card number as the owner sees it: its printed start and last four. */
export const Masked = ({
  last4,
  prefix = '548',
  tone = 'plain',
  size = 'md',
}: {
  last4: string;
  prefix?: string;
  tone?: 'plain' | 'struck' | 'after';
  size?: 'sm' | 'md';
}): JSX.Element => (
  <span
    dir="ltr"
    data-repair-number={last4}
    className={cn(
      NUM,
      'inline-block whitespace-nowrap font-bold tracking-wide',
      size === 'sm' ? 'text-[13px]' : 'text-[15px]',
      tone === 'plain' && 'text-slate-900 dark:text-white',
      tone === 'struck' &&
        'text-slate-400 line-through decoration-red-400/80 decoration-2 dark:text-slate-500 dark:decoration-red-400/70',
      tone === 'after' && 'text-emerald-700 dark:text-emerald-300',
    )}
  >
    {prefix} •••• {last4}
  </span>
);

/** «•••• 0935» — the last four alone, in order. */
export const Dots = ({ last4, className }: { last4: string; className?: string }): JSX.Element => (
  <span dir="ltr" className={cn(NUM, 'whitespace-nowrap font-bold', className)}>
    •••• {last4}
  </span>
);

/** The fuel board's big car-code box (`VehicleFuelGroup`), a size down for a row. */
export const CarBox = ({
  code,
  tone = 'emerald',
}: {
  code: string;
  tone?: 'emerald' | 'amber' | 'slate';
}): JSX.Element => (
  <span
    data-repair-car={code}
    className={cn(
      'inline-block rounded-lg border px-3 py-0.5 text-2xl font-black tracking-wider shadow-inner',
      NUM,
      tone === 'emerald' &&
        'border-emerald-300 bg-emerald-500/15 text-emerald-600 dark:border-emerald-500/40 dark:text-emerald-400',
      tone === 'amber' &&
        'border-amber-300 bg-amber-500/15 text-amber-700 dark:border-amber-500/40 dark:text-amber-300',
      tone === 'slate' &&
        'border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
    )}
  >
    {code}
  </span>
);

export type TagTone = 'slate' | 'emerald' | 'amber' | 'indigo' | 'red' | 'violet' | 'cyan';
/** A small tag: «يبقى», «يتغيّر», «التاريخ نفسه». */
export const Tag = ({
  tone,
  children,
  icon,
  ...data
}: {
  tone: TagTone;
  children: ReactNode;
  icon?: readonly string[];
} & Record<`data-${string}`, string>): JSX.Element => (
  <span
    {...data}
    className={cn(
      'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-[11px] font-bold',
      tone === 'slate' &&
        'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
      tone === 'emerald' &&
        'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
      tone === 'amber' &&
        'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
      tone === 'indigo' &&
        'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-400/40 dark:bg-indigo-500/10 dark:text-indigo-200',
      tone === 'red' &&
        'border-red-300 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300',
      tone === 'violet' &&
        'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300',
      tone === 'cyan' &&
        'border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300',
    )}
  >
    {icon !== undefined && <BoardIcon d={icon} className="h-3 w-3" />}
    {children}
  </span>
);

/** The 0849 pair: the number stays, so its PIN stays — never the PIN itself. */
export const PinNote = (): JSX.Element => {
  const t = useT();
  return (
    <Tag tone="indigo" icon={ICON.lock}>
      {t(`${N}pin.stays`)}
    </Tag>
  );
};

/** A car code set bold in the figure face, inside a sentence. */
export const CarCode = ({ code }: { code: string }): JSX.Element => <b className={NUM}>{code}</b>;

/**
 * What happens to the PIN on one crossed record, told from whether a PIN is STORED with each
 * number (yes/no — never the PIN): the right number's PIN comes with it, or there is none and the
 * field is left empty; and the PIN this record holds today leaves with today's number.
 */
export const PinFate = ({
  pinAfter,
  pinBefore,
  numberBefore,
  goesTo,
  done,
}: {
  /** A PIN is stored with the right number. */
  pinAfter: boolean;
  /** A PIN is stored with the number this record holds today. */
  pinBefore: boolean;
  numberBefore: string;
  /** The car whose record takes today's number. */
  goesTo: string;
  done: boolean;
}): JSX.Element => {
  const t = useT();
  return (
    <span className="flex flex-col items-start gap-1" data-repair-pin={pinAfter ? 'moves' : 'none'}>
      {pinAfter ? (
        <Tag tone="indigo" icon={ICON.lock}>
          {t(done ? `${N}pin.moved` : `${N}pin.moves`)}
        </Tag>
      ) : (
        <span className="inline-flex items-start gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-px text-[11px] font-bold leading-snug text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <BoardIcon d={ICON.lock} className="mt-px h-3 w-3 shrink-0" />
          <span>{t(done ? `${N}pin.noneDone` : `${N}pin.none`)}</span>
        </span>
      )}
      {pinBefore ? (
        <span className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          <Filled
            template={t(done ? `${N}pin.went` : `${N}pin.goes`)}
            values={{
              number: <Dots last4={numberBefore} />,
              car: <CarCode code={goesTo} />,
            }}
          />
        </span>
      ) : (
        !done && (
          <span className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            {t(`${N}pin.noneNow`)}
          </span>
        )
      )}
    </span>
  );
};

/** «الآن» / «بعده» (or «كان» / «أصبح» once done) and a value. */
export const BeforeAfter = ({
  done,
  now,
  after,
}: {
  done: boolean;
  now: ReactNode;
  after: ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <span className="inline-grid grid-cols-[2.5rem_auto] items-center gap-x-1.5 gap-y-1">
      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        {t(done ? `${N}was` : `${N}now`)}
      </span>
      <span>{now}</span>
      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        {t(done ? `${N}became` : `${N}after`)}
      </span>
      <span>{after}</span>
    </span>
  );
};

/** A day, struck when it gives way to another. */
export const DateText = ({
  day,
  tone = 'plain',
}: {
  day: string;
  tone?: 'plain' | 'struck' | 'after' | 'same';
}): JSX.Element => (
  <span
    dir="ltr"
    className={cn(
      NUM,
      'whitespace-nowrap text-[14px] font-bold',
      tone === 'plain' && 'text-slate-800 dark:text-slate-200',
      tone === 'same' && 'text-slate-600 dark:text-slate-300',
      tone === 'struck' &&
        'text-slate-400 line-through decoration-red-400/80 decoration-2 dark:text-slate-500',
      tone === 'after' && 'text-emerald-700 dark:text-emerald-300',
    )}
  >
    {ymdOf(day)}
  </span>
);

/** A figure in pounds, Latin digits, two decimals — red when it is below zero. */
export const Money = ({
  value,
  className,
  struck = false,
}: {
  value: number | null;
  className?: string;
  struck?: boolean;
}): JSX.Element => (
  <span
    dir="ltr"
    className={cn(
      NUM,
      'whitespace-nowrap font-bold',
      className,
      value !== null && value < 0 && !struck && '!text-red-600 dark:!text-red-400',
      struck && '!text-slate-400 line-through decoration-2 dark:!text-slate-500',
    )}
  >
    {value === null ? '—' : value < 0 ? `−${money(Math.abs(value))}` : money(value)}
  </span>
);

/** A signed difference: «+11,872.62» / «−11,872.62», green up and red down. */
export const Signed = ({
  value,
  className,
}: {
  value: number;
  className?: string;
}): JSX.Element => (
  <span
    dir="ltr"
    className={cn(
      NUM,
      'whitespace-nowrap font-bold',
      value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
      className,
    )}
  >
    {signed(value)}
  </span>
);

/** One top-up logged on the record: its day and amount — struck when the company sheet cancelled it. */
export const TopUpChip = ({ topUp }: { topUp: FleetFuelNumberRepairTopUpDto }): JSX.Element => {
  const t = useT();
  return (
    <span
      data-repair-topup={topUp.id}
      title={topUp.cancelledBySheet ? t('fleet.fuelCards.history.cancelledBySheet') : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[12px] dark:border-slate-700 dark:bg-[#0b1220]',
        topUp.cancelledBySheet && 'border-dashed opacity-60',
      )}
    >
      <span dir="ltr" className={cn(NUM, 'text-slate-500 dark:text-slate-400')}>
        {cairoYmdOf(topUp.at)}
      </span>
      <span
        dir="ltr"
        className={cn(
          NUM,
          'font-bold text-emerald-700 dark:text-emerald-400',
          topUp.cancelledBySheet && 'line-through',
        )}
      >
        +{money(topUp.amount)}
      </span>
    </span>
  );
};

/** «الفحص الآن»: the live record against the reviewed «before». */
export const StateChip = ({
  state,
  pair = false,
}: {
  state: FleetFuelNumberRepairRowState;
  pair?: boolean;
}): JSX.Element => {
  const t = useT();
  return state === 'ok' ? (
    <Tag tone="emerald" icon={ICON.ok} data-repair-state="ok">
      {t(`${N}state.ok`)}
    </Tag>
  ) : state === 'done' ? (
    <Tag tone="emerald" icon={ICON.ok} data-repair-state="done">
      {t(`${N}state.done`)}
    </Tag>
  ) : state === 'changed' ? (
    <Tag tone="red" icon={ICON.warn} data-repair-state="changed">
      {t(`${N}state.changed`)}
    </Tag>
  ) : (
    <Tag tone="amber" icon={ICON.lock} data-repair-state="held">
      {t(pair ? `${N}state.heldPair` : `${N}state.held`)}
    </Tag>
  );
};

/** An arrow pointing the way an Arabic line reads, with the number it carries over it. */
const Arrow = ({ last4 }: { last4: string }): JSX.Element => (
  <span className="inline-flex flex-col items-center gap-0.5 px-0.5">
    <Dots last4={last4} className="text-[11px] text-slate-600 dark:text-slate-300" />
    <svg
      viewBox="0 0 64 10"
      className="h-2.5 w-12 text-slate-400 sm:w-16 dark:text-slate-500"
      aria-hidden
    >
      <path
        d="M62 5H4m0 0l5-4M4 5l5 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  </span>
);

/**
 * The cycle, drawn as it reads: each car's record holds the number of the next car's card; the
 * last holds the first's, so the line comes back to where it began.
 */
export const Chain = ({
  cars,
  held,
  stopped,
}: {
  cars: readonly string[];
  /** The last four each record holds before the repair, in the order of `cars`. */
  held: readonly string[];
  /** The cars whose records changed — their boxes in red. */
  stopped: readonly string[];
}): JSX.Element => {
  const t = useT();
  return (
    <span className="flex flex-wrap items-center gap-y-2" data-repair-chain={cars.join('-')}>
      {cars.map((car, i) => (
        <span key={car} className="inline-flex items-center">
          <span
            className={cn(
              'inline-flex min-w-[3rem] justify-center rounded-lg border px-2 py-1 text-lg font-black shadow-inner',
              NUM,
              stopped.includes(car)
                ? 'border-red-300 bg-red-500/10 text-red-700 dark:border-red-500/50 dark:text-red-300'
                : 'border-emerald-300 bg-emerald-500/15 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300',
            )}
          >
            {car}
          </span>
          <Arrow last4={held[i] ?? ''} />
        </span>
      ))}
      <span
        className={cn(
          'inline-flex min-w-[3rem] justify-center rounded-lg border border-dashed border-emerald-400 px-2 py-1 text-lg font-black text-emerald-700/70 dark:border-emerald-500/50 dark:text-emerald-300/70',
          NUM,
        )}
        title={t(`${N}cycle.backToStart`)}
      >
        {cars[0]}
      </span>
    </span>
  );
};
