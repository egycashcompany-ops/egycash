// A single-select control you can type into. Used where a `<select>` would be technically correct
// but unusable in practice: the Egyptian city list runs to dozens of entries per governorate, and
// scrolling a native dropdown to find "بولاق الدكرور" is slower than typing three letters of it.
//
// Behaviour worth knowing:
//  • The text box is a FILTER, not a free-text field — the committed value is always an option.
//    Leaving the box with an unmatched query restores the last committed value rather than
//    silently storing something the catalog does not contain. Leaving it — a click elsewhere, or
//    Tab — on the WHOLE text of one option (folded) commits that option, as a click on it would:
//    a name typed out in full and then «حفظ» pressed is the name the reader meant, not a blank.
//  • Escape closes the open list and nothing else: the dialog around it stays open.
//  • Filtering is diacritic- and alef-insensitive, so "الاسماعيليه" finds "الإسماعيلية".
//  • An option may be SHOWN differently from what it commits (`optionLabel`): the ATM register's
//    area filter matches the stored name (MOHNDESSEN) and shows it in the reader's language. Typing
//    finds either.
//  • A box may offer to ADD what was typed (`onCreate`) when no option is exactly it — the
//    shipment form's branch picker, where a branch missing from the catalog is created on the
//    spot. It is an explicit row the reader picks, never something leaving the box does: the box
//    still commits only options, and the owner decides what «add» means.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { fold } from '../lib/fold';
import { ChevronIcon, CloseIcon } from './icons';
import { useFieldMissing } from './required-fields';

/** How much room the box spends on itself — see `density` below. */
export type ComboboxDensity = 'default' | 'tight' | 'touch';

/**
 * Each density's classes, in one place, so exactly ONE size of each kind reaches an element (`cn`
 * is a plain joiner with no tailwind-merge; two paddings would be settled by Tailwind's emission
 * order). Sizes only — colours, borders and states stay the box's own.
 *
 * `touch` is a phone's box (IT's «فحص أجهزة السيارة», docs/12-planning/it-vehicle-checks-design.md
 * §6.3): 16px text, so iOS does not zoom when it is tapped; 48px rows, a thumb's target; a 40px ✕
 * with a gap before the chevron, so clearing the car does not land on the chevron; and a list of
 * 17rem, so while a code is typed it ends above the phone's keyboard, the sixth row showing half-cut
 * to say that the list scrolls. It wins over `tallList`.
 */
export const COMBOBOX_DENSITY: Record<
  ComboboxDensity,
  {
    /** The text box: its gutters (the trailing one clears the ✕ and the chevron), height and type. */
    input: string;
    /** One row of the open list, and the «nothing found» row. */
    option: string;
    /** The ✕ that clears the box, and its icon. */
    clear: string;
    clearIcon: string;
    /** The space between the ✕ and the chevron. */
    trailingGap: string;
    /** The open list's height, when this density sets one; otherwise `tallList` decides. */
    list: string | null;
  }
> = {
  default: {
    input: 'px-3 pe-16 py-2 text-sm',
    option: 'px-3 py-2 text-sm',
    clear: 'rounded p-0.5',
    clearIcon: 'h-3.5 w-3.5',
    trailingGap: 'gap-1',
    list: null,
  },
  tight: {
    input: 'px-2 pe-12 py-2 text-sm',
    option: 'px-3 py-2 text-sm',
    clear: 'rounded p-0.5',
    clearIcon: 'h-3.5 w-3.5',
    trailingGap: 'gap-1',
    list: null,
  },
  touch: {
    input: 'px-3 pe-20 py-3 text-base',
    option: 'flex min-h-12 items-center px-3 py-3 text-base',
    clear: 'flex h-10 w-10 items-center justify-center rounded-lg',
    clearIcon: 'h-5 w-5',
    trailingGap: 'gap-2',
    list: 'max-h-[17rem]',
  },
};

/**
 * Pure: the option whose WHOLE text — as shown, or as committed — is what was typed, folded; none
 * for a blank or a part. What leaving the box commits.
 */
export const exactOption = (
  options: readonly string[],
  typed: string,
  shown: (option: string) => string = (option) => option,
): string | undefined => {
  const q = fold(typed);
  if (q === '') return undefined;
  return options.find((o) => fold(shown(o)) === q || fold(o) === q);
};

/**
 * Pure: the text an «add» row would offer — the typed text, trimmed — or null when there is
 * nothing to offer: a blank box, or text that already IS an option (picking it is the answer, and
 * offering to create it again would make a duplicate).
 */
