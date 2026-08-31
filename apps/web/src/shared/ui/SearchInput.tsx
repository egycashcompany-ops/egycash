// Debounced search box (controlled). Emits `onChange` after the user pauses; reflects external
// resets (e.g. "clear filters"). RTL-safe: the search icon sits at the reading start, the clear
// button at the end.
import { useEffect, useState } from 'react';
import { useT } from '../../platform/localization/useT';
import { cn } from '../lib/cn';
import { type ControlTextScale } from './form';
import { CloseIcon, SearchIcon } from './icons';

export const SearchInput = ({
  value,
  onChange,
  placeholder,
  debounceMs = 300,
  className,
  textScale = 'compact',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
  /**
   * How big the box's own text is — a PROP rather than a class, for the reason `form.tsx` spells
   * out: `cn` has no tailwind-merge, so a size passed as a class would be fighting the one already
   * there and losing. `className` still styles the wrapper, which is where width belongs.
   */
  textScale?: ControlTextScale;
}): JSX.Element => {
  const t = useT();
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  // Emit only what the USER changed. Callers pass an inline `onChange`, so its identity changes on
  // every parent render and this effect re-runs constantly; without the guard it re-emitted the
  // unchanged term, and a caller that resets the page on any filter change would throw away the
  // page the user deep-linked to. Comparing against the incoming `value` is also what makes an
  // external reset ("clear filters") settle instead of echoing back.
  useEffect(() => {
    if (text === value) return;
    const id = window.setTimeout(() => onChange(text), debounceMs);
    return () => window.clearTimeout(id);
  }, [text, value, debounceMs, onChange]);

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
        className={cn(
          'w-full rounded-lg border border-slate-200 bg-white py-2 pe-9 ps-9 text-slate-800 placeholder:text-slate-400 focus:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
          textScale === 'comfortable' ? 'text-base' : 'text-sm',
        )}
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
