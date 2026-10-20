// The small pieces «المذكرات», «سجل العهدة», the memo editor and the fund's three dialogs share —
// each one the app's own look, defined ONCE here so no screen copies another's: the boards' figure
// and money, the licensing board's round «علامة صح», the Fleet forms' tables, the custody kinds'
// pale pill, the licence editor's print button, the status chips «تمت الاستعاضة ✓ …» / «لم تُستعَض
// بعد», and a memo's name — the one he typed, or «مذكرة <النوع> رقم N» in muted ink when he typed
// none. The name lives in the app only: no paper prints it.
//
// Every word is an i18n key; numbers are Latin, as on every board.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { type FleetCustodyMemoRowDto, type FleetCustodySource, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { formatMoneyParts } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { CheckIcon } from '../../../shared/ui/icons';
import { Spinner } from '../../../shared/ui/Spinner';
import { CUSTODY_KIND } from './CustodyKinds';
import { BoardIcon, NUM, PATH, ymd } from './FuelCardBoard';
import { Stroke } from './FuelCardDialog';
import { CAIRO } from './custody-dashboard-parts';
import { PILL_BUTTON, PILL_FRAME } from './custody-board-looks';

// ── Looks ──────────────────────────────────────────────────────────────────────────────────────

/** Every filter is `density="tight"`, as on the vehicles board. */
export const TIGHT = 'tight' as const;
/** The boards' figure: monospace, tabular, never broken over two lines. */
export const FIGURE = cn('whitespace-nowrap', NUM);
export const MUTED_INK = 'text-slate-500 dark:text-slate-400';
/** A count in a round slate badge — «عدد الإيصالات» in the memos' table. */
export const COUNT_BADGE =
  'inline-flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-full bg-slate-200 px-2 text-[14px] leading-none text-slate-700 dark:bg-slate-700 dark:text-slate-100';
/** A memo's number — the boards' code chip, a size up. */
export const MEMO_NO =
  'inline-flex h-8 min-w-[2.25rem] items-center justify-center whitespace-nowrap rounded-lg border border-slate-300 bg-slate-50 px-2 text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white';
/** The round tick of «التراخيص» — «علامة صح», pressed. */
export const TICK_ON =
  'mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md shadow-emerald-700/30';
/** A phone's card — one memo, one operation. */
export const PHONE_CARD =
  'rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-[#1c293f] dark:bg-[#0d1424]';
/** A fact over a paper's preview — its kind, its number, its period, its total. */
export const FACT_CHIP = cn(
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-bold leading-5',
  'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700/70 dark:bg-[#142135] dark:font-semibold dark:text-slate-300',
);

/**
 * The status pair: done in emerald — the tick of «التراخيص» — and waiting in amber. Words in Cairo
 * with its own spaces: in a table cell they would take the figure face's monospace gap («تمت
 * الاستعاضة» set wide); the date keeps the figures' face (`NUM`).
 */
const STATUS_CHIP = cn(
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-bold leading-5',
  CAIRO,
);
export const DONE_CHIP = cn(
  STATUS_CHIP,
  'border-emerald-300 bg-emerald-50 text-emerald-800 transition hover:brightness-95 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:font-semibold dark:text-emerald-400',
);
/** Amber — its own expression, never inside a row action's `className`. */
export const WAIT_CHIP = cn(
  STATUS_CHIP,
  'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:font-semibold dark:text-amber-400',
);

/** A memo — a page with lines. */
export const MEMO_ICON: readonly string[] = [
  'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
];
/** The fund's history — a clock turned back. */
export const HISTORY_ICON: readonly string[] = [
  'M3 12a9 9 0 1 0 3-6.7L3 8',
  'M3 3v5h5',
  'M12 7v5l3 2',
];
/** The receipts' own look — what the fund paid, no operation of its own. */
export const RECEIPT_ICON: readonly string[] = [
  'M9 14l2 2 4-4',
  'M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16l-3-2-2 2-2-2-2 2-2-2-3 2z',
];
/** The receipts' slate, beside the fund's three actions' own tones (`CUSTODY_OPS`). */
export const SPEND_LOOK = {
  chip: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
  tile: 'border border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-300',
  accent: 'border-l-4 border-l-slate-400 hover:border-l-slate-400 dark:border-l-slate-500',
} as const;

/** A table in the Fleet forms' design: the design's tile, its head a step darker. */
export const FORM_TABLE_WRAP =
  'overflow-x-auto rounded-xl border border-slate-200 dark:border-[#2b3b6b]';
export const FORM_TABLE = 'w-full border-collapse text-center';
export const FORM_THEAD =
  'bg-slate-100 text-xs font-bold text-slate-600 sm:text-[13px] dark:bg-[#0f1838] dark:text-slate-300 [&_th]:whitespace-nowrap [&_th]:px-1.5 [&_th]:py-2.5 sm:[&_th]:px-2.5';
