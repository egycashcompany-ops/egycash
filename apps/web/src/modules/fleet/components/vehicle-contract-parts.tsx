// «عقود توريد السيارات» — the pieces the list and the contract's page share, ported from the
// owner's approved samples (`zz-contracts-list-*`): the drawings, the alarm's colours, its cell and
// its strip, the «19 من 33» received cell, the makes' chips and the money cell. The contract page's own pieces
// are in `vehicle-contract-record-parts.tsx`.
//
// Every figure here is the server's (`FleetVehicleContractDto`): received, remaining, the totals and
// the alarm (its level and days) are never worked out again in the browser.
import {
  type FleetSupplyAlarmDto,
  type FleetSupplyAlarmLevel,
  type FleetVehicleContractDto,
  type FleetVehicleContractLineDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { formatMoneyParts, localized } from '../../../shared/lib/format';
import {
  latin,
  phraseText,
  useVehicleContractWords,
  type Phrase,
} from '../lib/vehicle-contract-words';
import { pct } from '../lib/vehicle-contract-figures';
import { AlarmBadge, alarmRowTint } from './AlarmBadge';
import { BOARD_FONT as CAIRO, BoardIcon, NUM, PATH, ymd } from './FuelCardBoard';

export const FIGURE = cn('whitespace-nowrap', NUM);
export const DASH = <span className="text-slate-400 dark:text-slate-500">—</span>;

// ── Drawings ─────────────────────────────────────────────────────────────────────────────────────

/** A contract — a page with lines and a seal. */
export const CONTRACT_ICON: readonly string[] = [
  'M9 12h6m-6 4h3m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  'M13 3v5a1 1 0 001 1h5',
];
/** «تسجيل استلام» — a box with an arrow going down into it. */
export const RECEIVE_ICON: readonly string[] = [
  'M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6',
  'M4 13h4l1.5 3h5L16 13h4v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5z',
  'M12 2v8m0 0l-3-3m3 3l3-3',
];
/** A paper clip — the attachments. */
export const CLIP_ICON: readonly string[] = [
  'M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13',
];
/** «المتبقي» — a clock: what has not arrived yet, not a warning. */
export const CLOCK_ICON: readonly string[] = ['M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'];
/** «آخر موعد للتوريد» — the calendar with its last day ticked: a date, not a countdown. */
export const DEADLINE_ICON: readonly string[] = [
  'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  'M9.5 16l1.75 1.75L14.5 14.5',
];
export const SUPPLIER_ICON: readonly string[] = [
  'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9',
];
export const NAME_ICON: readonly string[] = [
  'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
];
export const LINES_ICON: readonly string[] = ['M4 6h16M4 12h16M4 18h10'];
export const INFO_ICON: readonly string[] = [
  'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
];

// ── The alarm ───────────────────────────────────────────────────────────────────────────────────

/**
 * The distance's colour on the alarms board (`AlarmBadge`'s `REMAINING_TONE`) — saturated, and dark
 * enough in the light theme to read on a tinted row.
 */
export const ALARM_INK: Record<FleetSupplyAlarmLevel, string> = {
  red: 'text-red-700 dark:text-red-400',
  yellow: 'text-amber-800 dark:text-amber-400',
};

/** A phrase with its figure in the boards' monospace, left to right — «بعد <5> أيام». */
export const PhraseText = ({
  phrase,
  figureClassName,
}: {
  phrase: Phrase;
  figureClassName?: string;
}): JSX.Element => (
  <>
    {phrase.before}
    {phrase.figure !== null && (
      <span dir="ltr" className={cn(FIGURE, figureClassName)}>
        {phrase.figure}
      </span>
    )}
    {phrase.after}
  </>
);

/**
 * «إنذار التوريد» in the list: the alarms board's solid pill and, under it, when the last date falls
 * («بعد 5 أيام» / «متأخر 9 أيام»). How many cars are left is the column beside it, so it is said
 * here only in the cell's tooltip, with the whole sentence.
 */
export const SupplyAlarmCell = ({ alarm }: { alarm: FleetSupplyAlarmDto | null }): JSX.Element => {
  const words = useVehicleContractWords();
  if (alarm === null) return DASH;
  const title = `${phraseText(words.leftHead(alarm.left))} — ${phraseText(words.deadline(alarm.days))}`;
  return (
    <span
      className="mx-auto inline-flex flex-col items-center gap-1 whitespace-nowrap"
      data-supply-alarm={alarm.level}
      data-supply-days={alarm.days}
      title={title}
    >
      <AlarmBadge level={alarm.level} variant="solid" />
      <span
        className={cn('text-[14px] leading-[18px]', CAIRO, ALARM_INK[alarm.level])}
        data-supply-when="true"
      >
        <PhraseText phrase={words.days(alarm.days)} figureClassName="text-[15px]" />
      </span>
    </span>
  );
};

/** The make's name, as the contract keeps it (still shown for a make deactivated since). */
export const useMakeName = (): ((
  line: Pick<FleetVehicleContractLineDto, 'typeName'>,
) => string) => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (line) => (line.typeName === null ? '—' : localized(line.typeName, locale));
};

