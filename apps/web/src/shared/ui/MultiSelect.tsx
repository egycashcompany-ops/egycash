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

export interface MultiSelectOption {
  value: string;
  label: string;
}

export const MultiSelect = ({
  label,
  options,
  value,
  onChange,
  /** Show the search box only when the list is long enough for it to earn its space. */
  searchThreshold = 7,
  onSearch,
  searching = false,
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
  /** Fetching the remote answer — only meaningful alongside `onSearch`. */
  searching?: boolean;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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
        <span className="whitespace-nowrap">{label}</span>
        {/* The count IS the "this list is filtered" signal — never hide it behind a colour alone. */}
        {selected > 0 && (
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
                  placeholder={t('common.search')}
                  className="w-full rounded-md border border-slate-200 bg-white py-1.5 pe-2 ps-8 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
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
