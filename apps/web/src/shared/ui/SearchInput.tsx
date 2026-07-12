// Debounced search box (controlled). Emits `onChange` after the user pauses; reflects external
// resets (e.g. "clear filters"). RTL-safe: the search icon sits at the reading start, the clear
// button at the end.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../platform/localization/useT';
import { cn } from '../lib/cn';
import { CloseIcon, SearchIcon } from './icons';

export const SearchInput = ({
  value,
  onChange,
  placeholder,
  debounceMs = 300,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const [text, setText] = useState(value);
  const first = useRef(true);

  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = window.setTimeout(() => onChange(text), debounceMs);
    return () => window.clearTimeout(id);
  }, [text, debounceMs, onChange]);

  const clear = (): void => {
    setText('');
    onChange('');
  };

  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-slate-400">
        <SearchIcon className="h-4 w-4" />
      </span>
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? t('common.search')}
        className="w-full rounded-lg border border-slate-200 bg-white py-2 pe-9 ps-9 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      {text !== '' && (
        <button
          type="button"
          onClick={clear}
          className="absolute inset-y-0 end-0 flex items-center pe-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label={t('common.clear')}
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
