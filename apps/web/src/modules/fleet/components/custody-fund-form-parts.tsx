// What the fund's three dialogs — «استعاضة العهدة», «تسوية العهدة», «شحن العهدة» — share, in the
// Fleet forms' design: the letter's date and period, «إجمالي العهدة» before and after, the row of
// buttons, and the one way an operation is sent.
//
// ONE OPERATION PER PRESS. A charge has nothing to collide on — a second «حفظ» would record a
// second «شحن العهدة» — so every press goes through `useFundOperation`: an in-flight ref refuses a
// second press before the first has answered, and both Save buttons wear `busy` (a spinner, not
// pressable) while it is on its way. «… وطباعة الخطاب» opens the print tab FIRST, inside the click
// (a popup blocker refuses a tab opened after an await), then records the operation and prints the
// letter the SERVER recorded — its bracket figure and its names.
//
// A refusal says which: a memo replenished or a licence part settled meanwhile (409), or gone
// (404), is named in words and the dialog's list is read again; anything else keeps its usual
// message.
import { useRef, useState, type ReactNode } from 'react';
import {
  type FleetCustodyLetter,
  type FleetCustodyOperationDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { formatMoneyParts } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import {
  letterFileName,
  letterPaperOf,
  letterSheets,
  printPaperAfter,
} from '../lib/custody-papers';
import { fundRefusalOf, periodInOrder, type LetterHead } from '../lib/custody-fund-forms';
import { DesignField, LOOK, MONO, boxTone } from './FuelCardDialog';

const BOX = boxTone(LOOK.add);
/** A date box in the design — the figures' face. */
export const DATE_BOX = cn(BOX, MONO);
/** «المبلغ» — the figures' face, read from the right like every amount box. */
export const AMOUNT_BOX = cn(BOX, MONO, 'text-right');

const useLocale = (): Locale => useAppSelector((state): Locale => state.locale.locale);

/** A figure as the dialogs write it — grouped, two decimals, «−» before a negative one. */
export const useFigure = (): ((value: number) => string) => {
  const locale = useLocale();
  return (value) => {
    const { figure } = formatMoneyParts(Math.abs(value), 'EGP', locale);
    return value < 0 ? `−${figure}` : figure;
  };
};

/**
 * A sentence with its figures in the figures' face — «سيُضاف إلى العهدة: 81,908.00 — إجمالي العهدة
 * بعدها 99,400.00»: the i18n template is filled with markers, then each marker becomes its figure.
 */
export const useFigureLine = (): ((
  key: string,
  figures: Record<string, string>,
  words?: Record<string, string>,
) => ReactNode) => {
  const t = useT();
  return (key, figures, words = {}) => {
    const names = Object.keys(figures);
    // `words` (a kind's name…) go in as they are; only the figures are set apart.
    const marked = t(key, {
      ...words,
      ...Object.fromEntries(names.map((name, i) => [name, `\uE000${i}\uE001`])),
    });
    return marked.split(/\uE000(\d+)\uE001/u).map((part, index) =>
      index % 2 === 1 ? (
        <span key={index} dir="ltr" className={MONO}>
          {figures[names[Number(part)] ?? ''] ?? ''}
        </span>
      ) : (
        part
      ),
    );
  };
};

/**
 * «بيانات الخطاب» — the letter's date and the period it covers. The period follows what is picked
 * (`letterPeriod`) until a box is typed in; an emptied box is left out of the request and the
 * server writes its own default.
 */
export const LetterFields = ({
  date,
  from,
  to,
  onChange,
  periodMissing = false,
}: {
  date: string;
  from: string;
  to: string;
  onChange: (patch: Partial<LetterHead>) => void;
  /** Save was pressed with the period backwards (the form's `isMissing('period')`). */
  periodMissing?: boolean;
}): JSX.Element => {
  const t = useT();
  // Typed backwards, «إلى» says so at once — the server would refuse it naming no field.
  const backwards = periodMissing || !periodInOrder({ from, to });
  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-3 sm:gap-5">
      <DesignField label={t('fleet.custody.fundForm.letter.date')} datePicker>
        <Input
          type="date"
          dir="ltr"
          value={date}
          onChange={(e) => onChange({ date: e.target.value })}
          tone={DATE_BOX}
          data-fund-letter-date="true"
        />
      </DesignField>
      <DesignField label={t('fleet.custody.fundForm.letter.from')} datePicker>
        <Input
          type="date"
          dir="ltr"
          value={from}
          onChange={(e) => onChange({ from: e.target.value })}
          tone={DATE_BOX}
          data-fund-letter-from="true"
        />
      </DesignField>
      <DesignField
        label={t('fleet.custody.fundForm.letter.to')}
        datePicker
        missing={backwards}
        error={backwards ? t('fleet.custody.fundForm.periodOrder') : undefined}
      >
        <Input
          type="date"
          dir="ltr"
          value={to}
          onChange={(e) => onChange({ to: e.target.value })}
          tone={DATE_BOX}
          data-fund-letter-to="true"
        />
      </DesignField>
    </div>
  );
};

