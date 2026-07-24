// Accepted-offer search-picker for the create-employee flow. Debounced search against the Job Offer
// list API scoped to `status: accepted`; selecting one returns the offer. The server enforces the
// full rule (accepted + has snapshot + not already hired). RTL-safe.
import { useRef, useState } from 'react';
import { type JobOfferDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useOnClickOutside } from '../../../../../shared/lib/useOnClickOutside';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { useAcceptedOfferSearch } from '../api/employee-queries';

export const OfferPicker = ({
  onSelect,
}: {
  onSelect: (offer: JobOfferDto) => void;
}): JSX.Element => {
  const t = useT();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);
  const { data: results = [], isFetching } = useAcceptedOfferSearch(term);

  return (
    <div className="relative w-full sm:w-96" ref={ref}>
      <SearchInput
        value={term}
        onChange={(v) => {
          setTerm(v);
          setOpen(true);
        }}
        placeholder={t('employees.create.offerSearch')}
      />
      {open && term.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {isFetching ? (
            <div className="flex items-center justify-center py-4">
              <Spinner className="h-4 w-4 text-brand-600" />
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-400">{t('employees.create.noOffers')}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {results.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(o);
                      setTerm('');
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    <span className="font-mono text-xs text-slate-400" dir="ltr">{o.code}</span>
                    <span className="font-mono text-xs text-slate-500" dir="ltr">{o.applicantCode}</span>
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
