// Multi-select interviewer picker for the panel (schedule + reassign). Debounced search against
// the platform Users endpoint (reused, gated on `user.view`); selected interviewers show as
// removable chips. When the caller lacks directory access, it degrades to a disabled hint rather
// than exposing raw id entry (never surface internal identifiers). RTL-safe.
import { useRef, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../store';
import { useOnClickOutside } from '../../../../../shared/lib/useOnClickOutside';
import { fullName } from '../../../../../shared/lib/format';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { CloseIcon } from '../../../../../shared/ui/icons';
import { UserName } from './UserName';
import { useUserSearch } from '../api/interview-queries';

export interface SelectedUser {
  id: string;
  /** Display name; empty for pre-seeded members (resolved via the directory instead). */
  label: string;
}

export const UserPicker = ({
  value,
  onChange,
}: {
  value: SelectedUser[];
  onChange: (next: SelectedUser[]) => void;
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

  const add = (id: string, label: string): void => {
    if (!value.some((u) => u.id === id)) onChange([...value, { id, label }]);
    setTerm('');
    setOpen(false);
  };
  const remove = (id: string): void => onChange(value.filter((u) => u.id !== id));

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((u) => (
            <li
              key={u.id}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm dark:border-slate-700 dark:bg-slate-800/60"
            >
              <span className="truncate text-slate-700 dark:text-slate-200">
                {u.label !== '' ? u.label : <UserName id={u.id} />}
              </span>
              <button
                type="button"
                onClick={() => remove(u.id)}
                className="text-slate-400 hover:text-slate-600"
                aria-label={t('common.remove')}
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {allowed ? (
        <div className="relative" ref={ref}>
          <SearchInput
            value={term}
            onChange={(v) => {
              setTerm(v);
              setOpen(true);
            }}
            placeholder={t('interviews.panel.search')}
          />
          {open && term.trim().length >= 2 && (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {isFetching ? (
                <div className="flex items-center justify-center py-4">
                  <Spinner className="h-4 w-4 text-brand-600" />
                </div>
              ) : results.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-400">{t('interviews.panel.noUsers')}</p>
              ) : (
                <ul className="max-h-56 overflow-y-auto">
                  {results.map((u) => {
                    const label = fullName(u, locale);
                    const chosen = value.some((s) => s.id === u.id);
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          disabled={chosen}
                          onClick={() => add(u.id, label)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-700"
                        >
                          <span className="truncate text-slate-700 dark:text-slate-200">{label}</span>
                          <span className="truncate text-xs text-slate-400">{u.email}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {t('interviews.panel.needDirectory')}
        </p>
      )}
    </div>
  );
};
