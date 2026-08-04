// The applicant search-picker: debounced search, a dropdown of matches, one selection.
//
// This was three files. They had drifted apart in exactly the way copies do — one of them was
// still leading its rows with `APP-2026-…` after the other two had moved to names — and nothing
// could have caught that, because each copy worked.
//
// What actually differed between them is here as props: which applicants are searchable, what the
// box says, what an empty result says, and how wide it is. Everything else — the debounce, the
// click-outside close, the two-character threshold, the loading and empty states, the row markup —
// was identical three times over.
//
// WHICH APPLICANTS is a hook rather than a filter object on purpose. Each stage's search carries
// its own query key (`screening` searches live applicants, `interviews` all of them, `job-offers`
// only those moved to the offer stage), and a query key is cache identity: folding them into one
// parameterised call would quietly change what each screen shares with what.
import { useRef, useState } from 'react';
import { type ApplicantDto } from '@ecms/contracts';
import { useOnClickOutside } from '../../../../shared/lib/useOnClickOutside';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { Spinner } from '../../../../shared/ui/Spinner';

/** The shape every stage's `useApplicantSearch` already returns. */
export type ApplicantSearchHook = (term: string) => {
  data?: ApplicantDto[] | undefined;
  isFetching: boolean;
};

export const ApplicantPicker = ({
  onSelect,
  useSearch,
  placeholder,
  emptyLabel,
  className = 'w-full sm:w-72',
}: {
  onSelect: (applicant: ApplicantDto) => void;
  /** The stage's own search — see the note above on why this is a hook. */
  useSearch: ApplicantSearchHook;
  placeholder: string;
  /** What to say when the search found nobody. */
  emptyLabel: string;
  /** Width, which the create-offer flow wants wider than the queue filters do. */
  className?: string;
}): JSX.Element => {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);
  const { data: results = [], isFetching } = useSearch(term);

  const pick = (a: ApplicantDto): void => {
    onSelect(a);
    setTerm('');
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <SearchInput
        value={term}
        onChange={(v) => {
          setTerm(v);
          setOpen(true);
        }}
        placeholder={placeholder}
      />
      {open && term.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {isFetching ? (
            <div className="flex items-center justify-center py-4">
              <Spinner className="h-4 w-4 text-brand-600" />
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-400">{emptyLabel}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {results.map((a) => (
                <li key={a.id}>
                  {/* Searching by code still finds the row; the row still answers with a person.
                      The code stays reachable in the tooltip for whoever typed it. */}
                  <button
                    type="button"
                    onClick={() => pick(a)}
                    title={a.code}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
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
