// A filter dropdown that takes MORE THAN ONE answer.
//
// A queue filter is a question like "which statuses am I looking at?", and the honest answer is
// usually several — "waiting and accepted, not rejected". A single-value `<select>` forces that
// question to be asked one answer at a time, so the user filters, reads, changes the filter, and
// reads again, holding the comparison in their head. Checkboxes let them ask it once.
//
// Two details carry most of the usefulness:
//  • The trigger shows HOW MANY are selected, so a filtered list never looks like an unfiltered one.
//    A filter you have forgotten you set is worse than no filter.
//  • The list is searchable and folds Arabic spelling, because a stage or branch list gets long and
//    scrolling to find one entry is slower than typing three letters of it.
import { useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { foldIncludes } from '../lib/fold';
import { useOnClickOutside } from '../lib/useOnClickOutside';
import { useT } from '../../platform/localization/useT';
import { CheckIcon, ChevronIcon, SearchIcon } from './icons';

/** Names shown in full before the tail collapses to `+n`. Three fit a filter-bar trigger. */
const SUMMARY_MAX = 3;

export interface MultiSelectOption {
  value: string;
  label: string;
  /**
   * A shorter form for the TRIGGER, when the list label is too long to sit in a filter bar.
   *
   * Optional and falling back to `label`, so a caller that has nothing shorter to say says
   * nothing. A vehicle reads as "150 — س ص 150" in the list, where the plate confirms the car,
   * but the trigger has one row to work with and the code alone identifies it.
   */
  shortLabel?: string;
}

/**
 * What the trigger says once something is chosen: the choices themselves, not how many.
 *
 * A count answers "is this filtered?" and leaves "filtered to WHAT?" to a click. Naming the
 * choices answers both. Past `max` the tail collapses to `+n` — the row cannot grow, and two
 * names plus a number still say more than a bare count does.
 *
 * Values are shown in the order they were CHOSEN, not the order the options happen to arrive in:
 * a server-backed list reorders under the reader, and a summary that reshuffles itself while they
 * read it is worse than one that is merely long.
 */
export const selectionSummary = (
  options: readonly MultiSelectOption[],
  value: readonly string[],
  max: number,
): string => {
  const shown = (v: string): string => {
    const option = options.find((o) => o.value === v);
    // A chosen value the current options do not carry — a server-backed list has moved on — is
    // still named by the only thing known about it.
    return option?.shortLabel ?? option?.label ?? v;
  };
  // An ASCII comma rather than an Arabic one: the trigger is not branched by locale, and it
  // carries Latin identifiers as often as Arabic words. The codebase uses both — `، ` for prose
  // lists, `, ` for lists of values — and this is the second kind.
  if (value.length <= max) return value.map(shown).join(', ');
  // Two names plus the remainder: enough to recognise the filter, short enough to fit.
  const head = value
    .slice(0, max - 1)
    .map(shown)
    .join(', ');
  return `${head} +${value.length - (max - 1)}`;
};

export const MultiSelect = ({
  label,
  options,
  value,
  onChange,
  /** Show the search box only when the list is long enough for it to earn its space. */
  searchThreshold = 7,
  onSearch,
  onCommitSearch,
  searchValue,
  searching = false,
  showSelectedValues = false,
  chips = false,
  placeholder,
  className,
}: {
  /** What the filter asks. Shown in the trigger while nothing is selected. */
  label: string;
  options: readonly MultiSelectOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  searchThreshold?: number;
  /**
   * Hand the typed query to the OWNER of the options instead of filtering here.
   *
   * A list short enough to hold in the page is filtered locally, which is the default. A list
   * that outgrows one page — a vehicle registry, a branch directory — cannot be: filtering what
   * happens to have been fetched silently answers "which of the first N" instead of "which".
   * When this is given, `options` are taken as the answer already and the search box is always
   * offered, however few of them came back.
   */
  onSearch?: (query: string) => void;
  /**
   * Enter pressed in the search box, with whatever is typed there.
   *
   * For a filter whose values can be WRITTEN as well as picked — a list of vehicle codes pasted
   * out of a message. The owner decides what the text means and calls `onChange`; this only says
   * when. Opt-in: without it, Enter does what it always did.
   */
  onCommitSearch?: (raw: string) => void;
  /**
   * Take ownership of the search text.
   *
   * For a filter whose box is also an INPUT: the owner may consume part of what was typed — turning
   * `150 - 215` into a chosen `150` and a still-being-typed `215` — and it can only show that by
   * putting the remainder back. Omit it and the box keeps its own text, as every other filter does.
   */
  searchValue?: string;
  /** Fetching the remote answer — only meaningful alongside `onSearch`. */
  searching?: boolean;
  /**
   * Name the chosen values in the trigger instead of counting them.
   *
   * Off by default: a filter over a short, familiar vocabulary — a handful of statuses — is
   * legible as a count, and every bar that reads that way today keeps reading that way. Turn it
   * on where the vocabulary is open or unmemorable, and the reader would otherwise have to open
   * the list to find out what they had already chosen.
   */
  showSelectedValues?: boolean;
  /**
   * What the EMPTY trigger says, when the label is already written above the control.
   *
   * A filter bar has no labels, so the trigger carries the question and this stays unset — every
   * bar in the system reads exactly as it did. A form field has a `<label>` above it, and
   * repeating the same words inside the control says nothing twice. `label` still answers the
   * screen reader either way.
   */
  /**
   * Show the selection as removable chips at the top of the panel.
   *
   * Off by default, so the filters that read as a count keep reading as one. A filter whose values
   * are individually meaningful — which CARS — needs them nameable and removable one at a time,
   * and the panel is where a reader is already looking when they manage a selection. Putting them
   * under the trigger instead would push every filter bar that hosts one out of shape.
   */
  chips?: boolean;
  placeholder?: string;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [ownQuery, setOwnQuery] = useState('');
  // Controlled when the owner passes `searchValue`; its own otherwise.
  const query = searchValue ?? ownQuery;
  const setQuery = (next: string): void => {
    if (searchValue === undefined) setOwnQuery(next);
  };
  const boxRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(boxRef, () => setOpen(false), open);

  const remote = onSearch !== undefined;
  const searchable = remote || options.length >= searchThreshold;
  const matches = useMemo(
    () =>
      !remote && searchable && query !== ''
        ? options.filter((o) => foldIncludes(o.label, query))
        : options,
    [options, query, searchable, remote],
  );

  const selected = value.length;
  // `null` = say the label, the way every bar that has not opted in still does.
  const summary =
    showSelectedValues && selected > 0 ? selectionSummary(options, value, SUMMARY_MAX) : null;
  const toggle = (option: string): void =>
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setOpen((o) => !o);
          setQuery('');
          // The owner's results still hold the last query; ask for the opening answer again.
          onSearch?.('');
        }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm',
          'focus:border-brand-400 focus:outline-none',
          selected > 0
            ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-200'
            : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
        )}
      >
        {/* Nothing chosen: the question. Something chosen: the answer — and the answer replaces
            the question rather than sitting beside it, because the row has no space for both and
            `aria-label` already tells a screen reader which filter this is. */}
        {summary === null ? (
          <span
            className={cn('whitespace-nowrap', placeholder !== undefined && 'text-slate-400')}
          >
            {placeholder ?? label}
          </span>
        ) : (
          <span className="max-w-48 truncate" title={summary}>
            {summary}
          </span>
        )}
        {/* The count IS the "this list is filtered" signal — never hide it behind a colour alone.
            It is redundant once the values are named, so it steps aside there. */}
        {summary === null && selected > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">
            {selected}
          </span>
        )}
        <ChevronIcon className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable
          className={cn(
            'absolute z-30 mt-1 max-h-72 w-56 overflow-hidden rounded-lg border border-slate-200 shadow-lg',
            // A step lighter than the page in dark mode: on near-black a shadow says nothing, so
            // the surface itself has to read as floating.
            'bg-white dark:border-slate-600 dark:bg-slate-800',
          )}
        >
          {searchable && (
            <div className="border-b border-slate-100 p-2 dark:border-slate-700">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute inset-y-0 start-2 my-auto h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    onSearch?.(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (onCommitSearch === undefined || e.key !== 'Enter') return;
                    e.preventDefault();
                    onCommitSearch(query);
                    setQuery('');
                    onSearch?.('');
                  }}
                  placeholder={t('common.search')}
                  className="w-full rounded-md border border-slate-200 bg-white py-1.5 pe-2 ps-8 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          )}

          {chips && selected > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-slate-100 p-2 dark:border-slate-700">
              {value.map((code) => (
                <span
                  key={code}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                >
                  <span dir="ltr">{code}</span>
                  <button
                    type="button"
                    aria-label={`${t('common.filters.clearOne')} ${code}`}
                    onClick={() => toggle(code)}
                    className="text-brand-500 hover:text-brand-800 dark:hover:text-brand-100"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <ul className="max-h-52 overflow-y-auto py-1">
            {matches.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-400">
                {searching ? t('common.loading') : t('common.noResults')}
              </li>
            )}
            {matches.map((option) => {
              const checked = value.includes(option.value);
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(option.value)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'grid h-4 w-4 shrink-0 place-items-center rounded border',
                        checked
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-slate-300 bg-white dark:border-slate-500 dark:bg-slate-900',
                      )}
                    >
                      {checked && <CheckIcon className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{option.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected > 0 && (
            <div className="border-t border-slate-100 p-1.5 dark:border-slate-700">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded-md px-2 py-1.5 text-start text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                {t('common.filters.clearOne')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