/** The fund before and after — «إجمالي العهدة» in the board's slate, the change in its tone. */
const TONE = {
  sky: {
    box: 'border-sky-300 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/[0.08]',
    ink: 'text-sky-800 dark:text-sky-300',
    sign: 'bg-sky-600 text-white dark:bg-sky-500',
  },
  emerald: {
    box: 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/[0.08]',
    ink: 'text-emerald-800 dark:text-emerald-300',
    sign: 'bg-emerald-600 text-white dark:bg-emerald-500',
  },
  teal: {
    box: 'border-teal-300 bg-teal-50 dark:border-teal-500/30 dark:bg-teal-500/[0.08]',
    ink: 'text-teal-800 dark:text-teal-300',
    sign: 'bg-teal-600 text-white dark:bg-teal-500',
  },
} as const;
/** A fund below zero — allowed («التسوية» may take more than it holds), and said in red. */
const NEGATIVE_INK = 'text-red-600 dark:text-red-400';
const NEGATIVE_SIGN = 'bg-red-600 text-white dark:bg-red-500';

/**
 * «سيُضاف إلى العهدة: … — إجمالي العهدة بعدها …» over the sum itself: the fund now, the change, the
 * fund after. A phone stacks the three, one figure to a line.
 */
export const FundResult = ({
  tone,
  line,
  before,
  change,
  after,
  changeLabel,
  ...rest
}: {
  tone: keyof typeof TONE;
  /** The sentence over the sum (`useFigureLine`). */
  line: ReactNode;
  before: number;
  /** Signed: + adds to the fund, − takes from it. */
  change: number;
  after: number;
  changeLabel: string;
} & Record<`data-${string}`, string>): JSX.Element => {
  const t = useT();
  const figure = useFigure();
  const look = TONE[tone];
  const cell = (label: string, value: number, mark: string, strong = false): JSX.Element => (
    <div
      data-fund-cell={mark}
      {...(value < 0 ? { 'data-fund-negative': 'true' } : {})}
      className={cn(
        'min-w-0 flex-1 rounded-lg border px-3 py-2 text-center',
        strong
          ? cn('border-transparent', value < 0 ? NEGATIVE_SIGN : look.sign)
          : 'border-slate-200 bg-white dark:border-[#2b3b6b] dark:bg-[#0a1233]',
      )}
    >
      <span
        className={cn(
          'block text-xs font-bold',
          strong ? 'text-white/85' : 'text-slate-500 dark:text-slate-400',
        )}
      >
        {label}
      </span>
      <span
        dir="ltr"
        className={cn(
          MONO,
          'text-base font-bold',
          strong ? 'text-white' : value < 0 ? NEGATIVE_INK : 'text-slate-900 dark:text-white',
        )}
      >
        {figure(value)}
      </span>
    </div>
  );
  const op = (text: string): JSX.Element => (
    <span
      aria-hidden="true"
      className={cn('shrink-0 text-center text-xl font-black leading-none', look.ink)}
    >
      {text}
    </span>
  );
  return (
    <div {...rest} className={cn('space-y-3 rounded-xl border-2 px-4 py-3', look.box)}>
      <p className={cn('text-[15px] font-bold', after < 0 ? NEGATIVE_INK : look.ink)}>{line}</p>
      <div className="flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        {cell(t('fleet.custody.fundForm.before'), before, 'before')}
        {op(change >= 0 ? '+' : '−')}
        {cell(changeLabel, Math.abs(change), 'change')}
        {op('=')}
        {cell(t('fleet.custody.fundForm.after'), after, 'after', true)}
      </div>
    </div>
  );
};

