// Applicant search-picker (autocomplete) reused by the screening queue filter and the create
// dialog. Debounced search against the Applicants list API; selecting an applicant returns the
// full DTO to the caller. RTL-safe.
import { useRef, useState } from 'react';
import { type ApplicantDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useOnClickOutside } from '../../../../../shared/lib/useOnClickOutside';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { useApplicantSearch } from '../api/screening-queries';

export const ApplicantPicker = ({
  onSelect,
  placeholder,
}: {
  onSelect: (applicant: ApplicantDto) => void;
  placeholder?: string;
}): JSX.Element => {
  const t = useT();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);
  const { data: results = [], isFetching } = useApplicantSearch(term);

  const pick = (a: ApplicantDto): void => {
    onSelect(a);
    setTerm('');
    setOpen(false);
  };

  return (
    <div className="relative w-full sm:w-72" ref={ref}>
      <SearchInput
        value={term}
        onChange={(v) => {
          setTerm(v);
          setOpen(true);
        }}
        placeholder={placeholder ?? t('screening.filters.applicantSearch')}
      />
      {open && term.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {isFetching ? (
            <div className="flex items-center justify-center py-4">
              <Spinner className="h-4 w-4 text-brand-600" />
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-400">{t('screening.filters.noApplicants')}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {results.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => pick(a)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    <span className="font-mono text-xs text-slate-400" dir="ltr">{a.code}</span>
                    <span className="truncate text-slate-700 dark:text-slate-200">{a.fullNameAr}</span>
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
