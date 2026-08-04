// A single-select control you can type into. Used where a `<select>` would be technically correct
// but unusable in practice: the Egyptian city list runs to dozens of entries per governorate, and
// scrolling a native dropdown to find "بولاق الدكرور" is slower than typing three letters of it.
//
// Behaviour worth knowing:
//  • The text box is a FILTER, not a free-text field — the committed value is always an option.
//    Leaving the box with an unmatched query restores the last committed value rather than
//    silently storing something the catalog does not contain.
//  • Filtering is diacritic- and alef-insensitive, so "الاسماعيليه" finds "الإسماعيلية".
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { ChevronIcon, CloseIcon } from './icons';

/** Fold the spelling differences Arabic typists make: hamza forms, ta marbuta, diacritics. */
const fold = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N} ]/gu, '');

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
}): JSX.Element => {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // While closed the box shows the committed value; while open it shows what you are typing.
  const text = open ? query : value;

  const matches = useMemo(() => {
    const q = fold(query);
    if (!open || q === '') return options;
    return options.filter((o) => fold(o).includes(q));
  }, [open, query, options]);

  // A value that is no longer in the list (the governorate changed under it) must not look chosen.
  useEffect(() => {
    if (value !== '' && !options.includes(value)) onChange('');
  }, [options, value, onChange]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
        onBlur?.();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, onBlur]);

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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return matches.length === 0 ? 0 : (next + matches.length) % matches.length;
      });
      return;
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault();
      const picked = matches[active];
      if (picked !== undefined) commit(picked);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
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
        }}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Blur fires before a click on an option lands, so the close is deferred to the
          // outside-pointer handler; only report the visit upward here.
          if (!open) onBlur?.();
        }}
        className={cn(
          'w-full rounded-lg border bg-white px-3 py-2 pe-16 text-sm text-slate-800',
          'placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50',
          'dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800',
          error
            ? 'border-red-400 focus:border-red-500'
            : 'border-slate-300 focus:border-brand-400 dark:border-slate-700',
        )}
      />
      <div className="pointer-events-none absolute inset-y-0 end-2 flex items-center gap-1">
        {value !== '' && !disabled && (
          <button
            type="button"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={() => {
              onChange('');
              setQuery('');
            }}
            className="pointer-events-auto rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <CloseIcon className="h-3.5 w-3.5" />
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
            'absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200',
            // One step lighter than the page in dark mode: on a near-black background a drop
            // shadow is invisible, so the surface itself has to say "this floats above".
            'bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800',
          )}
        >
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-400">{emptyText}</li>
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
                'cursor-pointer px-3 py-2 text-sm',
                i === active ? 'bg-slate-100 dark:bg-slate-700' : '',
                option === value
                  ? 'font-medium text-slate-900 dark:text-slate-100'
                  : 'text-slate-700 dark:text-slate-300',
              )}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