export const createOffer = (
  options: readonly string[],
  typed: string,
  shown: (option: string) => string = (option) => option,
): string | null => {
  const text = typed.trim();
  if (text === '') return null;
  return exactOption(options, text, shown) === undefined ? text : null;
};

export const Combobox = ({
  value,
  options,
  onChange,
  placeholder,
  emptyText,
  disabled = false,
  error = false,
  id,
  clearLabel,
  onBlur,
  onSearch,
  density = 'default',
  testId,
  ariaLabel,
  tallList = false,
  optionLabel,
  onCreate,
  createLabel,
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  placeholder?: string;
  /** Shown when the query matches nothing. */
  emptyText: string;
  disabled?: boolean;
  error?: boolean;
  id?: string;
  clearLabel: string;
  onBlur?: () => void;
  /**
   * Hand the typed query to the OWNER of the options instead of filtering here.
   *
   * A catalog small enough to hold in the page is filtered locally, which is the default. One
   * that outgrows a page — a vehicle registry — cannot be: filtering what happens to have been
   * fetched answers "which of the first N" and quietly hides the rest. When this is given,
   * `options` are taken as the answer already.
   */
  onSearch?: (query: string) => void;
  /**
   * Side gutter and type size, the same two knobs `form.tsx`'s controls take and for the same
   * reason: `cn` is a plain joiner, so a `px-2` handed in as a class would sit beside this input's
   * own `px-3` and the winner would be Tailwind's emission order. A bar that has to fit its
   * controls on one line buys the difference back here; a phone's form takes `touch`
   * (`COMBOBOX_DENSITY`).
   */
  density?: ComboboxDensity;
  /**
   * A stable hook for a test that has to tell this control apart from a neighbour with the same
   * accessible name — «كود السيارة» names both the entry control and the filter on the violations
   * screen, so `aria-label` cannot say which is which.
   */
  testId?: string;
  /** The control's own accessible name, when no `<label>` points at it. */
  ariaLabel?: string;
  /**
   * A taller open list — for a catalog the reader scrolls through as well as types into, such as
   * the whole vehicle registry, where seven rows at a time is a keyhole.
   */
  tallList?: boolean;
  /** What an option READS as, when that is not the value it commits. The value by default. */
  optionLabel?: (option: string) => string;
  /**
   * Offer to ADD the typed text when no option is exactly it: a last row, reachable by the arrows
   * and Enter like any option, that hands the trimmed text here and closes the list. Nothing is
   * committed — the owner creates the thing and sets `value` to it once it exists.
   */
  onCreate?: (typed: string) => void;
  /** The «add» row's words for the typed text — «+ إضافة فرع «…»». Needed with `onCreate`. */
  createLabel?: (typed: string) => string;
}): JSX.Element => {
  // A `Field` marked missing turns this box red, as it does an `Input`.
  const missing = useFieldMissing();
  const red = error || missing;
  const size = COMBOBOX_DENSITY[density];
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const shown = (option: string): string => optionLabel?.(option) ?? option;
  // While closed the box shows the committed value; while open it shows what you are typing.
  const text = open ? query : value === '' ? '' : shown(value);

  const remote = onSearch !== undefined;
  // A stored value the catalog does not carry — a record written before the catalog existed, or
  // imported from elsewhere — stays selectable instead of vanishing the moment the record is
  // opened for editing. Silently blanking it would turn "open and save" into data loss.
  //
  // Not while something is TYPED at a remote owner, though: its options are the answer to the
  // query, and pinning the committed value above them put it on the highlighted first row, so
  // typing «215» and pressing Enter committed the car already chosen instead of 215.
  const all = useMemo(
    () =>
      value !== '' && !options.includes(value) && !(remote && query.trim() !== '')
        ? [value, ...options]
        : options,
    [options, value, remote, query],
  );

  const matches = useMemo(() => {
    const q = fold(query);
    if (remote || !open || q === '') return all;
    return all.filter((o) => fold(optionLabel?.(o) ?? o).includes(q) || fold(o).includes(q));
  }, [open, query, all, remote, optionLabel]);

  // The «add» row: only with an owner who can create, and only for text no option already is.
  const offer = onCreate === undefined || !open ? null : createOffer(all, query, shown);
  // Rows the arrows move through: the matches, then the «add» row when there is one.
  const rowCount = matches.length + (offer === null ? 0 : 1);
  const create = (text: string): void => {
    setOpen(false);
    setQuery('');
    onCreate?.(text);
  };

  // Leaving the open box: an exact match is committed; anything else falls back to the value.
  const leave = (): void => {
    const exact = exactOption(all, query, shown);
    if (exact !== undefined && exact !== value) onChange(exact);
    setOpen(false);
    setQuery('');
    onBlur?.();
  };
  // Read by the document listener below, which is registered once per opening.
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) {
        leaveRef.current();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Keep the highlighted row inside the scroll port when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const commit = (option: string): void => {
    onChange(option);
    setOpen(false);
    setQuery('');
    onBlur?.();
  };

  // Open on the catalog's opening answer, whatever was typed last time — the one way the list
  // opens, from focus, from a click on a box that already has focus (right after a pick), and
  // from the arrow keys.
  const openFresh = (): void => {
    setOpen(true);
    setQuery('');
    setActive(0);
    // The owner's results still hold the last query; ask for the opening answer again.
    onSearch?.('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        openFresh();
        return;
      }
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return rowCount === 0 ? 0 : (next + rowCount) % rowCount;
      });
      return;
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault();
      const picked = matches[active];
      if (picked !== undefined) commit(picked);
      else if (offer !== null && active === matches.length) create(offer);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      // The list's Escape, not the dialog's: a dialog listening on the document would otherwise
      // close too, and take everything typed into it along.
      e.stopPropagation();
      setOpen(false);
      setQuery('');
      return;
    }
    // Tab leaves the box the way a click elsewhere does; focus moves on as usual.
    if (e.key === 'Tab' && open) leave();
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        {...(testId === undefined ? {} : { 'data-vehicle-select': testId })}
        {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          if (!open) setOpen(true);
          onSearch?.(e.target.value);
        }}
        onFocus={openFresh}
        onClick={() => {
          if (!open) openFresh();
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Blur fires before a click on an option lands, so the close is deferred to the
          // outside-pointer handler; only report the visit upward here.
          if (!open) onBlur?.();
        }}
        className={cn(
          'w-full rounded-lg border bg-white text-slate-800',
          // The trailing gutter has to clear the clear-button and the chevron that sit over it.
          size.input,
          'placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50',
          'dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800',
          red
            ? 'border-red-400 focus:border-red-500'
            : 'border-slate-300 focus:border-brand-400 dark:border-slate-700',
        )}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 end-2 flex items-center',
          size.trailingGap,
        )}
      >
        {value !== '' && !disabled && (
          <button
            type="button"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={() => {
              onChange('');
              setQuery('');
            }}
            className={cn(
              'pointer-events-auto text-slate-400 hover:text-slate-600 dark:hover:text-slate-200',
              size.clear,
            )}
          >
            <CloseIcon className={size.clearIcon} />
          </button>
        )}
        <ChevronIcon className="h-4 w-4 text-slate-400" />
      </div>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className={cn(
            'absolute z-30 mt-1 w-full overflow-y-auto rounded-lg border border-slate-200',
            size.list ?? (tallList ? 'max-h-[26rem]' : 'max-h-64'),
            // One step lighter than the page in dark mode: on a near-black background a drop
            // shadow is invisible, so the surface itself has to say "this floats above".
            'bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800',
          )}
        >
          {matches.length === 0 && offer === null && (
            <li className={cn(size.option, 'text-slate-400')}>{emptyText}</li>
          )}
          {matches.map((option, i) => (
            <li
              key={option}
              role="option"
              aria-selected={option === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()} // keep focus so the click reaches onClick
              onClick={() => commit(option)}
              className={cn(
                'cursor-pointer',
                size.option,
                i === active ? 'bg-slate-100 dark:bg-slate-700' : '',
                option === value
                  ? 'font-medium text-slate-900 dark:text-slate-100'
                  : 'text-slate-700 dark:text-slate-300',
              )}
            >
              {shown(option)}
            </li>
          ))}
          {offer !== null && (
            <li
              role="option"
              aria-selected={false}
              data-combobox-create="true"
              onMouseEnter={() => setActive(matches.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => create(offer)}
              className={cn(
                'cursor-pointer border-t border-slate-100 font-semibold text-brand-600 dark:border-slate-700 dark:text-brand-300',
                size.option,
                active === matches.length ? 'bg-slate-100 dark:bg-slate-700' : '',
              )}
            >
              {createLabel?.(offer) ?? `+ ${offer}`}
            </li>
          )}
        </ul>
      )}
    </div>
  );
};
