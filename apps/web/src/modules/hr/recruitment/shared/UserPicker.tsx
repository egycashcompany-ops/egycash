// Single-select user picker: a debounced autocomplete over the platform Users endpoint (reused,
// gated on `user.view`). Selecting a user returns { id, label }; a chosen user shows as a removable
// chip. Degrades to a disabled hint without directory access (never raw-id entry). RTL-safe.
//
// This is the generic control. `ManagerPicker` is this with the offer form's wording, and the
// interview queue's "interviewer" filter is this with the queue's wording — one behaviour, one
// implementation, so a fix to the debounce or the RTL handling lands everywhere at once.
import { useRef, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { useOnClickOutside } from '../../../../shared/lib/useOnClickOutside';
import { fullName } from '../../../../shared/lib/format';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { Spinner } from '../../../../shared/ui/Spinner';
import { useUserSearch } from '../job-offers/api/job-offer-queries';
import { UserName } from '../job-offers/components/UserName';

export interface UserRef {
  id: string;
  label: string;
}

export const UserPicker = ({
  value,
  onChange,
  searchPlaceholder,
  clearLabel,
  noAccessLabel,
  emptyLabel,
}: {
  value: UserRef | null;
  onChange: (next: UserRef | null) => void;
  /** Placeholder in the search box. */
  searchPlaceholder: string;
  /** Action that drops the current selection ("Change" on a form, "Clear" in a filter bar). */
  clearLabel: string;
  /** Shown instead of the control when the caller cannot read the user directory. */
  noAccessLabel: string;
  /** Shown when the search returns nothing. */
  emptyLabel: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const allowed = can('user.view');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);
  const { data: results = [], isFetching } = useUserSearch(term, allowed);

  if (value !== null) {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
        <span className="text-slate-700 dark:text-slate-200">
          {value.label !== '' ? value.label : <UserName id={value.id} />}
        </span>
        <button type="button" onClick={() => onChange(null)} className="ms-1 text-xs text-brand-600 hover:underline">
          {clearLabel}
        </button>
      </span>
    );
  }

  if (!allowed) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        {noAccessLabel}
      </p>
    );
  }

  return (
    <div className="relative w-full sm:w-72" ref={ref}>
      <SearchInput
        value={term}
        onChange={(v) => {
          setTerm(v);
          setOpen(true);
        }}
        placeholder={searchPlaceholder}
      />
      {open && term.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {isFetching ? (
            <div className="flex items-center justify-center py-4">
              <Spinner className="h-4 w-4 text-brand-600" aria-label={t('common.loading')} />
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-400">{emptyLabel}</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ id: u.id, label: fullName(u, locale) });
                      setTerm('');
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    <span className="truncate text-slate-700 dark:text-slate-200">{fullName(u, locale)}</span>
                    <span className="truncate text-xs text-slate-400">{u.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
