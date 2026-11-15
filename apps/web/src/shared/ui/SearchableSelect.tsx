// A list you pick ONE entry from, and type into to find it — «اعمل سيرش بحرف او اتنين و هي تجبلي الباقي
// منها». The shared `Combobox`, for a list of `{ value, label }`: the value an id, the label a name.
//
// ONLY A LONG LIST IS SEARCHED: «اي خانات صغيره عدد محدود فالسيرش لا لو سيرش علي حجات كتير ماشي». Under
// `SEARCH_FROM` options it is the plain list, as the filters of ticks are (`MultiSelect`'s
// `searchThreshold`, the same seven) — so a list that grows past it is searched from then on.
//
// Why not hand the ids straight to `Combobox`: filtering on its own, the box matches what was typed
// against the value too, and a «1» typed for a department would keep nearly every 24-digit hex id
// on the list. So the typed text is matched against the LABEL only (`valuesMatching`, Arabic
// spelling folded: «امين» finds «أمين»), and the box is handed the answer — the register page's
// rule (`idsMatching`), for every list.
import { useMemo, useState } from 'react';
import { foldIncludes } from '../lib/fold';
import { useT } from '../../platform/localization/useT';
import { Combobox } from './Combobox';
import { Select } from './form';

/** The length from which a list is typed into rather than scrolled — `MultiSelect`'s too. */
export const SEARCH_FROM = 7;

export interface SearchableOption {
  value: string;
  label: string;
}

/** Pure: the values, in order, whose label holds what was typed — every one for a blank box. */
export const valuesMatching = (options: readonly SearchableOption[], typed: string): string[] =>
  options.filter((option) => foldIncludes(option.label, typed)).map((option) => option.value);

export const SearchableSelect = ({
  value,
  onChange,
  options,
  placeholder,
  emptyText,
  loading = false,
  disabled = false,
  error = false,
  id,
  ariaLabel,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  options: readonly SearchableOption[];
  /** What the box reads while nothing is chosen — «اختر…» by default; «الكل» for a filter. */
  placeholder?: string;
  /** Shown when nothing matches — «لا توجد نتائج» by default. */
  emptyText?: string;
  /** The options are still on their way: the empty list says so. */
  loading?: boolean;
  disabled?: boolean;
  error?: boolean;
  id?: string;
  ariaLabel?: string;
  testId?: string;
}): JSX.Element => {
  const t = useT();
  const [typed, setTyped] = useState('');
  const labels = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);
  // A short list stays a list: nothing to search for in a handful.
  if (options.length < SEARCH_FROM) {
    return (
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        error={error}
        {...(id === undefined ? {} : { id })}
        {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
        {...(testId === undefined ? {} : { 'data-searchable-select': testId })}
      >
        <option value="">{placeholder ?? t('common.select')}</option>
        {/* A value the list does not hold (yet) stays chosen, blank — never its raw id. */}
        {value !== '' && !labels.has(value) && <option value={value}>{''}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <Combobox
      value={value}
      options={valuesMatching(options, typed)}
      optionLabel={(option) => labels.get(option) ?? ''}
      onSearch={setTyped}
      onChange={(next) => {
        setTyped('');
        onChange(next);
      }}
      placeholder={placeholder ?? t('common.select')}
      emptyText={emptyText ?? t(loading ? 'common.loading' : 'common.noResults')}
      clearLabel={t('common.clear')}
      disabled={disabled}
      error={error}
      {...(id === undefined ? {} : { id })}
      {...(ariaLabel === undefined ? {} : { ariaLabel })}
      {...(testId === undefined ? {} : { testId })}
    />
  );
};