export const FORM_TBODY =
  'divide-y divide-slate-200 bg-white dark:divide-[#2b3b6b]/70 dark:bg-[#0a1233]/80 [&_td]:px-1.5 [&_td]:py-2 [&_td]:text-[13px] [&_td]:font-bold [&_td]:text-slate-800 sm:[&_td]:px-2.5 sm:[&_td]:text-sm dark:[&_td]:text-slate-200';
/** A picked row: the tick's emerald, faint. */
export const PICKED_ROW = 'bg-emerald-50/80 dark:bg-emerald-500/[0.07]';
/** A row left out: its words a step quieter. */
export const LEFT_ROW = '[&_td]:!text-slate-500 dark:[&_td]:!text-slate-400';

const useLocale = (): Locale => useAppSelector((state): Locale => state.locale.locale);

// ── Status chips ───────────────────────────────────────────────────────────────────────────────

/**
 * «تمت الاستعاضة ✓ 2026/09/29» / «تمت التسوية ✓ 2026/10/05» — a way to the operation itself when
 * `to` is given (the reader may open «سجل العهدة»), the same chip with no link otherwise.
 */
export const DoneChip = ({
  label,
  date,
  to,
  title,
  mark,
}: {
  label: string;
  /** YYYY-MM-DD (a longer ISO string is cut to its day). */
  date: string;
  to: string | null;
  title: string;
  mark: string;
}): JSX.Element => {
  const inside = (
    <>
      {label} ✓
      <span dir="ltr" className={cn(NUM, 'font-semibold opacity-80')}>
        {ymd(date)}
      </span>
    </>
  );
  return to === null ? (
    <span title={title} data-status={mark} className={DONE_CHIP}>
      {inside}
    </span>
  ) : (
    <Link to={to} title={title} data-status={mark} className={DONE_CHIP}>
      {inside}
    </Link>
  );
};

/** «لم تُستعَض بعد» / «لم تُسوَّ بعد» — waiting, in amber, with its dot. */
export const WaitChip = ({ label, mark }: { label: string; mark: string }): JSX.Element => (
  <span data-status={mark} className={WAIT_CHIP}>
    <i aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
    {label}
  </span>
);

// ── A memo's name and status ───────────────────────────────────────────────────────────────────

type NamedMemo = Pick<FleetCustodyMemoRowDto, 'name' | 'kind' | 'no'>;
type Translate = (key: string, params?: Record<string, string | number>) => string;

/** True when he saved the memo without typing a name. */
export const isUnnamedMemo = (memo: Pick<FleetCustodyMemoRowDto, 'name'>): boolean =>
  memo.name.trim() === '';

/**
 * What the screens call a memo: the name he typed, else «مذكرة كاوتش رقم 7». A dialog's title, the
 * print window's title before his paper's own, a row read aloud.
 */
export const memoDisplayName = (memo: NamedMemo, t: Translate): string =>
  isUnnamedMemo(memo)
    ? t('fleet.custody.parts.memoFallback', {
        kind: t(`fleet.custody.source.${memo.kind}`),
        no: memo.no,
      })
    : memo.name.trim();

/**
 * «اسم المذكرة» — the name he typed; a memo saved without one reads «مذكرة <النوع> رقم N», muted,
 * so no cell is ever empty. Words, so Cairo with its own spaces. In a table (`boxed`) a long name
 * folds onto a second line, evenly, instead of widening the table; a dash stays on the line of the
 * word before it.
 */
export const MemoName = ({
  memo,
  boxed = false,
}: {
  memo: NamedMemo;
  boxed?: boolean;
}): JSX.Element => {
  const t = useT();
  const unnamed = isUnnamedMemo(memo);
  const text = memoDisplayName(memo, t);
  return (
    <span
      data-memo-name={unnamed ? 'fallback' : 'typed'}
      title={unnamed ? t('fleet.custody.parts.unnamed') : text}
      className={cn(
        'text-[15px] leading-[18px]',
        unnamed
          ? 'font-normal text-slate-400 [&&]:!font-normal dark:text-slate-500'
          : 'text-slate-900 dark:text-white',
        CAIRO,
        boxed ? 'mx-auto block max-w-[16rem] text-balance' : 'inline',
      )}
    >
      {text.replace(/ ([-–—])/gu, ' $1')}
    </span>
  );
};

/** The memo's status: waiting, or replenished on its day — a link to that «استعاضة» in the log. */
export const MemoStatus = ({
  memo,
}: {
  memo: Pick<FleetCustodyMemoRowDto, 'replenishment'>;
}): JSX.Element => {
  const t = useT();
  return memo.replenishment === null ? (
    <WaitChip label={t('fleet.custody.parts.status.pending')} mark="memo-pending" />
  ) : (
    <DoneChip
      label={t('fleet.custody.parts.status.replenished')}
      date={memo.replenishment.date}
      to={`/fleet/custody/log?open=${encodeURIComponent(memo.replenishment.id)}`}
      title={t('fleet.custody.parts.status.open')}
      mark="memo-replenished"
    />
  );
};

