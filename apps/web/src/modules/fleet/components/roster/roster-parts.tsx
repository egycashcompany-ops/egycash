// «تعيين السيارات» — the small pieces BOTH boards draw (the computer's table and the phone / tablet
// cards), ported from the approved samples without a change of look:
//
//   num / Count / CodeList   every figure in Latin digits («2026/11/09», «120», «(8)»)
//   slashDate / weekdayOf    the day as the steppers say it: «الاثنين 2026/11/09»
//   PastDayBanner            «يوم سابق.» — a past day is read, never planned
//   EditsBar                 the unsaved bar: what is unsaved, the edited cars, «تراجع» / «إلغاء» /
//                            «حفظ» — a phone's two rows, a portrait tablet's strip, or the
//                            landscape tablet's and the computer's floating bar
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { Button } from '../../../../shared/ui/Button';
import { UndoIcon } from '../../../../shared/ui/icons';

// ── figures ─────────────────────────────────────────────────────────────────────────────────────

/** Latin digits for every figure on this screen, as the approved samples and the new boards. */
export const LATIN = new Intl.NumberFormat('en-US');
export const num = (value: number): string => LATIN.format(value);

/** «(8)» — the parentheses in the text's own face, only the figure in the figures face. */
export const Count = ({ value, className }: { value: number; className?: string }): JSX.Element => (
  <span className={className}>
    (<span className="font-figures">{num(value)}</span>)
  </span>
);

/**
 * Car codes as a list read in the page's direction — «150 · 247 · 611», the first code next to
 * the words before it — each code kept left-to-right on its own.
 */
export const CodeList = ({
  codes,
  className,
}: {
  codes: readonly string[];
  className?: string;
}): JSX.Element => (
  <span className={className}>
    {codes.map((code, index) => (
      <span key={code}>
        {index > 0 && <span className="mx-1 opacity-60">·</span>}
        <bdi dir="ltr" className="font-figures">
          {code}
        </bdi>
      </span>
    ))}
  </span>
);

// ── the day ─────────────────────────────────────────────────────────────────────────────────────

const WEEKDAY_AR = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', timeZone: 'UTC' });
const WEEKDAY_EN = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });

/** «2026-11-09» → «2026/11/09». */
export const slashDate = (ymd: string): string => ymd.replace(/-/gu, '/');

/** The day's name («الاثنين»), from `Intl` — not a dictionary word. '' for a date that does not parse. */
export const weekdayOf = (ymd: string, locale: Locale): string => {
  const day = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return '';
  return (locale === 'en' ? WEEKDAY_EN : WEEKDAY_AR).format(day);
};

// ── the past day ────────────────────────────────────────────────────────────────────────────────

/**
 * A past day states what it is, once and at the top. Without it the board looks like any other
 * and the absence of «حفظ» reads as a permission problem rather than as the day being over.
 */
export const PastDayBanner = ({ className }: { className?: string }): JSX.Element => {
  const t = useT();
  return (
    <div
      data-readonly-day="true"
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border border-slate-200 bg-slate-100/80 px-3.5 py-2.5 text-[13px] leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300',
        className,
      )}
    >
      <span className="font-semibold text-slate-800 dark:text-slate-100">
        {t('fleet.roster.pastDayTitle')}
      </span>
      <span>{t('fleet.roster.pastDayBody')}</span>
    </div>
  );
};

// ── the unsaved bar ─────────────────────────────────────────────────────────────────────────────

/** The edited cars, each a 44px button that brings its row or card into view. */
const CodeButtons = ({
  codes,
  onCode,
}: {
  codes: readonly string[];
  onCode: (code: string) => void;
}): JSX.Element => (
  <span className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {codes.map((code) => (
      <button
        key={code}
        type="button"
        data-edited-code={code}
        onClick={() => onCode(code)}
        className="flex h-11 min-w-11 shrink-0 items-center justify-center"
      >
        <bdi
          dir="ltr"
          className="rounded-md bg-amber-100 px-1.5 font-figures text-[13px] font-bold leading-6 text-amber-900 underline decoration-amber-400/70 decoration-dotted underline-offset-2 dark:bg-amber-900/50 dark:text-amber-100"
        >
          {code}
        </bdi>
      </button>
    ))}
  </span>
);

