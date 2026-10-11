// «عاوز اي مكان فيه تاريخ زى كدا شيل البيضا وخلى الملونه لما ادوس عليها تجبلى اختيار تاريخ» — and
// «أي مكان فيه تاريخ يبقى نفس الشكل». Every Fleet date box wears OUR calendar at its start edge, in
// the filters' cyan, and the browser's white one is hidden for that box alone. Ours is a real
// button that opens the box's picker; the box itself still takes a date typed by hand.
//
// One button, three frames that draw it: `FilterWithIcon` (the dark boards' icon filters),
// `DesignField` (the design forms, next to their «!») and `DateBox` below (every other date box —
// the plain `Field` forms and the filter boxes that carry no icon of their own).
import { type ReactNode } from 'react';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { openDatePicker } from '../../../shared/lib/open-date-picker';
import { BoardIcon, PATH } from './FuelCardBoard';

/**
 * The calendar's colour wherever a date is picked: the filters' cyan. The forms' indigo is the
 * site's purple family — what is pressed or picked — and this is neither.
 */
export const CALENDAR_TONE = 'text-cyan-600 dark:text-cyan-400';

/**
 * The browser's white calendar, hidden — for the inputs inside the frame that asks, never the
 * page's. Our button is then the box's only calendar.
 */
export const HIDE_NATIVE_PICKER = '[&_input::-webkit-calendar-picker-indicator]:hidden';

/** What a date box tells its calendar button. */
export interface DatePicker {
  /** The box's own name («من», «إلى», «تاريخ القراءة») — two buttons of a range must not read the same. */
  label: string;
  /**
   * The opening, for a box that has to turn into a date first (the notices' «من» written as
   * words while empty). Left out, the box beside the button opens its picker as it is.
   */
  open?: ((box: HTMLInputElement) => void) | undefined;
  /** The box cannot be changed now, so its calendar cannot open it either. */
  disabled?: boolean | undefined;
}

/** The calendar's press: the box it sits on opens its picker — the caller's way, or the plain one. */
export const openBoxBeside = (
  button: Pick<HTMLElement, 'parentElement'>,
  open: (box: HTMLInputElement) => void = openDatePicker,
): void => {
  const box = button.parentElement?.querySelector('input');
  if (box !== null && box !== undefined) open(box);
};

/**
 * The calendar button, laid over the start edge of the box beside it (its frame is `relative`
 * and keeps the box's text clear of it). A native `<button type="button">`: Tab reaches it, Enter
 * and Space press it, and it never submits the form around it.
 */
export const CalendarButton = ({
  label,
  open,
  disabled = false,
  icon = PATH.calendar,
  tone = CALENDAR_TONE,
  className,
  iconClassName = 'h-4 w-4',
}: DatePicker & {
  icon?: readonly string[];
  tone?: string | undefined;
  /** Where it sits on the box's start edge, and how far in. */
  className: string;
  iconClassName?: string;
}): JSX.Element => {
  const t = useT();
  const name = t('common.datePicker.open', { label });
  return (
    <button
      type="button"
      data-date-picker-button="true"
      aria-label={name}
      title={name}
      disabled={disabled}
      // The press keeps the focus where it was: a box being typed in stays so, and the notices'
      // «من» does not turn back into words before its calendar opens.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => openBoxBeside(e.currentTarget, open)}
      // The icon's own colour, kept — purple is for what is pressed or picked, and this is neither;
      // the focus ring is drawn in the same colour, hugging the icon inside the box rather than a
      // full-height bar over the box's border — so the app's purple `:focus-visible` ring is taken
      // off the button itself.
      className={cn(
        'group absolute start-0 z-[1] flex items-center',
        tone,
        'cursor-pointer focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      <span className="rounded p-0.5 transition-opacity group-hover:group-enabled:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-current">
        <BoardIcon d={icon} className={iconClassName} />
      </span>
    </button>
  );
};

/**
 * A date box of a form or a plain filter bar, with our calendar at its start: the box goes in as
 * the only child, as it is (`<Input type="date" …/>`), and keeps its value, its rule and its
 * typing.
 *
 * The gutter is on the PAGE's start side — where the calendar is — whatever the box's own `dir`:
 * a date reads left to right inside an Arabic page. Both sides are written, because a `dir="ltr"`
 * box on an Arabic page answers to `rtl:` and `ltr:` alike and the `rtl:` rules come later; the
 * pair is doubled (`&&`) so a bar's own padding for its boxes cannot take the gutter away. The
 * button is 8 + 2 + 16 + 2 = 28px; the text starts at 32.
 */
export const DateBox = ({
  label,
  open,
  disabled,
  tone,
  className,
  children,
}: DatePicker & {
  tone?: string | undefined;
  /** The frame's place in its row — its width, mostly; the box inside fills it. */
  className?: string | undefined;
  children: ReactNode;
}): JSX.Element => (
  <div
    className={cn(
      'relative',
      HIDE_NATIVE_PICKER,
      'rtl:[&&>input]:!pr-8 rtl:[&&>input]:!pl-3 ltr:[&&>input]:!pl-8 ltr:[&&>input]:!pr-3',
      className,
    )}
  >
    {children}
    <CalendarButton
      label={label}
      open={open}
      disabled={disabled}
      tone={tone}
      className="inset-y-0 ps-2"
    />
  </div>
);