// ── Figures ────────────────────────────────────────────────────────────────────────────────────

/**
 * «1,690.00 ج.م.» — the figure in the boards' monospace, the currency beside it. `ink` colours both
 * (else the figure black, the currency muted); `big` sets the figure a size up; `unit={false}` drops
 * the currency, `unit="wide"` shows it only from a tablet up — a phone's table keeps the room for
 * the figure. `small` is the Fleet forms' currency (12px, semibold).
 */
export const Money = ({
  value,
  ink,
  big = false,
  className,
  unit = true,
  small = false,
}: {
  value: number;
  ink?: string | undefined;
  big?: boolean;
  className?: string | undefined;
  unit?: boolean | 'wide';
  small?: boolean;
}): JSX.Element => {
  const { figure, currency } = formatMoneyParts(value, 'EGP', useLocale());
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1 whitespace-nowrap',
        ink ?? 'text-slate-900 dark:text-white',
      )}
    >
      <span dir="ltr" className={cn(FIGURE, big && 'text-lg', className)}>
        {figure}
      </span>
      {unit !== false && (
        <span
          className={cn(
            small ? 'text-xs font-semibold' : 'text-sm',
            ink ?? MUTED_INK,
            unit === 'wide' && 'hidden sm:inline',
          )}
        >
          {currency}
        </span>
      )}
    </span>
  );
};

/** «+100,000.00» emerald, «−124,139.46» red — a ledger's signed amount, left to right. */
export const Signed = ({ value }: { value: number }): JSX.Element => {
  const { figure, currency } = formatMoneyParts(Math.abs(value), 'EGP', useLocale());
  const up = value >= 0;
  return (
    <span
      data-ledger-amount={up ? 'in' : 'out'}
      className={cn(
        'inline-flex items-baseline gap-1 whitespace-nowrap',
        up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
      )}
    >
      <span dir="ltr" className={FIGURE}>
        {up ? '+' : '−'}
        {figure}
      </span>
      <span className="text-sm">{currency}</span>
    </span>
  );
};

/**
 * A period, year first — «2026/09/01 إلى 2026/09/30». `stack`: two lines, so a wide table keeps
 * its room (the ledger's receipts line draws its period the same way).
 */
export const Dates = ({
  from,
  to,
  stack = false,
}: {
  from: string;
  to: string;
  stack?: boolean;
}): JSX.Element => {
  const t = useT();
  const day = (value: string): JSX.Element => (
    <span dir="ltr" className={cn(FIGURE, 'text-slate-700 dark:text-slate-200')}>
      {ymd(value)}
    </span>
  );
  return stack ? (
    <span data-dates="stack" className="inline-flex flex-col items-center leading-[18px]">
      {day(from)}
      <span className="whitespace-nowrap">
        <span className={cn('text-xs text-slate-400', CAIRO)}>{t('fleet.custody.parts.to')} </span>
        {day(to)}
      </span>
    </span>
  ) : (
    <span data-dates="line" className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {day(from)}
      <span className="text-xs text-slate-400">{t('fleet.custody.parts.to')}</span>
      {day(to)}
    </span>
  );
};

/** A date, year first, in the figure face and muted, as «كل الحركات» writes it. */
export const Day = ({ day }: { day: string }): JSX.Element => (
  <span dir="ltr" className={cn(FIGURE, 'text-slate-600 dark:text-slate-300')}>
    {ymd(day)}
  </span>
);

/** The car's code — the movements log's slate chip, in the form's surfaces. */
export const CodeChip = ({ code }: { code: string }): JSX.Element => (
  <span
    dir="ltr"
    className={cn(
      'inline-flex min-w-[2.25rem] items-center justify-center whitespace-nowrap rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-900 sm:text-[15px] dark:border-[#2b3b6b] dark:bg-[#121c3f] dark:text-white',
      /^\d+$/u.test(code) ? NUM : '',
    )}
  >
    {code}
  </span>
);

/** The custody kind's pale pill with its dot — `CustodyKindBadge` a size down, for forms. */
export const KindPill = ({
  kind,
  label,
}: {
  kind: FleetCustodySource;
  /** Its own words; the kind's name by default. */
  label?: string;
}): JSX.Element => {
  const t = useT();
  return (
    <span
      data-custody-kind={kind}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm leading-5',
        CUSTODY_KIND[kind].badge,
      )}
    >
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', CUSTODY_KIND[kind].dot)} />
      {label ?? t(`fleet.custody.source.${kind}`)}
    </span>
  );
};