export type EditsBarShape = 'phone' | 'strip' | 'floating';

/**
 * «تغييرات غير محفوظة» with the edited cars, «تراجع» (the last edit only), «إلغاء» (every edit)
 * and «حفظ». The board shows it only while there is something to save (`mayPlan && dirty`), so a
 * reader who cannot plan, a past day and an all-stored day never see it.
 *
 * «إلغاء» is live only when the reader edited something: a day can be saveable (it holds an
 * operation still only projected from the fixed crew) with nothing of the reader's own to throw
 * away — then the bar shows no codes and «حفظ» alone is live.
 */
export const EditsBar = ({
  codes,
  edited,
  undoable,
  saving,
  onUndo,
  onDiscard,
  onSave,
  onCode,
  shape,
}: {
  codes: readonly string[];
  edited: boolean;
  undoable: boolean;
  saving: boolean;
  onUndo: () => void;
  onDiscard: () => void;
  onSave: () => void;
  onCode: (code: string) => void;
  /**
   * `phone`: two rows — what is unsaved, then a full-width «حفظ» under the right thumb with
   * «تراجع» and «إلغاء» beside it. `strip`: a portrait tablet's edge-to-edge bar. `floating`: the
   * landscape tablet's and the computer's rounded bar.
   */
  shape: EditsBarShape;
}): JSX.Element => {
  const t = useT();
  const status = (
    <span className="flex shrink-0 items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" />
      <span
        data-unsaved="true"
        className="text-sm font-semibold text-amber-800 dark:text-amber-200"
      >
        {t('fleet.roster.unsaved')}
      </span>
    </span>
  );
  const undo = (
    <Button
      variant="secondary"
      data-undo-edit="true"
      disabled={!undoable || saving}
      onClick={onUndo}
      leftIcon={<UndoIcon className="h-4 w-4" />}
      className={cn('shrink-0', shape === 'phone' ? 'min-h-12' : 'min-h-11')}
    >
      {t('fleet.roster.undo')}
    </Button>
  );
  const discard = (
    <Button
      variant="secondary"
      data-discard-edits="true"
      disabled={!edited || saving}
      onClick={onDiscard}
      className={cn('shrink-0', shape === 'phone' ? 'min-h-12' : 'min-h-11')}
    >
      {t('common.cancel')}
    </Button>
  );
  const save = (
    <Button
      data-save-roster="true"
      loading={saving}
      onClick={onSave}
      className={cn(shape === 'phone' ? 'min-h-12 flex-1 text-[15px]' : 'min-h-11 shrink-0 px-5')}
    >
      {t('common.save')}
    </Button>
  );
  if (shape === 'phone') {
    return (
      <div
        data-edits-bar="true"
        data-edits-count={codes.length}
        className="pointer-events-auto border-t border-amber-300 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-10px_30px_-16px_rgba(15,23,42,0.35)] dark:border-amber-800/70 dark:bg-slate-900"
      >
        <div className="flex min-h-11 items-center gap-2">
          {status}
          <CodeButtons codes={codes} onCode={onCode} />
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          {save}
          {undo}
          {discard}
        </div>
      </div>
    );
  }
  return (
    <div
      data-edits-bar="true"
      data-edits-count={codes.length}
      className={cn(
        'pointer-events-auto bg-white dark:bg-slate-900',
        shape === 'floating'
          ? 'rounded-2xl border border-amber-300 px-4 py-2 shadow-lg dark:border-amber-800/70'
          : 'border-t border-amber-300 px-6 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_30px_-16px_rgba(15,23,42,0.35)] dark:border-amber-800/70',
      )}
    >
      <div className="flex items-center gap-2.5">
        {status}
        {codes.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 font-figures text-xs font-bold leading-5 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
            {num(codes.length)}
          </span>
        )}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          {codes.length > 0 && <span className="shrink-0">{t('fleet.roster.editedCars')}</span>}
          <CodeButtons codes={codes} onCode={onCode} />
        </span>
        {undo}
        {discard}
        {save}
      </div>
    </div>
  );
};