/**
 * A dialog's buttons. From a tablet up, the design's one row: the action, the print, «إلغاء». A
 * phone cannot hold three on a line, so the action and «إلغاء» share the first row edge to edge and
 * the print runs the panel's width under them.
 */
export const DialogButtons = ({
  save,
  print,
  cancel,
}: {
  save: ReactNode;
  print: ReactNode;
  cancel: ReactNode;
}): JSX.Element => (
  <div className="grid w-full grid-cols-[1fr_auto] gap-2 sm:flex sm:items-center sm:gap-3">
    <div className="[&>button]:w-full [&>button]:justify-center sm:[&>button]:w-auto">{save}</div>
    <div className="sm:order-last">{cancel}</div>
    <div className="col-span-2 [&>button]:w-full sm:[&>button]:w-auto">{print}</div>
  </div>
);

/** A list the dialog could not read, or that is empty — said in the list's place. */
export const ListNote = ({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'error';
}): JSX.Element => (
  <p
    className={cn(
      'rounded-xl border px-4 py-6 text-center text-sm font-semibold',
      tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
        : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80 dark:text-slate-400',
    )}
  >
    {children}
  </p>
);

/** The mutation a fund dialog sends through — `useChargeCustody()` and its two siblings. */
interface FundMutation<TBody> {
  mutateAsync: (body: TBody) => Promise<FleetCustodyOperationDto>;
  isPending: boolean;
}

/**
 * Send one fund operation — once per press — and say how it went.
 *
 * `run(body, print)` refuses while one is on its way (the ref answers before React has drawn the
 * spinner). With `print`, the tab opens first, inside the click; a refused tab records nothing and
 * says so. A recorded operation whose letter could not be written still counts as recorded: the
 * dialog closes and says where the letter is, so nobody records it twice.
 */
export const useFundOperation = <TBody,>({
  mutation,
  letter,
  done,
  taken,
  onDone,
  onTaken,
}: {
  mutation: FundMutation<TBody>;
  letter: FleetCustodyLetter;
  /** The toast once it is recorded. */
  done: string;
  /** What a 409 / 404 means for this operation. */
  taken: string;
  onDone: () => void;
  /** Read the dialog's list (and the fund) again after a refusal. */
  onTaken: () => void;
}): { run: (body: TBody, print: boolean) => void; busy: boolean } => {
  const t = useT();
  const locale = useLocale();
  const sending = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const settle = (): void => {
    sending.current = false;
    setWaiting(false);
  };
  const refused = (error: unknown): void => {
    const why = fundRefusalOf(error);
    if (why === 'taken') {
      toast.error(taken);
      onTaken();
      return;
    }
    toast.error(errorMessage(error, locale));
    if (why !== null) onTaken();
  };
  const recorded = (): void => {
    toast.success(done);
    onDone();
  };
  const run = (body: TBody, print: boolean): void => {
    if (sending.current) return;
    sending.current = true;
    setWaiting(true);
    if (!print) {
      mutation.mutateAsync(body).then(recorded, refused).finally(settle);
      return;
    }
    let saved = false;
    // Synchronously, still inside the click: `printPaperAfter` opens the tab before its first await.
    printPaperAfter(async () => {
      const op = await mutation.mutateAsync(body);
      saved = true;
      return { sheets: letterSheets(letterPaperOf(op)), title: letterFileName(letter) };
    }, t('fleet.custody.papers.printing'))
      .then(
        (opened) => {
          if (opened) recorded();
          else toast.error(t('fleet.violations.popupBlocked'));
        },
        (error: unknown) => {
          if (!saved) {
            refused(error);
            return;
          }
          recorded();
          toast.error(t('fleet.custody.fundForm.printFailed'));
        },
      )
      .finally(settle);
  };
  return { run, busy: waiting || mutation.isPending };
};