/** The strip's frame in each level: the row tint, a firmer edge, the solid colour at its start. */
const ALARM_EDGE: Record<FleetSupplyAlarmLevel, string> = {
  red: 'border-red-300 border-s-red-600 dark:border-red-500/40 dark:border-s-red-500',
  yellow: 'border-amber-300 border-s-amber-500 dark:border-amber-400/35 dark:border-s-amber-400',
};
/** The warning sign's box — the solid pill's own paint. */
const ALARM_SIGN: Record<FleetSupplyAlarmLevel, string> = {
  red: 'bg-red-600 text-white shadow-md shadow-red-700/30',
  yellow: 'bg-amber-400 text-amber-950 shadow-md shadow-amber-600/25',
};

/**
 * «إنذار التوريد» on the contract's page — «المتبقي سيارة واحدة — آخر موعد للتوريد بعد 5 أيام», what is
 * left of each make («مرسيدس اسبرانتر 516 — المتبقي 1 من 22»), and the last date at the strip's end.
 */
export const SupplyAlarmStrip = ({
  contract,
  alarm,
}: {
  contract: Pick<FleetVehicleContractDto, 'lines' | 'deadline'>;
  alarm: FleetSupplyAlarmDto;
}): JSX.Element => {
  const t = useT();
  const words = useVehicleContractWords();
  const makeName = useMakeName();
  return (
    <section
      role="alert"
      data-contract-alarm={alarm.level}
      className={cn(
        'flex flex-wrap items-center gap-4 rounded-2xl border border-s-[6px] px-5 py-4 sm:flex-nowrap',
        alarmRowTint(alarm.level),
        ALARM_EDGE[alarm.level],
      )}
    >
      <span className={cn('shrink-0 rounded-xl p-3', ALARM_SIGN[alarm.level])}>
        <BoardIcon d={PATH.warn} className="h-6 w-6" width={2.2} />
      </span>
      <div className="min-w-[13rem] flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[14px] font-bold text-slate-800 dark:text-slate-100">
            {t('fleet.vehicleContracts.alarm.title')}
          </span>
          <AlarmBadge level={alarm.level} variant="solid" />
        </div>
        <p
          className="text-[18px] font-black leading-7 text-slate-900 dark:text-white"
          data-contract-alarm-text="true"
        >
          <PhraseText phrase={words.leftHead(alarm.left)} figureClassName="text-[19px]" />
          <span className="mx-2 text-slate-500 dark:text-slate-400">—</span>
          <span className={ALARM_INK[alarm.level]}>
            <PhraseText phrase={words.deadline(alarm.days)} figureClassName="text-[19px]" />
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {alarm.lines.map(({ lineId, left }) => {
            const line = contract.lines.find((each) => each.id === lineId);
            if (line === undefined) return null;
            return (
              <span
                key={lineId}
                data-contract-alarm-line={lineId}
                className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-white/85 sm:flex-nowrap sm:whitespace-nowrap py-1 pe-1.5 ps-2.5 text-[13.5px] font-bold text-slate-900 shadow-sm dark:border-white/15 dark:bg-[#0a1233]/70 dark:text-white"
              >
                <BoardIcon d={PATH.truck} className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                {makeName(line)}
                <span className="inline-flex items-baseline gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[12px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                  {t('fleet.vehicleContracts.figure.remaining')}
                  <span dir="ltr" className={cn(FIGURE, 'text-[14px]', ALARM_INK[alarm.level])}>
                    {latin(left)}
                  </span>
                  {t('fleet.vehicleContracts.of')}
                  <span dir="ltr" className={cn(FIGURE, 'text-slate-700 dark:text-slate-200')}>
                    {latin(line.count)}
                  </span>
                </span>
              </span>
            );
          })}
        </div>
      </div>
      {contract.deadline !== null && (
        <div className="shrink-0 rounded-xl border border-slate-300/80 bg-white/85 px-5 py-2.5 text-center shadow-sm dark:border-white/15 dark:bg-[#0a1233]/70">
          <span className="block text-[12px] font-semibold text-slate-500 dark:text-slate-400">
            {t('fleet.vehicleContracts.fact.deadline')}
          </span>
          <span
            dir="ltr"
            className={cn(
              FIGURE,
              'mt-0.5 block text-[20px] font-black text-slate-900 dark:text-white',
            )}
          >
            {ymd(contract.deadline)}
          </span>
        </div>
      )}
    </section>
  );
};

// ── The list's cells ─────────────────────────────────────────────────────────────────────────────

/** «19 من 33» over its bar — emerald once all arrived, slate while none has. */
export const ReceivedCell = ({
  contract,
}: {
  contract: Pick<FleetVehicleContractDto, 'id' | 'received' | 'contracted' | 'remaining' | 'alarm'>;
}): JSX.Element => {
  const t = useT();
  const { received: got, contracted: all, alarm } = contract;
  const share = pct(got, all);
  const done = got >= all;
  const none = got === 0;
  return (
    <span
      className="mx-auto inline-flex w-[8.75rem] flex-col items-stretch gap-1"
      data-contract-received={contract.id}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="inline-flex items-baseline gap-1.5">
          <span
            dir="ltr"
            className={cn(
              FIGURE,
              'text-[17px]',
              done
                ? 'text-emerald-700 dark:text-emerald-400'
                : none
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-slate-900 dark:text-white',
            )}
          >
            {latin(got)}
          </span>
          <span className={cn('text-xs text-slate-500 dark:text-slate-400', CAIRO)}>
            {t('fleet.vehicleContracts.of')}
          </span>
          <span dir="ltr" className={cn(FIGURE, 'text-slate-700 dark:text-slate-200')}>
            {latin(all)}
          </span>
        </span>
        <span
          dir="ltr"
          className={cn(
            FIGURE,
            'rounded px-1 text-[11px] leading-4',
            done
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-slate-200/80 text-slate-600 dark:bg-slate-700/70 dark:text-slate-300',
          )}
        >
          {share}%
        </span>
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-[#1c2740]">
        <span
          className={cn(
            'block h-full rounded-full',
            done ? 'bg-emerald-500' : 'bg-gradient-to-l from-brand-400 to-brand-600',
          )}
          style={{ width: `${share}%` }}
        />
      </span>
      {/* On a row with «إنذار التوريد», what is left is written in the alarm's colour. */}
      <span
        className={cn(
          'text-start text-[12px] leading-4',
          CAIRO,
          done
            ? 'text-emerald-700 dark:text-emerald-400'
            : alarm !== null
              ? ALARM_INK[alarm.level]
              : 'text-slate-500 dark:text-slate-400',
        )}
      >
        {done
          ? `${t('fleet.vehicleContracts.fullyReceived')} ✓`
          : none
            ? t('fleet.vehicleContracts.nothingYet')
            : t('fleet.vehicleContracts.remaining', { n: latin(contract.remaining) })}
      </span>
    </span>
  );
};

/** A line of the contract — its make (the licence board's code chip) and how many after «×». */
const MAKE_CHIP =
  'flex items-center justify-between gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-slate-50 py-1 pe-1 ps-2 text-[13.5px] leading-5 text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white';
const MAKE_COUNT =
  'inline-flex h-[18px] min-w-[1.5rem] items-center justify-center rounded bg-slate-200 px-1 text-[12px] leading-none text-slate-700 dark:bg-slate-700 dark:text-slate-100';

export const MakeChips = ({
  lines,
}: {
  lines: readonly FleetVehicleContractLineDto[];
}): JSX.Element => {
  const makeName = useMakeName();
  return (
    <span className="mx-auto flex w-max min-w-[9.5rem] max-w-[17rem] flex-col items-stretch gap-1">
      {lines.map((line) => (
        <span
          key={line.id}
          className={MAKE_CHIP}
          title={makeName(line)}
          data-contract-make={line.id}
        >
          <span className={cn(CAIRO, 'min-w-0 truncate text-[13.5px]')}>{makeName(line)}</span>
          <span dir="ltr" className={cn(NUM, MAKE_COUNT)}>
            ×{latin(line.count)}
          </span>
        </span>
      ))}
    </span>
  );
};

/** «162,800,000.00 ج.م.» — the licence board's money cell. */
export const MoneyCell = ({
  value,
  strong = false,
}: {
  value: number;
  strong?: boolean;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { figure, currency } = formatMoneyParts(value, 'EGP', locale);
  return (
    // `gap-1.5`: the board's table squeezes every `.gap-1` in a cell to 2px.
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5',
        strong && 'text-slate-900 dark:text-white',
      )}
    >
      <span className={FIGURE}>{figure}</span>
      <span className="text-sm text-slate-500 dark:text-slate-400">{currency}</span>
    </span>
  );
};
