// Optional single-user picker used for the org-unit *manager* field. Type-ahead over the existing
// `/platform/users` search endpoint (gated by `user.view`); degrades to a plain, disabled hint when
// the caller lacks that permission. Controlled: the parent owns the selected user id.
import { useRef, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { useT } from '../../../platform/localization/useT';
import { fullName } from '../../../shared/lib/format';
import { useOnClickOutside } from '../../../shared/lib/useOnClickOutside';
import { Input } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { useUser, useUserSearch } from './references';

export const UserPicker = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (userId: string | null) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);

  const maySearch = can('user.view');
  const { data: current } = useUser(value);
  const { data: results = [], isFetching } = useUserSearch(term, maySearch && open);

  if (!maySearch) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">{t('organization.manager.noAccess')}</p>;
  }

  if (value !== null) {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
        <span className="text-slate-700 dark:text-slate-200">
          {current === undefined ? value : fullName(current, locale)}
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setTerm('');
          }}
          className="ms-1 text-xs text-brand-600 hover:underline"
        >
          {t('common.remove')}
        </button>
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <Input
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t('organization.manager.search')}
      />
      {open && term.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {isFetching && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500">
              <Spinner /> {t('common.loading')}
            </div>
          )}
          {!isFetching && results.length === 0 && (
            <p className="px-3 py-2 text-sm text-slate-500">{t('organization.manager.noResults')}</p>
          )}
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                onChange(u.id);
                setOpen(false);
                setTerm('');
              }}
              className="flex w-full flex-col items-start px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <span className="text-slate-700 dark:text-slate-200">{fullName(u, locale)}</span>
              <span className="text-xs text-slate-400" dir="ltr">
                {u.email}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Read-only manager name for list/detail views; degrades to the raw id (or a dash) on denial. */
export const UserName = ({ userId }: { userId: string | null }): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data } = useUser(userId);
  if (userId === null) return <span className="text-slate-400">—</span>;
  return <span>{data === undefined ? userId : fullName(data, locale)}</span>;
};