// ── Ticks and form pieces ──────────────────────────────────────────────────────────────────────

/**
 * «علامة صح» — the licensing board's round tick: emerald and ticked once picked, an empty dashed
 * ring until then. A head's «الكل» shows a dash while only some are picked (`partly`,
 * `aria-checked="mixed"`).
 */
export const Tick = ({
  on,
  partly = false,
  onClick,
  label,
  disabled = false,
  ...rest
}: {
  on: boolean;
  partly?: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
} & Record<`data-${string}`, string>): JSX.Element => (
  <button
    type="button"
    role="checkbox"
    aria-checked={partly && !on ? 'mixed' : on}
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    {...rest}
    className={cn(
      'mx-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 active:scale-90 disabled:cursor-not-allowed disabled:opacity-50',
      on
        ? 'bg-emerald-500 text-white shadow-md shadow-emerald-700/30 hover:bg-emerald-400'
        : partly
          ? 'bg-emerald-500/15 text-emerald-600 ring-2 ring-inset ring-emerald-500/60 dark:text-emerald-400'
          : 'border-2 border-dashed border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500 dark:border-slate-500',
    )}
  >
    {partly && !on ? (
      <span className="h-[3px] w-3 rounded-full bg-current" />
    ) : (
      <CheckIcon className="h-4 w-4 stroke-[3]" />
    )}
  </button>
);

/** A count chip beside a section's title — the custody board's slate chip. */
export const CountChip = ({ children }: { children: ReactNode }): JSX.Element => (
  <span className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 dark:border-[#2b3b6b] dark:bg-[#0a1233] dark:text-slate-300">
    {children}
  </span>
);

/** A section's heading with something at its far end — `DesignSection`'s rule and drawing. */
export const SectionHead = ({
  title,
  icon,
  end,
}: {
  title: string;
  icon: readonly string[];
  end?: ReactNode;
}): JSX.Element => (
  <h3 className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2 text-[15px] font-bold text-slate-900 dark:border-[#2b3b6b]/60 dark:text-white">
    <span className="flex items-center gap-2">
      <Stroke d={[...icon]} className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
      {title}
    </span>
    {end}
  </h3>
);

/**
 * The licence editor's print button: the brand gradient with the sheet's drawing. `busy` while its
 * save or its paper is on the way — dimmed, a spinner for the drawing, and not pressable twice (a
 * second press of «حفظ وطباعة» must never save twice).
 */
export const PrintButton = ({
  label,
  onClick,
  busy = false,
  disabled = false,
  className,
  ...rest
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  /** Nothing to print. */
  disabled?: boolean;
  className?: string;
} & Record<`data-${string}`, string>): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy || disabled}
    aria-busy={busy || undefined}
    {...rest}
    className={cn(
      'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-gradient-to-r from-brand-700 to-brand-500 px-5 py-2.5 text-[15px] font-bold text-white shadow-md shadow-brand-700/30 transition-all hover:from-brand-600 hover:to-brand-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100',
      className,
    )}
  >
    {busy ? <Spinner className="h-4 w-4" /> : <BoardIcon d={PATH.pdf} className="h-4 w-4" />}
    {label}
  </button>
);

/**
 * The Excel / PDF pair of a custody tab's toolbar — the board's own pair, framed as the fund's three
 * actions are. The pressed one spins while its rows are gathered; both rest meanwhile.
 */
export const ExportPill = ({
  name,
  exporting,
  onExcel,
  onPdf,
}: {
  /** `data-export` / `data-print`: «custody-memos», «custody-ledger». */
  name: string;
  exporting: 'excel' | 'pdf' | null;
  onExcel: () => void;
  onPdf: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div className={PILL_FRAME}>
      <button
        type="button"
        data-export={name}
        title={t('fleet.export.excel')}
        disabled={exporting !== null}
        onClick={onExcel}
        className={cn(
          PILL_BUTTON,
          'hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300',
        )}
      >
        {exporting === 'excel' ? (
          <Spinner className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <BoardIcon
            d={PATH.excel}
            className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
          />
        )}
        <span className="sm:hidden">Excel</span>
        <span className="hidden sm:inline">{t('fleet.fuelCards.board.excel')}</span>
      </button>
      <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
      <button
        type="button"
        data-print={name}
        title={t('common.print')}
        disabled={exporting !== null}
        onClick={onPdf}
        className={cn(
          PILL_BUTTON,
          'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400',
        )}
      >
        {exporting === 'pdf' ? (
          <Spinner className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
        ) : (
          <BoardIcon d={PATH.pdf} className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
        )}
        <span className="sm:hidden">PDF</span>
        <span className="hidden sm:inline">{t('fleet.fuelCards.board.pdf')}</span>
      </button>
    </div>
  );
};
