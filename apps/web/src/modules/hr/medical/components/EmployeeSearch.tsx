// Picking one employee by searching for them.
//
// A SEARCH BOX RATHER THAN A DROPDOWN, for the reason the nomination dialog and the performance
// assign dialog each record separately: the list is the company, and a select loaded from one page
// answers «which of the ones that happened to be fetched» while quietly hiding everybody else.
//
// This is the THIRD copy of that pattern, so it is a component rather than a fourth inline block.
// It is not moved to `shared/` because the two earlier copies each carry their own display shape —
// pulling all three together would mean a component with three modes, which is how a shared
// component becomes worse than the duplication it replaced. When a fourth caller wants exactly
// this shape, it imports this.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type EmployeeDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { buildQuery, getPage } from '../../../../shared/lib/api-client';
import { Field, Input } from '../../../../shared/ui/form';

/** Enough characters to mean something. One letter matches most of the company. */
const MIN_QUERY = 2;

export const EmployeeSearch = ({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (employeeId: string) => void;
  label: string;
}): JSX.Element => {
  const t = useT();
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<{ code: string; name: string } | null>(null);

  const search = useQuery({
    queryKey: ['employees', 'picker', term.trim()],
    enabled: term.trim().length >= MIN_QUERY && value === '',
    queryFn: () =>
      getPage<EmployeeDto>(
        `/hr/employees${buildQuery({ search: term.trim(), page: 1, pageSize: 10 })}`,
      ),
    staleTime: 30_000,
  });
  const results = search.data?.items ?? [];

  return (
    <Field label={label} required>
      {chosen === null ? (
        <div className="space-y-2">
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('performance.review.evaluatorSearch')}
          />
          {results.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
              {results.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => {
                      setChosen({ code: row.code, name: row.personal.fullNameAr });
                      onChange(row.id);
                      setTerm('');
                    }}
                  >
                    <span>{row.personal.fullNameAr}</span>
                    <span className="font-mono text-xs text-slate-500" dir="ltr">
                      {row.code}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
          <span className="text-slate-700 dark:text-slate-200">{chosen.name}</span>
          <button
            type="button"
            onClick={() => {
              setChosen(null);
              onChange('');
            }}
            className="ms-2 text-xs text-brand-600 hover:underline"
          >
            {t('offers.form.change')}
          </button>
        </span>
      )}
    </Field>
  );
};
